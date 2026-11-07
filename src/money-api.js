import { getGame, sha256, getPlayer } from './db.js';
import { playNext } from './play.js';
import { sessionPlayer } from './auth.js';
import { bearerPlayer, cjson, json, readJSON } from './api.js';
import { isDeveloper, siteURL } from './dev.js';
import * as money from './money.js';
import { verifyWebhook, StripeError } from './stripe.js';
import * as clips from './clips.js';

// Routes for ads, stores and payouts. The SDK calls /api/v1/ads/* and /api/v1/store/*, developers
// call /api/dev/games/<slug>/{products,ads,money} and /api/dev/payouts, the portal's admin calls
// /api/admin/{ads,campaigns,payouts,money}, and Stripe posts to /stripe/webhook.

const SLUG = '([a-z0-9-]{1,32})';
const errors = fn => fn().catch(e => {
  if (e instanceof money.MoneyError || e instanceof StripeError || e instanceof clips.ClipError) return { __status: e.status || 400, error: e.message };
  throw e;
});
const send = (r, ok = 200, cors = false) => {
  const status = r && r.__status ? r.__status : r && r.status && r.error ? r.status : ok;
  if (r && typeof r === 'object') { delete r.__status; if (r.error) delete r.status; }
  return cors ? cjson(r, status) : json(r, status);
};

/* ---------- /api/v1: from the SDK and the portal page ---------- */

export async function moneyV1(req, env, DB, url, path) {
  const method = req.method, site = siteURL(env);
  let m;
  if (path === '/ads/terms' && method === 'GET') return cjson({ version: clips.AD_TERMS_VERSION, terms: clips.AD_TERMS });
  // The clip banner on game pages: a promoted clip, or one from the free rotation.
  if (path === '/ads/banner' && method === 'GET') {
    const g = await getGame(DB, String(url.searchParams.get('game') || ''));
    // Only on games in the ad loop: they agreed to show other games' clips.
    const b = money.inLoop(g) && await clips.bannerClip(DB, g, { paid: money.monetized(g) });
    if (!b) return cjson({ clip: null });
    const cg = await getGame(DB, b.clip.game);
    return cjson({ promoted: b.promoted, clip: { ...clips.clipView(b.clip, site), gameTitle: cg.title, play: `${site}/play/${cg.slug}?ref=${g.slug}` } });
  }
  if (path === '/ads/status' && method === 'GET') {
    const g = await getGame(DB, String(url.searchParams.get('game') || ''));
    return cjson({ rewarded: money.adsOn(g, 'rewarded'), midgame: money.adsOn(g, 'midgame') });
  }
  if (path === '/ads/start' && method === 'POST') {
    const b = await readJSON(req);
    const g = await getGame(DB, String(b.game || ''));
    if (!g) return cjson({ error: 'Unknown game.' }, 404);
    const pid = await bearerPlayer(DB, env, req, g.slug);
    return cjson(await money.startAd(DB, env, req, site, g, { format: String(b.format || ''), sku: b.sku ? String(b.sku) : null, mode: b.mode === 'portal' ? 'portal' : 'standalone' }, pid));
  }
  if (path === '/ads/fallback' && method === 'POST') {
    const b = await readJSON(req);
    const r = await money.adFallback(DB, b.view, b.secret);
    return cjson(r, r.error ? 404 : 200);
  }
  if (path === '/ads/complete' && method === 'POST') {
    const b = await readJSON(req);
    return send(await money.completeAd(DB, env, b.view, b.secret), 200, true);
  }
  // A game's server checks what a player owns, with its rgs_ key.
  if ((m = path.match(new RegExp(`^/store/${SLUG}/entitlements$`))) && method === 'GET') {
    const g = await getGame(DB, m[1]);
    const auth = req.headers.get('authorization') || '';
    if (!g || !/^Bearer rgs_/.test(auth) || !g.key_hash || await sha256(auth.slice(7).trim()) !== g.key_hash) return cjson({ error: 'Send the game\'s server key.' }, 401);
    const pid = String(url.searchParams.get('player') || '');
    if (!await getPlayer(DB, pid)) return cjson({ error: 'Unknown player.' }, 404);
    return cjson({ player: pid, owned: await money.owned(DB, pid, g.slug) });
  }
  if ((m = path.match(new RegExp(`^/store/${SLUG}$`))) && method === 'GET') {
    const g = await getGame(DB, m[1]);
    if (!g || !g.live) return cjson({ error: 'Unknown game.' }, 404);
    const pid = await bearerPlayer(DB, env, req, g.slug);
    return cjson({ ...(await money.storeFor(DB, g, pid)), coin: !!g.coin, signedIn: !!pid });
  }
  if (path === '/store/checkout' && method === 'POST') {
    const b = await readJSON(req);
    const g = await getGame(DB, String(b.game || ''));
    if (!g) return cjson({ error: 'Unknown game.' }, 404);
    const pid = await bearerPlayer(DB, env, req, g.slug);
    if (!pid) return cjson({ error: 'Sign in to buy.', signin: true }, 401);
    return send(await errors(() => money.createCheckout(DB, env, site, g, pid, b.sku, { method: b.method })), 200, true);
  }
  if ((m = path.match(/^\/store\/orders\/(or[a-f0-9]{20})$/)) && method === 'GET') {
    const pid = await bearerPlayer(DB, env, req, String(url.searchParams.get('game') || ''));
    const o = pid && await money.orderStatus(DB, m[1], pid);
    return o ? cjson(o) : cjson({ error: 'Unknown order.' }, 404);
  }
  return null;
}

/* ---------- /api/dev and /api/admin ---------- */

async function ownGame(DB, pid, slug, admin) {
  const g = await getGame(DB, slug);
  if (!g) throw new money.MoneyError(404, `There's no game called "${slug}".`);
  if (!admin && g.owner_id !== pid) throw new money.MoneyError(403, 'That game belongs to another developer.');
  return g;
}

export async function moneyDev(req, env, DB, url, path, pid, admin) {
  const method = req.method, site = siteURL(env);
  let m;
  const run = async fn => send(await errors(fn));
  if ((m = path.match(new RegExp(`^/games/${SLUG}/products$`))) && method === 'GET') return run(async () => ({ products: await money.listProducts(DB, await ownGame(DB, pid, m[1], admin), { all: true }) }));
  if ((m = path.match(new RegExp(`^/games/${SLUG}/products/([^/]{1,40})$`)))) {
    if (method === 'PUT') return run(async () => ({ product: await money.putProduct(DB, await ownGame(DB, pid, m[1], admin), decodeURIComponent(m[2]), await readJSON(req)) }));
    if (method === 'DELETE') return run(async () => money.deleteProduct(DB, await ownGame(DB, pid, m[1], admin), decodeURIComponent(m[2])));
  }
  if ((m = path.match(new RegExp(`^/games/${SLUG}/ads$`)))) {
    if (method === 'GET') return run(async () => money.adsView(await ownGame(DB, pid, m[1], admin)));
    if (method === 'POST') return run(async () => money.requestAds(DB, await ownGame(DB, pid, m[1], admin), await readJSON(req)));
  }
  if ((m = path.match(new RegExp(`^/games/${SLUG}/money$`))) && method === 'GET') return run(async () => money.gameMoney(DB, (await ownGame(DB, pid, m[1], admin)).slug));
  // Clips: upload (raw MP4 body, ?title=), list, remove, promote.
  if ((m = path.match(new RegExp(`^/games/${SLUG}/clips$`)))) {
    if (method === 'GET') return run(async () => { const g = await ownGame(DB, pid, m[1], admin); return { clips: (await clips.listClips(DB, { game: g.slug })).map(c => clips.clipView(c, site)), crossPromo: await clips.crossPromoStats(DB, g.slug), promotions: await clips.promotions(DB, g.slug) }; });
    if (method === 'PUT' || method === 'POST') return run(async () => {
      const g = await ownGame(DB, pid, m[1], admin);
      const size = Number(req.headers.get('content-length'));
      const body = await req.arrayBuffer();
      return { clip: clips.clipView(await clips.uploadClip(DB, env, g, body, Number.isFinite(size) && size > 0 ? size : body.byteLength, { title: url.searchParams.get('title') }), site), note: 'RookieGamers reviews clips before they run.' };
    });
  }
  if ((m = path.match(new RegExp(`^/games/${SLUG}/clips/(cl[a-f0-9]{16})$`))) && method === 'DELETE') return run(async () => clips.removeClip(DB, await ownGame(DB, pid, m[1], admin), m[2]));
  if ((m = path.match(new RegExp(`^/games/${SLUG}/promote$`))) && method === 'POST') return run(async () => clips.promoteCheckout(DB, env, site, await ownGame(DB, pid, m[1], admin), pid, await readJSON(req)));
  if (!admin) {
    if (path === '/payouts' && method === 'GET') return json(await money.payoutStatus(DB, pid));
    if (path === '/payouts/connect' && method === 'POST') return run(async () => money.connectLink(DB, env, site, pid, await readJSON(req)));
    return null;
  }
  // The portal's own controls.
  if (path === '/clips' && method === 'GET') return json({ clips: (await clips.listClips(DB, { status: url.searchParams.get('status') || 'pending' })).map(c => clips.clipView(c, site)) });
  if ((m = path.match(/^\/clips\/(cl[a-f0-9]{16})\/review$/)) && method === 'POST') return run(async () => ({ clip: clips.clipView(await clips.reviewClip(DB, m[1], await readJSON(req)), site) }));
  if (path === '/ads/queue' && method === 'GET') return json({ games: await money.adsQueue(DB) });
  if ((m = path.match(new RegExp(`^/games/${SLUG}/ads/review$`))) && method === 'POST') return run(async () => money.reviewAds(DB, m[1], await readJSON(req)));
  if (path === '/campaigns' && method === 'GET') return json({ campaigns: await money.listCampaigns(DB) });
  if (path === '/campaigns' && method === 'POST') return run(async () => ({ campaign: await money.createCampaign(DB, await readJSON(req)) }));
  if ((m = path.match(/^\/campaigns\/(cmp[a-f0-9]{12})$/)) && method === 'PATCH') return run(async () => ({ campaign: await money.updateCampaign(DB, m[1], await readJSON(req)) }));
  if (path === '/ads/close' && method === 'POST') return run(async () => money.closeSponsorMonth(DB, String((await readJSON(req)).month || '')));
  if (path === '/ads/network' && method === 'POST') return run(async () => money.importNetworkReport(DB, await readJSON(req)));
  if (path === '/payouts/run' && method === 'POST') return run(async () => money.runPayouts(DB, env, { dryRun: !!(await readJSON(req)).dryRun }));
  if (path === '/money' && method === 'GET') return json(await money.portalMoney(DB));
  return null;
}

/* ---------- Stripe ---------- */

export async function stripeWebhook(req, env, DB) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const payload = await req.text();
  const ev = await verifyWebhook(env, payload, req.headers.get('stripe-signature'));
  if (!ev) return json({ error: 'Bad signature.' }, 400);
  try { return json(await money.handleStripeEvent(DB, env, ev)); } catch (e) {
    console.error('stripe webhook', ev.type, e);
    // Let Stripe retry: forget we saw it.
    await DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(String(ev.id)).run();
    return json({ error: 'Try again.' }, 500);
  }
}

/* ---------- pages: the ad player, checkout return, Stripe onboarding ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
const inline = v => JSON.stringify(v).replace(/</g, '\\u003c');

export async function moneyPage(path, url, env, DB, req) {
  let m;
  if ((m = path.match(/^\/ad\/(av[a-f0-9]{20})$/))) return adPage(DB, env, url, m[1]);
  if ((m = path.match(/^\/clips\/(cl[a-f0-9]{16})\.mp4$/))) return clips.serveClip(env, DB, m[1], req);
  if (path === '/store/done') return storeDone(url);
  if (path === '/dev/payouts/connect' || path === '/dev/payouts/return') {
    const pid = await sessionPlayer(DB, req);
    if (!pid || !await isDeveloper(DB, pid)) return Response.redirect(`${url.origin}/signin?next=/dev`, 302);
    try {
      if (path.endsWith('/connect')) return Response.redirect((await money.connectLink(DB, env, siteURL(env), pid)).url, 302);
      await money.refreshAccount(DB, env, pid);
    } catch (e) { console.error('stripe connect', e.message); }
    return Response.redirect(`${url.origin}/dev#money`, 302);
  }
  return null;
}

async function adPage(DB, env, url, id) {
  const v = await DB.prepare('SELECT * FROM ad_views WHERE id = ?').bind(id).first();
  const secret = url.searchParams.get('s') || '';
  if (!v || v.status !== 'started' || v.secret !== await sha256(secret)) return html('<!doctype html><title>Ad</title><body style="background:#000"><script>parent.postMessage({rg:1,type:"ad-done",view:' + inline(id) + ',data:{shown:false,rewarded:false}},"*")</script>', 404);
  const g = await getGame(DB, v.game);
  // The house ad is ready either way: it fills in when there's no sponsor or the network has nothing.
  const next = await playNext(DB, v.game, v.player_id);
  const house = next ? { headline: next.title, blurb: next.blurb, color: next.color, image: next.cover && /^https:\/\//.test(next.cover) ? next.cover : null, click: `${siteURL(env)}/play/${next.slug}?ref=${v.game}`, cta: 'Play free' }
    : { headline: 'RookieGamers', blurb: 'Free indie web games, one account for all of them.', color: '#ff5c39', image: null, click: siteURL(env), cta: 'Open' };
  let sponsor = null;
  if (v.source === 'sponsor' && v.campaign) {
    const c = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(v.campaign).first();
    if (c) sponsor = { headline: c.headline, blurb: '', color: '#16131f', image: c.image, click: c.click_url, cta: c.clip ? 'Play free' : 'Learn more' };
  }
  // A game clip: from the free rotation, or a promoted clip.
  let clip = null;
  if (v.clip) {
    const c = await DB.prepare('SELECT * FROM clips WHERE id = ?').bind(v.clip).first();
    const cg = c && await getGame(DB, c.game);
    if (c && cg) clip = { video: `/clips/${c.id}.mp4`, headline: cg.title, blurb: cg.blurb, color: cg.color, click: `${siteURL(env)}/play/${cg.slug}?ref=${v.game}`, cta: 'Play free' };
  }
  const D = { view: v.id, secret, format: v.format, source: v.source, ms: v.min_ms ?? (v.source === 'network' ? 0 : money.AD_RULES[v.format].minMs), creative: clip || sponsor || house,
    house, client: env.ADSENSE_CLIENT || null, test: env.ADS_TEST === '1', game: g ? g.title : '' };
  const net = v.source === 'network' && D.client
    ? `<script async ${D.test ? 'data-adbreak-test="on" ' : ''}data-ad-frequency-hint="30s" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(D.client)}" crossorigin="anonymous"></script>`
    : '';
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ad</title>${net}
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;background:rgba(8,6,14,.94);color:#fff;font:15px/1.45 system-ui,-apple-system,sans-serif}
.bar{position:fixed;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;gap:12px}
.tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;background:rgba(255,255,255,.14);padding:3px 8px;border-radius:6px}
button{border:0;border-radius:999px;padding:9px 16px;font:600 14px system-ui,sans-serif;cursor:pointer;background:rgba(255,255,255,.14);color:#fff}
button.go{background:#ff5c39}.wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:64px 16px 24px}
.card{width:min(420px,100%);background:#16131f;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center}
.art{height:200px;background-size:cover;background-position:center;position:relative}.art video{width:100%;height:100%;object-fit:cover;display:block;background:#000}.art .snd{position:absolute;right:10px;bottom:10px;padding:6px 10px;font-size:12px;background:rgba(0,0,0,.7)}.card.vid .art{height:auto;aspect-ratio:16/9}.body{padding:18px 20px 22px}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 16px;opacity:.8}
.count{font-variant-numeric:tabular-nums;opacity:.85}.msg{margin-top:10px;font-weight:600;min-height:1.4em}[hidden]{display:none!important}</style></head>
<body><div class="bar"><span><span class="tag">Ad</span> <span class="count" id="count"></span></span><button id="close" type="button">Close</button></div>
<div class="wrap"><div class="card" id="card"><div class="art" id="art"></div><div class="body"><h1 id="h"></h1><p id="p"></p><button class="go" id="cta" type="button"></button><div class="msg" id="msg"></div></div></div></div>
<script>(function(){var D=${inline(D)};var counted=null,closing=false,timer=null;
function out(r){if(closing)return;closing=true;parent.postMessage({rg:1,type:'ad-done',view:D.view,data:r},'*')}
function post(p,b){return fetch('/api/v1/ads/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({view:D.view,secret:D.secret},b||{}))}).then(function(r){return r.json()}).catch(function(){return {}})}
function show(c){var a=document.getElementById('art'),card=document.getElementById('card');a.textContent='';card.classList.toggle('vid',!!c.video);
if(c.video){var v=document.createElement('video');v.src=c.video;v.muted=true;v.autoplay=true;v.loop=true;v.playsInline=true;v.setAttribute('playsinline','');a.append(v);v.play().catch(function(){});
var s=document.createElement('button');s.className='snd';s.type='button';s.textContent='Sound on';s.onclick=function(){v.muted=!v.muted;s.textContent=v.muted?'Sound on':'Sound off'};a.append(s)}
a.style.background=c.video?'#000':c.image?'url('+JSON.stringify(c.image)+') center/cover':(c.color||'#ff5c39');
document.getElementById('h').textContent=c.headline;document.getElementById('p').textContent=c.blurb||'';var b=document.getElementById('cta');b.textContent=c.cta||'Open';b.hidden=!c.click;b.onclick=function(){if(c.click)window.open(c.click,'_blank','noopener')};document.getElementById('card').hidden=false}
function finish(){post('complete').then(function(r){counted=r&&r.shown?r:{shown:true,rewarded:false};var m=document.getElementById('msg');
if(D.format==='rewarded'&&counted.rewarded){m.textContent=counted.unlocked?'Unlocked!':(counted.needed?'Reward earned ('+counted.progress+' of '+counted.needed+')':'Reward earned');document.getElementById('close').textContent='Continue';setTimeout(function(){out(counted)},1500)}else out(counted)})}
function clock(ms){var end=Date.now()+ms,c=document.getElementById('count');clearInterval(timer);(function tick(){var s=Math.max(0,Math.ceil((end-Date.now())/1000));c.textContent=s?(D.format==='rewarded'?'Reward in '+s+'s':s+'s'):'';if(!s){clearInterval(timer);finish()}})();timer=setInterval(function(){var s=Math.max(0,Math.ceil((end-Date.now())/1000));c.textContent=s?(D.format==='rewarded'?'Reward in '+s+'s':s+'s'):'';if(!s){clearInterval(timer);finish()}},250)}
document.getElementById('close').onclick=function(){out(counted||{shown:true,rewarded:false})};
function house(){D.source='house';post('fallback').then(function(r){show(r&&r.clip?{video:'/clips/'+r.clip.id+'.mp4',headline:r.clip.title,click:'/play/'+r.clip.game,cta:'Play free'}:D.house);clock(r&&r.minMs!=null?r.minMs:D.ms)})}
if(D.source==='network'&&D.client){document.getElementById('card').hidden=true;window.adsbygoogle=window.adsbygoogle||[];var adBreak=function(o){adsbygoogle.push(o)},adConfig=adBreak,done=false;
adConfig({preloadAdBreaks:'on',sound:'on'});var guard=setTimeout(function(){if(!done){done=true;house()}},5000);
var base={name:'rg-'+D.format,adBreakDone:function(i){clearTimeout(guard);if(done)return;done=true;if(i.breakStatus==='viewed')finish();else if(i.breakStatus==='dismissed')out({shown:true,rewarded:false});else if(D.format==='rewarded')house();else out({shown:false,rewarded:false})}};
if(D.format==='rewarded')adBreak(Object.assign(base,{type:'reward',beforeReward:function(showAd){clearTimeout(guard);showAd()},adDismissed:function(){},adViewed:function(){}}));else adBreak(Object.assign(base,{type:'next'}))}
else{show(D.creative);clock(D.ms)}})()</script></body></html>`);
}

function storeDone(url) {
  const cancel = url.searchParams.get('cancel') === '1';
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${cancel ? 'Checkout cancelled' : 'Thanks!'}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0d16;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:16px}</style></head>
<body><div><h1>${cancel ? 'Checkout cancelled' : 'Thanks for your purchase!'}</h1><p>${cancel ? 'Nothing was charged.' : 'It\'s on its way to the game.'} You can close this window.</p></div>
<script>try{if(window.opener)window.opener.postMessage({rg:1,type:'purchase',data:{order:${inline(url.searchParams.get('order') || '')},cancelled:${cancel}}},'*')}catch(e){}setTimeout(function(){window.close()},${cancel ? 1200 : 2500})</script></body></html>`);
}

/* ---------- the Money section of /dev ---------- */

const usd = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c || 0) / 100).toFixed(2);
const ADS_LABEL = { off: 'Not in the ad loop', requested: 'In the ad loop, in review for paid ads', approved: 'Monetized', rejected: 'Not approved', paused: 'Paused' };

export async function devMoneySection(DB, env, pid, games) {
  const pay = await money.payoutStatus(DB, pid);
  const rows = await Promise.all(games.map(async g => {
    const full = await getGame(DB, g.slug);
    const products = await money.listProducts(DB, full, { all: true });
    const cl = await clips.listClips(DB, { game: full.slug });
    return { g: full, ads: money.adsView(full), products, clips: cl, promo: await clips.crossPromoStats(DB, full.slug) };
  }));
  const payBox = !env.STRIPE_SECRET_KEY ? '<p class="muted">Payouts open once the portal\'s Stripe account is connected.</p>'
    : pay.ready ? `<p>Payouts are on. Paid on the 1st of each month once you have ${usd(pay.minimumCents)} cleared.</p>`
    : `<p>${pay.connected ? 'Finish your Stripe setup to get paid.' : 'Connect a Stripe account to get paid. Stripe asks for your ID and tax details; RookieGamers never sees your bank details.'}</p><a class="btn" href="/dev/payouts/connect">${pay.connected ? 'Finish Stripe setup' : 'Connect Stripe'}</a>`;
  const body = `<h2 id="money">Money</h2>
<p class="lede">Every sale goes through RookieGamers. You keep ${money.SPLIT.store * 100}% of store sales after Stripe's fee and tax, and ${money.SPLIT.ads * 100}% of ad revenue. Store money clears after ${money.HOLD_DAYS} days.</p>
<div class="agents"><div class="panel"><h3>Balance</h3><p><strong>${usd(pay.availableCents)}</strong> ready · ${usd(pay.pendingCents)} clearing · ${usd(pay.paidCents)} paid so far</p>${payBox}</div></div>
${rows.length ? rows.map(({ g, ads, products, clips: cl, promo }) => `<div class="panel" style="margin-top:14px"><h3><span>${esc(g.title)}</span><span class="muted small">Ads: ${esc(ADS_LABEL[ads.status] || ads.status)}</span></h3>
${ads.note ? `<p class="note err">${esc(ads.note)}</p>` : ''}
${ads.status === 'off' || ads.status === 'rejected' ? `<p class="muted">Join the ad loop once the game is live. <code>rg.ads.rewarded()</code> and <code>rg.ads.midgame()</code> start right away with other games' clips, unpaid, and your clips run in theirs. Meanwhile we review the game for paid ads. Once it's approved, sponsor and network ads fill in and you earn ${money.SPLIT.ads * 100}%.</p><details class="terms"><summary>The ad terms</summary><ul>${clips.AD_TERMS.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
<label class="small"><input type="checkbox" data-agree="${esc(g.slug)}"${ads.agreedAt ? ' checked' : ''}> I accept the ad terms, including showing other games' clips unpaid</label>
<button class="btn small" data-ads="${esc(g.slug)}" type="button"${g.live ? '' : ' disabled'}>Join the ad loop</button>` : ''}
${ads.status === 'approved' || ads.status === 'requested' ? `<h4 style="margin:14px 0 6px">Clips</h4><p class="muted small">Upload a gameplay clip, 30 to 60 seconds, as an MP4. Once approved it runs free in other games when they have no paid ad, as theirs do in yours (last 30 days: ${promo.clipsShownInYourGame} shown in your game, yours shown ${promo.yourClipsShownElsewhere} times). Clips of 30 seconds or less can be promoted as paid ads.</p>
${cl.length ? `<table class="t"><tr><th>Clip</th><th>Length</th><th>Status</th><th></th></tr>${cl.map(c => `<tr><td><a href="/clips/${esc(c.id)}.mp4" target="_blank" rel="noopener">${esc(c.title)}</a></td><td>${Math.round(c.seconds)}s</td><td>${esc(c.status)}${c.note ? ` <span class="muted">(${esc(c.note)})</span>` : ''}</td><td>${c.status === 'approved' && c.seconds <= clips.CLIP.shortS + 0.5 ? `<form class="promo" data-game="${esc(g.slug)}" data-clip="${esc(c.id)}" style="display:inline-flex;gap:6px"><input name="budget" placeholder="Budget, like 50" inputmode="decimal" style="max-width:110px"><button class="btn small" type="submit">Promote</button></form> ` : ''}<button class="btn ghost small" data-del-clip="${esc(c.id)}" data-game="${esc(g.slug)}" type="button">Remove</button></td></tr>`).join('')}</table>` : ''}
<form class="clipup" data-game="${esc(g.slug)}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px"><input type="file" name="file" accept="video/mp4" required><button class="btn small" type="submit">Upload clip</button><span class="msg"></span></form>` : ''}
<table class="t"><tr><th>Product</th><th>Kind</th><th>Price</th><th>Ads to unlock</th><th></th></tr>${products.map(p => `<tr><td>${esc(p.title)} <code>${esc(p.sku)}</code>${p.active ? '' : ' <span class="muted">(off)</span>'}</td><td>${p.kind === 'pass' ? 'Monthly pass' : 'Item'}</td><td>${p.priceCents ? usd(p.priceCents) : '-'}</td><td>${p.adUnlock || '-'}</td><td><button class="btn ghost small" data-del-sku="${esc(p.sku)}" data-game="${esc(g.slug)}" type="button">Remove</button></td></tr>`).join('')}</table>
<form class="form prod" data-game="${esc(g.slug)}" style="flex-direction:row;flex-wrap:wrap;gap:8px;margin-top:8px"><input name="sku" placeholder="sku, like skin.gold" required style="max-width:160px"><input name="title" placeholder="Title" required style="max-width:180px">
<select name="kind"><option value="item">Item</option><option value="pass">Monthly pass</option></select><input name="price" placeholder="Price, like 4.99" inputmode="decimal" style="max-width:120px"><input name="ads" placeholder="Ads to unlock" inputmode="numeric" style="max-width:120px"><button class="btn small" type="submit">Add</button><div class="msg"></div></form></div>`).join('') : ''}`;
  const script = `<script>
document.querySelectorAll('[data-ads]').forEach(b=>b.onclick=async()=>{const box=document.querySelector('[data-agree="'+b.dataset.ads+'"]');const r=await fetch('/api/dev/games/'+b.dataset.ads+'/ads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agree:!!(box&&box.checked)})});const j=await r.json();if(r.ok)location.reload();else b.insertAdjacentText('afterend',' '+j.error)});
document.querySelectorAll('form.clipup').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const file=f.file.files[0];const m=f.querySelector('.msg');if(!file)return;m.textContent='Uploading...';
const r=await fetch('/api/dev/games/'+f.dataset.game+'/clips?title='+encodeURIComponent(file.name.replace(/\.[^.]+$/,'')),{method:'PUT',headers:{'content-type':'video/mp4'},body:file});const j=await r.json();if(r.ok)location.reload();else m.textContent=j.error});
document.querySelectorAll('[data-del-clip]').forEach(b=>b.onclick=async()=>{await fetch('/api/dev/games/'+b.dataset.game+'/clips/'+b.dataset.delClip,{method:'DELETE',headers:{'content-type':'application/json'}});location.reload()});
document.querySelectorAll('form.promo').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const c=Math.round(parseFloat(f.budget.value)*100);const r=await fetch('/api/dev/games/'+f.dataset.game+'/promote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clip:f.dataset.clip,budgetCents:c})});const j=await r.json();if(r.ok)location.href=j.url;else f.insertAdjacentText('afterend',' '+j.error)});
document.querySelectorAll('[data-del-sku]').forEach(b=>b.onclick=async()=>{await fetch('/api/dev/games/'+b.dataset.game+'/products/'+encodeURIComponent(b.dataset.delSku),{method:'DELETE',headers:{'content-type':'application/json'}});location.reload()});
document.querySelectorAll('form.prod').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f);const price=String(d.get('price')||'').trim();const body={title:d.get('title'),kind:d.get('kind'),priceCents:price?Math.round(parseFloat(price)*100):null,adUnlock:Number(d.get('ads')||0)};
const r=await fetch('/api/dev/games/'+f.dataset.game+'/products/'+encodeURIComponent(String(d.get('sku')).toLowerCase()),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(r.ok)location.reload();else f.querySelector('.msg').textContent=j.error});
</script>`;
  return { body, script };
}

