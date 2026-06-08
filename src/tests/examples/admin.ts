// PHASE 0 EXAMPLE — CRUD prototype: an internal admin dashboard.
//
// Purpose: stress the *query + write* breadth of the fake `db` (example-apps.md
// #14). This is the unglamorous 60% of real software: a table over a collection
// with filters, sorting, inline edits, bulk actions, and an audit trail in a
// second collection. It deliberately exercises the edges of the query contract —
// equality-only `where`, single-field `order` — and shows what has to move to the
// client when the store can't express it (text search, multi-field sort, the
// status counts). Every mutation also appends to an `audit` collection, so it
// pokes at cross-collection, non-atomic writes.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const admin = {
  name: "Admin dashboard (CRUD example)",
  description:
    "Phase 0 example: an internal users table wired to the fake db — filter, sort, inline-edit, bulk actions, audit log.",
  source: /* js */ `
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, log = R.log;

    const ROLES = ['admin', 'member', 'viewer'];
    const STATUSES = ['active', 'invited', 'suspended'];

    db.define({
      users: {
        fields: {
          name: 'string',
          email: 'string',
          role: { type: 'enum', values: ['admin', 'member', 'viewer'] },
          status: { type: 'enum', values: ['active', 'invited', 'suspended'] },
          seq: 'number',
        },
        seed: [
          { name: 'Ada Lovelace',      email: 'ada@radix.dev',       role: 'admin',  status: 'active',    seq: 0 },
          { name: 'Alan Turing',       email: 'alan@radix.dev',      role: 'admin',  status: 'active',    seq: 1 },
          { name: 'Grace Hopper',      email: 'grace@radix.dev',     role: 'member', status: 'active',    seq: 2 },
          { name: 'Katherine Johnson', email: 'katherine@radix.dev', role: 'member', status: 'invited',   seq: 3 },
          { name: 'Edsger Dijkstra',   email: 'edsger@radix.dev',    role: 'member', status: 'suspended', seq: 4 },
          { name: 'Barbara Liskov',    email: 'barbara@radix.dev',   role: 'viewer', status: 'active',    seq: 5 },
          { name: 'Donald Knuth',      email: 'don@radix.dev',       role: 'viewer', status: 'invited',   seq: 6 },
          { name: 'Margaret Hamilton', email: 'margaret@radix.dev',  role: 'member', status: 'active',    seq: 7 },
        ],
      },
      audit: {
        fields: {
          at: 'number',
          action: 'string',
          detail: 'string',
        },
      },
    });
    log.info('seeded 8 users');

    function audit(action, detail) {
      db.create('audit', { at: Date.now(), action: action, detail: detail });
    }

    function useCollection(name, order) {
      const read = function () { return db.query(name, order ? { order: order } : undefined); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe(name, function () { setRows(read()); }); }, [name]);
      return rows;
    }

    function Dashboard() {
      // db can do equality 'where' + one 'order'. Everything else (free-text
      // search, multi-key sort, status counts) is computed here on the client.
      const all = useCollection('users', { field: 'seq', dir: 'asc' });
      const auditRows = useCollection('audit', { field: 'at', dir: 'desc' });

      const [roleF, setRoleF] = useState('all');
      const [statusF, setStatusF] = useState('all');
      const [search, setSearch] = useState('');
      const [sortKey, setSortKey] = useState('name');
      const [selected, setSelected] = useState({});

      // The part the store CAN do: build an equality 'where' from the dropdowns
      // and let db.query filter. (Done in a memo so it re-runs when filters move.)
      const filteredByDb = useMemo(function () {
        const where = {};
        if (roleF !== 'all') where.role = roleF;
        if (statusF !== 'all') where.status = statusF;
        return db.query('users', { where: where, order: { field: sortKey, dir: 'asc' } });
      }, [all, roleF, statusF, sortKey]);

      // The part it CAN'T: substring search over name/email.
      const rows = filteredByDb.filter(function (u) {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return u.name.toLowerCase().indexOf(q) >= 0 || u.email.toLowerCase().indexOf(q) >= 0;
      });

      // No aggregation in the store either — count statuses by hand.
      const counts = all.reduce(function (acc, u) { acc[u.status] = (acc[u.status] || 0) + 1; return acc; }, {});
      const selIds = Object.keys(selected).filter(function (k) { return selected[k]; });

      const setStatus = function (u, status) {
        db.update('users', u.id, { status: status });
        audit('status', u.name + ' → ' + status);
      };
      const remove = function (u) {
        db.delete('users', u.id);
        audit('delete', u.name);
      };
      const cycleRole = function (u) {
        const next = ROLES[(ROLES.indexOf(u.role) + 1) % ROLES.length];
        db.update('users', u.id, { role: next });
        audit('role', u.name + ' → ' + next);
      };
      const toggleSel = function (id) {
        setSelected(function (s) { const n = Object.assign({}, s); n[id] = !n[id]; return n; });
      };
      // Bulk action: a loop of single writes. NOT atomic — each fires its own
      // subscriber notification. Fine at this scale; flagged in the summary doc.
      const bulkSuspend = function () {
        selIds.forEach(function (id) { const u = db.get('users', id); if (u) db.update('users', id, { status: 'suspended' }); });
        audit('bulk-suspend', selIds.length + ' users');
        setSelected({});
      };
      const bulkDelete = function () {
        selIds.forEach(function (id) { const u = db.get('users', id); if (u) { db.delete('users', id); } });
        audit('bulk-delete', selIds.length + ' users');
        setSelected({});
      };

      const page = { maxWidth: 920, margin: '32px auto', padding: '0 20px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const card = { border: '1px solid #ececec', borderRadius: 12, background: '#fff', overflow: 'hidden' };
      const ctrl = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 16px' };
      const sel = { padding: '7px 9px', borderRadius: 8, border: '1px solid #d4d4d4', fontSize: 13, background: '#fff' };
      const inp = { padding: '7px 10px', borderRadius: 8, border: '1px solid #d4d4d4', fontSize: 13, flex: 1, minWidth: 160 };
      const th = { textAlign: 'left', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase',
        letterSpacing: 0.5, padding: '10px 12px', borderBottom: '1px solid #ececec', cursor: 'pointer' };
      const td = { padding: '10px 12px', borderBottom: '1px solid #f5f5f5', fontSize: 13.5 };
      const chip = function (color, bg) { return { fontSize: 11, color: color, background: bg, borderRadius: 999, padding: '2px 9px', cursor: 'pointer' }; };
      const sBtn = { fontSize: 12, border: '1px solid #e5e5e5', background: '#fafafa', borderRadius: 7, padding: '5px 9px', cursor: 'pointer' };
      const STAT = { active: ['#15803d', '#dcfce7'], invited: ['#b45309', '#fef3c7'], suspended: ['#b91c1c', '#fee2e2'] };

      const head = function (key, label) {
        return h('th', { style: th, onClick: function () { setSortKey(key); } },
          label + (sortKey === key ? ' ↓' : ''));
      };

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
          h('h1', { style: { fontSize: 24, fontWeight: 700, margin: '0 0 4px' } }, 'Users'),
          h('button', { style: sBtn, onClick: function () { db.reset(); log.info('reset'); setSelected({}); } }, 'Reset to seed'),
        ),
        h('p', { style: { color: '#6b7280', margin: '0 0 18px', fontSize: 13 } },
          STATUSES.map(function (s) { return s + ': ' + (counts[s] || 0); }).join('  ·  ') + '  ·  total: ' + all.length),

        h('div', { style: ctrl },
          h('input', { style: inp, placeholder: 'Search name or email…', value: search,
            onChange: function (e) { setSearch(e.target.value); } }),
          h('select', { style: sel, value: roleF, onChange: function (e) { setRoleF(e.target.value); } },
            h('option', { value: 'all' }, 'All roles'),
            ROLES.map(function (r) { return h('option', { key: r, value: r }, r); })),
          h('select', { style: sel, value: statusF, onChange: function (e) { setStatusF(e.target.value); } },
            h('option', { value: 'all' }, 'All statuses'),
            STATUSES.map(function (s) { return h('option', { key: s, value: s }, s); })),
        ),

        selIds.length > 0 && h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 12px', fontSize: 13 } },
          h('span', { style: { color: '#6b7280' } }, selIds.length + ' selected'),
          h('button', { style: sBtn, onClick: bulkSuspend }, 'Suspend selected'),
          h('button', { style: Object.assign({}, sBtn, { color: '#b91c1c' }), onClick: bulkDelete }, 'Delete selected'),
        ),

        h('div', { style: card },
          h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
              h('th', { style: Object.assign({}, th, { cursor: 'default', width: 28 }) }, ''),
              head('name', 'Name'), head('email', 'Email'), head('role', 'Role'), head('status', 'Status'),
              h('th', { style: Object.assign({}, th, { cursor: 'default', textAlign: 'right' }) }, 'Actions'),
            )),
            h('tbody', null,
              rows.length === 0
                ? h('tr', null, h('td', { style: Object.assign({}, td, { color: '#9ca3af' }), colSpan: 6 }, 'No users match.'))
                : rows.map(function (u) {
                  const sc = STAT[u.status] || ['#6b7280', '#f3f4f6'];
                  return h('tr', { key: u.id },
                    h('td', { style: td }, h('input', { type: 'checkbox', checked: !!selected[u.id], onChange: function () { toggleSel(u.id); } })),
                    h('td', { style: Object.assign({}, td, { fontWeight: 500 }) }, u.name),
                    h('td', { style: Object.assign({}, td, { color: '#6b7280' }) }, u.email),
                    h('td', { style: td }, h('span', { style: chip('#374151', '#f3f4f6'), title: 'click to cycle', onClick: function () { cycleRole(u); } }, u.role)),
                    h('td', { style: td }, h('span', { style: chip(sc[0], sc[1]) }, u.status)),
                    h('td', { style: Object.assign({}, td, { textAlign: 'right', whiteSpace: 'nowrap' }) },
                      h('button', { style: sBtn, onClick: function () { setStatus(u, u.status === 'suspended' ? 'active' : 'suspended'); } },
                        u.status === 'suspended' ? 'Reactivate' : 'Suspend'),
                      h('button', { style: Object.assign({}, sBtn, { marginLeft: 6, color: '#b91c1c' }), onClick: function () { remove(u); } }, 'Delete'),
                    ),
                  );
                }),
            ),
          ),
        ),

        h('div', { style: { fontSize: 11, color: '#9ca3af', margin: '22px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 } }, 'audit log'),
        h('div', { style: { fontSize: 12.5, color: '#6b7280' } },
          auditRows.length === 0
            ? h('span', { style: { color: '#9ca3af' } }, 'No activity yet.')
            : auditRows.slice(0, 8).map(function (a) {
              return h('div', { key: a.id, style: { padding: '2px 0' } },
                h('span', { style: { color: '#9ca3af', marginRight: 8 } }, a.action),
                a.detail);
            }),
        ),
      );
    }

    window.App = Dashboard;
  `,
};
