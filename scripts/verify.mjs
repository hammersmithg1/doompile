import { spawnSync } from "node:child_process";

const mode = process.argv[2] || "web";
if (!["web", "ui", "native", "all"].includes(mode))
  throw new Error("Usage: npm run verify -- [web|ui|native|all]");
function run(command, args, env = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run("npm", ["run", "shared:check"]);
run("npm", ["run", "observability:check"]);
if (mode === "web" || mode === "all") {
  run("npm", ["run", "typecheck"]);
  run("npm", ["test"]);
  run("python3", [
    "-m",
    "unittest",
    "discover",
    "-s",
    "infra",
    "-p",
    "*test.py",
  ]);
  // Keep the Safari folder a user may have loaded untouched.
  run("node", [
    "extensions/clipper/build.mjs",
    "--out-dir",
    "extensions/clipper/.test-build",
  ]);
  run("npm", ["run", "editor:build"]);
  run("npm", ["run", "build"], {
    DOOMPILE_BUILD_DIR: ".next-verify",
  });
}
if (mode === "ui" || mode === "all") {
  const reporter = process.env.CI ? ["--", "--reporter=line"] : [];
  run("npm", ["run", "test:editor", ...reporter]);
  run("npm", ["run", "test:mobile", ...reporter]);
  run("npm", ["run", "test:clipper", ...reporter], { DOOMPILE_CLIPPER_ISOLATED_TEST: "1" });
}
if (mode === "native" || mode === "all") {
  if (process.platform !== "darwin")
    throw new Error(
      "Native checks need macOS/Xcode. A Linux devbox runs web/ui checks and delegates native checks to CI.",
    );
  run("bash", ["scripts/verify-native.sh"]);
}
