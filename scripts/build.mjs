import { build } from "esbuild";

const sharedOptions = {
  bundle: true,
  target: ["chrome120"],
  minify: true,
  legalComments: "eof",
  logLevel: "info"
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ["src/suiteql/studio-entry.js"],
    outfile: "dist/suiteql-studio.js"
  }),
  build({
    ...sharedOptions,
    entryPoints: ["src/palette/material-palette.js"],
    outfile: "dist/material-palette.js"
  })
]);
