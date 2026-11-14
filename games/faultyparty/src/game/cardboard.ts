/**
 * The free character: a deliberately cheap cardboard standee. Scissor-cut
 * edges, corrugation, a strip of tape, a fold-out stand and a sharpie face
 * that has no opinion about anything. Placeholder until the shared YouCult
 * cardboard NPC art is wired in; swap `standee` and the card keeps working.
 */
const CARD = { face: "#c69a5c", edge: "#8b6234", rib: "#a87d43", stand: "#7a5530", tape: "#efe6d2", ink: "#14110f" };

const BODY =
  "M-16 -196 L16 -196 L58 -184 L74 -150 L78 -92 L62 -90 L56 -140 L50 -96 L46 -10 L10 -10 L4 -80 L-4 -80 L-10 -10 L-46 -10 L-50 -96 L-56 -140 L-62 -90 L-78 -92 L-74 -150 L-58 -184 Z";

function hash(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** A scissor-cut head: a rough decagon instead of a clean circle. */
function head(h: number) {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = 36 + (((h >>> (k * 3)) & 7) - 3.5) * 0.9;
    pts.push(`${(Math.cos(a) * r).toFixed(1)} ${(-232 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

/** One standee with its feet at (x, baseY). `slot` varies the wear, `seed` the wobble. */
export function standee(x: number, baseY: number, slot: number, seed: string): string {
  const h = hash(seed);
  const tilt = ((h % 600) / 100 - 3).toFixed(2);
  const id = `cb${slot}`;
  const headPath = head(h);
  const ribs = Array.from({ length: 24 }, (_, k) => `<line x1="${-84 + k * 7}" y1="-280" x2="${-84 + k * 7}" y2="0"/>`).join("");
  const wear = [
    `<rect x="-26" y="-276" width="52" height="16" fill="${CARD.tape}" opacity="0.8" transform="rotate(-14 0 -268)"/>`,
    `<line x1="-56" y1="-160" x2="50" y2="-60" stroke="${CARD.edge}" stroke-width="2" opacity="0.6"/>
     <rect x="38" y="-176" width="44" height="14" fill="${CARD.tape}" opacity="0.8" transform="rotate(32 60 -169)"/>`,
    `<path d="M50 -96 L62 -90 L56 -120 Z" fill="${CARD.stand}"/>
     <rect x="-82" y="-130" width="40" height="14" fill="${CARD.tape}" opacity="0.8" transform="rotate(-70 -62 -123)"/>`,
  ][slot % 3];
  return `<g transform="translate(${x} ${baseY}) rotate(${tilt})">
    <ellipse cx="6" cy="0" rx="70" ry="9" fill="#000" opacity="0.35"/>
    <path d="M8 -120 L36 -2 L-6 -2 Z" fill="${CARD.stand}"/>
    <defs><clipPath id="${id}"><path d="${BODY}"/><path d="${headPath}"/></clipPath></defs>
    <path d="${BODY}" fill="${CARD.face}" stroke="${CARD.edge}" stroke-width="3" stroke-linejoin="bevel"/>
    <path d="${headPath}" fill="${CARD.face}" stroke="${CARD.edge}" stroke-width="3" stroke-linejoin="bevel"/>
    <g clip-path="url(#${id})" stroke="${CARD.rib}" stroke-width="1.4" opacity="0.45">${ribs}</g>
    <circle cx="-12" cy="-238" r="3.4" fill="${CARD.ink}"/>
    <circle cx="12" cy="-238" r="3.4" fill="${CARD.ink}"/>
    <line x1="-11" y1="-216" x2="11" y2="-216" stroke="${CARD.ink}" stroke-width="3" stroke-linecap="round"/>
    ${wear}
  </g>`;
}
