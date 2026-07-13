import { build } from "esbuild";

await build({
  entryPoints: ["src/suiteql/studio-entry.js"],
  outfile: "dist/suiteql-studio.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info"
});
