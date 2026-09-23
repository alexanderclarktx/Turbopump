import { describe, expect, test } from "bun:test";
import { fetchGithubAttachment } from "../src/github-attachment";

const assetUrl = "https://github.com/user-attachments/assets/33002b47-bd20-4a41-8db2-b5fd97d18e5b";
const signedUrl = "https://github-production-user-asset-6210df.s3.amazonaws.com/image.png?signature=test";

describe("GitHub attachment downloads", () => {
  test("retries private images with the CLI login and follows signed downloads without credentials", async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    const response = await fetchGithubAttachment(assetUrl, {
      apiKey: "saved-token",
      getCliToken: async () => "cli-token",
      fetch: async (url, init) => {
        calls.push({ url: url.href, authorization: new Headers(init.headers).get("authorization") });
        expect(init.redirect).toBe("manual");
        if (calls.length === 1) return new Response("Not Found", { status: 404 });
        if (calls.length === 2) return new Response(null, { status: 302, headers: { location: signedUrl } });
        return new Response("image bytes", { headers: { "content-type": "image/png" } });
      },
    });
    expect(calls).toEqual([
      { url: assetUrl, authorization: "Bearer saved-token" },
      { url: assetUrl, authorization: "Bearer cli-token" },
      { url: signedUrl, authorization: null },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await response.text()).toBe("image bytes");
  });

  test("serves public images without needing a CLI login", async () => {
    let cliCalls = 0;
    const response = await fetchGithubAttachment(assetUrl, {
      getCliToken: async () => { cliCalls++; return ""; },
      fetch: async () => new Response("public image", { headers: { "content-type": "image/webp" } }),
    });
    expect(response.status).toBe(200);
    expect(cliCalls).toBe(0);
  });

  test.each([
    "https://example.com/image.png",
    "http://github.com/user-attachments/assets/abc",
    "https://github.com:444/user-attachments/assets/abc",
    "https://user:password@github.com/user-attachments/assets/abc",
    "https://github.com/settings",
    "invalid",
  ])("rejects unsupported input before fetching: %s", async (url) => {
    let calls = 0;
    const response = await fetchGithubAttachment(url, { fetch: async () => { calls++; return new Response(); } });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test.each(["https://example.com/image.png", "http://127.0.0.1/image.png", "https://github.com/login"])(
    "rejects unsupported redirect targets: %s", async (location) => {
      let calls = 0;
      const response = await fetchGithubAttachment(assetUrl, {
        fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location } }); },
      });
      expect(response.status).toBe(502);
      expect(calls).toBe(1);
    },
  );

  test("bounds redirect loops", async () => {
    let calls = 0;
    const response = await fetchGithubAttachment(assetUrl, {
      fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: signedUrl } }); },
    });
    expect(response.status).toBe(502);
    expect(calls).toBe(4);
  });

  test("preserves access failures when no CLI credential is available", async () => {
    const response = await fetchGithubAttachment(assetUrl, {
      getCliToken: async () => "",
      fetch: async () => new Response("Not Found", { status: 404 }),
    });
    expect(response.status).toBe(404);
  });

  test("rejects non-image responses and handles network failures", async () => {
    const html = await fetchGithubAttachment(assetUrl, {
      fetch: async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
    });
    expect(html.status).toBe(502);
    const unavailable = await fetchGithubAttachment(assetUrl, {
      fetch: async () => { throw new Error("network unavailable"); },
    });
    expect(unavailable.status).toBe(502);
  });
});
