// Unit tests for the bounded fan-out primitive (utils/concurrency).
//
// The Webex department notification feeds up to 70 sends through runBounded, so the
// properties pinned here are the ones that fan-out correctness depends on: every task
// runs, the in-flight ceiling actually holds, and one throwing task never abandons the
// rest of the queue. No HTTP, no DB — pure timing/bookkeeping.

import { runBounded } from '../utils/concurrency';

/** Yield to the macrotask queue so overlapping tasks can interleave. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Build N tasks that record their start order and track how many run concurrently.
 * `peak` is the highest simultaneous in-flight count observed.
 */
function makeTracker(count: number, body?: (index: number) => Promise<void>) {
  const state = { inFlight: 0, peak: 0, started: [] as number[], finished: [] as number[] };
  const tasks = Array.from({ length: count }, (_, i) => async () => {
    state.started.push(i);
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    try {
      await (body ? body(i) : tick());
    } finally {
      state.inFlight--;
      state.finished.push(i);
    }
  });
  return { tasks, state };
}

describe('runBounded', () => {
  test('runs every task and resolves only after all have settled', async () => {
    const { tasks, state } = makeTracker(12);

    await runBounded(tasks, 5);

    expect(state.finished).toHaveLength(12);
    expect([...state.finished].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(state.inFlight).toBe(0);
  });

  test('never exceeds the limit in flight', async () => {
    const { tasks, state } = makeTracker(20);

    await runBounded(tasks, 5);

    expect(state.peak).toBe(5);
    expect(state.finished).toHaveLength(20);
  });

  test('a fan-out smaller than the limit runs fully parallel (no artificial serialization)', async () => {
    const { tasks, state } = makeTracker(3);

    await runBounded(tasks, 10);

    // Only 3 workers are spawned, and all 3 tasks overlap.
    expect(state.peak).toBe(3);
  });

  test('tasks are STARTED in array order', async () => {
    const { tasks, state } = makeTracker(6);

    await runBounded(tasks, 2);

    // The first `limit` start immediately; the rest are claimed in queue order as
    // workers free up. Start order is therefore always ascending.
    expect(state.started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('a throwing task does NOT abandon the rest of the queue', async () => {
    // The property an unbounded Promise.all gets for free (everything is started up
    // front) and the reason runBounded catches INSIDE the worker loop: with 1 worker,
    // an uncaught throw on task 0 would strand tasks 1-4 forever.
    const { tasks, state } = makeTracker(5, async (i) => {
      await tick();
      if (i === 0) throw new Error('boom');
    });

    await runBounded(tasks, 1);

    expect(state.finished).toHaveLength(5);
  });

  test('reports each failure to onError with its index, and still resolves', async () => {
    const seen: Array<{ message: string; index: number }> = [];
    const { tasks } = makeTracker(4, async (i) => {
      await tick();
      if (i % 2 === 0) throw new Error(`fail-${i}`);
    });

    await expect(
      runBounded(tasks, 2, (err, index) => seen.push({ message: (err as Error).message, index }))
    ).resolves.toBeUndefined();

    expect(seen.sort((a, b) => a.index - b.index)).toEqual([
      { message: 'fail-0', index: 0 },
      { message: 'fail-2', index: 2 },
    ]);
  });

  test('swallows failures when no onError is given (never rejects)', async () => {
    const { tasks, state } = makeTracker(3, async () => {
      await tick();
      throw new Error('boom');
    });

    await expect(runBounded(tasks, 2)).resolves.toBeUndefined();
    expect(state.finished).toHaveLength(3);
  });

  test('an empty task list resolves immediately', async () => {
    await expect(runBounded([], 5)).resolves.toBeUndefined();
  });

  test.each([
    ['zero', 0],
    ['negative', -3],
    ['NaN', Number.NaN],
    ['Infinity-as-undefined', undefined as unknown as number],
  ])('a %s limit degrades to serial rather than dropping tasks', async (_label, limit) => {
    // Guards the silent-drop failure mode: an unclamped NaN worker count would
    // produce zero workers and run NOTHING while still resolving successfully.
    const { tasks, state } = makeTracker(4);

    await runBounded(tasks, limit);

    expect(state.finished).toHaveLength(4);
    expect(state.peak).toBe(1);
  });

  test('a fractional limit is floored, not rounded up', async () => {
    const { tasks, state } = makeTracker(10);

    await runBounded(tasks, 3.9);

    expect(state.peak).toBe(3);
  });
});
