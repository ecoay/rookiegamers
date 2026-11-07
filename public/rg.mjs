#!/usr/bin/env node
// RookieGamers CLI. No dependencies, Node 18+.
//   node rg.mjs init <slug> [--title "My Game"]       starter game wired to the SDK
//   node rg.mjs create <slug> --title "My Game"       create the listing (add --linked --url https://... for your own site)
//   node rg.mjs deploy <dir> --game <slug> [--version 1.0.1] [--no-publish]
//   node rg.mjs publish <slug> [--version 1.0.1]
//   node rg.mjs games | stats <slug> | server-key <slug>
// Set ROOKIEGAMERS_API_KEY (make a key at https://rookiegamers.com/dev). ROOKIEGAMERS_URL points elsewhere for testing.
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SITE = (process.env.ROOKIEGAMERS_URL || 'https://rookiegamers.com').replace(/\/$/, '');
const KEY = process.env.ROOKIEGAMERS_API_KEY;
const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else args.push(rest[i]);
}
const die = msg => { console.error(msg); process.exit(1); };

async function api(method, path, body, raw) {
  if (!KEY) die(`Set ROOKIEGAMERS_API_KEY first. Make a key at ${SITE}/dev`);
  const headers = { authorization: `Bearer ${KEY}` };
  if (body && !raw) headers['content-type'] = 'application/json';
  const r = await fetch(SITE + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 422) die(j.error || `${method} ${path} failed (${r.status})`);
  return j;
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

function report(r) {
  for (const p of r.problems || []) console.log('  ✗ ' + p);
  for (const w of r.warnings || []) console.log('  ! ' + w);
  console.log(r.live ? `Live: ${r.url}` : 'Not published. Fix the problems above and publish again.');
}

if (cmd === 'init') {
  const slug = args[0] || die('Usage: rg init <slug>');
  const r = await fetch(SITE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'scaffold_game', arguments: { slug, title: flags.title || slug } } }) });
  const files = JSON.parse((await r.json()).result.content[0].text).files;
  await mkdir(slug, { recursive: true });
  for (const f of files) await writeFile(join(slug, f.path), f.content);
  console.log(`Made ./${slug}. Open ${slug}/index.html?rg_test=1 to play it in test mode, then:\n  node rg.mjs create ${slug} --title "${flags.title || slug}"\n  node rg.mjs deploy ./${slug} --game ${slug}`);
} else if (cmd === 'create') {
  const slug = args[0] || die('Usage: rg create <slug> --title "My Game"');
  const body = { slug, title: flags.title || slug, blurb: flags.blurb, kind: flags.linked ? 'linked' : 'hosted', url: flags.url };
  const r = await api('POST', '/api/dev/games', body);
  console.log(`Created ${r.game.slug} (${r.game.kind}). ${r.game.kind === 'hosted' ? `Next: node rg.mjs deploy <dir> --game ${slug}` : `Next: node rg.mjs publish ${slug}`}`);
} else if (cmd === 'deploy') {
  const dir = args[0] || die('Usage: rg deploy <dir> --game <slug>');
  const slug = flags.game || die('Pass --game <slug>');
  if (!(await stat(dir)).isDirectory()) die(`${dir} isn't a folder`);
  const version = flags.version || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const files = await walk(dir);
  console.log(`Uploading ${files.length} files as ${slug}@${version}`);
  for (const f of files) {
    const rel = relative(dir, f).split(sep).join('/');
    await api('PUT', `/api/dev/games/${slug}/builds/${version}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, await readFile(f), true);
    process.stdout.write('.');
  }
  console.log('');
  if (flags['no-publish']) console.log(`Uploaded. Publish with: node rg.mjs publish ${slug} --version ${version}`);
  else report(await api('POST', `/api/dev/games/${slug}/publish`, { version }));
} else if (cmd === 'publish') {
  report(await api('POST', `/api/dev/games/${args[0] || die('Usage: rg publish <slug>')}/publish`, { version: flags.version }));
} else if (cmd === 'games') {
  for (const g of (await api('GET', '/api/dev/games')).games) console.log(`${g.slug.padEnd(24)} ${g.live ? 'live' : 'draft'}  ${g.kind}  ${g.version || ''}`);
} else if (cmd === 'stats') {
  console.log(JSON.stringify(await api('GET', `/api/dev/games/${args[0] || die('Usage: rg stats <slug>')}/stats`), null, 2));
} else if (cmd === 'server-key') {
  const r = await api('POST', `/api/dev/games/${args[0] || die('Usage: rg server-key <slug>')}/server-key`, {});
  console.log(`Server key (shown once, keep it on your server only):\n${r.key}`);
} else {
  console.log(`RookieGamers CLI\n  init <slug>            starter game\n  create <slug>          create the listing\n  deploy <dir> --game s  upload and publish\n  publish <slug>         publish the latest build\n  games                  your games\n  stats <slug>           plays and playtime\n  server-key <slug>      key for trusted server scores\nDocs: ${SITE}/docs`);
}
