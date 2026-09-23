import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export function createWorktreeCleanup(options: {
  directory: string;
  onError: (path: string, error: unknown) => void;
  removeDirectory?: (path: string) => Promise<void>;
}) {
  let pending: Promise<void> | undefined;
  const removeDirectory = options.removeDirectory ?? ((path: string) => rm(path, {
    recursive: true, force: true, maxRetries: 3, retryDelay: 100,
  }));

  return {
    async stage(target: string) {
      await mkdir(options.directory, { recursive: true });
      const staged = join(options.directory, `worktree-${crypto.randomUUID()}`);
      // A same-filesystem rename removes the checkout from the active list without
      // waiting for potentially millions of dependency/build files to be unlinked.
      await rename(target, staged);
      return staged;
    },
    run(): Promise<void> {
      if (pending) return pending;
      pending = (async () => {
        try {
          const entries = await readdir(options.directory);
          // Process one directory at a time to avoid overwhelming disk I/O.
          for (const name of entries) {
            if (!/^worktree-[0-9a-f-]{36}$/.test(name)) continue;
            const path = join(options.directory, name);
            try {
              await removeDirectory(path);
            } catch (error) {
              // The staged directory remains on disk for the next sweep/restart.
              options.onError(path, error);
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") options.onError(options.directory, error);
        }
      })().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
