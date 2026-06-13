// Radix runtime — the browser-JS implementation of the type surface in
// ./types/. Authored as a source string because it has to run inside the
// cross-origin, sandbox="allow-scripts" iframe alongside the prototype (it cannot
// be imported from node_modules at runtime — same reason `wrapReactApp` inlines
// its source). `wrapPrototype` (./packaging.ts) concatenates this BEFORE the
// prototype's component source, so by the time the component runs, `window.radix`
// exists.
//
// Deliberately small and hand-written: one entity store (an in-memory working set
// persisted through to IndexedDB), one event bus, one steppable clock, a seeded
// PRNG, a log, the external-service stubs, and the actor primitive. Style is
// ES5-ish on purpose to keep the inlined source robust across iframe targets.

export const runtimeSource = /* js */ `
window.radix = (function () {
  // ---- seeded randomness (mulberry32) -------------------------------------
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

  // ---- simulated clock ----------------------------------------------------
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
    var frameSubs = [];
    var rafId = null;
    var TICK = 100;
    function notify() {
      var list = subs.slice();
      for (var i = 0; i < list.length; i++) { try { list[i](nowMs, running); } catch (e) {} }
    }
    // Timers are kept sorted by fire time on insert, so advance() never has to
    // re-sort — it just shifts off the front while the head is due. A callback
    // may schedule more timers as it runs; those are inserted in order, so the
    // head stays correct without another full sort (this is what kept the old
    // sort-every-iteration loop from scaling to hundreds of timers).
    function insertTimer(t) {
      var lo = 0, hi = timers.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (timers[mid].at <= t.at) { lo = mid + 1; } else { hi = mid; }
      }
      timers.splice(lo, 0, t);
    }
    function advance(ms) {
      if (ms <= 0) { return; }
      var target = nowMs + ms;
      while (timers.length && timers[0].at <= target) {
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
    // Exactly one real-time driver runs while playing. With onFrame subscribers a
    // requestAnimationFrame loop drives the clock (smooth, per-frame); otherwise a
    // coarse 100ms interval is enough for actors. We never run both at once.
    function syncDrivers() {
      if (!running || frameSubs.length) {
        if (realTimer) { clearInterval(realTimer); realTimer = null; }
      } else if (!realTimer) {
        lastReal = Date.now();
        realTimer = setInterval(onReal, TICK);
      }
      if (running && frameSubs.length) { frameLoop(); }
    }
    function frameLoop() {
      if (rafId !== null || !running || !frameSubs.length) { return; }
      if (typeof requestAnimationFrame !== 'function') { return; }
      rafId = requestAnimationFrame(function () {
        rafId = null;
        if (!running || !frameSubs.length) { return; }
        onReal();
        var list = frameSubs.slice();
        for (var i = 0; i < list.length; i++) { try { list[i](nowMs); } catch (e) {} }
        frameLoop();
      });
    }
    return {
      now: function () { return nowMs; },
      isRunning: function () { return running; },
      play: function () {
        if (running) { return; }
        running = true; lastReal = Date.now();
        notify();
        syncDrivers();
      },
      pause: function () {
        if (!running) { return; }
        running = false;
        syncDrivers();
        notify();
      },
      step: function (ms) { advance(ms); },
      fastForward: function (ms) { advance(ms); },
      setTimeout: function (fn, ms) {
        var t = { at: nowMs + Math.max(0, ms), fn: fn, cancelled: false };
        insertTimer(t);
        return function () { t.cancelled = true; };
      },
      subscribe: function (cb) {
        subs.push(cb);
        return function () { var i = subs.indexOf(cb); if (i >= 0) { subs.splice(i, 1); } };
      },
      // Per-animation-frame callback while the clock is playing: cb(simNow).
      // For render loops — game logic should still use setTimeout at a fixed
      // simulated timestep so pause/step/fastForward replay deterministically.
      onFrame: function (cb) {
        frameSubs.push(cb);
        syncDrivers();
        return function () {
          var i = frameSubs.indexOf(cb); if (i >= 0) { frameSubs.splice(i, 1); }
          syncDrivers();
        };
      }
    };
  })();

  // ---- world-simulator event bus ------------------------------------------
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

  // ---- entity store --------------------------------------------------------
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
    var _schema = {};        // { collName: { fields: {fieldName: {type,...}}, strict: bool } }
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
      for (var k in where) {
        var cond = where[k];
        if (cond && typeof cond === 'object' && Array.isArray(cond.in)) {
          if (cond.in.indexOf(row[k]) < 0) { return false; }
        } else if (row[k] !== cond) { return false; }
      }
      return true;
    }
    // Write-through is coalesced: a mutation only marks its collection dirty and
    // schedules one flush on the next macrotask. A synchronous burst of writes
    // (e.g. seeding or importing N rows) then costs one save per touched
    // collection instead of N full-collection serializations. Uses the real
    // setTimeout — the store runs outside the prototype's clock-shimmed scope.
    var dirty = {};
    var flushScheduled = false;
    function flushDirty() {
      flushScheduled = false;
      if (!persistOn) { dirty = {}; return; }
      var pending = dirty; dirty = {};
      for (var c in pending) {
        try { idb.save(c, rows(c), idn).catch(function () {}); } catch (e) {}
      }
    }
    function persist(c) {
      if (!persistOn || suspend) { return; }
      dirty[c] = true;
      if (!flushScheduled) { flushScheduled = true; setTimeout(flushDirty, 0); }
    }
    function persistAll() {
      if (!persistOn) { return; }
      for (var c in store) { try { idb.save(c, rows(c), idn).catch(function () {}); } catch (e) {} }
    }
    function normalizeField(f) {
      return (typeof f === 'string') ? { type: f } : f;
    }
    function applyDefaults(c, data) {
      var cs = _schema[c]; if (!cs) { return data; }
      var out = Object.assign({}, data);
      for (var f in cs.fields) {
        if (out[f] === undefined && cs.fields[f].default !== undefined) {
          out[f] = cs.fields[f].default;
        }
      }
      return out;
    }
    function validateData(c, data, ctx) {
      var cs = _schema[c]; if (!cs) { return; }
      var fields = cs.fields;
      for (var f in fields) {
        var fd = fields[f];
        var val = data[f];
        if (val === undefined || val === null) {
          if (fd.required && ctx === 'create') {
            var msg = 'db.' + ctx + '(' + c + '): required field "' + f + '" is missing';
            if (cs.strict) { throw new Error(msg); } else { log.warn(msg); }
          }
          continue;
        }
        var ok = true; var reason = '';
        if (fd.type === 'string')  { ok = typeof val === 'string';  reason = 'expected string'; }
        else if (fd.type === 'number')  { ok = typeof val === 'number';  reason = 'expected number'; }
        else if (fd.type === 'boolean') { ok = typeof val === 'boolean'; reason = 'expected boolean'; }
        else if (fd.type === 'enum')    { ok = fd.values && fd.values.indexOf(val) >= 0; reason = 'expected one of ' + (fd.values || []).join('|'); }
        if (!ok) {
          var wmsg = 'db.' + ctx + '(' + c + '): field "' + f + '" invalid (' + reason + ', got ' + typeof val + ' ' + JSON.stringify(val) + ')';
          if (cs.strict) { throw new Error(wmsg); } else { log.warn(wmsg); }
        }
      }
    }
    // Append-only collections: rows can be created, never changed or removed.
    // Returns false when the write must be refused. Seed/reset replay runs
    // suspended, and reset clears whole collections rather than deleting rows
    // one-by-one, so immutability only constrains the app's own calls.
    function blockIfImmutable(c, ctx) {
      var cs = _schema[c];
      if (!cs || !cs.immutable || suspend) { return true; }
      var msg = 'db.' + ctx + '(' + c + '): collection is immutable (append-only)';
      if (cs.strict) { throw new Error(msg); }
      log.warn(msg);
      return false;
    }
    // Surface typo'd collection names. Once any schema is declared we assume the
    // app is schema-driven, so a call against an undeclared collection is almost
    // always a typo. Warn once per name (never throw — schemaless collections are
    // still allowed for apps that never call define()).
    var _warnedColl = {};
    function checkKnownCollection(c, op) {
      if (_schema[c]) { return; }
      if (!Object.keys(_schema).length) { return; }   // schemaless app — stay quiet
      if (_warnedColl[c]) { return; }
      _warnedColl[c] = true;
      log.warn('db.' + op + ': collection "' + c + '" was never declared with db.define()');
    }
    // Surface typo'd field names in query where/order against a declared schema.
    function validateQueryFields(c, args) {
      var cs = _schema[c];
      if (!cs || !cs.fields) { return; }
      function checkField(f, place) {
        if (f === 'id' || cs.fields[f]) { return; }
        var msg = 'db.query(' + c + '): unknown field "' + f + '" in ' + place;
        if (cs.strict) { throw new Error(msg); }
        log.warn(msg);
      }
      if (args.where) { for (var k in args.where) { checkField(k, 'where'); } }
      if (args.order && args.order.field) { checkField(args.order.field, 'order'); }
    }
    var api = {
      create: function (c, data) {
        checkKnownCollection(c, 'create');
        var d = applyDefaults(c, data);
        var id;
        if (d && d.id) { id = d.id; }
        else {
          // skip generated ids already taken by explicit seed ids (e.g. 'e1')
          do { id = genId(); } while (store[c] && store[c][id]);
        }
        var ent = Object.assign({}, d, { id: id });
        validateData(c, ent, 'create');
        (store[c] || (store[c] = {}))[id] = ent;
        if (!suspend) { touched = true; }
        notify(c); persist(c);
        return ent;
      },
      update: function (c, id, patch) {
        checkKnownCollection(c, 'update');
        if (!blockIfImmutable(c, 'update')) { return undefined; }
        var m = store[c] || (store[c] = {});
        var cur = m[id];
        // Don't fabricate rows: updating an id that doesn't exist is a bug, not
        // an upsert. Throw in strict mode, warn-and-skip otherwise.
        if (cur === undefined && !suspend) {
          var cs = _schema[c];
          var miss = 'db.update(' + c + '): no row with id "' + id + '"';
          if (cs && cs.strict) { throw new Error(miss); }
          log.warn(miss);
          return undefined;
        }
        validateData(c, patch, 'update');
        var ent = Object.assign({}, cur || { id: id }, patch, { id: id });
        m[id] = ent;
        if (!suspend) { touched = true; }
        notify(c); persist(c);
        return ent;
      },
      delete: function (c, id) {
        checkKnownCollection(c, 'delete');
        if (!blockIfImmutable(c, 'delete')) { return; }
        var m = store[c];
        if (m) { delete m[id]; if (!suspend) { touched = true; } notify(c); persist(c); }
      },
      get: function (c, id) { checkKnownCollection(c, 'get'); var m = store[c]; return m ? m[id] : undefined; },
      query: function (c, args) {
        checkKnownCollection(c, 'query');
        args = args || {};
        validateQueryFields(c, args);
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
              var fk = r[rel.on];
              var target = col[fk];
              // A present FK that resolves to nothing is a broken relation —
              // surface it instead of silently embedding undefined.
              if (target === undefined && fk !== undefined && fk !== null) {
                log.warn('db.query(' + c + '): include "' + key + '" found no ' + rel.from + ' row for ' + rel.on + '=' + JSON.stringify(fk));
              }
              ext[key] = target;
            }
            return ext;
          });
        }
        return out;
      },
      subscribe: function (c, cb) {
        checkKnownCollection(c, 'subscribe');
        (subs[c] || (subs[c] = [])).push(cb);
        // Fire immediately with current rows. Guard like notify() does, so a
        // throwing subscriber can't break the subscribe() call itself.
        try { cb(rows(c)); } catch (e) {}
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
      define: function (schemaDef, opts) {
        var strict = !!(opts && opts.strict);
        suspend = true;
        for (var collName in schemaDef) {
          var collDef = schemaDef[collName];
          var fields = {};
          var rawFields = collDef.fields || {};
          for (var f in rawFields) { fields[f] = normalizeField(rawFields[f]); }
          _schema[collName] = { fields: fields, strict: strict, immutable: !!collDef.immutable };
          var seedRows = collDef.seed || [];
          for (var i = 0; i < seedRows.length; i++) { api.create(collName, seedRows[i]); }
        }
        suspend = false;
        seedFn = function (a) {
          for (var collName in schemaDef) {
            var collDef = schemaDef[collName];
            var seedRows = collDef.seed || [];
            for (var i = 0; i < seedRows.length; i++) { a.create(collName, seedRows[i]); }
          }
        };
      },
      schema: function () { return _schema; },
      // Legacy: register an imperative seed function. Still works for backwards
      // compat but db.define() is preferred.
      __seed: function (fn) {
        seedFn = fn;
        suspend = true;
        if (seedFn) { seedFn(api); }
        suspend = false;
      },
      dump: function () {
        var out = {};
        for (var c in store) { out[c] = rows(c); }
        return out;
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

  // ---- simulation log ------------------------------------------------------
  var log = (function () {
    var MAX = 2000;          // ring-buffer cap: a runaway logger can't grow forever
    var entries = [];
    var subs = [];
    function emit(level, msg, data) {
      var e = { t: clock.now(), level: level, msg: msg, data: data };
      entries.push(e);
      if (entries.length > MAX) { entries.splice(0, entries.length - MAX); }
      var snap = entries.slice();
      var list = subs.slice();
      for (var i = 0; i < list.length; i++) { try { list[i](snap); } catch (err) {} }
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

  // ---- external service stubs ---------------------------------------------
  // Simulated external APIs (email, payment, SMS). Delays route through the
  // simulated clock so they honour pause/step/fastForward. Exposed as
  // window.radix.services and on actor ctx.
  var services = (function () {
    function simDelay(ms) {
      return new Promise(function (resolve) { clock.setTimeout(resolve, ms); });
    }
    return {
      email: {
        send: function (opts) {
          log.info('email to ' + opts.to + ': "' + opts.subject + '"');
          return simDelay(300 + random.int(0, 300));
        },
      },
      payment: {
        charge: function (opts) {
          return simDelay(500 + random.int(0, 300)).then(function () {
            if (random.random() < 0.05) { throw new Error('card declined'); }
            return { transactionId: 'txn-' + random.int(10000, 99999), amount: opts.amount };
          });
        },
      },
      sms: {
        send: function (opts) {
          log.info('sms to ' + opts.to + ': "' + opts.message + '"');
          return simDelay(200 + random.int(0, 200));
        },
      },
    };
  })();

  // ---- world actor — stateful, async-capable, reactive world processes -----
  // Each actor has its own private state, access to the full runtime via a ctx
  // object, an optional timer-based tick, and optional reactive event handlers.
  // Handlers may be sync or async — the runtime duck-types the return value.
  function actor(config) {
    var state = Object.assign({}, config.state || {});
    var running = false;
    var tickCancel = null;
    var unsubs = [];

    var ctx = {
      get state() { return state; },
      set: function (patch) { state = Object.assign({}, state, patch); },
      db: db,
      events: events,
      random: random,
      clock: clock,
      log: log,
      services: services,
    };

    function maybeAsync(result) {
      return (result && typeof result.then === 'function') ? result : Promise.resolve(result);
    }

    function scheduleTick() {
      if (!running || !config.tick) { return; }
      var base = config.everyMs || 1000;
      var jitter = config.jitterMs ? random.int(-config.jitterMs, config.jitterMs) : 0;
      var delay = Math.max(0, base + jitter);
      tickCancel = clock.setTimeout(function () {
        if (!running) { return; }
        maybeAsync(config.tick(ctx))
          .catch(function (e) { log.error('actor tick error', e && e.message); })
          .then(function () { scheduleTick(); });
      }, delay);
    }

    return {
      start: function () {
        if (running) { return; }
        running = true;
        if (config.on) {
          Object.keys(config.on).forEach(function (topic) {
            var handler = config.on[topic];
            unsubs.push(events.subscribe(topic, function (payload) {
              if (!running) { return; }
              maybeAsync(handler(payload, ctx))
                .catch(function (e) { log.error('actor event error', e && e.message); });
            }));
          });
        }
        if (config.start) {
          maybeAsync(config.start(ctx))
            .catch(function (e) { log.error('actor start error', e && e.message); });
        }
        scheduleTick();
      },
      stop: function () {
        running = false;
        if (tickCancel) { tickCancel(); tickCancel = null; }
        unsubs.forEach(function (u) { u(); });
        unsubs = [];
      },
      isRunning: function () { return running; }
    };
  }

  // ---- stub — the graceful-degradation hook --------------------------------
  // A first-class way for a prototype to declare "this part is faked or
  // partial, and here is what is missing". Declarations are queryable by the
  // app (to render a what-is-real panel), logged once, and exposed to the
  // shell over the bridge. Honesty about the real-vs-faked boundary is the
  // product's core idea, so it gets an API, not a code comment.
  var stub = (function () {
    var entries = {};
    return {
      declare: function (name, info) {
        info = info || {};
        var first = !entries[name];
        entries[name] = {
          name: name,
          summary: info.summary || '',
          missing: info.missing || [],
          fidelity: info.fidelity || 'faked'  // 'faked' | 'partial' | 'canned'
        };
        if (first) { log.warn('stub: ' + name + (info.summary ? ' — ' + info.summary : '')); }
        return entries[name];
      },
      list: function () {
        var out = [];
        for (var k in entries) { out.push(entries[k]); }
        return out;
      }
    };
  })();

  // ---- shell message bridge -----------------------------------------------
  // Lets the Radix app shell inspect and control the prototype from outside the
  // iframe via postMessage. The prototype can hold user data, so the bridge is
  // locked down on both directions:
  //   - Inbound: we only accept messages from our *direct parent* window
  //     (e.source === window.parent), and — if packaging pinned an expected
  //     shell origin — only from that origin. This blocks sibling iframes and
  //     unrelated windows from dumping/resetting/driving the prototype.
  //   - Outbound: we never post to '*'. Responses go back to the sender at its
  //     exact origin; unsolicited pushes go to the parent we learned from the
  //     first accepted message (so nothing is broadcast before a handshake).
  // PINNED_ORIGIN is substituted by wrapPrototype; '' means "not pinned, rely on
  // the source === parent check and echo the sender's origin".
  var PINNED_ORIGIN = '__RADIX_SHELL_ORIGIN__';
  var shellWindow = null;   // the parent window we reply to for unsolicited pushes
  var shellOrigin = null;   // the exact origin to target those pushes at
  function accepts(e) {
    if (e.source !== window.parent) { return false; }
    if (PINNED_ORIGIN && e.origin !== PINNED_ORIGIN) { return false; }
    return true;
  }
  function reply(e, msg) {
    try { e.source.postMessage(msg, e.origin); } catch (err) {}
  }
  function pushToShell(msg) {
    if (!shellWindow) { return; }
    try { shellWindow.postMessage(msg, shellOrigin); } catch (err) {}
  }
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data !== 'object') { return; }
    if (!accepts(e)) { return; }
    // Remember who to push to (the first verified parent wins for the session).
    if (!shellWindow) { shellWindow = e.source; shellOrigin = e.origin; }
    if (e.data.type === 'radix:dump') {
      reply(e, { type: 'radix:dump:response', data: db.dump() });
    } else if (e.data.type === 'radix:db:schema') {
      reply(e, { type: 'radix:db:schema:response', schema: db.schema() });
    } else if (e.data.type === 'radix:reset') {
      db.reset();
      reply(e, { type: 'radix:reset:done', data: db.dump() });
    } else if (e.data.type === 'radix:clock:play') {
      clock.play();
    } else if (e.data.type === 'radix:clock:pause') {
      clock.pause();
    } else if (e.data.type === 'radix:clock:step') {
      clock.step(typeof e.data.ms === 'number' ? e.data.ms : 1000);
    } else if (e.data.type === 'radix:clock:get') {
      reply(e, { type: 'radix:clock:state', now: clock.now(), running: clock.isRunning() });
    } else if (e.data.type === 'radix:log:get') {
      reply(e, { type: 'radix:log:entries', entries: log.entries() });
    } else if (e.data.type === 'radix:stubs') {
      reply(e, { type: 'radix:stubs:response', stubs: stub.list() });
    }
  });

  // Push clock and log state to the shell whenever they change. Throttled:
  // with a frame loop active the clock notifies ~60x/sec, which would flood
  // the shell; play/pause transitions always go through immediately. Nothing is
  // sent until the first accepted message tells us who the parent is.
  var lastClockPush = -1, lastClockRunning = null;
  clock.subscribe(function (now, running) {
    if (running === lastClockRunning && lastClockPush >= 0 && now - lastClockPush < 100) { return; }
    lastClockPush = now; lastClockRunning = running;
    pushToShell({ type: 'radix:clock:state', now: now, running: running });
  });
  // Log lines can arrive in tight bursts (a chatty actor, a tick loop). Coalesce
  // them into at most one push per 100ms with a trailing send of the latest
  // entries, and only once we know who the parent is.
  var logPushTimer = null;
  log.subscribe(function () {
    if (logPushTimer || !shellWindow) { return; }
    logPushTimer = setTimeout(function () {
      logPushTimer = null;
      pushToShell({ type: 'radix:log:entries', entries: log.entries() });
    }, 100);
  });

  return { db: db, events: events, clock: clock, random: random, log: log, actor: actor, services: services, stub: stub };
})();
`;
