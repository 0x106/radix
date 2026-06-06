// DevOps / CI-CD monitor (#17 from example-apps.md).
// Three pipelines each run on their own schedule. Each pipeline actor walks
// through stages (build → test → lint → deploy) with simulated durations and
// occasional failures. Demonstrates:
//   - Operational dashboards driven by actor-emitted events
//   - Sequential stage progression within a single actor tick
//   - Failure handling: actor logs errors and marks run failed

export const devops = {
  name: "CI/CD pipeline monitor",
  description:
    "Three pipelines on independent schedules. Each actor walks through build → test → lint → deploy, with occasional failures.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log, random = R.random;

    const PIPELINE_DEFS = [
      { id: 'frontend', name: 'frontend',  everyMs: 20000 },
      { id: 'backend',  name: 'backend',   everyMs: 30000 },
      { id: 'infra',    name: 'infra',     everyMs: 45000 },
    ];
    const STAGES = ['build', 'test', 'lint', 'deploy'];
    const STAGE_MS = { build: 3000, test: 5000, lint: 1500, deploy: 2500 };

    db.__seed(function (api) {
      PIPELINE_DEFS.forEach(function (p) {
        api.create('pipelines', { id: p.id, name: p.name, everyMs: p.everyMs,
          lastStatus: 'never', lastRunAt: null });
      });
      log.info('3 pipelines registered — advance clock to trigger runs');
    });

    // One actor per pipeline. Each tick creates a run and walks through stages.
    var pipelineActors = PIPELINE_DEFS.map(function (def) {
      return R.actor({
        everyMs: def.everyMs,
        tick: async function (ctx) {
          var runId = def.id + '-' + ctx.clock.now();
          ctx.db.create('runs', { id: runId, pipelineId: def.id,
            status: 'running', stage: 'build', startedAt: ctx.clock.now(), log: [] });
          ctx.db.update('pipelines', def.id, { lastRunAt: ctx.clock.now(), lastStatus: 'running' });
          ctx.log.info(def.name + ': run started');

          var failed = false;
          for (var i = 0; i < STAGES.length; i++) {
            var stage = STAGES[i];
            var stageMs = STAGE_MS[stage] + ctx.random.int(0, 1000);
            // await the stage delay via a clock setTimeout wrapped in a Promise
            await new Promise(function (resolve) { ctx.clock.setTimeout(resolve, stageMs); });
            if (failed) break;
            // 8% chance of failure per stage
            if (ctx.random.random() < 0.08) {
              ctx.db.update('runs', runId, { status: 'failed', stage: stage, endedAt: ctx.clock.now() });
              ctx.db.update('pipelines', def.id, { lastStatus: 'failed' });
              ctx.log.error(def.name + ': failed at ' + stage);
              failed = true;
              break;
            }
            ctx.db.update('runs', runId, { stage: i < STAGES.length - 1 ? STAGES[i + 1] : 'deploy' });
            ctx.log.info(def.name + ': ' + stage + ' passed');
          }

          if (!failed) {
            ctx.db.update('runs', runId, { status: 'passed', stage: 'done', endedAt: ctx.clock.now() });
            ctx.db.update('pipelines', def.id, { lastStatus: 'passed' });
            ctx.log.info(def.name + ': all stages passed');
          }
        },
      });
    });

    function usePipelines() {
      var [rows, setRows] = useState(function () { return db.query('pipelines'); });
      useEffect(function () {
        return db.subscribe('pipelines', function () { setRows(db.query('pipelines')); });
      }, []);
      return rows;
    }
    function useRuns(pipelineId) {
      var [rows, setRows] = useState([]);
      useEffect(function () {
        function read() {
          return pipelineId
            ? db.query('runs', { where: { pipelineId: pipelineId }, order: { field: 'startedAt', dir: 'desc' }, limit: 8 })
            : [];
        }
        setRows(read());
        return db.subscribe('runs', function () { setRows(read()); });
      }, [pipelineId]);
      return rows;
    }
    function useClock() {
      var [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (n, r) { setS({ now: n, running: r }); }); }, []);
      return s;
    }
    function useLog() {
      var [e, setE] = useState(log.entries());
      useEffect(function () { return log.subscribe(setE); }, []);
      return e;
    }

    var STATUS_COLOR = { passed: '#15803d', failed: '#b91c1c', running: '#b45309', never: '#9ca3af' };
    var STATUS_DOT   = { passed: '●', failed: '●', running: '◉', never: '○' };

    function DevOps() {
      var pipelines = usePipelines();
      var cs        = useClock();
      var entries   = useLog();
      var [sel, setSel] = useState('frontend');
      var runs = useRuns(sel);

      useEffect(function () {
        pipelineActors.forEach(function (a) { a.start(); });
        return function () { pipelineActors.forEach(function (a) { a.stop(); }); };
      }, []);

      var S = {
        page: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#111',
                height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', fontSize: 13 },
        hdr:  { padding: '9px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex',
                gap: 10, alignItems: 'center' },
        body: { flex: 1, display: 'flex', minHeight: 0 },
        left: { width: 200, borderRight: '1px solid #e5e7eb', overflowY: 'auto', padding: '8px 0' },
        mid:  { flex: 1, overflowY: 'auto', padding: 12 },
        foot: { borderTop: '1px solid #e5e7eb', padding: '6px 14px', maxHeight: 90,
                overflowY: 'auto', background: '#fafafa' },
        cb:   { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 7,
                padding: '3px 9px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
      };

      return h('div', { style: S.page },
        h('div', { style: S.hdr },
          h('strong', null, 'CI/CD'),
          h('span', { style: { color: '#9ca3af', fontSize: 11, flex: 1 } },
            't=' + (cs.now / 1000).toFixed(0) + 's  ' + (cs.running ? '● running' : '⏸ paused')),
          h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
          h('button', { style: S.cb, onClick: function () { clock.step(1000); } }, '+1s'),
          h('button', { style: S.cb, onClick: function () { clock.fastForward(10000); } }, '+10s'),
          h('button', { style: S.cb, onClick: function () { clock.fastForward(60000); } }, '+1m'),
        ),
        h('div', { style: S.body },
          // Pipeline list
          h('div', { style: S.left },
            pipelines.map(function (p) {
              var active = p.id === sel;
              var every = (p.everyMs / 1000).toFixed(0) + 's';
              return h('div', { key: p.id,
                style: { padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                  background: active ? '#f3f4f6' : 'transparent',
                  borderLeft: active ? '2px solid #111' : '2px solid transparent' },
                onClick: function () { setSel(p.id); },
              },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 } },
                  h('span', { style: { fontWeight: active ? 700 : 400 } }, p.name),
                  h('span', { style: { color: STATUS_COLOR[p.lastStatus] } },
                    STATUS_DOT[p.lastStatus]),
                ),
                h('div', { style: { fontSize: 11, color: '#9ca3af' } }, 'every ' + every),
              );
            }),
          ),
          // Run history for selected pipeline
          h('div', { style: S.mid },
            h('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 8,
                textTransform: 'uppercase', letterSpacing: 0.5 } }, sel + ' runs'),
            runs.length === 0
              ? h('div', { style: { color: '#9ca3af' } }, 'No runs yet — advance clock to trigger.')
              : runs.map(function (r) {
                  var dur = r.endedAt
                    ? ((r.endedAt - r.startedAt) / 1000).toFixed(1) + 's'
                    : 'running…';
                  return h('div', { key: r.id, style: { padding: '7px 0', borderBottom: '1px solid #f3f4f6',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                    h('div', null,
                      h('span', { style: { color: STATUS_COLOR[r.status], marginRight: 8 } },
                        STATUS_DOT[r.status]),
                      h('span', { style: { color: '#9ca3af', marginRight: 8, fontSize: 11 } },
                        (r.startedAt / 1000).toFixed(0) + 's'),
                      r.status === 'running'
                        ? h('span', { style: { color: '#b45309' } }, 'running ' + r.stage + '…')
                        : h('span', null, r.status === 'passed' ? 'passed' : 'failed at ' + r.stage),
                    ),
                    h('span', { style: { fontSize: 11, color: '#9ca3af' } }, dur),
                  );
                }),
          ),
        ),
        h('div', { style: S.foot },
          entries.slice().reverse().slice(0, 6).map(function (e, i) {
            return h('div', { key: i, style: { padding: '1px 0',
                color: e.level === 'error' ? '#b91c1c' : '#6b7280', fontSize: 12 } },
              (e.t / 1000).toFixed(0) + 's  ' + e.msg,
            );
          }),
        ),
      );
    }

    window.App = DevOps;
  `,
};
