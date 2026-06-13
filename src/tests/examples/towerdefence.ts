// BATCH 3 EXAMPLE — tower defence (example-apps.md #43).
//
// Purpose: the frame-loop spine at scale. Hundreds of entities (enemies,
// towers, projectiles) with per-tick behaviour: waypoint pathing, target
// acquisition, attack resolution, wave spawning. NO database — all state lives
// in memory and is rebuilt from the seed on reload, exactly as the persistence
// model prescribes for ephemeral run state (plan.md tiers).
//
// What it surfaced (recorded in runtime-contract.md):
//   - Needed clock.onFrame. The clock's 100ms real-time driver is fine for
//     actors but makes a "60fps" game render in visible 100ms bursts. onFrame
//     gives a requestAnimationFrame-driven render while the clock plays.
//   - The split that keeps determinism: game LOGIC ticks at a fixed 50ms
//     simulated timestep via clock.setTimeout (so pause/step/fastForward from
//     the console replay identically); only RENDERING rides onFrame. Pausing
//     the clock freezes the entire battle; step(1000) advances it 20 ticks.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const towerdefence = {
  name: "Tower defence (frame loop)",
  description:
    "Batch 3 example: frame-loop spine at scale — hundreds of in-memory entities, fixed-timestep logic on the sim clock, rAF rendering via clock.onFrame.",
  source: /* js */ `
    const { useState, useEffect, useRef } = React;
    const h = React.createElement;
    const R = window.radix;
    const clock = R.clock, random = R.random, log = R.log;

    const W = 640, H = 400, STEP = 50; // logic timestep in simulated ms
    const PATH = [[0,210],[140,210],[140,80],[360,80],[360,310],[530,310],[530,150],[640,150]];
    const TOWER_TYPES = {
      gun:    { name: 'Gun',    cost: 40, range: 85,  dmg: 11, cooldown: 350,  color: '#2563eb' },
      sniper: { name: 'Sniper', cost: 75, range: 170, dmg: 42, cooldown: 1300, color: '#7c3aed' },
    };

    // --- game state: plain memory, seeded, reconstructable ---------------------
    let game;
    function freshGame() {
      return { gold: 110, lives: 20, wave: 0, enemies: [], towers: [], shots: [],
               spawnQueue: 0, spawnTimer: 0, over: false, won: false, killed: 0 };
    }
    game = freshGame();

    function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

    function startWave() {
      if (game.over || game.spawnQueue > 0 || game.enemies.length > 0 && game.wave === 0) return;
      game.wave++;
      game.spawnQueue = 6 + game.wave * 4;
      game.spawnTimer = 0;
      log.info('wave ' + game.wave + ': ' + game.spawnQueue + ' enemies');
    }

    function spawnEnemy() {
      const tough = random.random() < Math.min(0.35, game.wave * 0.05);
      game.enemies.push({
        x: PATH[0][0], y: PATH[0][1] + random.int(-8, 8), wp: 1,
        hp: (tough ? 110 : 45) + game.wave * 14,
        maxHp: (tough ? 110 : 45) + game.wave * 14,
        speed: tough ? 28 : 46 + random.int(-6, 6),   // px per simulated second
        bounty: tough ? 14 : 7,
        tough: tough,
      });
    }

    function placeTower(type, x, y) {
      const t = TOWER_TYPES[type];
      if (game.gold < t.cost || game.over) return;
      // keep off the road and off other towers
      for (let i = 0; i < PATH.length - 1; i++) {
        const a = PATH[i], b = PATH[i + 1];
        const len = dist(a[0], a[1], b[0], b[1]);
        const tt = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (len * len)));
        if (dist(x, y, a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1])) < 30) return;
      }
      if (game.towers.some(function (tw) { return dist(tw.x, tw.y, x, y) < 26; })) return;
      game.gold -= t.cost;
      game.towers.push({ type: type, x: x, y: y, cd: 0 });
    }

    // --- fixed-timestep logic: deterministic under pause/step/fastForward ------
    function update(dt) {
      if (game.over) return;
      const dts = dt / 1000;

      if (game.spawnQueue > 0) {
        game.spawnTimer -= dt;
        if (game.spawnTimer <= 0) { spawnEnemy(); game.spawnQueue--; game.spawnTimer = 380; }
      }

      // enemies walk the waypoints
      for (let i = game.enemies.length - 1; i >= 0; i--) {
        const e = game.enemies[i];
        const tgt = PATH[e.wp];
        const d = dist(e.x, e.y, tgt[0], tgt[1]);
        const step = e.speed * dts;
        if (d <= step) {
          e.x = tgt[0]; e.y = tgt[1]; e.wp++;
          if (e.wp >= PATH.length) {
            game.enemies.splice(i, 1);
            game.lives--;
            if (game.lives <= 0) { game.over = true; log.error('game over at wave ' + game.wave); }
            continue;
          }
        } else {
          e.x += ((tgt[0] - e.x) / d) * step;
          e.y += ((tgt[1] - e.y) / d) * step;
        }
      }

      // towers acquire nearest target in range and shoot
      game.towers.forEach(function (tw) {
        tw.cd -= dt;
        if (tw.cd > 0) return;
        const spec = TOWER_TYPES[tw.type];
        let best = null, bestD = Infinity;
        game.enemies.forEach(function (e) {
          const d = dist(tw.x, tw.y, e.x, e.y);
          if (d <= spec.range && d < bestD) { best = e; bestD = d; }
        });
        if (best) {
          tw.cd = spec.cooldown;
          game.shots.push({ x: tw.x, y: tw.y, target: best, dmg: spec.dmg, color: spec.color });
        }
      });

      // projectiles chase their target
      for (let i = game.shots.length - 1; i >= 0; i--) {
        const s = game.shots[i];
        const e = s.target;
        if (e.hp <= 0 || game.enemies.indexOf(e) < 0) { game.shots.splice(i, 1); continue; }
        const d = dist(s.x, s.y, e.x, e.y);
        const step = 300 * dts;
        if (d <= step) {
          e.hp -= s.dmg;
          game.shots.splice(i, 1);
          if (e.hp <= 0) {
            const idx = game.enemies.indexOf(e);
            if (idx >= 0) { game.enemies.splice(idx, 1); game.gold += e.bounty; game.killed++; }
          }
        } else {
          s.x += ((e.x - s.x) / d) * step;
          s.y += ((e.y - s.y) / d) * step;
        }
      }
    }

    // logic loop: a clock.setTimeout chain at a FIXED simulated timestep — the
    // same pattern as actor ticks, so the console's pause/step controls govern
    // the whole battle.
    (function logicLoop() {
      clock.setTimeout(function () { update(STEP); logicLoop(); }, STEP);
    })();
    window.__game = game && { get: function () { return game; }, update: update, startWave: startWave }; // debug/test hook

    // --- rendering: canvas redraw, driven by onFrame while playing -------------
    function draw(ctx) {
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
      // road
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 26; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(PATH[0][0], PATH[0][1]);
      for (let i = 1; i < PATH.length; i++) ctx.lineTo(PATH[i][0], PATH[i][1]);
      ctx.stroke();
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.stroke(); ctx.setLineDash([]);
      // towers
      game.towers.forEach(function (tw) {
        const spec = TOWER_TYPES[tw.type];
        ctx.fillStyle = spec.color;
        ctx.fillRect(tw.x - 9, tw.y - 9, 18, 18);
        ctx.strokeStyle = spec.color + '22'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(tw.x, tw.y, spec.range, 0, Math.PI * 2); ctx.stroke();
      });
      // enemies + hp bars
      game.enemies.forEach(function (e) {
        ctx.fillStyle = e.tough ? '#b91c1c' : '#f59e0b';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.tough ? 9 : 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(e.x - 10, e.y - 16, 20, 3);
        ctx.fillStyle = '#16a34a'; ctx.fillRect(e.x - 10, e.y - 16, 20 * Math.max(0, e.hp / e.maxHp), 3);
      });
      // shots
      game.shots.forEach(function (s) {
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
      });
      if (game.over) {
        ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#b91c1c'; ctx.font = 'bold 28px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Game over — wave ' + game.wave + ', ' + game.killed + ' kills', W / 2, H / 2);
      }
    }

    // --- UI ---------------------------------------------------------------------
    function TowerDefence() {
      const canvasRef = useRef(null);
      const [tool, setTool] = useState('gun');
      const [, force] = useState(0);          // HUD refresh tick

      useEffect(function () {
        const ctx = canvasRef.current.getContext('2d');
        draw(ctx);
        // render every animation frame while the clock plays...
        const offFrame = clock.onFrame(function () { draw(ctx); });
        // ...and on any clock change (covers step/fastForward while paused)
        let lastHud = -1;
        const offClock = clock.subscribe(function (now) {
          draw(ctx);
          if (now - lastHud >= 100 || now < lastHud) { lastHud = now; force(function (n) { return n + 1; }); }
        });
        clock.play();   // a game starts running
        return function () { offFrame(); offClock(); };
      }, []);

      const click = function (e) {
        const rect = canvasRef.current.getBoundingClientRect();
        placeTower(tool, (e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height));
        force(function (n) { return n + 1; });
      };
      const reset = function () { game = freshGame(); force(function (n) { return n + 1; }); log.info('new game'); };

      const page = { maxWidth: 700, margin: '0 auto', padding: '16px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const btn = function (active) { return { padding: '7px 12px', borderRadius: 8,
        border: '1px solid ' + (active ? '#111' : '#e5e5e5'),
        background: active ? '#111' : '#fff', color: active ? '#fff' : '#374151',
        cursor: 'pointer', fontSize: 13 }; };
      const stat = function (label, value, warn) {
        return h('span', { style: { fontSize: 13, color: warn ? '#b91c1c' : '#374151' } },
          h('span', { style: { color: '#9ca3af' } }, label + ' '), h('strong', null, value));
      };

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 } },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0, marginRight: 'auto' } }, 'Tower defence'),
          stat('gold', game.gold), stat('lives', game.lives, game.lives <= 5),
          stat('wave', game.wave), stat('enemies', game.enemies.length),
        ),
        h('canvas', { ref: canvasRef, width: W, height: H, onClick: click,
          style: { width: '100%', border: '1px solid #ececec', borderRadius: 12, display: 'block', cursor: 'crosshair' } }),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' } },
          Object.keys(TOWER_TYPES).map(function (k) {
            const t = TOWER_TYPES[k];
            return h('button', { key: k, style: btn(tool === k), onClick: function () { setTool(k); } },
              t.name + ' (' + t.cost + 'g)');
          }),
          h('button', { style: Object.assign({}, btn(false), { marginLeft: 'auto' }), onClick: function () { startWave(); } }, 'Start wave'),
          h('button', { style: btn(false), onClick: reset }, 'New game'),
        ),
        h('p', { style: { fontSize: 12.5, color: '#6b7280', marginTop: 8 } },
          'Click the map to place the selected tower. All game time is the simulation clock: pause from the console freezes the battle mid-flight; step or fast-forward replays it tick by tick.'),
      );
    }

    window.App = TowerDefence;
  `,
};
