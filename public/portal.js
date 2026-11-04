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
