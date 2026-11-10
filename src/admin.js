import { sessionPlayer } from './auth.js';
import { coverSrc } from './db.js';
import { devGameView, reviewQueue } from './dev.js';
import { layout, html, esc, viewer } from './pages.js';

// The admin page (/admin): the portal owner edits any game, uploads covers, publishes and
// features games, works the first-game review queue and makes developer invites, all while signed
// in. Admins are the player ids listed in ADMIN_PLAYERS (wrangler.jsonc vars, comma separated).
// The page calls the same /api/admin routes as the ADMIN_TOKEN, with the session cookie.

export const isAdmin = (env, pid) => !!pid && String(env.ADMIN_PLAYERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(pid);

// A signed-in admin on /api/admin. Like the /dev page, it only takes GETs, file PUTs and JSON
// bodies, which a browser won't send cross-site without a CORS preflight this API never grants.
export async function adminSession(DB, env, req) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && req.method !== 'GET') return false;
  const ok = req.method === 'GET' || req.method === 'PUT' || (req.headers.get('content-type') || '').includes('application/json');
  return ok && isAdmin(env, await sessionPlayer(DB, req));
}

const ago = t => t ? new Date(t).toISOString().slice(0, 10) : '';
const STATUS = { live: 'Live', pending: 'Waiting for review', rejected: 'Not approved', draft: 'Not published' };

function gameForm(g) {
  const v = devGameView(g), img = coverSrc(g);
  const field = (name, label, value, attrs = '') => `<label>${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
  return `<details class="panel adm" data-slug="${esc(g.slug)}"><summary><span class="thumb" style="--c:${esc(g.color || '#8f6bff')}">${img ? `<img src="${esc(img)}" alt="">` : esc((g.title || '?').charAt(0))}</span>
<b>${esc(g.title)}</b> <span class="muted">${esc(g.slug)} · ${esc(g.kind)}</span> <span class="st st-${v.status}">${STATUS[v.status]}</span>${v.featured ? ' <span class="st st-live">Featured</span>' : ''}</summary>
<form class="form gf">
${field('title', 'Title', g.title)}${field('developer', 'Developer name', g.developer)}
<label>Blurb<textarea name="blurb" rows="2">${esc(g.blurb)}</textarea></label>
${field('tags', 'Tags (comma separated)', v.tags.join(', '))}
${g.kind === 'linked' ? field('url', 'Game URL', g.url) + field('origins', 'Allowed origins (comma separated)', v.origins.join(', ')) : ''}
<div class="cov"><div class="prev" style="--c:${esc(g.color || '#8f6bff')}">${img ? `<img src="${esc(img)}" alt="Cover">` : '<span>No cover</span>'}</div>
<div>${field('cover', 'Cover image (https URL, or a file in the build like cover.png)', g.cover)}
<label class="up">Or upload an image<input type="file" name="coverFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label></div></div>
${field('color', 'Color', g.color || '#8f6bff', 'type="color"')}
<label>Devices<select name="devices">${['both', 'desktop', 'mobile'].map(d => `<option${g.devices === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
<label class="chk"><input type="checkbox" name="featured"${v.featured ? ' checked' : ''}> Featured at the top of the home page</label>
<div class="acts"><button class="btn" type="submit">Save</button>
${g.live ? `<a class="btn ghost" href="/play/${esc(g.slug)}" target="_blank">View</a><button class="btn ghost" type="button" data-act="unpublish">Take down</button>` : `<button class="btn ghost" type="button" data-act="publish">Publish</button>`}
<span class="msg"></span></div>
${v.status === 'rejected' && v.review?.note ? `<p class="muted">Turned down: ${esc(v.review.note)}</p>` : ''}
<p class="muted small">${g.kind === 'hosted' ? `Live build: ${esc(g.version || 'none')}. ` : ''}Created ${ago(g.created_at)}.</p>
</form></details>`;
}

export async function adminPage(DB, env, req) {
  const me = await viewer(DB, req);
  if (!me) return Response.redirect(new URL('/signin?next=/admin', req.url).href, 302);
  if (!isAdmin(env, me.id)) return html(layout({ title: 'Admin', me, robots: 'noindex', body: '<h1>Admin</h1><p class="lede">This page is for the RookieGamers team.</p>' }), 403);
  const [queue, games] = await Promise.all([reviewQueue(DB, env), DB.prepare('SELECT * FROM games ORDER BY live DESC, featured_at IS NULL, title').all().then(r => r.results)]);
  const body = `<style>
.adm{margin:10px 0;padding:0}.adm>summary{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;flex-wrap:wrap}.adm form{padding:0 14px 16px}
.thumb{width:44px;height:30px;border-radius:6px;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:var(--c);font-weight:800}.thumb img,.prev img{width:100%;height:100%;object-fit:cover}
.st{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--panel2)}.st-live{background:rgba(61,220,151,.15);color:#a8f0cf}.st-pending{background:rgba(245,184,46,.18);color:#ffe08a}.st-rejected{background:rgba(255,92,57,.15);color:#ffb4a3}
.gf label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--dim)}.gf textarea,.gf select{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;color:var(--text);font:15px system-ui,sans-serif}
.gf .chk{flex-direction:row;align-items:center;gap:8px}.gf input[type=color]{width:60px;height:36px;padding:2px;background:var(--panel2);border:1px solid var(--line);border-radius:8px}
.cov{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start}.prev{aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:var(--c);display:flex;align-items:center;justify-content:center}
.acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.q{padding:14px;margin:10px 0}.q .acts input{flex:1;min-width:200px}
@media (max-width:640px){.cov{grid-template-columns:1fr}}</style>
<h1>Admin</h1><p class="lede">Edit any game, upload covers, publish and feature games, review first games and invite developers.</p>
<h2>Review queue</h2>${queue.length ? queue.map(q => `<div class="panel q" data-slug="${esc(q.slug)}"><b>${esc(q.title)}</b> <span class="muted">${esc(q.slug)} · ${esc(q.kind)} · by ${esc(q.developer)}${q.ownerEmail ? ` (${esc(q.ownerEmail)})` : ''} · sent ${ago(q.submittedAt)}</span>
<p>${esc(q.blurb)}</p>${(q.warnings || []).map(w => `<p class="note">${esc(w)}</p>`).join('')}
<p>${q.previewUrl ? `<a href="${esc(q.previewUrl)}" target="_blank" rel="noopener">Play build ${esc(q.version)}</a>` : q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">Open ${esc(q.url)}</a>` : ''}</p>
<div class="acts"><button class="btn" type="button" data-review="approved">Approve</button><input placeholder="Why it isn't approved (the developer sees this)" aria-label="Reason"><button class="btn ghost" type="button" data-review="rejected">Reject</button><span class="msg"></span></div></div>`).join('') : '<p class="muted">Nothing waiting. A new developer\'s first game shows up here when they publish it.</p>'}
<h2>Games</h2>${games.map(gameForm).join('')}
<h2>Developer invites</h2><form class="form" id="invForm" style="flex-direction:row;max-width:620px"><input name="note" placeholder="Who it's for, like Chris" aria-label="Who it's for"><button class="btn" type="submit">Make invite</button></form><div id="invMsg" style="margin:10px 0"></div>`;
  const script = `<script>
const api=(m,p,b,raw)=>fetch('/api/admin'+p,{method:m,headers:raw?{'content-type':raw}:{'content-type':'application/json'},body:raw?b:b?JSON.stringify(b):undefined}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok&&r.status!==422)throw new Error(j.error||('Failed ('+r.status+')'));return j});
const say=(el,t,bad)=>{el.textContent=t;el.style.color=bad?'#ffb4a3':'#a8f0cf'};
const list=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
document.querySelectorAll('.adm').forEach(d=>{const slug=d.dataset.slug,f=d.querySelector('form'),msg=f.querySelector('.msg');
 f.onsubmit=async e=>{e.preventDefault();const x=new FormData(f);say(msg,'Saving...');try{
  const file=f.coverFile.files[0];if(file){await api('PUT','/games/'+slug+'/cover',file,file.type||'application/octet-stream');f.coverFile.value=''}
  const b={title:x.get('title'),developer:x.get('developer'),blurb:x.get('blurb'),tags:list(x.get('tags')||''),color:x.get('color'),devices:x.get('devices'),featured:!!x.get('featured')};
  if(!file)b.cover=x.get('cover')||null;if(f.url){b.url=x.get('url');b.origins=list(x.get('origins')||'')}
  await api('PATCH','/games/'+slug,b);location.reload()}catch(err){say(msg,err.message,1)}};
 f.querySelectorAll('[data-act]').forEach(btn=>btn.onclick=async()=>{say(msg,'Working...');try{const r=await api('POST','/games/'+slug+'/'+btn.dataset.act,{});if(r.live===false&&r.problems&&r.problems.length)say(msg,r.problems.join(' '),1);else location.reload()}catch(err){say(msg,err.message,1)}});
});
document.querySelectorAll('.q').forEach(q=>q.querySelectorAll('[data-review]').forEach(btn=>btn.onclick=async()=>{const msg=q.querySelector('.msg');say(msg,'Working...');try{await api('POST','/games/'+q.dataset.slug+'/review',{status:btn.dataset.review,note:q.querySelector('input').value});location.reload()}catch(err){say(msg,err.message,1)}}));
document.getElementById('invForm').onsubmit=async e=>{e.preventDefault();const m=document.getElementById('invMsg');try{const r=await api('POST','/invites',{note:new FormData(e.target).get('note')});const link=r.url+r.invite;m.innerHTML='<div class="note ok">Send this link (works once): <code></code></div>';m.querySelector('code').textContent=link}catch(err){m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=err.message}};
</script>`;
  return html(layout({ title: 'Admin', me, robots: 'noindex', body, scripts: script }));
}
