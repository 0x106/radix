// BATCH 3 EXAMPLE — spreadsheet with formula engine (example-apps.md #41).
//
// Purpose: the hardest pure-compute case. Cells are db rows; formulas are data;
// evaluation builds a dependency graph and computes cells in topological order
// with cycle detection. Two simulated collaborators edit the same sheet, forcing
// live invalidation and re-evaluation across the dependency graph.
//
// What it surfaced (recorded in runtime-contract.md):
//   - Nothing new from the runtime. The formula engine is real app code (the
//     plan's pure-compute spine), the db holds inputs not results, and the
//     collaborators are ordinary actors doing ordinary writes. The interesting
//     part is the shape: derived values are NEVER stored — every db change
//     re-evaluates the whole visible graph, which at spreadsheet scale is fine.
//   - Cell ids are their refs ('A1'), so collaborator writes are natural
//     upserts. The id-collision fix (genId skipping taken ids) matters here.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const spreadsheet = {
  name: "Spreadsheet (formula engine)",
  description:
    "Batch 3 example: spreadsheet over a cells collection — formula parser, dependency DAG with cycle detection, two simulated collaborators editing live.",
  source: /* js */ `
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, log = R.log;

    const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
    const ROWS = 10;

    db.define({
      cells: {
        fields: { ref: { type: 'string', required: true }, input: 'string' },
        seed: [
          { id: 'A1', ref: 'A1', input: 'Budget' },
          { id: 'B1', ref: 'B1', input: 'Jan' }, { id: 'C1', ref: 'C1', input: 'Feb' }, { id: 'D1', ref: 'D1', input: 'Mar' },
          { id: 'E1', ref: 'E1', input: 'Total' },
          { id: 'A2', ref: 'A2', input: 'Rent' },   { id: 'B2', ref: 'B2', input: '1200' }, { id: 'C2', ref: 'C2', input: '1200' }, { id: 'D2', ref: 'D2', input: '1250' },
          { id: 'A3', ref: 'A3', input: 'Food' },   { id: 'B3', ref: 'B3', input: '410' },  { id: 'C3', ref: 'C3', input: '385' },  { id: 'D3', ref: 'D3', input: '440' },
          { id: 'A4', ref: 'A4', input: 'Travel' }, { id: 'B4', ref: 'B4', input: '95' },   { id: 'C4', ref: 'C4', input: '210' },  { id: 'D4', ref: 'D4', input: '60' },
          { id: 'A5', ref: 'A5', input: 'Fun' },    { id: 'B5', ref: 'B5', input: '150' },  { id: 'C5', ref: 'C5', input: '120' },  { id: 'D5', ref: 'D5', input: '180' },
          { id: 'E2', ref: 'E2', input: '=SUM(B2:D2)' }, { id: 'E3', ref: 'E3', input: '=SUM(B3:D3)' },
          { id: 'E4', ref: 'E4', input: '=SUM(B4:D4)' }, { id: 'E5', ref: 'E5', input: '=SUM(B5:D5)' },
          { id: 'A7', ref: 'A7', input: 'Total' },
          { id: 'B7', ref: 'B7', input: '=SUM(B2:B5)' }, { id: 'C7', ref: 'C7', input: '=SUM(C2:C5)' }, { id: 'D7', ref: 'D7', input: '=SUM(D2:D5)' },
          { id: 'E7', ref: 'E7', input: '=SUM(E2:E5)' },
          { id: 'A8', ref: 'A8', input: 'Average' },
          { id: 'B8', ref: 'B8', input: '=AVG(B2:B5)' }, { id: 'C8', ref: 'C8', input: '=AVG(C2:C5)' }, { id: 'D8', ref: 'D8', input: '=AVG(D2:D5)' },
        ],
      },
      presence: {
        fields: { who: 'string', color: 'string', ref: 'string', at: 'number' },
      },
    }, { strict: true });
    log.info('sheet seeded');

    // --- formula engine (pure app code — the pure-compute spine) --------------

    // Tokenize a formula body: numbers, cell refs, function names, operators.
    function tokenize(src) {
      const tokens = [];
      let i = 0;
      while (i < src.length) {
        const ch = src[i];
        if (ch === ' ') { i++; continue; }
        if ('+-*/():,'.indexOf(ch) >= 0) { tokens.push({ t: ch }); i++; continue; }
        if (ch >= '0' && ch <= '9' || ch === '.') {
          let j = i; while (j < src.length && (src[j] >= '0' && src[j] <= '9' || src[j] === '.')) j++;
          tokens.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
        }
        if (/[A-Za-z]/.test(ch)) {
          let j = i; while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
          const word = src.slice(i, j).toUpperCase();
          if (/^[A-Z]+[0-9]+$/.test(word)) { tokens.push({ t: 'cell', v: word }); }
          else { tokens.push({ t: 'fn', v: word }); }
          i = j; continue;
        }
        throw { err: true };
      }
      return tokens;
    }

    // Expand 'B2:D2' into the rectangle of refs it covers.
    function expandRange(a, b) {
      const pa = a.match(/^([A-Z]+)([0-9]+)$/), pb = b.match(/^([A-Z]+)([0-9]+)$/);
      if (!pa || !pb) throw { err: true };
      const c1 = COLS.indexOf(pa[1]), c2 = COLS.indexOf(pb[1]);
      const r1 = parseInt(pa[2], 10), r2 = parseInt(pb[2], 10);
      const out = [];
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) out.push(COLS[c] + r);
      }
      return out;
    }

    const FNS = {
      SUM: function (vals) { return vals.reduce(function (s, v) { return s + v; }, 0); },
      AVG: function (vals) { return vals.length ? FNS.SUM(vals) / vals.length : 0; },
      MIN: function (vals) { return Math.min.apply(null, vals); },
      MAX: function (vals) { return Math.max.apply(null, vals); },
    };

    // Recursive-descent: expr := term (+|- term)*; term := factor (*|/ factor)*;
    // factor := num | cell | fn(range) | (expr) | -factor. \`lookup\` resolves a
    // cell ref to a number (recursing through the dependency graph).
    function evalFormula(src, lookup) {
      const tokens = tokenize(src);
      let pos = 0;
      const peek = function () { return tokens[pos]; };
      const next = function () { return tokens[pos++]; };
      function factor() {
        const tk = next();
        if (!tk) throw { err: true };
        if (tk.t === 'num') return tk.v;
        if (tk.t === 'cell') return lookup(tk.v);
        if (tk.t === '-') return -factor();
        if (tk.t === '(') { const v = expr(); if (!peek() || next().t !== ')') throw { err: true }; return v; }
        if (tk.t === 'fn') {
          const fn = FNS[tk.v]; if (!fn) throw { err: true };
          if (next().t !== '(') throw { err: true };
          const a = next(); if (!a || a.t !== 'cell') throw { err: true };
          let refs;
          if (peek() && peek().t === ':') { next(); const b = next(); if (!b || b.t !== 'cell') throw { err: true }; refs = expandRange(a.v, b.v); }
          else { refs = [a.v]; }
          if (next().t !== ')') throw { err: true };
          return fn(refs.map(lookup));
        }
        throw { err: true };
      }
      function term() {
        let v = factor();
        while (peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = factor(); v = op === '*' ? v * r : v / r; }
        return v;
      }
      function expr() {
        let v = term();
        while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = term(); v = op === '+' ? v + r : v - r; }
        return v;
      }
      const v = expr();
      if (pos !== tokens.length) throw { err: true };
      return v;
    }

    // Evaluate every cell: depth-first through the dependency graph, memoised,
    // with visiting-state cycle detection. Returns { ref: displayValue }.
    function computeAll(cellRows) {
      const inputs = {};
      cellRows.forEach(function (c) { inputs[c.ref] = c.input; });
      const memo = {}, visiting = {};
      function asNumber(ref) {
        const v = evalRef(ref);
        if (typeof v === 'number') return v;
        if (v === '' || v === undefined) return 0;
        throw { err: true };       // text or an error value used in arithmetic
      }
      function evalRef(ref) {
        if (ref in memo) return memo[ref];
        if (visiting[ref]) throw { cycle: true };
        visiting[ref] = true;
        let val;
        const raw = inputs[ref];
        if (raw === undefined || raw === '') val = '';
        else if (raw[0] === '=') {
          try { val = evalFormula(raw.slice(1), asNumber); }
          catch (e) {
            // every cell on the cycle's stack reports #CYCLE, not just the root
            if (e && e.cycle) { visiting[ref] = false; memo[ref] = '#CYCLE'; throw e; }
            val = '#ERR';
          }
        } else {
          const n = Number(raw);
          val = (raw.trim() !== '' && !isNaN(n)) ? n : raw;
        }
        visiting[ref] = false;
        memo[ref] = val;
        return val;
      }
      cellRows.forEach(function (c) {
        try { evalRef(c.ref); }
        catch (e) {
          // a cycle poisons every cell still on the visiting stack
          for (const k in visiting) { if (visiting[k]) { memo[k] = '#CYCLE'; visiting[k] = false; } }
          memo[c.ref] = '#CYCLE';
        }
      });
      return memo;
    }
    window.__sheetEngine = { computeAll: computeAll, evalFormula: evalFormula }; // debug/test hook

    // --- writes: cell id IS the ref, so edits from anyone are upserts ----------
    function setCell(ref, input) {
      if (db.get('cells', ref)) { db.update('cells', ref, { input: input }); }
      else { db.create('cells', { id: ref, ref: ref, input: input }); }
    }

    function touchPresence(who, color, ref, ctx) {
      const p = db.query('presence', { where: { who: who } })[0];
      const row = { who: who, color: color, ref: ref, at: ctx.clock.now() };
      if (p) { db.update('presence', p.id, row); } else { db.create('presence', row); }
    }

    // --- collaborators: two actors editing the same sheet ----------------------
    // Mara tweaks the raw numbers; Finn edits formulas. Their writes invalidate
    // downstream SUM/AVG cells through the same path as the user's own edits.
    const mara = R.actor({
      everyMs: 2500, jitterMs: 900,
      tick: function (ctx) {
        const col = ctx.random.pick(['B', 'C', 'D']);
        const row = ctx.random.int(2, 5);
        const ref = col + row;
        const cur = db.get('cells', ref);
        const base = cur && !isNaN(Number(cur.input)) ? Number(cur.input) : 200;
        const val = String(Math.max(10, Math.round(base + ctx.random.int(-60, 60))));
        setCell(ref, val);
        touchPresence('Mara', '#d97706', ref, ctx);
        ctx.log.info('Mara set ' + ref + ' = ' + val);
      },
    });
    const finn = R.actor({
      everyMs: 4000, jitterMs: 1500,
      tick: function (ctx) {
        const moves = [
          ['F2', '=E2/E7'], ['F3', '=E3/E7'], ['F4', '=E4/E7'], ['F5', '=E5/E7'],
          ['F1', 'Share'], ['B9', '=MAX(B2:B5)'], ['C9', '=MAX(C2:C5)'], ['A9', 'Largest'],
          ['E8', '=AVG(E2:E5)'],
        ];
        const m = ctx.random.pick(moves);
        setCell(m[0], m[1]);
        touchPresence('Finn', '#7c3aed', m[0], ctx);
        ctx.log.info('Finn set ' + m[0] + ' = ' + m[1]);
      },
    });

    // --- UI ---------------------------------------------------------------------
    function useCollection(name) {
      const [rows, setRows] = useState(function () { return db.query(name); });
      useEffect(function () { return db.subscribe(name, setRows); }, [name]);
      return rows;
    }

    function display(v) {
      if (typeof v === 'number') return (Math.round(v * 100) / 100).toString();
      return v;
    }

    function Sheet() {
      const cells = useCollection('cells');
      const presence = useCollection('presence');
      const [sel, setSel] = useState('B2');
      const [draft, setDraft] = useState(null);   // formula-bar text while editing
      const [collab, setCollab] = useState(false);

      // The whole point: derived values are computed, never stored. Any change
      // to the cells collection re-evaluates the dependency graph.
      const values = useMemo(function () { return computeAll(cells); }, [cells]);

      const presByRef = {};
      presence.forEach(function (p) { presByRef[p.ref] = p; });

      const selCell = db.get('cells', sel);
      const barText = draft !== null ? draft : (selCell ? selCell.input : '');
      const commit = function () {
        if (draft !== null) { setCell(sel, draft); setDraft(null); }
      };
      const toggleCollab = function () {
        if (collab) { mara.stop(); finn.stop(); } else { mara.start(); finn.start(); }
        setCollab(!collab);
      };

      const page = { maxWidth: 920, margin: '0 auto', padding: '16px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const btn = function (active) { return { padding: '7px 12px', borderRadius: 8,
        border: '1px solid ' + (active ? '#111' : '#e5e5e5'),
        background: active ? '#111' : '#fff', color: active ? '#fff' : '#374151',
        cursor: 'pointer', fontSize: 13 }; };

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0, marginRight: 'auto' } }, 'Sheet'),
          presence.map(function (p) {
            return h('span', { key: p.who, style: { fontSize: 12.5, color: p.color, fontWeight: 600 } },
              '● ' + p.who + ' @ ' + p.ref);
          }),
          h('button', { style: btn(collab), onClick: toggleCollab }, collab ? 'Pause collaborators' : 'Invite collaborators'),
          h('button', { style: btn(false), onClick: function () { db.reset(); setDraft(null); log.info('reset'); } }, 'Reset'),
        ),
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
          h('span', { style: { padding: '7px 10px', background: '#f3f4f6', borderRadius: 8, fontSize: 13, fontWeight: 600, minWidth: 34, textAlign: 'center' } }, sel),
          h('input', { style: { flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, fontFamily: 'ui-monospace, monospace' },
            value: barText,
            placeholder: 'Value or =formula  (e.g. =SUM(B2:D2), =B7*2)',
            onChange: function (e) { setDraft(e.target.value); },
            onBlur: commit,
            onKeyDown: function (e) { if (e.key === 'Enter') { commit(); e.target.blur(); } } }),
        ),
        h('table', { style: { borderCollapse: 'collapse', width: '100%', background: '#fff', fontSize: 13 } },
          h('thead', null, h('tr', null,
            h('th', { style: { border: '1px solid #e5e7eb', background: '#f9fafb', width: 34 } }, ''),
            COLS.map(function (c) { return h('th', { key: c, style: { border: '1px solid #e5e7eb', background: '#f9fafb', padding: 4, fontWeight: 600, color: '#6b7280' } }, c); }))),
          h('tbody', null, Array.from({ length: ROWS }, function (_, i) {
            const r = i + 1;
            return h('tr', { key: r },
              h('td', { style: { border: '1px solid #e5e7eb', background: '#f9fafb', textAlign: 'center', color: '#6b7280', fontWeight: 600 } }, r),
              COLS.map(function (c) {
                const ref = c + r;
                const v = display(values[ref] !== undefined ? values[ref] : '');
                const isErr = v === '#ERR' || v === '#CYCLE';
                const p = presByRef[ref];
                const isSel = sel === ref;
                return h('td', {
                  key: ref,
                  onClick: function () { commit(); setSel(ref); setDraft(null); },
                  style: { border: isSel ? '2px solid #111' : (p ? '2px solid ' + p.color : '1px solid #e5e7eb'),
                    padding: '4px 7px', minWidth: 64, height: 22, cursor: 'cell',
                    textAlign: typeof values[ref] === 'number' ? 'right' : 'left',
                    color: isErr ? '#b91c1c' : '#111',
                    fontVariantNumeric: 'tabular-nums',
                    background: isErr ? '#fef2f2' : '#fff' },
                }, v);
              }));
          })),
        ),
        h('p', { style: { fontSize: 12.5, color: '#6b7280', marginTop: 10 } },
          'Formulas: + − * / ( ), cell refs, SUM/AVG/MIN/MAX over ranges. Try creating a cycle (set B2 to =B7) — the chain reports #CYCLE rather than hanging.'),
      );
    }

    window.App = Sheet;
  `,
};
