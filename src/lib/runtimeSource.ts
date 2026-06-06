// Radix runtime shim — PHASE 0 EXAMPLE. THROWAWAY.
//
// This is the browser-JS *implementation* of the contract in ./contract.ts,
// authored as a source string because it has to run inside the cross-origin,
// sandbox="allow-scripts" iframe alongside the prototype (it cannot be imported
// from node_modules at runtime — same reason `wrapReactApp` inlines its source).
// `wrapPrototype` (../htmlTemplate.ts) concatenates this BEFORE the prototype's
// component source, so by the time the component runs, `window.radix` exists.
//
// Intentionally simple and hand-written — a single store (in-memory working set
// persisted through to IndexedDB), a single event bus, a single steppable clock,
// a seeded PRNG, a log, and one actor
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

  // ---- fake entity store — plan.md Phase 2 (hand-written) ------------------
  // The in-memory working set is the synchronous source of truth — the contract
  // is synchronous (query/create return, subscribe fires, immediately). IndexedDB
  // sits underneath as persistence: the store hydrates from it on load and writes
  // through on every mutation, so toggles/adds/deletes survive a reload. reset()
  // wipes persisted state back to the seed (still a contract concern). If
  // IndexedDB is unavailable (iframe lacking allow-same-origin, private mode, …)
  // the store silently degrades to memory-only — the example's old behaviour.
  var db = (function () {
    // IndexedDB adapter: one database per prototype (namespaced by URL path so
    // prototypes that share the storage origin don't collide), one object store
    // keyed by collection name (value = array of rows) plus a meta store holding
    // the id counter.
    var idb = (function () {
      var NAME = 'radix-store::' +
        ((typeof location !== 'undefined' && location.pathname) || '/');
      var COLLS = 'collections';
      var META = 'meta';
      var opening = null;
      function available() {
        try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
        catch (e) { return false; }
      }
      function open() {
        if (opening) { return opening; }
        opening = new Promise(function (resolve, reject) {
          var req;
          try { req = indexedDB.open(NAME, 1); } catch (e) { reject(e); return; }
          req.onupgradeneeded = function () {
            var d = req.result;
            if (!d.objectStoreNames.contains(COLLS)) { d.createObjectStore(COLLS); }
            if (!d.objectStoreNames.contains(META)) { d.createObjectStore(META); }
          };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
        return opening;
      }
      return {
        available: available,
        loadAll: function () {
          return open().then(function (d) {
            return new Promise(function (resolve, reject) {
              var tx = d.transaction([COLLS, META], 'readonly');
              var cs = tx.objectStore(COLLS);
              var out = { collections: {}, idn: null };
              var ksReq = cs.getAllKeys();
              var vsReq = cs.getAll();
              vsReq.onsuccess = function () {
                var ks = ksReq.result || [], vs = vsReq.result || [];
                for (var i = 0; i < ks.length; i++) { out.collections[ks[i]] = vs[i]; }
              };
              var idReq = tx.objectStore(META).get('idn');
              idReq.onsuccess = function () {
                if (typeof idReq.result === 'number') { out.idn = idReq.result; }
              };
              tx.oncomplete = function () { resolve(out); };
              tx.onerror = function () { reject(tx.error); };
            });
          });
        },
        save: function (name, rows, nextId) {
          return open().then(function (d) {
            return new Promise(function (resolve, reject) {
              var tx = d.transaction([COLLS, META], 'readwrite');
              tx.objectStore(COLLS).put(rows, name);
              if (typeof nextId === 'number') { tx.objectStore(META).put(nextId, 'idn'); }
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { reject(tx.error); };
            });
          });
        },
        clear: function () {
          return open().then(function (d) {
            return new Promise(function (resolve, reject) {
              var tx = d.transaction([COLLS, META], 'readwrite');
              tx.objectStore(COLLS).clear();
              tx.objectStore(META).clear();
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { reject(tx.error); };
            });
          });
        }
      };
    })();

    var seedFn = null;
    var store = {};
    var subs = {};
    var idn = 1;
    var persistOn = false;   // IndexedDB confirmed usable (set once hydrate runs)
    var suspend = false;     // batch guard: skip write-through during seed/reset
    var touched = false;     // a real (non-seed) mutation happened — see hydrate
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
    function persist(c) {
      if (!persistOn || suspend) { return; }
      try { idb.save(c, rows(c), idn).catch(function () {}); } catch (e) {}
    }
    function persistAll() {
      if (!persistOn) { return; }
      for (var c in store) { persist(c); }
    }
    var api = {
      create: function (c, data) {
        var id = (data && data.id) ? data.id : genId();
        var ent = Object.assign({}, data, { id: id });
        (store[c] || (store[c] = {}))[id] = ent;
        if (!suspend) { touched = true; }
        notify(c); persist(c);
        return ent;
      },
      update: function (c, id, patch) {
        var m = store[c] || (store[c] = {});
        var cur = m[id] || { id: id };
        var ent = Object.assign({}, cur, patch, { id: id });
        m[id] = ent;
        if (!suspend) { touched = true; }
        notify(c); persist(c);
        return ent;
      },
      delete: function (c, id) {
        var m = store[c];
        if (m) { delete m[id]; if (!suspend) { touched = true; } notify(c); persist(c); }
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
        if (args.include) {
          out = out.map(function (r) {
            var ext = Object.assign({}, r);
            for (var key in args.include) {
              var rel = args.include[key];
              var col = store[rel.from] || {};
              ext[key] = col[r[rel.on]];
            }
            return ext;
          });
        }
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
        touched = true;            // a reset must not be clobbered by hydrate
        suspend = true;
        store = {}; idn = 1;
        if (seedFn) { seedFn(api); }
        suspend = false;
        for (var c in subs) { notify(c); }
        if (persistOn) {
          try { idb.clear().then(persistAll).catch(function () {}); } catch (e) {}
        }
      },
      // Example-only: register a seed fn and run it once now (synchronously, so the
      // first render has data). Not part of the prototype-facing contract — it is
      // how an app installs its starter data. Persistence is decided by hydrate():
      // any persisted rows win over this seed.
      __seed: function (fn) {
        seedFn = fn;
        suspend = true;
        if (seedFn) { seedFn(api); }
        suspend = false;
      }
    };
    // Hydrate from IndexedDB once, asynchronously. Runs in parallel with the
    // synchronous seed above; this callback reconciles the two: if persisted rows
    // exist and the user hasn't mutated yet, they replace the seed; otherwise we
    // persist whatever is currently in memory (first run, or post-mutation).
    (function hydrate() {
      if (!idb.available()) { return; }
      idb.loadAll().then(function (data) {
        persistOn = true;
        var colls = data.collections || {};
        var keys = Object.keys(colls);
        var hasPersisted = keys.some(function (k) { return colls[k] && colls[k].length; });
        if (hasPersisted && !touched) {
          store = {};
          keys.forEach(function (k) {
            var arr = colls[k] || [], m = store[k] = {};
            arr.forEach(function (r) { if (r && r.id != null) { m[r.id] = r; } });
          });
          if (typeof data.idn === 'number') { idn = data.idn; }
          var seen = {};
          keys.concat(Object.keys(subs)).forEach(function (c) {
            if (!seen[c]) { seen[c] = 1; notify(c); }
          });
        } else {
          persistAll();
        }
      }).catch(function () { persistOn = false; });
    })();
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
