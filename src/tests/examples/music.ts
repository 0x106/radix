// Streaming music player (#15 from example-apps.md).
// A player actor ticks every second to advance the playback position; when a
// track ends it auto-advances to the next. Demonstrates:
//   - Tick-based state that isn't purely time-driven (only ticks when playing)
//   - Actor reading and writing the same single-row state table
//   - Media-style non-CRUD interaction model

export const music = {
  name: "Music player",
  description:
    "Music player with a 10-track catalogue. A player actor advances the position each sim-second and auto-queues the next track.",
  source: /* js */ `
    const { useState, useEffect } = React;
    const h = React.createElement;
    const R = window.radix;
    const db = R.db, clock = R.clock, log = R.log;

    const TRACKS_DATA = [
      { id: 't1',  title: 'Neon Drift',       artist: 'Synthwave Collective',  dur: 32 },
      { id: 't2',  title: 'Quiet Hours',       artist: 'Lo-fi Dreams',          dur: 28 },
      { id: 't3',  title: 'Cascades',          artist: 'Ambient Unit',           dur: 35 },
      { id: 't4',  title: 'Digital Bloom',     artist: 'Synthwave Collective',  dur: 24 },
      { id: 't5',  title: 'Morning Static',    artist: 'Lo-fi Dreams',          dur: 30 },
      { id: 't6',  title: 'Hollow Sun',        artist: 'Ambient Unit',           dur: 40 },
      { id: 't7',  title: 'Rush',              artist: 'Electric Circuit',       dur: 26 },
      { id: 't8',  title: 'Soft Frequencies',  artist: 'Lo-fi Dreams',          dur: 34 },
      { id: 't9',  title: 'Atlas',             artist: 'Electric Circuit',       dur: 29 },
      { id: 't10', title: 'Slow Burn',         artist: 'Synthwave Collective',  dur: 38 },
    ];

    db.define({
      tracks: {
        fields: {
          title: 'string',
          artist: 'string',
          duration: 'number',
        },
        seed: TRACKS_DATA.map(function (t) {
          return { id: t.id, title: t.title, artist: t.artist, duration: t.dur };
        }),
      },
      playback: {
        fields: {
          trackId: 'string',
          position: { type: 'number', default: 0 },
          playing: { type: 'boolean', default: false },
        },
        seed: [
          { id: 'state', trackId: null, position: 0, playing: false },
        ],
      },
    });
    log.info('10 tracks loaded');

    // Player actor: ticks every 1 s. Advances position when playing; auto-skips on track end.
    const playerActor = R.actor({
      everyMs: 1000,
      tick: async function (ctx) {
        var pb = ctx.db.get('playback', 'state');
        if (!pb || !pb.playing || !pb.trackId) return;
        var track = ctx.db.get('tracks', pb.trackId);
        if (!track) return;
        var next = pb.position + 1;
        if (next >= track.duration) {
          // Advance to next track
          var all = ctx.db.query('tracks');
          var idx = all.findIndex(function (t) { return t.id === pb.trackId; });
          var nextTrack = all[(idx + 1) % all.length];
          ctx.db.update('playback', 'state', { trackId: nextTrack.id, position: 0, playing: true });
          ctx.log.info('now playing: ' + nextTrack.title);
        } else {
          ctx.db.update('playback', 'state', { position: next });
        }
      },
    });

    function useTracks() {
      var [rows, setRows] = useState(function () { return db.query('tracks'); });
      useEffect(function () {
        return db.subscribe('tracks', function () { setRows(db.query('tracks')); });
      }, []);
      return rows;
    }
    function usePlayback() {
      var [pb, setPb] = useState(function () { return db.get('playback', 'state'); });
      useEffect(function () {
        return db.subscribe('playback', function () { setPb(db.get('playback', 'state')); });
      }, []);
      return pb;
    }
    function fmt(secs) {
      var m = Math.floor(secs / 60), s = secs % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function MusicPlayer() {
      var tracks  = useTracks();
      var pb      = usePlayback();

      useEffect(function () {
        playerActor.start(); clock.play();
        return function () { playerActor.stop(); };
      }, []);

      if (!pb) return h('div', null);

      function playTrack(track) {
        db.update('playback', 'state', { trackId: track.id, position: 0, playing: true });
        log.info('now playing: ' + track.title);
      }
      function togglePlay() {
        if (!pb.trackId) { playTrack(tracks[0]); return; }
        db.update('playback', 'state', { playing: !pb.playing });
      }
      function skip() {
        var idx = tracks.findIndex(function (t) { return t.id === pb.trackId; });
        var next = tracks[(idx + 1) % tracks.length];
        db.update('playback', 'state', { trackId: next.id, position: 0, playing: pb.playing });
        log.info('skipped to: ' + next.title);
      }
      function prev() {
        var idx = tracks.findIndex(function (t) { return t.id === pb.trackId; });
        var p = tracks[(idx - 1 + tracks.length) % tracks.length];
        db.update('playback', 'state', { trackId: p.id, position: 0, playing: pb.playing });
      }

      var currentTrack = pb.trackId ? tracks.find(function (t) { return t.id === pb.trackId; }) : null;
      var progress = currentTrack ? pb.position / currentTrack.duration : 0;

      var S = {
        page:  { maxWidth: 480, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                 color: '#111', background: '#fff', minHeight: '100vh' },
        hdr:   { padding: '10px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'center' },
        cb:    { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
        np:    { padding: '20px 16px', borderBottom: '1px solid #e5e7eb', background: '#fafafa' },
        ctrl:  { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
        ctrlBtn: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, padding: '4px 8px' },
        playBtn: { border: 'none', background: '#111', color: '#fff', borderRadius: '50%',
                   width: 44, height: 44, cursor: 'pointer', fontSize: 18, display: 'flex',
                   alignItems: 'center', justifyContent: 'center' },
      };

      return h('div', { style: S.page },
        h('div', { style: S.hdr },
          h('strong', { style: { flex: 1 } }, 'Music'),
        ),
        h('div', { style: S.np },
          h('div', { style: { textAlign: 'center', marginBottom: 14 } },
            h('div', { style: { width: 80, height: 80, borderRadius: 12, background: '#f3f4f6',
                margin: '0 auto 12px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 32 } }, '♪'),
            h('div', { style: { fontWeight: 700, fontSize: 17 } },
              currentTrack ? currentTrack.title : 'Nothing playing'),
            h('div', { style: { fontSize: 13, color: '#6b7280', marginTop: 2 } },
              currentTrack ? currentTrack.artist : ''),
          ),
          // Progress bar
          h('div', { style: { height: 4, background: '#e5e7eb', borderRadius: 2, marginBottom: 6 } },
            h('div', { style: { width: (progress * 100).toFixed(1) + '%', height: '100%',
                background: '#111', borderRadius: 2 } }),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 12 } },
            h('span', null, currentTrack ? fmt(pb.position) : '0:00'),
            h('span', null, currentTrack ? fmt(currentTrack.duration) : '0:00'),
          ),
          h('div', { style: S.ctrl },
            h('button', { style: S.ctrlBtn, onClick: prev }, '⏮'),
            h('button', { style: S.playBtn, onClick: togglePlay }, pb.playing ? '⏸' : '▶'),
            h('button', { style: S.ctrlBtn, onClick: skip }, '⏭'),
          ),
        ),
        // Track list
        h('div', { style: { padding: '8px 0' } },
          tracks.map(function (track) {
            var active = pb.trackId === track.id;
            return h('div', { key: track.id,
              style: { padding: '10px 16px', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: 12,
                background: active ? '#f9fafb' : 'transparent',
                borderBottom: '1px solid #f3f4f6' },
              onClick: function () { playTrack(track); },
            },
              h('div', { style: { fontSize: 18, color: active ? '#111' : '#d1d5db' } }, '♪'),
              h('div', { style: { flex: 1 } },
                h('div', { style: { fontWeight: active ? 600 : 400, fontSize: 14 } }, track.title),
                h('div', { style: { fontSize: 12, color: '#9ca3af' } }, track.artist),
              ),
              h('span', { style: { fontSize: 12, color: '#9ca3af' } }, fmt(track.duration)),
            );
          }),
        ),
      );
    }

    window.App = MusicPlayer;
  `,
};
