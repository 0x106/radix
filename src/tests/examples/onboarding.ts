// Multi-step onboarding / KYC flow (#18 from example-apps.md).
// A four-step wizard: personal info → document upload → under review → decision.
// An approval actor processes after submission; services.email sends confirmation.
// Demonstrates:
//   - Multi-step form with saved partial progress in db
//   - Async approval actor with simulated review delay
//   - services.email called from within an actor handler

export const onboarding = {
  name: "Onboarding / KYC flow",
  description:
    "Multi-step identity verification. Submit your details, upload a document, then wait for an approval actor to review — with confirmation email via services.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, events = R.events, clock = R.clock, log = R.log, random = R.random;
    const services = R.services;

    const STEPS = ['info', 'document', 'review', 'decision'];

    db.__seed(function (api) {
      api.create('application', {
        id: 'app',
        step: 'info',
        firstName: '', lastName: '', email: '', dob: '',
        docType: '', docUploaded: false,
        status: 'draft',   // draft | submitted | approved | rejected
        reviewNote: '',
      });
      log.info('KYC application ready');
    });

    // Approval actor: triggered when application is submitted.
    // Runs a simulated review (15-25 s of sim time) then approves or rejects.
    const approvalActor = R.actor({
      on: {
        'application:submitted': async function (payload, ctx) {
          ctx.log.info('review started');
          var reviewMs = 15000 + ctx.random.int(0, 10000);
          await new Promise(function (resolve) { ctx.clock.setTimeout(resolve, reviewMs); });
          var approved = ctx.random.random() < 0.8;
          var app = ctx.db.get('application', 'app');
          if (!app) return;
          ctx.db.update('application', 'app', {
            step: 'decision',
            status: approved ? 'approved' : 'rejected',
            reviewNote: approved
              ? 'All documents verified. Welcome aboard!'
              : 'Could not verify identity. Please resubmit with a clearer document.',
          });
          ctx.log.info('review complete: ' + (approved ? 'approved' : 'rejected'));
          await ctx.services.email.send({
            to: app.email || 'applicant@example.com',
            subject: approved ? 'Your account is approved' : 'Application update',
          });
        },
      },
    });

    function useApp() {
      var [a, setA] = useState(function () { return db.get('application', 'app'); });
      useEffect(function () {
        return db.subscribe('application', function () { setA(db.get('application', 'app')); });
      }, []);
      return a;
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

    function Onboarding() {
      var app     = useApp();
      var cs      = useClock();
      var entries = useLog();
      var [form, setForm] = useState({ firstName: '', lastName: '', email: '', dob: '', docType: '' });

      useEffect(function () {
        approvalActor.start(); clock.play();
        return function () { approvalActor.stop(); };
      }, []);

      if (!app) return h('div', null);

      function field(label, key, type) {
        return h('div', { style: { marginBottom: 12 } },
          h('label', { style: { fontSize: 13, color: '#6b7280', display: 'block', marginBottom: 4 } }, label),
          type === 'select'
            ? h('select', {
                style: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14 },
                value: form[key],
                onChange: function (e) { setForm(function (f) { var n = Object.assign({}, f); n[key] = e.target.value; return n; }); },
              },
                h('option', { value: '' }, 'Select…'),
                h('option', { value: 'passport' }, 'Passport'),
                h('option', { value: 'drivers_license' }, "Driver's license"),
                h('option', { value: 'national_id' }, 'National ID'),
              )
            : h('input', {
                type: type || 'text',
                style: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                  fontSize: 14, boxSizing: 'border-box' },
                value: form[key],
                onChange: function (e) { setForm(function (f) { var n = Object.assign({}, f); n[key] = e.target.value; return n; }); },
              }),
        );
      }

      var S = {
        page:  { maxWidth: 440, margin: '0 auto', padding: '28px 20px',
                 fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111', minHeight: '100vh' },
        card:  { border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: '#fff', marginBottom: 12 },
        pri:   { border: 'none', borderRadius: 8, background: '#111', color: '#fff',
                 padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14, width: '100%' },
        sec:   { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff',
                 padding: '10px 20px', cursor: 'pointer', fontSize: 14, width: '100%', marginBottom: 8 },
        cb:    { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
      };

      // Step indicator
      var stepDots = h('div', { style: { display: 'flex', gap: 8, marginBottom: 20 } },
        STEPS.map(function (s) {
          var idx = STEPS.indexOf(s), cur = STEPS.indexOf(app.step);
          return h('div', { key: s, style: {
            width: 8, height: 8, borderRadius: '50%',
            background: idx <= cur ? '#111' : '#e5e7eb',
          }});
        }),
      );

      var clkBar = h('div', { style: { display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' } },
        h('span', { style: { fontSize: 11, color: '#9ca3af', flex: 1 } }, 'sim ' + (cs.now / 1000).toFixed(0) + 's'),
        h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } }, cs.running ? 'Pause' : 'Play'),
        h('button', { style: S.cb, onClick: function () { clock.fastForward(10000); } }, '+10s'),
      );

      if (app.step === 'info') {
        return h('div', { style: S.page },
          clkBar, stepDots,
          h('h2', { style: { fontWeight: 700, fontSize: 20, marginBottom: 4 } }, 'Personal information'),
          h('p', { style: { fontSize: 14, color: '#6b7280', marginBottom: 16 } }, 'Step 1 of 4'),
          h('div', { style: S.card },
            field('First name', 'firstName'),
            field('Last name', 'lastName'),
            field('Email address', 'email', 'email'),
            field('Date of birth', 'dob', 'date'),
            h('button', { style: S.pri, onClick: function () {
              if (!form.firstName || !form.email) { log.warn('fill in all fields'); return; }
              db.update('application', 'app', { step: 'document',
                firstName: form.firstName, lastName: form.lastName,
                email: form.email, dob: form.dob });
              log.info('personal info saved');
            }}, 'Continue'),
          ),
        );
      }

      if (app.step === 'document') {
        return h('div', { style: S.page },
          clkBar, stepDots,
          h('h2', { style: { fontWeight: 700, fontSize: 20, marginBottom: 4 } }, 'Identity document'),
          h('p', { style: { fontSize: 14, color: '#6b7280', marginBottom: 16 } }, 'Step 2 of 4'),
          h('div', { style: S.card },
            field('Document type', 'docType', 'select'),
            h('div', { style: { border: '2px dashed #e5e7eb', borderRadius: 8, padding: '20px',
                textAlign: 'center', marginBottom: 12, color: '#9ca3af', fontSize: 14 } },
              app.docUploaded ? '✓ Document uploaded' : 'Simulated upload area',
            ),
            h('button', { style: S.sec, onClick: function () {
              if (!form.docType) { log.warn('choose a document type'); return; }
              db.update('application', 'app', { docUploaded: true, docType: form.docType });
              log.info('document uploaded (' + form.docType + ')');
            }}, app.docUploaded ? '✓ Upload again' : 'Upload document'),
            h('button', { style: S.pri, onClick: function () {
              if (!app.docUploaded) { log.warn('upload a document first'); return; }
              db.update('application', 'app', { step: 'review', status: 'submitted' });
              events.publish('application:submitted', { id: 'app' });
              log.info('application submitted for review');
            }}, 'Submit for review'),
          ),
        );
      }

      if (app.step === 'review') {
        return h('div', { style: S.page },
          clkBar, stepDots,
          h('h2', { style: { fontWeight: 700, fontSize: 20, marginBottom: 4 } }, 'Under review'),
          h('p', { style: { fontSize: 14, color: '#6b7280', marginBottom: 16 } }, 'Step 3 of 4'),
          h('div', { style: Object.assign({}, S.card, { textAlign: 'center', padding: '32px 20px' }) },
            h('div', { style: { fontSize: 32, marginBottom: 12 } }, '⏳'),
            h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, 'Reviewing your application'),
            h('div', { style: { fontSize: 13, color: '#9ca3af' } }, 'Advance the clock to speed up the review.'),
          ),
          h('div', { style: { fontSize: 12, color: '#6b7280' } },
            entries.slice().reverse().slice(0, 3).map(function (e, i) {
              return h('div', { key: i }, (e.t / 1000).toFixed(0) + 's  ' + e.msg);
            }),
          ),
        );
      }

      // decision
      var approved = app.status === 'approved';
      return h('div', { style: S.page },
        clkBar, stepDots,
        h('div', { style: Object.assign({}, S.card, { textAlign: 'center', padding: '32px 20px' }) },
          h('div', { style: { fontSize: 40, marginBottom: 12 } }, approved ? '✓' : '✗'),
          h('div', { style: { fontSize: 20, fontWeight: 700, marginBottom: 8,
              color: approved ? '#15803d' : '#b91c1c' } },
            approved ? 'Approved!' : 'Not approved'),
          h('div', { style: { fontSize: 14, color: '#6b7280', marginBottom: 16 } }, app.reviewNote),
          !approved && h('button', { style: S.pri, onClick: function () { db.reset(); } }, 'Start over'),
        ),
      );
    }

    window.App = Onboarding;
  `,
};
