// reactive prototype: a chat screen.
//
// Purpose: exercise the *world foundation* (notes.md §3) — `events` (subscribe/
// publish), the seeded `spawn` actor primitive, the simulated `clock`, and
// `random` — plus `db` for persisting the transcript. The "other participant" is
// a seeded actor that posts replies over simulated time; pausing/stepping the
// clock visibly controls it. This is the app that pressure-tests the reactive
// side of the contract.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const chat = {
  name: "Chat (reactive example)",
  description:
    "A chat screen driven by a seeded world-actor over the simulated clock — pause/step to control it.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, events = R.events, clock = R.clock, random = R.random, log = R.log;

    const LINES = [
      'hey! how are you?',
      'did you see the example runtime working?',
      'the clock pausing is kind of magic',
      'try stepping time while I am mid-sentence',
      'ok I have to run — talk later!',
    ];
    let seq = 0;
    function addMessage(from, text) {
      db.create('messages', { from: from, text: text, t: clock.now(), seq: seq++ });
    }

    // The "other person": a stateful actor that works through a script line by line.
    const other = R.actor({
      state: { index: 0 },
      everyMs: 2500,
      jitterMs: 1200,
      tick: async function (ctx) {
        if (ctx.state.index >= LINES.length) return;
        const line = LINES[ctx.state.index];
        ctx.set({ index: ctx.state.index + 1 });
        events.publish('chat:incoming', line);
        log.info('incoming', line);
      },
    });

    function useMessages() {
      const read = function () { return db.query('messages', { order: { field: 'seq', dir: 'asc' } }); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe('messages', function () { setRows(read()); }); }, []);
      return rows;
    }
    function Chat() {
      const messages = useMessages();
      const [text, setText] = useState('');

      // Wire the incoming-event bus to the transcript, and start the actor + clock once.
      useEffect(function () {
        const off = events.subscribe('chat:incoming', function (line) {
          addMessage('them', line);
        });
        other.start();
        clock.play();
        log.info('chat session started');
        return function () { off(); other.stop(); };
      }, []);

      const send = function () {
        const t = text.trim();
        if (!t) return;
        addMessage('me', t);
        setText('');
        // A user action schedules a one-off reply via the simulated clock.
        clock.setTimeout(function () {
          events.publish('chat:incoming', random.pick(['nice', 'totally', 'haha yes', 'go on…']));
        }, 1500);
      };

      const wrap = { display: 'flex', flexDirection: 'column', height: '100vh',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111', background: '#fff' };
      const bar = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid #ececec', fontSize: 13, color: '#6b7280' };
      const list = { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 };
      const bubble = function (mine) { return { alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '72%', padding: '9px 13px', borderRadius: 16, fontSize: 15,
        background: mine ? '#111' : '#f1f1f3', color: mine ? '#fff' : '#111' }; };
      const composer = { display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid #ececec' };
      const input = { flex: 1, padding: '11px 13px', borderRadius: 999, border: '1px solid #d4d4d4', fontSize: 15 };
      const sendBtn = { padding: '11px 18px', borderRadius: 999, border: 'none', background: '#111',
        color: '#fff', cursor: 'pointer', fontSize: 15 };

      return h('div', { style: wrap },
        h('div', { style: bar },
          h('strong', { style: { color: '#111' } }, 'Sam'),
        ),
        h('div', { style: list },
          messages.map(function (m) {
            return h('div', { key: m.id, style: bubble(m.from === 'me') }, m.text);
          }),
        ),
        h('div', { style: composer },
          h('input', { style: input, value: text, placeholder: 'Message…',
            onChange: function (e) { setText(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') send(); } }),
          h('button', { style: sendBtn, onClick: send }, 'Send'),
        ),
      );
    }

    window.App = Chat;
  `,
};
