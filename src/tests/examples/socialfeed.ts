// Social feed (#10 from example-apps.md).
// A content-generating actor posts from simulated users on a schedule. The
// player can like posts and write their own. Demonstrates:
//   - High-volume db writes from an actor (new posts accumulate over time)
//   - Optimistic UI updates (likes applied immediately)
//   - Ordering and limit in db.query

export const socialfeed = {
  name: "Social feed",
  description:
    "Infinite-scroll social feed. A content actor posts from simulated users on a schedule; you can like posts and add your own.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log, random = R.random;

    const USERS = ['Alex Chen', 'Jordan Lee', 'Sam Rivera', 'Taylor Kim', 'Morgan Patel'];
    const HANDLES = ['@alexc', '@jordanl', '@samr', '@taylork', '@morganp'];
    const POSTS = [
      'Just shipped a feature I have been working on for weeks. Feels great.',
      'Hot take: good variable names matter more than comments.',
      'Three meetings back to back. I need a coffee.',
      'Finally figured out that weird intermittent bug.',
      'New keyboard arrived. Productivity up 0%, happiness up 100%.',
      'Reminder that dark mode is a preference not a personality.',
      'Pair programming session today — caught three bugs we would have missed.',
      'Deployed on a Friday. Living dangerously.',
      'Code review: the art of being constructively salty.',
      'Tech debt is just interest on borrowed time.',
      'Writing tests first is weird until it becomes obvious.',
      'The real MVP is whoever wrote the error message that actually helped.',
    ];

    db.__seed(function (api) {
      for (var i = 0; i < 6; i++) {
        var ui = i % USERS.length;
        api.create('posts', {
          id: 'seed-' + i,
          author: USERS[ui], handle: HANDLES[ui],
          content: POSTS[i],
          likes: Math.floor(i * 3.7),
          createdAt: -(6 - i) * 8000,
        });
      }
      log.info('feed seeded');
    });

    // Content actor: every 6–14 s posts from a random user.
    const contentActor = R.actor({
      everyMs: 6000, jitterMs: 4000,
      tick: async function (ctx) {
        var ui = ctx.random.int(0, USERS.length - 1);
        var content = ctx.random.pick(POSTS);
        ctx.db.create('posts', {
          author: USERS[ui], handle: HANDLES[ui],
          content: content,
          likes: 0,
          createdAt: ctx.clock.now(),
        });
        ctx.log.info(USERS[ui] + ' posted');
      },
    });

    function usePosts() {
      var read = function () {
        return db.query('posts', { order: { field: 'createdAt', dir: 'desc' }, limit: 30 });
      };
      var [rows, setRows] = useState(read);
      useEffect(function () {
        return db.subscribe('posts', function () { setRows(read()); });
      }, []);
      return rows;
    }
    function useClock() {
      var [s, setS] = useState({ now: clock.now(), running: clock.isRunning() });
      useEffect(function () { return clock.subscribe(function (n, r) { setS({ now: n, running: r }); }); }, []);
      return s;
    }

    function Feed() {
      var posts = usePosts();
      var cs = useClock();
      var [draft, setDraft] = useState('');

      useEffect(function () {
        contentActor.start(); clock.play();
        return function () { contentActor.stop(); };
      }, []);

      function like(post) {
        db.update('posts', post.id, { likes: (post.likes || 0) + 1 });
      }
      function addPost() {
        var t = draft.trim(); if (!t) return;
        db.create('posts', { author: 'You', handle: '@you', content: t, likes: 0, createdAt: clock.now() });
        setDraft('');
      }

      var S = {
        page:   { maxWidth: 480, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                  color: '#111', background: '#f9fafb', minHeight: '100vh', paddingBottom: 20 },
        hdr:    { padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb',
                  display: 'flex', gap: 8, alignItems: 'center' },
        cb:     { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8,
                  padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
        compose:{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 16px',
                  display: 'flex', gap: 8 },
        card:   { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 16px' },
      };

      return h('div', { style: S.page },
        h('div', { style: S.hdr },
          h('strong', { style: { flex: 1 } }, 'Feed'),
          h('span', { style: { fontSize: 11, color: '#9ca3af' } }, (cs.now / 1000).toFixed(0) + 's'),
          h('button', { style: S.cb, onClick: function () { cs.running ? clock.pause() : clock.play(); } },
            cs.running ? 'Pause' : 'Play'),
          h('button', { style: S.cb, onClick: function () { clock.fastForward(15000); } }, '+15s'),
        ),
        h('div', { style: S.compose },
          h('input', {
            style: { flex: 1, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', fontSize: 14 },
            value: draft, placeholder: "What's on your mind?",
            onChange: function (e) { setDraft(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') addPost(); },
          }),
          h('button', {
            style: { border: 'none', background: '#111', color: '#fff', borderRadius: 8,
              padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
            onClick: addPost,
          }, 'Post'),
        ),
        posts.map(function (post) {
          var ago = Math.max(0, cs.now - (post.createdAt || 0));
          var agoStr = ago < 60000 ? (ago / 1000).toFixed(0) + 's' : (ago / 60000).toFixed(0) + 'm';
          return h('div', { key: post.id, style: S.card },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 } },
              h('div', null,
                h('span', { style: { fontWeight: 600, fontSize: 14 } }, post.author),
                h('span', { style: { fontSize: 12, color: '#9ca3af', marginLeft: 6 } }, post.handle),
              ),
              h('span', { style: { fontSize: 12, color: '#9ca3af' } }, agoStr),
            ),
            h('div', { style: { fontSize: 14, lineHeight: 1.5, marginBottom: 8 } }, post.content),
            h('button', {
              style: { border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 13, color: '#6b7280', padding: 0 },
              onClick: function () { like(post); },
            }, '♡ ' + (post.likes || 0)),
          );
        }),
      );
    }

    window.App = Feed;
  `,
};
