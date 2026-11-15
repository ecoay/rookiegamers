/**
 * YouCult's cardboard follower, drawn as SVG for the share card. A port of
 * paintArtCutout in youcult game/src/art_pack.js: same parts kit, same rig,
 * same seeded draw order, so a seed gives the same cutout in both games.
 *
 * FaultyParty draws every cast member deadpan (YouCult mood band 1: flat
 * mouth, arms at the sides) and seeds by X handle, so a friend keeps the same
 * cardboard look on every card they show up on.
 */

/** Joint positions on the 256 x 384 body canvas (youcult body-joints.json). */
export type Joints = {
  pivot: [number, number];
  crown: [number, number];
  eyes: [number, number];
  brows: [number, number];
  mouth: [number, number];
  leftShoulder: [number, number];
  rightShoulder: [number, number];
};

export type CutoutKit = {
  /** An image href (usually a data URI) for a part, or null when the part is missing. */
  href(part: string): string | null;
  joints: Record<string, Joints>;
  hats: Record<string, { pivot: [number, number]; scale?: number }>;
  /** Where the "NPC" print fits on each body (assets/npc/stamp.json). */
  stamp?: Record<string, { cx: number; cy: number; width: number }>;
};

// Tables copied from youcult art_pack.js.
const MOOD_FACE: Record<number, { m: number[]; b: number[] }> = {
  4: { m: [2, 6, 13, 7], b: [1, 2] },
  3: { m: [1, 7, 9, 14], b: [1, 2] },
  2: { m: [12, 9, 14, 5], b: [3, 6] },
  1: { m: [4, 5, 8], b: [4, 8] },
  0: { m: [3, 10, 11, 4], b: [5, 7] },
};
const ACC_POOL = [2, 5, 6, 10, 13, 14, 15, 16, 17, 18, 19, 21, 23];
const EYES_POOL = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const p2 = (i: number) => String(i).padStart(2, "0");

// youcult engine.js: fnv1a + mulberry32.
function fnv1a(str: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed a person's cutout is drawn from: their X handle, case-insensitive. */
export const handleSeed = (handle: string) => `x:${handle.toLowerCase()}`;

const deg = (rad: number) => (rad * 180) / Math.PI;

/**
 * "NPC" screen-printed across the cardboard in grey ink: multiplied into the
 * board so the corrugation shows through, speckled where the ink didn't take,
 * a slightly slipped second pass, and masked to the body so it can't print
 * past the cut edge.
 */
function npcStamp(bodyHref: string, id: string, tilt: number, at: { cx: number; cy: number; width: number }) {
  const size = Math.min(74, Math.floor((at.width * 0.86) / 2.45));
  const base = Math.round(at.cy + size * 0.36);
  return `<defs>
    <filter id="${id}w" x="0" y="0" width="100%" height="100%">
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/>
    </filter>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="384">
      <image href="${bodyHref}" width="256" height="384" filter="url(#${id}w)"/>
    </mask>
    <filter id="${id}i" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="${tilt + 9}" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.1" result="speckle"/>
      <feComposite in="SourceGraphic" in2="speckle" operator="in"/>
    </filter>
  </defs>
  <g mask="url(#${id}m)" style="mix-blend-mode:multiply">
    <g transform="rotate(${tilt} ${at.cx} ${at.cy})" font-family="Alfa Slab One" font-size="${size}" text-anchor="middle" letter-spacing="${Math.round(size / 18)}">
      <text x="${at.cx + 2}" y="${base + 3}" fill="#7d7d7d" opacity="0.28">NPC</text>
      <text x="${at.cx}" y="${base}" fill="#6e6e6e" opacity="0.85" filter="url(#${id}i)">NPC</text>
    </g>
  </g>`;
}

/**
 * The cutout as SVG in art pixels, feet (pivot 128,376) at the origin. Null
 * when the kit is missing the body, so the caller can fall back.
 */
/** A pet image and its pixel size, overlaid on a bottom corner of the cutout. */
export type Pet = { href: string; w: number; h: number };

/** Pets sit over the bottom-left and bottom-right corners, feet on the floor line, up to two. */
function petSvg(pet: Pet, corner: "left" | "right") {
  const h = 120;
  const w = (pet.w / pet.h) * h;
  const cx = corner === "left" ? 34 : 222;
  const flip = corner === "right" ? ` transform="translate(${cx * 2} 0) scale(-1 1)"` : "";
  return `<g${flip}><ellipse cx="${cx}" cy="378" rx="${w * 0.42}" ry="9" fill="#000" opacity="0.35"/><image href="${pet.href}" x="${cx - w / 2}" y="${380 - h}" width="${w}" height="${h}"/></g>`;
}

export function cutoutSvg(
  kit: CutoutKit,
  seed: string,
  opts: { tape?: boolean; stamp?: boolean; pets?: { left?: Pet; right?: Pet } } = {},
): string | null {
  const r = mulberry32(fnv1a(seed));
  const bi = 1 + Math.floor(r() * 12);
  const J = kit.joints[String(bi)] ?? kit.joints["1"];
  const body = kit.href(`chr_body_${p2(bi)}_front`);
  if (!J || !body) return null;
  const img = (part: string, x: number, y: number, w: number, h: number, extra = "") => {
    const href = kit.href(part);
    return href ? `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}"${extra}/>` : "";
  };

  // Mood band 1 in YouCult: both arms hang straight down.
  const side = r() < 0.5 ? -1 : 1;
  const pose = 0.06;
  const arm = (right: boolean) => {
    const [sx, sy] = right ? [J.rightShoulder[0] - 6, J.rightShoulder[1] - 4] : [J.leftShoulder[0] + 6, J.leftShoulder[1] - 4];
    return `<g transform="translate(${sx} ${sy})${right ? " scale(-1 1)" : ""} rotate(${deg(pose).toFixed(2)})">${img("chr_arm_down", -32, -16, 64, 192)}</g>`;
  };

  const mf = MOOD_FACE[1];
  const eyes = EYES_POOL[Math.floor(r() * EYES_POOL.length)];
  const mouth = mf.m[Math.floor(r() * mf.m.length)];
  const brow = mf.b[Math.floor(r() * mf.b.length)];
  const hk = 2 + Math.floor(r() * 19);
  const hat = kit.hats[String(hk)];
  const wearsHat = r() < 0.7 && !!hat;
  const acc = ACC_POOL[Math.floor(r() * ACC_POOL.length)];

  const parts = [
    arm(false),
    arm(true),
    img(`chr_body_${p2(bi)}_front`, 0, 0, 256, 384),
    opts.tape ? img("chr_status_tape", 0, 0, 256, 384) : "",
    opts.stamp ? npcStamp(body, `np${fnv1a(seed).toString(36)}`, (fnv1a(seed + ":tilt") % 9) - 4, kit.stamp?.[String(bi)] ?? { cx: 128, cy: 300, width: 200 }) : "",
    img(`chr_eyes_${p2(eyes)}`, J.eyes[0] - 48, J.eyes[1] - 24, 96, 48),
    img(`chr_brow_${p2(brow)}`, J.brows[0] - 48, J.brows[1] - 16, 96, 32),
    img(`chr_mouth_${p2(mouth)}`, J.mouth[0] - 40, J.mouth[1] - 24, 80, 48),
  ];
  if (wearsHat && hat) {
    const s = hat.scale ?? 1;
    parts.push(img(`chr_hat_${p2(hk)}`, J.crown[0] - hat.pivot[0] * s, J.crown[1] - hat.pivot[1] * s, 192 * s, 160 * s));
  }
  parts.push(img(`chr_acc_${p2(acc)}`, 128 + side * 34 - 40, Math.max(J.mouth[1] + 50, 220) - 40, 80, 80));
  if (opts.pets?.left) parts.push(petSvg(opts.pets.left, "left"));
  if (opts.pets?.right) parts.push(petSvg(opts.pets.right, "right"));
  return `<g transform="translate(${-J.pivot[0]} ${-J.pivot[1]})">${parts.join("")}</g>`;
}
