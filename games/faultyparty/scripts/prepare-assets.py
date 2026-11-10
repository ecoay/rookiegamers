"""Copy the art FaultyParty needs into public/.

    python3 scripts/prepare-assets.py --youcult ../../../youcult --backgrounds <folder of bg_<id>.png>

- npc/: the YouCult cardboard follower parts (WebP, as YouCult ships them), the body
  joints and headwear rigs, and stamp.json (where "NPC" fits on each body).
- bg/: the scenario backgrounds, 2400x1350 masters scaled to 1600x900 JPEG for the web.

Rerun after the YouCult pack or a background changes. Needs Pillow.
"""
import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--youcult", required=True)
ap.add_argument("--backgrounds")
a = ap.parse_args()

here = Path(__file__).resolve().parent.parent / "public"
src = Path(a.youcult) / "game/assets-src"
npc = here / "npc"
npc.mkdir(parents=True, exist_ok=True)

PARTS = (
    [f"chr_body_{i:02d}_front" for i in range(1, 13)]
    + ["chr_arm_down", "chr_status_tape"]
    + [f"chr_eyes_{i:02d}" for i in range(1, 17)]
    + [f"chr_mouth_{i:02d}" for i in range(1, 15)]
    + [f"chr_brow_{i:02d}" for i in range(1, 9)]
    + [f"chr_hat_{i:02d}" for i in range(1, 21)]
    + [f"chr_acc_{i:02d}" for i in range(1, 25)]
)
missing = []
for name in PARTS:
    webp = src / "runtime/characters" / f"{name}.webp"
    if webp.exists():
        shutil.copy(webp, npc / webp.name)
    else:
        missing.append(name)
for rig in ("body-joints.json", "headwear-rig.json"):
    shutil.copy(src / rig, npc / rig)

# Where the "NPC" print fits on each body: the widest row of the lower torso.
stamp = {}
for i in range(1, 13):
    alpha = Image.open(npc / f"chr_body_{i:02d}_front.webp").convert("RGBA").getchannel("A")
    best = None
    for y in range(250, 345, 5):
        xs = [x for x in range(alpha.width) if alpha.getpixel((x, y)) > 200]
        if xs and (best is None or xs[-1] - xs[0] > best[2]):
            best = ((xs[0] + xs[-1]) // 2, y, xs[-1] - xs[0])
    if best:
        stamp[str(i)] = {"cx": best[0], "cy": best[1], "width": best[2]}
(npc / "stamp.json").write_text(json.dumps(stamp, indent=2) + "\n")
print(f"{len(PARTS) - len(missing)} parts in {npc}" + (f" (missing: {', '.join(missing)})" if missing else ""))

if a.backgrounds:
    bg = here / "bg"
    bg.mkdir(exist_ok=True)
    for png in sorted(Path(a.backgrounds).glob("bg_*.png")):
        Image.open(png).convert("RGB").resize((1600, 900), Image.LANCZOS).save(bg / f"{png.stem}.jpg", quality=84, optimize=True, progressive=True)
        print("bg", png.stem)
