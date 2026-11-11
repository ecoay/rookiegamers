/* RookieGamers SDK v1 · https://rookiegamers.com/docs
   One global, `rg`. Works inside the portal's game frame, on a game's own site, and in test mode. */
(function () {
  'use strict';
  if (window.rg && window.rg.version) return;

  const SCRIPT = document.currentScript;
  // Hosted games load /sdk/v1.js from the games host (games.rookiegamers.com); the portal is the
  // same address without "games.".
  const PORTAL = SCRIPT && SCRIPT.src ? (u => u.protocol + '//' + u.host.replace(/^games\./, ''))(new URL(SCRIPT.src)) : 'https://rookiegamers.com';
  const API = PORTAL + '/api/v1';
  // Loaded from the staging site (rookiegamers-staging...): test data only, never production.
  const STAGING = /(^|[.-])staging[.-]/.test(new URL(PORTAL).hostname);
  if (STAGING && window.console) console.info('[rg] Using RookieGamers staging (' + PORTAL + '): test data only. Load the SDK from https://rookiegamers.com before you ship.');
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
    if (m.type === 'audio') setMute('player', !!(m.data && m.data.muted));
  });

  /* ---------- sound ---------- */

  // The game is muted when the player muted it (the portal's sound button, or rg.audio.set on a
  // game's own site), while an ad is on screen, and while the tab is hidden. Games follow
  // rg.audio.onChange; nothing here touches the game's audio directly.
  const mute = { player: !!store.get('rg.muted'), ad: false, hidden: document.visibilityState === 'hidden' };
  const audioFns = [];
  let lastMuted = null;
  const isMuted = () => mute.player || mute.ad || mute.hidden;
  function setMute(reason, on) {
    mute[reason] = on;
    const now = isMuted();
    if (now === lastMuted) return;
    lastMuted = now;
    audioFns.slice().forEach(fn => { try { fn(now); } catch (err) { console.error(err); } });
  }
  lastMuted = isMuted();
  document.addEventListener('visibilitychange', () => setMute('hidden', document.visibilityState === 'hidden'));
  const audio = {
    muted() { return isMuted(); },
    // fn(muted) runs whenever the answer changes. Returns a function that stops listening.
    onChange(fn) { if (typeof fn !== 'function') return () => {}; audioFns.push(fn); return () => { const i = audioFns.indexOf(fn); if (i >= 0) audioFns.splice(i, 1); }; },
    // For a game's own mute button when it runs on its own site. In the portal, the portal's
    // sound button decides, so this only changes the setting outside it.
    set(muted) { if (S.mode === 'portal') return isMuted(); store.set('rg.muted', !!muted); setMute('player', !!muted); return isMuted(); },
  };

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
    if (S.mode) return ok({ mode: S.mode, staging: STAGING });
    S.game = String(opts.game || '');
    S.debug = !!opts.debug;
    if (!/^[a-z0-9-]{1,32}$/.test(S.game)) return bad('Pass your game\'s slug: rg.init({ game: "my-game" })');
    if (opts.test || qs.get('rg_test') === '1') { S.mode = 'test'; S.test = { scores: [] }; S.user = { id: 'p_test', name: 'Test Player', avatar: null, level: 3, xp: 420, title: 'Test champion · Jan 2026', guild: null, adult: false, social: { x: { id: 'test-x', handle: 'testplayer' } } }; log('test mode'); return ok({ mode: 'test', staging: STAGING }); }
    if (inFrame) {
      const w = await ask('hello', { game: S.game, sdk: 1 }, 1500);
      if (w && w.game === S.game) { S.mode = 'portal'; S.ref = w.ref || S.ref; setAuth(w.auth); setMute('player', !!w.muted); log('portal mode'); return ok({ mode: 'portal', staging: STAGING }); }
    }
    S.mode = 'standalone';
    const saved = store.get('rg.auth.' + S.game);
    if (saved && saved.exp > Date.now() + 60000) setAuth(saved); else S.user = null;
    log('standalone mode');
    return ok({ mode: 'standalone', staging: STAGING });
  }
  const ready = async () => { if (!S.mode) await init({ game: S.game || (SCRIPT && SCRIPT.dataset.game) }); };

  /* ---------- game events ---------- */

  async function send(type) {
    await ready();
    if (S.mode === 'portal') window.parent.postMessage({ rg: 1, type: 'game', data: { event: type } }, PORTAL);
    if (S.mode === 'test') return ok();
    const r = await call('POST', '/events', { game: S.game, type, play: S.play, ref: S.ref }, true);
    if (r.ok && r.play) S.play = r.play;
    return r;
  }
  // Every play starts with 'loaded'. Later events wait for its play id, so a game that
  // calls gameplayStart() before loaded() has answered (or never calls loaded()) still counts.
  function opened() {
    if (!S.opening) S.opening = send('loaded').then((r) => { if (!r.ok) S.opening = null; return r; });
    return S.opening;
  }
  async function event(type) {
    if (type === 'loaded') return opened();
    await opened();
    return send(type);
  }
  const game = {
    loaded() { return opened(); },
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
    // Games built on players' social accounts (socialAccounts on): link one network, like "x".
    // Opens that network's sign-in in a popup; resolves to the updated player (user.social has it),
    // or null if the player closes it.
    async link(provider) {
      await ready();
      provider = String(provider || '').toLowerCase();
      if (!/^[a-z0-9-]{1,32}$/.test(provider)) return null;
      if (S.mode === 'test') {
        S.user.social = S.user.social || {};
        if (!S.user.social[provider]) S.user.social[provider] = { id: 'test-' + provider, handle: 'test_' + provider };
        return S.user;
      }
      if (S.mode === 'portal') {
        const r = await ask('link', { provider }, 15 * 60000);
        if (!r || !r.user) return null;
        setAuth(r); return S.user;
      }
      return popup(PORTAL + '/sdk/link?game=' + encodeURIComponent(S.game) + '&provider=' + encodeURIComponent(provider) + '&origin=' + encodeURIComponent(location.origin), null);
    },
  };

  function popupLogin() {
    return popup(PORTAL + '/sdk/connect?game=' + encodeURIComponent(S.game) + '&origin=' + encodeURIComponent(location.origin), undefined);
  }
  // A portal popup that hands back a token. closed: what to resolve if the player closes it
  // (undefined means the current player).
  function popup(u, closed) {
    return new Promise(resolve => {
      const w = window.open(u, 'rg_signin', 'width=440,height=640');
      if (!w) { location.href = u + '&return=' + encodeURIComponent(location.href); return; }
      const done = v => { window.removeEventListener('message', onMsg); clearInterval(poll); resolve(v); };
      function onMsg(e) {
        if (e.origin !== PORTAL || !e.data || e.data.rg !== 1 || e.data.type !== 'connect') return;
        setAuth(e.data.data); done(S.user);
      }
      window.addEventListener('message', onMsg);
      const poll = setInterval(() => { if (w.closed) done(closed === undefined ? S.user || null : closed); }, 700);
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
      // friends: true ranks only the player and their friends.
      if (o.friends) { if (!await freshToken()) return bad('Sign in to see your friends\' scores.', { signin: true }); q.set('friends', '1'); }
      return call('GET', '/scores/' + S.game + '?' + q, null, !!o.friends);
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

  /* ---------- friends and the game's own level ---------- */

  // One friends list across RookieGamers. list() gives each friend's public profile (name, icon,
  // frame, RookieGamers level) plus, for this game, whether they play it and their level in it.
  const friendsApi = {
    async list() {
      await ready();
      if (S.mode === 'test') return ok({ friends: [{ id: 'p_friend', name: 'Test Friend', avatar: null, frame: null, level: 5, title: null, plays: true, lastPlayed: Date.now(), gameLevel: 2 }], requests: [] });
      if (!await freshToken()) return bad('Sign in to see your friends.', { signin: true });
      return call('GET', '/friends?game=' + encodeURIComponent(S.game), null, true);
    },
    // Sends a friend request (or accepts theirs). Resolves { ok, state: 'sent' | 'friends' }.
    async add(player) { return friendDo(player, 'add'); },
    async accept(player) { return friendDo(player, 'accept'); },
    async remove(player) { return friendDo(player, 'remove'); },
    // An invite link: whoever signs up through it becomes the player's friend.
    async invite(o) { return invite.link(o); },
  };
  async function friendDo(player, action) {
    await ready();
    if (S.mode === 'test') return ok({ state: action === 'remove' ? 'none' : 'sent' });
    if (!await freshToken()) return bad('Sign in first.', { signin: true });
    return call('POST', '/friends', { game: S.game, player: String(player && player.id || player || ''), action }, true);
  }

  // The game's own level for the player, separate from their RookieGamers level. A tenth of the XP
  // also counts toward the RookieGamers level (capped daily).
  const level = {
    async get() {
      await ready();
      if (S.mode === 'test') { const xp = S.test.xp || 0; const l = Math.floor((1 + Math.sqrt(1 + 8 * xp / 100)) / 2); return ok({ level: l, xp, levelXp: 50 * l * (l - 1), nextXp: 50 * (l + 1) * l }); }
      if (!await freshToken()) return bad('Sign in to earn levels.', { signin: true });
      return call('GET', '/level?game=' + encodeURIComponent(S.game), null, true);
    },
    // Gives 1 to 1000 XP. Resolves { ok, level, xp, levelXp, nextXp, levelUp }.
    async addXp(xp) {
      await ready();
      if (S.mode === 'test') { const before = (await level.get()).level; S.test.xp = (S.test.xp || 0) + Math.max(0, Math.floor(xp)); const r = await level.get(); return ok(Object.assign(r, { levelUp: r.level > before })); }
      if (!await freshToken()) return bad('Sign in to earn levels.', { signin: true });
      return call('POST', '/level', { game: S.game, xp }, true);
    },
  };

  /* ---------- cloud saves ---------- */

  // rg.data: signed in, saves live on the portal and follow the player to any device. Guests (and
  // test mode) keep them in this browser. Every write also lands in the browser first, so a save
  // survives a dropped connection. Writes to the portal are batched: rapid set() calls on a key send
  // only the latest value, at most every 3 seconds. On first sign-in, saves made as a guest move up.
  const localKey = k => 'rg.data.' + S.game + '.' + k;
  // Marks a key written while signed out, so only a guest's own saves move to the account that signs in.
  const guestKey = k => 'rg.guest.' + S.game + '.' + k;
  const cloud = { pid: null, saves: null, loading: null, timers: {}, waits: {} };
  async function signedIn() { return S.mode !== 'test' && !!(await freshToken()) && S.user && S.user.id; }
  async function loadCloud() {
    const pid = await signedIn();
    if (!pid) { cloud.pid = null; cloud.saves = null; return null; }
    if (cloud.pid === pid && cloud.saves) return cloud.saves;
    if (cloud.loading) return cloud.loading;
    cloud.loading = (async () => {
      const r = await call('GET', '/saves?game=' + encodeURIComponent(S.game), null, true);
      if (!r.ok) return null;
      cloud.pid = pid; cloud.saves = r.saves || {};
      // Saves made as a guest in this browser move to the account, unless the account already has that key.
      const prefix = guestKey(''), moving = [];
      try { for (let i = 0; i < localStorage.length; i++) { const gk = localStorage.key(i); if (gk && gk.indexOf(prefix) === 0) moving.push(gk.slice(prefix.length)); } } catch (e) { /* storage blocked */ }
      for (const k of moving) {
        const v = store.get(localKey(k));
        if (!cloud.saves[k] && v !== null) {
          const w = await call('POST', '/saves', { game: S.game, key: k, value: v, base: 0 }, true);
          if (!w.ok) continue;
          cloud.saves[k] = { value: v, version: w.version };
        }
        store.del(guestKey(k));
      }
      return cloud.saves;
    })();
    try { return await cloud.loading; } finally { cloud.loading = null; }
  }
  async function flush(k) {
    delete cloud.timers[k];
    const waits = cloud.waits[k] || []; delete cloud.waits[k];
    const saves = await loadCloud();
    let r;
    if (!saves) r = ok({ cloud: false });
    else {
      const cur = saves[k], v = store.get(localKey(k));
      r = await call('POST', '/saves', { game: S.game, key: k, value: v, base: cur ? cur.version : 0 }, true);
      if (r.ok) { if (v === null) delete saves[k]; else saves[k] = { value: v, version: r.version }; r = ok({ cloud: true, version: r.version }); }
      else if (r.conflict) {
        // Another device saved first. Its save wins; hand it back so the game can reload it.
        const c = r.current;
        if (c) { saves[k] = c; store.set(localKey(k), c.value); } else { delete saves[k]; store.del(localKey(k)); }
        r = bad(r.error, { conflict: true, value: c ? c.value : null });
      }
    }
    waits.forEach(fn => fn(r));
  }
  const data = {
    // The saved value, or null. Signed in, it's the cloud copy (refreshed when the player changes).
    async get(k) {
      await ready();
      const saves = await loadCloud();
      if (saves) { const c = saves[k]; if (c) store.set(localKey(k), c.value); return c ? c.value : (cloud.timers[k] ? store.get(localKey(k)) : null); }
      return store.get(localKey(k));
    },
    // Saves a value (anything JSON can hold, up to 256 KB). Resolves once the portal has it, with
    // { ok: false, conflict: true, value } if a newer save from another device won.
    async set(k, v) {
      await ready();
      k = String(k);
      if (v === undefined) v = null;
      if (v === null) store.del(localKey(k)); else store.set(localKey(k), v);
      if (S.mode === 'test' || !(await signedIn())) { if (v === null) store.del(guestKey(k)); else store.set(guestKey(k), 1); return ok({ cloud: false }); }
      store.del(guestKey(k));
      return new Promise(resolve => {
        (cloud.waits[k] = cloud.waits[k] || []).push(resolve);
        clearTimeout(cloud.timers[k]);
        cloud.timers[k] = setTimeout(() => flush(k), 3000);
      });
    },
    async del(k) { return data.set(k, null); },
    // Every key this game has saved for the player.
    async keys() {
      await ready();
      const saves = await loadCloud();
      if (saves) return Object.keys(saves);
      const prefix = localKey(''), out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const lk = localStorage.key(i); if (lk && lk.indexOf(prefix) === 0) out.push(lk.slice(prefix.length)); } } catch (e) { /* storage blocked */ }
      return out;
    },
    // Sends any batched writes now. Call it before the page closes or on a checkpoint.
    async flush() { await Promise.all(Object.keys(cloud.timers).map(k => { clearTimeout(cloud.timers[k]); return flush(k); })); return ok(); },
  };
  window.addEventListener('pagehide', () => { if (Object.keys(cloud.timers).length) data.flush(); });

  /* ---------- coming later: safe to call now ---------- */

  /* ---------- sharing and invites ---------- */

  // A share link from the portal. Signed in, it credits the player for the friends it brings.
  async function shareLink(o) {
    o = o || {};
    if (S.mode === 'test') return ok({ url: PORTAL + '/play/' + S.game + (o.room ? '?room=' + encodeURIComponent(o.room) : ''), text: o.text || 'Come play with me.', credited: true });
    return call('POST', '/shares', { game: S.game, score: o.score, room: o.room, text: o.text }, true);
  }

  async function share(o) {
    await ready(); o = o || {};
    if (S.mode === 'portal') return (await ask('share', { score: o.score, room: o.room, text: o.text }, 30 * 60000)) || bad('Sharing was cancelled.');
    const r = await shareLink(o);
    if (!r.ok) return r;
    if (S.mode === 'test') { log('would share', r.url); return ok({ url: r.url, credited: true, shared: 'test' }); }
    if (navigator.share) {
      try { await navigator.share({ title: document.title, text: r.text, url: r.url }); return ok({ url: r.url, credited: r.credited, shared: 'native' }); }
      catch (e) { if (e && e.name === 'AbortError') return ok({ url: r.url, credited: r.credited, shared: null }); }
    }
    try { await navigator.clipboard.writeText(r.url); toast('Link copied. Paste it anywhere to share.'); return ok({ url: r.url, credited: r.credited, shared: 'copy' }); }
    catch (e) { toast('Share this link: ' + r.url); return ok({ url: r.url, credited: r.credited, shared: null }); }
  }

  function toast(msg) {
    const old = document.getElementById('rg-toast'); if (old) old.remove();
    const el = document.createElement('div'); el.id = 'rg-toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 32px);padding:10px 16px;border-radius:999px;background:#16131f;color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4);word-break:break-all';
    document.body.appendChild(el); setTimeout(() => el.remove(), 4000);
  }

  const invite = {
    async link(o) { await ready(); o = o || {}; const r = await shareLink({ room: o.room, text: o.text }); return r.ok ? ok({ url: r.url, credited: r.credited }) : r; },
    room() { return qs.get('rg_room') || qs.get('room') || null; },
  };
  const guild = { async mine() { return null; }, async board() { return []; } };

  /* ---------- ads ---------- */

  // The portal serves every ad. Until the game joins the ad loop these resolve to
  // { shown: false }, so it's safe to wire them in from day one.
  function adFrame(url, view) {
    return new Promise(resolve => {
      const f = document.createElement('iframe');
      f.src = url; f.title = 'Ad'; f.allow = 'autoplay';
      f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:transparent';
      const done = v => { window.removeEventListener('message', onMsg); clearTimeout(t); f.remove(); resolve(v); };
      // The ad frame is ours (we made it), so trust its window. Its origin reads "null" when the
      // game page is itself sandboxed, since the ad frame inherits the sandbox.
      function onMsg(e) { if ((e.origin === PORTAL || e.origin === 'null') && e.source === f.contentWindow && e.data && e.data.rg === 1 && e.data.type === 'ad-done' && e.data.view === view) done(e.data.data || {}); }
      window.addEventListener('message', onMsg);
      const t = setTimeout(() => done({ shown: false, rewarded: false }), 3 * 60000);
      document.body.appendChild(f);
    });
  }

  async function showAd(format, o) {
    await ready(); o = o || {};
    const sku = o.sku ? String(o.sku) : undefined;
    const hook = fn => { if (typeof fn === 'function') try { fn(); } catch (e) { console.error(e); } };
    const before = () => { setMute('ad', true); hook(o.before); }, after = () => { hook(o.after); setMute('ad', false); };
    let r;
    if (S.mode === 'test') {
      before();
      await new Promise(res => { toast('Test ad (' + format + ')'); setTimeout(res, 1200); });
      r = { shown: true, rewarded: format === 'rewarded', receipt: format === 'rewarded' ? 'test-receipt' : undefined };
      if (sku) { S.test.owned = S.test.owned || []; if (!S.test.owned.includes(sku)) S.test.owned.push(sku); r.unlocked = true; r.sku = sku; }
      after();
      return ok(r);
    }
    if (S.mode === 'portal') {
      before();
      r = await ask('ad', { format, sku }, 4 * 60000) || { shown: false, rewarded: false };
    } else {
      const start = await call('POST', '/ads/start', { game: S.game, format, sku, mode: 'standalone' }, true);
      if (!start.ok || !start.fill) return ok({ shown: false, rewarded: false, reason: start.reason || start.error, signin: !!start.signin });
      before();
      r = await adFrame(start.url, start.view);
    }
    after();
    if (r.error) return bad(r.error);
    return ok(Object.assign({ shown: false, rewarded: false }, r));
  }
  const ads = {
    // { rewarded, midgame }: which ad formats this game can show right now.
    async available() { await ready(); if (S.mode === 'test') return ok({ rewarded: true, midgame: true }); return call('GET', '/ads/status?game=' + S.game); },
    midgame(o) { return showAd('midgame', o); },
    rewarded(o) { return showAd('rewarded', o); },
  };

  /* ---------- the game's store ---------- */

  function waitForOrder(order, w) {
    return new Promise(resolve => {
      let left = 30 * 60, closedAt = 0;
      const tick = async () => {
        const r = await call('GET', '/store/orders/' + order + '?game=' + S.game, null, true);
        if (r.ok && r.paid) return resolve(true);
        if (w && w.closed && !closedAt) closedAt = Date.now();
        // Webhooks can lag a few seconds behind the checkout window closing.
        if ((closedAt && Date.now() - closedAt > 20000) || --left <= 0) return resolve(false);
        setTimeout(tick, 2000);
      };
      setTimeout(tick, 2000);
    });
  }
  const storeApi = {
    // { items: [{ sku, title, kind, priceCents, adUnlock, adProgress, coinPriceCents, owned }], owned }
    async items() {
      await ready();
      if (S.mode === 'test') return ok({ items: [{ sku: 'sample.skin', title: 'Sample skin', blurb: '', kind: 'item', priceCents: 199, currency: 'usd', adUnlock: 3, adProgress: 0, owned: (S.test.owned || []).includes('sample.skin') }], owned: (S.test.owned || []).map(sku => ({ sku, source: 'test', expiresAt: null })) });
      return call('GET', '/store/' + S.game, null, true);
    },
    // What the player owns: [{ sku, source, expiresAt }]. Empty for guests.
    async owned() { const r = await storeApi.items(); return r.ok ? r.owned : []; },
    async has(sku) { return (await storeApi.owned()).some(o => o.sku === sku); },
    async buy(sku, o) {
      await ready(); o = o || {};
      if (S.mode === 'test') { S.test.owned = S.test.owned || []; if (!S.test.owned.includes(sku)) S.test.owned.push(sku); return ok({ bought: true, sku }); }
      if (!await freshToken()) { await user.login(); if (!await freshToken()) return bad('Sign in to buy.', { signin: true }); }
      const w = window.open('about:blank', 'rg_checkout', 'width=520,height=760');
      const r = await call('POST', '/store/checkout', { game: S.game, sku, method: o.method }, true);
      if (!r.ok) { if (w) w.close(); return r; }
      if (!w) return bad('The checkout window was blocked. Allow pop-ups and try again.', { url: r.url });
      w.location.href = r.url;
      const paid = await waitForOrder(r.order, w);
      return ok({ bought: paid, sku, order: r.order });
    },
    // Unlock an item by watching rewarded ads (the developer sets how many).
    unlock(sku, o) { return showAd('rewarded', Object.assign({}, o, { sku })); },
  };
  const wallet = { available: false, async get() { return null; } };

  window.rg = { version: '1.7.0', portal: PORTAL, staging: STAGING, init, game, user, scores, friends: friendsApi, level, fame, promo, share, data, invite, store: storeApi, guild, ads, audio, wallet,
    get mode() { return S.mode; } };
  if (SCRIPT && SCRIPT.dataset.game) init({ game: SCRIPT.dataset.game });
})();
