/* RookieGamers SDK v1 · https://rookiegamers.com/docs
   One global, `rg`. Works inside the portal's game frame, on a game's own site, and in test mode. */
(function () {
  'use strict';
  if (window.rg && window.rg.version) return;

  const SCRIPT = document.currentScript;
  const PORTAL = SCRIPT && SCRIPT.src ? new URL(SCRIPT.src).origin : 'https://rookiegamers.com';
  const API = PORTAL + '/api/v1';
  const inFrame = (() => { try { return window.parent !== window; } catch (e) { return true; } })();
  const qs = new URLSearchParams(location.search);

  const S = { game: null, mode: null, token: null, exp: 0, user: undefined, play: null, ref: qs.get('rg_ref') || null, playing: false, beat: null, listeners: [], test: null };
  const ok = v => Object.assign({ ok: true }, v);
  const bad = (error, extra) => Object.assign({ ok: false, error }, extra);
  const log = (...a) => { if (S.debug) console.log('[rg]', ...a); };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };

  /* ---------- talking to the portal page around the frame ---------- */

  let seq = 0;
  const pending = new Map();
  function ask(type, data, timeout) {
    return new Promise(resolve => {
      const id = ++seq;
      const t = setTimeout(() => { pending.delete(id); resolve(null); }, timeout || 120000);
      pending.set(id, v => { clearTimeout(t); resolve(v); });
      window.parent.postMessage({ rg: 1, id, type, data }, type === 'hello' ? '*' : PORTAL);
    });
  }
  window.addEventListener('message', e => {
    if (e.origin !== PORTAL || e.source !== window.parent || !e.data || e.data.rg !== 1) return;
    const m = e.data;
    if (m.re && pending.has(m.re)) { pending.get(m.re)(m.data); pending.delete(m.re); return; }
    if (m.type === 'auth') setAuth(m.data);
  });

  function setAuth(d) {
    const before = S.user && S.user.id;
    S.token = d && d.token || null;
    S.exp = d && d.exp ? d.exp * 1000 : 0;
    S.user = d && d.user || null;
    if (S.mode === 'standalone') { if (S.token) store.set('rg.auth.' + S.game, { token: S.token, exp: S.exp, user: S.user }); else store.del('rg.auth.' + S.game); }
    if ((S.user && S.user.id) !== before) S.listeners.forEach(fn => { try { fn(S.user); } catch (err) { console.error(err); } });
  }

  async function freshToken() {
    if (S.mode === 'test') return 'test-token';
    if (S.token && S.exp - Date.now() > 60000) return S.token;
    if (S.mode === 'portal') { setAuth(await ask('token')); return S.token; }
    if (S.token) setAuth(null); // standalone tokens expire; the player signs in again from the popup
    return null;
  }

  async function call(method, path, body, auth) {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (auth) { const t = await freshToken(); if (t) headers.authorization = 'Bearer ' + t; }
    try {
      const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive: method === 'POST' && JSON.stringify(body || {}).length < 60000 });
      const j = await r.json().catch(() => ({}));
      return r.ok ? ok(j) : bad(j.error || 'Request failed (' + r.status + ')', j);
    } catch (e) { return bad('Network error'); }
  }

  /* ---------- init ---------- */

  async function init(opts) {
    opts = opts || {};
    if (S.mode) return ok({ mode: S.mode });
    S.game = String(opts.game || '');
    S.debug = !!opts.debug;
    if (!/^[a-z0-9-]{1,32}$/.test(S.game)) return bad('Pass your game\'s slug: rg.init({ game: "my-game" })');
    if (opts.test || qs.get('rg_test') === '1') { S.mode = 'test'; S.test = { scores: [] }; S.user = { id: 'p_test', name: 'Test Player', avatar: null, level: 3, xp: 420, title: 'Test champion · Jan 2026', guild: null, adult: false }; log('test mode'); return ok({ mode: 'test' }); }
    if (inFrame) {
      const w = await ask('hello', { game: S.game, sdk: 1 }, 1500);
      if (w && w.game === S.game) { S.mode = 'portal'; S.ref = w.ref || S.ref; setAuth(w.auth); log('portal mode'); return ok({ mode: 'portal' }); }
    }
    S.mode = 'standalone';
    const saved = store.get('rg.auth.' + S.game);
    if (saved && saved.exp > Date.now() + 60000) setAuth(saved); else S.user = null;
    log('standalone mode');
    return ok({ mode: 'standalone' });
  }
  const ready = async () => { if (!S.mode) await init({ game: S.game || (SCRIPT && SCRIPT.dataset.game) }); };

  /* ---------- game events ---------- */

  async function event(type) {
    await ready();
    if (S.mode === 'portal') window.parent.postMessage({ rg: 1, type: 'game', data: { event: type } }, PORTAL);
    if (S.mode === 'test') return ok();
    const r = await call('POST', '/events', { game: S.game, type, play: S.play, ref: S.ref }, true);
    if (r.ok && r.play) S.play = r.play;
    return r;
  }
  const game = {
    loaded() { return S.play ? Promise.resolve(ok()) : event('loaded'); },
    gameplayStart() {
      if (S.playing) return Promise.resolve(ok());
      S.playing = true;
      clearInterval(S.beat);
      S.beat = setInterval(() => { if (S.playing && document.visibilityState === 'visible') event('beat'); }, 60000);
      return event('start');
    },
    gameplayStop() {
      if (!S.playing) return Promise.resolve(ok());
      S.playing = false; clearInterval(S.beat);
      return event('stop');
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (!S.play || !S.playing) return;
    event(document.visibilityState === 'hidden' ? 'beat' : 'start');
  });

  /* ---------- player ---------- */

  const user = {
    async get() {
      await ready();
      if (S.mode === 'portal' && S.user === undefined) await freshToken();
      return S.user || null;
    },
    async login() {
      await ready();
      if (S.mode === 'test') return S.user;
      if (S.user) return S.user;
      if (S.mode === 'portal') { setAuth(await ask('login', null, 15 * 60000)); return S.user; }
      return popupLogin();
    },
    async token() { await ready(); return freshToken(); },
    onChange(fn) { if (typeof fn === 'function') S.listeners.push(fn); },
  };

  function popupLogin() {
    return new Promise(resolve => {
      const u = PORTAL + '/sdk/connect?game=' + encodeURIComponent(S.game) + '&origin=' + encodeURIComponent(location.origin);
      const w = window.open(u, 'rg_signin', 'width=440,height=640');
      if (!w) { location.href = u + '&return=' + encodeURIComponent(location.href); return; }
      const done = v => { window.removeEventListener('message', onMsg); clearInterval(poll); resolve(v); };
      function onMsg(e) {
        if (e.origin !== PORTAL || !e.data || e.data.rg !== 1 || e.data.type !== 'connect') return;
        setAuth(e.data.data); done(S.user);
      }
      window.addEventListener('message', onMsg);
      const poll = setInterval(() => { if (w.closed) done(S.user || null); }, 700);
    });
  }
  // A full-page sign-in (popup blocked) comes back with the token in the fragment.
  if (location.hash.indexOf('rg_connect=') !== -1) {
    try {
      const raw = decodeURIComponent(location.hash.split('rg_connect=')[1].split('&')[0]);
      const d = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
      if (d && d.game) store.set('rg.auth.' + d.game, { token: d.token, exp: d.exp * 1000, user: d.user });
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* ignore a broken fragment */ }
  }

  /* ---------- scores and the Hall of Fame ---------- */

  const scores = {
    async submit(o) {
      await ready();
      const score = Number(o && o.score);
      if (!Number.isFinite(score)) return bad('Pass a number: rg.scores.submit({ score: 212 })');
      if (S.mode === 'test') {
        const s = S.test.scores; const mine = s.find(r => r.player.id === 'p_test');
        if (mine) mine.score = Math.max(mine.score, score); else s.push({ player: { id: 'p_test', name: 'Test Player', title: null }, score });
        s.sort((a, b) => b.score - a.score); s.forEach((r, i) => { r.rank = i + 1; });
        const me = s.find(r => r.player.id === 'p_test');
        return ok({ best: me.score, rank: me.rank });
      }
      if (!await freshToken()) return bad('Sign in to save scores.', { signin: true });
      return call('POST', '/scores', { game: S.game, score }, true);
    },
    async top(o) {
      await ready(); o = o || {};
      if (S.mode === 'test') return ok({ rows: S.test.scores.slice(0, o.limit || 10) });
      const q = new URLSearchParams({ board: o.board === 'alltime' ? 'alltime' : 'monthly', limit: String(o.limit || 10) });
      if (o.month) q.set('month', o.month);
      return call('GET', '/scores/' + S.game + '?' + q);
    },
    async mine(o) {
      await ready(); o = o || {};
      if (S.mode === 'test') { const me = S.test.scores.find(r => r.player.id === 'p_test'); return ok({ rank: me ? me.rank : null, score: me ? me.score : null }); }
      if (!await freshToken()) return bad('Sign in first.', { signin: true });
      return call('GET', '/scores/' + S.game + '/me?board=' + (o.board === 'alltime' ? 'alltime' : 'monthly'), null, true);
    },
  };

  const fame = {
    async list() {
      await ready();
      if (S.mode === 'test') return ok({ rows: [{ month: '2026-01', monthLabel: 'Jan 2026', rank: 1, player: { id: 'p_test', name: 'Test Player' }, score: 999 }] });
      return call('GET', '/fame?game=' + S.game);
    },
  };

  /* ---------- play next ---------- */

  const promo = {
    async next() {
      await ready();
      if (S.mode === 'test') return ok({ game: { slug: 'sample', title: 'Sample Game', blurb: 'This is where another RookieGamers game shows up.', color: '#ff5c39', cover: null } });
      return call('GET', '/promo?game=' + S.game, null, true);
    },
    go(slug) {
      if (!/^[a-z0-9-]{1,32}$/.test(String(slug))) return;
      if (S.mode === 'portal') { window.parent.postMessage({ rg: 1, type: 'go', data: { slug } }, PORTAL); return; }
      if (S.mode === 'test') { log('would open', slug); return; }
      window.open(PORTAL + '/play/' + slug + '?ref=' + S.game, '_blank', 'noopener');
    },
    async showNext() {
      const r = await promo.next();
      if (!r.ok || !r.game) return ok({ shown: false });
      card(r.game);
      return ok({ shown: true, game: r.game });
    },
  };

  function card(g) {
    const old = document.getElementById('rg-next'); if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'rg-next';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Play next');
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const color = /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#ff5c39';
    const cover = g.cover && /^https:\/\//.test(g.cover) ? 'url(' + JSON.stringify(g.cover) + ') center/cover' : color;
    el.innerHTML =
      '<style>#rg-next{position:fixed;inset:auto 16px 16px auto;z-index:2147483647;width:min(320px,calc(100vw - 32px));font:14px/1.4 system-ui,-apple-system,sans-serif;color:#fff;background:#16131f;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden;animation:rgIn .25s ease-out}' +
      '@keyframes rgIn{from{transform:translateY(20px);opacity:0}}#rg-next .c{height:96px;background:' + cover + '}#rg-next .b{padding:12px 14px 14px}#rg-next small{opacity:.65;text-transform:uppercase;letter-spacing:.06em;font-size:11px}' +
      '#rg-next h3{margin:2px 0 4px;font-size:17px}#rg-next p{margin:0 0 12px;opacity:.8}#rg-next .r{display:flex;gap:8px}#rg-next button{flex:1;border:0;border-radius:999px;padding:9px 12px;font:600 14px system-ui,sans-serif;cursor:pointer}' +
      '#rg-next .go{background:' + color + ';color:#fff}#rg-next .no{background:rgba(255,255,255,.12);color:#fff}</style>' +
      '<div class="c"></div><div class="b"><small>Play next on RookieGamers</small><h3>' + esc(g.title) + '</h3><p>' + esc(g.blurb || '') + '</p>' +
      '<div class="r"><button class="no" type="button">Not now</button><button class="go" type="button">Play</button></div></div>';
    el.querySelector('.go').onclick = () => { el.remove(); promo.go(g.slug); };
    el.querySelector('.no').onclick = () => el.remove();
    document.body.appendChild(el);
  }

  /* ---------- coming later: safe to call now ---------- */

  const data = {
    async get(k) { await ready(); return store.get('rg.data.' + S.game + '.' + k); },
    async set(k, v) { await ready(); store.set('rg.data.' + S.game + '.' + k, v); return ok(); },
  };
  const invite = { async link(o) { await ready(); const room = o && o.room ? '?room=' + encodeURIComponent(o.room) : ''; return ok({ url: PORTAL + '/play/' + S.game + room }); } };
  const soon = 'Coming soon on RookieGamers.';
  const storeApi = { async buy() { return bad(soon); }, async owned() { return []; } };
  const guild = { async mine() { return null; }, async board() { return []; } };
  const ads = { async midgame() { return ok({ shown: false }); }, async rewarded() { return ok({ shown: false, rewarded: false }); } };
  const wallet = { available: false, async get() { return null; } };

  window.rg = { version: '1.0.0', portal: PORTAL, init, game, user, scores, fame, promo, data, invite, store: storeApi, guild, ads, wallet,
    get mode() { return S.mode; } };
  if (SCRIPT && SCRIPT.dataset.game) init({ game: SCRIPT.dataset.game });
})();
