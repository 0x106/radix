// PHASE 0 EXAMPLE — headless prototype: a cron worker with no real UI.
//
// Purpose: exercise the *clock-advanced, headless* corner (notes.md §4) — there
// is no app to click, so the only interface is a debug console. It drives the
// simulated `clock` (play / pause / step / fast-forward), reads the `log`, and
// inspects `db` state. This is the deliberate embryo of the Phase 4 simulation
// console: the worker itself does nothing visible; the cockpit is the whole UI.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const cron = {
  name: "Cron worker (headless example)",
  description:
    "Phase 0 example: a headless cron worker driven by the simulated clock — debug console only (no app UI).",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log;

    const INTERVAL = 5000; // run the job every 5s of simulated time

    db.__seed(function (api) {
      ['resize avatars', 'send digest emails', 'rotate logs', 'rebuild search index', 'expire sessions']
        .forEach(function (label, i) { api.create('queue', { label: label, status: 'pending', seq: i }); });
      log.info('worker booted — ' + 5 + ' jobs queued (clock is paused; press Play or Step)');
    });

    // The cron job: each tick, take the oldest pending item and process it.
    function tick() {
      const pending = db.query('queue', { where: { status: 'pending' }, order: { field: 'seq', dir: 'asc' }, limit: 1 });
      if (pending.length === 0) {
        log.debug('tick — idle, nothing to process');
      } else {
        const job = pending[0];
        db.update('queue', job.id, { status: 'running' });
        log.info('processing job', job.label);
        // Simulated work takes ~800ms of sim time, then completes.
        clock.setTimeout(function () {
          db.update('queue', job.id, { status: 'done' });
          log.info('completed job', job.label);
        }, 800);
      }
      clock.setTimeout(tick, INTERVAL);
    }

    function useLog() {
      const [entries, setEntries] = useState(log.entries());
      useEffect(function () { return log.subscribe(setEntries); }, []);
      return entries;
    }
    function useQueue() {
      const read = function () { return db.query('queue', { order: { field: 'seq', dir: 'asc' } }); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe('queue', function () { setRows(read()); }); }, []);
      return rows;
    }
    function useClock() {
      const [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (now, running) { setS({ now: now, running: running }); }); }, []);
      return s;
    }

    const LEVEL_COLOR = { debug: '#9ca3af', info: '#2563eb', warn: '#b45309', error: '#b91c1c' };
    const STATUS_COLOR = { pending: '#6b7280', running: '#b45309', done: '#15803d' };

    function Console() {
      const entries = useLog();
      const queue = useQueue();
      const cs = useClock();

      useEffect(function () {
        // Kick off the first scheduled tick (fires only as the clock advances).
        const cancel = clock.setTimeout(tick, INTERVAL);
        return function () { cancel(); };
      }, []);

      const sec = (cs.now / 1000).toFixed(1);
      const counts = queue.reduce(function (acc, j) { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});

      const wrap = { display: 'flex', flexDirection: 'column', height: '100vh',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#111', background: '#fff' };
      const head = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderBottom: '1px solid #ececec', fontSize: 13 };
      const tag = { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 6, padding: '2px 7px' };
      const btn = { border: '1px solid #e5e5e5', background: '#fafafa', borderRadius: 8,
        padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
      const body = { flex: 1, display: 'flex', minHeight: 0 };
      const logPane = { flex: 2, overflowY: 'auto', padding: '12px 14px', borderRight: '1px solid #ececec' };
      const statePane = { flex: 1, overflowY: 'auto', padding: '12px 14px' };
      const logRow = { display: 'flex', gap: 10, padding: '2px 0', fontSize: 12.5, lineHeight: 1.5 };

      return h('div', { style: wrap },
        h('div', { style: head },
          h('strong', null, 'cron-worker'),
          h('span', { style: tag }, 'headless'),
          h('span', { style: { color: '#6b7280' } }, 'sim t=' + sec + 's'),
          h('span', { style: { color: cs.running ? '#15803d' : '#b45309' } }, cs.running ? '● running' : '⏸ paused'),
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            h('button', { style: btn, onClick: function () { cs.running ? clock.pause() : clock.play(); } },
              cs.running ? 'Pause' : 'Play'),
            h('button', { style: btn, onClick: function () { clock.step(1000); } }, 'Step +1s'),
            h('button', { style: btn, onClick: function () { clock.fastForward(5000); } }, '+5s'),
            h('button', { style: btn, onClick: function () { clock.fastForward(60000); } }, '+1m'),
          ),
        ),
        h('div', { style: body },
          // --- event log ---
          h('div', { style: logPane },
            h('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 } }, 'event log'),
            entries.map(function (e, i) {
              return h('div', { key: i, style: logRow },
                h('span', { style: { color: '#9ca3af', minWidth: 56 } }, (e.t / 1000).toFixed(1) + 's'),
                h('span', { style: { color: LEVEL_COLOR[e.level], minWidth: 44, textTransform: 'uppercase' } }, e.level),
                h('span', null, e.msg + (e.data !== undefined ? ' — ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) : '')),
              );
            }),
          ),
          // --- state inspector ---
          h('div', { style: statePane },
            h('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 } }, 'state · queue'),
            h('div', { style: { fontSize: 12, color: '#6b7280', marginBottom: 10 } },
              ['pending', 'running', 'done'].map(function (s) {
                return h('span', { key: s, style: { marginRight: 12 } }, s + ': ' + (counts[s] || 0));
              })),
            queue.map(function (j) {
              return h('div', { key: j.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' } },
                h('span', null, j.label),
                h('span', { style: { color: STATUS_COLOR[j.status] } }, j.status),
              );
            }),
          ),
        ),
      );
    }

    window.App = Console;
  `,
};
