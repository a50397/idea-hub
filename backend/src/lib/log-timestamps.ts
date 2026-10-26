// Prefixes every console line with an ISO-8601 UTC timestamp.
//
// Imported for its side effect as the FIRST import of src/index.ts, so that
// module-scope logging in anything imported afterwards is stamped too (ES
// module imports are evaluated in source order).
//
// Why patch the console instead of introducing a logger and rewriting ~138 call
// sites: the patch covers every existing and future call site plus console
// output from dependencies, and it keeps the diff to one file.
//
// Tests are unaffected. Unit tests never import src/index.ts (they build their
// own express apps), so this never runs there. And where a test does
// `jest.spyOn(console, 'error')`, the spy replaces the same property this module
// overwrote, so the wrapper is bypassed entirely and assertions that match exact
// arguments — e.g. init-admin.test.ts expecting a single-argument
// 'Default admin created: …' — keep passing.
//
// Docker's json-file driver records its own timestamp, but `docker logs` only
// shows it with -t, and it marks when Docker read the line rather than when the
// app emitted it. An in-line stamp survives copy/paste into a ticket.

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

const METHODS: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];

for (const method of METHODS) {
  // Bind the original up front: rebinding console[method] below must not make
  // the wrapper recurse into itself.
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]): void => {
    original(`[${new Date().toISOString()}]`, ...args);
  };
}
