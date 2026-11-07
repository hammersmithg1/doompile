import { test } from "node:test";
import assert from "node:assert/strict";
import { appSiteAssociation } from "./app-links";
import { GET } from "../../app/.well-known/apple-app-site-association/route";
test("association is inert until configured and only claims note paths", () => {
  assert.deepEqual(appSiteAssociation(""), {
    applinks: { apps: [], details: [] },
  });
  const result = appSiteAssociation(
    "ABCDEFGHIJ.app.doompile,ABCDEFGHIJ.app.doompile.macos,invalid,ABCDEFGHIJ.app.doompile",
  );
  assert.deepEqual(result.applinks.details[0].appIDs, [
    "ABCDEFGHIJ.app.doompile",
    "ABCDEFGHIJ.app.doompile.macos",
  ]);
  assert.equal(result.applinks.details[0].components[0]["/"], "/notes/*");
});
test("AASA is directly available to Apple without a session or redirect", () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.equal(response.headers.get("location"), null);
});
