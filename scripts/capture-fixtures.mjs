import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

await import("../tests/fixtures/route-catalog.js");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = globalThis.SuiteMateV3FixtureCatalog;
const args = new Set(process.argv.slice(2));
const update = args.has("--update");
const verify = args.has("--verify") || !update;
const requestedFixture = process.argv.find((value) => value.startsWith("--fixture="))?.slice(10) || null;
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"]
]);

function fixtureCases() {
  const classic = [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS].map((entry) => ({
    fixtureId: entry.fixtureId,
    profile: "classic",
    title: entry.title,
    url: `/tests/fixtures/route-classic.html?fixture=${encodeURIComponent(entry.fixtureId)}`,
    readySelector: entry.requiredSelectors.at(-1)
  }));
  const redwood = catalog.REDWOOD_BASELINES.map((entry) => ({
    ...entry,
    profile: "redwood"
  }));
  return [...classic, ...redwood].filter((entry) => !requestedFixture || entry.fixtureId === requestedFixture);
}

if (args.has("--list")) {
  for (const entry of fixtureCases()) {
    process.stdout.write(`${entry.profile}/${entry.fixtureId}\n`);
  }
  process.exit(0);
}

async function canExecute(path) {
  if (!path) {
    return false;
  }
  try {
    const { constants } = await import("node:fs");
    const { access } = await import("node:fs/promises");
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  for (const candidate of chromeCandidates) {
    if (await canExecute(candidate)) {
      return candidate;
    }
  }
  throw new Error("Chrome is required for fixture screenshots. Set CHROME_PATH to an executable Chrome or Chromium binary.");
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      const target = resolve(root, `.${pathname}`);
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const contents = await readFile(target);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(extname(target)) || "application/octet-stream"
      });
      response.end(contents);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function waitForDevToolsUrl(child) {
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Chrome did not expose DevTools within 20 seconds. ${stderr.slice(-1000)}`)), 20000);
    const onData = (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        child.stderr.off("data", onData);
        resolvePromise(match[1]);
      }
    };
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready with code ${code}. ${stderr.slice(-1000)}`));
    });
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Set();
    this.diagnostics = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handleMessage(JSON.parse(event.data)));
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  handleMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      this.diagnostics.push([
        details?.text || "Runtime exception",
        details?.exception?.description || details?.exception?.value || "",
        details?.url ? `${details.url}:${details.lineNumber ?? 0}` : ""
      ].filter(Boolean).join(" "));
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const values = message.params?.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      this.diagnostics.push(`console.${message.params?.type || "log"}: ${values}`);
    }

    for (const waiter of [...this.waiters]) {
      if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === message.sessionId)) {
        this.waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(message.params || {});
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { method, resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  waitFor(method, sessionId, timeoutMs = 20000) {
    return new Promise((resolvePromise, reject) => {
      const waiter = {
        method,
        sessionId,
        resolve: resolvePromise,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs)
      };
      this.waiters.add(waiter);
    });
  }

  close() {
    this.socket?.close();
  }
}

async function waitForFixture(client, sessionId, entry) {
  const deadline = Date.now() + 20000;
  let lastState = null;
  while (Date.now() < deadline) {
    const { result } = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.documentElement;
        const error = root.dataset.fixtureError || "";
        const ready = root.dataset.fixtureReady === "true" || Boolean(document.querySelector(${JSON.stringify(entry.readySelector)}));
        return { ready, error, title: document.title, route: root.dataset.fixtureRouteActual || "" };
      })()`,
      returnByValue: true
    }, sessionId);
    const state = result.value;
    lastState = state;
    if (state?.error) {
      throw new Error(`${entry.fixtureId}: ${state.error}`);
    }
    if (state?.ready) {
      await client.send("Runtime.evaluate", {
        expression: "document.fonts ? document.fonts.ready.then(() => true) : true",
        awaitPromise: true,
        returnByValue: true
      }, sessionId);
      return state;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`${entry.fixtureId}: fixture did not become ready. ${JSON.stringify(lastState)} ${client.diagnostics.slice(-10).join(" | ")}`);
}

async function captureCase(client, origin, entry) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank", background: true });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: catalog.VIEWPORT.width,
      height: catalog.VIEWPORT.height,
      deviceScaleFactor: catalog.VIEWPORT.deviceScaleFactor,
      mobile: false,
      screenWidth: catalog.VIEWPORT.width,
      screenHeight: catalog.VIEWPORT.height
    }, sessionId);
    const loaded = client.waitFor("Page.loadEventFired", sessionId);
    await client.send("Page.navigate", { url: `${origin}${entry.url}` }, sessionId);
    await loaded;
    const state = await waitForFixture(client, sessionId, entry);
    await client.send("Runtime.evaluate", {
      expression: `(() => {
        const style = document.createElement("style");
        style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
        document.head.append(style);
        window.scrollTo(0, 0);
        return true;
      })()`,
      returnByValue: true
    }, sessionId);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const { data } = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    }, sessionId);
    return { buffer: Buffer.from(data, "base64"), state };
  } finally {
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Invalid PNG signature");
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  assert.equal(bitDepth, 8, "Only 8-bit PNG fixtures are supported");
  assert.equal(interlace, 0, "Interlaced PNG fixtures are unsupported");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `Unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawOffset++];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowStart - stride + x - channels] : 0;
      const reconstructed = filter === 0 ? value
        : filter === 1 ? value + left
          : filter === 2 ? value + up
            : filter === 3 ? value + Math.floor((left + up) / 2)
              : filter === 4 ? value + paeth(left, up, upperLeft)
                : Number.NaN;
      assert.equal(Number.isNaN(reconstructed), false, `Unsupported PNG filter ${filter}`);
      pixels[rowStart + x] = reconstructed & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function comparePng(baselineBuffer, actualBuffer) {
  const baseline = decodePng(baselineBuffer);
  const actual = decodePng(actualBuffer);
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return { changedRatio: 1, reason: `${baseline.width}x${baseline.height} became ${actual.width}x${actual.height}` };
  }
  let changed = 0;
  const pixels = baseline.width * baseline.height;
  for (let index = 0; index < pixels; index += 1) {
    let maxDifference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const baselineValue = baseline.pixels[index * baseline.channels + channel];
      const actualValue = actual.pixels[index * actual.channels + channel];
      maxDifference = Math.max(maxDifference, Math.abs(baselineValue - actualValue));
    }
    if (maxDifference > 24) {
      changed += 1;
    }
  }
  return { changedRatio: changed / pixels, reason: `${changed} of ${pixels} pixels changed` };
}

const cases = fixtureCases();
if (cases.length === 0) {
  throw new Error(`Unknown fixture requested: ${requestedFixture}`);
}

const chrome = await findChrome();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "suitemate-v3-fixtures-"));
const outputDirectory = update ? resolve(root, "tests/fixtures/screenshots") : resolve(temporaryDirectory, "screenshots");
const { server, origin } = await startStaticServer();
const child = spawn(chrome, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-features=Translate,OptimizationHints",
  "--disable-sync",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--remote-allow-origins=*",
  "--remote-debugging-port=0",
  `--user-data-dir=${join(temporaryDirectory, "chrome-profile")}`,
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let client;
try {
  const devToolsUrl = await waitForDevToolsUrl(child);
  client = new CdpClient(devToolsUrl);
  await client.connect();
  await mkdir(outputDirectory, { recursive: true });
  const results = [];
  for (const entry of cases) {
    const { buffer, state } = await captureCase(client, origin, entry);
    const relativePath = `${entry.profile}/${entry.fixtureId}.png`;
    const target = resolve(outputDirectory, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (verify) {
      const baselinePath = resolve(root, "tests/fixtures/screenshots", relativePath);
      const baseline = await readFile(baselinePath).catch(() => null);
      if (!baseline) {
        throw new Error(`${relativePath}: baseline missing. Run npm run fixtures:update.`);
      }
      const comparison = comparePng(baseline, buffer);
      if (comparison.changedRatio > 0.01) {
        throw new Error(`${relativePath}: visual difference ${(comparison.changedRatio * 100).toFixed(3)}% exceeds 1%. ${comparison.reason}`);
      }
      results.push(`${relativePath} ${state.route || entry.profile} ${(comparison.changedRatio * 100).toFixed(3)}%`);
    } else {
      results.push(`${relativePath} ${digest}`);
    }
  }
  process.stdout.write(`${update ? "Updated" : "Verified"} ${results.length} fixture screenshots at ${catalog.VIEWPORT.width}x${catalog.VIEWPORT.height}.\n${results.join("\n")}\n`);
} finally {
  client?.close();
  child.kill("SIGTERM");
  server.close();
  await new Promise((resolvePromise) => {
    if (child.exitCode !== null) {
      resolvePromise();
      return;
    }
    const timeout = setTimeout(resolvePromise, 2000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
  await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
}
