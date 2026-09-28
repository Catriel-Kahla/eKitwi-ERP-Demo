/**
 * dashboardHome.js
 * Widgets del panel "Dashboard" (antes "Resumen"): una tarjeta por sección
 * habilitada del suit activo, con un resumen breve. Entry point:
 * renderDashboardHome(suit), llamado desde enterSuit() en shared-ui.js.
 *
 * Todo el dato se calcula del lado del cliente reusando las mismas funciones
 * de data.js que usan los paneles (listOrders / listProducts / getBalances /
 * listAsientos) y los helpers de gráficos SVG de bi.js (renderBarChart) — no
 * hay endpoint propio de dashboard. Funciona igual en EKITWI_DEV_MODE.
 *
 * Se carga después de bi.js y antes de dashboard.js en dashboard.html.
 */

'use strict';

// ── Helpers de presentación ─────────────────────────────────────────────

function dhCard(w) {
  return `
    <div class="dashboard-card${w.wide ? ' dashboard-card--wide' : ''}" data-dw="${w.key}">
      <div class="dashboard-card-title">${esc(w.title)}</div>
      <div class="dashboard-card-body"><p class="crm-muted">Cargando…</p></div>
    </div>`;
}

// Sparkline min–max (soporta valores negativos, a diferencia del renderLineChart
// de bi.js que arranca el eje en 0).
function dhSparkline(values) {
  const W = 260, H = 54, pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = (max - min) || 1;
  const stepX = (W - pad * 2) / (values.length - 1 || 1);
  const pts = values.map((v, i) => [
    pad + stepX * i,
    pad + (H - pad * 2) * (1 - (v - min) / span),
  ]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  const color = values[values.length - 1] >= values[0] ? '#16a34a' : '#dc2626';
  return `<svg class="dw-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${color}"/>
  </svg>`;
}

function dhLastNDays(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}
function dhLast7Days() { return dhLastNDays(7); }

// ── Entry point ─────────────────────────────────────────────────────────

async function renderDashboardHome(suit) {
  const nameEl = document.getElementById('dashboard-suit-name');
  if (nameEl) nameEl.textContent = suit.name;

  const grid = document.getElementById('dashboard-widgets');
  if (!grid) return;

  const sys = new Set(suit.systems || []);
  const hasCommerce = sys.has('commerce') || sys.has('ecommerce');
  const hasInventory = sys.has('inventory');
  const hasAccounting = sys.has('contable');
  const hasBi = sys.has('bi');

  const widgets = [];
  if (hasCommerce)            widgets.push({ key: 'orders',     title: 'Pedidos pendientes',               load: dwPendingOrders });
  if (hasInventory)           widgets.push({ key: 'stock',      title: 'Stock bajo',                       load: dwLowStock });
  if (hasAccounting)          widgets.push({ key: 'accounting', title: 'Contabilidad',                     load: dwAccounting });
  if (hasBi && hasCommerce)   widgets.push({ key: 'bi-orders',  title: 'Pedidos — últimos 7 días',  wide: true, load: dwBiOrders7d });
  if (hasBi && hasAccounting) widgets.push({ key: 'bi-pn',      title: 'Patrimonio Neto — últimos 30 días', wide: true, load: dwBiPatrimonio30d });

  if (!widgets.length) {
    grid.innerHTML = '<p class="crm-muted">Este suit todavía no tiene módulos que muestren un resumen. Activá Commerce, Inventory, Accounting o BI desde eKitwi Identity.</p>';
    return;
  }

  grid.innerHTML = widgets.map(dhCard).join('');

  // Si se cambia de suit mientras cargan, descartamos los renders viejos.
  const runId = (renderDashboardHome._runId = (renderDashboardHome._runId || 0) + 1);

  widgets.forEach(async (w) => {
    const body = grid.querySelector(`[data-dw="${w.key}"] .dashboard-card-body`);
    if (!body) return;
    try {
      const out = await w.load(suit);
      if (renderDashboardHome._runId !== runId) return;
      if (typeof out === 'function') out(body); // el widget dibuja sobre el nodo
      else body.innerHTML = out;
    } catch (err) {
      if (renderDashboardHome._runId !== runId) return;
      body.innerHTML = `<p class="crm-muted">No se pudo cargar (${esc(err.message || 'error')}).</p>`;
    }
  });
}

// ── Widgets ─────────────────────────────────────────────────────────────

// Pedidos/Ventas → últimos 3 pedidos pendientes (type 'pedido').
async function dwPendingOrders(suit) {
  const orders = await listOrders(suit.id, null, 50);
  const pend = orders.filter(o => o.type === 'pedido').slice(0, 3);
  if (!pend.length) return '<p class="dw-ok">Sin pedidos pendientes ✓</p>';

  return `<ul class="dw-list">${pend.map(o => {
    const items = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
    const total = items.reduce((n, i) => n + Number(i.subtotal || 0), 0);
    const units = items.reduce((n, i) => n + (i.quantity ?? 1), 0);
    const who = (o.user && o.user.email) || o.guestName || 'Invitado';
    return `<li>
      <div class="dw-list-main">
        <span class="dw-list-title">${esc(who)}</span>
        <span class="dw-list-meta">${esc(new Date(o.date).toLocaleDateString('es-AR'))} · ${units} art.</span>
      </div>
      <span class="dw-list-amount">${fmtMoney(total)}</span>
    </li>`;
  }).join('')}</ul>`;
}

// Inventory → cantidad de productos en o por debajo del stock mínimo.
async function dwLowStock(suit) {
  const res = await listProducts(suit.id, { minStockAlert: true, take: 1 });
  const n = (res.pagination && res.pagination.total) || 0;
  if (!n) return '<p class="dw-ok">Todo el stock por encima del mínimo ✓</p>';
  return `<div class="dw-stat">
    <span class="dw-stat-num dw-warn">${n}</span>
    <span class="dw-stat-label">producto${n === 1 ? '' : 's'} en o por debajo del stock mínimo</span>
  </div>`;
}

// Accounting → Caja y Patrimonio Neto en el mismo bloque. Si son iguales
// (negocio recién arrancado, sin pasivos), muestra solo Caja.
async function dwAccounting(suit) {
  const b = await getBalances(suit.id);
  const caja = Number(b.caja);
  const pn = Number(b.patrimonioNeto);

  const rows = [`<div class="dw-kv"><span>Caja</span><strong>${fmtMoney(caja)}</strong></div>`];
  if (Math.abs(caja - pn) >= 0.005) {
    rows.push(`<div class="dw-kv"><span>Patrimonio Neto</span><strong>${fmtMoney(pn)}</strong></div>`);
  }
  return `<div class="dw-kv-list">${rows.join('')}</div>`;
}

// BI + Commerce → cantidad de pedidos (venta + pedido) por día, últimos 7.
async function dwBiOrders7d(suit) {
  const orders = await listOrders(suit.id, null, 300);
  const days = dhLast7Days();
  const byDay = new Map(days.map(d => [d, 0]));
  let total = 0;

  orders.forEach(o => {
    if (o.type !== 'venta' && o.type !== 'pedido') return;
    const key = String(o.date).slice(0, 10);
    if (byDay.has(key)) { byDay.set(key, byDay.get(key) + 1); total++; }
  });

  const items = days.map(d => ({
    label: new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
    value: byDay.get(d),
  }));

  return (body) => {
    body.innerHTML = `<div class="dw-kpi">${total} pedido${total === 1 ? '' : 's'} en 7 días</div><div class="dw-chart"></div>`;
    renderBarChart(body.querySelector('.dw-chart'), items);
  };
}

// BI + Accounting → Patrimonio Neto (Activo − Pasivo) por día, últimos 30,
// reconstruido de los asientos confirmados. Delta contra hace 30 días + sparkline.
async function dwBiPatrimonio30d(suit) {
  const { data: asientos } = await listAsientos(suit.id, { estado: 'confirmado', take: 1000 });
  const days = dhLastNDays(30);

  const pnAt = (dayStr) => {
    let activo = 0, pasivo = 0;
    for (const a of asientos) {
      if (String(a.fecha).slice(0, 10) > dayStr) continue;
      for (const d of (a.detalles || [])) {
        const c = d.cuenta || {};
        const saldo = c.naturaleza === 'DEUDORA'
          ? Number(d.debe) - Number(d.haber)
          : Number(d.haber) - Number(d.debe);
        if (c.tipo === 'ACTIVO') activo += saldo;
        else if (c.tipo === 'PASIVO') pasivo += saldo;
      }
    }
    return activo - pasivo;
  };

  const serie = days.map(pnAt);
  const pnHoy = serie[serie.length - 1];
  const pnAntes = serie[0];
  const delta = pnHoy - pnAntes;
  const dir = delta > 0.005 ? 'up' : (delta < -0.005 ? 'down' : 'flat');
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  const pct = pnAntes !== 0 ? (Math.abs(delta) / Math.abs(pnAntes)) * 100 : null;

  return `
    <div class="dw-stat">
      <span class="dw-stat-num">${fmtMoney(pnHoy)}</span>
      <span class="dw-stat-label">Patrimonio Neto hoy</span>
    </div>
    ${dhSparkline(serie)}
    <div class="dw-delta dw-delta-${dir}">
      ${arrow} ${fmtMoney(Math.abs(delta))}${pct != null ? ` (${delta >= 0 ? '+' : '−'}${pct.toFixed(1)}%)` : ''}
      <span class="dw-delta-sub">vs. ${fmtMoney(pnAntes)} hace 30 días</span>
    </div>`;
}
