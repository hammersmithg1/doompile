import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
const [archive, platform] = process.argv.slice(2);
if (!archive || !["macos", "ios"].includes(platform))
  throw new Error(
    "Usage: node scripts/release-manifest.mjs <archive> <macos|ios>",
  );
const protocol = JSON.parse(
  await readFile(
    new URL("../packages/contracts/protocol.json", import.meta.url),
    "utf8",
  ),
);
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const bytes = await readFile(archive);
const manifest = {
  platform,
  version: pkg.version,
  build: platform === "macos" && process.env.DOOMPILE_MACOS_BUILD_NUMBER
    ? process.env.DOOMPILE_MACOS_BUILD_NUMBER
    : process.env.DOOMPILE_IOS_BUILD_NUMBER || `${process.env.GITHUB_RUN_NUMBER || 1}.${process.env.GITHUB_RUN_ATTEMPT || 1}`,
  commit:
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  apiVersion: protocol.apiVersion,
  documentVersion: protocol.documentVersion,
  file: basename(archive),
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
await writeFile(
  join(dirname(archive), "release.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
