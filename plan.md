# Radix — Implementation Plan

## What we're building

Radix is a tool where a user describes an app, talks to an agent to refine it, and gets a
working, runnable prototype in the browser — fast. Everything the real app would talk to
(servers, databases, other users, payment processors, sensors, hardware) is faked
convincingly enough that the prototype code runs as if it were real. The point is to let
people explore, test, and critique an app _before_ anyone writes production code.

The core insight that drives the whole architecture: **a prototype is just JavaScript
surrounded by a library of fakes.** We build the library once and reuse it. The agent's job is to
configure the library and write the genuinely app-specific bits.

### Two foundations, not one

Most "build me an app" tools assume every app is a screen on top of a database. About half
the apps we care about are not that — they're back-end services, jobs, bots, and APIs that
sit idle until _something happens to them_. So we build TWO core engines, treated as equals:

1. **The data foundation** — schema → fake database → fake API. (CRUD apps.)
2. **The world foundation** — a simulator that produces events over time, so reactive apps
   have something to react to. (Chat messages arriving, a driver moving, logs streaming,
   webhooks firing, cron ticking.)

Everything else (service mocks, UI shells, sensor fakes) hangs off these two.

## Tech stack

- **Next.js + React + Tailwind** — app framework and UI.
- **pnpm** — package manager.
- **OpenAI API** — the agent (intake conversation, code generation, refinement).
- **InstantDB** — real persistence where it's genuinely needed (saved projects, the manifest
  of decisions, anything that must survive across sessions and devices).
- **IndexedDB** — the per-prototype fake database, and most local persistence. Each generated
  prototype gets its own IndexedDB namespace so its fake data survives a page refresh.
- **Generated prototypes should persist by default.** When someone builds something and comes
  back, their fake data and state should still be there unless they reset it.

## Persistence model (decide early — it ripples everywhere)

Three tiers, keep them clearly separated:

- **Platform data (InstantDB):** projects, the agent's decision record / manifest, library
  elements, user accounts on Radix itself, generated source code. This is Radix's own real
  database.
- **Prototype data (IndexedDB, namespaced per prototype):** the fake database for a generated
  app. Survives refresh. Resettable to a seed on demand. This is the "save where possible"
  requirement.
- **Ephemeral run state (memory):** the live simulation clock, in-flight events, the current
  frame of a game loop. Gone on refresh by design — but reconstructable from prototype data +
  seed so a reload feels continuous.

A prototype reload should restore: its IndexedDB data, its seed (so the world-simulator
replays deterministically), and the last manifest. It should NOT try to restore mid-flight
ephemeral state — it replays from the seed instead.

---

## Phase 0 — Spike before committing

Don't build the agent yet. Hand-build 2-3 prototypes directly against the runtime to discover
the real contract between "prototype code" and "the library of fakes."

- [ ] Hand-build a simple CRUD app (e.g. habit tracker) wired to a hand-written fake DB.
- [ ] Hand-build a reactive app (e.g. a chat screen) wired to a hand-written world-simulator.
- [ ] Hand-build a headless thing (e.g. a cron worker) with only a debug console, no real UI.
- [ ] From these three, write down the exact JS interface a prototype uses to talk to the library
      (how it reads/writes data, how it subscribes to events, how it calls a service mock).
      THIS INTERFACE IS THE REAL SPEC. Everything downstream targets it.

## Phase 1 — The runtime harness (the fake computer)

The sandbox the prototype runs inside, plus the plumbing that intercepts its calls to the
outside world. Build this before the agent, because it defines what the agent must emit.

- [ ] **Sandbox / execution context.** Decide how generated JS runs isolated from the Radix
      shell. Likely an iframe per prototype (clean global scope, own IndexedDB namespace,
      easy to reset by reloading the frame). Establish the message channel between the Radix
      shell and the prototype frame.
- [ ] **Network interception.** Patch `fetch` (and any XHR) inside the prototype frame so all
      requests are routed to the fake API layer instead of the real network. Generated apps
      "call the server" and we answer.
- [ ] **Time control.** A simulation clock the prototype reads instead of the real clock.
      Pausable, steppable, fast-forwardable. Critical for cron/jobs/timers and for
      deterministic replay. The world-simulator and any `setTimeout`-style behaviour route
      through this clock, not the real one.
- [ ] **The prototype runtime API** — the handles generated code uses to reach everything
      outside itself. Frozen, documented, versioned. This is THE contract; everything targets
      it. Organised in four layers (the first two are identical for every app; `host` varies
      per shell). Keep the total under ~12 handles — every handle is forever.

      Talking to the fakes (the library):
      - `db` — structured entity data (the schema-driven store)
      - `api` — call "the server"; auto-CRUD plus custom endpoints
      - `services` — the shelf: auth, payments, email, etc. (request/response)
      - `sensors` — signal sources you subscribe to, not call (heart rate, GPS); separate from
        `services` because they're streams, not request/response
      - `events` — subscribe/publish to the world-simulator's event bus

      Talking to time and randomness (must be controlled, never real):
      - `clock` — simulated time; steppable, pausable, fast-forwardable (`now` lives here as
        `clock.now()` rather than a separate top-level handle)
      - `random` — seeded randomness. The app MUST use this, never real `Math.random()`, or
        deterministic replay breaks. Block the real one inside the sandbox.

      Talking to the shell it lives in:
      - `host` — what am I running in? Native-style notifications, viewport, back/rotate/resize,
        stdin/stdout for terminals, the host-app API for embedded shells. This is an INTERFACE
        with per-shell implementations, not one fixed object — a terminal's `host` and a
        phone's `host` differ.
      - `storage` — simple persistent key-value (settings, drafts, preferences), per-prototype,
        separate from the entity DB.

      Talking to Radix / the meta-layer:
      - `stub` — the graceful-degradation hook; declare "this part is faked, here's what's
        missing" so it surfaces in the manifest and UI (degradation is first-class, so it needs
        a first-class API, not a code comment)
      - `log` — emit to the simulation console's event log; the app's window into the cockpit

- [ ] **Reset / replay.** Wipe the prototype's IndexedDB back to seed; restart the clock; the
      app should come up identically. This is what makes testing repeatable.
- [ ] **Resume rule: persisted state is the source of truth.** When an app persists state that a
      world-simulator actor also influences (e.g. an order's status while a driver actor is
      moving), reload must NOT blindly replay the actor from seed-zero — that can teleport the
      driver to a position inconsistent with the persisted status. Rule: on reload, restore
      persisted state first, then have the simulator RESUME FROM it, not replay from the
      beginning. (Surfaced by the food-delivery walkthrough; see notes §9.)

## Phase 2 — The data foundation (fake DB + fake API)

The biggest single source of leverage. Build once, works for any schema.

- [ ] **Schema representation — two layers, and the distinction is the whole point.** A naive
      reading of "loose guideline" contradicts "generate a precise store from it." Resolve it
      by splitting the schema into two regions: - **Strict core** — entities, fields, types, relationships. This is NOT loose. It has a
      fixed, validated vocabulary because the store, the auto-CRUD API, and the seed
      generator all read it mechanically. "Order has a total which is a number, belongs to a
      Customer" must be precise or nothing downstream works. - **Open extension layer** — a free-form bag for everything the core can't express:
      domain quirks, validation rules, computed-field hints, display hints, notes to the
      agent. The generic machinery ignores it; the agent and custom code read it. This is
      where "guideline not straitjacket" actually lives.

      So the looseness sits in a clearly-marked open region AROUND a strict core, not in the
      core itself. Example shape:
      ```
      Order:
        fields:        # strict core — the engine reads this
          total:  { type: number }
          status: { type: enum, values: [pending, paid, shipped] }
        relations:     # strict core
          customer: { belongsTo: Customer }
          items:    { hasMany: LineItem }
        extensions:    # open layer — engine ignores, agent/custom code reads
          statusFlow: "pending must precede paid"
          displayHint: "timeline"
      ```

- [ ] **One generic store engine, configured per app — NOT generated per app.** We write the
      store ONCE. It reads any schema's strict core at runtime and configures itself: creates
      IndexedDB object stores, sets up indexes from relations, satisfies queries. The schema is
      DATA fed to a fixed engine, not a template that emits new code. "Per app" means "the one
      engine pointed at this app's schema" — same move as the world-simulator being one
      configurable engine.
- [ ] **Query reality check.** IndexedDB indexes single fields well; compound and relational
      queries less so. The engine loads via IndexedDB and does relational/filter work in JS on
      top. Fine at prototype volumes — keep seeds to hundreds-to-thousands of rows, not
      millions. Don't expect Postgres behaviour.
- [ ] **Custom endpoint hook = the escape hatch.** When the generic engine genuinely can't
      express some query or logic, the agent writes a custom `api` endpoint rather than bending
      the generic store. Generic engine covers ~80%; escape hatch covers the rest; the open
      extension layer carries metadata that fits neither.
- [ ] **Seed-data generation.** Generate plausible, realistic starter data from the strict core
      so apps aren't empty. Seeded/deterministic so resets repeat. Use the OpenAI API to make
      fake data believable (real-sounding names, sensible values).
- [ ] **Persistence wiring.** Per-prototype IndexedDB namespace; survive refresh; reset to seed.
- [ ] **OPEN QUESTION — state machines & field-write-ownership.** Two real constraints the schema
      can currently only _hint_ at via the open layer, not enforce: (a) an enum field is often
      really a state machine with legal transitions (an order's status), and (b) some fields may
      only be written by one writer (a driver's position, written only by the simulator, never by
      user CRUD). Decide whether these deserve first-class support in the strict core or stay as
      code-enforced conventions. Current lean: conventions for now, but flagged because state
      machines recur in EVERY reactive app with a lifecycle. (Surfaced by the food-delivery
      walkthrough; see notes §6.)

## Phase 3 — The world foundation (the event simulator)

The second engine. Makes reactive and realtime apps feel alive instead of dead.

- [ ] **The simulated actor / world-process primitive.** A configurable engine that emits
      events over the simulation clock: on a schedule, at random intervals, or in response to
      app actions. Seeded so a given seed always produces the same sequence (deterministic
      replay).
- [ ] **Event bus.** How emitted events reach the prototype (the `events` part of the runtime
      API). Subscribe/publish.
- [ ] **Configurable behaviours.** Parameterise the actor: frequency, randomness, event shape,
      stop conditions. One engine, configured per app (a chat "other person", a moving driver,
      a log stream, incoming ride requests, a webhook source).
- [ ] **Stochastic-but-reproducible.** Randomness flows from the seed, never `Math.random()`
      directly, so "run it again" gives the same run.
- [ ] **Library pattern: "action that spawns an actor."** A recurring shape where a user action
      (a custom `api` endpoint) doesn't just write data — it _starts a world-simulator actor_.
      Showed up as "place order" (kicks off the restaurant→driver→delivery process) and recurs in
      ride-share (request → driver actor), booking (confirm → fulfilment), KYC (submit → approval
      process). Name and reuse it rather than re-deriving per app. (Surfaced by the food-delivery
      walkthrough.)

## Phase 4 — The simulation console (cockpit for driving prototypes)

For apps with no UI to click (jobs, APIs, bots) and for debugging any app. Build once, reuse
everywhere.

- [ ] **Clock controls** — play / pause / step / fast-forward simulated time.
- [ ] **Event injector** — manually fire an event ("pretend a payment webhook just arrived").
- [ ] **Event log** — everything that's happened, in order.
- [ ] **State inspector** — peek at the current fake-DB contents and world state.
- [ ] **Failure-injection controls.** Configure the failure/decline/timeout rate of any service
      mock, seeded so it's reproducible. Surfaced as a standard console control, not a per-app
      afterthought — the seeded occasional payment decline turned out to be one of the most
      valuable testing affordances. (Surfaced by the food-delivery walkthrough; see Phase 5.)
- [ ] **Request console** — fire requests at a headless API prototype and see responses.
- [ ] Sits beside the prototype for UI apps; _is_ the main interface for headless ones.

## Phase 5 — Service mocks (the shelf of fakes)

Each is a small module with a realistic interface, realistic latency, and realistic failure
modes (they should sometimes fail/decline/timeout, because real services do). The agent picks
from the shelf; it does not reinvent these. Failure rates are SEEDED (notes §9) so "the 3rd
charge declines" is reproducible, and tunable via the simulation console (Phase 4) — seeded
failure injection is a first-class testing affordance, not an afterthought.

- [ ] Auth / login (fake users, sessions, roles — needed by ~12 of the 40 apps)
- [ ] Payments / Stripe-style (charge, decline, refund)
- [ ] Notifications / push
- [ ] Email / SMS (delivered into a viewable fake inbox)
- [ ] File upload / storage
- [ ] Realtime / websocket sync
- [ ] Maps / geolocation / geosearch
- [ ] A common interface + registry so the agent selects and configures by name.
- [ ] A documented pattern for the agent to ADD a new service mock to the shelf when something
      isn't there, and promote it for reuse.

## Phase 6 — Sensor & peripheral fakes

One flexible primitive, configured per device — they all share the shape of "a stateful
source emitting believable readings with lag and occasional glitches." Closely related to the
world-simulator (Phase 3); consider sharing the underlying engine.

- [ ] Generic "signal source" primitive (range, noise, drift, latency, failure).
- [ ] Configurations: accelerometer/step counter, heart rate, GPS-along-a-route,
      barcode scanner, card reader, receipt printer, smart-home device state machines,
      GPIO / actuators (firmware).

## Phase 7 — The shells (frames the prototype renders into)

Mostly cosmetic wrappers around the same prototype; input modality is the real variable.

- [ ] **Viewport shell** with swappable chrome: browser (address bar), phone (notch, tap-only),
      tablet, TV (remote nav), kiosk (touch), desktop window. One shell, different chrome +
      input model. Covers ~24 of the 40 apps.
- [ ] **Text-stream shell** — a terminal: stdin/stdout/stderr, args, exit codes, piping. (CLI,
      REPL.)
- [ ] **Full-screen text (TUI) shell** — character grid, panes, keyboard navigation. (Git TUI.)
- [ ] **Conversational shell** — a transcript of turns, text or voice. (Chatbot, voice/IVR.)
- [ ] **Headless shell** — no human UI; the simulation console (Phase 4) is the whole interface.
      (API service, webhook glue, cron worker, ETL.)
- [ ] **Embedded-in-host shell — HIGH RISK, likely deferred past v1.** The prototype talks to
      another _application's_ API (VS Code, Chrome, macOS tray), so we'd have to fake a chunk
      of that host. Four of the 40 apps. Flag clearly, scope later.

## Phase 8 — Lower-frequency spine patterns (recurring, NOT one-off)

These are real, repeating patterns — just less common than CRUD and the world-simulator.
Build the first time each is needed, then promote to the library and reuse. (Per the user's
correction: treat these as proper tiers, not bespoke exotica.)

- [ ] **Frame-loop runtime** — a 60fps tick: redraw, input, movement, collision. Reused by
      games, firmware, trivia, and any animation-heavy UI. Build a reusable loop + input +
      canvas-render scaffold.
- [ ] **Document model with undo/redo** — a rich in-memory document, command history, load/save
      as file-shaped data. Reused by creative tools, both editors, local-first apps.
- [ ] **Declarative diff/apply** — desired-state vs current-state, show a preview, confirm,
      apply. Reused by IaC tools and generalises to any "preview changes before commit" flow.
- [ ] **Pure-compute pipeline** — input → transform → output with logs; little persistent state.
      Reused by CLI tools, ETL, compilers/REPLs.

## Phase 9 — Graceful degradation (a first-class feature, not an afterthought)

When real emulation is too hard, the agent builds what it can and is honest about the gap.
This must be a proper, visible concept — not silent failure.

- [ ] **The "stub" concept.** A first-class way to mark "this part is faked/partial, here's
      what's missing." Recorded in the manifest, surfaced in the UI.
- [ ] **Worked example: collaborative editing.** Faking one scripted second cursor is easy;
      correct real-time conflict resolution (OT/CRDT) is a research problem. The agent fakes
      the _appearance_ (a scripted collaborator) and clearly states the real merging isn't
      implemented. Use this as the reference pattern.
- [ ] **User-facing explanation.** When the agent stubs something, it tells the user plainly
      what's real and what's pretend.

## Phase 10 — The agent (intake → manifest → code → iterate)

Only now, on top of a working library of fakes. The agent orchestrates; it doesn't reinvent the
foundations.

- [ ] **Intake conversation.** User gives a rough description; agent asks clarifying questions
      to pin down what's really being built. (OpenAI API.)
- [ ] **The manifest / decision record.** A structured-but-flexible record of what the agent
      decided: schema, which shell, which spine(s), which service mocks, world-simulator
      config, and crucially **where it drew the real-vs-faked boundary and why** (the human
      "set the fiddly bits aside" move). A guideline format, extensible, not a hard schema.
- [ ] **Code generation.** Agent emits prototype code targeting the Phase-1 runtime API,
      configures the data + world foundations, selects service/sensor mocks off the shelf.
- [ ] **Library-aware generation.** Agent prefers existing library elements; generates new ones
      only when needed.
- [ ] **Iteration loop.** "Change X" edits the relevant slice of the manifest and regenerates
      only the affected pieces — NOT the whole app from scratch. Design for partial regen from
      the start.
- [ ] **Visual variety.** Generated UIs should look genuinely different from each other — don't
      converge on one default aesthetic. (Distinct fonts, color, layout per app.)

## Phase 11 — The library system

The thing that lets quality compound over time.

- [ ] **Storage & retrieval** of templates, runtimes, components, service mocks, sensor configs,
      spine patterns (in InstantDB).
- [ ] **Contribution pipeline.** Agent-generated elements start app-local / quarantined. Promote
      to the shared library only after they recur, get generalised, and are reviewed —
      otherwise the library fills with near-duplicate one-offs.
- [ ] **The mapping campaign.** Generate many test apps, observe which library elements recur,
      grow the library deliberately. (Do this AFTER the manifest + harness are stable, or the
      analysis churns.)

## Cross-cutting concerns (track throughout, don't bolt on later)

- [ ] **Determinism.** Seeded everything; reproducible runs are required for testing. The app
      uses the `random` handle, never real `Math.random()` — block the real one in the sandbox.
- [ ] **Reset / replay** as a universal capability across every prototype.
- [ ] **The runtime API contract** is the spine of the whole system — version it, freeze it,
      document it; everything else targets it.
- [ ] **Isolation & safety.** Generated code runs sandboxed; it can't touch Radix's own data or
      escape the prototype frame.
- [ ] **Real-vs-faked boundary** recorded explicitly per app — this is the product's core idea.

## Build order summary

Foundations first (data + world), then the cockpit and the shelf of fakes, then the shells,
then the rarer spine patterns, then graceful degradation, then the agent, then the library.
The agent comes late because it orchestrates a library of fakes that has to exist first. The two
biggest reusable engines — the fake database and the world-event simulator — are where the
leverage is, so they get built and hardened before anything depends on them.
