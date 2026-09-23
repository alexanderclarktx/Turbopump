import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

const maxTextBytes = 2 * 1024 * 1024;

export async function serveFilePreview(checkoutPath: string, rawPath: string, download = false): Promise<Response> {
  if (!rawPath || /[\u0000-\u001f\u007f]/.test(rawPath)) {
    return Response.json({ error: "A valid file path is required." }, { status: 400 });
  }
  const location = rawPath.match(/(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/);
  const path = location ? rawPath.slice(0, location.index) : rawPath;
  const line = location ? Number(location[1] || location[2]) : null;
  try {
    const root = await realpath(checkoutPath);
    const target = await realpath(resolve(checkoutPath, path));
    const within = relative(root, target);
    if (within === ".." || within.startsWith("../") || isAbsolute(within)) {
      return Response.json({ error: "File is outside this checkout." }, { status: 404 });
    }
    const info = await stat(target);
    if (!info.isFile()) return Response.json({ error: "This path is not a file." }, { status: 400 });
    const file = Bun.file(target);
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (download) {
      return new Response(file, { headers: { ...headers, "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(target)).replaceAll("'", "%27")}` } });
    }
    const metadata = { name: basename(target), path: within, size: info.size, line };
    if (info.size > maxTextBytes) return Response.json({ ...metadata, kind: "unsupported", reason: "This file is too large to preview. Download it to view its contents." }, { headers });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let content: string;
    try {
      if (bytes.includes(0)) throw new Error("Binary file");
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return Response.json({ ...metadata, kind: "unsupported", reason: "Preview is unavailable for this file type. You can download the file." }, { headers });
    }
    return Response.json({ ...metadata, kind: /\.(md|markdown)$/i.test(extname(target)) ? "markdown" : "text", content }, { headers });
  } catch {
    return Response.json({ error: "File not found or could not be read." }, { status: 404 });
  }
}
