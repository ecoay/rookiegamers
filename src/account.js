// Self-serve account deletion, for the privacy policy and Meta's data deletion requirement.
// Removes the player's profile, sign-in links, sessions, scores, gems, wallets and play history.
// Purchase records are kept for tax and refunds, but no longer point at the player. Hall of Fame
// entries stay as history, renamed "Deleted player".

export const GONE = 'deleted';

export async function deleteAccount(DB, pid) {
  const p = await DB.prepare('SELECT id, email FROM players WHERE id = ?').bind(pid).first();
  if (!p) return { status: 404, error: 'No such account.' };
  // A developer with games or money owed has to settle that first, so payouts aren't lost.
  const owns = await DB.prepare('SELECT 1 FROM games WHERE owner_id = ? OR developer = ? LIMIT 1').bind(pid, pid).first();
  if (owns) return { status: 409, error: 'You still have games on RookieGamers. Remove them or transfer them first, or email support@rookiegamers.com and we will help.' };
  const by = sql => DB.prepare(sql).bind(pid);
  const steps = [
    by('DELETE FROM identities WHERE player_id = ?'),
    by('DELETE FROM sessions WHERE player_id = ?'),
    by('DELETE FROM gems WHERE player_id = ?'),
    by('DELETE FROM shares WHERE player_id = ?'),
    by('DELETE FROM wallets WHERE player_id = ?'),
    by('DELETE FROM scores WHERE player_id = ?'),
    by('DELETE FROM titles WHERE player_id = ?'),
    by('DELETE FROM icons_owned WHERE player_id = ?'),
    by('DELETE FROM frames_owned WHERE player_id = ?'),
    by('DELETE FROM saves WHERE player_id = ?'),
    by('DELETE FROM submits WHERE player_id = ?'),
    by('DELETE FROM dev_keys WHERE player_id = ?'),
    by('DELETE FROM developers WHERE player_id = ?'),
    by('UPDATE plays SET player_id = NULL WHERE player_id = ?'),
    DB.prepare("UPDATE hall SET player_id = ?, name = 'Deleted player' WHERE player_id = ?").bind(GONE, pid),
    by("UPDATE players SET referred_by = NULL WHERE referred_by = ?"),
  ];
  if (p.email) steps.push(DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(p.email));
  // Store tables exist once money.js has migrated; skip them quietly if not.
  const money = [
    by('DELETE FROM entitlements WHERE player_id = ?'),
    by('DELETE FROM ad_progress WHERE player_id = ?'),
    by('UPDATE ad_views SET player_id = NULL WHERE player_id = ?'),
    DB.prepare('UPDATE orders SET player_id = ? WHERE player_id = ?').bind(GONE, pid),
  ];
  for (const s of steps) await s.run();
  for (const s of money) { try { await s.run(); } catch (e) { if (!/no such table/i.test(String(e && e.message))) throw e; } }
  await by('DELETE FROM players WHERE id = ?').run();
  return { status: 200, ok: true };
}

/* ---------- Meta's data deletion callback ---------- */
// When someone removes the RookieGamers app in their Facebook settings, Meta POSTs a signed_request
// here. We drop that Facebook link and its stored profile, then answer with a status URL and a code.
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

const b64uBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export async function parseSignedRequest(signed, secret) {
  const [sig, payload] = String(signed || '').split('.');
  if (!sig || !payload || !secret) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', key, b64uBytes(sig), new TextEncoder().encode(payload)); } catch (e) { return null; }
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64uBytes(payload)));
    return data && data.algorithm && String(data.algorithm).toUpperCase() === 'HMAC-SHA256' ? data : null;
  } catch (e) { return null; }
}

export async function metaDeletion(DB, env, req, origin) {
  const form = await req.formData().catch(() => null);
  const data = form && await parseSignedRequest(form.get('signed_request'), env.FACEBOOK_CLIENT_SECRET);
  if (!data || !data.user_id) return new Response(JSON.stringify({ error: 'Bad signed_request.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  await DB.prepare("DELETE FROM identities WHERE provider = 'facebook' AND subject = ?").bind(String(data.user_id)).run();
  const code = 'fb' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Response(JSON.stringify({ url: `${origin}/data-deletion?code=${code}`, confirmation_code: code }), { headers: { 'content-type': 'application/json' } });
}
