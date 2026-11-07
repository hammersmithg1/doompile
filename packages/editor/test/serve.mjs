import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const bundle = await build({
  entryPoints: ["packages/editor/test/harness.ts"],
  write: false,
  bundle: true,
  format: "iife",
  target: "safari17",
});
createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="/editor.css"><style>#editor{max-width:850px;margin:auto}</style></head><body><div id="editor"></div><script src="/test.js"></script></body></html>',
    );
    return;
  }
  const name = req.url?.slice(1);
  if (name === "test.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].contents);
    return;
  }
  if (
    ![
      "test.js",
      "editor.js",
      "editor.html",
      "editor.css",
      "blocks.css", "media.css", "tokens.css",
    ].includes(name)
  ) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      name.endsWith("css")
        ? "text/css"
        : name.endsWith("html")
          ? "text/html"
          : "text/javascript",
    );
    res.end(await readFile(`packages/editor/dist/${name}`));
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.DOOMPILE_EDITOR_TEST_PORT || 4175), "127.0.0.1");
