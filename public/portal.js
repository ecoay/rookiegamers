// The portal side of the SDK bridge, on /play/<slug>. The game frame asks; this page answers with
// a player token for that one game, opens sign-in, and handles "play next". It only listens to
// its own game frame, and only answers origins that game is registered on.
(function () {
  const B = window.RG_PLAY;
  const frame = document.getElementById('game');
  if (!B || !frame) return;
  let ready = false;

  const allowed = o => B.origins.includes(o);
  const target = () => (B.origins[0] === 'null' ? '*' : null);
  function send(msg, origin) { frame.contentWindow.postMessage(Object.assign({ rg: 1 }, msg), target() || origin); }
  let gameOrigin = null;

  async function token() {
    try {
      const r = await fetch('/api/v1/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: B.game }) });
      return r.ok ? await r.json() : { token: null, user: null };
    } catch (e) { return { token: null, user: null }; }
  }

  // Sign-in opens in a popup so the game keeps its state. Email links open in a new tab, so we
  // also watch for the session cookie to appear.
  let waiting = null;
  function login() {
    if (waiting) return waiting;
    waiting = new Promise(resolve => {
      const dlg = document.getElementById('signinDlg');
      const finish = async () => {
        clearInterval(poll); window.removeEventListener('message', onMsg); window.removeEventListener('focus', check);
        if (dlg.open) dlg.close();
        waiting = null;
        const a = await token();
        if (a.user) refreshHeader(a.user);
        resolve(a);
      };
      const check = async () => { const a = await token(); if (a.user) finish(); };
      const onMsg = e => { if (e.origin === location.origin && e.data && e.data.rg === 1 && e.data.type === 'signed-in') finish(); };
      let poll = null;
      const open = () => {
        const w = window.open('/signin?popup=1&next=/auth/done', 'rg_signin', 'width=460,height=680');
        if (!w) { location.href = '/signin?next=' + encodeURIComponent(location.pathname); return; }
        window.addEventListener('message', onMsg);
        window.addEventListener('focus', check);
        poll = setInterval(check, 3000);
        setTimeout(() => { if (waiting) { clearInterval(poll); } }, 15 * 60000);
      };
      document.getElementById('dlgGo').onclick = () => { open(); };
      document.getElementById('dlgNo').onclick = () => { dlg.close(); clearInterval(poll); waiting = null; resolve({ token: null, user: null }); };
      dlg.showModal();
    });
    return waiting;
  }

  // The share sheet. Signed-in players get a link that credits them with the friends it brings.
  const NETS = [
    ['X', (u, t) => 'https://x.com/intent/post?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u)],
    ['WhatsApp', (u, t) => 'https://wa.me/?text=' + encodeURIComponent(t + ' ' + u)],
    ['Facebook', u => 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u)],
    ['Reddit', (u, t) => 'https://www.reddit.com/submit?url=' + encodeURIComponent(u) + '&title=' + encodeURIComponent(t)],
    ['Telegram', (u, t) => 'https://t.me/share/url?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t)],
    ['Email', (u, t) => 'mailto:?subject=' + encodeURIComponent(B.title + ' on RookieGamers') + '&body=' + encodeURIComponent(t + '\n\n' + u)],
  ];
  let sharing = null;
  function share(opts) {
    if (sharing) return sharing;
    sharing = new Promise(async resolve => {
      const o = opts || {};
      let r = null;
      try {
        const res = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: B.game, score: o.score, room: o.room, text: o.text }) });
        r = await res.json();
        if (!res.ok) r = null;
      } catch (e) { r = null; }
      if (!r) { sharing = null; return resolve({ ok: false, error: 'Couldn\'t make a share link.' }); }
      const dlg = document.getElementById('shareDlg');
      const nets = document.getElementById('shareNets');
      const input = document.getElementById('shareUrl');
      let how = null;
      document.getElementById('shareText').textContent = r.text;
      input.value = r.url;
      nets.textContent = '';
      if (navigator.share) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'More...';
        b.onclick = () => navigator.share({ title: B.title, text: r.text, url: r.url }).then(() => { how = 'native'; dlg.close(); }).catch(() => {});
        nets.append(b);
      }
      for (const [name, link] of NETS) {
        const a = document.createElement('a'); a.textContent = name; a.href = link(r.url, r.text); a.target = '_blank'; a.rel = 'noopener';
        a.onclick = () => { how = name.toLowerCase(); };
        nets.append(a);
      }
      document.getElementById('shareCopy').onclick = async () => {
        input.select();
        try { await navigator.clipboard.writeText(r.url); } catch (e) { document.execCommand('copy'); }
        how = how || 'copy'; document.getElementById('shareCopy').textContent = 'Copied';
      };
      document.getElementById('shareClose').onclick = () => dlg.close();
      dlg.addEventListener('close', () => { document.getElementById('shareCopy').textContent = 'Copy'; sharing = null; resolve({ ok: true, url: r.url, credited: r.credited, shared: how }); }, { once: true });
      dlg.showModal();
    });
    return sharing;
  }
  // Ads run on the portal page, over the game, so the game never touches ad code.
  let adOpen = null;
  function showAd(o) {
    if (adOpen) return adOpen;
    adOpen = (async () => {
      const a = await token();
      const headers = { 'content-type': 'application/json' };
      if (a.token) headers.authorization = 'Bearer ' + a.token;
      let s = null;
      try { s = await (await fetch('/api/v1/ads/start', { method: 'POST', headers, body: JSON.stringify({ game: B.game, format: o.format, sku: o.sku, mode: 'portal' }) })).json(); } catch (e) { s = null; }
      if (!s || !s.fill) return { shown: false, rewarded: false, reason: s ? s.reason || s.error : 'offline', signin: !!(s && s.signin) };
      return new Promise(resolve => {
        const f = document.createElement('iframe');
        f.src = s.url; f.title = 'Ad'; f.allow = 'autoplay';
        f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:transparent';
        const done = v => { window.removeEventListener('message', onMsg); clearTimeout(t); f.remove(); resolve(v); };
        const onMsg = e => { if (e.origin === location.origin && e.source === f.contentWindow && e.data && e.data.rg === 1 && e.data.type === 'ad-done' && e.data.view === s.view) done(e.data.data || {}); };
        window.addEventListener('message', onMsg);
        const t = setTimeout(() => done({ shown: false, rewarded: false }), 3 * 60000);
        document.body.appendChild(f);
      });
    })().finally(() => { adOpen = null; });
    return adOpen;
  }

  // The clip banner: a promoted clip, or one from the free cross-promo rotation.
  (async () => {
    const box = document.getElementById('rgBanner');
    if (!box) return;
    try {
      const r = await (await fetch('/api/v1/ads/banner?game=' + encodeURIComponent(B.game))).json();
      if (!r.clip) return;
      const h = document.createElement('h3');
      const t = document.createElement('span'); t.textContent = r.clip.gameTitle;
      const tag = document.createElement('span'); tag.className = 'muted small'; tag.textContent = r.promoted ? 'Sponsored' : 'Featured';
      h.append(t, tag);
      const v = document.createElement('video');
      v.src = r.clip.url; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
      v.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#000;display:block';
      const a = document.createElement('a'); a.className = 'btn small'; a.href = r.clip.play; a.textContent = 'Play ' + r.clip.gameTitle; a.style.marginTop = '10px';
      box.append(h, v, a);
      box.hidden = false;
    } catch (e) { /* no banner */ }
  })();

  const sb = document.getElementById('shareBtn');
  if (sb) sb.onclick = () => share({});

  function refreshHeader(user) {
    const link = document.getElementById('signinLink');
    if (!link || !user) return;
    const a = document.createElement('a');
    a.className = 'me'; a.href = '/u/' + user.id;
    const img = document.createElement('img'); img.src = user.avatar; img.alt = '';
    a.append(img, ' ' + user.name + ' ');
    const lv = document.createElement('span'); lv.className = 'muted'; lv.textContent = 'Lv ' + user.level; a.append(lv);
    link.replaceWith(a);
  }

  window.addEventListener('message', async e => {
    if (e.source !== frame.contentWindow || !e.data || e.data.rg !== 1) return;
    if (!allowed(e.origin)) return;
    gameOrigin = e.origin;
    const m = e.data;
    const answer = data => send({ re: m.id, data }, e.origin);
    switch (m.type) {
      case 'hello': ready = true; return answer({ game: B.game, ref: B.ref, auth: await token() });
      case 'token': return answer(await token());
      case 'login': return answer(await login());
      case 'share': return answer(await share(m.data));
      case 'ad': return answer(await showAd(m.data || {}));
      case 'game':
        document.body.dataset.playing = m.data && m.data.event === 'start' ? '1' : '0';
        if (m.data && m.data.event === 'stop') setTimeout(refreshBoards, 1500);
        return;
      case 'go':
        if (m.data && /^[a-z0-9-]{1,32}$/.test(m.data.slug)) location.href = '/play/' + m.data.slug + '?ref=' + B.game;
        return;
    }
  });

  // Tell the game when someone signs in from the header instead of from the game.
  window.addEventListener('focus', async () => {
    if (!ready || !gameOrigin || waiting) return;
    const a = await token();
    if (a.user) { send({ type: 'auth', data: a }, gameOrigin); refreshHeader(a.user); }
  });

  // Keep the side boards current after a round, without reloading the page.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function refreshBoards() {
    for (const [id, board] of [['bm', 'monthly'], ['ba', 'alltime']]) {
      try {
        const r = await fetch('/api/v1/scores/' + B.game + '?limit=10&board=' + board);
        if (!r.ok) continue;
        const rows = (await r.json()).rows;
        if (!rows.length) continue;
        document.getElementById(id).innerHTML = '<ol class="board">' + rows.map(x => '<li class="top' + x.rank + '"><span class="n">' + x.rank + '</span><span class="who"><a href="/u/' + esc(x.player.id) + '">' + esc(x.player.name) + '</a>' + (x.player.title ? '<small>' + esc(x.player.title) + '</small>' : '') + '</span><span class="s">' + Number(x.score).toLocaleString('en-US') + '</span></li>').join('') + '</ol>';
      } catch (e) { /* keep the old board */ }
    }
  }
  setInterval(() => { if (document.visibilityState === 'visible') refreshBoards(); }, 60000);

  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.getElementById('bm').hidden = b.dataset.b !== 'm';
    document.getElementById('ba').hidden = b.dataset.b !== 'a';
  });
  const fs = document.getElementById('fs');
  if (fs) fs.onclick = () => (frame.requestFullscreen ? frame.requestFullscreen() : frame.webkitRequestFullscreen && frame.webkitRequestFullscreen());
})();
