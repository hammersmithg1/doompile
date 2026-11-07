import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [kind, rawPort] = process.argv.slice(2);
if (
  !["editor", "mobile"].includes(kind) ||
  !/^\d+$/.test(rawPort || "") ||
  Number(rawPort) < 1024 ||
  Number(rawPort) > 65535
) {
  throw new Error(
    "Usage: node scripts/test-web-server.mjs <editor|mobile> <port>",
  );
}
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "doompile-ui-"));
const child = spawn(
  process.execPath,
  [
    join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "apps/web",
    "--hostname",
    "127.0.0.1",
    "--port",
    rawPort,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DOOMPILE_DATA_DIR: directory,
      DOOMPILE_STORAGE: "filesystem",
      DOOMPILE_DEV_LOGIN: "",
      DOOMPILE_PUBLIC_URL: `http://127.0.0.1:${rawPort}`,
      DOOMPILE_ALLOWED_ORIGINS: "",
      DOOMPILE_APPLE_APP_IDS: "",
      DOOMPILE_BUILD_DIR: "",
      DOOMPILE_EDITOR_TEST: kind === "editor" ? "1" : "",
      DOOMPILE_MOBILE_TEST: kind === "mobile" ? "1" : "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    shuttingDown = true;
    child.kill(signal);
  });
const result = await new Promise((resolve, reject) => {
  child.once("exit", (code, signal) => resolve({ code, signal }));
  child.once("error", reject);
}).finally(() => rm(directory, { recursive: true, force: true }));
process.exitCode = result.signal ? (shuttingDown ? 0 : 1) : (result.code ?? 1);
