# Walkthrough — building the food delivery app in Radix

> This traces one concrete app end to end through the architecture in `plan.md` and `notes.md`.
> The point is partly to show _how it would actually go_, and partly to stress-test the design:
> where does it hold up, where does it hand-wave, what did we learn? Findings are collected at
> the end (Section 11) — some of them should feed back into the plan.

The app: a phone-based food delivery app. A customer browses restaurants, builds an order, pays,
and then watches a live map as a driver picks the food up and brings it to them, with push
notifications at each stage.

We pick this one because it hits almost everything at once: the data foundation (restaurants,
menus, orders), a service mock (payments), the world-simulator (a driver moving in real time +
order state advancing), the `host` handle (push notifications, a map, phone chrome), the phone
shell, and seeded determinism (the same driver should take the same route on replay).

---

## 0. Where this sits in the build

This walkthrough assumes the foundations from `plan.md` already exist: the runtime harness
(Phase 1), the data foundation (Phase 2), the world simulator (Phase 3), the simulation console
(Phase 4), the service-mock shelf (Phase 5), and the viewport shell with phone chrome (Phase 7).
The food delivery app is then _mostly configuration of things that already work_, plus a few
genuinely app-specific pieces the agent writes. That "mostly configuration" feeling is the whole
payoff of building foundations first — so part of what we're checking here is whether that's
actually true for a demanding app.

---

## 1. Intake conversation (Phase 10 — the agent)

The user starts with something rough: _"I want to build a food delivery app like Uber Eats."_

The agent's job here is not to start coding — it's to pin down what's really being built and,
crucially, to decide **what to build for real and what to honestly fake** (the core skill from
notes §1). A plausible intake exchange:

- _Agent:_ Which side are we building — the customer app, the driver app, the restaurant side, or
  more than one? → **Customer app** (we'll fake the driver and restaurant as world-simulator
  actors rather than building their apps).
- _Agent:_ Phone, web, or both? → **Phone.** (Sets the shell.)
- _Agent:_ Do you want real-feeling payment, or just a "pay" button that always succeeds? →
  **Realistic** — sometimes declines, has a short delay. (Sets how the payments mock is configured.)
- _Agent:_ Should the live driver tracking on a map be a real priority, or is a status timeline
  enough? → **The live map matters**, it's the bit they want to show people.
- _Agent:_ Should orders and past history persist between sessions? → **Yes.** (Per notes §7,
  prototypes persist by default anyway.)

From this the agent now knows: customer-side, phone shell, CRUD spine for the catalogue/orders,
world-simulator for the driver + order lifecycle, payments off the shelf, live map via `host`,
realistic failure modes, persistence on.

The **real-vs-faked boundary** the agent draws (recorded in the manifest, notes §8):

- **Built for real (in prototype terms):** the browse → cart → order → track flow, the data, the
  UI, the order state machine.
- **Faked off the shelf:** payments, push notifications.
- **Faked via the world-simulator:** the restaurant accepting/preparing the order, and the driver
  existing and moving.
- **Stubbed / partial:** real map tiles and real routing (see §6 and §10) — we fake a believable
  moving dot on a simplified map rather than integrating a real maps SDK with real road routing.

That last decision is exactly the "fiddly bit set aside" move. Real routing over a real road
network is a real-world integration with setup and quirks; for _feeling out_ the app it adds
almost nothing over a convincing fake. So we fake it and say so.

---

## 2. The schema (Phase 2 — data foundation, strict core + open layer)

The agent emits a schema. Per notes §6, the **strict core** is precise (the store engine, auto-CRUD,
and seed generator read it mechanically); the **open extension layer** carries hints the generic
machinery ignores.

```
Restaurant:
  fields:
    name:        { type: string }
    cuisine:     { type: string }
    rating:      { type: number }
    etaMinutes:  { type: number }
    imageUrl:    { type: string }
  relations:
    menuItems:   { hasMany: MenuItem }
  extensions:
    displayHint: "card with image header"

MenuItem:
  fields:
    name:        { type: string }
    description: { type: string }
    price:       { type: number }
  relations:
    restaurant:  { belongsTo: Restaurant }

Order:
  fields:
    status:      { type: enum, values: [cart, placed, accepted, preparing, picked_up, delivered] }
    total:       { type: number }
    placedAt:    { type: datetime }
  relations:
    restaurant:  { belongsTo: Restaurant }
    items:       { hasMany: OrderItem }
    driver:      { belongsTo: Driver }
  extensions:
    statusFlow:  "cart → placed → accepted → preparing → picked_up → delivered"
    note:        "status is advanced by the world-simulator, not the user"

OrderItem:
  fields:
    quantity:    { type: number }
    priceEach:   { type: number }
  relations:
    order:       { belongsTo: Order }
    menuItem:    { belongsTo: MenuItem }

Driver:
  fields:
    name:        { type: string }
    vehicle:     { type: string }
    lat:         { type: number }
    lng:         { type: number }
  extensions:
    note:        "position is updated by the world-simulator on the clock; not user-editable"
```

Two things worth noticing. First, the `Order.status` enum _is_ the order state machine — the
`statusFlow` extension documents the intended progression for the agent, but the actual advancing
is done by the world-simulator (§5), not by user CRUD. Second, `Driver.lat/lng` are ordinary
number fields in the strict core, but the _note_ in the open layer flags that they're
simulator-driven. The schema doesn't enforce that — it's a hint. Enforcement lives in the fact
that the UI never writes those fields; only the simulator does.

This is a small early sign of something to watch: the schema can _describe_ a state machine and
_who's allowed to write a field_, but it can't _enforce_ either. That's fine — enforcement lives
in code — but see findings §11.

---

## 3. The fake database + seed data (Phase 2)

No bespoke store code is written. The one generic store engine (notes §6) reads this schema's
strict core and configures itself: IndexedDB object stores for each entity, indexes derived from
the relations, in a namespace unique to this prototype so it survives refresh and can be reset to
seed.

The seed generator (using the OpenAI API for believability, seeded for reproducibility) populates:

- ~12 restaurants with real-sounding names, varied cuisines, ratings, ETAs, and image URLs.
- ~8–15 menu items each, with plausible dishes and prices.
- A couple of past delivered orders, so the order history screen isn't empty.
- A small pool of drivers.

Because the seed is deterministic, a reset brings back the _same_ twelve restaurants — important
for demoing and testing (notes §9).

The auto-CRUD API now exists for free: list restaurants, get a restaurant with its menu items,
create an order, add order items, read an order. The customer browse/cart flow is built entirely
on these generic endpoints — the agent writes no custom data code for it.

One custom endpoint _is_ warranted: "place order" does a bit more than a raw create — it freezes
the cart total, sets `placedAt`, flips status to `placed`, and kicks off the world-simulator actor
for this order (§5). That's the ~20% escape hatch from notes §6, used exactly as intended.

---

## 4. Payments off the shelf (Phase 5 — service mocks)

The agent does not write a payment system. It pulls the payments mock off the shelf and configures
it per the intake: realistic, with a short delay and an occasional decline.

In the prototype, checkout calls `services.payments.charge({ amount, ... })`. The mock waits a
beat (on the simulation `clock`, not the real one, so it's controllable and replayable), then
returns success — or, seeded to fire occasionally, a decline. The decline path is genuinely useful
here: it lets the user feel what happens when payment fails, which is exactly the kind of flow
that's annoying to exercise in a real build but trivial when the failure is a seeded fake.

Note the determinism wrinkle: "occasional decline" must come from the seeded `random` handle
(notes §9), not real randomness, or the same demo would decline unpredictably. With seeding, "the
3rd order in this seed declines" is stable and reproducible.

---

## 5. The world-simulator — the heart of this app (Phase 3)

This is where food delivery stops being a CRUD app. Once an order is placed, _things happen to the
app over time without the user doing anything_: the restaurant accepts, starts preparing, a driver
picks up, the driver moves, the order is delivered. None of those actors are real. The
world-simulator (notes §3) produces all of it.

When "place order" fires (§3), it starts a simulator actor configured for this order. On the
simulation clock, the actor:

1. After a short delay, advances `Order.status` `placed → accepted` and emits an `order.accepted`
   event.
2. After another interval, `accepted → preparing`, emits `order.preparing`.
3. Assigns a `Driver`, advances to `picked_up`, emits `order.picked_up`, and **begins moving the
   driver**: every clock tick, it updates `Driver.lat/lng` a step along a path toward the delivery
   location, emitting `driver.moved` each tick.
4. When the driver "arrives," advances to `delivered`, emits `order.delivered`, and stops.

Everything the actor does is a deterministic function of its seed (notes §9): same seed → same
timings, same driver, same route. That's what makes "reload mid-delivery and it continues
sensibly" work (§8) and what makes a demo repeatable.

Two distinct things are riding on this one engine, which is the point of having it: a **state
machine** (order status advancing on a schedule) and a **moving signal** (the driver's position
changing every tick). The engine doesn't care that one is "logistics" and the other is "a dot on a
map" — both are just "emit changes over time, seeded."

The app _reacts_ to all this through the `events` handle: it subscribes to `order.*` to update the
status timeline and to `driver.moved` to move the map dot. The app doesn't poll the database; the
simulator pushes events and the UI responds. This is the reactive spine sitting right next to the
CRUD spine in the same app — the two foundations both in play at once.

---

## 6. The live map — `host` handle + a deliberate stub (Phase 7 + Phase 9)

The user said the live map matters. Here we hit the boundary decision from §1.

A _real_ implementation would integrate a maps SDK (tiles, real geocoding, real road routing). That
is the fiddly, setup-heavy, real-world-integration kind of thing Radix is designed to set aside
(notes §1, §10). For _feeling out_ the app, almost none of that value is lost by faking it. So:

- The map is rendered by the phone shell via the `host` handle as a simplified map surface — enough
  to show a route line and a moving marker, not real cartographic tiles.
- The driver marker is driven by the `driver.moved` events from §5. The "route" is a simple path
  the simulator interpolates along, not a real road network.
- This is registered as a **stub** via the `stub` handle (notes §10): "Map is simplified; real map
  tiles and road routing are not implemented." That surfaces in the manifest and in the UI, so the
  user knows exactly what's real (the live-updating marker and the flow around it) and what's
  pretend (real maps/routing).

This is the graceful-degradation contract working as designed: we built the part that carries the
_experience_ (watching your driver approach in real time) and were honest about the part we faked.

Push notifications are also a `host` concern: at each `order.*` event the app calls the host to
raise a native-style notification ("Your order's been picked up!"). On the phone shell that renders
as a phone-style banner. The notification _content_ is the app's; the _native presentation_ is the
shell's job, reached through `host` — exactly the split notes §5 describes for why `host` exists.

---

## 7. The phone shell (Phase 7)

The whole thing renders inside the viewport shell with phone chrome: a phone outline, a notch, tap
(not hover) as the input model, a back gesture, native-style notification banners. The app code
isn't phone-specific in its logic — it's the shell that supplies the phone _feel_ and the
`host`-level capabilities (notification presentation, viewport size, back handling). If the user
later said "actually also make a tablet version," that's largely a shell swap, not an app rewrite
— which is the payoff of keeping the shell a separate swappable layer (notes §4).

---

## 8. Persistence and replay in action (notes §7, §9)

Tracing the three tiers for this specific app:

- **Platform data (InstantDB):** the project, the manifest (including the stub from §6 and the
  real-vs-faked boundary from §1), and the generated code. Radix's own durable storage.
- **Prototype data (IndexedDB, per-prototype namespace):** restaurants, menus, orders, order items,
  drivers. Survives refresh. Resettable to the twelve-restaurant seed.
- **Ephemeral run state (memory):** the live simulator actor for an in-flight order — the current
  clock position, the driver mid-route. Gone on refresh by design.

So what happens on reload mid-delivery? The prototype data restores (the order exists, its status
is whatever was last persisted), the seed restores, and the simulator _replays deterministically_
from the seed to reconstruct a sensible in-flight state rather than us having tried to serialise
"driver is 63% along route at tick 1471." This is precisely why determinism isn't optional
(notes §9): replay-from-seed is the mechanism that makes persistence feel continuous without
serialising live state.

A subtlety worth flagging (findings §11): for replay to land the order back in the right place,
the _persisted_ order status and the _seed-driven_ simulator have to agree. If we persist
`status: preparing` but the seed replay would put the driver halfway down the road, those disagree.
The clean rule is that persisted status is the source of truth and the simulator resumes _from_
it, rather than replaying from zero. Worth pinning down explicitly in the plan.

---

## 9. Iteration (Phase 10 — partial regeneration)

The user tries it and says: _"Let me tip the driver after delivery."_

Per notes §8, this is an edit to a _slice_ of the manifest, not a rebuild:

- Schema: add `tip` to `Order` (strict core) and maybe a `tipOptions` hint (open layer).
- A small custom endpoint or UI action to set the tip post-delivery.
- A new screen state after `delivered`.

Nothing about the simulator, payments, map, or shell needs regenerating. The store engine picks up
the new field automatically (it re-reads the schema). This is the partial-regeneration design
paying off: a focused change touches a focused set of pieces.

---

## 10. The runtime API handles this app actually used

Tracing against the frozen contract (plan Phase 1 / notes §5), as a coverage check:

- `db` — restaurants, menus, orders, order items, drivers.
- `api` — auto-CRUD for browsing/cart; custom "place order" and "tip" endpoints.
- `services` — `services.payments.charge(...)`.
- `sensors` — _not used._ (Good — confirms sensors are correctly separate from services; this app
  has none.)
- `events` — subscribe to `order.*` and `driver.moved`.
- `clock` — payment delay, simulator timings, driver movement all run on it.
- `random` — seeded: which driver, route variation, occasional payment decline.
- `host` — push notifications, the map surface, phone viewport/back.
- `storage` — lightly, e.g. remembering the last delivery address. (Not entity data, so correctly
  not in `db`.)
- `stub` — the simplified-map declaration.
- `log` — simulator and payment events into the console event log for debugging.

Eleven of the twelve handles exercised by one app, each for the reason it exists, with `sensors`
correctly unused. That's a decent sign the contract's shape is right.

---

## 11. Findings — what this stressed, and what should feed back

**The design held up well on the big things.** The two-foundations split is vindicated: this app
genuinely needs CRUD _and_ the world-simulator simultaneously, and they coexist cleanly through the
`events` handle. "Mostly configuration of existing engines plus a few custom corners" was true —
the app-specific code is small (the place-order endpoint, the simulator actor config, the map
rendering, the screens). The `host` handle earned its place three times over (notifications, map,
phone chrome). The stub mechanism made the one hard part (real maps/routing) a clean, honest
decision rather than a fudge.

**Things the walkthrough exposed that the plan should address:**

1. **Persisted state vs. seed-replay can disagree (§8).** When an app persists state that the
   simulator also influences, we need an explicit rule: _persisted state is the source of truth and
   the simulator resumes from it_, not a blind replay from seed. The plan's reset/replay bullet
   should say this. Otherwise reload-mid-delivery could teleport the driver.

2. **The schema can describe a state machine but not enforce it (§2).** `Order.status` is really a
   state machine with legal transitions, and "only the simulator may write `Driver.lat/lng`" is a
   real constraint — but the schema only _hints_ at both via the open layer. We should decide
   whether state machines and field-write-ownership deserve first-class support in the strict core,
   or stay as code-enforced conventions. Leaning: keep them as conventions for now, but note it,
   because state machines recur (every reactive app with a lifecycle has one).

3. **"Place order" as a simulator trigger is a recurring shape.** A custom endpoint that _starts a
   world-simulator actor_ (rather than just writing data) showed up here and will show up in every
   app where a user action kicks off a real-world process (ride-share request, booking confirmation,
   KYC submission). Worth a named pattern in the library: "action that spawns an actor."

4. **Seeded failure injection is a feature, not just a detail (§4).** The occasional seeded payment
   decline turned out to be one of the more valuable testing affordances. Worth making "configure
   the failure rate of any service mock, seeded" a standard, surfaced control — possibly in the
   simulation console — rather than a per-app afterthought.

5. **The map is the canonical stub example.** Alongside collaborative editing (notes §10), "real
   maps/routing → simplified fake + honest stub" is clean enough to be a reference pattern for
   degradation. Add it to notes §10 as a second worked example.

None of these are problems with the architecture — they're places it was slightly vaguer than it
needed to be, now made concrete by a real app. That's exactly what the walkthrough was for.
