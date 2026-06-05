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

      ${componentSource}

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
