// Lifted from Buy Your Friends (friendsourcing src/game/x-identity.ts lookupXAccount):
// a free existence check against fxtwitter. The handle when the @ exists, false when X
// has no such account, null when we couldn't tell (fxtwitter down or blocked).
export async function xAccountExists(handle: string): Promise<string | false | null> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) return false;
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { screen_name?: string } };
    const screen = body.user?.screen_name;
    if (!screen || screen.toLowerCase() !== handle.toLowerCase()) return false;
    return screen;
  } catch {
    return null;
  }
}
