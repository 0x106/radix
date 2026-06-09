// BATCH 3 EXAMPLE — property-graph explorer (example-apps.md #44).
//
// Purpose: stress the query model with graph-shaped data. Nodes and edges are
// first-class db collections; the interesting reads are traversals — neighbours,
// shortest path, connected components, degree centrality — which a flat
// `query(collection, filter)` can't express in one call.
//
// What it surfaced (recorded in runtime-contract.md):
//   - BFS frontier expansion needs set-membership filtering. Added the single
//     `where: { field: { in: [...] } }` operator to db.query for this.
//   - Traversal algorithms themselves (BFS, components, centrality) stay in app
//     code, per the plan's "relational/filter work in JS on top" stance. The db
//     answers per-hop edge lookups; the app does the recursion.
//
// The layout is a small force-directed relaxation run synchronously on change,
// with initial positions from radix.random so the same seed gives the same
// picture. A "growth" actor adds people and edges over simulated time so the
// graph live-updates while you watch.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const graph = {
  name: "Graph explorer (org chart)",
  description:
    "Batch 3 example: property-graph explorer over nodes/edges collections — BFS shortest path, connected components, degree centrality, live growth actor.",
  source: /* js */ `
    const { useState, useEffect, useMemo, useRef } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, log = R.log, random = R.random;

    db.define({
      nodes: {
        fields: {
          label: { type: 'string', required: true },
          kind: { type: 'enum', values: ['person', 'project', 'skill'] },
        },
        seed: [
          { id: 'n1',  label: 'Dana (CEO)',     kind: 'person' },
          { id: 'n2',  label: 'Miguel (Eng)',   kind: 'person' },
          { id: 'n3',  label: 'Priya (Eng)',    kind: 'person' },
          { id: 'n4',  label: 'Tom (Design)',   kind: 'person' },
          { id: 'n5',  label: 'Aisha (Sales)',  kind: 'person' },
          { id: 'n6',  label: 'Checkout v2',    kind: 'project' },
          { id: 'n7',  label: 'Mobile app',     kind: 'project' },
          { id: 'n8',  label: 'React',          kind: 'skill' },
          { id: 'n9',  label: 'Figma',          kind: 'skill' },
          // A deliberately disconnected island, so "components" is non-trivial.
          { id: 'n10', label: 'Lab robot',      kind: 'project' },
          { id: 'n11', label: 'Sam (Research)', kind: 'person' },
        ],
      },
      edges: {
        fields: {
          from: { type: 'ref', collection: 'nodes' },
          to: { type: 'ref', collection: 'nodes' },
          kind: { type: 'enum', values: ['reports_to', 'works_on', 'has_skill'] },
        },
        seed: [
          { from: 'n2',  to: 'n1', kind: 'reports_to' },
          { from: 'n3',  to: 'n1', kind: 'reports_to' },
          { from: 'n4',  to: 'n1', kind: 'reports_to' },
          { from: 'n5',  to: 'n1', kind: 'reports_to' },
          { from: 'n2',  to: 'n6', kind: 'works_on' },
          { from: 'n3',  to: 'n6', kind: 'works_on' },
          { from: 'n3',  to: 'n7', kind: 'works_on' },
          { from: 'n4',  to: 'n7', kind: 'works_on' },
          { from: 'n2',  to: 'n8', kind: 'has_skill' },
          { from: 'n3',  to: 'n8', kind: 'has_skill' },
          { from: 'n4',  to: 'n9', kind: 'has_skill' },
          { from: 'n11', to: 'n10', kind: 'works_on' },
        ],
      },
    });
    log.info('graph seeded');

    // --- traversals (app-side; the db answers per-hop lookups) ---------------

    // Shortest path by BFS. Each hop is two db queries using the \`in\` operator:
    // edges leaving the frontier and edges entering it (traversal is undirected).
    function shortestPath(srcId, dstId) {
      if (srcId === dstId) return [srcId];
      const prev = {}; prev[srcId] = null;
      let frontier = [srcId];
      while (frontier.length > 0 && prev[dstId] === undefined) {
        const out = db.query('edges', { where: { from: { in: frontier } } });
        const inc = db.query('edges', { where: { to: { in: frontier } } });
        const next = [];
        out.concat(inc).forEach(function (e) {
          const a = frontier.indexOf(e.from) >= 0 ? e.from : e.to;
          const b = a === e.from ? e.to : e.from;
          if (prev[b] === undefined) { prev[b] = a; next.push(b); }
        });
        frontier = next;
      }
      if (prev[dstId] === undefined) return null;
      const path = [];
      for (let at = dstId; at !== null; at = prev[at]) path.unshift(at);
      return path;
    }

    // Connected components: one pass over all edges, union-find style via BFS.
    function components(nodes, edges) {
      const adj = {};
      edges.forEach(function (e) {
        (adj[e.from] || (adj[e.from] = [])).push(e.to);
        (adj[e.to] || (adj[e.to] = [])).push(e.from);
      });
      const comp = {}; let n = 0;
      nodes.forEach(function (node) {
        if (comp[node.id] !== undefined) return;
        const queue = [node.id]; comp[node.id] = n;
        while (queue.length) {
          const id = queue.shift();
          (adj[id] || []).forEach(function (nb) {
            if (comp[nb] === undefined) { comp[nb] = n; queue.push(nb); }
          });
        }
        n++;
      });
      return { comp: comp, count: n };
    }

    function degrees(edges) {
      const d = {};
      edges.forEach(function (e) {
        d[e.from] = (d[e.from] || 0) + 1;
        d[e.to] = (d[e.to] || 0) + 1;
      });
      return d;
    }

    // --- force layout ---------------------------------------------------------
    // Synchronous relaxation, not an animation loop: deterministic (positions
    // seeded from radix.random) and cheap at prototype graph sizes.
    const W = 800, H = 520;
    function relax(nodes, edges, pos, iterations) {
      nodes.forEach(function (n) {
        if (!pos[n.id]) {
          pos[n.id] = { x: 80 + random.random() * (W - 160), y: 60 + random.random() * (H - 120) };
        }
      });
      const ids = nodes.map(function (n) { return n.id; });
      for (let it = 0; it < iterations; it++) {
        const force = {};
        ids.forEach(function (id) { force[id] = { x: 0, y: 0 }; });
        // pairwise repulsion
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = pos[ids[i]], b = pos[ids[j]];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy; if (d2 < 1) { d2 = 1; dx = 1; }
            const f = 5500 / d2;
            const d = Math.sqrt(d2);
            force[ids[i]].x += (dx / d) * f; force[ids[i]].y += (dy / d) * f;
            force[ids[j]].x -= (dx / d) * f; force[ids[j]].y -= (dy / d) * f;
          }
        }
        // springs along edges
        edges.forEach(function (e) {
          const a = pos[e.from], b = pos[e.to];
          if (!a || !b) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (d - 110) * 0.02;
          force[e.from].x += (dx / d) * f; force[e.from].y += (dy / d) * f;
          force[e.to].x -= (dx / d) * f; force[e.to].y -= (dy / d) * f;
        });
        // gentle pull to centre + apply with clamping
        ids.forEach(function (id) {
          const p = pos[id];
          force[id].x += (W / 2 - p.x) * 0.004;
          force[id].y += (H / 2 - p.y) * 0.004;
          p.x = Math.min(W - 40, Math.max(40, p.x + force[id].x * 0.6));
          p.y = Math.min(H - 30, Math.max(30, p.y + force[id].y * 0.6));
        });
      }
      return pos;
    }

    // --- growth actor ---------------------------------------------------------
    // Adds a hire or a collaboration edge every few simulated seconds, so the
    // graph live-updates. Driven by the simulation clock: pausing the clock from
    // the console pauses growth.
    const firstNames = ['Noor', 'Felix', 'Ines', 'Marcus', 'Yuki', 'Lena', 'Omar', 'Bea'];
    const growth = R.actor({
      everyMs: 4000,
      jitterMs: 1500,
      state: { hires: 0 },
      tick: function (ctx) {
        const people = ctx.db.query('nodes', { where: { kind: 'person' } });
        const targets = ctx.db.query('nodes');
        if (ctx.random.random() < 0.4 && ctx.state.hires < firstNames.length) {
          const name = firstNames[ctx.state.hires];
          ctx.set({ hires: ctx.state.hires + 1 });
          const boss = ctx.random.pick(people);
          const hire = ctx.db.create('nodes', { label: name + ' (new)', kind: 'person' });
          ctx.db.create('edges', { from: hire.id, to: boss.id, kind: 'reports_to' });
          ctx.log.info('hired ' + name + ', reporting to ' + boss.label);
        } else {
          const a = ctx.random.pick(people);
          const b = ctx.random.pick(targets);
          if (a.id === b.id) return;
          const dup = ctx.db.query('edges', { where: { from: a.id, to: b.id } });
          if (dup.length > 0) return;
          const kind = b.kind === 'person' ? 'reports_to' : (b.kind === 'project' ? 'works_on' : 'has_skill');
          ctx.db.create('edges', { from: a.id, to: b.id, kind: kind });
          ctx.log.info('linked ' + a.label + ' -> ' + b.label + ' (' + kind + ')');
        }
      },
    });

    // --- UI ---------------------------------------------------------------------
    const KIND_SHAPE = { person: 'circle', project: 'rect', skill: 'diamond' };
    const COMP_COLORS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2'];

    function useCollection(name) {
      const [rows, setRows] = useState(function () { return db.query(name); });
      useEffect(function () { return db.subscribe(name, setRows); }, [name]);
      return rows;
    }

    function GraphExplorer() {
      const nodes = useCollection('nodes');
      const edges = useCollection('edges');
      const [selected, setSelected] = useState(null);   // node id
      const [pathMode, setPathMode] = useState(false);
      const [pathEnds, setPathEnds] = useState([]);     // [srcId, dstId]
      const [growing, setGrowing] = useState(false);
      const posRef = useRef({});

      // Re-relax on every change: existing nodes keep their position (so the
      // picture is stable), new nodes get seeded spots and settle in.
      const positions = useMemo(function () {
        const known = Object.keys(posRef.current).length;
        return relax(nodes, edges, posRef.current, known === 0 ? 200 : 50);
      }, [nodes, edges]);

      const comps = useMemo(function () { return components(nodes, edges); }, [nodes, edges]);
      const degs = useMemo(function () { return degrees(edges); }, [edges]);

      const path = useMemo(function () {
        if (pathEnds.length !== 2) return null;
        return shortestPath(pathEnds[0], pathEnds[1]);
      }, [pathEnds, edges]);

      const onNodeClick = function (id) {
        if (pathMode) {
          setPathEnds(function (p) { return p.length >= 2 ? [id] : p.concat(id); });
        } else {
          setSelected(function (s) { return s === id ? null : id; });
        }
      };

      const toggleGrowth = function () {
        if (growing) { growth.stop(); } else { growth.start(); }
        setGrowing(!growing);
      };

      const onPath = function (id) { return path && path.indexOf(id) >= 0; };
      const pathEdge = function (e) {
        if (!path) return false;
        const i = path.indexOf(e.from), j = path.indexOf(e.to);
        return i >= 0 && j >= 0 && Math.abs(i - j) === 1;
      };

      const selNode = selected ? db.get('nodes', selected) : null;
      const neighbours = useMemo(function () {
        if (!selected) return [];
        const out = db.query('edges', { where: { from: selected } });
        const inc = db.query('edges', { where: { to: selected } });
        return out.map(function (e) { return { node: db.get('nodes', e.to), kind: e.kind, dir: 'out' }; })
          .concat(inc.map(function (e) { return { node: db.get('nodes', e.from), kind: e.kind, dir: 'in' }; }))
          .filter(function (x) { return x.node; });
      }, [selected, edges]);

      const page = { maxWidth: 1080, margin: '0 auto', padding: '16px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const btn = function (active) { return { padding: '7px 12px', borderRadius: 8,
        border: '1px solid ' + (active ? '#111' : '#e5e5e5'),
        background: active ? '#111' : '#fff', color: active ? '#fff' : '#374151',
        cursor: 'pointer', fontSize: 13 }; };
      const card = { border: '1px solid #ececec', borderRadius: 12, background: '#fff', padding: 14 };

      function renderNode(n) {
        const p = positions[n.id];
        if (!p) return null;
        const deg = degs[n.id] || 0;
        const r = 8 + Math.min(10, deg * 1.6);            // degree centrality -> size
        const color = COMP_COLORS[comps.comp[n.id] % COMP_COLORS.length];
        const isSel = selected === n.id;
        const isEnd = pathEnds.indexOf(n.id) >= 0;
        const hot = isSel || isEnd || onPath(n.id);
        const common = {
          fill: hot ? color : '#fff', stroke: color,
          strokeWidth: hot ? 3 : 1.5, cursor: 'pointer',
          onClick: function () { onNodeClick(n.id); },
        };
        let shape;
        if (KIND_SHAPE[n.kind] === 'rect') {
          shape = h('rect', Object.assign({ x: p.x - r, y: p.y - r * 0.8, width: r * 2, height: r * 1.6, rx: 4 }, common));
        } else if (KIND_SHAPE[n.kind] === 'diamond') {
          const pts = p.x + ',' + (p.y - r) + ' ' + (p.x + r) + ',' + p.y + ' ' + p.x + ',' + (p.y + r) + ' ' + (p.x - r) + ',' + p.y;
          shape = h('polygon', Object.assign({ points: pts }, common));
        } else {
          shape = h('circle', Object.assign({ cx: p.x, cy: p.y, r: r }, common));
        }
        return h('g', { key: n.id },
          shape,
          h('text', { x: p.x, y: p.y + r + 13, textAnchor: 'middle',
            style: { fontSize: 11, fill: '#374151', pointerEvents: 'none' } }, n.label),
        );
      }

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0, marginRight: 'auto' } }, 'Graph explorer'),
          h('span', { style: { fontSize: 12.5, color: '#6b7280' } },
            nodes.length + ' nodes · ' + edges.length + ' edges · ' + comps.count + ' components'),
          h('button', { style: btn(pathMode), onClick: function () { setPathMode(!pathMode); setPathEnds([]); } },
            pathMode ? 'Path mode: pick 2 nodes' : 'Shortest path'),
          h('button', { style: btn(growing), onClick: toggleGrowth }, growing ? 'Pause growth' : 'Simulate growth'),
          h('button', { style: btn(false), onClick: function () { posRef.current = {}; db.reset(); setSelected(null); setPathEnds([]); log.info('reset'); } }, 'Reset'),
        ),
        h('div', { style: { display: 'flex', gap: 14, alignItems: 'flex-start' } },
          h('div', { style: Object.assign({}, card, { padding: 0, flex: 1, overflow: 'hidden' }) },
            h('svg', { viewBox: '0 0 ' + W + ' ' + H, style: { display: 'block', width: '100%', background: '#fafafa' } },
              edges.map(function (e) {
                const a = positions[e.from], b = positions[e.to];
                if (!a || !b) return null;
                const hot = pathEdge(e);
                return h('line', { key: e.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                  stroke: hot ? '#2563eb' : (e.kind === 'reports_to' ? '#9ca3af' : '#d1d5db'),
                  strokeWidth: hot ? 3 : (e.kind === 'reports_to' ? 1.8 : 1.2),
                  strokeDasharray: e.kind === 'has_skill' ? '4 3' : 'none' });
              }),
              nodes.map(renderNode),
            ),
          ),
          h('div', { style: { width: 280, display: 'flex', flexDirection: 'column', gap: 12 } },
            pathMode && h('div', { style: card },
              h('div', { style: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 } }, 'shortest path'),
              pathEnds.length < 2
                ? h('div', { style: { fontSize: 13, color: '#6b7280' } }, 'Click ' + (2 - pathEnds.length) + ' more node(s) in the graph.')
                : path
                  ? h('div', { style: { fontSize: 13 } },
                      path.map(function (id) { const n = db.get('nodes', id); return n ? n.label : id; }).join(' → '),
                      h('div', { style: { color: '#6b7280', marginTop: 6, fontSize: 12 } }, (path.length - 1) + ' hop(s)'))
                  : h('div', { style: { fontSize: 13, color: '#b91c1c' } }, 'No path — the nodes are in different components.'),
            ),
            selNode && h('div', { style: card },
              h('div', { style: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 } }, selNode.kind),
              h('div', { style: { fontSize: 15, fontWeight: 600 } }, selNode.label),
              h('div', { style: { fontSize: 12.5, color: '#6b7280', margin: '4px 0 10px' } },
                'degree ' + (degs[selNode.id] || 0) + ' · component ' + (comps.comp[selNode.id] + 1)),
              neighbours.length === 0
                ? h('div', { style: { fontSize: 13, color: '#9ca3af' } }, 'No connections.')
                : neighbours.map(function (nb, i) {
                    return h('div', { key: i, style: { fontSize: 13, padding: '4px 0', cursor: 'pointer', color: '#2563eb' },
                      onClick: function () { setSelected(nb.node.id); } },
                      (nb.dir === 'out' ? '→ ' : '← ') + nb.node.label,
                      h('span', { style: { color: '#9ca3af' } }, '  ' + nb.kind.replace('_', ' ')));
                  }),
            ),
            h('div', { style: card },
              h('div', { style: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 } }, 'legend'),
              h('div', { style: { fontSize: 12.5, color: '#374151', lineHeight: 1.9 } },
                h('div', null, '● person   ■ project   ◆ skill'),
                h('div', null, 'Node size = degree centrality'),
                h('div', null, 'Colour = connected component'),
                h('div', null, 'Solid edge = reports to / works on'),
                h('div', null, 'Dashed edge = has skill')),
            ),
          ),
        ),
      );
    }

    window.App = GraphExplorer;
  `,
};
