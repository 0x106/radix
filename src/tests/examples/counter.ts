// Example Radix prototype: a simple counter.
//
// Authored as browser-ESM source (no JSX transform). It runs inside the
// self-contained HTML produced by wrapReactApp: `React` is in scope and the
// source assigns the component to `window.App`.

export const counter = {
  name: "Counter",
  description: "A minimal stateful counter — smoke test for the iframe runtime.",
  source: /* js */ `
    const { useState } = React;
    const h = React.createElement;

    function Counter() {
      const [n, setN] = useState(0);
      const wrap = { display: "flex", minHeight: "100vh", alignItems: "center",
        justifyContent: "center" };
      const card = { padding: "40px 56px", border: "1px solid #e5e5e5",
        borderRadius: 16, textAlign: "center", boxShadow: "0 1px 2px rgba(0,0,0,.04)" };
      const btn = { fontSize: 20, width: 44, height: 44, borderRadius: 10,
        border: "1px solid #d4d4d4", background: "#fafafa", cursor: "pointer" };
      return h("div", { style: wrap },
        h("div", { style: card },
          h("p", { style: { margin: 0, color: "#737373", fontSize: 14 } }, "Count"),
          h("p", { style: { margin: "8px 0 24px", fontSize: 56, fontWeight: 600 } }, String(n)),
          h("div", { style: { display: "flex", gap: 12, justifyContent: "center" } },
            h("button", { style: btn, onClick: () => setN((v) => v - 1) }, "−"),
            h("button", { style: btn, onClick: () => setN((v) => v + 1) }, "+"),
          ),
        ),
      );
    }

    window.App = Counter;
  `,
};
