// Bounded parallelism for best-effort fan-outs.
//
// The notification channels have no bulk primitive of their own — a Webex
// department notification is one POST per DM recipient plus one per room — so an
// unbounded `Promise.all` over a maxed-out department would open every socket at
// once and invite provider-side rate limiting (HTTP 429). Because those sends are
// fire-and-forget, a throttled message is simply LOST, so smoothing the burst is
// cheaper than losing notifications. This file holds the one generic primitive;
// each caller supplies its own limit (e.g. WEBEX_SEND_CONCURRENCY).

/**
 * Run `tasks` with at most `limit` in flight, resolving when all have settled.
 * NEVER throws/rejects.
 *
 * Semantics that callers rely on:
 *   - EVERY task runs. A task that throws is caught and reported to `onError`
 *     (default: swallow), so one failure can never abandon the rest of the queue —
 *     the property an unbounded Promise.all gets for free by starting everything
 *     up front, and the reason the catch lives INSIDE the worker loop.
 *   - Start order is array order; completion order is arbitrary.
 *   - Results are discarded. This is for side-effecting, best-effort work; use
 *     Promise.all when you need the values.
 *   - `limit` is clamped to at least 1, so a 0/negative/non-finite limit degrades
 *     to SERIAL execution rather than silently running nothing (an unguarded NaN
 *     would produce zero workers and drop every task on the floor).
 */
export async function runBounded(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  limit: number,
  onError?: (err: unknown, index: number) => void
): Promise<void> {
  if (tasks.length === 0) return;

  let cursor = 0;
  const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const workerCount = Math.min(Math.max(1, safeLimit), tasks.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      // Each worker claims the next index until the queue drains. `cursor++` is
      // effectively atomic: it runs synchronously between awaits on the single JS
      // thread, so two workers can never claim the same task.
      for (let i = cursor++; i < tasks.length; i = cursor++) {
        try {
          await tasks[i]();
        } catch (err) {
          onError?.(err, i);
        }
      }
    })
  );
}
