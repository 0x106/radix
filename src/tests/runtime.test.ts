// Headless test harness for the Radix runtime.
//
// The runtime ships as a browser-JS source string (src/runtime/source.ts) that
// normally runs inside the prototype iframe. It guards every browser API it touches
// (`typeof indexedDB`, `typeof location`, `typeof requestAnimationFrame`), so we can
// instantiate it in Node by passing those as `undefined` and handing it a stub
// `window`. With no IndexedDB it runs on the memory-only path — exactly what we want
// for deterministic, side-effect-free assertions.
//
// Run with: npm test
//
// These tests pin the runtime's core contract — determinism, reset-to-seed,
// immutability, query semantics, and strict validation — so the hardening refactor
// can't regress them silently.

import * as fs from "node:fs";
import { runtimeSource } from "../runtime/source";
import { prototypeScope } from "../runtime/packaging";
import type { RadixRuntime } from "../runtime/types";

// --- minimal harness -------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`      ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ?? "values differ"}: got ${a}, expected ${e}`);
}

function throws(fn: () => void, msg: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${msg}: expected an exception, none thrown`);
}

type PostedMessage = { target: unknown; msg: unknown; origin: string };
type Harness = {
  radix: RadixRuntime;
  parent: { postMessage(msg: unknown, origin: string): void };
  // Deliver a synthetic `message` event to the runtime's listener.
  send(event: { data: unknown; source: unknown; origin: string }): void;
  // Messages the runtime sent back to `parent`.
  posted: PostedMessage[];
};

// Build a fresh runtime instance with a controllable postMessage bridge. Each
// call produces an isolated `window.radix` with its own clock, store, and seed.
// `pinnedOrigin` mirrors what wrapPrototype substitutes for the bridge's
// `__RADIX_SHELL_ORIGIN__` placeholder ("" = not pinned).
function build(pinnedOrigin = ""): Harness {
  const posted: PostedMessage[] = [];
  let messageHandler: ((e: unknown) => void) | null = null;
  const parent = {
    postMessage(msg: unknown, origin: string) {
      posted.push({ target: parent, msg, origin });
    },
  };
  const win: Record<string, unknown> = {
    parent,
    addEventListener(type: string, cb: (e: unknown) => void) {
      if (type === "message") messageHandler = cb;
    },
  };
  const source = runtimeSource.replace("__RADIX_SHELL_ORIGIN__", pinnedOrigin);
  // Pass browser globals as params so the runtime's `typeof X` guards see them as
  // absent (undefined), forcing the memory-only / no-rAF path.
  const factory = new Function(
    "window",
    "location",
    "indexedDB",
    "requestAnimationFrame",
    `${source}\n; return window.radix;`,
  );
  const radix = factory(win, undefined, undefined, undefined) as RadixRuntime;
  return {
    radix,
    parent,
    posted,
    send(event) {
      if (messageHandler) messageHandler(event);
    },
  };
}

function createRuntime(): RadixRuntime {
  return build().radix;
}

// --- tests -----------------------------------------------------------------

console.log("\nradix runtime contract\n");

check("seeded random is deterministic across instances", () => {
  const a = createRuntime();
  const b = createRuntime();
  const seqA = Array.from({ length: 8 }, () => a.random.random());
  const seqB = Array.from({ length: 8 }, () => b.random.random());
  eq(seqA, seqB, "two fresh runtimes produced different random sequences");
  assert(seqA[0] !== seqA[1], "random() returned a constant");
});

check("clock.step fires timers in chronological order", () => {
  const r = createRuntime();
  const fired: string[] = [];
  r.clock.setTimeout(() => fired.push("c"), 300);
  r.clock.setTimeout(() => fired.push("a"), 100);
  r.clock.setTimeout(() => fired.push("b"), 200);
  r.clock.step(250);
  eq(fired, ["a", "b"], "timers fired out of order or too eagerly");
  r.clock.step(100);
  eq(fired, ["a", "b", "c"], "later timer did not fire after stepping past it");
});

check("timers scheduled by a firing timer still fire in order", () => {
  const r = createRuntime();
  const fired: number[] = [];
  // The first timer schedules a follow-up that must slot into the queue correctly.
  r.clock.setTimeout(() => {
    fired.push(1);
    r.clock.setTimeout(() => fired.push(2), 10);
  }, 10);
  r.clock.setTimeout(() => fired.push(3), 25);
  r.clock.step(30);
  eq(fired, [1, 2, 3], "nested timer did not interleave correctly");
});

check("many out-of-order timers fire in chronological order", () => {
  const r = createRuntime();
  const fired: number[] = [];
  for (let i = 200; i >= 1; i--) r.clock.setTimeout(() => fired.push(i), i);
  r.clock.step(200);
  const sorted = fired.every((v, i) => i === 0 || fired[i - 1] <= v);
  assert(sorted, "timers did not fire in chronological order");
  eq(fired.length, 200, "not all timers fired");
});

check("log is capped (ring buffer) and never grows unbounded", () => {
  const r = createRuntime();
  for (let i = 0; i < 2050; i++) r.log.info("line " + i);
  const n = r.log.entries().length;
  assert(n <= 2000, `log retained ${n} entries, expected <= 2000`);
  // The newest line must still be present.
  assert(r.log.entries().some((e) => e.msg === "line 2049"), "newest log line was dropped");
});

check("clock.setTimeout cancel works", () => {
  const r = createRuntime();
  const fired: string[] = [];
  const cancel = r.clock.setTimeout(() => fired.push("x"), 100);
  cancel();
  r.clock.step(200);
  eq(fired, [], "cancelled timer still fired");
});

check("reset() replays the seed exactly", () => {
  const r = createRuntime();
  r.db.define(
    { tasks: { fields: { title: "string", done: "boolean" }, seed: [{ title: "seeded", done: false }] } },
    { strict: true },
  );
  r.db.create("tasks", { title: "added", done: false });
  eq(r.db.query("tasks").length, 2, "expected seed + created row before reset");
  r.db.reset();
  const rows = r.db.query("tasks");
  eq(rows.length, 1, "reset did not return to seed size");
  eq(rows[0].title, "seeded", "reset did not restore seed contents");
});

check("immutable collection rejects update/delete in strict mode", () => {
  const r = createRuntime();
  r.db.define({ ledger: { immutable: true, fields: { amount: "number" } } }, { strict: true });
  const row = r.db.create("ledger", { amount: 10 });
  throws(() => r.db.update("ledger", row.id, { amount: 20 }), "update on immutable collection");
  throws(() => r.db.delete("ledger", row.id), "delete on immutable collection");
});

check("query: where equality, where-in, order, limit", () => {
  const r = createRuntime();
  r.db.define(
    {
      items: {
        fields: { kind: "string", n: "number" },
        seed: [
          { kind: "a", n: 3 },
          { kind: "b", n: 1 },
          { kind: "a", n: 2 },
          { kind: "c", n: 5 },
        ],
      },
    },
    { strict: true },
  );
  eq(r.db.query("items", { where: { kind: "a" } }).length, 2, "where equality count");
  eq(r.db.query("items", { where: { kind: { in: ["a", "c"] } } }).length, 3, "where-in count");
  const ordered = r.db.query("items", { order: { field: "n", dir: "asc" } }).map((x) => x.n);
  eq(ordered, [1, 2, 3, 5], "ascending order");
  eq(r.db.query("items", { order: { field: "n", dir: "desc" }, limit: 2 }).map((x) => x.n), [5, 3], "desc + limit");
});

check("query: include resolves a foreign-key relation", () => {
  const r = createRuntime();
  r.db.define(
    {
      users: { fields: { name: "string" }, seed: [{ id: "u1", name: "Ada" }] },
      posts: { fields: { userId: "string", body: "string" }, seed: [{ userId: "u1", body: "hi" }] },
    },
    { strict: true },
  );
  const rows = r.db.query("posts", { include: { author: { from: "users", on: "userId" } } });
  eq((rows[0].author as { name: string }).name, "Ada", "include did not resolve the related row");
});

check("strict validation throws on wrong type and missing required", () => {
  const r = createRuntime();
  r.db.define(
    { people: { fields: { name: { type: "string", required: true }, age: "number" } } },
    { strict: true },
  );
  throws(() => r.db.create("people", { name: "Bob", age: "old" }), "wrong-typed field");
  throws(() => r.db.create("people", { age: 30 }), "missing required field");
});

check("update on a missing id does not fabricate a row (strict throws)", () => {
  const r = createRuntime();
  r.db.define({ tasks: { fields: { title: "string" } } }, { strict: true });
  throws(() => r.db.update("tasks", "nope", { title: "x" }), "update of missing id in strict mode");
  eq(r.db.query("tasks").length, 0, "missing-id update created a phantom row");
});

check("unknown query field warns/throws against a declared schema", () => {
  const r = createRuntime();
  r.db.define({ items: { fields: { n: "number" } } }, { strict: true });
  throws(() => r.db.query("items", { where: { bogus: 1 } }), "where on unknown field");
  throws(() => r.db.query("items", { order: { field: "bogus", dir: "asc" } }), "order on unknown field");
});

check("query on an undeclared collection warns once (no throw)", () => {
  const r = createRuntime();
  r.db.define({ items: { fields: { n: "number" } } }, { strict: true });
  const before = r.log.entries().length;
  r.db.query("itemz"); // typo
  r.db.query("itemz"); // again — should not warn twice
  const warns = r.log.entries().slice(before).filter((e) => e.level === "warn" && e.msg.includes("itemz"));
  eq(warns.length, 1, "expected exactly one warning for the undeclared collection");
});

check("include warns when a foreign key resolves to nothing", () => {
  const r = createRuntime();
  r.db.define(
    {
      users: { fields: { name: "string" } },
      posts: { fields: { userId: "string" }, seed: [{ userId: "ghost" }] },
    },
    { strict: true },
  );
  const before = r.log.entries().length;
  r.db.query("posts", { include: { author: { from: "users", on: "userId" } } });
  const warns = r.log.entries().slice(before).filter((e) => e.level === "warn");
  assert(warns.length >= 1, "broken include did not warn");
});

check("a throwing subscriber does not break subscribe()", () => {
  const r = createRuntime();
  r.db.define({ c: { fields: { n: "number" } } }, { strict: true });
  let returned = false;
  const unsub = r.db.subscribe("c", () => {
    throw new Error("boom");
  });
  returned = typeof unsub === "function";
  assert(returned, "subscribe() did not return an unsubscribe fn when the callback threw");
  unsub();
});

check("events publish/subscribe delivers payloads", () => {
  const r = createRuntime();
  const got: number[] = [];
  const unsub = r.events.subscribe<number>("topic", (n) => got.push(n));
  r.events.publish("topic", 1);
  r.events.publish("topic", 2);
  unsub();
  r.events.publish("topic", 3);
  eq(got, [1, 2], "event delivery did not match published payloads");
});

check("bridge rejects messages that aren't from the parent window", () => {
  const h = build();
  // A message from some other window (not h.parent) must be ignored entirely.
  h.send({ data: { type: "radix:dump" }, source: { postMessage() {} }, origin: "https://evil.test" });
  eq(h.posted.length, 0, "bridge replied to a non-parent sender");
});

check("bridge replies to the parent at its exact origin, never '*'", () => {
  const h = build();
  h.send({ data: { type: "radix:dump" }, source: h.parent, origin: "https://shell.test" });
  eq(h.posted.length, 1, "expected exactly one reply to the parent");
  const reply = h.posted[0];
  assert(reply.origin === "https://shell.test", `reply origin should echo sender, got ${reply.origin}`);
  assert(reply.origin !== "*", "reply must not target '*'");
  eq((reply.msg as { type: string }).type, "radix:dump:response", "unexpected reply type");
});

check("bridge with a pinned origin rejects other origins", () => {
  const h = build("https://shell.test");
  h.send({ data: { type: "radix:dump" }, source: h.parent, origin: "https://other.test" });
  eq(h.posted.length, 0, "pinned bridge replied to a wrong-origin parent");
  h.send({ data: { type: "radix:dump" }, source: h.parent, origin: "https://shell.test" });
  eq(h.posted.length, 1, "pinned bridge did not reply to the matching origin");
});

check("prototype scope redirects Math.random, Date.now, and timers at the runtime", () => {
  const h = build();
  // Run a tiny "component" inside the prototype scope, sharing the same window so
  // window.radix is visible. The shims should route through the runtime.
  const probe = `
    window.__probe = {};
    window.__probe.rand = Math.random();        // seeded PRNG
    window.__probe.floor = Math.floor(3.7);     // delegates to real Math
    window.__probe.now = Date.now();            // simulated time
    window.__probe.tid = setTimeout(function () { window.__probe.fired = true; }, 50);
  `;
  // Evaluate the scope block against a window that already has radix installed.
  const w: Record<string, unknown> = { radix: h.radix, Proxy, Reflect, Math, Date };
  new Function("window", prototypeScope(probe))(w);
  const p = w.__probe as { rand: number; floor: number; now: number; tid: number; fired?: boolean };
  // Determinism: a fresh runtime's first random() matches.
  eq(p.rand, createRuntime().random.random(), "Math.random did not use the seeded PRNG");
  eq(p.floor, 3, "Math.floor stopped delegating to the real Math");
  eq(p.now, 0, "Date.now did not read simulated time (clock starts at 0)");
  assert(typeof p.tid === "number", "setTimeout did not return a numeric id");
  assert(!p.fired, "timer fired immediately instead of via the clock");
  h.radix.clock.step(100);
  assert(p.fired, "timer did not fire after stepping the simulated clock");
});

// Every example must parse as a module under the prototype-scope wrapper. This
// is the check that caught the cron.ts unbalanced-paren bug — keep it permanent.
const examplesDir = new URL("./examples/", import.meta.url);
for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith(".ts"))) {
  const mod = (await import("./examples/" + file.replace(/\.ts$/, ""))) as Record<string, { source?: string }>;
  const ex = mod[Object.keys(mod)[0]];
  if (!ex || typeof ex.source !== "string") continue;
  check("example compiles: " + file, () => {
    // Compile-only (never executed); catches syntax errors and any const that
    // collides with the shadowed globals the prototype scope introduces.
    new Function("window", "React", prototypeScope(ex.source as string));
  });
}

// --- summary ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
