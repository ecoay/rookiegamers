// A small, complete starter game wired to the SDK. The MCP scaffold tool and `rg.mjs init` hand
// this out, so an agent starts from something that already passes the publishing checks.

export function starterFiles({ slug, title, portal }) {
  const safeTitle = String(title || slug).replace(/[<>&"]/g, '');
  const index = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="style.css">
  <script src="${portal}/sdk/v1.js"></script>
</head>
<body>
  <canvas id="c"></canvas>
  <div id="hud"><span id="score">0</span><span id="who"></span></div>
  <div id="menu">
    <h1>${safeTitle}</h1>
    <p>Drag or use the arrow keys to dodge.</p>
    <button id="play" type="button">Play</button>
    <ol id="board"></ol>
  </div>
  <script src="game.js"></script>
</body>
</html>
`;
  const css = `*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0f0d16;color:#fff;font:16px/1.4 system-ui,-apple-system,sans-serif;overflow:hidden;touch-action:none}
canvas{display:block;width:100vw;height:100vh}
#hud{position:fixed;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;font-weight:700;pointer-events:none}
#menu{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(15,13,22,.82);text-align:center;padding:16px}
#menu[hidden]{display:none}h1{margin:0;font-size:40px}
button{border:0;border-radius:999px;padding:12px 28px;font:700 18px system-ui,sans-serif;background:#ff5c39;color:#fff;cursor:pointer}
ol{margin:12px 0 0;padding:0 0 0 20px;text-align:left;min-width:200px;opacity:.85}
`;
  const js = `// ${safeTitle}: a starter game on the RookieGamers SDK. Replace the gameplay, keep the rg calls.
const GAME = ${JSON.stringify(slug)};
const c = document.getElementById('c'), x = c.getContext('2d');
const $ = id => document.getElementById(id);
let W, H, me, rocks, score, alive = false, last = 0, keys = {};

function resize() { const d = devicePixelRatio || 1; W = innerWidth; H = innerHeight; c.width = W * d; c.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', resize); resize();
addEventListener('keydown', e => keys[e.key] = true);
addEventListener('keyup', e => keys[e.key] = false);
c.addEventListener('pointermove', e => { if (alive && e.buttons) me.x = e.clientX; });
c.addEventListener('pointerdown', e => { if (alive) me.x = e.clientX; });

async function showBoard() {
  const r = await rg.scores.top({ limit: 5 });
  $('board').innerHTML = r.ok ? r.rows.map(row => '<li>' + row.player.name.replace(/[<>&]/g, '') + ' · ' + row.score + '</li>').join('') : '';
}

function start() {
  me = { x: W / 2, y: H - 60, r: 14 }; rocks = []; score = 0; alive = true;
  $('menu').hidden = true;
  rg.game.gameplayStart();
  last = performance.now(); requestAnimationFrame(tick);
}

async function over() {
  alive = false;
  rg.game.gameplayStop();
  $('menu').hidden = false;
  $('play').textContent = 'Play again';
  const r = await rg.scores.submit({ score });
  if (!r.ok && r.signin && await rg.user.login()) await rg.scores.submit({ score });
  showBoard();
  rg.promo.showNext();
}

function tick(t) {
  if (!alive) return;
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  score += Math.round(dt * 100);
  const speed = 520;
  if (keys.ArrowLeft || keys.a) me.x -= speed * dt;
  if (keys.ArrowRight || keys.d) me.x += speed * dt;
  me.x = Math.max(me.r, Math.min(W - me.r, me.x));
  if (Math.random() < dt * (2 + score / 400)) rocks.push({ x: Math.random() * W, y: -20, r: 10 + Math.random() * 18, v: 160 + Math.random() * 160 + score / 6 });
  for (const k of rocks) { k.y += k.v * dt; if (Math.hypot(k.x - me.x, k.y - me.y) < k.r + me.r) return over(); }
  rocks = rocks.filter(k => k.y < H + 40);
  x.fillStyle = '#0f0d16'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#8f6bff'; for (const k of rocks) { x.beginPath(); x.arc(k.x, k.y, k.r, 0, 7); x.fill(); }
  x.fillStyle = '#ff5c39'; x.beginPath(); x.arc(me.x, me.y, me.r, 0, 7); x.fill();
  $('score').textContent = score;
  requestAnimationFrame(tick);
}

(async () => {
  await rg.init({ game: GAME });
  const who = await rg.user.get();
  $('who').textContent = who ? who.name + (who.title ? ' · ' + who.title : '') : 'Guest';
  rg.user.onChange(p => { $('who').textContent = p ? p.name : 'Guest'; });
  $('play').onclick = start;
  showBoard();
  rg.game.loaded();
})();
`;
  const agents = `# ${safeTitle}

A RookieGamers game. The SDK reference is at ${portal}/docs (or the \`get_sdk_docs\` MCP tool).

- Keep \`rg.init\`, \`rg.game.loaded\`, \`gameplayStart\`/\`gameplayStop\`, \`rg.scores.submit\` and \`rg.promo.showNext\` wired in.
- Test locally with \`?rg_test=1\` in the URL (fake player, in-memory scores).
- Publish with the \`upload_files\` and \`publish_game\` MCP tools, or \`node rg.mjs deploy . --game ${slug}\`.
- No outside ad code, and it must fit a phone screen.
`;
  return [
    { path: 'index.html', content: index },
    { path: 'style.css', content: css },
    { path: 'game.js', content: js },
    { path: 'AGENTS.md', content: agents },
  ];
}
