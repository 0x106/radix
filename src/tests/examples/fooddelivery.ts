// Food delivery app (#2 from example-apps.md).
//
// The canonical multi-system example: a customer browses restaurants, places an
// order, and tracks it live. Two actors run the back-end simulation:
//   - restaurantActor: reactive to 'order:placed'; moves the order through
//     placed → accepted → preparing → ready with timed delays.
//   - driverActor: ticks every 2s; finds ready orders + available drivers,
//     assigns them, then delivers after a simulated drive time.
//
// Demonstrates:
//   - Multiple db collections with cross-collection queries (restaurants, menu
//     items, orders, drivers)
//   - Actor coordination via db state (driver reads 'ready' orders from db)
//   - Denormalised writes (items array stored on the order row)
//   - UI reads db via subscribe; actors are the only things that write order state
//   - Clock-based delays at multiple points in a single workflow
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const fooddelivery = {
  name: "Food delivery",
  description:
    "Order from a restaurant and track it live. A restaurant actor accepts and prepares; a driver actor picks up and delivers.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, events = R.events, clock = R.clock, log = R.log, random = R.random;

    // --- seed ----------------------------------------------------------------
    db.__seed(function (api) {
      api.create('restaurants', { id: 'r1', name: 'Burger Palace',  cuisine: 'American', rating: 4.3, deliveryMins: 25 });
      api.create('restaurants', { id: 'r2', name: 'Sushi Garden',   cuisine: 'Japanese', rating: 4.7, deliveryMins: 35 });
      api.create('restaurants', { id: 'r3', name: 'Pasta Bella',    cuisine: 'Italian',  rating: 4.5, deliveryMins: 30 });

      [
        { id: 'm1', restaurantId: 'r1', name: 'Classic Burger',      price: 12.99 },
        { id: 'm2', restaurantId: 'r1', name: 'Cheeseburger',        price: 13.99 },
        { id: 'm3', restaurantId: 'r1', name: 'Fries',               price:  4.99 },
        { id: 'm4', restaurantId: 'r2', name: 'Salmon Nigiri (x2)',  price:  8.99 },
        { id: 'm5', restaurantId: 'r2', name: 'Tuna Roll',           price: 10.99 },
        { id: 'm6', restaurantId: 'r2', name: 'Miso Soup',           price:  3.99 },
        { id: 'm7', restaurantId: 'r3', name: 'Spaghetti Carbonara', price: 14.99 },
        { id: 'm8', restaurantId: 'r3', name: 'Margherita Pizza',    price: 13.99 },
        { id: 'm9', restaurantId: 'r3', name: 'Tiramisu',            price:  7.99 },
      ].forEach(function (item) { api.create('menu_items', item); });

      api.create('drivers', { id: 'd1', name: 'Alex', status: 'available', currentOrderId: null });
      api.create('drivers', { id: 'd2', name: 'Sam',  status: 'available', currentOrderId: null });

      log.info('3 restaurants, 2 drivers online');
    });

    // --- Restaurant actor ----------------------------------------------------
    // Purely reactive. Receives 'order:placed' and walks the order through its
    // kitchen lifecycle with simulated delays.
    const restaurantActor = R.actor({
      on: {
        'order:placed': async function (payload, ctx) {
          var orderId = payload.orderId;
          ctx.log.info('restaurant: order received');
          // Accept after 3–5s
          ctx.clock.setTimeout(function () {
            ctx.db.update('orders', orderId, { status: 'accepted' });
            ctx.log.info('restaurant: order accepted');
            // Begin preparing 1s after accepting
            ctx.clock.setTimeout(function () {
              ctx.db.update('orders', orderId, { status: 'preparing' });
              ctx.log.info('restaurant: preparing order');
              // Mark ready after 10–18s of cooking
              ctx.clock.setTimeout(function () {
                ctx.db.update('orders', orderId, { status: 'ready' });
                ctx.log.info('restaurant: order ready for pickup');
              }, 10000 + ctx.random.int(0, 8000));
            }, 1000);
          }, 3000 + ctx.random.int(0, 2000));
        },
      },
    });

    // --- Driver actor --------------------------------------------------------
    // Ticks every 2s. Finds a free driver and a ready order, pairs them, then
    // delivers after a simulated drive time.
    const driverActor = R.actor({
      everyMs: 2000,
      tick: async function (ctx) {
        var freeDrivers = ctx.db.query('drivers', { where: { status: 'available' } });
        if (freeDrivers.length === 0) return;
        var readyOrders = ctx.db.query('orders', { where: { status: 'ready' } });
        if (readyOrders.length === 0) return;

        var driver = freeDrivers[0];
        var order  = readyOrders[0];

        ctx.db.update('drivers', driver.id, { status: 'delivering', currentOrderId: order.id });
        ctx.db.update('orders',  order.id,  { status: 'picked_up', driverId: driver.id, driverName: driver.name });
        ctx.log.info(driver.name + ' picked up order — en route');

        ctx.clock.setTimeout(function () {
          ctx.db.update('orders',  order.id,  { status: 'delivered', deliveredAt: ctx.clock.now() });
          ctx.db.update('drivers', driver.id, { status: 'available', currentOrderId: null });
          ctx.log.info(driver.name + ' delivered order');
        }, 12000 + ctx.random.int(0, 8000));
      },
    });

    // --- hooks ---------------------------------------------------------------
    function useRestaurants() {
      var [rows, setRows] = useState(function () { return db.query('restaurants'); });
      useEffect(function () {
        return db.subscribe('restaurants', function () { setRows(db.query('restaurants')); });
      }, []);
      return rows;
    }

    function useMenuItems(restaurantId) {
      var [rows, setRows] = useState([]);
      useEffect(function () {
        function read() {
          return restaurantId
            ? db.query('menu_items', { where: { restaurantId: restaurantId } })
            : [];
        }
        setRows(read());
        return db.subscribe('menu_items', function () { setRows(read()); });
      }, [restaurantId]);
      return rows;
    }

    function useOrders() {
      var [rows, setRows] = useState(function () {
        return db.query('orders', { order: { field: 'placedAt', dir: 'desc' } });
      });
      useEffect(function () {
        return db.subscribe('orders', function () {
          setRows(db.query('orders', { order: { field: 'placedAt', dir: 'desc' } }));
        });
      }, []);
      return rows;
    }

    function useClock() {
      var [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () {
        return clock.subscribe(function (now, running) { setS({ now: now, running: running }); });
      }, []);
      return s;
    }

    function useLog() {
      var [entries, setEntries] = useState(log.entries());
      useEffect(function () { return log.subscribe(setEntries); }, []);
      return entries;
    }

    // --- order status helpers ------------------------------------------------
    var STEPS = ['placed', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered'];
    var STEP_LABEL = {
      placed:    'Order placed',
      accepted:  'Restaurant accepted',
      preparing: 'Being prepared',
      ready:     'Ready for pickup',
      picked_up: 'Driver en route',
      delivered: 'Delivered',
    };

    // --- styles --------------------------------------------------------------
    var S = {
      page:     { maxWidth: 480, margin: '0 auto', padding: '0 0 40px',
                  fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111',
                  background: '#f9f9f9', minHeight: '100vh' },
      header:   { padding: '14px 20px', background: '#fff', borderBottom: '1px solid #ececec',
                  display: 'flex', alignItems: 'center', gap: 12 },
      title:    { fontSize: 20, fontWeight: 700, margin: 0, flex: 1 },
      card:     { background: '#fff', borderRadius: 12, border: '1px solid #ececec',
                  marginBottom: 10, overflow: 'hidden' },
      section:  { padding: '16px 20px' },
      btn:      { border: 'none', borderRadius: 8, padding: '10px 18px',
                  cursor: 'pointer', fontSize: 14, fontWeight: 600 },
      ctrlBtn:  { border: '1px solid #e5e5e5', background: '#fff', borderRadius: 8,
                  padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
      clockBar: { padding: '8px 20px', background: '#fff', borderBottom: '1px solid #f5f5f5',
                  display: 'flex', gap: 6, alignItems: 'center' },
      ghost:    { border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 13, color: '#6b7280', padding: '4px 0' },
    };
    function primaryBtn(extra) {
      return Object.assign({}, S.btn, { background: '#111', color: '#fff' }, extra || {});
    }

    // --- App -----------------------------------------------------------------
    function FoodDelivery() {
      var restaurants = useRestaurants();
      var orders      = useOrders();
      var cs          = useClock();
      var logEntries  = useLog();

      var [screen,           setScreen]           = useState('browse');
      var [activeRestaurant, setActiveRestaurant] = useState(null);
      var [cart,             setCart]             = useState([]);

      var menuItems = useMenuItems(activeRestaurant ? activeRestaurant.id : null);

      // The latest non-delivered order (if any), else the most recent delivered one.
      var activeOrder = orders.find(function (o) { return o.status !== 'delivered'; })
                     || (orders.length > 0 ? orders[0] : null);

      useEffect(function () {
        restaurantActor.start();
        driverActor.start();
        clock.play();
        return function () {
          restaurantActor.stop();
          driverActor.stop();
        };
      }, []);

      function placeOrder() {
        if (cart.length === 0 || !activeRestaurant) return;
        var total   = cart.reduce(function (sum, item) { return sum + item.price; }, 0);
        var orderId = 'ord-' + clock.now() + '-' + random.int(100, 999);
        db.create('orders', {
          id:             orderId,
          restaurantId:   activeRestaurant.id,
          restaurantName: activeRestaurant.name,
          items:          cart.map(function (item) {
                            return { id: item.id, name: item.name, price: item.price };
                          }),
          total:          Math.round(total * 100) / 100,
          status:         'placed',
          placedAt:       clock.now(),
          driverId:       null,
          driverName:     null,
        });
        events.publish('order:placed', { orderId: orderId });
        log.info('order placed — ' + cart.length + ' item(s), $' + total.toFixed(2));
        setCart([]);
        setScreen('tracking');
      }

      // Clock bar — shown on every screen
      var clockBar = h('div', { style: S.clockBar },
        h('span', { style: { fontSize: 11, color: '#9ca3af', flex: 1 } },
          'sim ' + (cs.now / 1000).toFixed(0) + 's  ' + (cs.running ? '●' : '⏸')),
        h('button', { style: S.ctrlBtn,
          onClick: function () { cs.running ? clock.pause() : clock.play(); } },
          cs.running ? 'Pause' : 'Play'),
        h('button', { style: S.ctrlBtn,
          onClick: function () { clock.step(5000); } }, '+5s'),
        h('button', { style: S.ctrlBtn,
          onClick: function () { clock.fastForward(30000); } }, '+30s'),
      );

      // ---- Browse screen ----------------------------------------------------
      if (screen === 'browse') {
        return h('div', { style: S.page },
          h('div', { style: S.header },
            h('h1', { style: S.title }, 'Restaurants'),
            activeOrder && activeOrder.status !== 'delivered' &&
              h('button', {
                style: Object.assign({}, S.btn, { background: '#f0fdf4', color: '#15803d', padding: '6px 12px', fontSize: 12 }),
                onClick: function () { setScreen('tracking'); },
              }, 'Track order'),
          ),
          clockBar,
          h('div', { style: S.section },
            restaurants.map(function (r) {
              return h('div', { key: r.id, style: S.card },
                h('div', { style: { padding: 16 } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 } },
                    h('span', { style: { fontWeight: 600, fontSize: 16 } }, r.name),
                    h('span', { style: { fontSize: 13, color: '#f59e0b', fontWeight: 600 } }, '★ ' + r.rating),
                  ),
                  h('div', { style: { fontSize: 13, color: '#9ca3af', marginBottom: 12 } },
                    r.cuisine + '  ·  ~' + r.deliveryMins + ' min'),
                  h('button', {
                    style: primaryBtn(),
                    onClick: function () {
                      setActiveRestaurant(r);
                      setCart([]);
                      setScreen('restaurant');
                    },
                  }, 'View menu'),
                ),
              );
            }),
          ),
        );
      }

      // ---- Menu screen ------------------------------------------------------
      if (screen === 'restaurant' && activeRestaurant) {
        var cartTotal = cart.reduce(function (s, item) { return s + item.price; }, 0);

        return h('div', { style: S.page },
          h('div', { style: S.header },
            h('button', { style: S.ghost, onClick: function () { setScreen('browse'); setCart([]); } }, '← Back'),
            h('h1', { style: Object.assign({}, S.title, { fontSize: 17 }) }, activeRestaurant.name),
          ),
          clockBar,
          h('div', { style: S.section },
            menuItems.map(function (item) {
              var qty = cart.filter(function (c) { return c.id === item.id; }).length;
              return h('div', { key: item.id, style: Object.assign({}, S.card, { marginBottom: 8 }) },
                h('div', { style: { padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  h('div', null,
                    h('div', { style: { fontWeight: 500, fontSize: 14 } }, item.name),
                    h('div', { style: { fontSize: 13, color: '#6b7280', marginTop: 2 } }, '$' + item.price.toFixed(2)),
                  ),
                  h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    qty > 0 && h('span', { style: { fontSize: 12, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px' } }, 'x' + qty),
                    h('button', {
                      style: primaryBtn({ padding: '6px 14px', fontSize: 13 }),
                      onClick: function () { setCart(function (prev) { return prev.concat([item]); }); },
                    }, 'Add'),
                  ),
                ),
              );
            }),
            cart.length > 0 && h('div', { style: { marginTop: 16 } },
              h('button', {
                style: primaryBtn({ width: '100%', padding: 14, fontSize: 15, display: 'flex', justifyContent: 'space-between' }),
                onClick: placeOrder,
              },
                h('span', null, 'Place order  ·  ' + cart.length + ' item' + (cart.length !== 1 ? 's' : '')),
                h('span', null, '$' + cartTotal.toFixed(2)),
              ),
            ),
          ),
        );
      }

      // ---- Tracking screen -------------------------------------------------
      var order = activeOrder;

      if (!order) {
        return h('div', { style: S.page },
          h('div', { style: S.header }, h('h1', { style: S.title }, 'Order')),
          clockBar,
          h('div', { style: Object.assign({}, S.section, { textAlign: 'center', color: '#9ca3af', paddingTop: 40 }) },
            h('p', null, 'No orders yet.'),
            h('button', { style: primaryBtn({ marginTop: 8 }), onClick: function () { setScreen('browse'); } },
              'Browse restaurants'),
          ),
        );
      }

      var stepIndex = STEPS.indexOf(order.status);

      return h('div', { style: S.page },
        h('div', { style: S.header },
          h('button', { style: S.ghost, onClick: function () { setScreen('browse'); } }, '← Browse'),
          h('h1', { style: Object.assign({}, S.title, { fontSize: 17 }) }, order.restaurantName),
        ),
        clockBar,
        h('div', { style: S.section },

          // Status headline
          h('div', { style: Object.assign({}, S.card, { padding: 16, marginBottom: 12 }) },
            h('div', { style: { fontSize: 18, fontWeight: 700, marginBottom: 4 } }, STEP_LABEL[order.status] || order.status),
            order.driverName && order.status === 'picked_up' &&
              h('div', { style: { fontSize: 13, color: '#6b7280' } }, order.driverName + ' is on the way'),
            order.status === 'delivered' &&
              h('div', { style: { fontSize: 13, color: '#15803d' } }, 'Enjoy your meal!'),
          ),

          // Progress steps
          h('div', { style: Object.assign({}, S.card, { padding: 16, marginBottom: 12 }) },
            STEPS.map(function (step, i) {
              var done   = i <= stepIndex;
              var active = i === stepIndex;
              return h('div', { key: step, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' } },
                h('div', { style: {
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: done ? '#111' : '#e5e7eb',
                  }},
                  done && h('div', { style: { width: 8, height: 8, borderRadius: '50%', background: '#fff' } }),
                ),
                h('span', { style: { fontSize: 14, color: done ? '#111' : '#9ca3af', fontWeight: active ? 600 : 400 } },
                  STEP_LABEL[step]),
              );
            }),
          ),

          // Order summary
          h('div', { style: Object.assign({}, S.card, { padding: 16, marginBottom: 12 }) },
            h('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 } }, 'Your order'),
            (order.items || []).map(function (item, i) {
              return h('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' } },
                h('span', null, item.name),
                h('span', { style: { color: '#6b7280' } }, '$' + item.price.toFixed(2)),
              );
            }),
            h('div', { style: { borderTop: '1px solid #f5f5f5', marginTop: 8, paddingTop: 8,
                display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 14 } },
              h('span', null, 'Total'),
              h('span', null, '$' + (order.total || 0).toFixed(2)),
            ),
          ),

          // Activity log
          h('div', null,
            h('div', { style: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 } }, 'Activity'),
            logEntries.length === 0
              ? h('span', { style: { fontSize: 12, color: '#9ca3af' } }, 'No activity yet.')
              : logEntries.slice().reverse().slice(0, 6).map(function (e, i) {
                  return h('div', { key: i, style: { fontSize: 12, color: '#6b7280', padding: '2px 0' } },
                    h('span', { style: { color: '#9ca3af', marginRight: 8 } }, (e.t / 1000).toFixed(0) + 's'),
                    e.msg,
                  );
                }),
          ),

          order.status === 'delivered' &&
            h('button', {
              style: primaryBtn({ width: '100%', padding: 14, marginTop: 16 }),
              onClick: function () { setScreen('browse'); },
            }, 'New order'),
        ),
      );
    }

    window.App = FoodDelivery;
  `,
};
