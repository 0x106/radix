// BATCH 3 EXAMPLE — event-sourced financial ledger (example-apps.md #42).
//
// Purpose: stress whether the data foundation supports a non-mutable pattern.
// The `events` collection is append-only — the app NEVER calls update or delete
// on it. Balances are never stored; they are always derived by replaying events.
// Snapshots checkpoint the balances at a sequence number so a replay reads only
// the events after the latest snapshot, not the full history.
//
// What it surfaced (recorded in runtime-contract.md):
//   - "Immutable by contract" needed schema support. Added a per-collection
//     `immutable: true` option to db.define — update/delete on that collection
//     throw (strict) or warn-and-refuse. Before this it was only convention.
//   - Snapshots/replay/derived aggregates stay app-side: the store answers
//     "events after seq N" (an ordinary filter+order query); the fold is code.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const ledger = {
  name: "Ledger (event-sourced)",
  description:
    "Batch 3 example: append-only event-sourced ledger — immutable events collection, balances derived by replay, snapshot checkpoints, activity simulator.",
  source: /* js */ `
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, log = R.log, clock = R.clock;

    const SNAPSHOT_EVERY = 20; // auto-checkpoint cadence (events since last snapshot)

    db.define({
      accounts: {
        fields: { name: { type: 'string', required: true }, seq: 'number' },
        seed: [
          { id: 'acc-chk', name: 'Checking',    seq: 0 },
          { id: 'acc-sav', name: 'Savings',     seq: 1 },
          { id: 'acc-cc',  name: 'Credit card', seq: 2 },
        ],
      },
      events: {
        immutable: true,
        fields: {
          seq: { type: 'number', required: true },
          at: 'number',
          kind: { type: 'enum', values: ['deposit', 'withdrawal', 'transfer'] },
          from: 'string',   // account id (withdrawal, transfer)
          to: 'string',     // account id (deposit, transfer)
          amount: { type: 'number', required: true }, // cents
          memo: 'string',
        },
        seed: [
          { seq: 1, at: 0, kind: 'deposit',    to: 'acc-chk',                  amount: 250000, memo: 'Opening balance' },
          { seq: 2, at: 0, kind: 'deposit',    to: 'acc-sav',                  amount: 800000, memo: 'Opening balance' },
          { seq: 3, at: 0, kind: 'transfer',   from: 'acc-chk', to: 'acc-sav', amount:  50000, memo: 'Monthly saving' },
          { seq: 4, at: 0, kind: 'withdrawal', from: 'acc-chk',                amount:   4200, memo: 'Groceries' },
          { seq: 5, at: 0, kind: 'withdrawal', from: 'acc-cc',                 amount:  12999, memo: 'Headphones' },
        ],
      },
      snapshots: {
        fields: { upToSeq: { type: 'number', required: true }, at: 'number', balances: 'json' },
      },
    }, { strict: true });
    log.info('ledger seeded');

    // --- event-sourcing core (app-side; the db is just the append-only store) --

    function apply(balances, e) {
      const b = Object.assign({}, balances);
      if (e.kind === 'deposit')    { b[e.to]   = (b[e.to]   || 0) + e.amount; }
      if (e.kind === 'withdrawal') { b[e.from] = (b[e.from] || 0) - e.amount; }
      if (e.kind === 'transfer')   { b[e.from] = (b[e.from] || 0) - e.amount;
                                     b[e.to]   = (b[e.to]   || 0) + e.amount; }
      return b;
    }

    function latestSnapshot() {
      const snaps = db.query('snapshots', { order: { field: 'upToSeq', dir: 'desc' }, limit: 1 });
      return snaps[0] || null;
    }

    // Balances = latest snapshot + replay of everything after it. Returns how
    // many events the replay actually read, to make the checkpoint win visible.
    function deriveBalances() {
      const snap = latestSnapshot();
      let balances = snap ? Object.assign({}, snap.balances) : {};
      const all = db.query('events', { order: { field: 'seq', dir: 'asc' } });
      const after = snap ? all.filter(function (e) { return e.seq > snap.upToSeq; }) : all;
      after.forEach(function (e) { balances = apply(balances, e); });
      return { balances: balances, replayed: after.length, total: all.length, snap: snap };
    }

    function maxSeq() {
      const last = db.query('events', { order: { field: 'seq', dir: 'desc' }, limit: 1 });
      return last.length ? last[0].seq : 0;
    }

    // The ONLY write path: append. Auto-checkpoints when enough events have
    // accumulated since the last snapshot.
    function append(ev) {
      const e = db.create('events', Object.assign({ seq: maxSeq() + 1, at: clock.now() }, ev));
      const snap = latestSnapshot();
      const since = e.seq - (snap ? snap.upToSeq : 0);
      if (since >= SNAPSHOT_EVERY) { snapshotNow(); }
      return e;
    }

    function snapshotNow() {
      // Snapshot from a FULL replay, not from the current derived view — the
      // checkpoint must be correct even if a previous snapshot were bad.
      const all = db.query('events', { order: { field: 'seq', dir: 'asc' } });
      let balances = {};
      all.forEach(function (e) { balances = apply(balances, e); });
      const upTo = all.length ? all[all.length - 1].seq : 0;
      const s = db.create('snapshots', { upToSeq: upTo, at: clock.now(), balances: balances });
      log.info('snapshot at seq ' + upTo);
      return s;
    }

    // Audit: full replay from zero must equal snapshot + delta.
    function verify() {
      const derived = deriveBalances().balances;
      const all = db.query('events', { order: { field: 'seq', dir: 'asc' } });
      let full = {};
      all.forEach(function (e) { full = apply(full, e); });
      const ids = Object.keys(Object.assign({}, full, derived));
      const ok = ids.every(function (id) { return (full[id] || 0) === (derived[id] || 0); });
      log[ok ? 'info' : 'error']('verify: snapshot+delta ' + (ok ? 'matches' : 'DIVERGES from') + ' full replay of ' + all.length + ' events');
      return ok;
    }

    // --- activity simulator -----------------------------------------------------
    const SPEND = [
      ['Coffee', 450], ['Groceries', 6200], ['Transport', 280], ['Lunch', 1400],
      ['Streaming', 1499], ['Pharmacy', 2300], ['Book', 1899],
    ];
    const activity = R.actor({
      everyMs: 3000,
      jitterMs: 1200,
      tick: function (ctx) {
        const roll = ctx.random.random();
        if (roll < 0.15) {
          append({ kind: 'deposit', to: 'acc-chk', amount: 320000, memo: 'Salary' });
        } else if (roll < 0.3) {
          append({ kind: 'transfer', from: 'acc-chk', to: 'acc-sav', amount: ctx.random.int(5, 40) * 1000, memo: 'Sweep to savings' });
        } else {
          const item = ctx.random.pick(SPEND);
          append({ kind: 'withdrawal', from: ctx.random.random() < 0.4 ? 'acc-cc' : 'acc-chk', amount: item[1], memo: item[0] });
        }
      },
    });

    // --- UI ---------------------------------------------------------------------
    const money = function (c) { return (c < 0 ? '-$' : '$') + Math.abs(c / 100).toFixed(2); };
    const KIND_BADGE = {
      deposit:    { label: 'IN',  bg: '#dcfce7', fg: '#166534' },
      withdrawal: { label: 'OUT', bg: '#fee2e2', fg: '#991b1b' },
      transfer:   { label: 'TRF', bg: '#dbeafe', fg: '#1e40af' },
    };

    function useCollection(name, order) {
      const read = function () { return db.query(name, order ? { order: order } : undefined); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe(name, function () { setRows(read()); }); }, [name]);
      return rows;
    }

    function Ledger() {
      const accounts = useCollection('accounts', { field: 'seq', dir: 'asc' });
      const events = useCollection('events', { field: 'seq', dir: 'desc' });
      const snapshots = useCollection('snapshots');
      const [running, setRunning] = useState(false);
      const [verdict, setVerdict] = useState(null);   // null | 'ok' | 'bad'
      const [blocked, setBlocked] = useState(null);   // message from the tamper demo
      const [form, setForm] = useState({ kind: 'withdrawal', from: 'acc-chk', to: 'acc-sav', amount: '', memo: '' });

      // Derived view — recomputed whenever events or snapshots change. This is
      // the whole point: there is no stored balance anywhere.
      const view = useMemo(deriveBalances, [events, snapshots]);
      const accName = function (id) { const a = db.get('accounts', id); return a ? a.name : id; };

      const submit = function () {
        const cents = Math.round(parseFloat(form.amount) * 100);
        if (!cents || cents <= 0) return;
        const ev = { kind: form.kind, amount: cents, memo: form.memo || '(no memo)' };
        if (form.kind !== 'deposit') ev.from = form.from;
        if (form.kind !== 'withdrawal') ev.to = form.kind === 'deposit' ? form.from : form.to;
        append(ev);
        setForm(Object.assign({}, form, { amount: '', memo: '' }));
      };

      // Tamper demo: prove the contract holds. update() on the immutable
      // collection throws (strict mode); the ledger is unchanged.
      const tryTamper = function () {
        const latest = events[0];
        if (!latest) return;
        try {
          db.update('events', latest.id, { amount: 1 });
          setBlocked('NOT blocked — immutability failed!');
        } catch (err) {
          setBlocked(err.message);
        }
      };

      const toggle = function () {
        if (running) { activity.stop(); } else { activity.start(); }
        setRunning(!running);
      };

      const page = { maxWidth: 1020, margin: '0 auto', padding: '16px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const card = { border: '1px solid #ececec', borderRadius: 12, background: '#fff', padding: 14 };
      const label = { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 };
      const btn = function (active) { return { padding: '7px 12px', borderRadius: 8,
        border: '1px solid ' + (active ? '#111' : '#e5e5e5'),
        background: active ? '#111' : '#fff', color: active ? '#fff' : '#374151',
        cursor: 'pointer', fontSize: 13 }; };
      const input = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, width: '100%', boxSizing: 'border-box' };

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0, marginRight: 'auto' } }, 'Ledger'),
          h('span', { style: { fontSize: 12.5, color: '#6b7280' } },
            view.total + ' events · balances from ' + (view.snap ? 'snapshot@' + view.snap.upToSeq + ' + ' : '') + view.replayed + ' replayed'),
          h('button', { style: btn(running), onClick: toggle }, running ? 'Pause activity' : 'Simulate activity'),
          h('button', { style: btn(false), onClick: function () { db.reset(); setVerdict(null); setBlocked(null); log.info('reset'); } }, 'Reset'),
        ),

        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 } },
          accounts.map(function (a) {
            const bal = view.balances[a.id] || 0;
            return h('div', { key: a.id, style: card },
              h('div', { style: label }, a.name),
              h('div', { style: { fontSize: 22, fontWeight: 700, color: bal < 0 ? '#b91c1c' : '#111' } }, money(bal)),
            );
          }),
        ),

        h('div', { style: { display: 'flex', gap: 14, alignItems: 'flex-start' } },
          h('div', { style: Object.assign({}, card, { flex: 1, padding: 0, overflow: 'hidden' }) },
            h('div', { style: Object.assign({}, label, { padding: '12px 14px 0' }) }, 'event log (append-only, newest first)'),
            events.length === 0
              ? h('div', { style: { color: '#9ca3af', fontSize: 13, padding: 14 } }, 'No events.')
              : events.slice(0, 30).map(function (e) {
                  const badge = KIND_BADGE[e.kind];
                  return h('div', { key: e.id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: '1px solid #f5f5f5', fontSize: 13 } },
                    h('span', { style: { color: '#9ca3af', width: 34, fontVariantNumeric: 'tabular-nums' } }, '#' + e.seq),
                    h('span', { style: { background: badge.bg, color: badge.fg, fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: '2px 6px', width: 26, textAlign: 'center' } }, badge.label),
                    h('span', { style: { flex: 1 } }, e.memo,
                      h('span', { style: { color: '#9ca3af' } },
                        '  ' + (e.kind === 'deposit' ? '→ ' + accName(e.to)
                              : e.kind === 'withdrawal' ? accName(e.from) + ' →'
                              : accName(e.from) + ' → ' + accName(e.to)))),
                    h('span', { style: { fontVariantNumeric: 'tabular-nums', color: e.kind === 'deposit' ? '#166534' : '#111' } }, money(e.amount)),
                  );
                }),
          ),

          h('div', { style: { width: 300, display: 'flex', flexDirection: 'column', gap: 12 } },
            h('div', { style: card },
              h('div', { style: label }, 'append event'),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('select', { style: input, value: form.kind, onChange: function (e) { setForm(Object.assign({}, form, { kind: e.target.value })); } },
                  h('option', { value: 'withdrawal' }, 'Withdrawal'),
                  h('option', { value: 'deposit' }, 'Deposit'),
                  h('option', { value: 'transfer' }, 'Transfer')),
                h('select', { style: input, value: form.from, onChange: function (e) { setForm(Object.assign({}, form, { from: e.target.value })); } },
                  accounts.map(function (a) { return h('option', { key: a.id, value: a.id }, (form.kind === 'deposit' ? 'Into: ' : 'From: ') + a.name); })),
                form.kind === 'transfer' && h('select', { style: input, value: form.to, onChange: function (e) { setForm(Object.assign({}, form, { to: e.target.value })); } },
                  accounts.map(function (a) { return h('option', { key: a.id, value: a.id }, 'To: ' + a.name); })),
                h('input', { style: input, placeholder: 'Amount (e.g. 12.50)', value: form.amount,
                  onChange: function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); } }),
                h('input', { style: input, placeholder: 'Memo', value: form.memo,
                  onChange: function (e) { setForm(Object.assign({}, form, { memo: e.target.value })); } }),
                h('button', { style: btn(true), onClick: submit }, 'Append'),
              ),
            ),
            h('div', { style: card },
              h('div', { style: label }, 'checkpoints'),
              h('div', { style: { fontSize: 13, color: '#374151', marginBottom: 10 } },
                snapshots.length + ' snapshot(s)' + (view.snap ? ' · latest at seq ' + view.snap.upToSeq : '') +
                ' · auto every ' + SNAPSHOT_EVERY + ' events'),
              h('div', { style: { display: 'flex', gap: 8 } },
                h('button', { style: btn(false), onClick: function () { snapshotNow(); } }, 'Snapshot now'),
                h('button', { style: btn(false), onClick: function () { setVerdict(verify() ? 'ok' : 'bad'); } }, 'Verify replay'),
              ),
              verdict && h('div', { style: { marginTop: 10, fontSize: 13, color: verdict === 'ok' ? '#166534' : '#b91c1c' } },
                verdict === 'ok' ? '✓ snapshot + delta matches full replay' : '✗ divergence — checkpoint bug!'),
            ),
            h('div', { style: card },
              h('div', { style: label }, 'immutability'),
              h('div', { style: { fontSize: 12.5, color: '#6b7280', marginBottom: 10 } },
                'The events collection is declared immutable. Editing history must fail.'),
              h('button', { style: btn(false), onClick: tryTamper }, 'Try to edit latest event'),
              blocked && h('div', { style: { marginTop: 10, fontSize: 12.5, color: '#b91c1c' } }, '✗ ' + blocked),
            ),
          ),
        ),
      );
    }

    window.App = Ledger;
  `,
};
