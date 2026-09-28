/**
 * bi.js
 * BI panel: a "resumen general" mixing one stat row + one SVG chart per
 * system the suit has enabled (commerce/ecommerce → sales, booking, scrum,
 * contable) — no drill-down, no filters yet (v1). Entry point is loadBiPanel(suitId,
 * suitName, systems), called from dashboard.js when a suit's "BI" sidebar
 * button is clicked; `systems` comes straight off that button's
 * data-suit-systems attribute (shared-ui.js), so this never has to re-fetch
 * GET /suits/:id/systems itself.
 *
 * Every number here is computed client-side from data other panels already
 * fetch (listOrders/listBookings/listProjects+listStories/listAsientos/
 * getBalances) — no BI-specific backend endpoint exists. Charts are
 * hand-rolled SVG (no charting library, matching the rest of this
 * dependency-free dashboard) built with the eKitwi ERP `dataviz` skill's
 * validated categorical palette (light-mode only — this app has no dark
 * theme) — see APIconnection.md.
 */

'use strict';

const BI_PALETTE = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  gridline: '#e1e0d9',
  baseline: '#c3c2b7'
};

const BI_BOOKING_STATUS_LABEL = {
  pending: 'Pendientes', confirmed: 'Confirmadas', completed: 'Completadas',
  cancelled: 'Canceladas', no_show: 'No-show'
};

// ── SVG chart primitives (shared by every card) ─────────────────────────

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// Rounds only the top corners of a vertical bar (column) — spec calls for
// "4px rounded data-end, square at the baseline", which a plain <rect rx>
// can't express since it rounds all four corners uniformly.
function roundedTopRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

function biTooltipEl(wrap) {
  let tip = wrap.querySelector('.bi-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'bi-tooltip';
    wrap.appendChild(tip);
  }
  return tip;
}

function showBiTooltip(wrap, x, y, text) {
  const tip = biTooltipEl(wrap);
  tip.textContent = text; // labels are untrusted data — never innerHTML
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.classList.add('visible');
}

function hideBiTooltip(wrap) {
  wrap.querySelector('.bi-tooltip')?.classList.remove('visible');
}

// items: [{ label, value, color? }] — a single-series categorical count, so
// no legend box (the x-axis labels already carry identity).
function renderBarChart(container, items) {
  container.innerHTML = '';
  if (!items.length || items.every(i => i.value === 0)) {
    container.innerHTML = '<p class="bi-empty-card">Sin datos todavía.</p>';
    return;
  }

  const W = 640, H = 220;
  const marginTop = 28, marginBottom = 34, marginLeft = 12, marginRight = 12;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const maxVal = niceMax(Math.max(...items.map(i => i.value)));
  const gridSteps = 4;

  const wrap = document.createElement('div');
  wrap.className = 'bi-chart-wrap';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });

  for (let s = 0; s <= gridSteps; s++) {
    const val = (maxVal / gridSteps) * s;
    const y = marginTop + plotH - (val / maxVal) * plotH;
    svg.appendChild(svgEl('line', { x1: marginLeft, x2: W - marginRight, y1: y, y2: y, stroke: BI_PALETTE.gridline, 'stroke-width': 1 }));
  }
  svg.appendChild(svgEl('line', { x1: marginLeft, x2: W - marginRight, y1: marginTop + plotH, y2: marginTop + plotH, stroke: BI_PALETTE.baseline, 'stroke-width': 1 }));

  const bandW = plotW / items.length;
  const barW = Math.min(24, bandW * 0.5);

  items.forEach((item, i) => {
    const cx = marginLeft + bandW * i + bandW / 2;
    const barH = maxVal > 0 ? Math.max((item.value / maxVal) * plotH, item.value > 0 ? 2 : 0) : 0;
    const y = marginTop + plotH - barH;
    const color = item.color || BI_PALETTE.series[i % BI_PALETTE.series.length];

    const bar = svgEl('path', { d: roundedTopRectPath(cx - barW / 2, y, barW, barH, 4), fill: color });

    const valueLabel = svgEl('text', { x: cx, y: y - 8, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: BI_PALETTE.ink });
    valueLabel.textContent = item.value.toLocaleString('es-AR');

    const catLabel = svgEl('text', { x: cx, y: H - marginBottom + 18, 'text-anchor': 'middle', 'font-size': 11, fill: BI_PALETTE.inkSecondary });
    catLabel.textContent = item.label;

    // Hit target spans the whole band (bigger than the bar itself), per
    // interaction.md's "hit target is bigger than the mark".
    const hit = svgEl('rect', { x: marginLeft + bandW * i, y: marginTop, width: bandW, height: plotH, fill: 'transparent', class: 'bi-mark', tabindex: '0' });
    const onEnter = () => { bar.setAttribute('opacity', '0.82'); showBiTooltip(wrap, cx, y - 4, `${item.value.toLocaleString('es-AR')} — ${item.label}`); };
    const onLeave = () => { bar.setAttribute('opacity', '1'); hideBiTooltip(wrap); };
    hit.addEventListener('pointermove', onEnter);
    hit.addEventListener('pointerleave', onLeave);
    hit.addEventListener('focus', onEnter);
    hit.addEventListener('blur', onLeave);

    svg.appendChild(bar);
    svg.appendChild(valueLabel);
    svg.appendChild(catLabel);
    svg.appendChild(hit);
  });

  wrap.appendChild(svg);
  container.appendChild(wrap);
}

// points: [{ y, label }] in x order — a single series, so only the endpoint
// is direct-labeled; the rest live in the hover tooltip (label selectively).
function renderLineChart(container, points, opts = {}) {
  container.innerHTML = '';
  if (!points.length) {
    container.innerHTML = '<p class="bi-empty-card">Sin datos todavía.</p>';
    return;
  }

  const W = 640, H = 220;
  const marginTop = 28, marginBottom = 34, marginLeft = 44, marginRight = 16;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  // Dominio [minVal, maxVal] en vez de asumir siempre 0..max — series como
  // Patrimonio Neto pueden ser negativas (a diferencia de ingresos/conteos,
  // el único caso que este chart manejaba hasta ahora). Con series ≥ 0
  // minVal da 0 y esto se comporta exactamente igual que antes.
  const rawMax = Math.max(0, ...points.map(p => p.y));
  const rawMin = Math.min(0, ...points.map(p => p.y));
  const maxVal = rawMax > 0 ? niceMax(rawMax) : (rawMin < 0 ? 0 : 1);
  const minVal = rawMin < 0 ? -niceMax(-rawMin) : 0;
  const range = (maxVal - minVal) || 1;
  const gridSteps = 4;
  const color = opts.color || BI_PALETTE.series[0];
  const prefix = opts.valuePrefix || '';
  const fmtVal = (v) => `${v < 0 ? '-' : ''}${prefix}${Math.round(Math.abs(v)).toLocaleString('es-AR')}`;
  const yScale = (v) => marginTop + plotH - ((v - minVal) / range) * plotH;

  const wrap = document.createElement('div');
  wrap.className = 'bi-chart-wrap';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });

  for (let s = 0; s <= gridSteps; s++) {
    const val = minVal + (range / gridSteps) * s;
    const y = yScale(val);
    svg.appendChild(svgEl('line', { x1: marginLeft, x2: W - marginRight, y1: y, y2: y, stroke: BI_PALETTE.gridline, 'stroke-width': 1 }));
    const tick = svgEl('text', { x: marginLeft - 6, y: y + 3, 'text-anchor': 'end', 'font-size': 10, fill: BI_PALETTE.inkMuted });
    tick.textContent = fmtVal(val);
    svg.appendChild(tick);
  }
  // Eje cero — coincide con el borde inferior cuando minVal es 0 (mismo
  // lugar que antes), o marca la línea de cero en medio del gráfico cuando
  // la serie cruza a negativo.
  svg.appendChild(svgEl('line', { x1: marginLeft, x2: W - marginRight, y1: yScale(0), y2: yScale(0), stroke: BI_PALETTE.baseline, 'stroke-width': 1 }));

  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    ...p,
    x: marginLeft + stepX * i,
    y2: yScale(p.y)
  }));

  const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y2}`).join(' ');
  svg.appendChild(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

  const last = coords[coords.length - 1];
  svg.appendChild(svgEl('circle', { cx: last.x, cy: last.y2, r: 5, fill: color, stroke: '#ffffff', 'stroke-width': 2 }));
  const endLabel = svgEl('text', { x: last.x, y: last.y2 - 12, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700, fill: BI_PALETTE.ink });
  endLabel.textContent = fmtVal(last.y);
  svg.appendChild(endLabel);

  const labelEvery = Math.max(1, Math.ceil(coords.length / 6));
  coords.forEach((c, i) => {
    if (i % labelEvery !== 0 && i !== coords.length - 1) return;
    const t = svgEl('text', { x: c.x, y: H - marginBottom + 18, 'text-anchor': 'middle', 'font-size': 10, fill: BI_PALETTE.inkSecondary });
    t.textContent = c.label;
    svg.appendChild(t);
  });

  // Crosshair + hover dot, hidden until pointermove — snaps to nearest x.
  const crosshair = svgEl('line', { x1: 0, x2: 0, y1: marginTop, y2: marginTop + plotH, stroke: BI_PALETTE.inkMuted, 'stroke-width': 1, opacity: '0' });
  const hoverDot = svgEl('circle', { r: 5, fill: color, stroke: '#ffffff', 'stroke-width': 2, opacity: '0' });
  svg.appendChild(crosshair);
  svg.appendChild(hoverDot);

  const hit = svgEl('rect', { x: marginLeft, y: marginTop, width: plotW, height: plotH, fill: 'transparent', class: 'bi-mark', tabindex: '0' });
  const trackPointer = (clientX, clientY) => {
    const svgRect = svg.getBoundingClientRect();
    const scaleX = W / svgRect.width;
    const mouseX = (clientX - svgRect.left) * scaleX;
    const idx = Math.max(0, Math.min(coords.length - 1, Math.round((mouseX - marginLeft) / (stepX || 1))));
    const c = coords[idx];
    crosshair.setAttribute('x1', c.x); crosshair.setAttribute('x2', c.x); crosshair.setAttribute('opacity', '1');
    hoverDot.setAttribute('cx', c.x); hoverDot.setAttribute('cy', c.y2); hoverDot.setAttribute('opacity', '1');
    const scale = svgRect.width / W;
    showBiTooltip(wrap, c.x * scale, c.y2 * scale - 4, `${fmtVal(c.y)} — ${c.label}`);
  };
  hit.addEventListener('pointermove', (e) => trackPointer(e.clientX, e.clientY));
  hit.addEventListener('pointerleave', () => { crosshair.setAttribute('opacity', '0'); hoverDot.setAttribute('opacity', '0'); hideBiTooltip(wrap); });
  svg.appendChild(hit);

  wrap.appendChild(svg);
  container.appendChild(wrap);
}

// ── Per-module cards ─────────────────────────────────────────────────────
// Superseded by biPanelVue.js (loaded after this file in dashboard.html —
// its loadBiPanel() declaration wins). Left here as reference/rollback,
// same as dashboardHome.js next to dashboardHomeVue.js.

async function loadEcommerceChart(suitId) {
  const kpiEl = document.getElementById('bi-ecommerce-kpi');
  const chartEl = document.getElementById('bi-ecommerce-chart');
  kpiEl.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    const orders = await listOrders(suitId, 'venta', 200);
    const days = 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay = new Map();
    for (let i = days - 1; i >= 0; i--) {
      byDay.set(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10), 0);
    }

    let total = 0, count = 0;
    orders.forEach(o => {
      const key = o.date.slice(0, 10);
      const amount = (o.sale?.items || o.items || []).reduce((n, i) => n + Number(i.subtotal), 0);
      total += amount;
      if (byDay.has(key)) { byDay.set(key, byDay.get(key) + amount); count++; }
    });

    const points = [...byDay.entries()].map(([key, y]) => ({
      y,
      label: new Date(`${key}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
    }));

    kpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Ingresos (30 días)</div><div class="kpi-value">${fmtMoney(total)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Ventas (30 días)</div><div class="kpi-value">${count}</div></div>
    `;
    renderLineChart(chartEl, points, { valuePrefix: '$' });
  } catch (err) {
    kpiEl.innerHTML = '';
    chartEl.innerHTML = `<p class="bi-empty-card">No se pudieron cargar las ventas (${esc(err.message)}).</p>`;
  }
}

async function loadBookingChart(suitId) {
  const kpiEl = document.getElementById('bi-booking-kpi');
  const chartEl = document.getElementById('bi-booking-chart');
  kpiEl.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    const res = await listBookings(suitId, { take: 100 });
    const statusOrder = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
    const counts = Object.fromEntries(statusOrder.map(s => [s, 0]));
    res.data.forEach(b => { if (counts[b.status] !== undefined) counts[b.status]++; });

    kpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Reservas totales</div><div class="kpi-value">${res.pagination.total}</div></div>
      <div class="kpi-card"><div class="kpi-label">Pendientes</div><div class="kpi-value">${counts.pending}</div></div>
    `;
    renderBarChart(chartEl, statusOrder.map((s, i) => ({
      label: BI_BOOKING_STATUS_LABEL[s] || s, value: counts[s], color: BI_PALETTE.series[i % BI_PALETTE.series.length]
    })));
  } catch (err) {
    kpiEl.innerHTML = '';
    chartEl.innerHTML = `<p class="bi-empty-card">No se pudieron cargar las reservas (${esc(err.message)}).</p>`;
  }
}

async function loadScrumChart() {
  const kpiEl = document.getElementById('bi-scrum-kpi');
  const chartEl = document.getElementById('bi-scrum-chart');
  kpiEl.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    const projects = await listProjects();
    const storiesByProject = await Promise.all(projects.map(p => listStories(p.id)));
    const allStories = storiesByProject.flat();
    const statusOrder = ['backlog', 'in-sprint', 'done'];
    const counts = Object.fromEntries(statusOrder.map(s => [s, 0]));
    allStories.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

    kpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Proyectos</div><div class="kpi-value">${projects.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Historias totales</div><div class="kpi-value">${allStories.length}</div></div>
    `;
    renderBarChart(chartEl, statusOrder.map((s, i) => ({
      label: (STORY_STATUS[s] || {}).label || s, value: counts[s], color: BI_PALETTE.series[i % BI_PALETTE.series.length]
    })));
  } catch (err) {
    kpiEl.innerHTML = '';
    chartEl.innerHTML = `<p class="bi-empty-card">No se pudieron cargar los proyectos (${esc(err.message)}).</p>`;
  }
}

async function loadAccountingChart(suitId) {
  const kpiEl = document.getElementById('bi-contable-kpi');
  const chartEl = document.getElementById('bi-contable-chart');
  kpiEl.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    const [ejercicios, balances] = await Promise.all([listEjercicios(suitId), getBalances(suitId)]);
    const abierto = ejercicios.find(e => e.estado === 'abierto');

    let asientos = [];
    if (abierto) asientos = (await listAsientos(suitId, { ejercicioId: abierto.id, take: 100 })).data;

    const statusOrder = ['borrador', 'confirmado', 'anulado'];
    const counts = Object.fromEntries(statusOrder.map(s => [s, 0]));
    asientos.forEach(a => { if (counts[a.estado] !== undefined) counts[a.estado]++; });

    kpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Caja (asientos confirmados)</div><div class="kpi-value">${fmtMoney(balances.caja)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Patrimonio Neto (Activo − Pasivo)</div><div class="kpi-value">${fmtMoney(balances.patrimonioNeto)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Ejercicio</div><div class="kpi-value">${abierto ? esc(abierto.nombre) : 'Ninguno abierto'}</div></div>
    `;
    renderBarChart(chartEl, statusOrder.map((s, i) => ({
      label: ASIENTO_ESTADO_LABEL[s] || s, value: counts[s], color: BI_PALETTE.series[i % BI_PALETTE.series.length]
    })));
  } catch (err) {
    kpiEl.innerHTML = '';
    chartEl.innerHTML = `<p class="bi-empty-card">No se pudo cargar la contabilidad (${esc(err.message)}).</p>`;
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

async function loadBiPanel(suitId, suitName, systems) {
  document.getElementById('bi-suit-label').textContent = `BI de ${suitName}`;

  // enabled: predicado sobre `systems`, no un solo type — las ventas
  // (listOrders 'venta') las genera tanto Commerce (POS) como eCommerce
  // (tienda pública), así que esa card se muestra con cualquiera de los dos.
  const cards = [
    { enabled: systems.includes('commerce') || systems.includes('ecommerce'), card: 'bi-card-ecommerce', load: () => loadEcommerceChart(suitId) },
    { enabled: systems.includes('booking'),                                   card: 'bi-card-booking',   load: () => loadBookingChart(suitId) },
    { enabled: systems.includes('scrum'),                                     card: 'bi-card-scrum',     load: () => loadScrumChart() },
    { enabled: systems.includes('contable'),                                  card: 'bi-card-contable',  load: () => loadAccountingChart(suitId) }
  ];

  let anyVisible = false;
  for (const { enabled, card, load } of cards) {
    const el = document.getElementById(card);
    el.hidden = !enabled;
    if (enabled) { anyVisible = true; load(); }
  }
  document.getElementById('bi-empty-msg').hidden = anyVisible;
}
