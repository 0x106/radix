// Slack/Discord bot (#31 from example-apps.md).
// A reactive bot actor responds to messages with keyword matching. The UI is a
// minimal chat interface. Demonstrates:
//   - Conversational interface driven by a reactive actor
//   - Keyword-based response routing (simple NLP stand-in)
//   - Actor uses a short clock.setTimeout to simulate typing delay

export const slackbot = {
  name: "Slack bot",
  description:
    "Chat with a bot that responds to keywords. A reactive actor handles incoming messages and replies after a short typing delay.",
  source: /* js */ `
    const { useState, useEffect, useRef } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, events = R.events, clock = R.clock, log = R.log, random = R.random;

    const BOT = 'Radix Bot';
    const RESPONSES = {
      hello:   ['Hey there!', 'Hello!', 'Hi! How can I help?'],
      help:    ['Commands: hello, help, time, joke, status, ping. Or just chat!'],
      time:    ['Current sim time: {TIME}s'],
      joke:    [
        'Why do programmers prefer dark mode? Because light attracts bugs.',
        'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"',
        'Why do Java developers wear glasses? Because they do not C#.',
        'How many programmers does it take to change a lightbulb? None — that is a hardware problem.',
      ],
      status:  ['All systems operational.', 'Everything looks good!', 'Running smoothly.'],
      ping:    ['Pong!'],
      thanks:  ['No problem!', 'Happy to help!', 'Any time!'],
      bye:     ['Goodbye!', 'See you later!', 'Take care!'],
    };

    db.__seed(function (api) {
      api.create('messages', { id: 'm0', author: BOT, text: 'Hello! I am Radix Bot. Try: hello, help, time, joke, ping.', ts: 0 });
    });

    // Bot actor: reacts to 'message:new', picks a response after a short delay.
    const botActor = R.actor({
      on: {
        'message:new': async function (payload, ctx) {
          if (payload.author === BOT) return;
          var text = (payload.text || '').toLowerCase();
          var now = ctx.clock.now();
          var reply = null;

          // Keyword matching
          for (var key in RESPONSES) {
            if (text.indexOf(key) >= 0) {
              reply = ctx.random.pick(RESPONSES[key]);
              if (reply.indexOf('{TIME}') >= 0) {
                reply = reply.replace('{TIME}', (now / 1000).toFixed(0));
              }
              break;
            }
          }
          if (!reply) {
            reply = ctx.random.pick([
              'Interesting! Tell me more.',
              'I see. Try "help" to see what I can do.',
              'Hmm, I am not sure about that one.',
              'Got it.',
            ]);
          }

          var delay = 800 + ctx.random.int(0, 1200);
          ctx.clock.setTimeout(function () {
            ctx.db.create('messages', { author: BOT, text: reply, ts: ctx.clock.now() });
          }, delay);
        },
      },
    });

    function useMessages() {
      var [rows, setRows] = useState(function () {
        return db.query('messages', { order: { field: 'ts', dir: 'asc' } });
      });
      useEffect(function () {
        return db.subscribe('messages', function () {
          setRows(db.query('messages', { order: { field: 'ts', dir: 'asc' } }));
        });
      }, []);
      return rows;
    }
    function useClock() {
      var [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (n, r) { setS({ now: n, running: r }); }); }, []);
      return s;
    }

    function SlackBot() {
      var messages = useMessages();
      var cs       = useClock();
      var [draft, setDraft] = useState('');
      var bottomRef = useRef(null);

      useEffect(function () {
        botActor.start(); clock.play();
        return function () { botActor.stop(); };
      }, []);

      useEffect(function () {
        if (bottomRef.current) {
          bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }, [messages.length]);

      function send() {
        var t = draft.trim(); if (!t) return;
        var msg = db.create('messages', { author: 'You', text: t, ts: clock.now() });
        events.publish('message:new', { author: 'You', text: t, id: msg.id });
        setDraft('');
      }

      var S = {
        page:  { fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111',
                 height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' },
        hdr:   { padding: '10px 14px', borderBottom: '1px solid #e5e7eb',
                 display: 'flex', alignItems: 'center', gap: 8 },
        feed:  { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 },
        input: { borderTop: '1px solid #e5e7eb', padding: '10px 14px',
                 display: 'flex', gap: 8, background: '#fff' },
        cb:    { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
      };

      return h('div', { style: S.page },
        h('div', { style: S.hdr },
          h('div', { style: { width: 8, height: 8, borderRadius: '50%', background: '#15803d' } }),
          h('strong', { style: { fontSize: 14, flex: 1 } }, '# general'),
          h('span', { style: { fontSize: 11, color: '#9ca3af' } }, (cs.now / 1000).toFixed(0) + 's'),
          h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
        ),
        h('div', { style: S.feed },
          messages.map(function (msg) {
            var isBot = msg.author === BOT;
            return h('div', { key: msg.id, style: {
                display: 'flex', gap: 10, alignSelf: isBot ? 'flex-start' : 'flex-end',
                flexDirection: isBot ? 'row' : 'row-reverse', maxWidth: '80%' } },
              h('div', { style: {
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: isBot ? '#f3f4f6' : '#111',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: isBot ? '#6b7280' : '#fff', fontWeight: 700,
                }},
                isBot ? '🤖' : 'Y',
              ),
              h('div', null,
                h('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 2,
                    textAlign: isBot ? 'left' : 'right' } },
                  msg.author + '  ' + (msg.ts / 1000).toFixed(0) + 's'),
                h('div', { style: {
                    background: isBot ? '#f3f4f6' : '#111',
                    color: isBot ? '#111' : '#fff',
                    borderRadius: isBot ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                    padding: '8px 12px', fontSize: 14, lineHeight: 1.4,
                  }},
                  msg.text,
                ),
              ),
            );
          }),
          h('div', { ref: bottomRef }),
        ),
        h('div', { style: S.input },
          h('input', {
            style: { flex: 1, border: '1px solid #e5e7eb', borderRadius: 8,
              padding: '9px 12px', fontSize: 14 },
            value: draft,
            placeholder: 'Message #general',
            onChange: function (e) { setDraft(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') send(); },
          }),
          h('button', {
            style: { border: 'none', background: '#111', color: '#fff', borderRadius: 8,
              padding: '9px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
            onClick: send,
          }, 'Send'),
        ),
      );
    }

    window.App = SlackBot;
  `,
};
