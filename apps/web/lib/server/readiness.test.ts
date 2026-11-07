import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "../../app/api/health/route";
import { identities } from "./identity";
test("readiness fails when the durable database cannot be opened", async () => {
  const directory = mkdtempSync(join(tmpdir(), "doompile-readiness-"));
  const previous = process.env.DOOMPILE_DATA_DIR;
  try {
    const invalid = join(directory, "not-a-directory");
    writeFileSync(invalid, "blocked");
    process.env.DOOMPILE_DATA_DIR = invalid;
    assert.equal(GET().status, 503);
    process.env.DOOMPILE_DATA_DIR = directory;
    const healthy = GET();
    assert.equal(healthy.status, 200);
    assert.equal((await healthy.json()).status, "ok");
    identities().close();
  } finally {
    if (previous === undefined) delete process.env.DOOMPILE_DATA_DIR;
    else process.env.DOOMPILE_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
