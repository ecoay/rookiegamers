import { sessionPlayer } from './auth.js';
import { coverSrc } from './db.js';
import { devGameView, reviewQueue, listStudios } from './dev.js';
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

function gameForm(g, studios) {
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
<label class="up">Or upload an image (you crop it to 16:9 next)<input type="file" name="coverFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label></div></div>
<label>Game studio<select name="studio"><option value="">None (shows the developer name)</option>${studios.map(s => `<option value="${esc(s.slug)}"${g.studio === s.slug ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
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

// Studio forms, shared by /admin (every studio) and /dev (a developer's own). The page script
// needs helpersJS first; STUDIO_JS wires up the forms.
export const ADMIN_CSS = `<style>
.adm{margin:10px 0;padding:0}.adm>summary{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;flex-wrap:wrap}.adm form{padding:0 14px 16px}
.thumb{width:44px;height:30px;border-radius:6px;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:var(--c);font-weight:800}.thumb img,.prev img{width:100%;height:100%;object-fit:cover}
.st{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--panel2)}.st-live{background:rgba(61,220,151,.15);color:#a8f0cf}.st-pending{background:rgba(245,184,46,.18);color:#ffe08a}.st-rejected{background:rgba(255,92,57,.15);color:#ffb4a3}
.gf label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--dim)}.gf textarea,.gf select{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;color:var(--text);font:15px system-ui,sans-serif}
.gf .chk{flex-direction:row;align-items:center;gap:8px}.gf input[type=color]{width:60px;height:36px;padding:2px;background:var(--panel2);border:1px solid var(--line);border-radius:8px}
.cov{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start}.prev{aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:var(--c);display:flex;align-items:center;justify-content:center}
.slogo{width:44px;height:44px;border-radius:10px;object-fit:cover;display:inline-grid;place-items:center;background:var(--panel2);font-weight:800}.slogo.big{width:120px;height:120px;border-radius:20px;font-size:44px}
.acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.q{padding:14px;margin:10px 0}.q .acts input{flex:1;min-width:200px}
@media (max-width:640px){.cov{grid-template-columns:1fr}}</style>`;

export const helpersJS = base => `const api=(m,p,b,raw)=>fetch('${base}'+p,{method:m,headers:raw?{'content-type':raw}:{'content-type':'application/json'},body:raw?b:b?JSON.stringify(b):undefined}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok&&r.status!==422)throw new Error(j.error||('Failed ('+r.status+')'));return j});
const say=(el,t,bad)=>{el.textContent=t;el.style.color=bad?'#ffb4a3':'#a8f0cf'};
const cropInto=(input,opts,show)=>input.onchange=async()=>{const f0=input.files[0];if(!f0)return;try{const c=await rgCrop(f0,opts);input.value='';if(!c)return;input.form._img=c;show(URL.createObjectURL(c))}catch(err){alert(err.message)}};`;
export const STUDIO_JS = `document.querySelectorAll('.st-form').forEach(d=>{const slug=d.dataset.studio,f=d.querySelector('form'),msg=f.querySelector('.msg');
 cropInto(f.logoFile,{aspect:1,width:512,height:512,alpha:true,title:'Crop the logo (square)'},u=>{f.querySelector('.lprev').innerHTML='<img class="slogo big" alt="Logo">';f.querySelector('.lprev img').src=u;say(msg,'New logo ready. Press Save.')});
 f.onsubmit=async e=>{e.preventDefault();const x=new FormData(f);say(msg,'Saving...');try{
  if(f._img){await api('PUT','/studios/'+slug+'/logo',f._img,f._img.type);f._img=null}
  await api('POST','/studios',{slug,name:x.get('name'),url:x.get('url'),bio:x.get('bio')});location.reload()}catch(err){say(msg,err.message,1)}};
 f.querySelector('[data-del]').onclick=async()=>{if(!confirm('Delete this studio? Its games go back to showing the developer name.'))return;try{await api('DELETE','/studios/'+slug,{});location.reload()}catch(err){say(msg,err.message,1)}};
});
{const f=document.getElementById('newStudio'),msg=f.querySelector('.msg'),nm=f.querySelector('[name=name]'),sl=f.querySelector('[name=slug]');
 nm.oninput=()=>{if(!sl.dataset.touched)sl.value=nm.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)};sl.oninput=()=>sl.dataset.touched=1;
 f.onsubmit=async e=>{e.preventDefault();say(msg,'Saving...');try{await api('POST','/studios',{slug:sl.value,name:nm.value});location.reload()}catch(err){say(msg,err.message,1)}}}`;
export const studiosSection = (studios, intro) => `<p class="muted">${intro}</p>
${studios.map(studioForm).join('')}
<details class="panel adm" open><summary><b>New studio</b></summary><form class="form gf" id="newStudio">
<label>Studio name<input name="name" required placeholder="Like Tenacie Games"></label>
<label>Link name (rookiegamers.com/studio/...)<input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,30}[a-z0-9]?" placeholder="tenacie-games"></label>
<div class="acts"><button class="btn" type="submit">Make studio</button><span class="msg"></span></div></form></details>`;

function studioForm(s) {
  const logo = cls => s.logo ? `<img class="slogo${cls}" src="${esc(s.logo)}" alt="">` : `<span class="slogo${cls}">${esc(s.name.charAt(0).toUpperCase())}</span>`;
  return `<details class="panel adm st-form" data-studio="${esc(s.slug)}"><summary>${logo('')}<b>${esc(s.name)}</b> <span class="muted">/studio/${esc(s.slug)}</span></summary>
<form class="form gf">
<label>Studio name<input name="name" value="${esc(s.name)}"></label>
<label>Website (https)<input name="url" value="${esc(s.url || '')}" placeholder="https://"></label>
<label>About<textarea name="bio" rows="3">${esc(s.bio)}</textarea></label>
<div class="cov" style="grid-template-columns:120px 1fr"><div class="lprev">${logo(' big')}</div>
<label class="up">Logo (you crop it square next)<input type="file" name="logoFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label></div>
<div class="acts"><button class="btn" type="submit">Save</button><a class="btn ghost" href="/studio/${esc(s.slug)}" target="_blank">View</a><button class="btn ghost" type="button" data-del>Delete</button><span class="msg"></span></div>
</form></details>`;
}

export async function adminPage(DB, env, req) {
  const me = await viewer(DB, req);
  if (!me) return Response.redirect(new URL('/signin?next=/admin', req.url).href, 302);
  if (!isAdmin(env, me.id)) return html(layout({ title: 'Admin', me, robots: 'noindex', body: '<h1>Admin</h1><p class="lede">This page is for the RookieGamers team.</p>' }), 403);
  const [queue, games, studios] = await Promise.all([reviewQueue(DB, env), DB.prepare('SELECT * FROM games ORDER BY live DESC, featured_at IS NULL, title').all().then(r => r.results), listStudios(DB, null, true)]);
  const body = `${ADMIN_CSS}
<h1>Admin</h1><p class="lede">Edit any game, upload covers, publish and feature games, review first games and invite developers.</p>
<h2>Review queue</h2>${queue.length ? queue.map(q => `<div class="panel q" data-slug="${esc(q.slug)}"><b>${esc(q.title)}</b> <span class="muted">${esc(q.slug)} · ${esc(q.kind)} · by ${esc(q.developer)}${q.ownerEmail ? ` (${esc(q.ownerEmail)})` : ''} · sent ${ago(q.submittedAt)}</span>
<p>${esc(q.blurb)}</p>${(q.warnings || []).map(w => `<p class="note">${esc(w)}</p>`).join('')}
<p>${q.previewUrl ? `<a href="${esc(q.previewUrl)}" target="_blank" rel="noopener">Play build ${esc(q.version)}</a>` : q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">Open ${esc(q.url)}</a>` : ''}</p>
<div class="acts"><button class="btn" type="button" data-review="approved">Approve</button><input placeholder="Why it isn't approved (the developer sees this)" aria-label="Reason"><button class="btn ghost" type="button" data-review="rejected">Reject</button><span class="msg"></span></div></div>`).join('') : '<p class="muted">Nothing waiting. A new developer\'s first game shows up here when they publish it.</p>'}
<h2>Games</h2>${games.map(g => gameForm(g, studios)).join('')}
<h2>Game studios</h2>${studiosSection(studios, 'A studio has a name, logo, website and about text. Pick it on a game above and the game page shows the studio\'s logo and links to its studio page.')}
<h2>Developer invites</h2><form class="form" id="invForm" style="flex-direction:row;max-width:620px"><input name="note" placeholder="Who it's for, like Chris" aria-label="Who it's for"><button class="btn" type="submit">Make invite</button></form><div id="invMsg" style="margin:10px 0"></div>`;
  const script = `<script>
${helpersJS('/api/admin')}
const list=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
document.querySelectorAll('.adm[data-slug]').forEach(d=>{const slug=d.dataset.slug,f=d.querySelector('form'),msg=f.querySelector('.msg');
 cropInto(f.coverFile,{aspect:16/9,width:1280,height:720,title:'Crop the cover (16:9)'},u=>{f.querySelector('.prev').innerHTML='<img alt="Cover">';f.querySelector('.prev img').src=u;say(msg,'New cover ready. Press Save.')});
 f.onsubmit=async e=>{e.preventDefault();const x=new FormData(f);say(msg,'Saving...');try{
  const file=f._img;if(file){await api('PUT','/games/'+slug+'/cover',file,file.type||'application/octet-stream');f._img=null}
  const b={title:x.get('title'),developer:x.get('developer'),blurb:x.get('blurb'),tags:list(x.get('tags')||''),color:x.get('color'),devices:x.get('devices'),featured:!!x.get('featured'),studio:x.get('studio')||null};
  if(!file)b.cover=x.get('cover')||null;if(f.url){b.url=x.get('url');b.origins=list(x.get('origins')||'')}
  await api('PATCH','/games/'+slug,b);location.reload()}catch(err){say(msg,err.message,1)}};
 f.querySelectorAll('[data-act]').forEach(btn=>btn.onclick=async()=>{say(msg,'Working...');try{const r=await api('POST','/games/'+slug+'/'+btn.dataset.act,{});if(r.live===false&&r.problems&&r.problems.length)say(msg,r.problems.join(' '),1);else location.reload()}catch(err){say(msg,err.message,1)}});
});
document.querySelectorAll('.q').forEach(q=>q.querySelectorAll('[data-review]').forEach(btn=>btn.onclick=async()=>{const msg=q.querySelector('.msg');say(msg,'Working...');try{await api('POST','/games/'+q.dataset.slug+'/review',{status:btn.dataset.review,note:q.querySelector('input').value});location.reload()}catch(err){say(msg,err.message,1)}}));
${STUDIO_JS}
document.getElementById('invForm').onsubmit=async e=>{e.preventDefault();const m=document.getElementById('invMsg');try{const r=await api('POST','/invites',{note:new FormData(e.target).get('note')});const link=r.url+r.invite;m.innerHTML='<div class="note ok">Send this link (works once): <code></code></div>';m.querySelector('code').textContent=link}catch(err){m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=err.message}};
</script>`;
  return html(layout({ title: 'Admin', me, robots: 'noindex', body, scripts: '<script src="/crop.js"></script>' + script }));
}
