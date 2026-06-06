# Radix — Runtime contract (Phase 0 findings)

> Loose, living notes from the Phase 0 examples (`plan.md` Phase 0). We hand-built
> three prototypes directly against a throwaway runtime shim to discover the real
> interface between **prototype code** and **the library of fakes**. This file
> records what that interface wants to be. It is the input to Phase 1, where the
> runtime gets frozen, documented, and versioned — **not** a frozen spec itself.
>
> Companion files: the typed surface lives in `src/lib/contract.ts`; the
> throwaway implementation in `src/lib/runtimeSource.ts`; the three apps in
> `src/tests/examples/{habits,chat,cron}.ts`. All of `src/lib/` is expected
> to be rewritten in Phase 1 — its job was to make this contract visible.

## What we built

| Prototype       | Spine (`notes.md` §4)                   | Handles exercised                                            |
| --------------- | --------------------------------------- | ------------------------------------------------------------ |
| **Habits**      | CRUD-schema                             | `db` (create/update/delete/get/query/subscribe/reset), `log` |
| **Chat**        | Reactive-handler                        | `events`, `spawn` (actor), `clock`, `random`, `db`, `log`    |
| **Cron worker** | Reactive + clock-advanced, **headless** | `clock` (step/fast-forward), `log`, `db`                     |

All three reach the library through a single global, `window.radix`, injected by
`wrapPrototype` before the component runs — the same mechanism `wrapReactApp`
already uses to expose `window.React`. That worked cleanly and is a reasonable
shape for Phase 1 too (until the real harness moves to a postMessage bridge).

## The surface that emerged

Prototypes touch the library through these handles. (Only a subset of the
eventual ~12 from `notes.md` §5 — that's the point of an example.)

### `db` — the schema-driven store

```
db.create(collection, data)            -> entity (id auto-filled)
db.update(collection, id, patch)       -> entity (shallow merge)
db.delete(collection, id)
db.get(collection, id)                 -> entity | undefined
db.query(collection, { where?, order?, limit? }) -> entity[]
db.subscribe(collection, cb)           -> unsubscribe   // fires immediately with current rows
db.reset()                             // wipe back to seed
```

What the apps actually needed, and what it tells us:

- **`subscribe` firing immediately with the current rows** was the single most
  useful affordance — it makes the React `useEffect(() => db.subscribe(...))`
  pattern a one-liner with no separate initial read. Keep this in the real API.
- **`query` is equality-`where` + single-field `order` + `limit`.** That covered
  all three apps. Nothing needed `$gt`/`$in`/compound filters yet — consistent
  with the plan's "generic engine covers ~80%, custom endpoints cover the rest"
  (`notes.md` §6). When that breaks, it should break toward an `api` custom
  endpoint, not a fatter `query`.
- **`reset()` belongs on `db`** even though our store is in-memory. Habits' "Reset
  to seed" button and the determinism story both lean on it. The _seed itself_
  needs a home: in the example we used a non-contract `db.__seed(fn)` that the app
  calls at module load and that re-runs on `reset()`. Phase 1 should give seeding
  a real, first-class slot (probably manifest-driven, not an app call).
- **No relations were exercised.** All three apps used flat collections. Relations
  (`belongsTo`/`hasMany` from `notes.md` §6) are still unproven against real app
  code — worth a dedicated example before the generic engine is designed.

### `events` — the world-sim bus

```
events.subscribe(topic, cb) -> unsubscribe
events.publish(topic, payload)
```

Dead simple and sufficient. Chat used one topic (`chat:incoming`) with both the
actor and a user-triggered one-off publishing onto it. The seam where **a user
action publishes the same event an actor does** (sending a message schedules a
reply via `clock.setTimeout` → `publish`) is exactly the "action that spawns an
actor" pattern (`notes.md` §12) in miniature — it felt natural and worth naming.

### `clock` — simulated time

```
clock.now() / isRunning()
clock.play() / pause()
clock.step(ms) / fastForward(ms)
clock.setTimeout(fn, ms) -> cancel        // simulated-time delay
clock.subscribe((now, running) => …) -> unsubscribe
```

- **`clock.setTimeout` is the workhorse.** The cron job re-schedules itself with
  it; chat schedules replies with it; the actor primitive is built on it. Routing
  _all_ delayed work through the clock (never real `setTimeout`) is what makes
  pause/step/fast-forward actually control the app. Confirmed: this must be the
  only timer prototypes can reach.
- **`clock.subscribe` was needed by every console-ish UI** (chat's time readout,
  cron's whole header). It wasn't in the original `notes.md` §5 sketch; add it.
- **Real-time advance + manual step coexisting** worked well: "play" maps real ms
  to sim ms 1:1, while step/fast-forward jump instantly, firing everything due in
  between. The headless cron worker is the proof — it is _only_ drivable by these
  controls, which validates the Phase 4 console direction.

### `random` — seeded randomness

```
random.random() / int(min,max) / pick(arr)
```

Chat's actor used `int` (jitter) and `pick` (replies). Determinism held: reload
replays the same sequence. **Caveat we hit:** we deliberately did **not** override
the real `Math.random()` globally — React's CDN build may use it and clobbering it
risks breaking the renderer. So "the app must use `radix.random`" is enforced by
convention here, not by blocking the real one. `notes.md` §9 wants the real one
blocked; Phase 1 needs a safer way (e.g. block it only in the app's own module
scope, or lint/transform generated code) rather than a global override.

### `log` — the simulation console feed

```
log(level, msg, data?)  +  log.debug/info/warn/error(msg, data?)
log.entries() -> LogEntry[]
log.subscribe(cb) -> unsubscribe
```

Every app logged; the cron console is _built_ from `log.subscribe`. Stamping each
entry with `clock.now()` (sim time, not wall time) was obviously right and made
the cron log read like a real worker. Keep the sim-time stamp.

### `spawn` — the actor primitive (world simulator)

```
const a = radix.spawn({ topic, everyMs, jitterMs?, produce(n), count? })
a.start() / stop() / isRunning()
```

The hand-written precursor to "one configurable simulator engine" (`plan.md`
Phase 3). One seeded, clock-driven, self-rescheduling emitter covered the chat
"other person" with room to spare. Open shape questions for Phase 1: does `spawn`
live under `events`, or is it a separate `sim`/`world` handle? How do multiple
actors and stop-conditions compose? Only one actor was exercised here.

## Open questions this example touched (carried forward)

- **State machines & field-write-ownership (`notes.md` §6).** Both showed up
  concretely. Cron's `queue.status` (`pending → running → done`) is a state
  machine the store can't enforce — nothing stops an illegal jump. And several
  fields have exactly one legitimate writer (the actor writes chat messages from
  "them"; the worker writes job status) — the store doesn't know that. We left
  them as conventions, as the plan currently leans. Still flagged: every reactive
  app here had a lifecycle enum, so first-class support may pay off.
- **Resume rule (`notes.md` §9).** Not exercised — our store is in-memory, so
  reload restarts from seed rather than resuming persisted-mid-flight state. The
  driver-teleport problem the plan describes can't appear until persistence
  (IndexedDB) lands. Re-test this the moment Phase 1/2 adds real persistence.
- **Seeding's home.** `db.__seed` is a example hack. Where seed data is declared,
  and how `reset()` re-applies it deterministically, needs a real design.

## Handles NOT exercised (deferred, with where they'd slot)

- `api` — call "the server" / custom endpoints. None of the three needed a custom
  endpoint; the escape hatch is unexercised. (`plan.md` Phase 2.)
- `services` — auth/payments/email/etc. No external service appeared. (Phase 5.)
- `sensors` — streaming signal sources. No sensor app in this set. (Phase 6.)
- `host` — the per-shell-variable handle (notifications, viewport, stdin/stdout).
  Cron is morally "headless host = the console," but we faked the console _inside_
  the prototype instead of via a `host`/shell boundary. This is the biggest gap
  vs. `notes.md` §5 and the trickiest part of the real contract (`notes.md` §13).
- `storage` — key-value settings. Not needed; `db` sufficed.
- `stub` — graceful-degradation declarations. Nothing was stubbed. (Phase 9.)

## Bottom line for Phase 1

The `db` / `events` / `clock` / `random` / `log` surface above held up under three
genuinely different app shapes with almost no friction. The notable _additions_
over the original `notes.md` §5 sketch: `db.subscribe` and `clock.subscribe`
(reactive reads), sim-time-stamped `log`, and a first-class seed mechanism. The
notable _unresolved_ items: the `host`/shell boundary (we sidestepped it), the
`Math.random()` blocking strategy, relations, and the persistence-dependent resume
rule. Build the frozen Phase 1 runtime around this surface; example `host` and
relations next.
