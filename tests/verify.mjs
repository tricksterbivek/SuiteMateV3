import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "SuiteMate V3");
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, ["https://*.netsuite.com/*"]);
assert.equal("background" in manifest, false);

const referencedFiles = new Set([
  ...Object.values(manifest.icons),
  manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon)
]);

for (const contentScript of manifest.content_scripts) {
  for (const file of [...(contentScript.css ?? []), ...(contentScript.js ?? [])]) {
    referencedFiles.add(file);
  }
}

for (const file of referencedFiles) {
  await access(resolve(root, file));
}

const popupHtml = await readFile(resolve(root, manifest.action.default_popup), "utf8");
for (const match of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (!reference.startsWith("#")) {
    await access(resolve(root, dirname(manifest.action.default_popup), reference));
  }
}

for (const fixture of ["tests/fixtures/classic.html", "tests/fixtures/redwood.html"]) {
  const html = await readFile(resolve(root, fixture), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (!reference.startsWith("#")) {
      await access(resolve(root, dirname(fixture), reference));
    }
  }
}

const extensionSources = [
  "src/shared/settings.js",
  "src/runtime/theme-runtime.js",
  "src/popup/popup.html",
  "src/popup/popup.css",
  "src/popup/popup.js"
];

for (const file of extensionSources) {
  const source = await readFile(resolve(root, file), "utf8");
  assert.equal(/https?:\/\//.test(source), false, `${file} contains a remote dependency`);
  assert.equal(/SuiteAdvanced|ExtPay|payment|license/i.test(source), false, `${file} crosses the styling-only boundary`);
}

const expectedStyleHashes = {
  "src/styles/font.css": "ecc7a99f6b820ee9290ab4a3ca2ff1ea4829c1a539c0d42becb19a3d5ea446cf",
  "src/styles/code.css": "e5607100c7432fd7028176ce74c4c999e181108861ea6b992ed3058d92d0d698",
  "src/styles/netsuite.css": "56c4251792aa7884469cb6904ae2ce0fa68731db5e9d660ead7bff2144b2af56",
  "src/styles/pages/bundlebuilder.css": "bb9cae83f75b192d0a913233a33b6a8e557df656f7251a6e48e3105532e9f8fa",
  "src/styles/pages/codeeditor.css": "b58efb6517cfc13ca04cb621bdf269599ad9d6a589f38dee268743dda60f84df",
  "src/styles/pages/dashboard.css": "024b4ea648cf4227bdb7fabe762255a36180ce34c8291e1ba0400ee8295d6a68",
  "src/styles/pages/fieldhelp.css": "8515c1f4faff7978138f7d1c4cff631703af0b550c5deb6eb4ea95351bb78e2d",
  "src/styles/pages/file.css": "7932445f8a76bf76b6d9ce6d02bc8d69f071e4c8f600171a8a26c03e8a3eb1b2",
  "src/styles/pages/filecabinet.css": "cac334ebfece700d1f4ab625b120226900c692ded5889e91227d3f266d41b0a5",
  "src/styles/pages/helpcenter.css": "a55d71f695b9e0d3b10208042336e39825812a4851f2fea0271561a07354dd2d",
  "src/styles/pages/login.css": "1fccdd4e23bcea525cae2d97f0b07f570cae3ffc2b008c488cc50efa17699a85",
  "src/styles/pages/pdftemplate.css": "b1494b7aad20982b6fe5e38866c6c733de9a1e0bb356b98e26fdbd24660f991a",
  "src/styles/pages/scripting.css": "fe85ad7e89062db75dcce2b604f6e8c02c1d4aa913ba942a76a341a992d2102c",
  "src/styles/pages/suiteql.css": "a7828bfb563baf36dc1d9b51ddf7b7077e8e8d37471dd0c31544705f69851cda",
  "src/styles/pages/workflow.css": "8c4dee7e097f533613dc10792c29d8465e50288f5498fe82b0942cd1185b115d"
};

for (const [file, expectedHash] of Object.entries(expectedStyleHashes)) {
  const source = await readFile(resolve(root, file));
  const actualHash = createHash("sha256").update(source).digest("hex");
  assert.equal(actualHash, expectedHash, `${file} no longer matches the V1 styling source`);
}

console.log(
  `Verified ${referencedFiles.size} manifest resources, ${Object.keys(expectedStyleHashes).length} V1 style hashes, and the styling-only scope.`
);
