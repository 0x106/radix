// BATCH 3 EXAMPLE — LLM agent pipeline builder (example-apps.md #45).
//
// Purpose: the most direct stress on the graceful-degradation design. A
// node-graph workflow (classify → route → draft → extract) where every model
// call is faked: canned responses, simulated token streaming, clock-based
// latency, seeded occasional failures with one retry, and estimated token
// costs. None of the intelligence is real — which is exactly what the stub
// handle exists to say out loud.
//
// What it surfaced (recorded in runtime-contract.md):
//   - Needed the `stub` handle (plan Phase 9) — this example's honesty panel
//     ("what's real vs pretend") is built entirely on radix.stub declarations,
//     and the shell can read the same list over the bridge.
//   - "Running" an AI prototype decomposes cleanly onto existing handles:
//     streaming = clock.setTimeout per token, retries = app code, failures =
//     seeded random, latency = clock delays. Pause freezes mid-stream; fast-
//     forward completes a run instantly. No new runtime surface needed there.
//
// Authored as browser-ESM source (no JSX). `React` and `window.radix` in scope.

export const llmpipeline = {
  name: "LLM pipeline (stubbed AI)",
  description:
    "Batch 3 example: AI workflow pipeline with faked model calls — canned responses, simulated streaming, seeded failures/retries, and a stub-powered what's-real panel.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, log = R.log, clock = R.clock, random = R.random, stub = R.stub;

    // Honesty first: declare the real-vs-faked boundary up front.
    stub.declare('llm-inference', {
      summary: 'Model calls return canned, template-based responses',
      missing: ['real language understanding', 'real generation quality', 'prompt sensitivity'],
      fidelity: 'canned',
    });
    stub.declare('token-streaming', {
      summary: 'Streaming is simulated word-by-word on the simulation clock',
      missing: ['real token boundaries', 'backpressure'],
      fidelity: 'faked',
    });
    stub.declare('token-costs', {
      summary: 'Token counts and dollar costs are estimated from word counts',
      missing: ['real tokenizer', 'provider price list'],
      fidelity: 'partial',
    });

    db.define({
      nodes: {
        fields: {
          seq: 'number',
          name: { type: 'string', required: true },
          type: { type: 'enum', values: ['classify', 'route', 'draft', 'extract'] },
          config: 'string',           // prompt template / labels, editable
          enabled: { type: 'boolean', default: true },
        },
        seed: [
          { id: 'n-classify', seq: 1, name: 'Classify intent', type: 'classify',
            config: 'support, sales, feedback', enabled: true },
          { id: 'n-route', seq: 2, name: 'Route by label', type: 'route',
            config: 'support -> Support reply; sales -> Sales reply; feedback -> Support reply', enabled: true },
          { id: 'n-draft-support', seq: 3, name: 'Support reply', type: 'draft',
            config: 'You are a kind support agent. Draft a short, concrete reply.', enabled: true },
          { id: 'n-draft-sales', seq: 4, name: 'Sales reply', type: 'draft',
            config: 'You are an upbeat sales rep. Draft a short pitch reply.', enabled: true },
          { id: 'n-extract', seq: 5, name: 'Extract action items', type: 'extract',
            config: 'Return the action items as a short list.', enabled: true },
        ],
      },
      runs: {
        fields: { input: 'string', status: { type: 'enum', values: ['running', 'done', 'failed'] },
                  startedAt: 'number', steps: 'json', output: 'string' },
      },
    }, { strict: true });
    log.info('pipeline seeded');

    // --- the fake model -------------------------------------------------------
    const wait = function (ms) { return new Promise(function (res) { clock.setTimeout(res, ms); }); };
    const words = function (s) { return s.split(/\\s+/).filter(Boolean).length; };
    const FAIL_RATE = 0.08;

    const CANNED = {
      support: ['Thanks for flagging this — that is not the experience we want you to have.',
        'I have reproduced the issue on our side and filed it with the team.',
        'In the meantime, the workaround is to sign out and back in once.',
        'I will follow up here the moment the fix ships.'],
      sales: ['Great to hear from you — happy to help you evaluate.',
        'Based on what you describe, the Team plan fits best.',
        'I can set up a 14-day trial with your data imported so you can judge it properly.',
        'Would Tuesday or Thursday work for a 20-minute walkthrough?'],
    };

    function classify(labels, text) {
      const t = text.toLowerCase();
      if (/(buy|price|cost|plan|trial|demo|upgrade)/.test(t) && labels.indexOf('sales') >= 0) return 'sales';
      if (/(bug|broken|error|crash|fail|cannot|can't)/.test(t) && labels.indexOf('support') >= 0) return 'support';
      if (/(love|great|wish|suggest|idea)/.test(t) && labels.indexOf('feedback') >= 0) return 'feedback';
      return labels[random.int(0, labels.length - 1)];
    }

    // One fake model call: clock latency, seeded failure, canned output.
    // \`onToken\` streams the output word-by-word when provided.
    async function fakeModelCall(kind, prompt, input, onToken) {
      await wait(350 + random.int(0, 700));
      if (random.random() < FAIL_RATE) { throw new Error('model timeout (simulated)'); }
      let out;
      if (kind === 'classify') {
        out = classify(prompt.split(',').map(function (s) { return s.trim(); }), input);
      } else if (kind === 'extract') {
        out = '- Reply to the customer\\n- ' + (/(bug|broken|error|crash)/i.test(input) ? 'File engineering ticket' : 'Log in CRM') + '\\n- Schedule follow-up';
      } else {
        const bank = /sales/i.test(prompt) ? CANNED.sales : CANNED.support;
        const n = random.int(2, bank.length);
        out = bank.slice(0, n).join(' ');
      }
      if (onToken) {
        const toks = String(out).split(' ');
        for (let i = 0; i < toks.length; i++) {
          await wait(random.int(25, 70));
          onToken(toks.slice(0, i + 1).join(' '));
        }
      }
      return String(out);
    }

    // --- run the pipeline -------------------------------------------------------
    async function runPipeline(input) {
      const nodes = db.query('nodes', { order: { field: 'seq', dir: 'asc' } })
        .filter(function (n) { return n.enabled; });
      const run = db.create('runs', { input: input, status: 'running', startedAt: clock.now(), steps: [], output: '' });
      const steps = [];
      const push = function (s) { steps.push(s); db.update('runs', run.id, { steps: steps.slice() }); return s; };
      const patchStep = function (s) { db.update('runs', run.id, { steps: steps.slice() }); };

      let label = null;
      let routedDraftId = null;
      let draft = '';
      try {
        for (const node of nodes) {
          if (node.type === 'draft' && routedDraftId && node.id !== routedDraftId) continue;
          const t0 = clock.now();
          const step = push({ node: node.name, type: node.type, output: '', ms: 0, tokensIn: 0, tokensOut: 0, retried: false, status: 'running' });

          if (node.type === 'route') {
            // routing is plain logic, not a model call
            const target = label === 'sales' ? 'n-draft-sales' : 'n-draft-support';
            routedDraftId = target;
            const tn = db.get('nodes', target);
            step.output = label + ' → ' + (tn ? tn.name : target);
          } else {
            const call = function () {
              return fakeModelCall(node.type, node.config, node.type === 'extract' ? draft + ' ' + input : input,
                node.type === 'draft' ? function (partial) { step.output = partial; patchStep(); } : null);
            };
            let out;
            try { out = await call(); }
            catch (err) {
              step.retried = true; patchStep();
              log.warn(node.name + ' failed, retrying', err.message);
              out = await call();   // second failure propagates
            }
            step.output = out;
            step.tokensIn = Math.round((words(node.config) + words(input)) * 1.33);
            step.tokensOut = Math.round(words(out) * 1.33);
            if (node.type === 'classify') label = out;
            if (node.type === 'draft') draft = out;
          }
          step.ms = clock.now() - t0;
          step.status = 'done';
          patchStep();
        }
        db.update('runs', run.id, { status: 'done', output: draft });
        log.info('run complete', { label: label });
      } catch (err) {
        const last = steps[steps.length - 1];
        if (last) { last.status = 'failed'; last.output = err.message; patchStep(); }
        db.update('runs', run.id, { status: 'failed', output: err.message });
        log.error('run failed', err.message);
      }
    }

    window.__pipeline = { run: runPipeline }; // debug/test hook

    // --- UI ---------------------------------------------------------------------
    const SAMPLES = [
      'The export button crashes the app every time I click it. This is broken!',
      'What would the Team plan cost for 12 seats, and can we get a trial?',
      'Love the new dashboard — one idea: let me pin my favourite reports.',
    ];
    const cost = function (tin, tout) { return (tin * 2.5 + tout * 10) / 1e6; };
    const FID_BADGE = { canned: '#b91c1c', faked: '#d97706', partial: '#2563eb' };

    function useCollection(name, order) {
      const read = function () { return db.query(name, order ? { order: order } : undefined); };
      const [rows, setRows] = useState(read);
      useEffect(function () { return db.subscribe(name, function () { setRows(read()); }); }, [name]);
      return rows;
    }

    function Pipeline() {
      const nodes = useCollection('nodes', { field: 'seq', dir: 'asc' });
      const runs = useCollection('runs', { field: 'startedAt', dir: 'desc' });
      const [input, setInput] = useState(SAMPLES[0]);

      const page = { maxWidth: 1080, margin: '0 auto', padding: '16px 20px 32px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#111' };
      const card = { border: '1px solid #ececec', borderRadius: 12, background: '#fff', padding: 12 };
      const label = { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 };
      const btn = function (active) { return { padding: '7px 12px', borderRadius: 8,
        border: '1px solid ' + (active ? '#111' : '#e5e5e5'),
        background: active ? '#111' : '#fff', color: active ? '#fff' : '#374151',
        cursor: 'pointer', fontSize: 13 }; };

      return h('div', { style: page },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
          h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0, marginRight: 'auto' } }, 'Pipeline'),
          h('span', { style: { fontSize: 12.5, color: '#6b7280' } }, runs.length + ' run(s)'),
          h('button', { style: btn(false), onClick: function () { db.reset(); log.info('reset'); } }, 'Reset'),
        ),
        h('div', { style: { display: 'flex', gap: 14, alignItems: 'flex-start' } },

          // left: the pipeline definition + input
          h('div', { style: { width: 340, display: 'flex', flexDirection: 'column', gap: 10 } },
            h('div', { style: card },
              h('div', { style: label }, 'incoming message'),
              h('textarea', { value: input, rows: 3,
                style: { width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid #e5e5e5', padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' },
                onChange: function (e) { setInput(e.target.value); } }),
              h('div', { style: { display: 'flex', gap: 6, margin: '8px 0' } },
                SAMPLES.map(function (s, i) {
                  return h('button', { key: i, style: Object.assign({}, btn(false), { fontSize: 11.5, padding: '4px 8px' }),
                    onClick: function () { setInput(s); } }, ['bug', 'pricing', 'idea'][i]);
                })),
              h('button', { style: Object.assign({}, btn(true), { width: '100%' }),
                onClick: function () { if (input.trim()) runPipeline(input.trim()); } }, '▶ Run pipeline'),
            ),
            nodes.map(function (n, i) {
              return h('div', { key: n.id, style: Object.assign({}, card, { opacity: n.enabled ? 1 : 0.45 }) },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('span', { style: { fontSize: 11, color: '#9ca3af' } }, (i + 1)),
                  h('strong', { style: { fontSize: 13.5, marginRight: 'auto' } }, n.name),
                  h('span', { style: { fontSize: 10.5, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 5, padding: '2px 6px' } }, n.type),
                  n.type === 'draft' && h('input', { type: 'checkbox', checked: n.enabled, title: 'enable/disable',
                    onChange: function (e) { db.update('nodes', n.id, { enabled: e.target.checked }); } }),
                ),
                h('textarea', { value: n.config, rows: 2,
                  style: { width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid #f0f0f0', padding: 6, fontSize: 12, color: '#374151', marginTop: 8, fontFamily: 'inherit', resize: 'vertical' },
                  onChange: function (e) { db.update('nodes', n.id, { config: e.target.value }); } }),
              );
            }),
            h('div', { style: card },
              h('div', { style: label }, "what's real here"),
              R.stub.list().map(function (s) {
                return h('div', { key: s.name, style: { marginBottom: 8 } },
                  h('div', { style: { fontSize: 12.5 } },
                    h('span', { style: { color: FID_BADGE[s.fidelity], fontWeight: 700 } }, s.fidelity.toUpperCase() + ' '),
                    h('strong', null, s.name)),
                  h('div', { style: { fontSize: 12, color: '#6b7280' } }, s.summary + '. Missing: ' + s.missing.join(', ') + '.'));
              }),
            ),
          ),

          // right: run history with streaming steps
          h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 10 } },
            runs.length === 0 && h('div', { style: Object.assign({}, card, { color: '#9ca3af', fontSize: 13.5, textAlign: 'center', padding: 28 }) },
              'No runs yet. Pick a sample message and run the pipeline — pause the clock mid-run to freeze a stream.'),
            runs.slice(0, 5).map(function (r) {
              const steps = r.steps || [];
              const tin = steps.reduce(function (s, x) { return s + (x.tokensIn || 0); }, 0);
              const tout = steps.reduce(function (s, x) { return s + (x.tokensOut || 0); }, 0);
              const sc = r.status === 'done' ? '#166534' : r.status === 'failed' ? '#b91c1c' : '#d97706';
              return h('div', { key: r.id, style: card },
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 } },
                  h('span', { style: { fontSize: 11, fontWeight: 700, color: sc } }, r.status.toUpperCase()),
                  h('span', { style: { fontSize: 13, color: '#374151', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.input),
                  h('span', { style: { fontSize: 11.5, color: '#9ca3af' } },
                    tin + '→' + tout + ' tok · ~$' + cost(tin, tout).toFixed(5))),
                steps.map(function (s, i) {
                  return h('div', { key: i, style: { borderTop: '1px solid #f5f5f5', padding: '7px 0' } },
                    h('div', { style: { fontSize: 12, color: '#6b7280', marginBottom: 2 } },
                      s.node + (s.retried ? ' · retried' : '') + (s.ms ? ' · ' + s.ms + 'ms' : '') +
                      (s.status === 'running' ? ' · …' : s.status === 'failed' ? ' · FAILED' : '')),
                    h('div', { style: { fontSize: 13, whiteSpace: 'pre-wrap',
                      color: s.status === 'failed' ? '#b91c1c' : '#111',
                      fontFamily: s.type === 'extract' ? 'ui-monospace, monospace' : 'inherit' } },
                      s.output + (s.status === 'running' && s.type === 'draft' ? ' ▌' : '')));
                }),
              );
            }),
          ),
        ),
      );
    }

    window.App = Pipeline;
  `,
};
