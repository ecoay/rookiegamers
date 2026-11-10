// Crop and resize an image in the browser before it's uploaded. Used for game covers (16:9) and
// studio logos (square) on /admin and /dev. Drag to move, use the slider (or wheel / pinch) to
// zoom, then the image is drawn at the exact output size and saved as WebP (JPEG or PNG where
// the browser can't encode WebP).
//
//   const file = await rgCrop(input.files[0], { aspect: 16 / 9, width: 1280, height: 720 });
//   // null if the person cancelled
(function () {
  const css = `.rgc{border:1px solid #2e2944;border-radius:16px;background:#191626;color:#f4f1ff;padding:16px;width:min(600px,calc(100vw - 32px));max-width:none}
.rgc::backdrop{background:#000b}.rgc h3{margin:0 0 10px;font:700 17px system-ui,sans-serif}
.rgc .vp{position:relative;width:100%;border-radius:10px;overflow:hidden;background:repeating-conic-gradient(#2a2540 0 25%,#221e33 0 50%) 0 0/20px 20px;touch-action:none;cursor:grab}
.rgc canvas{display:block;width:100%;height:auto}.rgc .vp:active{cursor:grabbing}
.rgc .row{display:flex;align-items:center;gap:10px;margin:12px 0 0;font:14px system-ui,sans-serif;color:#a49dbf}.rgc input[type=range]{flex:1}
.rgc .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.rgc small{color:#a49dbf}`;
  let styled = false;

  function loadImage(file) {
    return new Promise((ok, bad) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => bad(new Error('That file isn\'t an image this browser can open.'));
      img.src = url;
    });
  }

  function encode(canvas, alpha) {
    const blob = (type, q) => new Promise(r => canvas.toBlob(r, type, q));
    return blob('image/webp', 0.9).then(b => (b && b.type === 'image/webp' ? b : alpha ? blob('image/png') : blob('image/jpeg', 0.9)));
  }

  window.rgCrop = async function (file, { aspect = 16 / 9, width = 1280, height = Math.round(width / aspect), title = 'Crop the image', alpha = false } = {}) {
    if (!file) return null;
    const img = await loadImage(file);
    if (!styled) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true; }
    const PW = 640, PH = Math.round(PW / aspect);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const cover = Math.max(PW / iw, PH / ih), contain = Math.min(PW / iw, PH / ih);
    let s = cover, ox = (PW - iw * s) / 2, oy = (PH - ih * s) / 2;

    const dlg = document.createElement('dialog');
    dlg.className = 'rgc';
    dlg.innerHTML = `<h3></h3><div class="vp"><canvas width="${PW}" height="${PH}"></canvas></div>
<div class="row"><span>Zoom</span><input type="range" min="0" max="1000" value="0" aria-label="Zoom"><button type="button" class="btn ghost small" data-fit>Fit all</button></div>
<small>Drag to move. Saved at ${width} by ${height}.</small>
<div class="acts"><button type="button" class="btn ghost" data-no>Cancel</button><button type="button" class="btn" data-ok>Use this</button></div>`;
    dlg.querySelector('h3').textContent = title;
    document.body.appendChild(dlg);
    const cv = dlg.querySelector('canvas'), ctx = cv.getContext('2d'), range = dlg.querySelector('input'), vp = dlg.querySelector('.vp');
    // The slider runs from "fit the whole image" to 4x "fill the frame", on a log scale.
    const lo = Math.min(contain, cover), hi = cover * 4;
    const toRange = v => Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo));
    const fromRange = r => lo * Math.pow(hi / lo, r / 1000);
    range.value = toRange(s);

    const clamp = () => {
      const w = iw * s, h = ih * s;
      ox = Math.min(Math.max(ox, Math.min(0, PW - w)), Math.max(0, PW - w));
      oy = Math.min(Math.max(oy, Math.min(0, PH - h)), Math.max(0, PH - h));
    };
    const draw = () => { clamp(); ctx.clearRect(0, 0, PW, PH); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, ox, oy, iw * s, ih * s); };
    const zoomTo = (ns, cx = PW / 2, cy = PH / 2) => {
      ns = Math.min(hi, Math.max(lo, ns));
      ox = cx - (cx - ox) * (ns / s); oy = cy - (cy - oy) * (ns / s); s = ns;
      range.value = toRange(s); draw();
    };
    draw();

    // Drag with a mouse or one finger; pinch with two.
    const pts = new Map();
    let last = null, pinch = null;
    const local = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * PW / r.width, y: (e.clientY - r.top) * PH / r.height }; };
    vp.addEventListener('pointerdown', e => { vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); last = local(e); pinch = null; });
    vp.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch) zoomTo(s * d / pinch, c.x, c.y);
        pinch = d; return;
      }
      const p = local(e);
      if (last) { ox += p.x - last.x; oy += p.y - last.y; draw(); }
      last = p;
    });
    const up = e => { pts.delete(e.pointerId); pinch = null; last = pts.size === 1 ? [...pts.values()][0] : null; };
    vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', e => { e.preventDefault(); const p = local(e); zoomTo(s * Math.exp(-e.deltaY / 500), p.x, p.y); }, { passive: false });
    range.addEventListener('input', () => zoomTo(fromRange(Number(range.value))));
    dlg.querySelector('[data-fit]').onclick = () => { zoomTo(contain); ox = (PW - iw * s) / 2; oy = (PH - ih * s) / 2; draw(); };

    const result = await new Promise(done => {
      dlg.querySelector('[data-no]').onclick = () => done(null);
      dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
      dlg.querySelector('[data-ok]').onclick = async () => {
        const out = document.createElement('canvas');
        out.width = width; out.height = height;
        const o = out.getContext('2d'), k = width / PW;
        o.imageSmoothingQuality = 'high';
        if (!alpha) { o.fillStyle = '#000'; o.fillRect(0, 0, width, height); }
        o.drawImage(img, ox * k, oy * k, iw * s * k, ih * s * k);
        const blob = await encode(out, alpha);
        const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type] || 'img';
        done(new File([blob], `${(file.name || 'image').replace(/\.[^.]+$/, '')}.${ext}`, { type: blob.type }));
      };
      dlg.showModal();
    });
    dlg.close(); dlg.remove(); URL.revokeObjectURL(img.src);
    return result;
  };
})();
