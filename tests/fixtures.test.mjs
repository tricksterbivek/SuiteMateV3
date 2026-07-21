import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routeSource = await readFile(resolve(root, "src/shared/routes.js"), "utf8");
const catalogSource = await readFile(resolve(root, "tests/fixtures/route-catalog.js"), "utf8");
const fixtureHtml = await readFile(resolve(root, "tests/fixtures/route-classic.html"), "utf8");
const fixtureRuntime = await readFile(resolve(root, "tests/fixtures/route-fixture.js"), "utf8");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

function loadRoutes() {
  const sandbox = { URL, URLSearchParams };
  sandbox.globalThis = sandbox;
  runInNewContext(routeSource, sandbox);
  return sandbox.SuiteMateV3Routes;
}

function loadCatalog() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(catalogSource, sandbox);
  return sandbox.SuiteMateV3FixtureCatalog;
}

const routes = loadRoutes();
const catalog = loadCatalog();

test("fixture catalog covers every classified NetSuite route with a Classic baseline", () => {
  assert.equal(catalog.VERSION, 1);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.CLASSIC_ROUTES), true);

  const expectedRouteIds = Object.values(routes.ROUTE_IDS)
    .filter((routeId) => routeId !== routes.ROUTE_IDS.UNKNOWN)
    .sort();
  const actualRouteIds = catalog.CLASSIC_ROUTES.map(({ routeId }) => routeId).sort();
  assert.deepEqual(JSON.parse(JSON.stringify(actualRouteIds)), expectedRouteIds);
  assert.equal(new Set(actualRouteIds).size, actualRouteIds.length, "Primary route fixtures must be one-to-one");

  const fixtureIds = [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS, ...catalog.REDWOOD_BASELINES]
    .map(({ fixtureId }) => fixtureId);
  assert.equal(new Set(fixtureIds).size, fixtureIds.length, "Fixture IDs must be globally unique");

  for (const entry of [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS]) {
    const context = routes.createPageContext(`https://123456.app.netsuite.com${entry.path}`);
    assert.equal(context.routeId, entry.routeId, `${entry.fixtureId} uses the wrong route URL`);
    assert.equal(entry.requiredSelectors.length > 0, true, `${entry.fixtureId} has no readiness contract`);
    assert.equal(Object.isFrozen(entry.forbiddenSelectors), true, `${entry.fixtureId} has a mutable isolation contract`);
    assert.equal(/6998262|9845683|tricksterbivek/i.test(JSON.stringify(entry)), false, `${entry.fixtureId} contains real account data`);
  }
});

test("fixture catalog exercises every page-specific stylesheet from the manifest", async () => {
  const catalogStyles = new Set(
    [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS]
      .flatMap(({ pageStyles }) => pageStyles)
      .filter((style) => !style.startsWith("../../"))
  );
  const manifestPageStyles = new Set(
    manifest.content_scripts
      .flatMap(({ css = [] }) => css)
      .filter((path) => path.startsWith("src/styles/pages/"))
      .map((path) => path.slice("src/styles/pages/".length))
  );
  assert.deepEqual([...catalogStyles].sort(), [...manifestPageStyles].sort());

  for (const entry of [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS]) {
    for (const style of entry.pageStyles) {
      const target = resolve(root, "src/styles/pages", style);
      await access(target);
    }
  }
});

test("Classic route harness mirrors production load order and remains local", async () => {
  assert.match(fixtureHtml, /src="\/tests\/fixtures\/route-catalog\.js"[\s\S]*?src="\/tests\/fixtures\/route-fixture\.js"[\s\S]*?src="\/tests\/fixtures\/chrome-stub\.js"/);
  assert.match(fixtureHtml, /src="\/src\/shared\/utilities\.js"[\s\S]*?src="\/src\/shared\/browser-utilities\.js"[\s\S]*?src="\/src\/shared\/routes\.js"[\s\S]*?src="\/src\/shared\/commands\.js"[\s\S]*?src="\/src\/shared\/bridge\.js"/);
  assert.match(fixtureHtml, /src="\/src\/suiteql\/core\.js"[\s\S]*?src="\/dist\/suiteql-studio\.js"/);
  assert.doesNotMatch(fixtureHtml + fixtureRuntime + catalogSource, /https?:\/\//, "Regression fixtures must not call external services");
  assert.match(fixtureRuntime, /fixtureRouteActual/);
  assert.match(fixtureRuntime, /route\.requiredSelectors\.filter/);
  assert.match(fixtureRuntime, /route\.forbiddenSelectors\.filter/);
  assert.match(fixtureRuntime, /dataset\.fixtureReady = "true"/);

  for (const match of fixtureHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    await access(resolve(root, `.${reference}`));
  }
});

test("every route and retained Redwood contract has a valid screenshot baseline", async () => {
  const entries = [
    ...catalog.CLASSIC_ROUTES.map((entry) => ({ ...entry, profile: "classic" })),
    ...catalog.CLASSIC_VARIANTS.map((entry) => ({ ...entry, profile: "classic" })),
    ...catalog.REDWOOD_BASELINES.map((entry) => ({ ...entry, profile: "redwood" }))
  ];
  assert.equal(entries.length, 26);

  for (const entry of entries) {
    const path = resolve(root, "tests/fixtures/screenshots", entry.profile, `${entry.fixtureId}.png`);
    const png = await readFile(path);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${entry.fixtureId} is not a PNG`);
    assert.equal(png.readUInt32BE(16), catalog.VIEWPORT.width, `${entry.fixtureId} has the wrong width`);
    assert.equal(png.readUInt32BE(20), catalog.VIEWPORT.height, `${entry.fixtureId} has the wrong height`);
    assert.equal(png.length > 10000, true, `${entry.fixtureId} screenshot is unexpectedly empty`);
  }
});
