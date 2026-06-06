// REST API service monitor (#27 from example-apps.md).
// A traffic actor generates simulated HTTP requests at ~1–3 per second of sim
// time. The UI is a headless-style console: endpoint health summary + live
// request log. Demonstrates:
//   - High-frequency actor writes (request log grows fast)
//   - Aggregate stats computed from db on each render
//   - Headless / operational console shell

export const apidashboard = {
  name: "API dashboard (headless)",
  description:
    "Live HTTP traffic monitor. A traffic actor generates requests; the console shows endpoint health and a rolling request log.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log, random = R.random;

    const ENDPOINT_DEFS = [
      { id: 'GET /users',         method: 'GET',    path: '/users'          },
      { id: 'GET /users/:id',     method: 'GET',    path: '/users/:id'      },
      { id: 'POST /users',        method: 'POST',   path: '/users'          },
      { id: 'GET /orders',        method: 'GET',    path: '/orders'         },
      { id: 'POST /orders',       method: 'POST',   path: '/orders'         },
      { id: 'GET /products',      method: 'GET',    path: '/products'       },
      { id: 'DELETE /users/:id',  method: 'DELETE', path: '/users/:id'      },
    ];
    const STATUS_WEIGHTS = [
      [200, 70], [201, 10], [400, 8], [404, 6], [500, 4], [429, 2],
    ];

    function weightedStatus(rng) {
      var total = STATUS_WEIGHTS.reduce(function (s, w) { return s + w[1]; }, 0);
      var r = rng.int(0, total - 1);
      for (var i = 0; i < STATUS_WEIGHTS.length; i++) {
        r -= STATUS_WEIGHTS[i][1];
        if (r < 0) return STATUS_WEIGHTS[i][0];
      }
      return 200;
    }

    db.__seed(function (api) {
      ENDPOINT_DEFS.forEach(function (e) {
        api.create('endpoints', { id: e.id, method: e.method, path: e.path,
          requests: 0, errors: 0, totalLatency: 0 });
      });
      log.info('7 endpoints registered — advance clock to generate traffic');
    });

    // Traffic actor: every 600–1800 ms generates a request to a random endpoint.
    const traffic = R.actor({
      everyMs: 600, jitterMs: 600,
      tick: async function (ctx) {
        var ep = ctx.random.pick(ENDPOINT_DEFS);
        var status  = weightedStatus(ctx.random);
        var latency = 20 + ctx.random.int(0, 280);
        var isError = status >= 400;

        var endpoint = ctx.db.get('endpoints', ep.id);
        if (endpoint) {
          ctx.db.update('endpoints', ep.id, {
            requests: (endpoint.requests || 0) + 1,
            errors:   (endpoint.errors   || 0) + (isError ? 1 : 0),
            totalLatency: (endpoint.totalLatency || 0) + latency,
          });
        }
        ctx.db.create('requests', {
          endpointId: ep.id, method: ep.method, path: ep.path,
          status: status, latency: latency, ts: ctx.clock.now(),
        });
      },
    });

    function useEndpoints() {
      var [rows, setRows] = useState(function () { return db.query('endpoints'); });
      useEffect(function () {
        return db.subscribe('endpoints', function () { setRows(db.query('endpoints')); });
      }, []);
      return rows;
    }
    function useRequests() {
      var [rows, setRows] = useState(function () {
        return db.query('requests', { order: { field: 'ts', dir: 'desc' }, limit: 40 });
      });
      useEffect(function () {
        return db.subscribe('requests', function () {
          setRows(db.query('requests', { order: { field: 'ts', dir: 'desc' }, limit: 40 }));
        });
      }, []);
      return rows;
    }
    function useClock() {
      var [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (n, r) { setS({ now: n, running: r }); }); }, []);
      return s;
    }

    var METHOD_COLOR = { GET: '#2563eb', POST: '#15803d', DELETE: '#b91c1c', PATCH: '#b45309', PUT: '#7c3aed' };
    function statusColor(s) {
      if (s < 300) return '#15803d';
      if (s < 400) return '#b45309';
      return '#b91c1c';
    }

    function ApiDashboard() {
      var endpoints = useEndpoints();
      var requests  = useRequests();
      var cs        = useClock();

      useEffect(function () {
        traffic.start();
        return function () { traffic.stop(); };
      }, []);

      var totalReqs   = endpoints.reduce(function (s, e) { return s + (e.requests || 0); }, 0);
      var totalErrors = endpoints.reduce(function (s, e) { return s + (e.errors   || 0); }, 0);
      var errorRate   = totalReqs > 0 ? (totalErrors / totalReqs * 100).toFixed(1) : '0.0';

      var S = {
        page: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#111',
                height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', fontSize: 12 },
        hdr:  { padding: '8px 14px', borderBottom: '1px solid #e5e7eb',
                display: 'flex', gap: 10, alignItems: 'center' },
        body: { flex: 1, display: 'flex', minHeight: 0 },
        left: { width: '55%', borderRight: '1px solid #e5e7eb', overflowY: 'auto', padding: '10px 0' },
        right:{ flex: 1, overflowY: 'auto', padding: '10px 0' },
        cb:   { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 7,
                padding: '3px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' },
      };

      return h('div', { style: S.page },
        h('div', { style: S.hdr },
          h('strong', null, 'API Monitor'),
          h('span', { style: { color: '#9ca3af', flex: 1 } },
            'total: ' + totalReqs + '  errors: ' + errorRate + '%  t=' + (cs.now / 1000).toFixed(0) + 's'),
          h('span', { style: { color: cs.running ? '#15803d' : '#b45309' } }, cs.running ? '● live' : '⏸'),
          h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
          h('button', { style: S.cb, onClick: function () { clock.fastForward(5000); } }, '+5s'),
          h('button', { style: S.cb, onClick: function () { clock.fastForward(30000); } }, '+30s'),
        ),
        h('div', { style: S.body },
          // Endpoint health table
          h('div', { style: S.left },
            h('div', { style: { padding: '2px 14px 6px', fontSize: 11, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: 0.5 } }, 'endpoints'),
            endpoints.map(function (ep) {
              var avg = ep.requests > 0
                ? Math.round(ep.totalLatency / ep.requests) + 'ms'
                : '—';
              var errPct = ep.requests > 0
                ? (ep.errors / ep.requests * 100).toFixed(0) + '%'
                : '0%';
              return h('div', { key: ep.id, style: { padding: '5px 14px',
                  borderBottom: '1px solid #f9f9f9',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h('div', null,
                  h('span', { style: { color: METHOD_COLOR[ep.method] || '#6b7280',
                      marginRight: 8, fontWeight: 700 } }, ep.method),
                  h('span', null, ep.path),
                ),
                h('div', { style: { display: 'flex', gap: 14, color: '#6b7280' } },
                  h('span', null, ep.requests + ' reqs'),
                  h('span', { style: { color: ep.errors > 0 ? '#b91c1c' : '#9ca3af' } }, errPct + ' err'),
                  h('span', null, avg),
                ),
              );
            }),
          ),
          // Request log
          h('div', { style: S.right },
            h('div', { style: { padding: '2px 12px 6px', fontSize: 11, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: 0.5 } }, 'request log'),
            requests.map(function (r) {
              return h('div', { key: r.id, style: { padding: '3px 12px',
                  borderBottom: '1px solid #fafafa', display: 'flex', gap: 8, alignItems: 'center' } },
                h('span', { style: { color: '#d1d5db', minWidth: 36 } }, (r.ts / 1000).toFixed(0) + 's'),
                h('span', { style: { color: METHOD_COLOR[r.method] || '#6b7280', minWidth: 46, fontWeight: 700 } }, r.method),
                h('span', { style: { color: statusColor(r.status), minWidth: 30 } }, r.status),
                h('span', { style: { color: '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.path),
                h('span', { style: { color: '#9ca3af' } }, r.latency + 'ms'),
              );
            }),
          ),
        ),
      );
    }

    window.App = ApiDashboard;
  `,
};
