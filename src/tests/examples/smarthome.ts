// IoT smart-home controller (#8 from example-apps.md).
//
// Purpose: exercise the new async actor model with multiple concurrent world
// processes — each device is an independent actor with its own state. The UI
// sends commands via events.publish; actors are the only things that write
// device state back to db. Demonstrates:
//   - Stateful actors (thermostat tracks mode + current/target temps)
//   - Timer-based ticks (thermostat drifts temperature each simulated second)
//   - Reactive actors (lights and lock respond to command events)
//   - clock.setTimeout from inside an actor (lock engages with a 2s delay)
//   - Multiple concurrent actors running independently
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const smarthome = {
  name: "Smart home (IoT actor example)",
  description:
    "IoT controller with multiple concurrent actors — thermostat, lights, and a lock. The UI commands; actors own all device state.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, events = R.events, clock = R.clock, log = R.log;

    // Seed: one row per device; actors will keep these rows up to date.
    db.define({
      devices: {
        fields: {
          type: { type: 'enum', values: ['thermostat', 'light', 'lock'] },
          label: 'string',
          on: 'boolean',
          locked: 'boolean',
          pending: 'boolean',
          temperature: 'number',
          target: 'number',
          mode: { type: 'enum', values: ['idle', 'heating', 'cooling'] },
        },
        seed: [
          { id: 'thermostat',    type: 'thermostat', label: 'Thermostat',   temperature: 68, target: 70, mode: 'idle' },
          { id: 'light-living',  type: 'light',      label: 'Living room',  on: false },
          { id: 'light-bedroom', type: 'light',      label: 'Bedroom',      on: false },
          { id: 'light-kitchen', type: 'light',      label: 'Kitchen',      on: false },
          { id: 'lock-front',    type: 'lock',       label: 'Front door',   locked: true, pending: false },
        ],
      },
    });
    log.info('devices seeded');

    // --- Thermostat actor ---------------------------------------------------
    // Ticks every 1s of sim time. If heating/cooling, nudges temperature toward
    // target by 0.5°; switches to idle when it arrives. Reacts to set-target
    // commands to change the target and start heating or cooling.
    const thermostatActor = R.actor({
      state: { temperature: 68, target: 70, mode: 'idle' },
      everyMs: 1000,
      tick: async function (ctx) {
        const { temperature, target, mode } = ctx.state;
        if (mode === 'idle') return;
        const delta = mode === 'heating' ? 0.5 : -0.5;
        const next = Math.round((temperature + delta) * 10) / 10;
        const arrived = mode === 'heating' ? next >= target : next <= target;
        const newMode = arrived ? 'idle' : mode;
        ctx.set({ temperature: next, mode: newMode });
        ctx.db.update('devices', 'thermostat', { temperature: next, mode: newMode });
        if (arrived) ctx.log.info('thermostat reached target', target + '°F');
      },
      on: {
        'device:set-target': async function (payload, ctx) {
          const newTarget = payload.target;
          const current = ctx.state.temperature;
          const newMode = newTarget > current ? 'heating' : newTarget < current ? 'cooling' : 'idle';
          ctx.set({ target: newTarget, mode: newMode });
          ctx.db.update('devices', 'thermostat', { target: newTarget, mode: newMode });
          ctx.log.info('thermostat target set', newTarget + '°F → ' + newMode);
        },
      },
    });

    // --- Light actors -------------------------------------------------------
    // Purely reactive — no tick. Each responds to 'device:toggle' events
    // addressed to its id and flips the 'on' field in db.
    function makeLightActor(id) {
      return R.actor({
        state: { on: false },
        on: {
          'device:toggle': async function (payload, ctx) {
            if (payload.id !== id) return;
            const next = !ctx.state.on;
            ctx.set({ on: next });
            ctx.db.update('devices', id, { on: next });
            ctx.log.info(id + (next ? ' on' : ' off'));
          },
        },
      });
    }
    const lightActors = [
      makeLightActor('light-living'),
      makeLightActor('light-bedroom'),
      makeLightActor('light-kitchen'),
    ];

    // --- Lock actor ---------------------------------------------------------
    // Reactive to 'device:toggle'. Unlock is instant; re-locking is delayed by
    // 2s of simulated time (the actor uses ctx.clock.setTimeout internally).
    const lockActor = R.actor({
      state: { locked: true, pending: false },
      on: {
        'device:toggle': async function (payload, ctx) {
          if (payload.id !== 'lock-front') return;
          if (ctx.state.pending) return; // ignore while a lock operation is in progress
          if (ctx.state.locked) {
            // Unlock immediately
            ctx.set({ locked: false });
            ctx.db.update('devices', 'lock-front', { locked: false, pending: false });
            ctx.log.info('front door unlocked');
          } else {
            // Engage lock after a 2s delay (simulated)
            ctx.set({ pending: true });
            ctx.db.update('devices', 'lock-front', { pending: true });
            ctx.log.info('front door locking...');
            ctx.clock.setTimeout(function () {
              ctx.set({ locked: true, pending: false });
              ctx.db.update('devices', 'lock-front', { locked: true, pending: false });
              ctx.log.info('front door locked');
            }, 2000);
          }
        },
      },
    });

    // --- UI -----------------------------------------------------------------
    function useDevices() {
      const read = function () { return db.query('devices'); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe('devices', function () { setRows(read()); }); }, []);
      return rows;
    }
    function SmartHome() {
      const devices = useDevices();
      const [targetInput, setTargetInput] = useState('70');

      useEffect(function () {
        // Start all actors. Clock starts paused — user presses Play to run sim.
        thermostatActor.start();
        lightActors.forEach(function (a) { a.start(); });
        lockActor.start();
        clock.play();
        return function () {
          thermostatActor.stop();
          lightActors.forEach(function (a) { a.stop(); });
          lockActor.stop();
        };
      }, []);

      const byId = {};
      devices.forEach(function (d) { byId[d.id] = d; });
      const therm = byId['thermostat'] || {};
      const lights = ['light-living', 'light-bedroom', 'light-kitchen'].map(function (id) { return byId[id] || {}; });
      const lock = byId['lock-front'] || {};

      const page = { maxWidth: 760, margin: '32px auto', padding: '0 20px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const card = { border: '1px solid #ececec', borderRadius: 12, padding: 16, background: '#fff', marginBottom: 14 };
      const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 };
      const label = { fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 };
      const btn = function (active, danger) {
        return { padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
          background: danger ? (active ? '#fee2e2' : '#fafafa') : (active ? '#111' : '#f3f4f6'),
          color: danger ? (active ? '#b91c1c' : '#6b7280') : (active ? '#fff' : '#374151') };
      };
      const modeColor = { idle: '#9ca3af', heating: '#b45309', cooling: '#2563eb' };

      return h('div', { style: page },
        h('h1', { style: { fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 20 } }, 'Home'),

        // Thermostat
        h('div', { style: card },
          h('div', { style: label }, 'Thermostat'),
          h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 10, marginBottom: 14 } },
            h('div', null,
              h('div', { style: { fontSize: 11, color: '#9ca3af' } }, 'current'),
              h('div', { style: { fontSize: 32, fontWeight: 700, lineHeight: 1 } }, (therm.temperature || 0).toFixed(1) + '°'),
            ),
            h('div', null,
              h('div', { style: { fontSize: 11, color: '#9ca3af' } }, 'target'),
              h('div', { style: { fontSize: 32, fontWeight: 700, lineHeight: 1, color: '#6b7280' } }, (therm.target || 0) + '°'),
            ),
            h('div', { style: { marginLeft: 8 } },
              h('div', { style: { fontSize: 11, color: '#9ca3af' } }, 'mode'),
              h('div', { style: { fontSize: 15, fontWeight: 600, color: modeColor[therm.mode] || '#9ca3af' } }, therm.mode || '—'),
            ),
          ),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', { type: 'number', value: targetInput, min: 60, max: 85,
              style: { width: 70, padding: '7px 10px', borderRadius: 8, border: '1px solid #d4d4d4', fontSize: 14 },
              onChange: function (e) { setTargetInput(e.target.value); } }),
            h('span', { style: { fontSize: 13, color: '#9ca3af' } }, '°F'),
            h('button', { style: btn(false, false), onClick: function () {
              const t = parseFloat(targetInput);
              if (!isNaN(t)) events.publish('device:set-target', { target: t });
            }}, 'Set target'),
          ),
        ),

        // Lights
        h('div', { style: card },
          h('div', { style: label }, 'Lights'),
          h('div', { style: { marginTop: 10 } },
            lights.map(function (light) {
              return h('div', { key: light.id, style: Object.assign({}, row, { marginBottom: 8 }) },
                h('span', { style: { fontSize: 14 } }, light.label),
                h('button', { style: btn(!!light.on, false),
                  onClick: function () { events.publish('device:toggle', { id: light.id }); } },
                  light.on ? 'On' : 'Off'),
              );
            }),
          ),
        ),

        // Lock
        h('div', { style: card },
          h('div', { style: label }, 'Front door'),
          h('div', { style: Object.assign({}, row, { marginTop: 10, marginBottom: 0 }) },
            h('span', { style: { fontSize: 14 } },
              lock.pending ? '⏳ locking…' : lock.locked ? '🔒 Locked' : '🔓 Unlocked'),
            h('button', { style: btn(false, !lock.locked && !lock.pending),
              disabled: !!lock.pending,
              onClick: function () { events.publish('device:toggle', { id: 'lock-front' }); } },
              lock.pending ? 'Wait…' : lock.locked ? 'Unlock' : 'Lock'),
          ),
        ),

      );
    }

    window.App = SmartHome;
  `,
};
