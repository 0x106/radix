// Team task board (#1 from example-apps.md).
// Kanban with three columns. A collaborator actor creates and moves cards to
// simulate a remote teammate. Demonstrates:
//   - Real-time multi-entity updates from an actor
//   - User and actor writing the same collection concurrently
//   - Simple board layout with per-column card counts

export const taskboard = {
  name: "Task board (kanban)",
  description:
    "Kanban board with a simulated collaborator who creates and moves cards in real time.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log, random = R.random;

    const COLS = ['todo', 'doing', 'done'];
    const COL_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };
    const NAMES = ['Alice', 'Bob', 'Carol'];
    const TITLES = [
      'Fix auth bug', 'Update README', 'Add dark mode', 'Refactor DB layer',
      'Write unit tests', 'Deploy to staging', 'Code review', 'Bump deps',
      'Performance audit', 'Add error handling', 'Security review', 'API docs',
    ];

    db.define({
      cards: {
        fields: {
          title: 'string',
          col: { type: 'enum', values: ['todo', 'doing', 'done'] },
          who: 'string',
        },
        seed: [
          { id: 'c1', title: 'Fix auth bug',      col: 'todo',  who: 'Alice' },
          { id: 'c2', title: 'Update README',      col: 'todo',  who: 'Bob'   },
          { id: 'c3', title: 'Refactor DB layer',  col: 'doing', who: 'Carol' },
          { id: 'c4', title: 'Write unit tests',   col: 'doing', who: 'Alice' },
          { id: 'c5', title: 'Deploy to staging',  col: 'done',  who: 'Bob'   },
        ],
      },
    });
    log.info('board ready');

    // Collaborator: every 4–7 s either creates a card in todo or advances one.
    const collaborator = R.actor({
      everyMs: 4000, jitterMs: 3000,
      tick: async function (ctx) {
        var cards = ctx.db.query('cards');
        var who = ctx.random.pick(NAMES);
        if (ctx.random.random() < 0.35 || cards.length === 0) {
          var title = ctx.random.pick(TITLES);
          ctx.db.create('cards', { title: title, col: 'todo', who: who });
          ctx.log.info(who + ' added: ' + title);
        } else {
          var moveable = cards.filter(function (c) { return c.col !== 'done'; });
          if (!moveable.length) return;
          var card = ctx.random.pick(moveable);
          var next = card.col === 'todo' ? 'doing' : 'done';
          ctx.db.update('cards', card.id, { col: next });
          ctx.log.info(who + ' moved "' + card.title + '" → ' + next);
        }
      },
    });

    function useCards() {
      var [rows, setRows] = useState(function () { return db.query('cards'); });
      useEffect(function () {
        return db.subscribe('cards', function () { setRows(db.query('cards')); });
      }, []);
      return rows;
    }
    function Board() {
      var cards = useCards();
      var [draft, setDraft] = useState('');

      useEffect(function () {
        collaborator.start(); clock.play();
        return function () { collaborator.stop(); };
      }, []);

      var byCol = {};
      COLS.forEach(function (c) { byCol[c] = []; });
      cards.forEach(function (c) { if (byCol[c.col]) byCol[c.col].push(c); });

      function addCard() {
        var t = draft.trim(); if (!t) return;
        db.create('cards', { title: t, col: 'todo', who: 'You' });
        setDraft('');
      }

      var S = {
        page:  { fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111',
                 height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' },
        hdr:   { padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e5e7eb',
                 display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
        board: { flex: 1, display: 'flex', gap: 10, padding: 10, overflowX: 'auto', minHeight: 0, alignItems: 'flex-start' },
        col:   { flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 6 },
        colHd: { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 0' },
        card:  { background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: '9px 11px' },
        foot:  { borderTop: '1px solid #e5e7eb', padding: '5px 14px', fontSize: 11, color: '#6b7280',
                 background: '#fff', maxHeight: 60, overflowY: 'auto' },
        cb:    { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
      };

      return h('div', { style: S.page },
        h('div', { style: S.hdr },
          h('strong', { style: { flex: 1, fontSize: 14 } }, 'Task Board'),
          h('input', { style: { border: '1px solid #e5e7eb', borderRadius: 7, padding: '4px 8px', fontSize: 12, width: 130 },
            value: draft, placeholder: 'New card title',
            onChange: function (e) { setDraft(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') addCard(); },
          }),
          h('button', { style: Object.assign({}, S.cb, { background: '#111', color: '#fff', border: 'none' }),
            onClick: addCard }, 'Add'),
        ),
        h('div', { style: S.board },
          COLS.map(function (colId) {
            var colCards = byCol[colId];
            return h('div', { key: colId, style: S.col },
              h('div', { style: S.colHd }, COL_LABEL[colId] + '  ' + colCards.length),
              colCards.map(function (c) {
                return h('div', { key: c.id, style: S.card },
                  h('div', { style: { fontSize: 13, fontWeight: 500, marginBottom: 5 } }, c.title),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                    h('span', { style: { fontSize: 11, color: '#9ca3af' } }, c.who),
                    h('div', { style: { display: 'flex', gap: 4 } },
                      c.col !== 'done' && h('button', {
                        style: { border: 'none', background: '#f3f4f6', borderRadius: 4,
                          padding: '2px 7px', cursor: 'pointer', fontSize: 11 },
                        onClick: function () {
                          db.update('cards', c.id, { col: c.col === 'todo' ? 'doing' : 'done' });
                        },
                      }, '→'),
                      h('button', {
                        style: { border: 'none', background: 'transparent', color: '#d1d5db',
                          cursor: 'pointer', fontSize: 13, lineHeight: 1 },
                        onClick: function () { db.delete('cards', c.id); },
                      }, '×'),
                    ),
                  ),
                );
              }),
            );
          }),
        ),
      );
    }

    window.App = Board;
  `,
};
