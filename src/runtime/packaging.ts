/**
 * Wrap a React component's source into a single self-contained HTML document.
 *
 * The produced HTML loads React 19 + ReactDOM from esm.sh (no bundler needed),
 * runs the supplied source as an ES module, and mounts whatever it assigns to
 * `window.App` into `#root`. This is the v1 "packaging" format for a Radix
 * prototype: one HTML blob uploaded to InstantDB Storage and rendered in an
 * iframe.
 *
 * `componentSource` must be valid browser ESM (JSX is NOT transformed here, so
 * author components using `React.createElement` / `h`, or precompiled JSX). It
 * should set `window.App` to a React component.
 */
import { runtimeSource } from "./source";

export function wrapReactApp(opts: {
  title: string;
  componentSource: string;
}): string {
  const { title, componentSource } = opts;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; height: 100%; background: #fff; color: #111;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      #root { min-height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import React from "https://esm.sh/react@19.2.0";
      import { createRoot } from "https://esm.sh/react-dom@19.2.0/client";
      // Expose React globally so component source can reference it.
      window.React = React;

      ${escapeScriptClose(componentSource)}

      const App = window.App;
      if (typeof App !== "function") {
        document.getElementById("root").textContent =
          "Prototype did not assign window.App to a component.";
      } else {
        createRoot(document.getElementById("root")).render(
          React.createElement(App)
        );
      }
    </script>
  </body>
</html>`;
}

/**
 * Like `wrapReactApp`, but first installs the Radix runtime
 * (`window.radix` — the db/events/clock/random/log/actor/services/stub handles
 * typed in ./types/) before running the prototype's component source. The
 * prototype reads `window.radix.*` the same way it reads `window.React`.
 *
 * This is the packaging for any prototype that uses the runtime. `wrapReactApp`
 * (no runtime) stays available for plain React apps that need no fakes.
 *
 * SECURITY: the produced HTML must be hosted in a cross-origin,
 * `sandbox="allow-scripts"` iframe. The runtime's postMessage bridge only trusts
 * the direct parent window; pass `shellOrigin` (the exact origin the shell is
 * served from, e.g. "https://radix.app") to additionally pin which origin may
 * drive the prototype. Omit it only for local/dev hosting where the origin isn't
 * known ahead of time — the parent-window check still applies.
 */
export function wrapPrototype(opts: {
  title: string;
  componentSource: string;
  shellOrigin?: string;
}): string {
  const { title, componentSource, shellOrigin } = opts;
  // Pin the expected shell origin into the runtime's bridge. Empty string means
  // "not pinned" — the runtime falls back to the parent-window check alone.
  const runtime = runtimeSource.replace(
    "__RADIX_SHELL_ORIGIN__",
    (shellOrigin ?? "").replace(/['"\\]/g, ""),
  );
  return wrapReactApp({
    title,
    // The runtime is plain browser JS that assigns window.radix; it must run
    // before the component body, which is exactly the slot wrapReactApp inlines.
    // The component itself runs inside a scope that redirects the non-deterministic
    // globals (Math.random, Date, timers) at the runtime, so replay holds even if
    // the app reaches for them out of habit.
    componentSource: `${runtime}\n\n${prototypeScope(componentSource)}`,
  });
}

// Wrap the prototype's source in a block scope that shadows the non-deterministic
// browser globals with runtime-backed equivalents. This is purely lexical: it only
// affects identifiers the component resolves, never React (a separate ESM module
// that already captured the real globals) and never `window.*`. Game render loops
// should still use `radix.clock.onFrame`; we deliberately leave requestAnimationFrame
// alone so smooth rendering isn't forced through simulated time.
export function prototypeScope(componentSource: string): string {
  return `{
  const __radix = window.radix;
  // Math.random → seeded PRNG; everything else on Math delegates to the real one.
  const Math = new Proxy(window.Math, {
    get(t, p) { return p === 'random' ? function () { return __radix.random.random(); } : t[p]; }
  });
  // Date.now() and \`new Date()\` (no args) read simulated time; explicit args delegate.
  const Date = new Proxy(window.Date, {
    get(t, p) { return p === 'now' ? function () { return __radix.clock.now(); } : t[p]; },
    apply(t, thisArg, args) { return Reflect.apply(t, thisArg, args); },
    construct(t, args) { return Reflect.construct(t, args.length ? args : [__radix.clock.now()]); }
  });
  // Timers route through the simulated clock so pause/step/fastForward control them.
  // We hand back integer ids (not the clock's cancel fn) so clearTimeout/clearInterval work.
  const __timers = {}; let __tid = 1;
  function setTimeout(fn, ms) {
    const id = __tid++;
    __timers[id] = __radix.clock.setTimeout(function () { delete __timers[id]; if (typeof fn === 'function') fn(); }, ms || 0);
    return id;
  }
  function clearTimeout(id) { const c = __timers[id]; if (c) { c(); delete __timers[id]; } }
  function setInterval(fn, ms) {
    const id = __tid++;
    (function schedule() {
      __timers[id] = __radix.clock.setTimeout(function () {
        if (typeof fn === 'function') fn();
        if (__timers[id] !== undefined) schedule();
      }, ms || 0);
    })();
    return id;
  }
  function clearInterval(id) { clearTimeout(id); }

${componentSource}
}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Neutralize any `</script` sequence in inlined module source so it can't close
// the host <script> element early. `<\/script` is identical JavaScript, so this
// never changes runtime behaviour or string values.
function escapeScriptClose(s: string): string {
  return s.replace(/<\/(script)/gi, "<\\/$1");
}
