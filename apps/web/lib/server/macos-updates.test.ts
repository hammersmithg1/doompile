import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { macOSUpdateDownload } from "./macos-updates";
import { GET as rootDownload } from "../../app/downloads/macos/[file]/route";
import { GET as prefixedDownload } from "../../app/doompile/downloads/macos/[file]/route";

const archiveName = "Doompile-macOS-8.1.zip";
const url = "https://notes.example.org/doompile/downloads/macos/";

async function releases(run: (directory: string) => Promise<void>) {
  const original = process.env.DOOMPILE_MACOS_RELEASES_DIR;
  const directory = await mkdtemp(join(tmpdir(), "doompile-macos-download-"));
  process.env.DOOMPILE_MACOS_RELEASES_DIR = directory;
  try {
    await writeFile(join(directory, archiveName), "0123456789");
    await writeFile(join(directory, "appcast.xml"), "<!-- signed bytes -->\n<rss/>\n");
    await run(directory);
  } finally {
    if (original === undefined) delete process.env.DOOMPILE_MACOS_RELEASES_DIR;
    else process.env.DOOMPILE_MACOS_RELEASES_DIR = original;
    await rm(directory, { recursive: true, force: true });
  }
}

test("both public paths serve signed feed bytes without authentication or stale cache", () => releases(async () => {
  for (const download of [rootDownload, prefixedDownload]) {
    const response = await download(new Request(url + "appcast.xml"), { params: Promise.resolve({ file: "appcast.xml" }) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<!-- signed bytes -->\n<rss/>\n");
    assert.match(response.headers.get("Cache-Control")!, /must-revalidate/);
    assert.match(response.headers.get("Content-Type")!, /application\/rss\+xml/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
}));

test("the latest download follows the published appcast on both paths", () => releases(async (directory) => {
  const paths = [
    { base: "https://notes.example.org/downloads/macos/", download: rootDownload, method: "GET" },
    { base: url, download: prefixedDownload, method: "HEAD" },
  ];
  for (const archive of [archiveName, "Doompile-macOS-9.1.zip"]) {
    await writeFile(join(directory, archive), "0123456789");
    await writeFile(join(directory, "appcast.xml"), `<rss><channel><item><enclosure url="https://updates.example.org/macos/${archive}" /></item></channel></rss>`);
    for (const { base, download, method } of paths) {
      const request = new Request(base + "latest.zip", { method });
      const response = await download(request, { params: Promise.resolve({ file: "latest.zip" }) });
      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get("Location")!, request.url).href, base + archive);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  }
  await writeFile(join(directory, "appcast.xml"), '<rss><channel><item><enclosure url="https://updates.example.org/private.json" /></item></channel></rss>');
  assert.equal((await macOSUpdateDownload(new Request(url + "latest.zip"), "latest.zip")).status, 404);
}));

test("downloads stream immutable archives and support HEAD, resuming and conditional requests", () => releases(async () => {
  const head = await macOSUpdateDownload(new Request(url + archiveName, { method: "HEAD" }), archiveName);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "10");
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("Cache-Control")!, /immutable/);
  assert.equal(head.headers.get("Accept-Ranges"), "bytes");
  const etag = head.headers.get("ETag")!;
  const resumed = await macOSUpdateDownload(new Request(url + archiveName, { headers: { Range: "bytes=4-", "If-Range": etag } }), archiveName);
  assert.equal(resumed.status, 206);
  assert.equal(resumed.headers.get("Content-Range"), "bytes 4-9/10");
  assert.equal(resumed.headers.get("Content-Length"), "6");
  assert.equal(await resumed.text(), "456789");
  const full = await macOSUpdateDownload(new Request(url + archiveName, { headers: { Range: "bytes=4-", "If-Range": '"old"' } }), archiveName);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), "0123456789");
  const cached = await macOSUpdateDownload(new Request(url + archiveName, { headers: { "If-None-Match": etag } }), archiveName);
  assert.equal(cached.status, 304);
  const invalid = await macOSUpdateDownload(new Request(url + archiveName, { headers: { Range: "bytes=20-" } }), archiveName);
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("Content-Range"), "bytes */10");
}));

test("public downloads cannot expose other files, traverse paths or follow symlinks", () => releases(async (directory) => {
  await writeFile(join(directory, "private.json"), "private");
  await symlink(join(directory, "private.json"), join(directory, "Doompile-macOS-9.1.zip"));
  await mkdir(join(directory, "Doompile-macOS-10.1.zip"));
  for (const file of ["../private.json", "..%2Fprivate.json", "private.json", "release.json", ".publish.lock", "Doompile-macOS-9.1.zip", "Doompile-macOS-10.1.zip", "Doompile-macOS-11.1.zip"])
    assert.equal((await macOSUpdateDownload(new Request(url + "file"), file)).status, 404, file);
  delete process.env.DOOMPILE_MACOS_RELEASES_DIR;
  assert.equal((await macOSUpdateDownload(new Request(url + archiveName), archiveName)).status, 404);
}));
