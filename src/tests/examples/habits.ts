// PHASE 0 EXAMPLE — CRUD prototype: a habit tracker.
//
// Purpose: exercise the `db` handle (create / update / delete / query /
// subscribe / reset) end to end, with a real little UI on top, to discover what
// the schema-driven store contract actually needs to feel like. The fake DB is
// the hand-written in-memory store in runtimeSource.ts.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` are in
// scope (see wrapPrototype); the source assigns the component to `window.App`.

export const habits = {
  name: "Habits (CRUD example)",
  description:
    "Phase 0 example: a habit tracker wired to the fake db — add, toggle, delete, reset to seed.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const db = window.radix.db;
    const log = window.radix.log;

    // --- seed: installed once; re-run on db.reset() -----------------------
    db.__seed(function (api) {
      ['Drink water', 'Read 20 min', 'Stretch'].forEach(function (name, i) {
        api.create('habits', { name: name, streak: i === 0 ? 3 : 0, doneToday: i === 0, seq: i });
      });
    });

    function useCollection(name) {
      const [rows, setRows] = useState(function () {
        return db.query(name, { order: { field: 'seq', dir: 'asc' } });
      });
      useEffect(function () {
        return db.subscribe(name, function () {
          setRows(db.query(name, { order: { field: 'seq', dir: 'asc' } }));
        });
      }, [name]);
      return rows;
    }

    function Habits() {
      const habits = useCollection('habits');
      const [text, setText] = useState('');

      const add = function () {
        const t = text.trim();
        if (!t) return;
        db.create('habits', { name: t, streak: 0, doneToday: false, seq: Date.now() });
        log.info('habit added', t);
        setText('');
      };
      const toggle = function (hbt) {
        const now = !hbt.doneToday;
        db.update('habits', hbt.id, { doneToday: now, streak: Math.max(0, hbt.streak + (now ? 1 : -1)) });
        log.info('habit toggled', { name: hbt.name, done: now });
      };
      const remove = function (hbt) {
        db.delete('habits', hbt.id);
        log.warn('habit deleted', hbt.name);
      };

      const page = { maxWidth: 520, margin: '40px auto', padding: '0 20px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const headRow = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' };
      const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        border: '1px solid #ececec', borderRadius: 12, marginBottom: 8, background: '#fff' };
      const input = { flex: 1, padding: '11px 13px', borderRadius: 10, border: '1px solid #d4d4d4', fontSize: 15 };
      const addBtn = { padding: '11px 16px', borderRadius: 10, border: 'none', background: '#111',
        color: '#fff', cursor: 'pointer', fontSize: 15 };
      const pill = { fontSize: 12, color: '#6b7280', background: '#f3f4f6', borderRadius: 999, padding: '2px 9px' };
      const del = { marginLeft: 'auto', border: 'none', background: 'transparent', color: '#b91c1c',
        cursor: 'pointer', fontSize: 18, lineHeight: 1 };
      const resetBtn = { fontSize: 13, color: '#6b7280', background: 'transparent',
        border: '1px solid #e5e5e5', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' };

      const doneCount = habits.filter(function (x) { return x.doneToday; }).length;

      return h('div', { style: page },
        h('div', { style: headRow },
          h('h1', { style: { fontSize: 26, fontWeight: 700, margin: '0 0 4px' } }, 'Habits'),
          h('button', { style: resetBtn, onClick: function () { db.reset(); log.info('reset to seed'); } }, 'Reset to seed'),
        ),
        h('p', { style: { color: '#6b7280', margin: '0 0 20px', fontSize: 14 } },
          doneCount + ' of ' + habits.length + ' done today'),
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 20 } },
          h('input', { style: input, value: text, placeholder: 'New habit…',
            onChange: function (e) { setText(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') add(); } }),
          h('button', { style: addBtn, onClick: add }, 'Add'),
        ),
        h('div', null,
          habits.length === 0
            ? h('p', { style: { color: '#9ca3af', textAlign: 'center', padding: '32px 0' } }, 'No habits. Add one above.')
            : habits.map(function (hbt) {
              return h('div', { key: hbt.id, style: row },
                h('input', { type: 'checkbox', checked: hbt.doneToday,
                  onChange: function () { toggle(hbt); }, style: { width: 18, height: 18 } }),
                h('span', { style: { fontSize: 15, fontWeight: 500,
                  textDecoration: hbt.doneToday ? 'line-through' : 'none',
                  color: hbt.doneToday ? '#9ca3af' : '#111' } }, hbt.name),
                h('span', { style: pill }, '🔥 ' + hbt.streak),
                h('button', { style: del, title: 'Delete', onClick: function () { remove(hbt); } }, '×'),
              );
            }),
        ),
      );
    }

    window.App = Habits;
  `,
};
