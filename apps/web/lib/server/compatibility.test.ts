import { testEnvironment } from "./test-accounts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { API_VERSION } from "@doompile/core";
import { api } from "./http";
import { corsHeaders } from "./auth";

test("legacy and current clients work; a future protocol cannot accidentally mutate data", async () => {
  const fixture = testEnvironment();
  const account = fixture.account();
  try {
    for (const version of [
      undefined,
      String(API_VERSION),
      String(API_VERSION + 1),
      "invalid",
    ]) {
      let called = false;
      const response = await api(
        new Request("https://notes.example/api/notes", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${account.token}`,
            ...(version ? { "X-Doompile-API-Version": version } : {}),
          },
        }),
        () => {
          called = true;
          return Response.json({ ok: true });
        },
      );
      const compatible =
        version === undefined || version === String(API_VERSION);
      assert.equal(called, compatible);
      assert.equal(response.status, compatible ? 200 : 426);
      assert.equal(
        response.headers.get("X-Doompile-API-Version"),
        String(API_VERSION),
      );
    }
  } finally {
    fixture.cleanup();
  }
});
test("extension preflight permits version and idempotent upload headers", () => {
  const headers = corsHeaders(
    new Request("https://notes.example/api/attachments", {
      headers: { origin: "chrome-extension://clipper" },
    }),
  );
  assert.match(
    headers.get("Access-Control-Allow-Headers")!,
    /X-Doompile-Upload-ID/,
  );
  assert.match(
    headers.get("Access-Control-Allow-Headers")!,
    /X-Doompile-API-Version/,
  );
});
