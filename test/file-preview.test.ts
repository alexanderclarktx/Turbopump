import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFilePreview } from "../src/file-preview";

const directory = await mkdtemp(join(tmpdir(), "turbopump-preview-"));
const checkout = join(directory, "checkout");
await mkdir(join(checkout, "artifacts"), { recursive: true });
await writeFile(join(checkout, "artifacts", "report (final).md"), "# Validation\nAll checks passed.");
await writeFile(join(checkout, "source.ts"), "const value = 1;\nexport { value };\n");
await writeFile(join(directory, "outside.txt"), "outside checkout");
await symlink(join(directory, "outside.txt"), join(checkout, "escape.txt"));
afterAll(() => rm(directory, { recursive: true, force: true }));

describe("file previews", () => {
  test("reads Markdown using checkout-relative and absolute paths", async () => {
    for (const path of ["artifacts/report (final).md", join(checkout, "artifacts/report (final).md")]) {
      const response = await serveFilePreview(checkout, path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ kind: "markdown", path: "artifacts/report (final).md", content: "# Validation\nAll checks passed." });
    }
  });
  test.each(["source.ts:2", "source.ts:2:4", "source.ts#L2", "source.ts#L2-L3"])("preserves line references: %s", async (path) => {
    expect(await (await serveFilePreview(checkout, path)).json()).toMatchObject({ kind: "text", line: 2, name: "source.ts" });
  });
  test.each(["../outside.txt", "escape.txt", "missing.md", join(directory, "outside.txt")])("rejects inaccessible paths: %s", async (path) => {
    expect((await serveFilePreview(checkout, path)).status).toBe(404);
    expect((await serveFilePreview(checkout, path, true)).status).toBe(404);
  });
  test("rejects directories and invalid paths", async () => {
    for (const path of ["artifacts", "", "source.ts\0"]) expect((await serveFilePreview(checkout, path)).status).toBe(400);
  });
  test("offers a download for binary and oversized files", async () => {
    await writeFile(join(checkout, "binary.bin"), new Uint8Array([0, 255, 1]));
    await writeFile(join(checkout, "large.txt"), "a".repeat(2 * 1024 * 1024 + 1));
    for (const path of ["binary.bin", "large.txt"]) {
      expect(await (await serveFilePreview(checkout, path)).json()).toMatchObject({ kind: "unsupported" });
      const download = await serveFilePreview(checkout, path, true);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toStartWith("attachment;");
    }
  });
  test("returns HTML as text rather than executable content", async () => {
    await writeFile(join(checkout, "page.html"), "<script>alert(1)</script>");
    const response = await serveFilePreview(checkout, "page.html");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ kind: "text", content: "<script>alert(1)</script>" });
  });
});
