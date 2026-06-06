// PHASE 0 EXAMPLE — relational CRUD: an e-commerce storefront + admin.
//
// Purpose: exercise the *relational* side of the fake `db` (example-apps.md #6).
// Three collections that reference each other by id — products, orders, and
// orderItems (the join row carrying orderId + productId + qty). The store has NO
// cascade or transactions: placing an order writes an order row, N orderItems,
// and decrements N product stocks as separate, non-atomic calls.
// The admin view uses db.query's `include` option to resolve the product inline
// rather than calling db.get in a loop.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const shop = {
  name: "Shop (relational example)",
  description:
    "Phase 0 example: storefront + admin over products/orders/orderItems — manual joins and multi-collection writes on the fake db.",
  source: /* js */ `
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, log = R.log;

    db.__seed(function (api) {
      [
        ['Mechanical keyboard', 12900, 8],
        ['USB-C hub', 4500, 14],
        ['Laptop stand', 3200, 0],
        ['Webcam 1080p', 6800, 5],
        ['Noise-cancelling headphones', 19900, 3],
        ['Desk mat', 2400, 20],
      ].forEach(function (p, i) {
        api.create('products', { name: p[0], price: p[1], stock: p[2], seq: i });
      });
      log.info('seeded catalogue');
    });

    const money = function (c) { return '$' + (c / 100).toFixed(2); };

    function useCollection(name, order) {
      const read = function () { return db.query(name, order ? { order: order } : undefined); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe(name, function () { setRows(read()); }); }, [name]);
      return rows;
    }

    // --- Storefront -----------------------------------------------------------
    function Storefront() {
      const products = useCollection('products', { field: 'seq', dir: 'asc' });
      const [cart, setCart] = useState({}); // productId -> qty (local UI state)

      const add = function (p) {
        if (p.stock <= 0) return;
        setCart(function (c) { const n = Object.assign({}, c); n[p.id] = Math.min((n[p.id] || 0) + 1, p.stock); return n; });
      };
      const cartLines = Object.keys(cart).filter(function (id) { return cart[id] > 0; })
        .map(function (id) { const p = db.get('products', id); return { p: p, qty: cart[id] }; })
        .filter(function (l) { return l.p; });
      const cartTotal = cartLines.reduce(function (s, l) { return s + l.p.price * l.qty; }, 0);

      // Place order: a *transaction* in spirit, but the store has no atomic
      // multi-write — this is three separate, individually-notified mutations
      // (order, then items, then stock decrements). If one failed mid-way the
      // others would still have landed. Flagged in the summary doc.
      const placeOrder = function () {
        if (cartLines.length === 0) return;
        const order = db.create('orders', { status: 'paid', total: cartTotal, createdAt: Date.now() });
        cartLines.forEach(function (l) {
          db.create('orderItems', { orderId: order.id, productId: l.p.id, qty: l.qty, priceAt: l.p.price });
          db.update('products', l.p.id, { stock: Math.max(0, l.p.stock - l.qty) });
        });
        log.info('order placed', { order: order.id, items: cartLines.length, total: cartTotal });
        setCart({});
      };

      const page = { maxWidth: 820, margin: '0 auto', padding: '8px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
      const card = { border: '1px solid #ececec', borderRadius: 12, padding: 16, background: '#fff' };
      const btn = function (disabled) { return { padding: '8px 12px', borderRadius: 8, border: 'none',
        background: disabled ? '#e5e7eb' : '#111', color: disabled ? '#9ca3af' : '#fff',
        cursor: disabled ? 'default' : 'pointer', fontSize: 13 }; };

      return h('div', { style: page },
        h('div', { style: grid },
          products.map(function (p) {
            return h('div', { key: p.id, style: card },
              h('div', { style: { fontSize: 15, fontWeight: 600 } }, p.name),
              h('div', { style: { fontSize: 13, color: '#6b7280', margin: '4px 0 12px' } },
                money(p.price) + ' · ' + (p.stock > 0 ? p.stock + ' in stock' : 'out of stock')),
              h('button', { style: btn(p.stock <= 0), disabled: p.stock <= 0, onClick: function () { add(p); } },
                p.stock <= 0 ? 'Sold out' : 'Add to cart' + (cart[p.id] ? ' (' + cart[p.id] + ')' : '')),
            );
          }),
        ),
        h('div', { style: Object.assign({}, card, { marginTop: 16 }) },
          h('div', { style: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 } }, 'cart'),
          cartLines.length === 0
            ? h('div', { style: { color: '#9ca3af', fontSize: 13 } }, 'Cart is empty.')
            : h('div', null,
                cartLines.map(function (l) {
                  return h('div', { key: l.p.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0' } },
                    h('span', null, l.p.name + ' × ' + l.qty),
                    h('span', null, money(l.p.price * l.qty)));
                }),
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 } },
                  h('strong', null, 'Total ' + money(cartTotal)),
                  h('button', { style: btn(false), onClick: placeOrder }, 'Place order')),
              ),
        ),
      );
    }

    // --- Admin: orders, each reassembled via a manual join --------------------
    function Admin() {
      const orders = useCollection('orders', { field: 'createdAt', dir: 'desc' });
      const items = useCollection('orderItems');
      const [open, setOpen] = useState(null);

      const linesFor = function (orderId) {
        return db.query('orderItems', {
          where: { orderId: orderId },
          include: { product: { from: 'products', on: 'productId' } },
        }).map(function (it) {
          return { it: it, name: it.product ? it.product.name : '(deleted product)' };
        });
      };

      const card = { border: '1px solid #ececec', borderRadius: 12, background: '#fff', marginBottom: 10, overflow: 'hidden' };
      const page = { maxWidth: 820, margin: '0 auto', padding: '8px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };

      return h('div', { style: page },
        h('p', { style: { color: '#6b7280', fontSize: 13, margin: '4px 0 14px' } },
          orders.length + ' orders · ' + items.length + ' line items'),
        orders.length === 0
          ? h('div', { style: { color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '40px 0' } }, 'No orders yet — place one from the storefront.')
          : orders.map(function (o) {
            const isOpen = open === o.id;
            return h('div', { key: o.id, style: card },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer' },
                onClick: function () { setOpen(isOpen ? null : o.id); } },
                h('span', { style: { fontSize: 13.5, fontWeight: 500 } }, 'Order ' + o.id + ' · ' + money(o.total)),
                h('span', { style: { fontSize: 12, color: '#6b7280' } }, (isOpen ? '▲ ' : '▼ ') + o.status)),
              isOpen && h('div', { style: { padding: '0 14px 12px', borderTop: '1px solid #f5f5f5' } },
                linesFor(o.id).map(function (l) {
                  return h('div', { key: l.it.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', color: '#374151' } },
                    h('span', null, l.name + ' × ' + l.it.qty),
                    h('span', null, money(l.it.priceAt * l.it.qty)));
                }),
              ),
            );
          }),
      );
    }

    function Shop() {
      const [tab, setTab] = useState('store');
      const wrap = { fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const bar = { display: 'flex', alignItems: 'center', gap: 6, maxWidth: 820, margin: '24px auto 8px', padding: '0 20px' };
      const tabBtn = function (active) { return { padding: '7px 14px', borderRadius: 8, border: '1px solid ' + (active ? '#111' : '#e5e5e5'),
        background: active ? '#111' : '#fff', color: active ? '#fff' : '#374151', cursor: 'pointer', fontSize: 13 }; };

      return h('div', { style: wrap },
        h('div', { style: bar },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0, marginRight: 'auto' } }, 'Shop'),
          h('button', { style: tabBtn(tab === 'store'), onClick: function () { setTab('store'); } }, 'Storefront'),
          h('button', { style: tabBtn(tab === 'admin'), onClick: function () { setTab('admin'); } }, 'Admin'),
          h('button', { style: { padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e5e5', background: '#fafafa', color: '#6b7280', cursor: 'pointer', fontSize: 12 },
            onClick: function () { db.reset(); log.info('reset'); } }, 'Reset'),
        ),
        tab === 'store' ? h(Storefront) : h(Admin),
      );
    }

    window.App = Shop;
  `,
};
