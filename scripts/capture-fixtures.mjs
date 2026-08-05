import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { access, constants, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const verify = !update;
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
  [".js", "text/javascript; charset=utf-8"]
]);

function fixtureCases() {
  const classic = [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS].map((entry) => ({
    fixtureId: entry.fixtureId,
    profile: "classic",
    title: entry.title,
    url: `/tests/fixtures/route-classic.html?fixture=${encodeURIComponent(entry.fixtureId)}`,
    readySelector: entry.requiredSelectors.at(-1),
    beforeCapture: entry.beforeCapture || ""
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

function canExecute(path) {
  return access(path, constants.X_OK).then(() => true, () => false);
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

  waitFor(method, sessionId) {
    return new Promise((resolvePromise, reject) => {
      const waiter = {
        method,
        sessionId,
        resolve: resolvePromise,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 20000)
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

// TIER-2 ZEBRA GUARD. Row striping is a ~9/255 background change, and comparePng
// below only counts a pixel when a channel moves by more than 24 — so the stripes
// are invisible to the screenshot diff BY CONSTRUCTION, and deleting every stripe
// rule leaves all 28 baselines at 0.000%. Proven, not assumed: with the shipped
// tint fixtures:verify reported no drift while the DOM was genuinely re-coloured,
// and only forcing the stripe to #ff0000 failed the diff.
//
// This is the tier that can see it, so it reads the computed backgrounds directly.
// It runs inside the page that was just captured — no second browser, no extra
// navigation — and answers null on fixtures with no machine, which is most of
// them. AFTER the capture, not before, because it forces states and toggles
// classes to make the carve-outs observable, and none of that may reach a
// baseline. SIGHTING FOUR is the precedent: the tier that could have seen the
// defect was the tier we skipped.
async function probeRowStripes(client, sessionId) {
  const { result } = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const rows = [...document.querySelectorAll("tr.uir-machine-row, tr.uir-list-row-tr")];
      if (rows.length < 2) {
        return null;
      }
      // The same split the stylesheet makes: a row is DATA unless it carries one
      // of the excluded classes. Kept in sync with edit-grid/core.js's
      // EXCLUDED_ROW_SELECTOR, which the stripe rule quotes.
      const EXCLUDED = ["machineButtonRow", "totalrow", "uir-machine-loading-row", "uir-machine-nodata-row",
        "uir-machine-button-row", "uir-machine-totals-row", "uir-loading-row", "uir-nodata-row", "uir-machine-row-last"];
      const STATEFUL = ["uir-machine-row-focused", "listfocusedrow", "uir-active"];
      // Returned as 0-255 triples, not strings: computed colours come back as
      // rgb() or color(srgb …) depending on whether a color-mix produced them,
      // so string equality would call two identical colours different.
      const colourOf = (element) => {
        if (!element) {
          return null;
        }
        const value = getComputedStyle(element).backgroundColor;
        // \\d, not \\\\d and not \\d-in-a-template: this whole expression is a JS
        // template literal, so a bare \\d would reach the page as a plain "d".
        const parts = (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
        return value.startsWith("color(") ? parts.map((n) => Math.round(n * 255)) : parts;
      };
      const paint = (row) => colourOf(row.querySelector("td"));
      window.__suitemateStripePaint = paint;
      // The two shades are READ FROM THE TOKENS, not inferred from the first two
      // rows. Inferring them means a regression that inverts the parity renames
      // the shades as well as breaking them, and every message downstream then
      // describes the wrong defect — the base is whatever row 0 happens to be.
      // A hidden span resolves the tokens because custom properties compute to
      // their own text, not to a colour. RESOLVED AT A ROW, PER GROUP, not at
      // body: Clean Commerce scopes the machine tint as a row-level token
      // override (4.5% vs the lists' 8%), so a body-resolved swatch reads the
      // list values and calls every machine row wrong.
      const shadeAt = (context, name) => {
        const swatch = document.createElement("span");
        swatch.style.display = "none";
        context.append(swatch);
        swatch.style.backgroundColor = "var(" + name + ")";
        const colour = colourOf(swatch);
        swatch.remove();
        return colour;
      };
      const isData = (row) => !EXCLUDED.some((name) => row.classList.contains(name));
      // GROUPED BY PARENT, because :nth-child restarts at every parent: two
      // machines on one page are two independent runs, and reading them as one
      // list would call the second machine's first row a parity break. Every
      // fixture today holds a single tbody, so this changes nothing now and
      // stops a second one from arriving as a false failure.
      const groups = new Map();
      for (const row of rows.filter(isData)) {
        const siblings = groups.get(row.parentElement) || [];
        siblings.push(row);
        groups.set(row.parentElement, siblings);
      }
      // FORCED STATES. Three of the four carve-outs are classes, so they can be
      // stood in for from here — applied to a row the stripe DOES paint, so a
      // deleted carve-out shows up as the stripe surviving a state that must
      // always beat it. The fourth is :hover and needs CDP; the row is marked
      // for the caller, which forces it and reads the same cell.
      // From the first group the ASSERTIONS will walk (>= 2 rows), not the first
      // group that exists: a lone-row group ahead of the machine would hand this
      // probe a row the parity check never looks at, and the forced-hover guard
      // would fail closed on a page that is entirely correct.
      const targetSiblings = [...groups.values()].find((siblings) => siblings.length >= 2);
      const target = targetSiblings?.[1];
      const forced = [];
      for (const name of target ? STATEFUL : []) {
        target.classList.add(name);
        forced.push({ state: name, colour: paint(target) });
        target.classList.remove(name);
      }
      if (target) {
        target.dataset.stripeProbe = "hover";
      }
      // LIVE CLASSIC PAGES CARRY .isRedwood (the detection over-fires, same as
      // the active tabs). The tokens once had an .isRedwood branch that set
      // odd = even, so every real page lost the tint while these fixtures —
      // which never carry the class — kept passing. Re-resolve the shades with
      // the class forced on so that branch coming back fails here.
      const hadRedwood = document.documentElement.classList.contains("isRedwood");
      document.documentElement.classList.add("isRedwood");
      const redwoodContext = targetSiblings?.[0] ?? document.body;
      const redwood = {
        base: shadeAt(redwoodContext, "--row-even-bg-color"),
        stripe: shadeAt(redwoodContext, "--row-odd-bg-color")
      };
      if (!hadRedwood) {
        document.documentElement.classList.remove("isRedwood");
      }
      return {
        target: targetSiblings
          ? {
            base: shadeAt(targetSiblings[0], "--row-even-bg-color"),
            stripe: shadeAt(targetSiblings[0], "--row-odd-bg-color")
          }
          : null,
        redwood,
        groups: [...groups.values()].map((siblings) => ({
          base: shadeAt(siblings[0], "--row-even-bg-color"),
          stripe: shadeAt(siblings[0], "--row-odd-bg-color"),
          rows: siblings.map((row) => ({
            colour: paint(row),
            // Stateful rows stay IN the index. The rule carves them out of the
            // paint, not out of the count, so removing them here would renumber
            // every row below an open line and report a parity break that the
            // page does not have.
            stateful: STATEFUL.some((name) => row.classList.contains(name))
          }))
        })),
        nonData: [...document.querySelectorAll("tr.uir-machine-headerrow"), ...rows.filter((row) => !isData(row))].map(paint),
        forced
      };
    })()`,
    returnByValue: true
  }, sessionId);
  const stripes = result.value ?? null;
  if (stripes?.forced.length) {
    stripes.hover = await probeForcedHover(client, sessionId);
  }
  return stripes;
}

// The :hover carve-out, which no class can stand in for. This mutates nothing —
// it is the browser's own hover state, applied to the row the probe above
// marked — but it does run against a live page, which is why the whole probe
// now happens AFTER the screenshot rather than before it.
async function probeForcedHover(client, sessionId) {
  await client.send("DOM.enable", {}, sessionId);
  await client.send("CSS.enable", {}, sessionId);
  const { root } = await client.send("DOM.getDocument", {}, sessionId);
  const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-stripe-probe]" }, sessionId);
  if (!nodeId) {
    return null;
  }
  await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] }, sessionId);
  const { result } = await client.send("Runtime.evaluate", {
    expression: `window.__suitemateStripePaint(document.querySelector("[data-stripe-probe]"))`,
    returnByValue: true
  }, sessionId);
  await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }, sessionId);
  return result.value ?? null;
}

// Below this the stripe exists in the CSSOM but not to a human eye. Measured, not
// guessed: the tint this feature shipped with for months was #fafafa on #fff — a
// delta of 5, which is what "there is no striping" looked like to the owner. The
// current tint is 14. A floor of 8 fails the invisible one and passes the real
// one, and it is the check that makes this guard about the FEATURE rather than
// about the rules merely being present.
// 6, down from 8: Clean Commerce sets the machine tint at the owner's 4.5%
// mix, which computes ~7/255 on the default primary. The floor still catches
// the class of defect it was built for — the shipped-invisible stripe measured
// 1-2/255 — while accepting the owner's deliberately subtle tint. Never lower
// this to make a run pass; lower it only when the DESIGN gets subtler.
const STRIPE_MIN_DELTA = 6;

// How many of the 28 baselines hold a striped machine or list today. Raise it
// when a fixture gains one; never lower it to make a run pass.
const STRIPE_CHECK_FLOOR = 17;

const sameColour = (a, b) => a && b && a.every((channel, index) => channel === b[index]);
const maxDelta = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));

function assertStripes(label, stripes) {
  const groups = (stripes?.groups || []).filter((entry) => entry.rows.length >= 2);
  if (groups.length === 0) {
    return null;
  }
  // Shades are PER GROUP: machine rows carry the Clean Commerce 4.5% override
  // while list rows keep the shared 8%, and each group's rows are asserted
  // against the tokens resolved at that group's own rows.
  let minDelta = Infinity;
  for (const { base, stripe, rows } of groups) {
    if (sameColour(stripe, base)) {
      throw new Error(`${label}: --row-odd-bg-color and --row-even-bg-color are both rgb(${base}) — there is no stripe to render.`);
    }
    const delta = maxDelta(base, stripe);
    minDelta = Math.min(minDelta, delta);
    if (delta < STRIPE_MIN_DELTA) {
      throw new Error(`${label}: the stripe differs from the base by only ${delta}/255 (floor ${STRIPE_MIN_DELTA}) — rgb(${base}) vs rgb(${stripe}) is not visible.`);
    }
    for (const [index, row] of rows.entries()) {
      // A stateful row is asserted NOT-STRIPE rather than equal-to-base: the
      // carve-out only promises the stripe stands down, and what wins instead
      // is NetSuite's business — a .uir-active list row genuinely paints the
      // hover fill, so demanding the base would fail a correct page.
      if (row.stateful) {
        if (sameColour(row.colour, stripe)) {
          throw new Error(`${label}: data row ${index} carries a native state and is still rgb(${row.colour}), the stripe colour — a carve-out is gone.`);
        }
        continue;
      }
      const wanted = index % 2 === 0 ? base : stripe;
      if (!sameColour(row.colour, wanted)) {
        throw new Error(`${label}: data row ${index} is rgb(${row.colour}), expected rgb(${wanted}) — stripe parity is not alternating over data rows.`);
      }
    }
  }
  const { base, stripe } = stripes.target;
  // Under a forced .isRedwood class — what every live classic page carries.
  const redwoodDelta = maxDelta(stripes.redwood.base, stripes.redwood.stripe);
  if (redwoodDelta < STRIPE_MIN_DELTA) {
    throw new Error(`${label}: with .isRedwood on <html> the stripe delta collapses to ${redwoodDelta}/255 (floor ${STRIPE_MIN_DELTA}) — a Redwood token branch is neutralising the tint on live pages again.`);
  }
  // NATIVE STATES WIN, checked by forcing them rather than by reading the rule.
  // A class carve-out that goes missing leaves an open line or an inline edit
  // striped; the :hover one leaves a hovered row striped instead of highlighted,
  // because the stripe rule out-specifies the hover rule once its :not() shrinks.
  for (const { state, colour } of stripes.forced) {
    if (sameColour(colour, stripe)) {
      throw new Error(`${label}: a striped data row keeps the stripe under .${state} — that carve-out is gone, so the native state no longer wins.`);
    }
  }
  if (!stripes.hover) {
    throw new Error(`${label}: the forced-hover probe read nothing — the :hover carve-out went unchecked.`);
  }
  if (sameColour(stripes.hover, stripe) || sameColour(stripes.hover, base)) {
    throw new Error(`${label}: a hovered data row is rgb(${stripes.hover}), the ${sameColour(stripes.hover, stripe) ? "stripe" : "base"} colour — hover no longer beats the stripe.`);
  }
  // Non-data rows are checked against the STRIPE colour, not against the base.
  // The header row legitimately carries its own header fill (v3-compat paints it
  // from --suitemate-v3-table-header-bg), so "equals the base" is the wrong
  // property and asserting it fails on a correct page — this check said so the
  // first time it ran. What must never happen is a non-data row picking up the
  // alternating colour, which is exactly what plain :nth-child used to do.
  for (const colour of stripes.nonData) {
    if (groups.some((entry) => sameColour(colour, entry.stripe))) {
      throw new Error(`${label}: a header/totals/button row is rgb(${colour}), the stripe colour — a non-data row is being striped.`);
    }
  }
  const counted = groups.reduce((total, entry) => total + entry.rows.length, 0);
  return `${counted} data rows in ${groups.length} machine(s) alternate, delta ${minDelta}/255, ${stripes.forced.length + 1} states forced`;
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
        style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.suitemate-v3-toast{opacity:1!important;transform:none!important}";
        document.head.append(style);
        window.scrollTo(0, 0);
        return true;
      })()`,
      returnByValue: true
    }, sessionId);
    if (entry.beforeCapture) {
      const setup = await client.send("Runtime.evaluate", {
        expression: entry.beforeCapture,
        returnByValue: true
      }, sessionId);
      if (setup.exceptionDetails) {
        throw new Error(`${entry.fixtureId}: beforeCapture failed: ${setup.exceptionDetails.text || "unknown error"}`);
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const { data } = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    }, sessionId);
    const stripes = await probeRowStripes(client, sessionId);
    return { buffer: Buffer.from(data, "base64"), state, stripes };
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
  let stripeChecks = 0;
  for (const entry of cases) {
    const { buffer, state, stripes } = await captureCase(client, origin, entry);
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
      const striping = assertStripes(relativePath, stripes);
      stripeChecks += striping ? 1 : 0;
      results.push(`${relativePath} ${state.route || entry.profile} ${(comparison.changedRatio * 100).toFixed(3)}%${striping ? ` [zebra: ${striping}]` : ""}`);
    } else {
      results.push(`${relativePath} ${digest}`);
    }
  }
  // A FLOOR ON THE COUNT, because every check above is skipped silently when the
  // probe finds no rows. Renaming the row selector — or renaming the class in the
  // fixtures — reported "verified on 0 of them" and exited 0, which is the guard
  // saying nothing in the voice of the guard saying yes.
  if (verify && !requestedFixture) {
    assert.ok(
      stripeChecks >= STRIPE_CHECK_FLOOR,
      `Row striping was checked on only ${stripeChecks} fixtures, floor ${STRIPE_CHECK_FLOOR} — the probe stopped finding rows it used to find.`
    );
  }
  const striping = verify ? ` Row striping verified on ${stripeChecks} of them.` : "";
  process.stdout.write(`${update ? "Updated" : "Verified"} ${results.length} fixture screenshots at ${catalog.VIEWPORT.width}x${catalog.VIEWPORT.height}.${striping}\n${results.join("\n")}\n`);
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
