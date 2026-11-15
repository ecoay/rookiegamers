import type { Reveal } from "./party.ts";
import type { Scene } from "./scenarios.ts";
import { standee } from "./cardboard.ts";
import { cutoutSvg, handleSeed, type CutoutKit, type Pet } from "./youcult-cutout.ts";

/** Pets each cast member brings, by handle (lowercase). Up to two, one per bottom corner. */
export type CastPets = Record<string, { left?: Pet; right?: Pet }>;

/**
 * The share card, as SVG markup: scenario backdrop, title and setup, five
 * cardboard standees with handle / role / punchline, and the credit bar.
 * Pure, so the browser rasterises it to a PNG (src/render.ts) and tests can
 * inspect the markup.
 */
export const CARD_W = 1200;
export const CARD_H = 675;

export const SLAB = "Alfa Slab One";
export const MONO = "IBM Plex Mono";
const C = { ink: "#14110f", red: "#d42a24", cream: "#f3e6cf", tape: "#efe6d2" };

export const esc = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

/** Font size that fits `text` in `room` px, given the font's average advance per character. */
const fit = (text: string, max: number, room: number, advance: number) =>
  Math.min(max, Math.floor(room / (Math.max(text.length, 1) * advance)));

/** Rough rendered width of `text` in ems for Alfa Slab One, whose capitals run wide. */
function slabEms(text: string) {
  let ems = 0;
  for (const ch of text) ems += /[WM]/.test(ch) ? 1.05 : /[A-Z@mw]/.test(ch) ? 0.82 : /[il1._]/.test(ch) ? 0.45 : 0.62;
  return ems;
}

/** Greedy word wrap to `width` characters, at most `lines` lines (the last one ellipsised). */
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width || !line) {
      line = next;
      continue;
    }
    out.push(line);
    line = word;
    if (out.length === lines) {
      line = "";
      const last = out[lines - 1];
      out[lines - 1] = `${last.slice(0, Math.max(width - 1, 1)).trimEnd()}…`;
      return out;
    }
  }
  if (line) out.push(line);
  return out;
}

function tspans(lines: string[], x: number, lead: number) {
  return lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lead}">${esc(l)}</tspan>`).join("");
}

/** Cheap deterministic numbers for scattering backdrop detail. */
function scatter(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function backdrop(scene: Scene) {
  const { sky, ground, accent } = scene;
  const base = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${ground}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.55" r="0.6"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#sky)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>`;
  const rand = scatter(scene.motif.length * 7919 + sky.charCodeAt(1));
  const floor = `<rect y="440" width="${CARD_W}" height="${CARD_H - 440}" fill="${ground}" opacity="0.85"/>`;
  let motif = "";
  switch (scene.motif) {
    case "cave": {
      const tips = Array.from({ length: 14 }, (_, i) => {
        const x = i * 90 + rand() * 40;
        const h = 60 + rand() * 90;
        return `<path d="M${x} 0 L${x + 30 + rand() * 20} ${h} L${x + 70} 0 Z" fill="${C.ink}" opacity="0.55"/>`;
      }).join("");
      motif = `${tips}
        <ellipse cx="600" cy="440" rx="420" ry="70" fill="${accent}" opacity="0.35"/>
        <ellipse cx="600" cy="430" rx="260" ry="40" fill="#f5c542" opacity="0.5"/>
        <ellipse cx="470" cy="250" rx="34" ry="14" fill="${accent}"/><ellipse cx="470" cy="250" rx="6" ry="13" fill="${C.ink}"/>
        <ellipse cx="730" cy="250" rx="34" ry="14" fill="${accent}"/><ellipse cx="730" cy="250" rx="6" ry="13" fill="${C.ink}"/>`;
      break;
    }
    case "city": {
      motif = Array.from({ length: 16 }, (_, i) => {
        const w = 60 + rand() * 40;
        const h = 120 + rand() * 200;
        return `<rect x="${i * 78 - 20}" y="${440 - h}" width="${w}" height="${h}" fill="${C.ink}" opacity="0.6"/>`;
      }).join("");
      motif += `<circle cx="980" cy="160" r="60" fill="${accent}" opacity="0.4"/>`;
      break;
    }
    case "stars": {
      motif = Array.from({ length: 70 }, () => `<circle cx="${rand() * CARD_W}" cy="${rand() * 430}" r="${0.8 + rand() * 1.8}" fill="#fff" opacity="${0.4 + rand() * 0.5}"/>`).join("");
      motif += `<path d="M470 210 L730 210 L900 450 L300 450 Z" fill="${accent}" opacity="0.18"/>
        <ellipse cx="600" cy="200" rx="200" ry="38" fill="#8d97b5"/><ellipse cx="600" cy="180" rx="90" ry="44" fill="#c9d4ea" opacity="0.8"/>
        ${[480, 540, 600, 660, 720].map((x) => `<circle cx="${x}" cy="208" r="7" fill="${accent}"/>`).join("")}`;
      break;
    }
    case "vault": {
      motif = `<circle cx="600" cy="260" r="200" fill="#5b6066" stroke="${C.ink}" stroke-width="10"/>
        <circle cx="600" cy="260" r="150" fill="none" stroke="#3e4247" stroke-width="6"/>
        ${Array.from({ length: 6 }, (_, i) => `<line x1="600" y1="260" x2="${600 + Math.cos((i * Math.PI) / 3) * 110}" y2="${260 + Math.sin((i * Math.PI) / 3) * 110}" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>`).join("")}
        <circle cx="600" cy="260" r="34" fill="${accent}"/>`;
      break;
    }
    case "motel": {
      motif = `<rect x="80" y="170" width="1040" height="270" fill="#4a2f3a" opacity="0.8"/>
        ${[160, 380, 600, 820, 1040].map((x) => `<rect x="${x - 50}" y="250" width="100" height="190" fill="${C.ink}" opacity="0.5"/>`).join("")}
        ${Array.from({ length: 10 }, () => {
          const x = 90 + rand() * 1020;
          return `<rect x="${x}" y="170" width="6" height="${30 + rand() * 90}" rx="3" fill="#8b0f1a" opacity="0.9"/>`;
        }).join("")}
        <rect x="500" y="146" width="200" height="56" rx="8" fill="${C.ink}" stroke="${accent}" stroke-width="4"/>
        <text x="600" y="186" text-anchor="middle" font-family="${SLAB}" font-size="38" fill="${accent}">MOTEL</text>`;
      break;
    }
    case "sea": {
      motif = `<path d="M760 120 L1180 300 L1180 440 L700 440 Z" fill="${C.ink}" opacity="0.55"/>
        <rect x="1000" y="150" width="40" height="120" fill="#7a2a20" transform="rotate(22 1020 210)"/>
        ${[400, 430, 460].map((y, i) => `<path d="M0 ${y} ${Array.from({ length: 13 }, (_, k) => `Q${k * 100 + 50} ${y - 22 + i * 4} ${k * 100 + 100} ${y}`).join(" ")}" fill="none" stroke="${accent}" stroke-width="3" opacity="${0.5 - i * 0.12}"/>`).join("")}`;
      break;
    }
    case "hall": {
      motif = `${[150, 450, 750, 1050].map((x) => `<path d="M${x - 110} 440 L${x - 110} 170 Q${x} 50 ${x + 110} 170 L${x + 110} 440 Z" fill="${C.ink}" opacity="0.35"/>`).join("")}
        <rect x="40" y="400" width="1120" height="40" fill="#6b3a20"/>
        <rect x="40" y="396" width="1120" height="8" fill="${C.cream}" opacity="0.6"/>
        ${[300, 600, 900].map((x) => `<circle cx="${x}" cy="40" r="22" fill="${accent}" opacity="0.8"/>`).join("")}`;
      break;
    }
    case "bunker": {
      motif = `${[60, 110, 330].map((y) => `<rect y="${y}" width="${CARD_W}" height="18" fill="#59564b"/>`).join("")}
        <circle cx="1040" cy="230" r="85" fill="#59564b" stroke="${C.ink}" stroke-width="8"/>
        <circle cx="1040" cy="230" r="20" fill="${accent}"/>
        <g opacity="0.85">${Array.from({ length: 30 }, (_, i) => `<rect x="${i * 40}" y="420" width="20" height="20" fill="${i % 2 ? accent : C.ink}" transform="skewX(-30)"/>`).join("")}</g>`;
      break;
    }
    case "clock": {
      motif = `<circle cx="600" cy="260" r="190" fill="none" stroke="${accent}" stroke-width="6" opacity="0.7"/>
        <circle cx="600" cy="260" r="230" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="6 14" opacity="0.5"/>
        ${Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return `<line x1="${600 + Math.cos(a) * 165}" y1="${260 + Math.sin(a) * 165}" x2="${600 + Math.cos(a) * 185}" y2="${260 + Math.sin(a) * 185}" stroke="${accent}" stroke-width="5"/>`;
        }).join("")}
        <line x1="600" y1="260" x2="600" y2="120" stroke="${C.cream}" stroke-width="8" stroke-linecap="round"/>
        <line x1="600" y1="260" x2="700" y2="320" stroke="${C.cream}" stroke-width="8" stroke-linecap="round"/>`;
      break;
    }
    case "retreat": {
      motif = `<circle cx="600" cy="300" r="110" fill="#f4b23c" opacity="0.8"/>
        ${Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return `<line x1="${600 + Math.cos(a) * 130}" y1="${300 + Math.sin(a) * 130}" x2="${600 + Math.cos(a) * 180}" y2="${300 + Math.sin(a) * 180}" stroke="#f4b23c" stroke-width="8"/>`;
        }).join("")}
        ${[120, 1080].map((x) => `<path d="M${x - 90} 440 L${x} 300 L${x + 90} 440 Z" fill="${C.cream}" stroke="${C.ink}" stroke-width="4"/>`).join("")}
        <rect x="380" y="140" width="440" height="40" fill="${accent}"/>
        <text x="600" y="169" text-anchor="middle" font-family="${SLAB}" font-size="24" fill="${C.cream}">WELCOME HOME, FRIEND</text>`;
      break;
    }
  }
  const grit = `<filter id="grit" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 0.95"/>
    </filter>`;
  return `${base}${floor}${motif}<defs>${grit}</defs><rect width="${CARD_W}" height="${CARD_H}" filter="url(#grit)" opacity="0.28"/>`;
}

/** Card px per YouCult art px: the 384 px body stands about 240 px tall on the card. */
const CUTOUT_K = 0.62;

/** One cast member's cardboard: the shared YouCult cutout when the kit is there, else the built-in standee. */
function castCutout(kit: CutoutKit | undefined, x: number, baseY: number, slot: number, handle: string, partySeed: string, pets?: CastPets) {
  const art = kit && cutoutSvg(kit, handleSeed(handle), { stamp: true, pets: pets?.[handle.toLowerCase()] });
  if (!art) return standee(x, baseY, slot, `${partySeed}:${slot}`);
  const tilt = ((slot * 37) % 5) - 2;
  return `<g transform="translate(${x} ${baseY}) rotate(${tilt}) scale(${CUTOUT_K})">
    <ellipse cx="0" cy="-4" rx="110" ry="16" fill="#000" opacity="0.35"/>${art}</g>`;
}

/** The artist's background for a scenario, when one has been delivered (see assets/bg/README.md). */
function paintedBackdrop(href: string) {
  return `<image href="${href}" width="${CARD_W}" height="${CARD_H}" preserveAspectRatio="xMidYMid slice"/>`;
}

export function cardSvg(r: Reveal, kit?: CutoutKit, background?: string | null, pets?: CastPets): string {
  const { scenario, members, party } = r;
  const title = scenario.title.toUpperCase();
  const setup = wrap(scenario.setup, 104, 2);
  const col = CARD_W / members.length;

  const cast = members
    .map((m, i) => {
      const cx = col * i + col / 2;
      const handle = `@${m.handle}`;
      const role = wrap(m.role.toUpperCase(), 21, 2);
      const line = wrap(m.line, 27, 3);
      const roleH = role.length * 18 + 14;
      const roleY = 506;
      return `${castCutout(kit, cx, 452, i, m.handle, party.seed, pets)}
      <g transform="rotate(${i % 2 ? 1.5 : -1.5} ${cx} 474)">
        <rect x="${cx - 104}" y="456" width="208" height="38" fill="${C.tape}" opacity="0.95"/>
        <text x="${cx}" y="485" text-anchor="middle" font-family="${SLAB}" font-size="${Math.min(26, Math.floor(192 / slabEms(handle)))}" fill="${C.ink}">${esc(handle)}</text>
      </g>
      <rect x="${cx - 110}" y="${roleY}" width="220" height="${roleH}" fill="${C.red}"/>
      <text x="${cx}" y="${roleY + 23}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="15" fill="${C.cream}">${tspans(role, cx, 18)}</text>
      <text x="${cx}" y="${roleY + roleH + 22}" text-anchor="middle" font-family="${MONO}" font-size="13.5" fill="${C.cream}">${tspans(line, cx, 17)}</text>`;
    })
    .join("");

  const credit = `Scenario by @${scenario.creator}`;
  const assembled = party.assembler ? `Party assembled by @${party.assembler}` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  ${background ? paintedBackdrop(background) : backdrop(scenario.scene)}
  <rect x="0" y="0" width="${CARD_W}" height="132" fill="${C.ink}" opacity="0.72"/>
  <text x="40" y="62" font-family="${SLAB}" font-size="${fit(title, 48, 1120, 0.78)}" fill="${C.cream}">${esc(title)}</text>
  <text x="40" y="94" font-family="${MONO}" font-size="17" fill="${C.cream}" opacity="0.92">${tspans(setup, 40, 22)}</text>
  <rect x="0" y="${CARD_H - 38}" width="${CARD_W}" height="38" fill="${C.ink}"/>
  <text x="24" y="${CARD_H - 13}" font-family="${MONO}" font-weight="700" font-size="15" fill="${C.cream}">${esc(credit)}</text>
  <text x="${CARD_W / 2}" y="${CARD_H - 13}" text-anchor="middle" font-family="${MONO}" font-size="15" fill="${C.cream}" opacity="0.85">${esc(assembled)}</text>
  <text x="${CARD_W - 24}" y="${CARD_H - 12}" text-anchor="end" font-family="${SLAB}" font-size="17" fill="${C.red}">FAULTYPARTY · ROOKIEGAMERS.COM</text>
  ${cast}
</svg>`;
}
