import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const assetPath = /^\/user-attachments\/assets\/[0-9a-f-]+$/i;

async function githubCliToken(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5000,
      maxBuffer: 16384,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function allowedAttachmentUrl(url: URL, initial = false): boolean {
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  if (url.hostname === "github.com") return assetPath.test(url.pathname);
  return !initial && (
    /^github-production-user-asset-[0-9a-f]+\.s3\.amazonaws\.com$/.test(url.hostname) ||
    url.hostname === "private-user-images.githubusercontent.com" ||
    url.hostname === "user-images.githubusercontent.com"
  );
}

type AttachmentOptions = {
  apiKey?: string;
  getCliToken?: () => Promise<string>;
  fetch?: (url: URL, init: RequestInit) => Promise<Response>;
};

export async function fetchGithubAttachment(rawUrl: string, options: AttachmentOptions = {}): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return new Response("Invalid attachment URL.", { status: 400 });
  }
  if (!allowedAttachmentUrl(url, true)) return new Response("Unsupported attachment URL.", { status: 400 });

  const fetchImage = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(15000);
  const requestAsset = (token: string) => fetchImage(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    redirect: "manual",
    signal,
  });

  try {
    let response = await requestAsset(options.apiKey ?? "");
    if ([401, 403, 404].includes(response.status)) {
      const cliToken = await (options.getCliToken ?? githubCliToken)();
      if (cliToken && cliToken !== options.apiKey) {
        await response.body?.cancel();
        response = await requestAsset(cliToken);
      }
    }

    for (let redirects = 0; response.status >= 300 && response.status < 400; redirects++) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects >= 3) return new Response("GitHub attachment redirect failed.", { status: 502 });
      url = new URL(location, url);
      if (!allowedAttachmentUrl(url)) return new Response("Unsupported attachment redirect.", { status: 502 });
      // Signed download URLs work without credentials; never forward the GitHub token.
      response = await fetchImage(url, { redirect: "manual", signal });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      await response.body?.cancel();
      return new Response(
        response.ok ? "GitHub attachment response was not an image." : `GitHub attachment fetch failed: ${response.status}`,
        { status: response.ok ? 502 : response.status },
      );
    }
    return new Response(response.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("GitHub attachment download failed.", { status: 502 });
  }
}
