// Multiplayer trivia (#5 from example-apps.md).
// 8-question quiz. A game-master actor drives the round timer; two opponent
// actors answer after a random delay. Demonstrates:
//   - Actor-managed game loop (phase transitions, countdown)
//   - Multiple actors coordinating via events ('round:started')
//   - Game state stored as a single db row, subscribed to by the UI

export const trivia = {
  name: "Multiplayer trivia",
  description:
    "8-question quiz with two simulated opponents. A game-master actor drives the round timer; opponents answer with a random delay.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, events = R.events, clock = R.clock, log = R.log, random = R.random;

    const QS = [
      { q: 'Capital of France?',            opts: ['Berlin','Madrid','Paris','Rome'],       a: 2 },
      { q: 'Sides on a hexagon?',           opts: ['5','6','7','8'],                        a: 1 },
      { q: '12 × 8 = ?',                    opts: ['84','96','104','112'],                  a: 1 },
      { q: 'Closest planet to the Sun?',    opts: ['Venus','Earth','Mercury','Mars'],       a: 2 },
      { q: 'Bits in a byte?',               opts: ['4','8','16','32'],                      a: 1 },
      { q: 'Author of Romeo and Juliet?',   opts: ['Dickens','Austen','Shakespeare','Poe'], a: 2 },
      { q: 'Largest ocean?',                opts: ['Atlantic','Indian','Arctic','Pacific'], a: 3 },
      { q: 'What does CPU stand for?',      opts: ['Core Processing Unit','Central Processing Unit','Computer Power Unit','Compute Process Unit'], a: 1 },
    ];
    const ROUND_SECS = 10;

    db.__seed(function (api) {
      api.create('game', { id: 'state', qi: 0, phase: 'answering',
        timer: ROUND_SECS, playerScore: 0, aliceScore: 0, bobScore: 0 });
    });

    // Game master: ticks every 1 s, manages timer and phase transitions.
    const gameMaster = R.actor({
      everyMs: 1000,
      start: async function (ctx) {
        ctx.events.publish('round:started', { qi: 0 });
        ctx.log.info('Q1 — ' + QS[0].q);
      },
      tick: async function (ctx) {
        var g = ctx.db.get('game', 'state');
        if (!g || g.phase === 'done') return;
        if (g.phase === 'answering') {
          var t = g.timer - 1;
          if (t <= 0) {
            ctx.db.update('game', 'state', { phase: 'results', timer: 3 });
          } else {
            ctx.db.update('game', 'state', { timer: t });
          }
        } else if (g.phase === 'results') {
          var t2 = g.timer - 1;
          if (t2 <= 0) {
            var next = g.qi + 1;
            if (next >= QS.length) {
              ctx.db.update('game', 'state', { phase: 'done' });
              ctx.log.info('Game over!');
            } else {
              ctx.db.update('game', 'state', { qi: next, phase: 'answering', timer: ROUND_SECS });
              ctx.events.publish('round:started', { qi: next });
              ctx.log.info('Q' + (next + 1) + ' — ' + QS[next].q);
            }
          } else {
            ctx.db.update('game', 'state', { timer: t2 });
          }
        }
      },
    });

    function makeOpponent(name, scoreField) {
      return R.actor({
        on: {
          'round:started': async function (payload, ctx) {
            var delay = 2000 + ctx.random.int(0, 6000);
            ctx.clock.setTimeout(function () {
              var g = ctx.db.get('game', 'state');
              if (!g || g.phase !== 'answering' || g.qi !== payload.qi) return;
              var q = QS[payload.qi];
              var correct = ctx.random.random() < 0.65;
              var patch = {};
              if (correct) { patch[scoreField] = (g[scoreField] || 0) + 1; }
              ctx.db.update('game', 'state', patch);
              ctx.log.info(name + ': ' + (correct ? 'correct' : 'wrong'));
            }, delay);
          },
        },
      });
    }
    const alice = makeOpponent('Alice', 'aliceScore');
    const bob   = makeOpponent('Bob',   'bobScore');

    function useGame() {
      var [g, setG] = useState(function () { return db.get('game', 'state'); });
      useEffect(function () {
        return db.subscribe('game', function () { setG(db.get('game', 'state')); });
      }, []);
      return g;
    }
    function useClock() {
      var [s, setS] = useState({ running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (_, r) { setS({ running: r }); }); }, []);
      return s;
    }

    function restart() {
      db.reset();
      gameMaster.stop(); alice.stop(); bob.stop();
      gameMaster.start(); alice.start(); bob.start();
    }

    function TriviaGame() {
      var g    = useGame();
      var cs   = useClock();
      var [myAnswer, setMyAnswer] = useState(-1);

      useEffect(function () {
        alice.start(); bob.start(); gameMaster.start();
        clock.play();
        return function () { gameMaster.stop(); alice.stop(); bob.stop(); };
      }, []);

      useEffect(function () { setMyAnswer(-1); }, [g && g.qi]);

      if (!g) return h('div', null, 'Loading…');

      var S = {
        page: { maxWidth: 440, margin: '0 auto', padding: '28px 20px',
                fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' },
        card: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, background: '#fff', marginBottom: 12 },
        cb:   { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
      };

      if (g.phase === 'done') {
        var scores = [
          { name: 'You',   s: g.playerScore },
          { name: 'Alice', s: g.aliceScore  },
          { name: 'Bob',   s: g.bobScore    },
        ].sort(function (a, b) { return b.s - a.s; });
        return h('div', { style: S.page },
          h('h2', { style: { fontWeight: 700, fontSize: 22, marginBottom: 16 } }, 'Game over'),
          h('div', { style: S.card },
            scores.map(function (p, i) {
              return h('div', { key: p.name, style: { display: 'flex', justifyContent: 'space-between',
                  padding: '7px 0', borderBottom: i < 2 ? '1px solid #f3f4f6' : 'none',
                  fontWeight: i === 0 ? 700 : 400 } },
                h('span', null, (i === 0 ? '★ ' : '') + p.name),
                h('span', null, p.s + '/' + QS.length),
              );
            }),
          ),
          h('button', {
            style: { border: 'none', borderRadius: 8, background: '#111', color: '#fff',
              padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
            onClick: restart,
          }, 'Play again'),
        );
      }

      var q       = QS[g.qi];
      var showing = g.phase === 'results' || myAnswer >= 0;

      return h('div', { style: S.page },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 } },
          h('span', { style: { fontSize: 13, color: '#9ca3af' } }, 'Q' + (g.qi + 1) + ' of ' + QS.length),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
            h('button', { style: S.cb, onClick: function () { clock.step(1000); } }, '+1s'),
          ),
        ),
        h('div', { style: Object.assign({}, S.card, { display: 'flex', gap: 0 }) },
          [['You', g.playerScore], ['Alice', g.aliceScore], ['Bob', g.bobScore]].map(function (p) {
            return h('div', { key: p[0], style: { flex: 1, textAlign: 'center' } },
              h('div', { style: { fontSize: 26, fontWeight: 700 } }, p[1]),
              h('div', { style: { fontSize: 12, color: '#9ca3af' } }, p[0]),
            );
          }),
        ),
        g.phase === 'answering' &&
          h('div', { style: { textAlign: 'center', marginBottom: 10 } },
            h('span', { style: { fontSize: 40, fontWeight: 700, color: g.timer <= 3 ? '#b91c1c' : '#111' } }, g.timer),
            h('span', { style: { fontSize: 13, color: '#9ca3af', marginLeft: 6 } }, 's left'),
          ),
        h('div', { style: S.card },
          h('div', { style: { fontWeight: 600, fontSize: 15, marginBottom: 12 } }, q.q),
          q.opts.map(function (opt, i) {
            var isCorrect = i === q.a;
            var bg = showing ? (isCorrect ? '#f0fdf4' : '#fff') : '#fff';
            var border = showing ? (isCorrect ? '1.5px solid #86efac' : '1px solid #e5e7eb') : '1px solid #e5e7eb';
            return h('button', {
              key: i,
              style: { display: 'block', width: '100%', textAlign: 'left', padding: '9px 13px',
                borderRadius: 8, border: border, background: bg, cursor: 'pointer', fontSize: 14,
                marginBottom: 6 },
              onClick: function () {
                if (myAnswer >= 0 || g.phase !== 'answering') return;
                setMyAnswer(i);
                if (i === q.a) db.update('game', 'state', { playerScore: g.playerScore + 1 });
                log.info('You: ' + (i === q.a ? 'correct' : 'wrong'));
              },
            }, opt);
          }),
        ),
      );
    }

    window.App = TriviaGame;
  `,
};
