import { testEnvironment } from "./test-accounts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePreview, previewURL, publicAddress } from "./link-preview";
import { GET } from "../../app/api/link-preview/route";

test("Open Graph takes precedence, decodes entities and resolves relative images", () => {
  const result = parsePreview(
    `<html><head><title>Fallback</title>
    <META content='A &amp; B — &#x41;' PROPERTY='og:title'>
    <meta name=description content='Fallback description'>
    <meta property='og:description' content='A &quot;good&quot;\n description'>
    <meta property=og:site_name content='Example'>
    <meta property=og:type content=article>
    <meta property=og:image content='/cover.png?size=2&amp;mode=wide'>
    </head><body><script>not executed</script></body></html>`,
    new URL("https://example.com/story"),
  );
  assert.deepEqual(result, {
    url: "https://example.com/story",
    title: "A & B — A",
    description: 'A "good" description',
    siteName: "Example",
    type: "article",
    image: "https://example.com/cover.png?size=2&mode=wide",
  });
});
test("Title and description fallback without inventing an image URL", () => {
  const result = parsePreview(
    '<title>  Page &lt;title&gt; </title><meta name=description content="Description">',
    new URL("https://www.example.com/"),
  );
  assert.equal(result.title, "Page <title>");
  assert.equal(result.description, "Description");
  assert.equal(result.siteName, "example.com");
  assert.equal(result.type, "website");
  assert.equal(result.image, undefined);
  assert.equal(
    parsePreview("", new URL("https://example.com/")).title,
    "example.com",
  );
});
test("Untrusted images are omitted and metadata length stays bounded", () => {
  for (const image of [
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "http://127.0.0.1/private",
    "https://user:password@example.com/image",
  ]) {
    assert.equal(
      parsePreview(
        `<meta property=og:image content='${image}'>`,
        new URL("https://example.com"),
      ).image,
      undefined,
    );
  }
  assert.equal(
    parsePreview(
      `<meta property=og:title content='${"x".repeat(1000)}'>`,
      new URL("https://example.com"),
    ).title.length,
    300,
  );
});
test("Only public unicast destinations are eligible, including IPv4-mapped IPv6", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.2.3",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
    "not-an-ip",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])
    assert.equal(publicAddress(address), true, address);
});
test("Preview URLs reject credentials, non-web schemes, internal hosts and alternate ports", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:password@example.com",
    "http://localhost",
    "http://internal",
    "http://my.local",
    "http://my.internal",
    "http://127.1",
    "http://2130706433",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "https://example.com:9000",
  ])
    assert.throws(() => previewURL(url), /Only public|Invalid URL/, url);
  assert.equal(
    previewURL("https://example.com/path#fragment").href,
    "https://example.com/path",
  );
});
test("The endpoint requires authorization before looking up a page", async () => {
  const fixture = testEnvironment();
  const account = fixture.account();
  try {
    const response = await GET(
      new Request("http://localhost/api/link-preview?url=https://example.com"),
    );
    assert.equal(response.status, 401);
    const invalid = await GET(
      new Request("http://localhost/api/link-preview?url=http://127.0.0.1", {
        headers: { Authorization: `Bearer ${account.token}` },
      }),
    );
    assert.equal(invalid.status, 400);
  } finally {
    fixture.cleanup();
  }
});

test("DNS validation blocks private and mixed-address hosts before opening a socket", async (t) => {
  const dns = await import("node:dns/promises");
  const http = await import("node:http");
  const lookup = t.mock.method(dns.default, "lookup", async () => [
    { address: "10.0.0.1", family: 4 },
  ]);
  let connected = false;
  t.mock.method(http.default, "request", () => {
    connected = true;
    throw new Error("Unexpected socket");
  });
  const { fetchPreview } = await import("./link-preview");
  await assert.rejects(
    fetchPreview("http://private-dns.example.com"),
    /Only public/,
  );
  lookup.mock.mockImplementation(async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "::1", family: 6 },
  ]);
  await assert.rejects(
    fetchPreview("http://mixed-dns.example.com"),
    /Only public/,
  );
  assert.equal(connected, false);
});

test("Each redirect is validated and a validated DNS address is pinned to the socket", async (t) => {
  const dns = await import("node:dns/promises");
  const http = await import("node:http");
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");
  t.mock.method(dns.default, "lookup", async () => [
    { address: "8.8.8.8", family: 4 },
  ]);
  let requests = 0;
  t.mock.method(
    http.default,
    "request",
    (_url: URL, options: any, callback: (response: any) => void) => {
      requests++;
      options.lookup(
        "changed-dns.example.com",
        {},
        (error: unknown, address: string, family: number) => {
          assert.equal(error, null);
          assert.equal(address, "8.8.8.8");
          assert.equal(family, 4);
        },
      );
      assert.equal(options.agent, false);
      assert.equal(options.headers.Cookie, undefined);
      const request = new EventEmitter() as any;
      request.end = () =>
        queueMicrotask(() => {
          const response = Readable.from([]) as any;
          response.statusCode = 302;
          response.headers = { location: "http://169.254.169.254/metadata" };
          callback(response);
        });
      return request;
    },
  );
  const { fetchPreview } = await import("./link-preview");
  await assert.rejects(
    fetchPreview("http://redirect.example.com"),
    /Only public/,
  );
  assert.equal(requests, 1);
});
