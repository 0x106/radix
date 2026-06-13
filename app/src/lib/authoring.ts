// The Radix prototype authoring contract, shared by the build agent
// (init-project) and the edit agent (edit-project). A prototype runs as a
// browser ES module inside a sandboxed iframe: React is global, the Radix
// runtime is on `window.radix`, and there is NO JSX transform.

export const AUTHORING_GUIDE = `## How to write a Radix prototype

The "source" you pass is the body of a browser ES module that runs inside a
sandboxed iframe. Follow these rules exactly or the app will not run:

1. NO JSX. Build elements with React.createElement. Start with:
     const { useState, useEffect, useMemo } = React;
     const h = React.createElement;
2. Define one top-level component function and assign it to window.App:
     window.App = MyApp;
   Do NOT use import/export — React is already a global, and so is window.radix.
3. Style with inline style objects (no external CSS, no Tailwind).
4. Keep everything in this one source string. It must be self-contained.
5. The prototype runs in a sandboxed iframe. If you use a <form>, ALWAYS call
   e.preventDefault() in its onSubmit handler before doing anything else — a real
   form submission would try to navigate the frame and is blocked / reloads state:
     h("form", { onSubmit: (e) => { e.preventDefault(); addTodo(); } }, ...)
   The same applies to links: don't rely on <a href> navigation; handle onClick.

### The runtime: window.radix

Reach all "backend" capabilities through window.radix (alias it: const radix = window.radix):

- radix.db — a synchronous, seeded entity store. Declare collections ONCE at the
  top of your component module (before the component, or in a useState initializer
  guard), then read/write synchronously:
    radix.db.define({
      todos: {
        fields: { text: "string", done: { type: "boolean", default: false } },
        seed: [{ id: "1", text: "First task", done: false }],
      },
    });
    radix.db.create("todos", { text: "Buy milk", done: false });
    radix.db.update("todos", someId, { done: true });
    radix.db.delete("todos", someId);
    const rows = radix.db.query("todos", { where: { done: false }, order: { field: "text", dir: "asc" } });
  Subscribe for live updates inside useEffect:
    useEffect(() => radix.db.subscribe("todos", setRows), []);
  Field types: "string" | "number" | "boolean" | "json" | "ref" | { type: "enum", values: [...] }.
  Every row gets a string id automatically. db.reset() restores the seed.

- radix.clock — simulated time: now(), setTimeout(fn, ms), onFrame(fn) for render loops.
- radix.random — seeded RNG: random(), int(min, max), pick(array). Use this, never Math.random.
- radix.events — pub/sub bus: on(topic, fn), emit(topic, payload).
- radix.actor(config) — a stateful world process with start/tick/on handlers, for
  apps that need something to react to over time (bots, simulations, multiplayer).
- radix.log — simulation log: info(msg, data), warn(...), error(...).

Only use the data store (radix.db) for simple CRUD apps. Reach for clock/events/
actor when the app genuinely needs the passage of time or autonomous activity.

### Example (a minimal counter)

const { useState } = React;
const h = React.createElement;
function Counter() {
  const [n, setN] = useState(0);
  return h("div", { style: { padding: 40, textAlign: "center", fontFamily: "system-ui" } },
    h("p", { style: { fontSize: 48, margin: 0 } }, String(n)),
    h("button", { onClick: () => setN((v) => v + 1) }, "+1"),
  );
}
window.App = Counter;

Make the prototype genuinely functional and reasonably complete for what the user
described — real interactions, seeded sample data, and a clean inline-styled UI.`;
