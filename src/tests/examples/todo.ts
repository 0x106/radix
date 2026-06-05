// Example Radix prototype: a small in-memory todo list.
//
// Authored as browser-ESM source (no JSX transform). Runs inside the
// self-contained HTML produced by wrapReactApp.

export const todo = {
  name: "Todo list",
  description: "An in-memory todo list — add, toggle, and clear items.",
  source: /* js */ `
    const { useState } = React;
    const h = React.createElement;

    function Todo() {
      const [items, setItems] = useState([
        { id: 1, text: "Try the iframe runtime", done: true },
        { id: 2, text: "Add a project", done: false },
      ]);
      const [text, setText] = useState("");

      const add = () => {
        const t = text.trim();
        if (!t) return;
        setItems((xs) => [...xs, { id: Date.now(), text: t, done: false }]);
        setText("");
      };
      const toggle = (id) =>
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));

      const page = { maxWidth: 480, margin: "48px auto", padding: "0 20px" };
      const row = { display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
        borderBottom: "1px solid #f0f0f0" };
      const input = { flex: 1, padding: "10px 12px", borderRadius: 10,
        border: "1px solid #d4d4d4", fontSize: 15 };
      const addBtn = { padding: "10px 16px", borderRadius: 10, border: "none",
        background: "#111", color: "#fff", cursor: "pointer", fontSize: 15 };

      return h("div", { style: page },
        h("h1", { style: { fontSize: 24, fontWeight: 600, marginBottom: 16 } }, "Todo"),
        h("div", { style: { display: "flex", gap: 8, marginBottom: 16 } },
          h("input", {
            style: input, value: text, placeholder: "Add a task…",
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter") add(); },
          }),
          h("button", { style: addBtn, onClick: add }, "Add"),
        ),
        h("div", null,
          items.map((it) =>
            h("label", { key: it.id, style: row },
              h("input", { type: "checkbox", checked: it.done,
                onChange: () => toggle(it.id) }),
              h("span", { style: { textDecoration: it.done ? "line-through" : "none",
                color: it.done ? "#a3a3a3" : "#111" } }, it.text),
            ),
          ),
        ),
      );
    }

    window.App = Todo;
  `,
};
