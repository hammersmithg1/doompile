import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const root = new URL("./", import.meta.url);
const output = new URL("./dist/", root);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [new URL("./src/editor.ts", root).pathname],
  outfile: new URL("./editor.js", output).pathname,
  bundle: true,
  minify: true,
  format: "iife",
  target: "safari17",
  legalComments: "eof",
});
await build({
  entryPoints: [new URL("../sync/native.ts", root).pathname],
  outfile: new URL("./sync.js", output).pathname,
  bundle: true, minify: true, format: "iife", globalName: "DoompileSync", target: "safari17", legalComments: "eof",
});
await mkdir(new URL("../../apps/ios/Shared/Resources/", root), { recursive: true });
await copyFile(new URL("./sync.js", output), new URL("../../apps/ios/Shared/Resources/sync.js", root));
for (const name of ["editor.html", "editor.css", "blocks.css", "media.css"])
  await copyFile(new URL(`./src/${name}`, root), new URL(`./${name}`, output));
await copyFile(new URL("../design/tokens.generated.css", root), new URL("./tokens.css", output));
console.log("Built offline editor: packages/editor/dist");
