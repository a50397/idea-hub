import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Cross-worker mutex via atomic `mkdir`.
 *
 * Playwright runs spec files in parallel across worker PROCESSES. The singleton
 * mail-settings document is global state that both mail-settings.spec.ts and
 * notifications.spec.ts mutate, so their critical sections must not overlap:
 * notifications.spec.ts is the only spec that ever ENABLES mail, and a concurrent
 * mail-settings.spec.ts save (which always writes DISABLED) would flip mail off
 * mid-flow and break the toggle-visibility assertions.
 *
 * `mkdir` is atomic across processes (it fails with EEXIST if the directory
 * already exists), which makes it a reliable inter-process lock with no extra
 * dependency. A lock orphaned by a crashed worker is reclaimed once it is older
 * than `staleMs`, and the holder always releases it in a `finally`.
 */
export async function withFileLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.resolve(process.cwd(), 'e2e', `.${name}.lock`);
  const staleMs = 90_000; // reclaim a lock left behind by a crashed worker
  // Comfortably ABOVE staleMs: if the holder crashes, a waiter must survive long
  // enough to reach the stale-reclaim path below and self-heal. The previous 50s
  // (< staleMs) guaranteed a waiter threw "timed out acquiring lock" BEFORE a stale
  // lock could ever be reclaimed. Playwright's own per-test timeout remains the outer
  // bound on a genuinely stuck wait.
  const acquireDeadline = Date.now() + 120_000;

  for (;;) {
    try {
      mkdirSync(lockPath);
      break; // acquired
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
      // Someone holds it. Reclaim it if it has gone stale, otherwise back off.
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock vanished between statSync and now — retry immediately.
      }
      if (Date.now() > acquireDeadline) {
        throw new Error(`withFileLock("${name}"): timed out acquiring lock`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 150)));
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
