/**
 * dashboardHomeVue.js
 * Piloto Vue 3 (CDN, sin build) del panel "Dashboard" (home). Mismo rol que
 * dashboardHome.js (que queda en el repo sin cargarse — script tag removido
 * de dashboard.html — como referencia y para volver atrás sin tocar git):
 * expone renderDashboardHome(suit), llamado desde enterSuit() en
 * shared-ui.js, así el resto de la app no se entera del cambio.
 *
 * v2: en vez de "una tarjeta por sistema habilitado" (como dashboardHome.js),
 * separa la info en tres niveles, como un dashboard de ERP de verdad:
 *   1. KPIs — números grandes, a simple vista (Caja, Ingresos hoy, etc.)
 *   2. Tendencias — los mismos gráficos SVG de bi.js (renderBarChart /
 *      renderLineChart), que ya traen hover con tooltip + crosshair, así el
 *      home queda visualmente consistente con el panel BI real.
 *   3. Detalle — listas accionables (pedidos pendientes, stock bajo).
 * Los gráficos de tendencia siguen requiriendo el módulo BI habilitado
 * (mismo criterio que ya usaba dashboardHome.js: hasBi && hasX); los KPIs y
 * el detalle son datos operativos básicos y no lo requieren.
 *
 * Se carga después de bi.js (de ahí toma renderBarChart/renderLineChart) y
 * antes de dashboard.js en dashboard.html.
 */

'use strict';

// ── Datos por fuente (mismo cálculo que dashboardHome.js; acá devuelven
// datos en vez de HTML armado a mano — la presentación vive en los
// componentes de más abajo) ───────────────────────────────────────────────

function dhLastNDays(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}

function dhDayLabel(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function dhDelta(delta, pct) {
  return {
    dir: delta > 0.005 ? 'up' : (delta < -0.005 ? 'down' : 'flat'),
    arrow: delta > 0.005 ? '▲' : (delta < -0.005 ? '▼' : '■'),
    pct,
  };
}

async function dwPendingOrders(suit) {
  const orders = await listOrders(suit.id, null, 50);
  return orders.filter(o => o.type === 'pedido').slice(0, 3).map(o => {
    const items = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
    return {
      who: (o.user && o.user.email) || o.guestName || 'Invitado',
      date: new Date(o.date).toLocaleDateString('es-AR'),
      units: items.reduce((n, i) => n + (i.quantity ?? 1), 0),
      total: items.reduce((n, i) => n + Number(i.subtotal || 0), 0),
    };
  });
}

// Antes solo devolvía el total (para el número de KPI) — ahora también trae
// hasta 5 productos para la lista de detalle, en la misma llamada.
async function dwLowStock(suit) {
  const res = await listProducts(suit.id, { minStockAlert: true, take: 5 });
  return {
    count: (res.pagination && res.pagination.total) || 0,
    items: (res.data || []).map(p => ({ name: p.name, stock: p.stock, minStock: p.minStock })),
  };
}

async function dwAccounting(suit) {
  const b = await getBalances(suit.id);
  const caja = Number(b.caja);
  const pn = Number(b.patrimonioNeto);
  return { caja, pn, showPn: Math.abs(caja - pn) >= 0.005 };
}

// Combina pedidos (conteo) e ingresos ($) de los últimos 7 días en una sola
// pasada sobre listOrders — antes eran cálculos separados; acá se recorren
// las mismas órdenes una vez y se arman ambas series, en el formato que ya
// esperan renderBarChart ({label,value}) y renderLineChart ({label,y}).
async function dwBi7d(suit) {
  const orders = await listOrders(suit.id, null, 300);
  const days = dhLastNDays(7);
  const byDayCount = new Map(days.map(d => [d, 0]));
  const byDayRevenue = new Map(days.map(d => [d, 0]));
  let totalCount = 0, totalRevenue = 0;

  orders.forEach(o => {
    if (o.type !== 'venta' && o.type !== 'pedido') return;
    const key = String(o.date).slice(0, 10);
    if (!byDayCount.has(key)) return;
    const items = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
    const amount = items.reduce((n, i) => n + Number(i.subtotal || 0), 0);
    byDayCount.set(key, byDayCount.get(key) + 1);
    byDayRevenue.set(key, byDayRevenue.get(key) + amount);
    totalCount++;
    totalRevenue += amount;
  });

  const orderItems = days.map(d => ({ label: dhDayLabel(d), value: byDayCount.get(d) }));
  const revenueItems = days.map(d => ({ label: dhDayLabel(d), y: byDayRevenue.get(d) }));
  const today = revenueItems[revenueItems.length - 1].y;
  const yesterday = revenueItems[revenueItems.length - 2]?.y ?? 0;
  const delta = today - yesterday;
  const pct = yesterday !== 0 ? (Math.abs(delta) / Math.abs(yesterday)) * 100 : null;

  return {
    orders: { items: orderItems, total: totalCount },
    revenue: { items: revenueItems, total: totalRevenue, today, yesterday, delta, ...dhDelta(delta, pct) },
  };
}

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

  const points = days.map(d => ({ label: dhDayLabel(d), y: pnAt(d) }));
  const pnHoy = points[points.length - 1].y;
  const pnAntes = points[0].y;
  const delta = pnHoy - pnAntes;
  const pct = pnAntes !== 0 ? (Math.abs(delta) / Math.abs(pnAntes)) * 100 : null;

  return { points, pnHoy, pnAntes, delta, ...dhDelta(delta, pct) };
}

// ChartBar / ChartLine (wrappers Vue de bi.js:renderBarChart/renderLineChart)
// viven en vueCharts.js, compartidos con biPanelVue.js — cargar ese archivo
// antes que este en dashboard.html.

// ── App raíz ───────────────────────────────────────────────────────────

const DashboardHomeApp = {
  components: { ChartBar, ChartLine },
  data() {
    return {
      flags: { hasCommerce: false, hasInventory: false, hasAccounting: false, hasBi: false },
      empty: false,
      // status: 'loading' | 'ok' | 'error'; data/error solo tienen sentido con status 'ok'/'error'.
      pending: { status: 'loading', data: null, error: null },
      stock:   { status: 'loading', data: null, error: null },
      acc:     { status: 'loading', data: null, error: null },
      bi7d:    { status: 'loading', data: null, error: null },
      biPn:    { status: 'loading', data: null, error: null },
    };
  },
  methods: {
    fmtMoney,
    // Entry point público — lo llama renderDashboardHome() más abajo, cada
    // vez que se entra/cambia de suit (enterSuit() en shared-ui.js).
    setSuit(suit) {
      const sys = new Set(suit.systems || []);
      const f = {
        hasCommerce:   sys.has('commerce') || sys.has('ecommerce'),
        hasInventory:  sys.has('inventory'),
        hasAccounting: sys.has('contable'),
        hasBi:         sys.has('bi'),
      };
      this.flags = f;
      this.empty = !f.hasCommerce && !f.hasInventory && !f.hasAccounting;

      const load = (key, cond, fn) => {
        if (!cond) { this[key] = { status: 'skip', data: null, error: null }; return; }
        this[key] = { status: 'loading', data: null, error: null };
        fn(suit).then(data => { if (this._runId === runId) this[key] = { status: 'ok', data, error: null }; })
                .catch(err => { if (this._runId === runId) this[key] = { status: 'error', data: null, error: err.message || 'error' }; });
      };

      // Si se cambia de suit mientras cargan, descartamos los renders viejos.
      const runId = (this._runId = (this._runId || 0) + 1);
      load('pending', f.hasCommerce, dwPendingOrders);
      load('stock',   f.hasInventory, dwLowStock);
      load('acc',     f.hasAccounting, dwAccounting);
      load('bi7d',    f.hasBi && f.hasCommerce, dwBi7d);
      load('biPn',    f.hasBi && f.hasAccounting, dwBiPatrimonio30d);
    },
  },
  template: `
    <p v-if="empty" class="crm-muted">Este suit todavía no tiene módulos que muestren un resumen. Activá Commerce, Inventory o Accounting desde eKitwi Identity.</p>

    <div class="dash-home" v-else>
      <!-- ── KPIs ─────────────────────────────────────────────── -->
      <div class="crm-section-title">Resumen</div>
      <div class="kpis">
        <div class="kpi-card" v-if="flags.hasBi && flags.hasCommerce">
          <div class="kpi-label">Ingresos hoy</div>
          <div class="kpi-value" v-if="bi7d.status === 'loading'">…</div>
          <div class="kpi-value" v-else-if="bi7d.status === 'error'">—</div>
          <div class="kpi-value" v-else>{{ fmtMoney(bi7d.data.revenue.today) }}</div>
          <div v-if="bi7d.status === 'ok'" :class="['kpi-sub', 'dw-delta-' + bi7d.data.revenue.dir]">
            {{ bi7d.data.revenue.arrow }} {{ fmtMoney(Math.abs(bi7d.data.revenue.delta)) }}<template v-if="bi7d.data.revenue.pct != null"> ({{ bi7d.data.revenue.pct.toFixed(1) }}%)</template> vs. ayer
          </div>
        </div>

        <div class="kpi-card" v-if="flags.hasCommerce">
          <div class="kpi-label">Pedidos pendientes</div>
          <div class="kpi-value" v-if="pending.status === 'loading'">…</div>
          <div class="kpi-value" v-else-if="pending.status === 'error'">—</div>
          <div class="kpi-value" v-else>{{ pending.data.length }}</div>
        </div>

        <div class="kpi-card" v-if="flags.hasInventory">
          <div class="kpi-label">Stock bajo</div>
          <div class="kpi-value" v-if="stock.status === 'loading'">…</div>
          <div class="kpi-value" v-else-if="stock.status === 'error'">—</div>
          <div class="kpi-value" v-else :class="{ 'dw-warn': stock.data.count > 0 }">{{ stock.data.count }}</div>
        </div>

        <div class="kpi-card" v-if="flags.hasAccounting">
          <div class="kpi-label">Caja</div>
          <div class="kpi-value" v-if="acc.status === 'loading'">…</div>
          <div class="kpi-value" v-else-if="acc.status === 'error'">—</div>
          <div class="kpi-value" v-else>{{ fmtMoney(acc.data.caja) }}</div>
          <div class="kpi-sub" v-if="acc.status === 'ok' && acc.data.showPn && !flags.hasBi">
            Patrimonio Neto: {{ fmtMoney(acc.data.pn) }}
          </div>
        </div>

        <div class="kpi-card" v-if="flags.hasBi && flags.hasAccounting">
          <div class="kpi-label">Patrimonio Neto</div>
          <div class="kpi-value" v-if="biPn.status === 'loading'">…</div>
          <div class="kpi-value" v-else-if="biPn.status === 'error'">—</div>
          <div class="kpi-value" v-else>{{ fmtMoney(biPn.data.pnHoy) }}</div>
          <div v-if="biPn.status === 'ok'" :class="['kpi-sub', 'dw-delta-' + biPn.data.dir]">
            {{ biPn.data.arrow }} {{ fmtMoney(Math.abs(biPn.data.delta)) }}<template v-if="biPn.data.pct != null"> ({{ biPn.data.pct.toFixed(1) }}%)</template> vs. hace 30 días
          </div>
        </div>
      </div>

      <!-- ── Tendencias (requieren BI) ────────────────────────── -->
      <template v-if="flags.hasBi && (flags.hasCommerce || flags.hasAccounting)">
        <div class="crm-section-title">Tendencias</div>
        <div class="dashboard-grid">
          <div class="dashboard-card dashboard-card--wide" v-if="flags.hasCommerce">
            <div class="dashboard-card-title">Ingresos — últimos 7 días</div>
            <div class="dashboard-card-body">
              <p v-if="bi7d.status === 'loading'" class="crm-muted">Cargando…</p>
              <p v-else-if="bi7d.status === 'error'" class="crm-muted">No se pudo cargar ({{ bi7d.error }}).</p>
              <chart-line v-else :points="bi7d.data.revenue.items" value-prefix="$" />
            </div>
          </div>

          <div class="dashboard-card dashboard-card--wide" v-if="flags.hasCommerce">
            <div class="dashboard-card-title">Pedidos — últimos 7 días</div>
            <div class="dashboard-card-body">
              <p v-if="bi7d.status === 'loading'" class="crm-muted">Cargando…</p>
              <p v-else-if="bi7d.status === 'error'" class="crm-muted">No se pudo cargar ({{ bi7d.error }}).</p>
              <chart-bar v-else :items="bi7d.data.orders.items" />
            </div>
          </div>

          <div class="dashboard-card dashboard-card--wide" v-if="flags.hasAccounting">
            <div class="dashboard-card-title">Patrimonio Neto — últimos 30 días</div>
            <div class="dashboard-card-body">
              <p v-if="biPn.status === 'loading'" class="crm-muted">Cargando…</p>
              <p v-else-if="biPn.status === 'error'" class="crm-muted">No se pudo cargar ({{ biPn.error }}).</p>
              <chart-line v-else :points="biPn.data.points" value-prefix="$" />
            </div>
          </div>
        </div>
      </template>

      <!-- ── Detalle ──────────────────────────────────────────── -->
      <div class="crm-section-title">Detalle</div>
      <div class="dashboard-grid">
        <div class="dashboard-card" v-if="flags.hasCommerce">
          <div class="dashboard-card-title">Pedidos pendientes</div>
          <div class="dashboard-card-body">
            <p v-if="pending.status === 'loading'" class="crm-muted">Cargando…</p>
            <p v-else-if="pending.status === 'error'" class="crm-muted">No se pudo cargar ({{ pending.error }}).</p>
            <p v-else-if="!pending.data.length" class="dw-ok">Sin pedidos pendientes ✓</p>
            <ul v-else class="dw-list">
              <li v-for="(o, i) in pending.data" :key="i">
                <div class="dw-list-main">
                  <span class="dw-list-title">{{ o.who }}</span>
                  <span class="dw-list-meta">{{ o.date }} · {{ o.units }} art.</span>
                </div>
                <span class="dw-list-amount">{{ fmtMoney(o.total) }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="dashboard-card" v-if="flags.hasInventory">
          <div class="dashboard-card-title">Stock bajo</div>
          <div class="dashboard-card-body">
            <p v-if="stock.status === 'loading'" class="crm-muted">Cargando…</p>
            <p v-else-if="stock.status === 'error'" class="crm-muted">No se pudo cargar ({{ stock.error }}).</p>
            <p v-else-if="!stock.data.count" class="dw-ok">Todo el stock por encima del mínimo ✓</p>
            <ul v-else class="dw-list">
              <li v-for="(p, i) in stock.data.items" :key="i">
                <div class="dw-list-main">
                  <span class="dw-list-title">{{ p.name }}</span>
                  <span class="dw-list-meta">Mínimo {{ p.minStock }}</span>
                </div>
                <span class="dw-list-amount" :class="{ 'dw-warn': p.stock === 0 }">{{ p.stock }} u.</span>
              </li>
              <li v-if="stock.data.count > stock.data.items.length">
                <span class="dw-list-meta">+{{ stock.data.count - stock.data.items.length }} más…</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>`,
};

// ── Entry point (misma firma que dashboardHome.js) ───────────────────────

let dashboardHomeVueInstance = null;

function renderDashboardHome(suit) {
  const nameEl = document.getElementById('dashboard-suit-name');
  if (nameEl) nameEl.textContent = suit.name;

  if (!dashboardHomeVueInstance) {
    const mountEl = document.getElementById('dashboard-home-app');
    if (!mountEl) return;
    dashboardHomeVueInstance = Vue.createApp(DashboardHomeApp).mount(mountEl);
  }
  dashboardHomeVueInstance.setSuit(suit);
}
