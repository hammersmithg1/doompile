import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = async (file) => readFile(new URL(file, root), "utf8");
const brand = JSON.parse(await read("packages/design/brand.json"));
const registry = JSON.parse(await read("packages/design/icons.json"));
const failures = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);
if (brand.copy.motto !== `${brand.copy.capture} ${brand.copy.forget}`)
  fail("brand.json", "The two hero lines must form the shared brand motto.");
if (brand.illustrations.includes("pile"))
  fail(
    "brand.json",
    "The active identity uses the void; the v1 pile artwork is archived.",
  );
for (const [key, value] of Object.entries(brand.copy))
  if (/[А-Яа-яЁё]/.test(value))
    fail("brand.json", `Brand copy must be English: ${key}`);
for (const [key, value] of Object.entries(brand.ui))
  if (!/[А-Яа-яЁё]/.test(value))
    fail("brand.json", `Interface copy must be Russian: ${key}`);
if (registry.native.pin !== "pin" || registry.native["pin.fill"] !== "pin")
  fail("icons.json", "Pinning must use the pin glyph on every platform.");
for (const [alias, id] of Object.entries(registry.native))
  if (!registry.icons[id])
    fail("icons.json", `Missing icon for native alias ${alias}: ${id}`);
for (const [id, icon] of Object.entries(registry.icons))
  if (!icon.label || !/[А-Яа-яЁё]/.test(icon.label))
    fail("icons.json", `Missing Russian accessibility label: ${id}`);
const skip = new Set([
  "node_modules",
  "dist",
  "build",
  "test",
  "Tests",
  "UITests",
  "EditorResources",
  "Resources",
]);
async function files(folder) {
  const result = [];
  for (const item of await readdir(new URL(folder + "/", root), {
    withFileTypes: true,
  })) {
    if (item.name.startsWith(".") || skip.has(item.name)) continue;
    const name = folder + "/" + item.name;
    if (item.isDirectory()) result.push(...(await files(name)));
    else if (
      /\.(tsx?|js|swift)$/.test(name) &&
      !/\.generated\.|\.test\./.test(name)
    )
      result.push(name);
  }
  return result;
}
// Brand phrases belong in the registry. Technical names and shortcuts are not prose.
const technical = new Set([
  "Doompile",
  "Safari",
  "Google",
  "YouTube",
  "macOS",
  "iOS",
  "iPhone",
  "Mac",
  "URL",
  "HTTPS",
  "HTTP",
  "API",
  "JSON",
  "PDF",
  "SQLite",
  "Keychain",
  "Enter",
  "Return",
  "Shift",
  "Ctrl",
  "Alt",
  "Escape",
  "Space",
  "Tab",
  "Delete",
  "Backspace",
  "Esc",
  "Cmd",
  "F",
  "B",
  "I",
  "U",
  "S",
  "K",
  "v0.1",
  "Aa",
]);
function checkCopy(file, value, line) {
  const plain = value.replace(/\\\([^)]*\)/g, "").trim();
  if (!plain || /[А-Яа-яЁё]/.test(plain) || !/[A-Za-z]{2,}/.test(plain)) return;
  if (/^https?:\/\//.test(plain)) return;
  if (technical.has(plain) || /^[\d\s.,:/+−⌘⇧⌥^A-Z]$/.test(plain)) return;
  fail(
    file,
    `English interface literal at line ${line}: ${plain.slice(0, 100)}. Use Russian UI copy or an approved brandCopy key.`,
  );
}
const roots = [
  "apps/web/components",
  "packages/editor/src",
  "extensions/clipper/src",
  "apps/ios/Doompile",
  "apps/ios/Share",
  "apps/ios/Shared",
  "apps/macos/Doompile",
  "apps/macos/Support",
];
for (const file of (await Promise.all(roots.map(files))).flat()) {
  const source = await read(file);
  if (/kind=["']pile["']|["']dp-pile["']/.test(source))
    fail(
      file,
      "Use the void identity instead of the retired pile illustration.",
    );
  if (/from\s*["']lucide-react["']/.test(source))
    fail(file, "Import icons from packages/design/ui-icons.");
  if (/<path\b[^>]*\bd=["']M|setAttribute\(["']d["'],\s*["']M/.test(source))
    fail(
      file,
      "Store static icon geometry in packages/design/icons.json and use the shared renderer.",
    );
  if (/\bStar\b|["']star(?:\.fill)?["']/.test(source))
    fail(
      file,
      "A star must not represent pinned notes. Use the registered pin icon.",
    );
  if (file.endsWith(".swift")) {
    const expression =
      /\b(?:Text|Button|DoompileLabel|TextField|SecureField|ProgressView|Section|LabeledContent|accessibilityLabel|help|message)\("([^"\n]+)"/g;
    for (const match of source.matchAll(expression))
      checkCopy(
        file,
        match[1],
        source.slice(0, match.index).split("\n").length,
      );
    continue;
  }
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : file.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS,
  );
  const at = (node) =>
    ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  function visit(node) {
    if (ts.isJsxText(node)) checkCopy(file, node.text, at(node));
    if (
      ts.isJsxAttribute(node) &&
      ["placeholder", "aria-label", "title", "alt"].includes(
        node.name.getText(ast),
      ) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      checkCopy(file, node.initializer.text, at(node));
    if (
      ts.isBinaryExpression(node) &&
      ts.isPropertyAccessExpression(node.left) &&
      ["textContent", "placeholder", "title"].includes(node.left.name.text) &&
      ts.isStringLiteral(node.right) &&
      !/style/i.test(node.left.expression.getText(ast))
    )
      checkCopy(file, node.right.text, at(node));
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const manifest = JSON.parse(await read("apps/web/public/manifest.webmanifest"));
if (manifest.lang !== "ru")
  fail("manifest.webmanifest", "The application interface locale is ru.");
for (const icon of manifest.icons)
  await readFile(new URL(`apps/web/public${icon.src}`, root)).catch(() =>
    fail("manifest.webmanifest", `Missing PWA icon ${icon.src}`),
  );
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Design rules passed: language, icon semantics, shared imports and PWA assets.",
  );
