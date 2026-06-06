// PHASE 0 SPIKE — read-heavy analytics: a personal finance dashboard.
//
// Purpose: stress the *query/aggregation* side of the fake `db` (example-apps.md
// #3). Almost no writes — the point is a rich seeded dataset and lots of derived,
// aggregated values on top of it: balance, income vs spend, spend-by-category,
// per-month totals. The store has NO aggregation (no count/sum/group-by) and NO
// range filters, so every rollup here is a client-side reduce over rows pulled
// back with the equality-`where` + single-`order` the contract does offer. It is
// the clearest demonstration of where the query surface stops.
//
// Seed uses radix.random (seeded) so the dataset replays identically each reload.
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const finance = {
  name: "Finance dashboard (analytics spike)",
  description:
    "Phase 0 spike: read-heavy analytics over a seeded transactions set — balances and roll-ups computed on the client.",
  source: /* js */ `
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, random = R.random, log = R.log;

    const CATS = ['Groceries', 'Rent', 'Transport', 'Dining', 'Utilities', 'Shopping', 'Salary'];
    const MERCHANTS = {
      Groceries: ['Whole Foods', 'Trader Joes', 'Safeway'],
      Rent: ['Landlord'],
      Transport: ['Uber', 'Shell', 'BART'],
      Dining: ['Blue Bottle', 'Chipotle', 'Tartine'],
      Utilities: ['PG&E', 'Comcast', 'AT&T'],
      Shopping: ['Amazon', 'Apple', 'Uniqlo'],
      Salary: ['Acme Corp'],
    };
    const MONTHS = ['2026-03', '2026-04', '2026-05'];

    // Build a believable ledger deterministically. Amounts are integer cents;
    // income is positive, spend negative.
    db.__seed(function (api) {
      let seq = 0;
      MONTHS.forEach(function (month) {
        // one salary credit + rent debit per month
        api.create('transactions', { month: month, date: month + '-01', category: 'Salary',
          merchant: 'Acme Corp', amount: 540000, seq: seq++ });
        api.create('transactions', { month: month, date: month + '-03', category: 'Rent',
          merchant: 'Landlord', amount: -220000, seq: seq++ });
        // ~10 random spend transactions
        for (let i = 0; i < 10; i++) {
          const cat = random.pick(['Groceries', 'Transport', 'Dining', 'Utilities', 'Shopping']);
          const day = random.int(2, 27);
          const amt = -random.int(800, 14000);
          api.create('transactions', {
            month: month,
            date: month + '-' + (day < 10 ? '0' + day : '' + day),
            category: cat,
            merchant: random.pick(MERCHANTS[cat]),
            amount: amt,
            seq: seq++,
          });
        }
      });
      log.info('seeded ledger', { months: MONTHS.length });
    });

    const money = function (cents) {
      const neg = cents < 0;
      const v = (Math.abs(cents) / 100).toFixed(2);
      return (neg ? '-$' : '$') + v;
    };

    function useTransactions() {
      const read = function () { return db.query('transactions', { order: { field: 'date', dir: 'desc' } }); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe('transactions', function () { setRows(read()); }); }, []);
      return rows;
    }

    function Finance() {
      const [month, setMonth] = useState('all');
      const [draft, setDraft] = useState({ category: 'Dining', amount: '', merchant: '' });
      const txAll = useTransactions();

      // Month filter: when a specific month is picked, db.query CAN do it (equality
      // on the 'month' field). 'All' just reads everything. A real 'last 90 days'
      // range query is NOT expressible in the contract — it'd be a client filter.
      const tx = useMemo(function () {
        const args = { order: { field: 'date', dir: 'desc' } };
        if (month !== 'all') args.where = { month: month };
        return db.query('transactions', args);
      }, [txAll, month]);

      // Everything below is the aggregation the store can't do: fold the rows.
      const totals = useMemo(function () {
        let income = 0, spend = 0;
        const byCat = {};
        tx.forEach(function (t) {
          if (t.amount >= 0) income += t.amount; else spend += -t.amount;
          if (t.amount < 0) byCat[t.category] = (byCat[t.category] || 0) + -t.amount;
        });
        const cats = Object.keys(byCat).map(function (k) { return { cat: k, total: byCat[k] }; })
          .sort(function (a, b) { return b.total - a.total; });
        return { income: income, spend: spend, net: income - spend, cats: cats };
      }, [tx]);

      const maxCat = totals.cats.reduce(function (m, c) { return Math.max(m, c.total); }, 1);

      const addExpense = function () {
        const cents = Math.round(parseFloat(draft.amount) * 100);
        if (!cents || cents <= 0) return;
        const m = month === 'all' ? MONTHS[MONTHS.length - 1] : month;
        db.create('transactions', {
          month: m, date: m + '-15', category: draft.category,
          merchant: draft.merchant.trim() || draft.category, amount: -cents, seq: Date.now(),
        });
        setDraft({ category: draft.category, amount: '', merchant: '' });
      };

      const page = { maxWidth: 760, margin: '32px auto', padding: '0 20px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const card = { border: '1px solid #ececec', borderRadius: 12, padding: 16, background: '#fff' };
      const stat = Object.assign({}, card, { flex: 1 });
      const label = { fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 };
      const big = { fontSize: 24, fontWeight: 700, marginTop: 4 };
      const sel = { padding: '7px 9px', borderRadius: 8, border: '1px solid #d4d4d4', fontSize: 13, background: '#fff' };
      const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d4d4d4', fontSize: 13 };
      const btn = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 13 };

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 } },
          h('h1', { style: { fontSize: 24, fontWeight: 700, margin: 0 } }, 'Finances'),
          h('select', { style: sel, value: month, onChange: function (e) { setMonth(e.target.value); } },
            h('option', { value: 'all' }, 'All months'),
            MONTHS.map(function (m) { return h('option', { key: m, value: m }, m); })),
        ),

        h('div', { style: { display: 'flex', gap: 12, marginBottom: 18 } },
          h('div', { style: stat }, h('div', { style: label }, 'Income'),
            h('div', { style: Object.assign({}, big, { color: '#15803d' }) }, money(totals.income))),
          h('div', { style: stat }, h('div', { style: label }, 'Spend'),
            h('div', { style: Object.assign({}, big, { color: '#b91c1c' }) }, money(totals.spend))),
          h('div', { style: stat }, h('div', { style: label }, 'Net'),
            h('div', { style: Object.assign({}, big, { color: totals.net >= 0 ? '#111' : '#b91c1c' }) }, money(totals.net))),
        ),

        h('div', { style: Object.assign({}, card, { marginBottom: 18 }) },
          h('div', { style: Object.assign({}, label, { marginBottom: 12 }) }, 'Spend by category'),
          totals.cats.length === 0
            ? h('div', { style: { color: '#9ca3af', fontSize: 13 } }, 'No spend in range.')
            : totals.cats.map(function (c) {
              return h('div', { key: c.cat, style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
                h('div', { style: { width: 90, fontSize: 13 } }, c.cat),
                h('div', { style: { flex: 1, background: '#f3f4f6', borderRadius: 6, height: 14, overflow: 'hidden' } },
                  h('div', { style: { width: (c.total / maxCat * 100) + '%', background: '#111', height: '100%' } })),
                h('div', { style: { width: 80, textAlign: 'right', fontSize: 13, color: '#6b7280' } }, money(-c.total)),
              );
            }),
        ),

        h('div', { style: { display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' } },
          h('select', { style: sel, value: draft.category, onChange: function (e) { setDraft(Object.assign({}, draft, { category: e.target.value })); } },
            CATS.filter(function (c) { return c !== 'Salary'; }).map(function (c) { return h('option', { key: c, value: c }, c); })),
          h('input', { style: Object.assign({}, inp, { width: 130 }), placeholder: 'Merchant', value: draft.merchant,
            onChange: function (e) { setDraft(Object.assign({}, draft, { merchant: e.target.value })); } }),
          h('input', { style: Object.assign({}, inp, { width: 90 }), placeholder: 'Amount', value: draft.amount,
            onChange: function (e) { setDraft(Object.assign({}, draft, { amount: e.target.value })); },
            onKeyDown: function (e) { if (e.key === 'Enter') addExpense(); } }),
          h('button', { style: btn, onClick: addExpense }, 'Add expense'),
        ),

        h('div', { style: { fontSize: 11, color: '#9ca3af', margin: '4px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 } },
          'recent · ' + tx.length + ' transactions'),
        h('div', { style: card },
          tx.slice(0, 10).map(function (t, i) {
            return h('div', { key: t.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: i < 9 ? '1px solid #f5f5f5' : 'none' } },
              h('div', null,
                h('div', { style: { fontSize: 13.5, fontWeight: 500 } }, t.merchant),
                h('div', { style: { fontSize: 12, color: '#9ca3af' } }, t.date + ' · ' + t.category)),
              h('div', { style: { fontSize: 14, fontWeight: 500, color: t.amount >= 0 ? '#15803d' : '#111' } }, money(t.amount)),
            );
          }),
        ),
      );
    }

    window.App = Finance;
  `,
};
