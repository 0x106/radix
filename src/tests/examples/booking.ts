// Booking / reservation system (#9 from example-apps.md).
// Time-slot grid for a single day. The player books a slot; double-booking is
// prevented by checking availability before writing. A services.email call
// sends a confirmation. Demonstrates:
//   - Constraint satisfaction: slot marked unavailable before service call resolves
//   - services.email called from a user action (not an actor)
//   - Simple list-view of confirmed bookings

export const booking = {
  name: "Booking / reservation",
  description:
    "Book a time slot from a daily grid. Double-booking is prevented; a confirmation email is sent via services on each booking.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log, random = R.random;
    const services = R.services;

    const SLOT_TIMES = [
      '09:00', '10:00', '11:00', '12:00', '13:00',
      '14:00', '15:00', '16:00', '17:00',
    ];

    db.__seed(function (api) {
      SLOT_TIMES.forEach(function (t, i) {
        // Pre-book a couple of slots so the grid isn't empty
        var taken = i === 1 || i === 4;
        api.create('slots', { id: 'slot-' + i, time: t, available: !taken });
        if (taken) {
          api.create('bookings', {
            slotId: 'slot-' + i, time: t,
            name: i === 1 ? 'Alice Johnson' : 'Bob Smith',
            email: i === 1 ? 'alice@example.com' : 'bob@example.com',
            confirmedAt: 0,
          });
        }
      });
      log.info('9 time slots loaded');
    });

    function useSlots() {
      var [rows, setRows] = useState(function () {
        return db.query('slots', { order: { field: 'time', dir: 'asc' } });
      });
      useEffect(function () {
        return db.subscribe('slots', function () {
          setRows(db.query('slots', { order: { field: 'time', dir: 'asc' } }));
        });
      }, []);
      return rows;
    }
    function useBookings() {
      var [rows, setRows] = useState(function () {
        return db.query('bookings', { order: { field: 'confirmedAt', dir: 'asc' } });
      });
      useEffect(function () {
        return db.subscribe('bookings', function () {
          setRows(db.query('bookings', { order: { field: 'confirmedAt', dir: 'asc' } }));
        });
      }, []);
      return rows;
    }
    function useClock() {
      var [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (n, r) { setS({ now: n, running: r }); }); }, []);
      return s;
    }
    function useLog() {
      var [e, setE] = useState(log.entries());
      useEffect(function () { return log.subscribe(setE); }, []);
      return e;
    }

    function Booking() {
      var slots    = useSlots();
      var bookings = useBookings();
      var cs       = useClock();
      var entries  = useLog();

      var [selected, setSelected] = useState(null); // slot row
      var [name,     setName]     = useState('');
      var [email,    setEmail]    = useState('');
      var [sending,  setSending]  = useState(false);

      useEffect(function () { clock.play(); }, []);

      function book() {
        if (!selected || !name.trim() || !email.trim()) {
          log.warn('fill in all fields');
          return;
        }
        // Claim the slot immediately (optimistic, prevents double-booking)
        db.update('slots', selected.id, { available: false });
        db.create('bookings', {
          slotId: selected.id, time: selected.time,
          name: name.trim(), email: email.trim(),
          confirmedAt: clock.now(),
        });
        log.info('slot ' + selected.time + ' booked for ' + name.trim());
        setSending(true);
        services.email.send({
          to: email.trim(),
          subject: 'Booking confirmed: ' + selected.time,
        }).then(function () {
          log.info('confirmation email sent to ' + email.trim());
          setSending(false);
        });
        setSelected(null); setName(''); setEmail('');
      }

      var S = {
        page:  { maxWidth: 500, margin: '0 auto', padding: '24px 20px',
                 fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111', minHeight: '100vh' },
        card:  { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff', marginBottom: 14 },
        label: { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' },
        input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                 fontSize: 14, boxSizing: 'border-box', marginBottom: 10 },
        pri:   { border: 'none', borderRadius: 8, background: '#111', color: '#fff',
                 padding: '10px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
        cb:    { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
      };

      return h('div', { style: S.page },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0 } }, 'Book a slot'),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
            h('button', { style: S.cb, onClick: function () { clock.fastForward(1000); } }, '+1s'),
          ),
        ),
        // Slot grid
        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 10 } }, 'Today'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            slots.map(function (slot) {
              var isSel = selected && selected.id === slot.id;
              return h('button', { key: slot.id,
                style: {
                  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  cursor: slot.available ? 'pointer' : 'default',
                  border: isSel ? '2px solid #111' : '1px solid #e5e7eb',
                  background: !slot.available ? '#f3f4f6' : isSel ? '#f9fafb' : '#fff',
                  color: !slot.available ? '#9ca3af' : '#111',
                },
                disabled: !slot.available,
                onClick: function () { setSelected(isSel ? null : slot); },
              }, slot.time + (!slot.available ? ' ✕' : ''));
            }),
          ),
        ),
        // Booking form (only when a slot is selected)
        selected && h('div', { style: S.card },
          h('div', { style: { fontWeight: 600, marginBottom: 12 } }, 'Book ' + selected.time),
          h('label', { style: S.label }, 'Name'),
          h('input', { style: S.input, value: name, placeholder: 'Your name',
            onChange: function (e) { setName(e.target.value); } }),
          h('label', { style: S.label }, 'Email'),
          h('input', { style: S.input, type: 'email', value: email, placeholder: 'you@example.com',
            onChange: function (e) { setEmail(e.target.value); } }),
          h('button', { style: Object.assign({}, S.pri, { opacity: sending ? 0.6 : 1 }),
            disabled: sending,
            onClick: book,
          }, sending ? 'Sending confirmation…' : 'Confirm booking'),
        ),
        // Confirmed bookings
        bookings.length > 0 && h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } },
            bookings.length + ' confirmed booking' + (bookings.length !== 1 ? 's' : '')),
          bookings.map(function (b, i) {
            return h('div', { key: b.id, style: { display: 'flex', justifyContent: 'space-between',
                fontSize: 13, padding: '5px 0',
                borderBottom: i < bookings.length - 1 ? '1px solid #f3f4f6' : 'none' } },
              h('span', null, b.time + '  ' + b.name),
              h('span', { style: { color: '#9ca3af', fontSize: 12 } }, b.email),
            );
          }),
        ),
        // Activity
        entries.length > 0 && h('div', { style: { fontSize: 12, color: '#6b7280' } },
          entries.slice().reverse().slice(0, 3).map(function (e, i) {
            return h('div', { key: i }, (e.t / 1000).toFixed(0) + 's  ' + e.msg);
          }),
        ),
      );
    }

    window.App = Booking;
  `,
};
