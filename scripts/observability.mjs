import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { catalog, validateEvent } from "../packages/telemetry/core.ts";

export function summarizeDump(input, traceID) {
  if (
    input?.format !== "doompile-diagnostics" ||
    input.schema_version !== catalog.version ||
    !Array.isArray(input.events)
  )
    throw new Error("Unsupported diagnostics format or version.");
  const valid = input.events.slice(0, 10000).map(validateEvent).filter(Boolean);
  const events = valid
    .filter((event) => !traceID || event.trace_id === traceID)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const counts = new Map();
  for (const event of events) {
    const key = `${event.platform}:${event.name}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return {
    schema_version: catalog.version,
    events: events.length,
    rejected_events: input.events.length - valid.length,
    period: {
      from: events[0]?.timestamp || null,
      to: events.at(-1)?.timestamp || null,
    },
    coverage: {
      devices: new Set(events.map((event) => event.device_id)).size,
      sessions: new Set(events.map((event) => event.session_id)).size,
    },
    dropped_pending: Number.isSafeInteger(input.health?.dropped)
      ? input.health.dropped
      : null,
    counts: Object.fromEntries(
      [...counts.entries()].sort((a, b) => b[1] - a[1]),
    ),
    errors: events.filter((event) => event.level === "error").slice(-100),
    ...(traceID ? { trace: events } : {}),
  };
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (key) => {
    const index = args.indexOf(`--${key}`);
    return index < 0 ? undefined : args[index + 1];
  };
  const traceID = option("trace");
  if (traceID && !/^[0-9a-f]{32}$/.test(traceID))
    throw new Error("--trace must be a 32-character hexadecimal trace ID.");
  if (command === "catalog") return catalog;
  if (command === "dump") {
    const file = args[0];
    if (!file || file.startsWith("--"))
      throw new Error(
        "Usage: npm run observability -- dump /absolute/diagnostics.json [--trace ID]",
      );
    if ((await stat(file)).size > 25 * 1024 * 1024)
      throw new Error("Diagnostics file is too large.");
    return summarizeDump(JSON.parse(await readFile(file, "utf8")), traceID);
  }
  if (!["summary", "events"].includes(command))
    throw new Error(
      "Usage: npm run observability -- catalog | dump FILE | summary [--all] | events [--all] [--trace ID] [--after CURSOR] [--limit 100]",
    );
  const origin = new URL(
    process.env.DOOMPILE_PUBLIC_URL || "http://localhost:3000",
  );
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Use an HTTPS server URL or local development server.");
  const token = process.env.DOOMPILE_OBSERVABILITY_TOKEN;
  if (!token)
    throw new Error(
      "Load DOOMPILE_OBSERVABILITY_TOKEN through the setec wrapper.",
    );
  const url = new URL("/api/telemetry", origin);
  if (args.includes("--all")) url.searchParams.set("scope", "all");
  if (command === "summary") {
    url.searchParams.set("view", "summary");
    if (option("days")) url.searchParams.set("days", option("days"));
  } else {
    for (const [key, value] of [
      ["trace_id", traceID],
      ["after", option("after")],
      ["limit", option("limit")],
      ["level", option("level")],
      ["name", option("name")],
    ])
      if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Observability request returned HTTP ${response.status}.`);
  const result = await response.json();
  if (command === "events")
    result.events = result.events.flatMap((row) => {
      const event = validateEvent(row.event);
      return event
        ? [
            {
              cursor: row.cursor,
              received_at: row.received_at,
              actor_id: row.actor_id,
              source: row.source,
              event,
            },
          ]
        : [];
    });
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((result) =>
      process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
    )
    .catch((error) => {
      process.stderr.write(error.message + "\n");
      process.exitCode = 1;
    });
}
