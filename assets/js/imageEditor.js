/**
 * imageEditor.js
 * Editor de imagen reutilizable que corre ANTES de subir una foto en el ERP
 * (fotos de producto en Commerce/eCommerce, obras en Gallery, y cualquier
 * subida futura). Recorte con proporción opcional + brillo / contraste /
 * saturación + girar 90°. Todo se "hornea" en un canvas, así el archivo que
 * se sube es exactamente lo que se ve en la previsualización.
 *
 * API:
 *   const file = await openImageEditor(originalFile, { aspect });
 *   // file: un File listo para subir, o null si el usuario canceló.
 *   // opts.aspect (opcional): proporción inicial del recorte (ancho/alto),
 *   //   ej. 1 para 1:1, 0.8 para 4:5. Por defecto "Libre".
 *
 * Autocontenido: inyecta su propio modal + estilos la primera vez. No
 * necesita tocar dashboard.html más allá del <script>.
 */

'use strict';

(function () {
  const STAGE_MAX = 440;   // caja de previsualización (px)
  const WORK_MAX  = 2400;  // resolución máxima con la que trabaja el editor
  const OUT_MAX   = 2200;  // lado mayor máximo del archivo final
  const MIN_CROP  = 32;    // recorte mínimo en px de trabajo

  const ASPECTS = [
    { key: 'free', label: 'Libre',  value: null },
    { key: '1',    label: '1:1',    value: 1 },
    { key: '45',   label: '4:5',    value: 0.8 },
    { key: '32',   label: '3:2',    value: 1.5 },
    { key: '169',  label: '16:9',   value: 16 / 9 },
  ];

  let el = null;           // referencias del DOM del modal
  let st = null;           // estado de la sesión actual

  function injectOnce() {
    if (el) return;

    const style = document.createElement('style');
    style.textContent = `
      #imed-overlay { position: fixed; inset: 0; z-index: 1200; display: none;
        align-items: center; justify-content: center; padding: 20px;
        background: rgba(0,0,0,.6); }
      #imed-overlay.open { display: flex; }
      .imed-modal { background: var(--card,#1a1a1a); border: 1px solid var(--border,#2a2a2a);
        border-radius: 20px; padding: 24px; width: 100%; max-width: 780px;
        max-height: 92vh; overflow-y: auto; box-shadow: 0 24px 64px rgba(0,0,0,.6);
        color: var(--text,#eee); }
      .imed-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      .imed-head h3 { margin: 0; font-size: 1.1rem; font-weight: 800; }
      .imed-x { cursor: pointer; color: var(--text-muted,#999); font-size: 1.2rem; }
      .imed-x:hover { color: var(--text,#fff); }
      .imed-body { display: grid; grid-template-columns: ${STAGE_MAX}px 1fr; gap: 22px; }
      @media (max-width: 760px) { .imed-body { grid-template-columns: 1fr; } }
      .imed-stage { position: relative; width: 100%; max-width: ${STAGE_MAX}px;
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        background: #0c0c0c; border: 1px solid var(--border,#2a2a2a); border-radius: 12px;
        overflow: hidden; margin: 0 auto; user-select: none; touch-action: none; }
      .imed-canvas-wrap { position: relative; display: inline-block; line-height: 0; }
      .imed-canvas { display: block; }
      .imed-crop { position: absolute; box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.9);
        box-shadow: 0 0 0 9999px rgba(0,0,0,.55); cursor: move; }
      .imed-crop::before, .imed-crop::after { content: ""; position: absolute; background: rgba(255,255,255,.35); }
      .imed-crop::before { left: 33.33%; right: 33.33%; top: 0; bottom: 0; border-left: 1px solid; border-right: 1px solid; border-color: rgba(255,255,255,.25); }
      .imed-crop::after  { top: 33.33%; bottom: 33.33%; left: 0; right: 0; border-top: 1px solid; border-bottom: 1px solid; border-color: rgba(255,255,255,.25); }
      .imed-h { position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 3px;
        box-shadow: 0 0 0 1px rgba(0,0,0,.4); }
      .imed-h[data-h="nw"] { left: -7px; top: -7px; cursor: nwse-resize; }
      .imed-h[data-h="ne"] { right: -7px; top: -7px; cursor: nesw-resize; }
      .imed-h[data-h="sw"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
      .imed-h[data-h="se"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
      .imed-stage.is-full .imed-crop { box-shadow: none; border: 1px dashed rgba(255,255,255,.85);
        pointer-events: none; }
      .imed-stage.is-full .imed-crop::before, .imed-stage.is-full .imed-crop::after,
      .imed-stage.is-full .imed-h { display: none; }
      .imed-btn.is-on { background: var(--accent,#143FA5); border-color: var(--accent,#143FA5); color: #fff; }
      .imed-controls { display: flex; flex-direction: column; gap: 14px; }
      .imed-controls .imed-label { font-size: .7rem; letter-spacing: .12em; text-transform: uppercase;
        color: var(--text-dim,#888); }
      .imed-aspect { display: flex; flex-wrap: wrap; gap: 6px; }
      .imed-aspect button { background: transparent; border: 1px solid var(--border,#2a2a2a);
        color: var(--text-dim,#999); padding: 6px 12px; border-radius: 8px; font: inherit;
        font-size: .8rem; cursor: pointer; }
      .imed-aspect button.is-active { background: var(--accent,#143FA5); border-color: var(--accent,#143FA5); color: #fff; }
      .imed-adj { display: grid; grid-template-columns: 70px 1fr 44px; align-items: center; gap: 8px; }
      .imed-adj span { font-size: .8rem; color: var(--text-dim,#999); }
      .imed-adj input[type=range] { width: 100%; accent-color: var(--accent,#143FA5); }
      .imed-adj output { font-size: .75rem; text-align: right; font-variant-numeric: tabular-nums; }
      .imed-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .imed-btn { background: transparent; border: 1px solid var(--border,#2a2a2a); color: var(--text,#ddd);
        padding: 8px 14px; border-radius: 8px; font: inherit; font-size: .82rem; cursor: pointer; }
      .imed-btn:hover { border-color: var(--accent,#143FA5); }
      .imed-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      .imed-actions .imed-primary { background: var(--accent,#143FA5); border: 0; color: #fff;
        padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; }
      .imed-actions .imed-primary:disabled { opacity: .55; cursor: wait; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'imed-overlay';
    overlay.innerHTML = `
      <div class="imed-modal" role="dialog" aria-modal="true" aria-label="Editar imagen">
        <div class="imed-head">
          <h3>Editar imagen</h3>
          <span class="imed-x" data-imed="cancel">✕</span>
        </div>
        <div class="imed-body">
          <div class="imed-stage" data-imed="stage">
            <div class="imed-canvas-wrap">
              <canvas class="imed-canvas" data-imed="canvas"></canvas>
              <div class="imed-crop" data-imed="crop">
                <span class="imed-h" data-h="nw"></span>
                <span class="imed-h" data-h="ne"></span>
                <span class="imed-h" data-h="sw"></span>
                <span class="imed-h" data-h="se"></span>
              </div>
            </div>
          </div>
          <div class="imed-controls">
            <div>
              <div class="imed-label">Proporción del recorte</div>
              <div class="imed-aspect" data-imed="aspect">
                ${ASPECTS.map(a => `<button type="button" data-a="${a.key}">${a.label}</button>`).join('')}
              </div>
            </div>
            <div class="imed-adj"><span>Brillo</span><input type="range" data-adj="brightness" min="50" max="150" value="100"><output data-out="brightness">100%</output></div>
            <div class="imed-adj"><span>Contraste</span><input type="range" data-adj="contrast" min="50" max="150" value="100"><output data-out="contrast">100%</output></div>
            <div class="imed-adj"><span>Saturación</span><input type="range" data-adj="saturate" min="0" max="200" value="100"><output data-out="saturate">100%</output></div>
            <div class="imed-row">
              <button class="imed-btn" type="button" data-imed="full">Ver imagen completa</button>
              <button class="imed-btn" type="button" data-imed="rotate">Girar 90°</button>
              <button class="imed-btn" type="button" data-imed="resetcrop">Quitar recorte</button>
              <button class="imed-btn" type="button" data-imed="reset">Restablecer</button>
            </div>
          </div>
        </div>
        <div class="imed-actions">
          <button class="imed-btn" type="button" data-imed="cancel">Cancelar</button>
          <button class="imed-primary" type="button" data-imed="apply">Aplicar y subir</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const q = (s) => overlay.querySelector(s);
    el = {
      overlay,
      stage:  q('[data-imed="stage"]'),
      canvas: q('[data-imed="canvas"]'),
      crop:   q('[data-imed="crop"]'),
      aspect: q('[data-imed="aspect"]'),
      apply:  q('[data-imed="apply"]'),
    };
    el.ctx = el.canvas.getContext('2d');

    // ── eventos ──
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-imed]')?.dataset.imed;
      if (act === 'cancel') finish(null);
      else if (act === 'apply') doApply();
      else if (act === 'rotate') rotate();
      else if (act === 'full') toggleFull();
      else if (act === 'resetcrop') { fullCrop(); positionCrop(); }
      else if (act === 'reset') reset();
      else if (e.target === overlay) finish(null);
    });

    el.aspect.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-a]');
      if (!btn) return;
      const a = ASPECTS.find(x => x.key === btn.dataset.a);
      setAspect(a ? a.value : null);
      [...el.aspect.children].forEach(b => b.classList.toggle('is-active', b === btn));
    });

    overlay.querySelectorAll('input[data-adj]').forEach(inp => {
      inp.addEventListener('input', () => {
        st.adj[inp.dataset.adj] = +inp.value;
        overlay.querySelector(`output[data-out="${inp.dataset.adj}"]`).textContent = inp.value + '%';
        render();
      });
    });

    document.addEventListener('keydown', (e) => {
      if (!st || !el.overlay.classList.contains('open')) return;
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
    }, true);

    initCropDrag();
  }

  // ── recorte: arrastrar para mover / handles para redimensionar ──
  function initCropDrag() {
    let mode = null;      // 'move' | 'nw' | 'ne' | 'sw' | 'se'
    let start = null;     // {px,py, crop}

    const toWork = (clientX, clientY) => {
      const r = el.canvas.getBoundingClientRect();
      return {
        x: clamp((clientX - r.left) / st.vs, 0, st.base.width),
        y: clamp((clientY - r.top) / st.vs, 0, st.base.height),
      };
    };

    el.crop.addEventListener('pointerdown', (e) => {
      if (!st) return;
      e.preventDefault();
      mode = e.target.dataset.h || 'move';
      const p = toWork(e.clientX, e.clientY);
      start = { px: p.x, py: p.y, crop: { ...st.crop } };
      el.crop.setPointerCapture?.(e.pointerId);
    });

    el.crop.addEventListener('pointermove', (e) => {
      if (!mode || !st) return;
      const p = toWork(e.clientX, e.clientY);
      if (mode === 'move') {
        st.crop.x = clamp(start.crop.x + (p.x - start.px), 0, st.base.width  - st.crop.w);
        st.crop.y = clamp(start.crop.y + (p.y - start.py), 0, st.base.height - st.crop.h);
      } else {
        const c = start.crop;
        const anchor = {
          nw: { ax: c.x + c.w, ay: c.y + c.h },
          ne: { ax: c.x,       ay: c.y + c.h },
          sw: { ax: c.x + c.w, ay: c.y },
          se: { ax: c.x,       ay: c.y },
        }[mode];
        let x0 = Math.min(anchor.ax, p.x), x1 = Math.max(anchor.ax, p.x);
        let y0 = Math.min(anchor.ay, p.y), y1 = Math.max(anchor.ay, p.y);
        let w = Math.max(x1 - x0, MIN_CROP), h = Math.max(y1 - y0, MIN_CROP);
        if (st.aspect) {
          if (w / h > st.aspect) w = h * st.aspect; else h = w / st.aspect;
          w = Math.min(w, st.base.width);  h = Math.min(h, st.base.height);
        }
        x0 = (anchor.ax <= p.x) ? anchor.ax : anchor.ax - w;
        y0 = (anchor.ay <= p.y) ? anchor.ay : anchor.ay - h;
        x0 = clamp(x0, 0, st.base.width  - w);
        y0 = clamp(y0, 0, st.base.height - h);
        st.crop = { x: x0, y: y0, w, h };
      }
      positionCrop();
    });

    const end = (e) => { mode = null; start = null; el.crop.releasePointerCapture?.(e.pointerId); };
    el.crop.addEventListener('pointerup', end);
    el.crop.addEventListener('pointercancel', end);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function filterStr() {
    const a = st.adj;
    return `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%)`;
  }

  // Canvas de trabajo = imagen original rotada, capada a WORK_MAX.
  function buildBase() {
    const img = st.img;
    const rot = st.rot;
    const swap = rot === 90 || rot === 270;
    let w = img.naturalWidth, h = img.naturalHeight;
    const sc = Math.min(1, WORK_MAX / Math.max(w, h));
    w = Math.round(w * sc); h = Math.round(h * sc);

    const base = document.createElement('canvas');
    base.width  = swap ? h : w;
    base.height = swap ? w : h;
    const bctx = base.getContext('2d');
    bctx.translate(base.width / 2, base.height / 2);
    bctx.rotate((rot * Math.PI) / 180);
    bctx.drawImage(img, -w / 2, -h / 2, w, h);
    st.base = base;
  }

  function layout() {
    st.vs = Math.min(STAGE_MAX / st.base.width, STAGE_MAX / st.base.height, 1);
    el.canvas.width  = Math.round(st.base.width  * st.vs);
    el.canvas.height = Math.round(st.base.height * st.vs);
    render();
  }

  function render() {
    const cv = el.canvas, ctx = el.ctx;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.filter = filterStr();
    ctx.drawImage(st.base, 0, 0, st.base.width, st.base.height, 0, 0, cv.width, cv.height);
    ctx.filter = 'none';
    positionCrop();
  }

  function positionCrop() {
    const c = st.crop, vs = st.vs;
    el.crop.style.left   = (c.x * vs) + 'px';
    el.crop.style.top    = (c.y * vs) + 'px';
    el.crop.style.width  = (c.w * vs) + 'px';
    el.crop.style.height = (c.h * vs) + 'px';
  }

  function fullCrop() {
    st.crop = { x: 0, y: 0, w: st.base.width, h: st.base.height };
    if (st.aspect) applyAspectToCrop();
  }

  function applyAspectToCrop() {
    let w = st.crop.w, h = w / st.aspect;
    if (h > st.base.height) { h = st.base.height; w = h * st.aspect; }
    if (w > st.base.width)  { w = st.base.width;  h = w / st.aspect; }
    st.crop.w = w; st.crop.h = h;
    st.crop.x = clamp(st.crop.x, 0, st.base.width  - w);
    st.crop.y = clamp(st.crop.y, 0, st.base.height - h);
  }

  function setAspect(a) {
    st.aspect = a || null;
    if (st.aspect) applyAspectToCrop();
    positionCrop();
  }

  // Muestra la imagen entera y sin oscurecer (el recorte queda guardado, solo
  // se dibuja como contorno) para ajustar brillo/contraste con calma.
  function toggleFull(force) {
    const on = typeof force === 'boolean' ? force : !el.stage.classList.contains('is-full');
    el.stage.classList.toggle('is-full', on);
    const btn = el.overlay.querySelector('[data-imed="full"]');
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? 'Volver al recorte' : 'Ver imagen completa';
  }

  function rotate() {
    st.rot = (st.rot + 90) % 360;
    buildBase();
    fullCrop();
    layout();
  }

  function reset() {
    st.rot = 0;
    st.adj = { brightness: 100, contrast: 100, saturate: 100 };
    el.overlay.querySelectorAll('input[data-adj]').forEach(inp => {
      inp.value = 100;
      el.overlay.querySelector(`output[data-out="${inp.dataset.adj}"]`).textContent = '100%';
    });
    buildBase();
    fullCrop();
    layout();
  }

  function doApply() {
    el.apply.disabled = true;
    const c = st.crop;
    let ow = c.w, oh = c.h;
    const sc = Math.min(1, OUT_MAX / Math.max(ow, oh));
    ow = Math.max(1, Math.round(ow * sc));
    oh = Math.max(1, Math.round(oh * sc));

    const out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    const octx = out.getContext('2d');
    octx.filter = filterStr();
    octx.drawImage(st.base, c.x, c.y, c.w, c.h, 0, 0, ow, oh);

    const isPng = /png$/i.test(st.type);
    const type = isPng ? 'image/png' : 'image/jpeg';
    const finalize = (blob) => {
      if (!blob) { el.apply.disabled = false; return; }
      const base = (st.name || 'foto').replace(/\.[^.]+$/, '');
      finish(new File([blob], base + (isPng ? '.png' : '.jpg'), { type }));
    };
    if (out.toBlob) out.toBlob(finalize, type, 0.92);
    else finalize(dataURLtoBlob(out.toDataURL(type, 0.92)));
  }

  function dataURLtoBlob(durl) {
    const [head, b64] = durl.split(',');
    const mime = /:(.*?);/.exec(head)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function finish(result) {
    el.overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (st && st.url) URL.revokeObjectURL(st.url);
    const cb = st && st.resolve;
    st = null;
    if (cb) cb(result);
  }

  // ── API pública ──
  window.openImageEditor = function (file, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!file || !/^image\//.test(file.type)) { resolve(file || null); return; }
      injectOnce();
      if (st) { resolve(null); return; } // ya hay una sesión abierta

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        st = {
          img, url, name: file.name, type: file.type,
          rot: 0, adj: { brightness: 100, contrast: 100, saturate: 100 },
          aspect: (typeof opts.aspect === 'number' && opts.aspect > 0) ? opts.aspect : null,
          resolve,
        };
        // reset controles
        el.overlay.querySelectorAll('input[data-adj]').forEach(inp => {
          inp.value = 100;
          el.overlay.querySelector(`output[data-out="${inp.dataset.adj}"]`).textContent = '100%';
        });
        const wantKey = ASPECTS.find(a => a.value === st.aspect)?.key || 'free';
        [...el.aspect.children].forEach(b => b.classList.toggle('is-active', b.dataset.a === wantKey));

        toggleFull(false);
        buildBase();
        fullCrop();
        layout();
        el.apply.disabled = false;
        el.overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); }; // no se pudo abrir: subir original
      img.src = url;
    });
  };
})();
