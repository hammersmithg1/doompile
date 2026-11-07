import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const read = (name) => readFile(path.join(root, name));
const brand = JSON.parse(await read("packages/design/brand.json"));
const registry = JSON.parse(await read("packages/design/icons.json"));
for (const [name, icon] of Object.entries(registry.icons)) {
  if (!icon.label || !/[А-Яа-яЁё]/.test(icon.label))
    throw new Error(
      `Icon ${name} needs a Russian accessibility label in icons.json.`,
    );
}
const tokens = JSON.parse(await read("packages/design/tokens.json"));
const outputs = new Map();
const put = (name, content) => outputs.set(name, Buffer.from(content));
const svg = (body, box = "0 0 128 128") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>\n`;
const inner = (value) =>
  value.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const raster = (source, width) =>
  new Resvg(source, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
const iconSVG = (entry) =>
  svg(
    `<g fill="none" stroke="#000" stroke-width="${brand.iconStyle.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${entry.nodes
      .map(
        ([tag, attrs]) =>
          `<${tag} ${Object.entries(attrs)
            .map(([k, v]) => `${k}="${v}"`)
            .join(" ")}/>`,
      )
      .join("")}</g>`,
    brand.iconStyle.viewBox,
  );
const catalog = "packages/design/BrandAssets.xcassets";
const imageSet = (name, filename, bytes, template = true) => {
  put(`${catalog}/${name}.imageset/${filename}`, bytes);
  put(
    `${catalog}/${name}.imageset/Contents.json`,
    JSON.stringify(
      {
        images: [{ filename, idiom: "universal" }],
        info: { author: "xcode", version: 1 },
        properties: {
          "preserves-vector-representation": true,
          ...(template ? { "template-rendering-intent": "template" } : {}),
        },
      },
      null,
      2,
    ) + "\n",
  );
};
put(`${catalog}/Contents.json`, '{"info":{"author":"xcode","version":1}}\n');

const mark = (await read("packages/design/mark.svg")).toString();
const small = (await read("packages/design/mark-small.svg")).toString();
const halo = (await read("packages/design/halo.svg")).toString();
const appSVG = svg(
  `<rect width="128" height="128" fill="${brand.colors.void}"/>${inner(mark)}`,
);
const macSVG = svg(
  `<rect x="8" y="8" width="112" height="112" rx="25" fill="${brand.colors.void}"/><g transform="translate(8 8) scale(.875)">${inner(mark)}</g>`,
);
// Detailed collage for app icons; optical vector glyph for favicon/toolbar sizes.
const appArtwork = await read(`packages/design/${brand.appIcon.artwork}`);
const artworkData = `data:image/png;base64,${appArtwork.toString("base64")}`;
const appRasterSVG = svg(
  `<image href="${artworkData}" width="128" height="128"/>`,
);
const macClip =
  '<defs><clipPath id="mac-mask"><rect x="8" y="8" width="112" height="112" rx="25"/></clipPath></defs>';
const macRasterSVG = svg(
  `${macClip}<image href="${artworkData}" x="8" y="8" width="112" height="112" clip-path="url(#mac-mask)"/>`,
);
const smallColor = small
  .replace(
    "<svg ",
    `<svg width="128" height="128" color="${brand.colors.paper}" `,
  )
  .replace('data-part="rim"', `data-part="rim" stroke="${brand.colors.lime}"`);
const faviconSVG = svg(
  `<rect width="128" height="128" fill="${brand.colors.void}"/>${smallColor}`,
);
const smallMacSVG = svg(
  `${macClip}<g clip-path="url(#mac-mask)"><g transform="translate(8 8) scale(.875)">${inner(faviconSVG)}</g></g>`,
);
const toolbarSVG = small.replace("currentColor", "#000");
put("packages/design/dist/app.svg", appSVG);
put("packages/design/dist/app-macos.svg", macSVG);
put("packages/design/dist/toolbar.svg", toolbarSVG);
put("packages/design/dist/favicon.svg", faviconSVG);
put("apps/web/public/icon.svg", faviconSVG);
imageSet("dp-halo", "halo.svg", halo.replace("currentColor", "#000"));
imageSet("dp-mark", "mark.svg", small.replace("currentColor", "#000"));

// Outline the wordmark once from the vendored OFL font. No platform font substitution.
const bytes = await read(`packages/design/${brand.wordmark.source}`);
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const wordPath = font.getPath(brand.name, 0, 100, 100, {
  kerning: true,
  letterSpacing: brand.wordmark.letterSpacing,
});
const bounds = wordPath.getBoundingBox();
const width = Math.ceil(bounds.x2 - bounds.x1);
const height = Math.ceil(bounds.y2 - bounds.y1);
const wordmark = svg(
  `<g transform="translate(${-bounds.x1.toFixed(2)} ${-bounds.y1.toFixed(2)})" fill="currentColor"><path d="${wordPath.toPathData(2)}"/></g>`,
  `0 0 ${width} ${height}`,
);
put("packages/design/dist/wordmark.svg", wordmark);
put(
  "packages/design/artwork.generated.ts",
  `// Generated by scripts/generate-design.mjs.\nexport const haloArtwork = ${JSON.stringify({ viewBox: "0 0 90 36", content: inner(halo) })};\nexport const wordmarkArtwork = ${JSON.stringify({ viewBox: `0 0 ${width} ${height}`, content: inner(wordmark) })};\n`,
);
put("apps/web/public/brand/wordmark.svg", wordmark);
imageSet(
  "dp-wordmark",
  "wordmark.svg",
  wordmark.replace("currentColor", "#000"),
);
const lockup = svg(
  `<g transform="translate(0 6)">${inner(wordmark)}</g><g transform="translate(${width + 6} 0) scale(.68)" color="${brand.colors.lime}">${inner(halo)}</g>`,
  `0 0 ${width + 70} ${height + 6}`,
);
put("packages/design/dist/lockup.svg", lockup);

for (const size of [16, 32, 48, 64, 96, 128, 192, 256, 512, 1024]) {
  const appPNG = raster(size <= 32 ? faviconSVG : appRasterSVG, size);
  const macPNG = raster(size <= 32 ? smallMacSVG : macRasterSVG, size);
  put(`packages/design/dist/app-${size}.png`, appPNG);
  put(`packages/design/dist/app-macos-${size}.png`, macPNG);
  if (size !== 48 && size !== 96 && size !== 192)
    put(
      `apps/macos/Doompile/Assets.xcassets/AppIcon.appiconset/icon-${size}.png`,
      macPNG,
    );
  if ([32, 192, 512].includes(size))
    put(`apps/web/public/brand/app-${size}.png`, appPNG);
}
put(
  "apps/ios/Doompile/Assets.xcassets/AppIcon.appiconset/AppIcon.png",
  raster(appRasterSVG, 1024),
);
put(
  "apps/ios/Doompile/Assets.xcassets/LaunchBackground.colorset/Contents.json",
  JSON.stringify(
    {
      colors: tokens.colors.background.map((hex, mode) => ({
        idiom: "universal",
        ...(mode
          ? { appearances: [{ appearance: "luminosity", value: "dark" }] }
          : {}),
        color: {
          "color-space": "srgb",
          components: {
            ...Object.fromEntries(
              ["red", "green", "blue"].map((key, i) => [
                key,
                (parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255).toFixed(
                  3,
                ),
              ]),
            ),
            alpha: "1.000",
          },
        },
      })),
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  ) + "\n",
);
for (const size of [16, 19, 32, 38, 64, 128])
  put(`packages/design/dist/toolbar-${size}.png`, raster(toolbarSVG, size));
for (const [scale, suffix] of [
  [2, "@2x"],
  [3, "@3x"],
])
  put(
    `apps/ios/Action/SaveAction${suffix}.png`,
    raster(toolbarSVG, 30 * scale),
  );

for (const [name, entry] of Object.entries(registry.icons)) {
  const source = iconSVG(entry);
  put(`packages/design/dist/icons/${name}.svg`, source);
  imageSet(`dp-${name}`, `${name}.svg`, source);
}

for (const name of brand.illustrations) {
  const original = await read(`packages/design/illustrations/${name}.png`);
  const source = svg(
    `<image href="data:image/png;base64,${original.toString("base64")}" width="1280" height="1280"/>`,
    "0 0 1280 1280",
  );
  const optimized = raster(source, 512);
  put(`apps/web/public/brand/${name}.png`, optimized);
  imageSet(`dp-${name}`, `${name}.png`, optimized, false);
}

const banner =
  "// Generated by scripts/generate-design.mjs. Edit packages/design sources.\n";
const aliases = { ImageIcon: "image", Globe: "globe2" };
const exports = [
  ...Object.entries(registry.icons).map(([id, icon]) => [icon.react, id]),
  ...Object.entries(aliases),
];
put(
  "packages/design/ui-icons.tsx",
  `${banner}import { createElement, type SVGProps } from "react";\nimport { iconNodes, type IconNode, type IconName } from "./icons";\nexport type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; absoluteStrokeWidth?: boolean };\nfunction glyph(name: IconName) {\n  return function Icon({ size = 20, strokeWidth = ${brand.iconStyle.strokeWidth}, absoluteStrokeWidth, ...props }: IconProps) {\n    return createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, ...(absoluteStrokeWidth ? { vectorEffect: "non-scaling-stroke" } : {}), ...props }, ...(iconNodes[name].nodes as IconNode[]).map(([tag, attrs], key) => createElement(tag, { ...Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])), key })));\n  };\n}\n${exports.map(([name, id]) => `export const ${name} = glyph(${JSON.stringify(id)});`).join("\n")}\n`,
);
put(
  "packages/design/copy.ts",
  `${banner}import brand from "./brand.json";\nexport const brandCopy = brand.copy;\nexport const uiCopy = brand.ui;\n`,
);
put(
  "extensions/clipper/src/design.generated.js",
  `${banner}globalThis.DoompileDesign = ${JSON.stringify({ brand: brand.copy, ui: brand.ui, icons: Object.fromEntries(Object.entries(registry.icons).map(([id, icon]) => [id, icon.nodes])), strokeWidth: brand.iconStyle.strokeWidth })};\n`,
);
put(
  "apps/ios/Shared/Brand.generated.swift",
  `${banner}import SwiftUI\n\nenum BrandCopy {\n${Object.entries(brand.copy)
    .map(([k, v]) => `    static let ${k} = ${JSON.stringify(v)}`)
    .join("\n")}\n}\nenum UICopy {\n${Object.entries(brand.ui)
    .map(([k, v]) => `    static let ${k} = ${JSON.stringify(v)}`)
    .join(
      "\n",
    )}\n}\n\nstruct DoompileSymbol: View {\n    let systemName: String\n    var size: CGFloat = 18\n    private static let aliases: [String: String] = [\n${Object.entries(
    registry.native,
  )
    .map(([k, v]) => `        ${JSON.stringify(k)}: "dp-${v}"`)
    .join(
      ",\n",
    )}\n    ]\n    private static let labels: [String: String] = [\n${Object.entries(
    registry.icons,
  )
    .map(
      ([key, value]) => `        "dp-${key}": ${JSON.stringify(value.label)}`,
    )
    .join(
      ",\n",
    )}\n    ]\n    var body: some View {\n        Group {\n            if let asset = Self.aliases[systemName] {\n                Image(asset).renderingMode(.template).resizable().aspectRatio(contentMode: .fit).frame(width: size, height: size).accessibilityLabel(Self.labels[asset] ?? "")\n            } else { Image(systemName: systemName) }\n        }\n    }\n}\n\nstruct DoompileLabel: View {\n    let title: String\n    let systemImage: String\n    init(_ title: String, systemImage: String) { self.title = title; self.systemImage = systemImage }\n    var body: some View { Label { Text(title) } icon: { DoompileSymbol(systemName: systemImage).accessibilityHidden(true) } }\n}\n\nstruct DoompileWordmark: View {\n    var height: CGFloat = 28\n    var body: some View { Image("dp-wordmark").renderingMode(.template).resizable().aspectRatio(contentMode: .fit).frame(height: height).accessibilityLabel("Doompile") }\n}\nstruct DoompileHalo: View {\n    var width: CGFloat = 42\n    var body: some View { Image("dp-halo").renderingMode(.template).resizable().aspectRatio(contentMode: .fit).frame(width: width).foregroundStyle(DesignTokens.brand).accessibilityHidden(true) }\n}\n`,
);

const escapeHTML = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
put(
  "docs/design/preview.html",
  `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Doompile · Design system</title>
<style>:root{color-scheme:light;--bg:#f7f5f2;--surface:#fffefd;--text:#191a23;--muted:#66646c;--line:#e7e4e0;--accent:#6a7d22}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}body.dark{color-scheme:dark;--bg:#161617;--surface:#1e1e20;--text:#efedef;--muted:#a7a3ab;--line:#303033;--accent:#cff641}main{max-width:1040px;margin:auto;padding:40px 24px}header{display:flex;align-items:center;justify-content:space-between;gap:24px}h1,h2,p{margin:0}h1{font-size:20px}h2{margin:36px 0 16px;font-size:16px}.muted{color:var(--muted)}button{font:inherit;color:var(--text);border:1px solid var(--line);background:var(--surface);padding:8px 14px;border-radius:9px;cursor:pointer}.identity{display:flex;flex-wrap:wrap;gap:32px;align-items:center;margin-top:30px}.logo{display:flex;gap:12px;align-items:center}.logo svg:first-child{width:240px;height:auto}.logo svg:last-child{color:var(--accent);width:55px}.sizes{display:flex;flex-wrap:wrap;gap:20px;align-items:center}.mono-examples{margin-top:20px}.dark .mono-examples img{filter:invert(1)}.sizes img{height:auto}.icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}.glyph{background:var(--bg);display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 4px;font-size:11px}.glyph svg{width:24px;height:24px}.art{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.art img{width:100%;height:auto}.art figure{margin:0}.art figcaption{color:var(--muted);text-align:center;font-size:13px}.copy{display:grid;grid-template-columns:1fr 1fr;gap:24px}.copy p{margin:10px 0}.sample{padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:12px}.sample button{background:#cff641;color:#191a23;border:0;margin-top:14px}.sample small{display:block;color:var(--muted)}@media(max-width:600px){main{padding:24px 16px}.logo svg:first-child{width:170px}.art,.copy{grid-template-columns:1fr}.art img{max-width:240px;display:block;margin:auto}}</style>
<body><main><header><h1>Doompile · система v${brand.version}</h1><button id="theme" type="button" aria-pressed="false">Тёмная тема</button></header><p class="muted">Бренд — на английском. Интерфейс — на русском.</p>
<section class="identity"><div class="logo">${wordmark}${halo}</div><div class="sizes">${[16, 32, 64, 128].map((size) => `<img alt="Знак ${size} пикселей" src="../../packages/design/dist/app-${size}.png" width="${size}" height="${size}">`).join("")}</div></section>
<div class="sizes mono-examples"><span class="muted">Монохромный знак · 16 / 32 px</span>${[16, 32].map((size) => `<img alt="Монохромная воронка ${size} пикселей" src="../../packages/design/dist/toolbar-${size}.png" width="${size}" height="${size}">`).join("")}</div>
<h2>Графика бренда</h2><div class="art"><figure><img alt="App icon" src="../../packages/design/dist/app-512.png" width="512" height="512"><figcaption>App icon</figcaption></figure>${brand.illustrations.map((name) => `<figure><img alt="${name}" src="../../apps/web/public/brand/${name}.png" width="512" height="512"><figcaption>${name}</figcaption></figure>`).join("")}</div>
<h2>Голос бренда и интерфейс</h2><div class="copy"><div>${Object.entries(
    brand.copy,
  )
    .map(
      ([key, value]) =>
        `<p><small class="muted">${key}</small><br>${escapeHTML(value)}</p>`,
    )
    .join(
      "",
    )}</div><div class="sample"><h3>${brand.copy.motto}</h3><p>${brand.ui.emptyBody}</p><button type="button">${brand.ui.save}</button><p>${brand.copy.saved}</p><small>${brand.ui.savedLocal}</small></div></div>
<h2>Общие пиктограммы · ${Object.keys(registry.icons).length}</h2><div class="icons">${Object.entries(
    registry.icons,
  )
    .map(
      ([name, entry]) =>
        `<div class="glyph">${iconSVG(entry).replace('stroke="#000"', 'stroke="currentColor"')}<span>${name}</span></div>`,
    )
    .join("")}</div>
<p class="muted" style="margin-top:24px">Исходники: packages/design · Обновление: npm run shared:generate · Проверка: npm run shared:check</p></main><script>document.getElementById('theme').addEventListener('click',function(){const dark=document.body.classList.toggle('dark');this.setAttribute('aria-pressed',String(dark));this.textContent=dark?'Светлая тема':'Тёмная тема';});</script></body></html>\n`,
);

// Every exported asset is covered, including binary exports; CI detects stale copies.
put(
  "packages/design/dist/manifest.json",
  JSON.stringify(
    {
      version: brand.version,
      files: Object.fromEntries(
        [...outputs].map(([name, data]) => [
          name,
          createHash("sha256").update(data).digest("hex"),
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
let stale = 0;
for (const [name, content] of outputs) {
  const filename = path.join(root, name);
  const current = await readFile(filename).catch(() => null);
  if (current?.equals(content)) continue;
  if (check) {
    console.error(`Design export is stale: ${name}`);
    stale++;
  } else {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
}
if (stale) process.exitCode = 1;
else
  console.log(
    `${check ? "Checked" : "Generated"} ${outputs.size} design exports (${Object.keys(registry.icons).length} icons, ${brand.illustrations.length} illustrations).`,
  );
