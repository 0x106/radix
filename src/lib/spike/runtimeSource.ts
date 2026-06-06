// Radix runtime shim — PHASE 0 SPIKE. THROWAWAY.
//
// This is the browser-JS *implementation* of the contract in ./contract.ts,
// authored as a source string because it has to run inside the cross-origin,
// sandbox="allow-scripts" iframe alongside the prototype (it cannot be imported
// from node_modules at runtime — same reason `wrapReactApp` inlines its source).
// `wrapPrototype` (../htmlTemplate.ts) concatenates this BEFORE the prototype's
// component source, so by the time the component runs, `window.radix` exists.
//
// Intentionally simple and hand-written — a single in-memory store, a single
// event bus, a single steppable clock, a seeded PRNG, a log, and one actor
// primitive. It is NOT the generic store/simulator engine (Phases 2/3); its only
// job is to make the prototype<->library contract visible so Phase 1 can freeze
// the real thing. Style is ES5-ish on purpose to keep the inlined source robust.

export const runtimeSource = /* js */ `
window.radix = (function () {
  // ---- seeded randomness (mulberry32) — notes.md §9 -----------------------
  // Fixed default seed so reloads replay identically. Prototypes MUST use this,
  // never real Math.random(). We do NOT override Math.random globally: React's
  // CDN build may rely on it, and clobbering it risks breaking the renderer.
  // The contract is "the app uses radix.random"; enforcement is by convention
  // here, flagged in runtime-contract.md.
  var SEED = 1337;
  function makeRandom(seed) {
    var s = seed >>> 0;
    function next() {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      random: next,
      int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; }
    };
  }
  var random = makeRandom(SEED);

  // ---- simulated clock — notes.md §9 --------------------------------------
  // Virtual time in ms. When "playing", a real interval maps real elapsed ms to
  // virtual ms 1:1; pause/step/fastForward give manual control. All scheduled
  // work routes through this, never the real setTimeout, so it is deterministic
  // and steppable.
  var clock = (function () {
    var nowMs = 0;
    var running = false;
    var realTimer = null;
    var lastReal = 0;
    var timers = [];
    var subs = [];
    var TICK = 100;
    function notify() {
      var list = subs.slice();
      for (var i = 0; i < list.length; i++) { try { list[i](nowMs, running); } catch (e) {} }
    }
    function advance(ms) {
      if (ms <= 0) { return; }
      var target = nowMs + ms;
      while (true) {
        timers.sort(function (a, b) { return a.at - b.at; });
        if (!timers.length || timers[0].at > target) { break; }
        var t = timers.shift();
        nowMs = t.at;
        if (!t.cancelled) { try { t.fn(); } catch (e) {} }
      }
      nowMs = target;
      notify();
    }
    function onReal() {
      var r = Date.now();
      var d = r - lastReal;
      lastReal = r;
      advance(d);
    }
    return {
      now: function () { return nowMs; },
      isRunning: function () { return running; },
      play: function () {
        if (running) { return; }
        running = true; lastReal = Date.now();
        realTimer = setInterval(onReal, TICK);
        notify();
      },
      pause: function () {
        if (!running) { return; }
        running = false;
        if (realTimer) { clearInterval(realTimer); realTimer = null; }
        notify();
      },
      step: function (ms) { advance(ms); },
      fastForward: function (ms) { advance(ms); },
      setTimeout: function (fn, ms) {
        var t = { at: nowMs + Math.max(0, ms), fn: fn, cancelled: false };
        timers.push(t);
        return function () { t.cancelled = true; };
      },
      subscribe: function (cb) {
        subs.push(cb);
        return function () { var i = subs.indexOf(cb); if (i >= 0) { subs.splice(i, 1); } };
      }
    };
  })();

  // ---- world-simulator event bus — plan.md Phase 3 ------------------------
  var events = (function () {
    var topics = {};
    return {
      subscribe: function (topic, cb) {
        (topics[topic] || (topics[topic] = [])).push(cb);
        return function () {
          var a = topics[topic]; if (!a) { return; }
          var i = a.indexOf(cb); if (i >= 0) { a.splice(i, 1); }
        };
      },
      publish: function (topic, payload) {
        var a = topics[topic]; if (!a) { return; }
        var list = a.slice();
        for (var i = 0; i < list.length; i++) { try { list[i](payload); } catch (e) {} }
      }
    };
  })();

  // ---- fake entity store — plan.md Phase 2 (hand-written, in-memory) -------
  // Seeded + reset()-able. Persistence (IndexedDB) is deferred to Phase 1/2;
  // reset() stays in the surface because reset-to-seed is a contract concern.
  var db = (function () {
    var seedFn = null;
    var store = {};
    var subs = {};
    var idn = 1;
    function genId() { return 'e' + (idn++); }
    function rows(c) {
      var m = store[c] || {};
      return Object.keys(m).map(function (k) { return m[k]; });
    }
    function notify(c) {
      var a = subs[c]; if (!a) { return; }
      var snap = rows(c); var list = a.slice();
      for (var i = 0; i < list.length; i++) { try { list[i](snap); } catch (e) {} }
    }
    function matchWhere(row, where) {
      if (!where) { return true; }
      for (var k in where) { if (row[k] !== where[k]) { return false; } }
      return true;
    }
    var api = {
      create: function (c, data) {
        var id = (data && data.id) ? data.id : genId();
        var ent = Object.assign({}, data, { id: id });
        (store[c] || (store[c] = {}))[id] = ent;
        notify(c);
        return ent;
      },
      update: function (c, id, patch) {
        var m = store[c] || (store[c] = {});
        var cur = m[id] || { id: id };
        var ent = Object.assign({}, cur, patch, { id: id });
        m[id] = ent;
        notify(c);
        return ent;
      },
      delete: function (c, id) {
        var m = store[c]; if (m) { delete m[id]; notify(c); }
      },
      get: function (c, id) { var m = store[c]; return m ? m[id] : undefined; },
      query: function (c, args) {
        args = args || {};
        var out = rows(c).filter(function (r) { return matchWhere(r, args.where); });
        if (args.order) {
          var f = args.order.field, dir = args.order.dir === 'desc' ? -1 : 1;
          out.sort(function (a, b) {
            if (a[f] < b[f]) { return -1 * dir; }
            if (a[f] > b[f]) { return 1 * dir; }
            return 0;
          });
        }
        if (typeof args.limit === 'number') { out = out.slice(0, args.limit); }
        return out;
      },
      subscribe: function (c, cb) {
        (subs[c] || (subs[c] = [])).push(cb);
        cb(rows(c));
        return function () {
          var a = subs[c]; if (!a) { return; }
          var i = a.indexOf(cb); if (i >= 0) { a.splice(i, 1); }
        };
      },
      reset: function () {
        store = {}; idn = 1;
        if (seedFn) { seedFn(api); }
        for (var c in subs) { notify(c); }
      },
      // Spike-only: register a seed fn and run it once now. Not part of the
      // prototype-facing contract — it is how an app installs its starter data.
      __seed: function (fn) { seedFn = fn; if (seedFn) { seedFn(api); } }
    };
    return api;
  })();

  // ---- simulation log — notes.md §5 ---------------------------------------
  var log = (function () {
    var entries = [];
    var subs = [];
    function emit(level, msg, data) {
      var e = { t: clock.now(), level: level, msg: msg, data: data };
      entries.push(e);
      var list = subs.slice();
      for (var i = 0; i < list.length; i++) { try { list[i](entries.slice()); } catch (err) {} }
    }
    function fn(level, msg, data) { emit(level, msg, data); }
    fn.debug = function (m, d) { emit('debug', m, d); };
    fn.info = function (m, d) { emit('info', m, d); };
    fn.warn = function (m, d) { emit('warn', m, d); };
    fn.error = function (m, d) { emit('error', m, d); };
    fn.entries = function () { return entries.slice(); };
    fn.subscribe = function (cb) {
      subs.push(cb);
      return function () { var i = subs.indexOf(cb); if (i >= 0) { subs.splice(i, 1); } };
    };
    return fn;
  })();

  // ---- actor primitive — plan.md Phase 3 / notes.md §12 -------------------
  // A seeded, clock-driven process that publishes onto a topic over time. This
  // is the hand-written precursor to "one configurable simulator engine".
  function spawn(config) {
    var running = false, n = 0, cancel = null;
    function schedule() {
      if (!running) { return; }
      if (typeof config.count === 'number' && n >= config.count) { running = false; return; }
      var base = config.everyMs || 1000;
      var jitter = config.jitterMs ? random.int(-config.jitterMs, config.jitterMs) : 0;
      var delay = Math.max(0, base + jitter);
      cancel = clock.setTimeout(function () {
        if (!running) { return; }
        var payload = config.produce ? config.produce(n) : null;
        n++;
        events.publish(config.topic, payload);
        schedule();
      }, delay);
    }
    return {
      start: function () { if (running) { return; } running = true; schedule(); },
      stop: function () { running = false; if (cancel) { cancel(); } },
      isRunning: function () { return running; }
    };
  }

  return { db: db, events: events, clock: clock, random: random, log: log, spawn: spawn };
})();
`;
