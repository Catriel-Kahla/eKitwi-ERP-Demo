/**
 * historias.js
 * Sub-vista "Historias" del panel Galería: arma una placa de 1080×1920 para
 * Instagram a partir de una obra ya cargada (imagen + título + descripción +
 * precio) o de una foto nueva. El recorte/rotación/brillo/contraste/
 * saturación de la foto los resuelve el editor de imagen compartido
 * (imageEditor.js, el mismo que usa la subida de fotos de producto/obra) —
 * este archivo no los duplica, solo arma la placa con los textos y la
 * exporta con html2canvas (CDN, cargado recién al entrar acá).
 *
 * Depende de variables/funciones ya cargadas por archivos previos:
 *   gallery.js   → currentGallerySuit, lastObras, showGalleryView()
 *   data.js      → getSuit()
 *   api.js       → esc()
 *   shared-ui.js → showToast()
 *   imageEditor.js → openImageEditor()
 */

'use strict';

let hiImageUrl = null;          // object URL de la foto actual en la placa
let hiHtml2CanvasPromise = null;
let hiImgNatural = null;        // {w,h} de la foto actual — para el zoom del formato "En el atril"

let hiShape = 'auto';           // forma del cuadro en el atril: auto | vertical | horizontal | square
let hiFit = 'contain';          // encuadre: contain (imagen entera) | cover (rellena y recorta)

// Tamaño MÁXIMO (px, en el canvas de 1080×1920) del cuadro sobre el atril.
// El alto real se acota además al espacio libre de la placa (ver
// updateAtrilFrame), porque las patas/sombra del caballete ocupan ~300px por
// debajo del cuadro y, si no entran, pisan el título y la línea decorativa.
const ATRIL_MAX = { w: 700, h: 820 };
const ATRIL_BELOW = 310;         // espacio que necesitan patas + sombra bajo el cuadro
const ATRIL_RATIOS = { vertical: 0.75, horizontal: 4 / 3, square: 1 };

// Tamaño MÁXIMO (px) del mat/marco en los formatos "Obra + datos" y "En el
// taller" — tiene que coincidir con el width/height por defecto (sin foto)
// de .hi-art-img / [data-layout="taller"] .hi-art-img en erp.css. El tamaño
// real se calcula en updateArtBoxSize() según la proporción de la foto, para
// que el marco abrace la imagen en vez de dejar franjas de fondo alrededor.
// "Obra completa" no tiene marco (a sangre completa, background-size:cover)
// y "En el atril" usa su propio marco fijo con controles de zoom/posición.
const ART_BOX = {
  galeria: { w: 792, h: 792 },
  taller: { w: 792, h: 990 },
};

// Recalcula el tamaño del mat/marco a partir de la proporción real de la foto
// (hiImgNatural), acotado al máximo del formato actual — así el marco siempre
// queda del mismo tamaño y forma que la imagen, sin recortarla ni dejar
// espacio vacío alrededor.
function updateArtBoxSize() {
  const stage = document.getElementById('hiStage');
  const img = document.getElementById('hiArtImg');
  if (!stage || !img) return;
  const box = ART_BOX[stage.dataset.layout];
  if (!box) return;
  if (!hiImgNatural) {
    img.style.width = '';
    img.style.height = '';
    return;
  }
  const scale = Math.min(box.w / hiImgNatural.w, box.h / hiImgNatural.h);
  img.style.width = Math.round(hiImgNatural.w * scale) + 'px';
  img.style.height = Math.round(hiImgNatural.h * scale) + 'px';
}

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (hiHtml2CanvasPromise) return hiHtml2CanvasPromise;
  hiHtml2CanvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el generador de imágenes'));
    document.head.appendChild(s);
  });
  return hiHtml2CanvasPromise;
}

// Reescala el escenario 1080×1920 para que entre en su caja de previsualización.
function layoutHiStage() {
  const scaler = document.getElementById('hiScaler');
  const stage = document.getElementById('hiStage');
  if (!scaler || !stage) return;
  const w = scaler.clientWidth || 320;
  stage.style.transform = 'scale(' + (w / 1080) + ')';
}

// Dimensiona el cuadro del atril: según la forma elegida (o la proporción de
// la foto) y acotado al espacio libre real de la placa.
function updateAtrilFrame() {
  const stage = document.getElementById('hiStage');
  const frame = document.querySelector('.hi-art-frame');
  const box = stage && stage.querySelector('.hi-stage__art');
  if (!frame || !box || stage.dataset.layout !== 'atril') return;
  const maxW = ATRIL_MAX.w;
  const maxH = Math.max(380, Math.min(ATRIL_MAX.h, box.clientHeight - ATRIL_BELOW));
  let ar = 580 / 680;
  if (hiShape === 'auto') { if (hiImgNatural) ar = hiImgNatural.w / hiImgNatural.h; }
  else ar = ATRIL_RATIOS[hiShape] || 1;
  const w = Math.min(maxW, maxH * ar);
  frame.style.width = Math.round(w) + 'px';
  frame.style.height = Math.round(w / ar) + 'px';
  updateAtrilTransform();
}

// ── Colores de fondo ──
const HI_TONES = [
  { id: 'hueso',     name: 'Hueso',        bg: '#f4f1ec', acc: '#8a6d4b' },
  { id: 'arena',     name: 'Arena',        bg: '#e6ded1', acc: '#8a6d4b' },
  { id: 'bronce',    name: 'Bronce',       bg: '#ece0cd', bg2: '#d9c5a6', acc: '#8a6d4b' },
  { id: 'blanco',    name: 'Blanco',       bg: '#ffffff', acc: '#8a6d4b' },
  { id: 'piedra',    name: 'Piedra',       bg: '#cfcac2', acc: '#5c574f' },
  { id: 'salvia',    name: 'Salvia',       bg: '#d5dccb', acc: '#5f7355' },
  { id: 'rosa',      name: 'Rosa antiguo', bg: '#efd9d3', acc: '#a3564a' },
  { id: 'celeste',   name: 'Celeste',      bg: '#d6e2ea', acc: '#4a6b85' },
  { id: 'mostaza',   name: 'Mostaza',      bg: '#e9c46a', acc: '#7a4e12' },
  { id: 'lavanda',   name: 'Lavanda',      bg: '#dcd6e8', acc: '#6a5a90' },
  { id: 'terracota', name: 'Terracota',    bg: '#b5654a', acc: '#f3dcc0' },
  { id: 'oliva',     name: 'Oliva',        bg: '#4a5240', acc: '#d8cf9f' },
  { id: 'azul',      name: 'Azul noche',   bg: '#16233b', acc: '#d9b779' },
  { id: 'bordo',     name: 'Bordó',        bg: '#4a1f2a', acc: '#e0b48f' },
  { id: 'grafito',   name: 'Grafito',      bg: '#2f3236', acc: '#bfc7cf' },
  { id: 'carbon',    name: 'Carbón',       bg: '#1c1a17', acc: '#c9a978' },
  { id: 'atardecer', name: 'Atardecer',    bg: '#f3d7b6', bg2: '#d98a6c', acc: '#7a3b2a' },
  { id: 'mar',       name: 'Mar',          bg: '#cfe3e2', bg2: '#7fa9ad', acc: '#1f4a52' },
  { id: 'noche',     name: 'Noche',        bg: '#2b2450', bg2: '#0f0d24', acc: '#e3c987' },
  { id: 'custom',    name: 'Personalizado' },
];
let hiCustomText = 'auto';

function hiLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function hiShade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
}

function applyHiTone(t) {
  const stage = document.getElementById('hiStage');
  const bg = t.bg, bg2 = t.bg2 || t.bg;
  const lum = (hiLuminance(bg) + hiLuminance(bg2)) / 2;
  const dark = t.text === 'dark' ? false : t.text === 'light' ? true : lum < 0.28;
  const set = (k, v) => stage.style.setProperty(k, v);
  set('--hi-bg', bg);
  set('--hi-bg2', bg2);
  set('--hi-bg-low', hiShade(bg2, dark ? 0.25 : -0.07)); // pared del atril, un poco más abajo
  set('--hi-accent', t.acc);
  set('--hi-accent-fg', hiLuminance(t.acc) > 0.4 ? '#1c1a17' : '#fff');
  set('--hi-fg', dark ? '#f4f1ec' : '#1c1a17');
  set('--hi-ink-soft', dark ? '#cfc8bc' : '#5c574f');
}

function hiCustomTone() {
  return {
    bg: document.getElementById('hi-c-bg').value,
    bg2: document.getElementById('hi-c-grad').checked ? document.getElementById('hi-c-bg2').value : null,
    acc: document.getElementById('hi-c-acc').value,
    text: hiCustomText,
  };
}

function selectHiTone(id) {
  const stage = document.getElementById('hiStage');
  const t = HI_TONES.find((x) => x.id === id) || HI_TONES[0];
  document.querySelectorAll('#hi-tone-chips .hi-swatch').forEach((b) => b.classList.toggle('is-active', b.dataset.tone === t.id));
  document.getElementById('hi-tone-name').textContent = '· ' + t.name;
  document.getElementById('hi-custom-tone').hidden = t.id !== 'custom';
  stage.dataset.tone = t.id;
  applyHiTone(t.id === 'custom' ? hiCustomTone() : t);
}

function buildHiTones() {
  const box = document.getElementById('hi-tone-chips');
  if (!box) return;
  box.innerHTML = HI_TONES.map((t) => {
    const bg = t.id === 'custom' ? '' : 'background:' + (t.bg2 ? 'linear-gradient(160deg,' + t.bg + ',' + t.bg2 + ')' : t.bg);
    return '<button type="button" class="hi-swatch' + (t.id === 'custom' ? ' hi-swatch--custom' : '') +
      '" data-tone="' + t.id + '" title="' + t.name + '" aria-label="' + t.name + '" style="' + bg + '"></button>';
  }).join('');
  selectHiTone('hueso');
}

async function enterHistorias() {
  showGalleryView('historias');
  populateObraSelect();
  layoutHiStage();

  if (currentGallerySuit) {
    try {
      const suit = await getSuit(currentGallerySuit.id);
      if (!document.getElementById('hi-handle').value) {
        const handle = String((suit && suit.instagram) || '').replace(/^@+/, '').replace(/^https?:\/\/[^/]+\//, '');
        document.getElementById('hi-handle').value = handle ? '@' + handle : '';
        syncTextInputs();
      }
    } catch (e) { /* sin canales cargados: se completa a mano */ }
  }

  loadHtml2Canvas().catch(() => {}); // precarga silenciosa
}

function populateObraSelect() {
  const sel = document.getElementById('hi-obra');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Elegir obra —</option>' +
    (lastObras || []).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  if (current) sel.value = current;
}

function obraCoverUrl(o) {
  const imgs = o.images || [];
  const primary = imgs.find(i => i.isPrimary) || imgs[0];
  return primary ? primary.url : '';
}

// Variante liviana de Cloudinary (misma transformación que usa el sitio público).
function cldUrlHi(url, width) {
  const marker = '/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const at = idx + marker.length;
  return url.slice(0, at) + 'w_' + width + ',c_limit,q_auto,f_auto/' + url.slice(at);
}

// Convierte un Blob/File a data URL (base64). html2canvas exporta de forma
// más confiable con data: URLs que con blob: URLs (estas últimas a veces no
// se resuelven bien dentro del documento clonado que arma html2canvas).
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}

async function applyObraToForm(obraId) {
  const o = (lastObras || []).find(x => x.id === obraId);
  if (!o) return;

  document.getElementById('hi-title').value = o.name || '';
  document.getElementById('hi-meta').value = o.description || '';
  syncTextInputs();

  const url = obraCoverUrl(o);
  if (!url) { setHiImage(null); return; }

  try {
    const res = await fetch(cldUrlHi(url, 1600), { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    setHiImage(await blobToDataURL(blob));
  } catch (e) {
    // Sin CORS o sin conexión: se usa la URL directa (puede fallar la
    // exportación si Cloudinary no habilita CORS en este entorno).
    setHiImage(url);
  }
}

function setHiImage(url) {
  hiImageUrl = url;
  hiImgNatural = null;

  const els = [document.getElementById('hiArtImg'), document.getElementById('hiArtImgAtril')];
  document.getElementById('hi-edit-img-btn').hidden = !url;

  els.forEach((art) => {
    if (!url) {
      art.classList.add('is-empty');
      art.textContent = 'Elegí una obra o subí una foto';
      art.style.backgroundImage = '';
      art.style.backgroundSize = '';
      art.style.backgroundPosition = '';
    } else {
      art.classList.remove('is-empty');
      art.textContent = '';
      art.style.backgroundImage = 'url("' + url + '")';
    }
  });

  if (!url) { updateArtBoxSize(); updateAtrilFrame(); return; }

  // Tamaño real de la foto → base para el marco de "Obra + datos"/"En el
  // taller" (updateArtBoxSize) y para el zoom del formato "En el atril".
  resetAtrilControls();
  const probe = new Image();
  probe.onload = () => {
    hiImgNatural = { w: probe.naturalWidth, h: probe.naturalHeight };
    updateArtBoxSize();
    updateAtrilFrame();
  };
  probe.src = url;
}

function resetAtrilControls() {
  const zoom = document.getElementById('hi-atril-zoom');
  const x = document.getElementById('hi-atril-x');
  const y = document.getElementById('hi-atril-y');
  if (zoom) zoom.value = 100;
  if (x) x.value = 50;
  if (y) y.value = 50;
}

// Recalcula background-size/position de la foto en el atril a partir del
// tamaño real de la imagen + los sliders de tamaño/posición. El recorte y la
// rotación de la foto en sí ya los resolvió imageEditor.js antes de llegar
// acá — esto solo acomoda la foto dentro del hueco fijo del cuadro (580×680):
// con el slider al 100% se ve COMPLETA (fit, sin recortar), y el mat blanco
// del marco rellena el espacio sobrante si la proporción no coincide. Subir
// el slider por encima de 100% permite acercar/recortar a propósito.
function updateAtrilTransform() {
  const art = document.getElementById('hiArtImgAtril');
  if (!art || !hiImageUrl || !hiImgNatural) return;

  const zoomEl = document.getElementById('hi-atril-zoom');
  const xEl = document.getElementById('hi-atril-x');
  const yEl = document.getElementById('hi-atril-y');
  const zoom = (zoomEl ? +zoomEl.value : 100) / 100;
  const posX = xEl ? +xEl.value : 50;
  const posY = yEl ? +yEl.value : 50;

  const fw = art.clientWidth, fh = art.clientHeight;
  if (!fw || !fh) return;
  const pick = hiFit === 'cover' ? Math.max : Math.min;
  const baseScale = pick(fw / hiImgNatural.w, fh / hiImgNatural.h);
  const w = Math.round(hiImgNatural.w * baseScale * zoom);
  const h = Math.round(hiImgNatural.h * baseScale * zoom);

  art.style.backgroundSize = w + 'px ' + h + 'px';
  art.style.backgroundPosition = posX + '% ' + posY + '%';
}

function syncTextInputs() {
  document.getElementById('hiOEyebrow').textContent = document.getElementById('hi-eyebrow').value;
  document.getElementById('hiOTitle').textContent   = document.getElementById('hi-title').value;
  document.getElementById('hiOMeta').textContent    = document.getElementById('hi-meta').value;
  document.getElementById('hiOCaption').textContent = document.getElementById('hi-caption').value;
  document.getElementById('hiOCta').textContent     = document.getElementById('hi-cta').value;
  document.getElementById('hiOHandle').textContent  = document.getElementById('hi-handle').value;
  updateAtrilFrame();   // el alto de los textos cambia el espacio libre del atril
}

function applyLayoutPreset(layout) {
  const stage = document.getElementById('hiStage');
  const ruleOn = document.getElementById('hi-rule').checked ? '1' : '0';
  if (layout === 'completa') {
    stage.dataset.showCaption = '0'; stage.dataset.showCta = '0';
    stage.dataset.showRule = '0';    stage.dataset.showMeta = '1';
  } else if (layout === 'taller') {
    stage.dataset.showCaption = '1'; stage.dataset.showCta = '0';
    stage.dataset.showMeta = '0';    stage.dataset.showRule = ruleOn;
  } else {
    stage.dataset.showCaption = '0'; stage.dataset.showCta = '1';
    stage.dataset.showMeta = '1';    stage.dataset.showRule = ruleOn;
  }
}

async function downloadHistoria() {
  const btn = document.getElementById('hi-download');
  const stage = document.getElementById('hiStage');
  const scaler = document.getElementById('hiScaler');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando…';

  const prevTransform = stage.style.transform;
  const prevW = scaler.style.width, prevH = scaler.style.height, prevOverflow = scaler.style.overflow;
  const hadSafe = stage.classList.contains('hi-show-safe');

  stage.style.transform = 'none';
  scaler.style.width = '1080px';
  scaler.style.height = '1920px';
  scaler.style.overflow = 'visible';
  stage.classList.remove('hi-show-safe');

  const restore = () => {
    stage.style.transform = prevTransform;
    scaler.style.width = prevW; scaler.style.height = prevH; scaler.style.overflow = prevOverflow;
    if (hadSafe) stage.classList.add('hi-show-safe');
    btn.disabled = false;
    btn.textContent = label;
  };

  try {
    await loadHtml2Canvas();
    const canvas = await html2canvas(stage, {
      width: 1080, height: 1920, scale: 1, backgroundColor: null, useCORS: true, logging: false,
    });
    const slug = (document.getElementById('hi-title').value || 'obra')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const a = document.createElement('a');
    a.download = 'historia-' + (slug || 'obra') + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (err) {
    showToast(err.message || 'No se pudo generar la imagen', 'err');
  } finally {
    restore();
  }
}

function initHistoriasEvents() {
  const stage = document.getElementById('hiStage');
  if (!stage) return;

  // #ga-enter-historias ya no se ata acá: vive dentro de un v-if de
  // galleryVue.js, se destruye/recrea al salir y volver a 'home', así que
  // el propio template de esa app lo llama por @click="enterHistorias".
  document.getElementById('ga-historias-back')?.addEventListener('click', () => showGalleryView('home'));
  window.addEventListener('resize', layoutHiStage);

  ['hi-eyebrow', 'hi-title', 'hi-meta', 'hi-caption', 'hi-cta', 'hi-handle'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', syncTextInputs);
  });

  document.getElementById('hi-obra')?.addEventListener('change', (e) => {
    if (e.target.value) applyObraToForm(e.target.value);
  });

  document.getElementById('hi-layout-chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('.hi-chip[data-layout]');
    if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-active', c === b));
    stage.dataset.layout = b.dataset.layout;
    applyLayoutPreset(b.dataset.layout);
    document.getElementById('hi-atril-controls').hidden = b.dataset.layout !== 'atril';
    document.getElementById('hi-fit-controls').hidden = !['atril', 'completa'].includes(b.dataset.layout);
    updateArtBoxSize();
    if (b.dataset.layout === 'atril') updateAtrilFrame();
  });

  document.getElementById('hi-fit-chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('.hi-chip[data-fit]');
    if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-active', c === b));
    hiFit = b.dataset.fit;
    stage.dataset.fit = hiFit;
    updateAtrilTransform();
  });

  document.getElementById('hi-shape-chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('.hi-chip[data-shape]');
    if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-active', c === b));
    hiShape = b.dataset.shape;
    updateAtrilFrame();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(updateAtrilFrame).observe(stage.querySelector('.hi-stage__art'));
  }

  ['hi-atril-zoom', 'hi-atril-x', 'hi-atril-y'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateAtrilTransform);
  });

  buildHiTones();
  document.getElementById('hi-tone-chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('.hi-swatch');
    if (b) selectHiTone(b.dataset.tone);
  });
  ['hi-c-bg', 'hi-c-bg2', 'hi-c-acc', 'hi-c-grad'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => selectHiTone('custom'));
  });
  document.getElementById('hi-c-text')?.addEventListener('click', (e) => {
    const b = e.target.closest('.hi-chip[data-ctext]');
    if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-active', c === b));
    hiCustomText = b.dataset.ctext;
    selectHiTone('custom');
  });

  document.getElementById('hi-badge')?.addEventListener('change', (e) => {
    stage.dataset.showBadge = e.target.checked ? '1' : '0';
  });
  document.getElementById('hi-rule')?.addEventListener('change', (e) => {
    stage.dataset.showRule = e.target.checked ? '1' : '0';
  });
  document.getElementById('hi-safe')?.addEventListener('change', (e) => {
    stage.classList.toggle('hi-show-safe', e.target.checked);
  });

  document.getElementById('hi-upload-btn')?.addEventListener('click', () => document.getElementById('hi-file').click());
  document.getElementById('hi-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const edited = await openImageEditor(file);
    if (!edited) return;
    document.getElementById('hi-obra').value = '';
    setHiImage(await blobToDataURL(edited));
  });

  document.getElementById('hi-edit-img-btn')?.addEventListener('click', async () => {
    if (!hiImageUrl) return;
    try {
      const res = await fetch(hiImageUrl);
      const blob = await res.blob();
      const file = new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' });
      const edited = await openImageEditor(file);
      if (edited) setHiImage(await blobToDataURL(edited));
    } catch (err) {
      showToast('No se pudo reabrir esta imagen para editarla', 'err');
    }
  });

  document.getElementById('hi-download')?.addEventListener('click', downloadHistoria);
}
