// Headless prototype: a cron scheduler.
//
// Each job runs on its own repeating schedule via a separate actor. The UI is
// purely a debug console — there's nothing to click on the "app" side, so the
// simulation clock controls are the whole interface. Advancing simulated time
// is the only way to make jobs fire.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const cron = {
  name: "Cron scheduler (headless example)",
  description:
    "Headless cron scheduler: five jobs on independent repeating schedules, driven entirely by the simulated clock.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log;

    // Each job has a label, an interval (simulated ms), and a simulated run
    // duration. In a real cron these would be expressed as cron strings; here
    // we just use milliseconds of sim time to keep it tangible.
    const JOB_DEFS = [
      { id: 'expire-sessions',  label: 'Expire sessions',       everyMs:  10000, durationMs: 200 },
      { id: 'resize-avatars',   label: 'Resize avatars',        everyMs:  15000, durationMs: 600 },
      { id: 'rotate-logs',      label: 'Rotate logs',           everyMs:  20000, durationMs: 300 },
      { id: 'send-digests',     label: 'Send digest emails',    everyMs:  30000, durationMs: 1200 },
      { id: 'rebuild-search',   label: 'Rebuild search index',  everyMs:  45000, durationMs: 2000 },
    ];

    db.define({
      jobs: {
        fields: {
          label: 'string',
          everyMs: 'number',
          status: { type: 'enum', values: ['idle', 'running'] },
          runs: { type: 'number', default: 0 },
          lastRanAt: 'number',
        },
        seed: JOB_DEFS.map(function (j) {
          return { id: j.id, label: j.label, everyMs: j.everyMs, status: 'idle', runs: 0, lastRanAt: null };
        }),
      },
    });
    log.info('scheduler ready — ' + JOB_DEFS.length + ' jobs registered');

    // One actor per job. Each fires on its own schedule and records runs in db.
    const jobActors = JOB_DEFS.map(function (def) {
      return R.actor({
        everyMs: def.everyMs,
        tick: async function (ctx) {
          const job = ctx.db.get('jobs', def.id);
          if (!job || job.status === 'running') return; // skip if already in flight
          ctx.db.update('jobs', def.id, { status: 'running', lastRanAt: ctx.clock.now() });
          ctx.log.info('started', def.label);
          ctx.clock.setTimeout(function () {
            const current = ctx.db.get('jobs', def.id);
            const runs = current ? current.runs + 1 : 1;
            ctx.db.update('jobs', def.id, { status: 'idle', runs: runs });
            ctx.log.info('finished', def.label + ' (run #' + runs + ')');
          }, def.durationMs);
        },
      });
    });

    function useJobs() {
      const read = function () { return db.query('jobs', { order: { field: 'everyMs', dir: 'asc' } }); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe('jobs', function () { setRows(read()); }); }, []);
      return rows;
    }
    const STATUS_DOT = { idle: '#9ca3af', running: '#b45309' };

    function Console() {
      const jobs = useJobs();

      useEffect(function () {
        jobActors.forEach(function (a) { a.start(); });
        clock.play();
        return function () { jobActors.forEach(function (a) { a.stop(); }); };
      }, []);

      const wrap = { display: 'flex', flexDirection: 'column', height: '100vh',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#111', background: '#fff' };
      const head = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderBottom: '1px solid #ececec', fontSize: 13 };
      const tag = { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 6, padding: '2px 7px' };
      const body = { flex: 1, overflowY: 'auto', padding: '12px 14px' };

      return h('div', { style: wrap },
        h('div', { style: head },
          h('strong', null, 'cron-scheduler'),
          h('span', { style: tag }, 'headless'),
        ),
        h('div', { style: body },
          h('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 } }, 'jobs'),
          jobs.map(function (j) {
              const every = j.everyMs >= 60000
                ? (j.everyMs / 60000).toFixed(0) + 'm'
                : (j.everyMs / 1000).toFixed(0) + 's';
              const lastRan = j.lastRanAt !== null
                ? (j.lastRanAt / 1000).toFixed(1) + 's'
                : 'never';
              return h('div', { key: j.id, style: { padding: '6px 0', borderBottom: '1px solid #f5f5f5' } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5 } },
                  h('span', { style: { fontWeight: 500 } }, j.label),
                  h('span', { style: { color: STATUS_DOT[j.status] } },
                    j.status === 'running' ? '● running' : 'idle'),
                ),
                h('div', { style: { fontSize: 11, color: '#9ca3af', marginTop: 2 } },
                  'every ' + every + '  ·  runs: ' + j.runs + '  ·  last: ' + lastRan),
              );
            })
          )
      );
    }

    window.App = Console;
  `,
};
