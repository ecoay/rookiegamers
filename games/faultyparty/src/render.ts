import { cardSvg, CARD_H, CARD_W } from "./game/card.ts";
import type { Reveal } from "./game/party.ts";
import type { CutoutKit } from "./game/youcult-cutout.ts";

/**
 * Turns the card's SVG into a PNG in the browser. An SVG drawn as an image can't
 * load anything outside itself, so every art part and both fonts go in as data
 * URIs first: the card is drawn once with placeholder hrefs to learn which parts
 * it uses, those are fetched, then swapped in.
 */
const ASSET = "fp-asset:";
const FONTS = [
  { family: "Alfa Slab One", weight: 400, file: "fonts/alfa-slab-one.ttf" },
  { family: "IBM Plex Mono", weight: 400, file: "fonts/ibm-plex-mono-regular.ttf" },
  { family: "IBM Plex Mono", weight: 700, file: "fonts/ibm-plex-mono-bold.ttf" },
];

const cache = new Map<string, Promise<string>>();
function dataUri(path: string): Promise<string> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      );
    hit.catch(() => cache.delete(path));
    cache.set(path, hit);
  }
  return hit;
}

let kitReady: Promise<CutoutKit> | null = null;
function kit(): Promise<CutoutKit> {
  kitReady ??= Promise.all(
    ["npc/body-joints.json", "npc/headwear-rig.json", "npc/stamp.json"].map((f) => fetch(f).then((r) => r.json())),
  ).then(([joints, hats, stamp]) => ({ href: (part: string) => `${ASSET}npc/${part}.webp`, joints, hats: hats.items, stamp }));
  kitReady.catch(() => (kitReady = null));
  return kitReady;
}

async function fontCss() {
  const faces = await Promise.all(
    FONTS.map(async (f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url(${await dataUri(f.file)}) format("truetype");}`),
  );
  return faces.join("");
}

/** The finished card as a PNG blob, at twice the card's size so it stays sharp on phones. */
export async function renderCard(r: Reveal): Promise<Blob> {
  let svg = cardSvg(r, await kit(), `${ASSET}bg/bg_${r.scenario.id}.jpg`);
  const paths = [...new Set(Array.from(svg.matchAll(/fp-asset:([^"]+)/g), (m) => m[1]))];
  const [uris, css] = await Promise.all([Promise.all(paths.map((p) => dataUri(p).catch(() => ""))), fontCss()]);
  paths.forEach((p, i) => (svg = svg.split(`${ASSET}${p}`).join(uris[i])));
  svg = svg.replace(/(<svg[^>]*>)/, `$1<defs><style>${css}</style></defs>`);

  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W * 2;
    canvas.height = CARD_H * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No PNG."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
