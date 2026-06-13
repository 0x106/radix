# Radix

Radix is a prototyping tool. You describe an app, refine it with an agent, and get a working
prototype running in the browser — no backend to stand up, no deploy, no accounts to wire.
Everything the real app would talk to (a database, payments, other users, sensors, the
passage of time) is faked convincingly enough that the prototype behaves like the real thing.

The whole idea rests on one observation:

> **A prototype is just JavaScript surrounded by a library of fakes.**

Build that library once, and the agent only has to write the genuinely app-specific part —
the component and its logic. Everything underneath is provided.

This document is the canonical description of what Radix is and how its runtime works. It
supersedes the older design notes (`notes.md`, `plan.md`, `runtime-contract.md`, the dated
logs), which remain as history.

---

## Two foundations

Most app builders assume every app is CRUD-on-a-database. Radix doesn't. It stands on two
co-equal foundations:

1. **The data foundation** — a schema-driven fake database with synchronous queries and
   reset-to-seed. This is what habit trackers, dashboards, and shops are made of.
2. **The world foundation** — a deterministic, steppable simulator that produces events over
   time: a clock, an event bus, seeded randomness, and stateful actors. This is what chat
   bots, cron workers, games, and collaborative apps need — *something to react to*.

The world foundation is what separates Radix from a CRUD-to-UI generator. A prototype can use
either foundation or both.

---

## The runtime surface: `window.radix`

A prototype reaches everything outside itself through a single global, `window.radix`,
installed before the component runs. Its full shape is typed in `src/runtime/types/`
(`db.ts` for the data foundation, `world.ts` for the world foundation, `index.ts` for the
root). The implementation is `src/runtime/source.ts` — a hand-written, ES5-ish browser-JS
string that is inlined into the prototype's HTML so it runs inside the sandboxed iframe with
no build step.

| Handle | What it is |
| --- | --- |
| `db` | Schema-driven entity store. `define / create / update / delete / get / query / subscribe / reset / dump / schema`. Synchronous; `subscribe` fires immediately with current rows. Persisted to IndexedDB; `reset()` returns to the declared seed. |
| `events` | Topic-based publish/subscribe bus for the world. |
| `clock` | Simulated time. `now / play / pause / step / fastForward / setTimeout / onFrame`. All delayed work routes through here so it can be paused, stepped, and replayed. |
| `random` | Seeded PRNG (`random / int / pick`). Same seed ⇒ same sequence. |
| `log` | Simulation console log, stamped with simulated time; subscribable, capped at 2000 entries. |
| `actor(config)` | A stateful, async-capable world process: optional `start`, timer `tick` (with jitter), and reactive `on` event handlers. |
| `services` | Faked external services (`email`, `payment`, `sms`); their delays honour the simulated clock. |
| `stub` | The graceful-degradation hook: declare what is faked/partial so the UI can show an honest "what's real" panel. |

### Determinism is the core guarantee

Pause the clock, step forward, and the same events fire in the same order every time, because
nothing in a prototype is allowed to be non-deterministic behind the runtime's back:

- All scheduled work goes through `clock.setTimeout` (and `onFrame` for render loops).
- All randomness goes through the seeded `random`.
- `db.reset()` replays the seed exactly.

To make this hold even when an app reaches for the usual globals out of habit, the packaging
step (`src/runtime/packaging.ts`) runs the component inside a scope that **shadows the
non-deterministic globals** — `Math.random`, `Date`/`Date.now`, and `setTimeout` /
`setInterval` / `clearTimeout` / `clearInterval` — redirecting them at the runtime. This is
purely lexical: it affects only the prototype's own code, never React (a separate module that
captured the real globals) and never `window.*`. Game render loops should still use
`clock.onFrame`; `requestAnimationFrame` is deliberately left alone so rendering stays smooth.

### Schema and validation

`db.define({ collection: { fields, seed, immutable } }, { strict })` declares collections.
Fields carry a type (`string` / `number` / `boolean` / `enum` / `ref`), optional `default`,
and optional `required`. In strict mode violations throw; otherwise they warn. Beyond type
checks the store also surfaces the quiet mistakes that used to fail silently: updating an id
that doesn't exist, querying an undeclared collection or an unknown field, and `include`
relations whose foreign key resolves to nothing. Collections marked `immutable: true` are
append-only — update/delete are refused.

---

## Packaging and hosting

`src/runtime/packaging.ts` turns a component's source into one self-contained HTML document:
it loads React from a CDN, inlines the runtime, wraps the component in the determinism scope,
and mounts whatever the component assigns to `window.App`. The result is a single blob.

**Security model.** A prototype runs arbitrary JS and may hold user-entered data, so the HTML
**must** be hosted in a cross-origin, `sandbox="allow-scripts"` iframe. The runtime's
postMessage bridge — how the Radix shell inspects and drives a prototype (dump state, step the
clock, read the log) — only trusts the prototype's **direct parent window**, and can be
further pinned to an exact shell origin via `wrapPrototype({ shellOrigin })`. It never
broadcasts: replies go back to the sender at its exact origin, and unsolicited state pushes go
only to the parent learned from the first accepted message.

---

## Publishing

`src/publish/` is the dev tooling that pushes prototypes to InstantDB. `pushProject` uploads
the HTML to Instant Storage and creates an owner-linked `projects` record (idempotent per
owner+name). `instant.ts` initializes the Instant admin SDK from `app/.env`
(see `app/.env.example`). Secrets there are gitignored and must never be committed; the admin
token bypasses permission rules and is for local tooling only.

---

## Tests

`npm test` runs a headless harness (`src/tests/runtime.test.ts`) that instantiates the runtime
in Node (memory-only, no IndexedDB) and asserts the core contract: determinism, reset-replay,
immutability, query semantics, strict validation, the locked-down bridge, the determinism
scope, and that every example in `src/tests/examples/` parses under the packaging wrapper.
`npm run push-examples` is the live smoke test that publishes the examples to a Radix account.
