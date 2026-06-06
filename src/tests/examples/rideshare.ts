// Ride-share driver app (#13 from example-apps.md).
// The player is the driver. A demand actor generates ride requests on a
// schedule and auto-expires them if ignored. Demonstrates:
//   - Market simulation: actor generates demand independently of the user
//   - Expiry pattern: actor polls and cleans up stale rows
//   - Mixed control: user accepts, runtime drives the rest

export const rideshare = {
  name: "Ride-share driver",
  description:
    "You are the driver. A demand actor generates ride requests that expire if ignored; accept one and drive to completion.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log, random = R.random;

    const PICKUPS  = ['Main St & 1st Ave', 'Central Park North', 'Airport Terminal 2',
                      'Downtown Mall', 'University Campus', 'Riverside Park'];
    const DROPOFFS = ['Midtown Hotel', 'Business District', 'South Station',
                      'Harbor View', 'Stadium', 'Old Town'];

    db.__seed(function (api) {
      api.create('driver', {
        id: 'me', status: 'available',
        earnings: 0, ridesCompleted: 0,
      });
      log.info('driver online — waiting for requests');
    });

    // Demand actor: generates requests every 8–16 s, expires unclaimed ones after 12 s.
    const demand = R.actor({
      everyMs: 8000, jitterMs: 4000,
      tick: async function (ctx) {
        var driver = ctx.db.get('driver', 'me');
        if (!driver || driver.status !== 'available') return;

        // Expire old pending requests first
        var now = ctx.clock.now();
        ctx.db.query('requests', { where: { status: 'pending' } }).forEach(function (r) {
          if (now - r.createdAt > 12000) {
            ctx.db.update('requests', r.id, { status: 'expired' });
            ctx.log.info('request expired: ' + r.pickup);
          }
        });

        // Create a new request if none pending
        var hasPending = ctx.db.query('requests', { where: { status: 'pending' } }).length > 0;
        if (hasPending) return;

        var fare    = 8 + ctx.random.int(0, 14);
        var pickup  = ctx.random.pick(PICKUPS);
        var dropoff = ctx.random.pick(DROPOFFS);
        ctx.db.create('requests', {
          pickup: pickup, dropoff: dropoff,
          fare: fare, status: 'pending', createdAt: now,
        });
        ctx.log.info('new request: ' + pickup + ' → ' + dropoff + ' $' + fare);
      },
    });

    function useDriver() {
      var [d, setD] = useState(function () { return db.get('driver', 'me'); });
      useEffect(function () {
        return db.subscribe('driver', function () { setD(db.get('driver', 'me')); });
      }, []);
      return d;
    }
    function useRequests() {
      var [rows, setRows] = useState(function () { return db.query('requests'); });
      useEffect(function () {
        return db.subscribe('requests', function () { setRows(db.query('requests')); });
      }, []);
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

    function acceptRide(request) {
      db.update('driver',   'me',         { status: 'on_ride', currentRequestId: request.id });
      db.update('requests', request.id,   { status: 'accepted', acceptedAt: clock.now() });
      log.info('accepted ride to ' + request.dropoff);
      var driveMs = 10000 + random.int(0, 10000);
      clock.setTimeout(function () {
        var driver = db.get('driver', 'me');
        if (!driver || driver.status !== 'on_ride') return;
        var r = db.get('requests', request.id);
        if (!r) return;
        db.update('requests', request.id, { status: 'completed', completedAt: clock.now() });
        db.update('driver', 'me', {
          status: 'available',
          earnings: (driver.earnings || 0) + request.fare,
          ridesCompleted: (driver.ridesCompleted || 0) + 1,
          currentRequestId: null,
        });
        log.info('ride complete — earned $' + request.fare);
      }, driveMs);
    }

    function RideShare() {
      var driver   = useDriver();
      var requests = useRequests();
      var cs       = useClock();
      var entries  = useLog();

      useEffect(function () {
        demand.start(); clock.play();
        return function () { demand.stop(); };
      }, []);

      if (!driver) return h('div', null, 'Loading…');

      var pending  = requests.filter(function (r) { return r.status === 'pending'; })[0] || null;
      var active   = driver.currentRequestId
        ? db.get('requests', driver.currentRequestId) : null;
      var history  = requests.filter(function (r) { return r.status === 'completed'; }).slice(-5).reverse();

      var S = {
        page:  { maxWidth: 420, margin: '0 auto', padding: '20px 16px',
                 fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111',
                 background: '#f9fafb', minHeight: '100vh' },
        card:  { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb',
                 padding: '14px 16px', marginBottom: 12 },
        label: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
        cb:    { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
        pri:   { border: 'none', borderRadius: 8, background: '#111', color: '#fff',
                 padding: '10px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
        dec:   { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff',
                 padding: '10px 18px', cursor: 'pointer', fontSize: 14 },
      };

      return h('div', { style: S.page },
        // Header
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 } },
          h('strong', { style: { fontSize: 18 } }, 'Driver'),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
            h('button', { style: S.cb, onClick: function () { clock.fastForward(10000); } }, '+10s'),
          ),
        ),
        // Stats
        h('div', { style: Object.assign({}, S.card, { display: 'flex', gap: 20 }) },
          h('div', null,
            h('div', { style: S.label }, 'Status'),
            h('div', { style: { fontWeight: 600, fontSize: 15,
              color: driver.status === 'available' ? '#15803d' : '#b45309' } },
              driver.status === 'available' ? 'Available' : 'On a ride'),
          ),
          h('div', null,
            h('div', { style: S.label }, 'Earnings'),
            h('div', { style: { fontWeight: 700, fontSize: 20 } }, '$' + (driver.earnings || 0).toFixed(2)),
          ),
          h('div', null,
            h('div', { style: S.label }, 'Rides'),
            h('div', { style: { fontWeight: 700, fontSize: 20 } }, driver.ridesCompleted || 0),
          ),
        ),
        // Incoming request
        pending && driver.status === 'available' &&
          h('div', { style: S.card },
            h('div', { style: S.label }, 'Incoming request'),
            h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 2 } }, '$' + pending.fare + ' fare'),
            h('div', { style: { fontSize: 13, color: '#6b7280', marginBottom: 10 } },
              pending.pickup + ' → ' + pending.dropoff),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('button', { style: S.pri, onClick: function () { acceptRide(pending); } }, 'Accept'),
              h('button', { style: S.dec,
                onClick: function () { db.update('requests', pending.id, { status: 'declined' }); }
              }, 'Decline'),
            ),
          ),
        // Active ride
        active && active.status === 'accepted' &&
          h('div', { style: S.card },
            h('div', { style: S.label }, 'Active ride'),
            h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 2 } }, active.dropoff),
            h('div', { style: { fontSize: 13, color: '#9ca3af' } }, 'En route… fare: $' + active.fare),
          ),
        !pending && driver.status === 'available' &&
          h('div', { style: Object.assign({}, S.card, { textAlign: 'center', color: '#9ca3af', fontSize: 14 }) },
            'Waiting for a request…'),
        // Recent rides
        history.length > 0 && h('div', { style: S.card },
          h('div', { style: S.label }, 'Recent rides'),
          history.map(function (r, i) {
            return h('div', { key: r.id, style: { fontSize: 13, padding: '4px 0',
                borderBottom: i < history.length - 1 ? '1px solid #f3f4f6' : 'none' } },
              h('span', { style: { color: '#9ca3af', marginRight: 8 } }, '$' + r.fare),
              r.pickup + ' → ' + r.dropoff,
            );
          }),
        ),
        // Log
        h('div', { style: { fontSize: 12, color: '#6b7280' } },
          entries.slice().reverse().slice(0, 4).map(function (e, i) {
            return h('div', { key: i }, (e.t / 1000).toFixed(0) + 's  ' + e.msg);
          }),
        ),
      );
    }

    window.App = RideShare;
  `,
};
