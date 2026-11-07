import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const catalog = JSON.parse(await read("packages/contracts/telemetry.json"));
const coverage = JSON.parse(
  await read("packages/contracts/observability-coverage.json"),
);
const protocol = JSON.parse(await read("packages/contracts/protocol.json"));
const failures = [],
  covered = new Set();
for (const feature of coverage.features) {
  if (
    !feature.name ||
    !feature.events.length ||
    !Object.keys(feature.instrumentation).length
  )
    failures.push("Incomplete feature coverage entry.");
  for (const event of feature.events) {
    if (!Object.hasOwn(catalog.events, event))
      failures.push(`Unknown event in ${feature.name}: ${event}`);
    covered.add(event);
  }
  for (const [platform, instrument] of Object.entries(
    feature.instrumentation,
  )) {
    const source = await read(instrument.path).catch(() => "");
    if (!source.includes(instrument.marker))
      failures.push(
        `Missing instrumentation: ${feature.name}/${platform} in ${instrument.path}`,
      );
  }
}
for (const name of Object.keys(catalog.events))
  if (!covered.has(name))
    failures.push(
      `Register ${name} in observability-coverage.json and describe its feature.`,
    );
for (const action of protocol.editorActions)
  if (!catalog.properties.action.includes(action))
    failures.push(`Editor action ${action} has no telemetry definition.`);
function wrapped(expression) {
  if (!expression) return false;
  if (
    ts.isAwaitExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  )
    return wrapped(expression.expression);
  if (!ts.isCallExpression(expression)) return false;
  return (
    (ts.isIdentifier(expression.expression) &&
      ["api", "observedRoute", "observeRequest"].includes(
        expression.expression.text,
      )) ||
    wrapped(expression.expression)
  );
}
function checkRoute(name, source) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const methods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]);
  for (const node of file.statements) {
    if (
      !node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      continue;
    if (ts.isFunctionDeclaration(node) && methods.has(node.name?.text)) {
      const returns = [];
      function walk(child) {
        if (ts.isFunctionLike(child)) return;
        if (ts.isReturnStatement(child)) returns.push(child);
        ts.forEachChild(child, walk);
      }
      if (node.body) walk(node.body);
      if (
        !returns.length ||
        returns.some((result) => !wrapped(result.expression))
      )
        failures.push(
          `Wrap every path of ${node.name.text} in api()/observedRoute(): ${name}`,
        );
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          methods.has(declaration.name.text) &&
          !wrapped(declaration.initializer)
        )
          failures.push(
            `Wrap ${declaration.name.text} in observedRoute(): ${name}`,
          );
    }
  }
}
async function scan(directory, mode) {
  for (const item of await readdir(new URL(directory, root), {
    withFileTypes: true,
  })) {
    const name = `${directory}/${item.name}`;
    if (
      item.isDirectory() &&
      ![
        "build",
        "DerivedData",
        ".build",
        "Resources",
        "EditorResources",
      ].includes(item.name)
    )
      await scan(name, mode);
    else if (mode === "routes" && item.name === "route.ts") {
      const source = await read(name);
      checkRoute(name, source);
    } else if (
      mode === "client" &&
      /\.tsx?$/.test(item.name) &&
      !item.name.endsWith(".test.ts") &&
      item.name !== "telemetry.ts"
    ) {
      const source = await read(name),
        file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
      let importedFetch = false;
      for (const node of file.statements)
        if (
          ts.isImportDeclaration(node) &&
          /(?:account|telemetry)$/.test(node.moduleSpecifier.text)
        ) {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings))
            importedFetch ||= bindings.elements.some(
              (element) => element.name.text === "fetch",
            );
        }
      function walk(node) {
        if (ts.isCallExpression(node)) {
          const fn = node.expression;
          if (
            (ts.isIdentifier(fn) && fn.text === "fetch" && !importedFetch) ||
            (ts.isPropertyAccessExpression(fn) &&
              fn.name.text === "fetch" &&
              ["window", "globalThis"].includes(fn.expression.getText(file)))
          )
            failures.push(
              `Use accountFetch/telemetryFetch for client transport: ${name}:${file.getLineAndCharacterOfPosition(node.pos).line + 1}`,
            );
        }
        ts.forEachChild(node, walk);
      }
      walk(file);
    } else if (
      mode === "native" &&
      item.name.endsWith(".swift") &&
      item.name !== "Telemetry.swift"
    ) {
      if (/\.data\(for:/.test(await read(name)))
        failures.push(`Use Telemetry.network for native transport: ${name}`);
    }
  }
}
await scan("apps/web/app/api", "routes");
await scan("apps/web/components", "client");
await scan("apps/web/lib/client", "client");
await scan("apps/ios/Shared", "native");
await scan("apps/ios/Doompile", "native");
await scan("apps/ios/Share", "native");
await scan("apps/macos/Doompile", "native");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Observability: ${coverage.features.length} features, ${covered.size} events, every API handler, client transports and editor actions checked.`,
  );
