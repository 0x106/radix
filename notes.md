# Radix

Radix is a platform designed to let users and AI agents collaboratively build interactive software prototypes. To prevent the
AI from starting from scratch every time, the platform provides a library of pre-built technical primitives. This includes UI "shells"
for different surfaces (web, mobile, CLI, desktop, native) and a library of standardized mock services (auth, databases, payments).
By confining the prototype to a single language environment (like JavaScript) and strictly mocking all external dependencies, the
agent can rapidly wire together functional (but constrained) applications without getting bogged down by production infrastructure
or edge cases.

Technically, the system is designed around an "extraction-based" architecture rather than a rigid, top-down specification. To preserve the
AI's ability to improvise or "fudge" logic, the agent freely builds the mock application first. A lightweight extraction layer then reads
the resulting code to generate abstract, non-text visual representations (such as state machines or flow diagrams) that the user can interact
with. The only exception to this flexible approach is the data model: the platform uses a thin, authoritative data schema to define entities
and relationships. This schema acts as a single source of truth to automatically generate the mock database shape, seed data, and UI forms,
ensuring structural consistency while keeping the behavioral logic entirely flexible.

- model all code in javascript
  - easy to prototype with
  - easy to simulate interfaces etc
  - easy to integrate mock third party services
  - 'in js' is a red herring
    - the important bit is that everything can be mocked
  - can verify, model, test, analyse, prototype
    -- a "prototype engine for software"
  - can build the holistic view UI around it
  - can subsume eval platform into it
  - monitoring

- user submits first request / general outline
- agent runs an interrogation loop to build a better description
- agent builds data schema

---

Radix is a prototyping tool for software. Users collaborate with an agent to build a working prototype of (ultimately) any type of application;
with external services, users, and databases all mocked as necessary. The radix runtime provides simulation tools for running the prototype
as if it was running in its native environment. Web apps run as if they're in a browser, mobile apps as if they're on a mobile device,
native applications as if they're running on a host operating system. Where the simulation environment can't provide adequate simulation (i.e.
in cases where emulation is too difficult) the agent either builds what it can or gracefully falls back and explains to the user.

The goal is to get to a working version of the application as quickly as possible, so that the user can experiment, explore, critique, discuss,
test, and evaluate before they start writing real code. Other existing tools strive to implement a fully working version of a particular application,
but they often fall short at the design, iteration, test stage.

In the first version we are going to write everything in Javascript, and it will be running on the web. This is a deliberate choice to limit
the surface area of code that the agent has to reason about, and because JS is an excellent choice for building mocked applications for a
variety of runtimes.

The process starts with a user submitting a general description of what they want to build. The agent spends some time querying the user to find
out further details, and to get a better idea of what exactly they're building. The core of the application that they build is based around a
data schema, and an auto-generated database. The agent then builds an API to interact with the database, and begins building any interfaces / UI
(if necessary) and the relevant components. Any necessary services are mocked, i.e. user authentication, stripe, sensor access, etc etc.

Importantly, we provide the agent with a comprehensive library of prebuilt templates, runtimes, components, services, and tools. Where something
doesn't exist the agent can generate it and add it to the library. During development I am going to get an agent to generate large numbers of
test applications and map out the types of library elements that will be necessary.

- We can simulate real behaviour, so you can see how things perform before commiting engineering resources.
- Users could be asked to upload real data -- maybe it would build a data capture pipeline for them to use?

---

# Radix — Design Notes (living document)

> This is the discussion document. It explains _why_ Radix is shaped the way it is — the
> problem, the core ideas, the reasoning behind the big decisions, the tensions we've hit and
> how we resolved them, and the things still open. The companion `plan.md` is the _what_ and
> _in what order_; this file is the _why_. When the two disagree, this file is where we argue
> it out, then update the plan.

---

## 1. The problem we're solving

People who want to build software spend a lot of effort getting to the _first working version_
they can actually react to. You can't really tell whether an app is right by reading a spec or
looking at static mockups — you find out by _using_ it: clicking around, hitting the awkward
flows, feeling where it's wrong. But getting to something usable normally means building real
infrastructure first: a backend, a database, auth, integrations with payment and email and
maps and whatever else. That's slow, and most of it gets thrown away once you've learned what
you needed to learn.

Existing tools mostly try to build the _real_ thing — a genuinely working app with real
services wired up. They're impressive, but they stumble exactly at the stage that matters most
early on: design, iteration, and testing. They're optimised for "ship it," not for "let me
feel this out and change my mind ten times."

**Radix optimises for the feel-it-out stage.** The goal is to get to a working, runnable
prototype as fast as possible — something the user can experiment with, poke at, critique,
demo, and iterate on — _before_ committing to real code. The bet is that a convincing fake you
can use in five minutes is worth more, at this stage, than a real implementation you get in
five days.

### The human move we're imitating

When experienced people build software, they don't build everything at once. They look at a
system, spot the parts that are fiddly, finicky, or need real-world setup (payment processing,
third-party APIs, hardware, auth flows), and they _deliberately set those aside_ — stubbing or
faking them — so they can get the core working and judge it. They draw a boundary between
"build this for real now" and "fake this for now, it's not where the risk or the learning is."

That boundary-drawing is the core skill Radix automates. The agent's most important job isn't
writing code — it's deciding, like a good engineer would, **what to build and what to fake**,
and being honest about which is which. This is the thing that distinguishes Radix from a
general "build me an app" coding agent: Radix is _explicitly allowed and expected_ to say "a
real version of this exists but it's fiddly, so I'm simulating it for now."

---

## 2. The core idea: a prototype is JavaScript wrapped in a library of fakes

The mental model that makes the whole thing tractable: **the user's prototype is ordinary
JavaScript, and we surround it with convincing fakes of everything it would normally talk to** —
a server, a database, other users, a payment processor, a GPS chip, hardware peripherals. The
prototype code can't tell the fakes from the real thing, so it just runs.

This is why v1 is all JavaScript on the web. It's a deliberate constraint: it keeps the surface
area of code the agent has to reason about small, and JS is genuinely good at _mocking_ a wide
range of runtimes (you can fake a phone, a terminal, a server, a sensor, all in a browser tab).

We are not building 40 different things. We're building a handful of solid, reusable engines
plus a shelf of fakes, and then letting the agent glue them together and write only the
genuinely app-specific corners. Most of the apps we care about turn out to be remixes of the
same few engines.

---

## 3. Two foundations, not one

The single most important structural decision. The obvious assumption — the one most tools
make — is that every app is _a screen on top of a database_. That covers a lot of consumer
software, but it's wrong for roughly half of what actually gets built day to day: back-end
services, background jobs, bots, APIs, integration glue, ETL. Those don't sit there waiting for
a user to click. They sit idle until _something happens to them_ — an event arrives, a timer
fires, a request comes in.

So Radix has **two co-equal core engines:**

1. **The data foundation** — schema → fake database → fake API. Serves the CRUD-shaped apps
   (the screen-on-a-database majority).
2. **The world foundation** — a simulator that produces events over time, so reactive apps have
   something to react to. Serves chat (messages arriving), delivery (a driver moving), monitoring
   (logs streaming), webhooks (events firing), cron (time ticking), games and markets (a
   simulated other side).

Calling these co-equal is the point. If we only build the data foundation, we've built a
competitor to the existing screen-on-a-database tools. The world foundation is what lets Radix
handle the unglamorous, high-volume, "actually built every day" software those tools handle
worst — and it's where a lot of the differentiation lives.

Everything else (service mocks, sensor fakes, UI shells) hangs off these two.

### Why "the world simulator" keeps coming up

It's worth being explicit because it's easy to under-weight. A huge fraction of apps are
_mostly_ "respond to a stream of things from outside." The interesting, hard, valuable part of
those apps is simulating the outside — the other chat participants, the market generating ride
requests, the fleet of devices changing state, the pipeline emitting build events. We build
_one_ general engine for "produce believable events over time, seeded so it's reproducible,"
and configure it per app. It's the second-biggest piece of the system after the fake database,
and it's what makes prototypes feel alive instead of dead.

---

## 4. The three axes (how we reason about coverage)

When we mapped 40 representative apps, three independent axes fell out. Any app picks a value
(sometimes more than one) on each, and the _combination_ — not any single axis — determines
what gets built. Keeping these orthogonal is what lets a small number of reusable parts span a
large space of apps.

**Presentation shell — where output goes and input comes from:**

- _Viewport_ — a rendered visual surface (web, mobile, tablet, TV, kiosk, desktop). These differ
  in chrome and input modality (mouse / touch / remote / pen), not in kind. ~24 of 40 apps.
- _Text-stream_ — a terminal: stdin/stdout/stderr, args, exit codes, piping.
- _Full-screen text (TUI)_ — a character grid with panes and keyboard nav.
- _Conversational_ — a transcript of turns, text or voice (chat, bots, voice/IVR).
- _Headless_ — no human UI at all; output is data, logs, side effects, API responses.
- _Embedded-in-host_ — renders inside another app (editor/browser extension, OS tray widget).
  The host's own API is both the runtime and the thing to be faked. **Hardest category.**

**Spine — what the app is organised around:**

- _CRUD-schema_ — entities, persistence, queries. The common case (~21 apps).
- _Reactive-handler_ — idle until an event arrives, then transform/respond. The quiet giant
  (~13 apps), and the reason the world foundation exists.
- _Document_ — one rich in-memory document with undo/redo and load/save (editors, creative tools).
- _Frame-loop_ — a continuous tick; state evolves every frame (games, firmware, animation).
- _Pure-compute_ — input → transform → output, little state (CLI, ETL, compiler).
- _Declarative-state_ — desired vs current, with a diff/apply lifecycle (IaC, "preview before
  commit" flows).

**Driver — what makes the app do something:**

- _Human-realtime_ — a person clicking moment to moment. The app's own UI is enough to drive it.
- _Event-injected_ — external events arrive; in a prototype, something must _generate_ them.
- _Clock-advanced_ — nothing happens until simulated time moves (cron, scheduled jobs).
- _Pipeline-run_ — a discrete invocation: run, observe, done.

The driver split matters practically: human-realtime apps are driven through their own UI;
event/clock/pipeline apps need a separate **control surface** to drive the simulation (inject an
event, step time, fire a request). That's the simulation console, and ~20 apps need it.

---

## 5. The runtime API — the contract everything targets

The prototype reaches everything outside itself through a small set of handles. This is THE
contract of the system: it's what the agent generates against, what the harness implements, and
the thing that has to stay stable so prototypes don't rot. Frozen, documented, versioned. Hard
ceiling of ~12 handles — every handle is something the agent must understand and we must support
forever.

We organise it in four layers, which tells us what's stable vs. what varies:

**Talking to the fakes (the library) — identical for every app:**

- `db` — structured entity data (the schema-driven store).
- `api` — call "the server"; auto-CRUD plus custom endpoints.
- `services` — the shelf of request/response fakes: auth, payments, email, etc.
- `sensors` — signal sources you _subscribe_ to rather than _call_ (heart rate, GPS). Separate
  from `services` precisely because a sensor is a stream, not a request/response thing.
- `events` — subscribe/publish to the world-simulator's event bus.

**Talking to time and randomness — must be controlled, never real:**

- `clock` — simulated time; steppable, pausable, fast-forwardable. (`now` is just `clock.now()`,
  not its own top-level handle — resisting sprawl.)
- `random` — seeded randomness. Easy to forget and _critical_: if the app ever calls real
  `Math.random()`, deterministic replay breaks. We give the app a seeded source and block the
  real one inside the sandbox.

**Talking to the shell it lives in — the layer that varies per shell:**

- `host` — what am I running in? Native-style notifications, viewport info, back/rotate/resize,
  stdin/stdout for terminals, the host-app API for embedded shells. This is an _interface with
  per-shell implementations_, not one fixed object: a terminal's `host` and a phone's `host`
  expose different things. This is the main place shell differences live.
- `storage` — simple persistent key-value (settings, drafts, theme, preferences). Separate from
  the entity DB because it's key-value shaped, not table shaped, and forcing it into entities is
  awkward.

**Talking to Radix / the meta-layer:**

- `stub` — the graceful-degradation hook. The app declares "this part is faked / partial, here's
  what's missing." Because degradation is a first-class product concept, it needs a first-class
  API, not a buried code comment — this is how a stub surfaces in the manifest and the UI.
- `log` — emit to the simulation console's event log; the app's window into the cockpit.

### Why these layers and not one flat object

The original sketch had six handles all about _talking to fakes_ and missed two whole
directions: talking to the _shell_ (a phone app needs notifications and rotation; a CLI needs
stdin/stdout; an embedded app needs the host API) and talking to _Radix itself_ (declaring
stubs, logging to the console). Splitting `sensors` out from `services` reflects a real
distinction (stream vs. request/response). Pulling `random` out as its own controlled handle is
what protects deterministic replay. The layering isn't decoration — it tells us the library and
time layers are write-once-identical, while `host` is the genuinely variable surface that each
shell implements differently.

---

## 6. The schema — strict core wrapped in an open layer

We hit a real contradiction: "the schema is a loose guideline, not a straitjacket" vs. "we
generate a precise database store from the schema." A loose guideline can't mechanically drive a
precise generator. The resolution is that these describe **two different regions of the schema**
that we were sloppily calling one thing.

- **Strict core** — entities, fields, types, relationships. This is _not_ loose. Fixed, validated
  vocabulary, because the store engine, the auto-CRUD API, and the seed generator all read it
  mechanically. "Order has a numeric total and belongs to a Customer" has to be precise or
  nothing downstream works.
- **Open extension layer** — a free-form bag around the core for everything it can't express:
  domain quirks, validation rules, computed-field hints, display hints, notes to the agent. The
  generic machinery ignores it; the agent and custom code read it.

So "guideline not straitjacket" is true — but it describes the _extension layer_, not the core.
The strictness of the core is exactly what buys us the generic machinery; the looseness sits in
a clearly marked open region around it.

### What "generate a store per app" actually means

This phrase oversells what happens. We do **not** write a new bespoke store implementation for
each app. We write **one** generic store engine, once. It reads any schema's strict core _at
runtime_ and configures itself — creates the IndexedDB object stores, sets up indexes from the
relations, knows how to satisfy queries. The schema is _data fed to a fixed engine_, not a
_template that emits new code_. "Per app" just means "the one engine, pointed at this app's
schema." Same move as the world-simulator being one configurable engine rather than a new
simulator each time. That's the thing that makes it tractable.

### The escape hatch

When the generic engine genuinely can't express some query or piece of logic, the agent writes a
custom `api` endpoint — it does _not_ bend the generic store. Generic engine covers the common
~80%; the custom-endpoint hook covers the awkward rest; the open extension layer carries the
metadata that fits neither. Three clean levels, no muddle.

### IndexedDB reality

IndexedDB indexes single fields well but is weak at compound and relational queries. So the
engine loads via IndexedDB and does relational/filter work in JS on top. That's fine at
prototype data volumes — but it means we keep seed data to hundreds-to-thousands of rows, not
millions, and we don't pretend it behaves like a real SQL database.

### Open question — what the strict core can describe but not enforce

The food-delivery walkthrough surfaced two real constraints the schema can currently only _hint_
at via the open layer, not enforce:

- **State machines.** An enum field is often really a state machine with legal transitions — an
  order goes `cart → placed → accepted → preparing → picked_up → delivered`, never backwards or
  skipping. The strict core can store the enum but doesn't know the transitions are constrained.
- **Field-write-ownership.** Some fields have exactly one legitimate writer — a driver's position
  is written only by the simulator, never by user CRUD. The strict core can store the field but
  doesn't know who's allowed to write it.

Open question: do these deserve first-class support in the strict core, or stay as code-enforced
conventions? Current lean is conventions for now (enforcement lives in the fact that the UI simply
never writes those fields, and the custom endpoint guards the transitions). But it's flagged
rather than settled, because state machines recur in _every_ reactive app with a lifecycle —
if they're common enough, first-class support might pay off. Note this is the one place the
"strict core + open layer" split feels slightly under-powered: the constraint is real and
structural, but it currently lives in the _open_ (ignored-by-machinery) layer.

---

## 7. Persistence — three tiers, kept separate

Generated prototypes should persist by default: come back later and your fake data and state are
still there unless you reset. Three clearly separated tiers:

- **Platform data (InstantDB):** Radix's own real database — projects, the agent's decision
  record / manifest, library elements, generated source, user accounts on Radix itself. Needs
  real, cross-device, durable persistence.
- **Prototype data (IndexedDB, namespaced per prototype):** the fake database for a generated
  app. Survives refresh; resettable to a seed. This is the "save where possible" requirement.
- **Ephemeral run state (memory):** the live simulation clock, in-flight events, the current
  game frame. Gone on refresh _by design_ — but reconstructable from prototype data + seed, so a
  reload feels continuous without us serialising mid-flight state.

A prototype reload restores: its IndexedDB data, its seed (so the world-simulator replays
deterministically), and the last manifest. It deliberately does NOT try to restore mid-flight
ephemeral state — it replays from the seed instead. This is why seeded determinism (Section 9)
isn't a nice-to-have: it's what makes "reload and continue" work at all.

---

## 8. The manifest — a record of decisions, not a schema apps must obey

Early instinct was a "manifest schema" that every app conforms to. That was rejected, correctly:
a rigid manifest fights the whole premise that the agent has full flexibility to build anything.

The reframe: the manifest is **a record of the decisions the agent made**, not a cage the app
lives in. Most importantly it records _where the agent drew the real-vs-faked boundary and why_ —
the human "set the fiddly bits aside" move, written down. It also captures the schema, the chosen
shell, the spine(s), which service mocks were used, and the world-simulator config.

It's a structured-but-flexible format: structured enough to drive partial regeneration and to be
inspected/diffed, flexible enough not to constrain what can be built. A guideline vocabulary for
describing decisions, not an enumeration of what's allowed. (Note the parallel with the schema in
Section 6 — strict where machinery needs it, open everywhere else. Same philosophy.)

Why it matters mechanically: iteration ("make the dashboard show revenue") becomes an _edit to a
slice of the manifest_ and a regeneration of only the affected pieces — not a from-scratch rebuild
of the whole app. We design for partial regeneration from the start.

---

## 9. Determinism and replay (a cross-cutting requirement)

Reproducibility is required, not optional, because the product is about _testing and evaluating_.
A user needs to run the same flow twice and see the same thing; a reload needs to feel continuous.

This forces a few rules through the whole system:

- All randomness flows from a seed via the `random` handle. Real `Math.random()` is blocked inside
  the sandbox.
- All time flows through the simulation `clock`, never the real clock. `setTimeout`-style
  behaviour and the world-simulator are driven by it.
- The world-simulator's event sequence is a deterministic function of its seed.
- Reset wipes prototype data back to seed and restarts the clock; the app comes up identically.

**Resume rule (persisted state wins over replay).** There's a subtlety when persisted state and a
simulator actor both describe the same thing — e.g. an order's status is persisted _and_ a driver
actor is mid-route. On reload we must NOT blindly replay the actor from seed-zero, because the
replayed position can contradict the persisted status (the driver teleports). The rule: restore
persisted state first, then have the simulator _resume from it_, not from the beginning. Persisted
state is the source of truth; the simulator catches up to it rather than overriding it. (Surfaced
by the food-delivery walkthrough — this is the kind of thing that's invisible until you trace a
concrete mid-flight reload.)

Get this right early; it's painful to retrofit because it touches time, randomness, the
simulator, and persistence all at once.

**A payoff worth calling out: seeded failure injection.** Because randomness is seeded, we can make
service mocks fail on purpose and _reproducibly_ — "the 3rd charge in this seed declines." The
food-delivery walkthrough found this to be one of the most valuable testing affordances: exercising
the payment-declined path is annoying in a real build but trivial when the failure is a seeded
fake. So failure rates for any service mock should be a tunable, surfaced control (in the
simulation console), not a per-app afterthought. Determinism isn't only about repeatable
success — it's what makes repeatable _failure_ possible, which is arguably more useful for testing.

---

## 10. Graceful degradation — a first-class feature

When real emulation is genuinely too hard, the agent builds what it can and is _honest about the
gap_. This is not silent failure and not an afterthought — it's a core expression of the product's
"fake the fiddly bits" philosophy, so it gets first-class support:

- The `stub` runtime handle lets the app declare "this part is faked / partial, here's what's
  missing," which surfaces in the manifest and the UI.
- Reference example: collaborative editing. Faking _one_ scripted second cursor that types
  pre-scripted content is easy and makes the app _look_ collaborative. Implementing _correct_
  real-time conflict resolution (OT/CRDT) is a research problem. So the agent fakes the appearance
  and clearly states the real merging isn't implemented. This is the template for all degradation.
- Second worked example: live maps. A real maps SDK (tiles, geocoding, road routing) is exactly
  the fiddly, setup-heavy real-world integration Radix is built to set aside. The agent renders a
  simplified map surface with a marker that moves on real (simulated) events — preserving the
  _experience_ of watching your driver approach — and stubs the rest: "real tiles and routing not
  implemented." The principle both examples share: build the part that carries the experience,
  fake the part that's just integration plumbing, and say which is which.
- The user is always told plainly what's real and what's pretend.

We deliberately _want_ some apps in the test set that trigger this path (collaborative editing,
P2P/CRDT sync) — they're the stress tests for the degradation contract, not failures.

---

## 11. The library — how quality compounds

The agent prefers existing library elements (templates, runtimes, components, service mocks,
sensor configs, spine patterns) and generates new ones only when needed. Over time the library
grows and the agent gets faster and more reliable because more is pre-built and battle-tested.

The risk is the library filling up with near-duplicate one-offs. So there's a **contribution
pipeline**: agent-generated elements start app-local / quarantined, and are promoted to the shared
library only after they recur, get generalised, and are reviewed. New-by-default is local;
shared-and-reusable is earned.

The **mapping campaign** — generate many test apps, watch which elements recur, grow the library
deliberately — should happen _after_ the manifest format and runtime contract are stable. Run it
earlier and the analysis churns against a moving target. A small set of hand-built apps stabilises
the contract first; the large campaign maps the surface area second.

---

## 12. Lower-frequency spine patterns are patterns, not exotica

A note we corrected: frame-loop (games, firmware, animation), document-with-undo (editors,
creative tools), and diff/apply (IaC, "preview before commit") are _recurring patterns_, not
genuine one-offs. They're less common than CRUD and the world-simulator, so we build each the
first time it's needed and then promote it to the library for reuse — but we treat them as proper
library tiers, not bespoke per-app work. Pure-compute pipelines (CLI, ETL, compiler) are the
fourth member of this family.

The distinction from genuinely bespoke work: these have a recognisable, reusable shape. A game
loop is a game loop. The truly per-app stuff is the specific content poured into these shapes.

One more pattern of this kind, surfaced by the food-delivery walkthrough: **"action that spawns an
actor."** A user action (a custom `api` endpoint) that doesn't just write data but _starts a
world-simulator actor_ — "place order" kicks off the restaurant→driver→delivery process. It
recurs anywhere a user action sets a real-world process in motion: ride-share (request → driver
actor), booking (confirm → fulfilment), KYC (submit → approval). It's the natural seam between the
two foundations — the data side records the action, the world side runs the consequence — so it's
worth naming and reusing rather than re-deriving each time.

---

## 13. Known risks and open questions

- **Embedded-in-host shell is the big risk.** Faking another whole application's API (VS Code,
  Chrome, the macOS tray) is qualitatively harder than faking a service like Stripe. It's four of
  the forty apps. Current lean: defer past v1, make the call deliberately rather than drift into it.
- **`host` interface design.** Since `host` is the per-shell-variable handle, getting its shape
  right (common surface vs. per-shell extensions) is the trickiest part of the runtime contract.
- **Collaboration / CRDT** is the designated hard-fallback case. Fine as long as the degradation
  story is solid; a problem if we ever pretend it's fully solved.
- **Query power vs. IndexedDB limits.** Watch for apps whose query needs outgrow JS-on-IndexedDB;
  the custom-endpoint escape hatch should absorb these, but keep an eye on how often it's hit.
- **How much the agent generates vs. composes.** The whole system's speed and reliability live on
  this boundary. Too much generation loses the benefits of the library; too little can't cover the
  space. The contribution pipeline is our main lever; needs tuning with real usage.
- **Visual variety.** Generated UIs must not converge on one default look. Worth an explicit
  mechanism so apps feel genuinely distinct (fonts, colour, layout), not same-y.

---

## 14. One-line summary

Radix gets you to a usable, runnable prototype fast by running the user's JavaScript inside a library
of convincing fakes — built on two co-equal engines (a schema-driven fake database and a
seeded world-event simulator), reached through a small frozen runtime contract, rendered into
swappable shells, with the agent's core skill being to decide what to build for real and what to
honestly fake.
