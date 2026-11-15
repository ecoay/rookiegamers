import { SCENARIOS, scenarioById, type Scenario } from "./scenarios.ts";

/**
 * A party is fully described by its room: scenario + version + seed + the five
 * handles in slot order + who assembled it. The roles and punchlines are a
 * pure function of that, so refreshing (or anyone opening the link) always
 * shows the same joke, with no database for the pilot.
 */
export const CAST_SIZE = 5;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

export type Party = {
  scenarioId: string;
  version: number;
  seed: string;
  cast: string[];
  assembler: string | null;
};

export type CastMember = { handle: string; role: string; line: string };

export type Reveal = { party: Party; scenario: Scenario; members: CastMember[] };

/** Strip leading @ signs and whitespace. Null when it can't be an X handle. */
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, "").trim();
  return HANDLE.test(handle) ? handle : null;
}

/** Problems with a cast list, one per slot (null when that slot is fine). */
export function castErrors(raw: string[]): (string | null)[] {
  const seen = new Map<string, number>();
  return raw.map((value, i) => {
    if (!value.trim()) return "Pick a friend.";
    const handle = normalizeHandle(value);
    if (!handle) return "X handles are letters, numbers and _ only, up to 15.";
    const key = handle.toLowerCase();
    if (seen.has(key)) return `Already in slot ${(seen.get(key) ?? 0) + 1}.`;
    seen.set(key, i);
    return null;
  });
}

/** FNV-1a, then a mulberry32 stream. Same seed string, same numbers. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/** Draw a scenario for a new party. Random unless one is asked for. */
export function drawParty(cast: string[], assembler: string | null, scenarioId?: string): Party {
  const seed = newSeed();
  const scenario = (scenarioId && scenarioById(scenarioId)) || SCENARIOS[Math.floor(rng(seed + ":pick")() * SCENARIOS.length)];
  return { scenarioId: scenario.id, version: scenario.version, seed, cast, assembler };
}

/** Five roles shuffled across the five slots, plus one punchline variant each. */
export function reveal(party: Party): Reveal | null {
  const scenario = scenarioById(party.scenarioId);
  if (!scenario || party.cast.length !== CAST_SIZE) return null;
  const next = rng(`${party.scenarioId}@${party.version}:${party.seed}`);
  const order = [0, 1, 2, 3, 4];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const members = party.cast.map((handle, slot) => {
    const role = scenario.roles[order[slot]];
    return { handle, role: role.name, line: role.lines[next() < 0.5 ? 0 : 1] };
  });
  // The line-up is shuffled too, so whoever was typed first isn't always on the left.
  // Its own stream, so roles and lines stay what they were for older links.
  const place = rng(`${party.seed}:lineup`);
  for (let i = members.length - 1; i > 0; i--) {
    const j = Math.floor(place() * (i + 1));
    [members[i], members[j]] = [members[j], members[i]];
  }
  return { party, scenario, members };
}

/**
 * A party as a RookieGamers share-link room: `dragon-1-k3f9xq-a-b-c-d-e` (+ `-by-x`).
 * Rooms allow letters, digits, _ and -; X handles never contain -, so it splits cleanly.
 */
export function partyRoom(party: Party): string {
  const base = [party.scenarioId, party.version, party.seed, ...party.cast].join("-");
  return party.assembler ? `${base}-by-${party.assembler}` : base;
}

export function parsePartyRoom(room: string | null | undefined): Party | null {
  if (!room || !/^[A-Za-z0-9_-]{1,120}$/.test(room)) return null;
  const parts = room.split("-");
  let assembler: string | null = null;
  if (parts.length === 3 + CAST_SIZE + 2 && parts[3 + CAST_SIZE] === "by") assembler = normalizeHandle(parts[4 + CAST_SIZE]);
  else if (parts.length !== 3 + CAST_SIZE) return null;
  const [scenarioId, version, seed] = parts;
  const cast = parts.slice(3, 3 + CAST_SIZE);
  if (!/^[a-z0-9]+$/.test(scenarioId) || !/^\d+$/.test(version) || !/^[a-z0-9]{4,16}$/.test(seed)) return null;
  if (castErrors(cast).some(Boolean)) return null;
  return { scenarioId, version: Number(version), seed, cast, assembler };
}

/** The share message. Mentions go in the text: handles printed in an image aren't clickable. */
export function sharePost(r: Reveal): string {
  const mentions = r.members.map((m) => `@${m.handle}`).join(" ");
  return `${r.scenario.title}. This is the party I'm apparently dying with. ${mentions}`;
}
