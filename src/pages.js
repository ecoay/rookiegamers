import { getGame, getPlayer, publicPlayer, gameView, monthKey, monthLabel, levelFor, safeJSON } from './db.js';
import { sessionPlayer, providers, safeNext } from './auth.js';
import { frontPage, topScores, fame, sealIfDue } from './play.js';
import { isDeveloper, myGames, listKeys, siteURL } from './dev.js';
import { mintFor } from './api.js';
import SDK_DOCS from '../docs/SDK.md';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
// Inline JSON safely inside <script>.
const data = v => JSON.stringify(v).replace(/</g, '\\u003c');

function layout({ title, desc, me, active, body, url, scripts = '' }) {
  const t = title ? `${title} · RookieGamers` : 'RookieGamers · free web games, one account';
  const nav = [['/', 'Games'], ['/hall-of-fame', 'Hall of Fame'], ['/dev', 'Publish'], ['/docs', 'SDK']];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title><meta name="description" content="${esc(desc || 'Play free web games from indie developers, with one account, one level and one Hall of Fame across every game.')}">
<meta property="og:title" content="${esc(t)}"><meta property="og:type" content="website">${url ? `<link rel="canonical" href="${esc(url)}">` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"></head><body>
<header class="top"><div class="wrap"><a class="logo" href="/"><b>RG</b>RookieGamers</a>
<nav class="main">${nav.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
${me ? `<a class="me" href="/u/${esc(me.id)}"><img src="${esc(me.avatar)}" alt="">${esc(me.name)} <span class="muted">Lv ${me.level}</span></a>` : `<a class="btn small" href="/signin?next=${encodeURIComponent(active || '/')}" id="signinLink">Sign in</a>`}
</div></header><main><div class="wrap">${body}</div></main>
<footer class="foot"><div class="wrap"><span>RookieGamers</span><a href="/docs">SDK docs</a><a href="/dev">Publish a game</a><a href="/hall-of-fame">Hall of Fame</a><span>Accounts are for players 13 and up.</span></div></footer>
${scripts}</body></html>`;
}

async function viewer(DB, req) {
  const pid = await sessionPlayer(DB, req);
  const p = pid && await getPlayer(DB, pid);
  return p ? publicPlayer(p) : null;
}

const initial = s => esc((s || '?').trim().charAt(0).toUpperCase());
function art(g) {
  const color = /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#8f6bff';
  const cover = g.cover ? (/^https:\/\//.test(g.cover) ? g.cover : null) : null;
  return `<div class="art" style="background:${cover ? `url('${esc(cover)}') center/cover,` : ''}linear-gradient(135deg,${color},#191626)">${cover ? '' : initial(g.title)}</div>`;
}
function card(g) {
  const mins = Math.round((g.stats?.perPlayer || 0) / 60000);
  return `<a class="card" href="/play/${esc(g.slug)}">${g.isNew ? '<span class="pill">New</span>' : ''}${g.multiplayer ? '<span class="pill alt">Multiplayer</span>' : ''}
${art(g)}<div class="body"><h3>${esc(g.title)}</h3><p>${esc(g.blurb)}</p><div class="meta">by ${esc(g.developer)}${mins ? ` · ${mins} min per player` : ''}</div></div></a>`;
}

function boardList(rows, label) {
  if (!rows.length) return `<p class="muted">No ${esc(label.toLowerCase())} yet this month. Be the first.</p>`;
  return `<ol class="board">${rows.map(r => `<li class="top${r.rank}"><span class="n">${r.rank}</span><span class="who"><a href="/u/${esc(r.player.id)}">${esc(r.player.name)}</a>${r.player.title ? `<small>${esc(r.player.title)}</small>` : ''}</span><span class="s">${r.score.toLocaleString('en-US')}</span></li>`).join('')}</ol>`;
}

/* ---------- pages ---------- */

async function home(DB, req, env) {
  const [me, games] = await Promise.all([viewer(DB, req), frontPage(DB)]);
  const body = `<section class="hero"><h1>Indie web games. <em>One account for all of them.</em></h1>
<p class="lede">Play free games from indie developers. Your level, your titles and your Hall of Fame follow you into every game, and every game sends you to the next.</p></section>
<h2>Play now</h2>${games.length ? `<div class="shelf">${games.map(card).join('')}</div>` : '<div class="empty">The first games are on their way.</div>'}
<h2>Make games? Publish them here.</h2>
<p class="lede">Build with your AI or by hand. Connect Claude Code, Codex or Grok to RookieGamers and publish straight from your editor. AI-built games are welcome: we judge games on whether they're fun. <a href="/dev">Start publishing</a>.</p>`;
  return html(layout({ me, active: '/', body, url: siteURL(env) + '/' }));
}

function frameFor(env, g, url) {
  if (g.kind === 'linked') return { src: g.url, origins: safeJSON(g.origins, []), sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock allow-modals' };
  if (!g.version) return null;
  // Hosted builds come from a separate games host so they can't touch portal cookies or storage.
  if (env.GAMES_HOST) {
    const origin = `https://${env.GAMES_HOST}`;
    return { src: `${origin}/${g.slug}/`, origins: [origin], sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock' };
  }
  // No games host yet (local or workers.dev): serve from here, sandboxed to an opaque origin.
  return { src: `${url.origin}/hosted/${g.slug}/`, origins: ['null'], sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock' };
}

async function play(DB, req, env, url, slug) {
  const g = await getGame(DB, slug);
  const me = await viewer(DB, req);
  if (!g || !g.live) return notFound(me, 'That game isn\'t here (yet).');
  const frame = frameFor(env, g, url);
  if (!frame) return notFound(me, 'This game is still being uploaded.');
  const ref = /^[a-z0-9-]{1,32}$/.test(url.searchParams.get('ref') || '') ? url.searchParams.get('ref') : null;
  const src = new URL(frame.src);
  if (ref) src.searchParams.set('rg_ref', ref);
  const [monthly, alltime, hall, others] = await Promise.all([topScores(DB, g, monthKey(), 10), topScores(DB, g, 'all', 10), fame(DB, { game: g.slug, limit: 9 }), frontPage(DB)]);
  const more = others.filter(o => o.slug !== g.slug).slice(0, 4);
  const v = gameView(g);
  const body = `<div class="play"><div><div class="stage"><iframe id="game" src="${esc(src.href)}" title="${esc(g.title)}" sandbox="${frame.sandbox}" allow="autoplay; fullscreen; gamepad; clipboard-write; screen-wake-lock" allowfullscreen></iframe></div>
<div class="stagebar"><div><h1>${esc(g.title)}</h1><span class="muted">by ${esc(g.developer)}</span></div><button class="btn ghost small" id="fs" type="button">Full screen</button></div>
<p class="muted">${esc(g.blurb)}</p></div>
<aside class="side"><div class="panel"><h3><span>${esc(g.score_label)}</span><span class="tabs"><button type="button" data-b="m" aria-pressed="true">${esc(monthLabel(monthKey()))}</button><button type="button" data-b="a" aria-pressed="false">All time</button></span></h3>
<div id="bm">${boardList(monthly, g.score_label)}</div><div id="ba" hidden>${boardList(alltime, g.score_label)}</div></div>
<div class="panel"><h3>Hall of Fame</h3>${hall.length ? `<ol class="board">${hall.map(h => `<li class="top${h.rank}"><span class="n">${h.rank}</span><span class="who"><a href="/u/${esc(h.player.id)}">${esc(h.player.name)}</a><small>${esc(h.monthLabel)}</small></span><span class="s">${h.score.toLocaleString('en-US')}</span></li>`).join('')}</ol>` : '<p class="muted">At the end of each month the top 3 are kept here forever and earn a title shown across RookieGamers.</p>'}</div>
${more.length ? `<div class="panel"><h3>Play next</h3><div class="shelf" style="grid-template-columns:repeat(2,minmax(0,1fr))">${more.map(card).join('')}</div></div>` : ''}</aside></div>
<dialog class="signin" id="signinDlg"><h3 style="margin-top:0">Sign in to save your scores</h3><p class="muted">One RookieGamers account works in every game.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="dlgGo" type="button">Sign in</button><button class="btn ghost" id="dlgNo" type="button">Keep playing as a guest</button></div></dialog>`;
  const boot = { game: v.slug, title: v.title, origins: frame.origins, ref };
  return html(layout({ title: g.title, desc: g.blurb, me, active: '/play/' + g.slug, body, url: siteURL(env) + '/play/' + g.slug,
    scripts: `<script>window.RG_PLAY=${data(boot)}</script><script src="/portal.js"></script>` }));
}

async function hallOfFame(DB, req, env) {
  await sealIfDue(DB);
  const [me, rows] = await Promise.all([viewer(DB, req), fame(DB, { limit: 600 })]);
  const months = {};
  for (const r of rows) ((months[r.month] ||= {})[r.game] ||= { title: r.gameTitle, rows: [] }).rows.push(r);
  const body = `<h1>Hall of Fame</h1><p class="lede">Every month, the top 3 players in every game are kept here forever. Champions wear their title in every game on RookieGamers.</p>
${Object.keys(months).length ? Object.entries(months).map(([m, games]) => `<section class="fame-month"><h2>${esc(monthLabel(m))}</h2><div class="fame-grid">${Object.entries(games).map(([slug, g]) => `<div class="panel"><h3><a href="/play/${esc(slug)}">${esc(g.title)}</a></h3>${boardList(g.rows, 'champions')}</div>`).join('')}</div></section>`).join('')
    : `<div class="empty">The first champions are crowned on ${esc(monthLabel(monthKey()))}'s last day. Go set a score.</div>`}`;
  return html(layout({ title: 'Hall of Fame', me, active: '/hall-of-fame', body, url: siteURL(env) + '/hall-of-fame' }));
}

async function profilePage(DB, req, env, id) {
  const me = await viewer(DB, req);
  const p = await getPlayer(DB, id);
  if (!p) return notFound(me, 'No player here.');
  const pub = publicPlayer(p);
  const lv = pub.level, floor = 50 * lv * (lv - 1), next = 50 * (lv + 1) * lv;
  const [games, titles] = await Promise.all([
    DB.prepare(`SELECT g.slug, g.title, g.score_label, g.score_order, SUM(pl.ms) AS ms, MAX(pl.started_at) AS last,
      (SELECT score FROM scores s WHERE s.game = g.slug AND s.month = 'all' AND s.player_id = ?) AS best
      FROM plays pl JOIN games g ON g.slug = pl.game WHERE pl.player_id = ? GROUP BY g.slug ORDER BY last DESC`).bind(id, id).all(),
    DB.prepare('SELECT title FROM titles WHERE player_id = ? ORDER BY at DESC').bind(id).all(),
  ]);
  const mine = me && me.id === id;
  const body = `<div class="prof"><img src="${esc(pub.avatar)}" alt=""><div><h1 style="margin:0">${esc(pub.name)}</h1>${pub.title ? `<div style="color:var(--violet);font-weight:600">${esc(pub.title)}</div>` : ''}
<div class="muted">Level ${lv} · ${pub.xp.toLocaleString('en-US')} XP</div><div class="xp" style="margin-top:6px"><i style="width:${Math.min(100, Math.round((pub.xp - floor) / Math.max(1, next - floor) * 100))}%"></i></div></div></div>
${mine ? `<h2>Your profile</h2><form class="form" id="profForm"><input name="name" maxlength="18" value="${esc(pub.name)}" aria-label="Display name">
${titles.results.length ? `<select name="title" style="padding:10px;border-radius:12px;background:var(--panel2);color:var(--text);border:1px solid var(--line)"><option value="">No title</option>${titles.results.map(t => `<option${t.title === pub.title ? ' selected' : ''}>${esc(t.title)}</option>`).join('')}</select>` : ''}
<div style="display:flex;gap:8px"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" id="signOut">Sign out</button></div><div id="profMsg"></div></form>` : ''}
<h2>Games played</h2>${games.results.length ? `<table class="t"><tr><th>Game</th><th>Best</th><th>Played</th></tr>${games.results.map(r => `<tr><td><a href="/play/${esc(r.slug)}">${esc(r.title)}</a></td><td>${r.best == null ? '<span class="muted">-</span>' : `${r.best.toLocaleString('en-US')} <span class="muted">${esc(r.score_label.toLowerCase())}</span>`}</td><td>${Math.max(1, Math.round(r.ms / 60000))} min</td></tr>`).join('')}</table>` : '<p class="muted">No games yet.</p>'}
${titles.results.length ? `<h2>Titles</h2><ul>${titles.results.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul>` : ''}`;
  const script = mine ? `<script>
document.getElementById('profForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/me',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:f.get('name'),title:f.has('title')?f.get('title'):undefined})});document.getElementById('profMsg').innerHTML=r.ok?'<div class="note ok">Saved.</div>':'<div class="note err">Couldn\\'t save.</div>';if(r.ok)setTimeout(()=>location.reload(),500)};
document.getElementById('signOut').onclick=async()=>{await fetch('/api/auth/signout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});location.href='/'};
</script>` : '';
  return html(layout({ title: pub.name, me, body, scripts: script }));
}

function signinPage(env, me, url) {
  const p = providers(env);
  const next = safeNext(url.searchParams.get('next'));
  const popup = url.searchParams.get('popup') === '1';
  const msg = url.searchParams.has('expired') ? '<div class="note err">That link expired or was already used. Send a new one.</div>'
    : url.searchParams.has('failed') ? '<div class="note err">Sign-in didn\'t go through. Try again.</div>' : '';
  const body = `<h1>Sign in</h1><p class="lede">One account for every game on RookieGamers: your level, scores and titles follow you everywhere.</p>${msg}
${me ? `<div class="note ok">You're signed in as ${esc(me.name)}. <a href="${esc(next)}">Continue</a></div>` : ''}
<div class="form">${p.oidc ? `<a class="btn" href="/auth/oidc?next=${encodeURIComponent(next)}">Sign in with ${esc(p.oidc.name)}</a><div class="muted" style="text-align:center">or</div>` : ''}
${p.email ? `<form class="form" id="emailForm"><input type="email" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Email">
<label class="check"><input type="checkbox" name="age" required> I'm 13 or older. Under 13? You can still play every game as a guest.</label>
<button class="btn" type="submit">Email me a sign-in link</button><div id="emailMsg"></div></form>` : (p.oidc ? '' : '<div class="note">Sign-in isn\'t switched on yet. You can still play every game as a guest.</div>')}</div>`;
  const script = `<script>
const f=document.getElementById('emailForm');if(f)f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f);const b=f.querySelector('button');b.disabled=true;
const r=await fetch('/api/auth/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:d.get('email'),age:d.get('age')==='on',next:${data(popup ? '/auth/done' : next)}})});const j=await r.json().catch(()=>({}));b.disabled=false;
document.getElementById('emailMsg').innerHTML=r.ok?'<div class="note ok">Check your inbox for a sign-in link. '+(j.devLink?'<a href="'+j.devLink+'" id="devLink">Dev sign-in link</a>':'')+'</div>':'<div class="note err"></div>';if(!r.ok)document.querySelector('#emailMsg .err').textContent=j.error||'Something went wrong.'};
</script>`;
  return html(layout({ title: 'Sign in', me, body, scripts: script }));
}

// After a sign-in that started in a popup, tell the page that opened it, then close.
function authDone() {
  return html(`<!doctype html><meta charset="utf-8"><title>Signed in</title><body style="background:#0f0d16;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh">
<p>You're signed in. You can close this window.</p><script>try{if(window.opener)window.opener.postMessage({rg:1,type:'signed-in'},location.origin)}catch(e){}setTimeout(()=>window.close(),300)</script>`);
}

// The sign-in popup a game on its own site opens. It hands a token only to an origin that game lists.
async function connect(DB, req, env, url) {
  const me = await viewer(DB, req);
  const g = await getGame(DB, String(url.searchParams.get('game') || ''));
  const origin = String(url.searchParams.get('origin') || '');
  const back = url.searchParams.get('return');
  const origins = g ? safeJSON(g.origins, []) : [];
  const devOrigin = env.DEV_LOGIN === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!g || !(origins.includes(origin) || devOrigin)) return html(layout({ me, title: 'Sign in', body: '<h1>Can\'t sign in here</h1><p class="lede">This game isn\'t set up for RookieGamers sign-in from that site.</p>' }), 400);
  if (!me) return Response.redirect(`${url.origin}/signin?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  if (url.searchParams.get('ok') !== '1') {
    const body = `<h1>Play ${esc(g.title)} as ${esc(me.name)}?</h1><p class="lede">${esc(g.title)} will see your RookieGamers name, level and title, and can save your scores. It never sees your email or password.</p>
<div style="display:flex;gap:8px"><a class="btn" href="${esc(url.pathname + url.search)}&ok=1">Continue</a><button class="btn ghost" type="button" onclick="window.close()">Cancel</button></div>`;
    return html(layout({ me, title: 'Sign in', body }));
  }
  const auth = await mintFor(DB, env, me.id, g.slug);
  const payload = { ...auth, game: g.slug };
  if (back) {
    let b; try { b = new URL(back); } catch { b = null; }
    if (b && b.origin === origin) {
      const frag = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
      return Response.redirect(`${b.origin}${b.pathname}${b.search}#rg_connect=${frag}`, 302);
    }
  }
  return html(`<!doctype html><meta charset="utf-8"><title>Signed in</title><body style="background:#0f0d16;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh"><p>Signed in. Back to ${esc(g.title)}...</p>
<script>window.opener&&window.opener.postMessage({rg:1,type:'connect',data:${data(payload)}},${data(origin)});setTimeout(()=>window.close(),300)</script>`);
}

async function devPage(DB, req, env, url) {
  const me = await viewer(DB, req);
  const site = siteURL(env);
  const invite = url.searchParams.get('invite') || '';
  const agents = `<h2>Publish from your AI</h2><p class="lede">Your agent reads the SDK docs, writes the game, tests it, and publishes it, all through one MCP server: <code>${esc(site)}/mcp</code>. Set <code>ROOKIEGAMERS_API_KEY</code> to a key from this page first.</p>
<div class="agents"><div class="panel"><h3>Claude Code</h3><pre><code>/plugin marketplace add ecoay/rookiegamers
/plugin install rookiegamers@rookiegamers</code></pre><p class="muted">Or just the MCP server:</p><pre><code>claude mcp add --transport http rookiegamers ${esc(site)}/mcp \\
  --header "Authorization: Bearer $ROOKIEGAMERS_API_KEY"</code></pre></div>
<div class="panel"><h3>Codex</h3><p class="muted">In <code>~/.codex/config.toml</code>:</p><pre><code>[mcp_servers.rookiegamers]
url = "${esc(site)}/mcp"
bearer_token_env_var = "ROOKIEGAMERS_API_KEY"</code></pre></div>
<div class="panel"><h3>Grok</h3><p class="muted">Add a remote MCP tool to an xAI API call:</p><pre><code>{ "type": "mcp",
  "server_url": "${esc(site)}/mcp",
  "server_label": "rookiegamers",
  "authorization": "Bearer rgk_..." }</code></pre></div>
<div class="panel"><h3>CLI</h3><pre><code>curl -O ${esc(site)}/rg.mjs
node rg.mjs init my-game
node rg.mjs deploy ./my-game --game my-game</code></pre></div></div>`;
  if (!me) return html(layout({ title: 'Publish', me, active: '/dev', body: `<h1>Publish your game on RookieGamers</h1><p class="lede">Every game on RookieGamers shares one player base. Your players find other games, and their players find yours. AI-built games are welcome.</p><a class="btn" href="/signin?next=${encodeURIComponent('/dev' + (invite ? '?invite=' + invite : ''))}">Sign in to start</a>${agents}` }));
  const isDev = await isDeveloper(DB, me.id);
  if (!isDev) {
    const open = env.OPEN_DEVELOPERS === '1';
    const body = `<h1>Become a developer</h1><p class="lede">${open ? 'Publishing is open. One click and you can make API keys and publish games.' : 'Publishing is invite-only while we start. Paste your invite code, or open the invite link you were sent.'}</p>
<form class="form" id="joinForm">${open ? '' : `<input name="invite" value="${esc(invite)}" placeholder="inv_..." aria-label="Invite code" required>`}<button class="btn" type="submit">Become a developer</button><div id="joinMsg"></div></form>${agents}`;
    return html(layout({ title: 'Publish', me, active: '/dev', body, scripts: `<script>document.getElementById('joinForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/dev/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({invite:f.get('invite')})});const j=await r.json();if(r.ok)location.href='/dev';else{const m=document.getElementById('joinMsg');m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=j.error}}</script>` }));
  }
  const [games, keys] = await Promise.all([myGames(DB, me.id), listKeys(DB, me.id)]);
  const body = `<h1>Developer</h1><p class="lede">Make an API key, connect your AI or the CLI, and publish. Games go live as soon as they pass the checks.</p>
<h2>Your games</h2>${games.length ? `<table class="t"><tr><th>Game</th><th>Kind</th><th>Status</th><th>Version</th></tr>${games.map(g => `<tr><td>${g.live ? `<a href="/play/${esc(g.slug)}">${esc(g.title)}</a>` : esc(g.title)}</td><td>${esc(g.kind)}</td><td>${g.live ? 'Live' : 'Not published'}</td><td>${esc(g.version || '-')}</td></tr>`).join('')}</table>` : '<p class="muted">No games yet. Create one with your agent, the CLI, or the API.</p>'}
<h2>API keys</h2><form class="form" id="keyForm" style="flex-direction:row;max-width:520px"><input name="label" placeholder="Key name, like laptop or claude" aria-label="Key name"><button class="btn" type="submit">Make key</button></form><div id="keyMsg" style="margin:10px 0"></div>
${keys.length ? `<table class="t"><tr><th>Name</th><th>Key</th><th>Last used</th><th></th></tr>${keys.map(k => `<tr><td>${esc(k.label)}</td><td><code>${esc(k.prefix)}...</code></td><td>${k.used_at ? new Date(k.used_at).toISOString().slice(0, 10) : 'never'}</td><td><button class="btn ghost small" data-del="${esc(k.prefix)}" type="button">Delete</button></td></tr>`).join('')}</table>` : ''}
${agents}<h2>Docs</h2><p><a href="/docs">The SDK and developer API reference</a>.</p>`;
  const script = `<script>
document.getElementById('keyForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/dev/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:f.get('label')})});const j=await r.json();const m=document.getElementById('keyMsg');
m.innerHTML=r.ok?'<div class="note ok">Your new key (shown once, keep it secret): <code id="newKey"></code></div>':'<div class="note err"></div>';if(r.ok)document.getElementById('newKey').textContent=j.key;else m.firstChild.textContent=j.error};
document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await fetch('/api/dev/keys',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefix:b.dataset.del})});location.reload()});
</script>`;
  return html(layout({ title: 'Developer', me, active: '/dev', body, scripts: script }));
}

// Just enough Markdown for docs/SDK.md: headings, paragraphs, lists, tables, code.
export function markdown(md) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const out = [], lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) { const code = []; while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]); out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { const n = h[1].length; out.push(`<h${n} id="${slug(h[2])}">${inline(h[2])}</h${n}>`); continue; }
    if (l.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]); i--;
      const cells = r => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
      out.push(`<table><tr>${cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr>${rows.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d/.test(l), items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, '')); i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (l.trim()) { const para = [l]; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\||- |\d+\. )/.test(lines[i + 1])) para.push(lines[++i]); out.push(`<p>${inline(para.join(' '))}</p>`); }
  }
  return out.join('\n');
}

async function docs(DB, req, env) {
  const me = await viewer(DB, req);
  const md = SDK_DOCS.replaceAll('https://rookiegamers.com', siteURL(env));
  return html(layout({ title: 'SDK docs', me, active: '/docs', body: `<article class="doc">${markdown(md)}</article>`, url: siteURL(env) + '/docs' }));
}

function notFound(me, msg = 'Nothing here.') {
  return html(layout({ me, title: 'Not found', body: `<h1>${esc(msg)}</h1><p class="lede"><a href="/">Find a game to play</a>.</p>` }), 404);
}

export async function page(path, url, env, DB, req) {
  let m;
  if (path === '/') return home(DB, req, env);
  if ((m = path.match(/^\/play\/([a-z0-9-]{1,32})\/?$/))) return play(DB, req, env, url, m[1]);
  if (path === '/hall-of-fame') return hallOfFame(DB, req, env);
  if ((m = path.match(/^\/u\/(p[a-f0-9]{20})$/))) return profilePage(DB, req, env, m[1]);
  if (path === '/signin') return signinPage(env, await viewer(DB, req), url);
  if (path === '/auth/done') return authDone();
  if (path === '/sdk/connect') return connect(DB, req, env, url);
  if (path === '/dev') return devPage(DB, req, env, url);
  if (path === '/docs') return docs(DB, req, env);
  return null;
}

export const notFoundPage = async (DB, req) => notFound(DB ? await viewer(DB, req) : null);
export const SDK_MARKDOWN = SDK_DOCS;
export { levelFor };
