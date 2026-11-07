// Explicitly import geometry from the installed, licensed Lucide version.
// Existing icons are preserved. Run design:generate and review all consumers next.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as lucide from "lucide-react";
const file = fileURLToPath(
  new URL("../packages/design/icons.json", import.meta.url),
);
const registry = JSON.parse(await readFile(file, "utf8"));
const [name, flag, label] = process.argv.slice(2);
if (!name || flag !== "--label" || !label || !/[А-Яа-яЁё]/.test(label))
  throw new Error(
    "Usage: node scripts/add-design-icon.mjs LockKeyhole --label 'Доступ'",
  );
{
  if (!lucide[name]) throw new Error(`Unknown Lucide icon: ${name}`);
  const id = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  if (registry.icons[id])
    throw new Error(`Icon ${id} already exists; use the registered icon.`);
  const markup = renderToStaticMarkup(React.createElement(lucide[name]));
  const nodes = [
    ...markup.matchAll(
      /<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]+)>/g,
    ),
  ].map((m) => [
    m[1],
    Object.fromEntries(
      [...m[2].matchAll(/([\w-]+)="([^"]*)"/g)]
        .filter((a) => a[1] !== "key")
        .map((a) => [a[1], a[2]]),
    ),
  ]);
  if (!nodes.length) throw new Error(`Missing geometry: ${name}`);
  registry.icons[id] = { react: name, nodes, label };
}
await writeFile(file, JSON.stringify(registry, null, 2) + "\n");
