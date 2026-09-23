import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreeCleanup } from "../src/worktree-cleanup";

const root = await mkdtemp(join(tmpdir(), "turbopump-cleanup-test-"));
afterAll(() => rm(root, { recursive: true, force: true }));

const server = await Bun.file("src/server.ts").text();
function deletionHarness() {
  const stage = Promise.withResolvers<string>();
  const cleanup = Promise.withResolvers<void>();
  const deleting = new Set<string>();
  const deleted: string[] = [];
  const stopped: string[] = [];
  let stages = 0;
  let cleanups = 0;
  const names = ["deleteWorktree", "deleteWorktreeOnce", "recoverAgentRuntime", "reconcileAgentHeartbeat"];
  const declarations = names.map((name) => server.match(new RegExp(`^async function ${name}\\([\\s\\S]*?^}`, "m"))![0]).join("\n");
  const bindings = {
    worktreeDeletions: new Map(), deletingFlowIds: deleting, deletedFlowIds: new Set(),
    worktreePathForName: () => "/test/worktree", existsSync: () => true, statSync: () => ({ isDirectory: () => true }),
    worktreeFlowMap: () => new Map([["session", { id: "parent" }]]),
    companionFlowFor: () => ({ id: "child" }),
    stopFlowRuntimesForDelete: (id: string) => { expect(deleting.has(id)).toBe(true); stopped.push(id); },
    deleteFlowTraceData: (id: string) => { deleted.push(id); },
    db: { transaction: (operation: () => void) => operation },
    worktreeCleanup: {
      stage: () => { stages += 1; return stage.promise; },
      run: () => { cleanups += 1; return cleanup.promise; },
    },
    pruneDeletedWorktrees: () => Promise.resolve(),
    getFlow: (id: string) => ({ id }),
  };
  const api = new Function(...Object.keys(bindings), new Bun.Transpiler({ loader: "ts" }).transformSync(declarations) +
    `\nreturn { ${names.join(", ")} };`)(...Object.values(bindings));
  return { api, stage, cleanup, deleting, deleted, stopped, stages: () => stages, cleanups: () => cleanups };
}

async function fixture() {
  const directory = await mkdtemp(join(root, "case-"));
  const target = join(directory, "worktrees", "session");
  const trash = join(directory, "deleted-worktrees");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "file.txt"), "checkout data");
  const errors: unknown[] = [];
  return { directory, target, trash, errors, onError: (_path: string, error: unknown) => { errors.push(error); } };
}

describe("background worktree cleanup", () => {
  test("finishes session deletion before disk cleanup and prevents recovery while deleting", async () => {
    const h = deletionHarness();
    const request = h.api.deleteWorktree("session");
    const duplicate = h.api.deleteWorktree("session");
    expect(h.stages()).toBe(1);
    expect(h.stopped).toEqual(["child", "parent"]);
    expect(h.deleting).toEqual(new Set(["child", "parent"]));
    expect(await h.api.recoverAgentRuntime({ id: "parent" })).toBeNull();
    expect(await h.api.reconcileAgentHeartbeat({ id: "parent" })).toEqual({ id: "parent" });
    h.stage.resolve("/test/staged");
    expect(await request).toEqual({ deletedFlowId: "parent" });
    expect(await duplicate).toEqual({ deletedFlowId: "parent" });
    expect(h.deleted).toEqual(["child", "parent"]);
    expect(h.deleting.size).toBe(0);
    expect(h.cleanups()).toBe(1);
    h.cleanup.resolve();
  });

  test("a failed stage restores deletion availability without erasing session data", async () => {
    const h = deletionHarness();
    const request = h.api.deleteWorktree("session");
    h.stage.reject(new Error("Permission denied"));
    await expect(request).rejects.toThrow("Permission denied");
    expect(h.deleted).toEqual([]);
    expect(h.deleting.size).toBe(0);
    h.cleanup.resolve();
  });

  test("stages a deletion without waiting for file removal", async () => {
    const f = await fixture();
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const cleanup = createWorktreeCleanup({
      directory: f.trash, onError: f.onError,
      removeDirectory: async (path) => { entered.resolve(); await gate.promise; await rm(path, { recursive: true }); },
    });
    const staged = await cleanup.stage(f.target);
    expect(existsSync(f.target)).toBe(false);
    expect(await readFile(join(staged, "file.txt"), "utf8")).toBe("checkout data");
    const removing = cleanup.run();
    await entered.promise;
    try {
      // A second deletion can finish staging while the first cleanup is blocked.
      await mkdir(f.target);
      await writeFile(join(f.target, "new.txt"), "new checkout");
      const second = await cleanup.stage(f.target);
      expect(second).not.toBe(staged);
      expect(existsSync(f.target)).toBe(false);
      expect(existsSync(staged)).toBe(true);
    } finally {
      gate.resolve();
      await removing;
    }
    await cleanup.run();
    expect(await readdir(f.trash)).toEqual([]);
    expect(f.errors).toEqual([]);
  });

  test("deduplicates sweeps and processes only one directory at a time", async () => {
    const f = await fixture();
    const gate = Promise.withResolvers<void>();
    let active = 0;
    let peak = 0;
    const cleanup = createWorktreeCleanup({
      directory: f.trash, onError: f.onError,
      removeDirectory: async (path) => {
        peak = Math.max(peak, ++active);
        await gate.promise;
        await rm(path, { recursive: true });
        active -= 1;
      },
    });
    await cleanup.stage(f.target);
    await mkdir(f.target);
    await cleanup.stage(f.target);
    const first = cleanup.run();
    expect(cleanup.run()).toBe(first);
    gate.resolve();
    await first;
    expect(peak).toBe(1);
    expect(await readdir(f.trash)).toEqual([]);
  });

  test("retains failed cleanup on disk and retries after a server restart", async () => {
    const f = await fixture();
    const cleanup = createWorktreeCleanup({
      directory: f.trash, onError: f.onError,
      removeDirectory: async () => { throw new Error("disk busy"); },
    });
    const staged = await cleanup.stage(f.target);
    await cleanup.run();
    expect(existsSync(staged)).toBe(true);
    expect(f.errors).toHaveLength(1);
    const restarted = createWorktreeCleanup({ directory: f.trash, onError: f.onError });
    await restarted.run();
    expect(existsSync(staged)).toBe(false);
  });

  test("does not remove a new checkout reusing the original path or symlink destinations", async () => {
    const f = await fixture();
    const outside = join(f.directory, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await symlink(outside, join(f.target, "link"));
    const cleanup = createWorktreeCleanup({ directory: f.trash, onError: f.onError });
    await cleanup.stage(f.target);
    await mkdir(f.target);
    await writeFile(join(f.target, "keep.txt"), "replacement");
    await cleanup.run();
    expect(await readFile(join(f.target, "keep.txt"), "utf8")).toBe("replacement");
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });

  test("a failed stage keeps the original checkout intact", async () => {
    const f = await fixture();
    await writeFile(f.trash, "not a directory");
    const cleanup = createWorktreeCleanup({ directory: f.trash, onError: f.onError });
    await expect(cleanup.stage(f.target)).rejects.toThrow();
    expect(await readFile(join(f.target, "file.txt"), "utf8")).toBe("checkout data");
  });

  test("prunes the Git registration independently of the staged directory", async () => {
    const f = await fixture();
    const repo = join(f.directory, "repo");
    const target = join(f.directory, "git-checkout");
    await mkdir(repo);
    const git = async (...args: string[]) => {
      const proc = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code) throw new Error(stderr);
      return stdout;
    };
    await git("init");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture");
    await git("worktree", "add", "-b", "test-session", target);
    await writeFile(join(target, "untracked.txt"), "staged contents");
    const cleanup = createWorktreeCleanup({ directory: f.trash, onError: f.onError });
    const staged = await cleanup.stage(target);
    await git("worktree", "prune", "--expire", "now");
    expect(await git("worktree", "list", "--porcelain")).not.toContain(target);
    expect(await readFile(join(staged, "untracked.txt"), "utf8")).toBe("staged contents");
    await cleanup.run();
    expect(existsSync(staged)).toBe(false);
  });
});
