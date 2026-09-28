/**
 * biPanelVue.js
 * Vue del panel "BI": mismo rol que loadBiPanel()/loadEcommerceChart()/
 * loadBookingChart()/loadScrumChart()/loadAccountingChart() en bi.js (que
 * quedan sin llamarse — la declaración de loadBiPanel acá abajo pisa la de
 * bi.js por orden de carga — como referencia/rollback, igual que
 * dashboardHome.js quedó al lado de dashboardHomeVue.js).
 *
 * Un "resumen general" con una tarjeta por sistema habilitado (Commerce/
 * eCommerce → ventas, Bookings, Projects, Accounting), cada una con sus
 * propios KPIs + un gráfico. Sin drill-down ni filtros (mismo alcance v1
 * que ya tenía bi.js). Las funciones dwX() calculan exactamente lo mismo
 * que las loadXChart() originales, solo que devuelven datos en vez de
 * armar HTML a mano; la presentación vive en BiCard más abajo, reusando
 * ChartBar/ChartLine (vueCharts.js) para los gráficos — mismos primitivos
 * SVG de bi.js, con hover + tooltip + crosshair ya incluidos ahí.
 *
 * Se carga después de bi.js (BI_PALETTE, BI_BOOKING_STATUS_LABEL,
 * renderBarChart/renderLineChart vía ChartBar/ChartLine) y vueCharts.js.
 */

'use strict';

async function dwEcommerce(suitId) {
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
    y, label: new Date(`${key}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
  }));

  return {
    kpis: [
      { label: 'Ingresos (30 días)', value: fmtMoney(total) },
      { label: 'Ventas (30 días)', value: count },
    ],
    points,
  };
}

async function dwBooking(suitId) {
  const res = await listBookings(suitId, { take: 100 });
  const statusOrder = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  const counts = Object.fromEntries(statusOrder.map(s => [s, 0]));
  res.data.forEach(b => { if (counts[b.status] !== undefined) counts[b.status]++; });

  return {
    kpis: [
      { label: 'Reservas totales', value: res.pagination.total },
      { label: 'Pendientes', value: counts.pending },
    ],
    items: statusOrder.map((s, i) => ({
      label: BI_BOOKING_STATUS_LABEL[s] || s, value: counts[s], color: BI_PALETTE.series[i % BI_PALETTE.series.length],
    })),
  };
}

async function dwScrum() {
  const projects = await listProjects();
  const storiesByProject = await Promise.all(projects.map(p => listStories(p.id)));
  const allStories = storiesByProject.flat();
  const statusOrder = ['backlog', 'in-sprint', 'done'];
  const counts = Object.fromEntries(statusOrder.map(s => [s, 0]));
  allStories.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

  return {
    kpis: [
      { label: 'Proyectos', value: projects.length },
      { label: 'Historias totales', value: allStories.length },
    ],
    items: statusOrder.map((s, i) => ({
      label: (STORY_STATUS[s] || {}).label || s, value: counts[s], color: BI_PALETTE.series[i % BI_PALETTE.series.length],
    })),
  };
}

async function dwContable(suitId) {
  const [ejercicios, balances] = await Promise.all([listEjercicios(suitId), getBalances(suitId)]);
  const abierto = ejercicios.find(e => e.estado === 'abierto');

  let asientos = [];
  if (abierto) asientos = (await listAsientos(suitId, { ejercicioId: abierto.id, take: 100 })).data;

  const statusOrder = ['borrador', 'confirmado', 'anulado'];
  const counts = Object.fromEntries(statusOrder.map(s => [s, 0]));
  asientos.forEach(a => { if (counts[a.estado] !== undefined) counts[a.estado]++; });

  return {
    kpis: [
      { label: 'Caja (asientos confirmados)', value: fmtMoney(balances.caja) },
      { label: 'Patrimonio Neto (Activo − Pasivo)', value: fmtMoney(balances.patrimonioNeto) },
      { label: 'Ejercicio', value: abierto ? abierto.nombre : 'Ninguno abierto' },
    ],
    items: statusOrder.map((s, i) => ({
      label: ASIENTO_ESTADO_LABEL[s] || s, value: counts[s], color: BI_PALETTE.series[i % BI_PALETTE.series.length],
    })),
  };
}

// Una tarjeta genérica: título + fila de KPIs + un gráfico (línea o barras).
// Las 4 cards del panel (Ventas/Reservas/Proyectos/Contabilidad) reusan esto.
const BiCard = {
  components: { ChartBar, ChartLine },
  props: { title: String, card: Object, chartType: { type: String, default: 'bar' } },
  template: `
    <div class="card">
      <div class="crm-section-title">{{ title }}</div>
      <p v-if="card.status === 'loading'" class="crm-muted">Cargando…</p>
      <p v-else-if="card.status === 'error'" class="bi-empty-card">No se pudo cargar ({{ card.error }}).</p>
      <template v-else-if="card.status === 'ok'">
        <div class="kpis">
          <div class="kpi-card" v-for="(k, i) in card.data.kpis" :key="i">
            <div class="kpi-label">{{ k.label }}</div>
            <div class="kpi-value">{{ k.value }}</div>
          </div>
        </div>
        <chart-line v-if="chartType === 'line'" :points="card.data.points" value-prefix="$" />
        <chart-bar v-else :items="card.data.items" />
      </template>
    </div>`,
};

const BiPanelApp = {
  components: { BiCard },
  data() {
    return {
      cards: {
        ecommerce: { status: 'skip', data: null, error: null },
        booking:   { status: 'skip', data: null, error: null },
        scrum:     { status: 'skip', data: null, error: null },
        contable:  { status: 'skip', data: null, error: null },
      },
    };
  },
  computed: {
    anyVisible() { return Object.values(this.cards).some(c => c.status !== 'skip'); },
  },
  methods: {
    // Entry point público — lo llama loadBiPanel() más abajo, cada vez que
    // se entra al panel BI (initGlobalNav() en dashboard.js).
    setSuit(suitId, systems) {
      const enabled = {
        // Igual que antes: las ventas (listOrders 'venta') las genera tanto
        // Commerce (POS) como eCommerce (tienda pública).
        ecommerce: systems.includes('commerce') || systems.includes('ecommerce'),
        booking:   systems.includes('booking'),
        scrum:     systems.includes('scrum'),
        contable:  systems.includes('contable'),
      };

      // Si se cambia de suit mientras cargan, descartamos los renders viejos.
      const runId = (this._runId = (this._runId || 0) + 1);
      const load = (key, cond, fn) => {
        if (!cond) { this.cards[key] = { status: 'skip', data: null, error: null }; return; }
        this.cards[key] = { status: 'loading', data: null, error: null };
        fn().then(data => { if (this._runId === runId) this.cards[key] = { status: 'ok', data, error: null }; })
            .catch(err => { if (this._runId === runId) this.cards[key] = { status: 'error', data: null, error: err.message || 'error' }; });
      };

      load('ecommerce', enabled.ecommerce, () => dwEcommerce(suitId));
      load('booking',   enabled.booking,   () => dwBooking(suitId));
      load('scrum',     enabled.scrum,     () => dwScrum());
      load('contable',  enabled.contable,  () => dwContable(suitId));
    },
  },
  template: `
    <p v-if="!anyVisible" class="crm-muted">Este suit no tiene otros módulos habilitados todavía — activá Commerce, Bookings, Projects o Accounting para ver gráficos acá.</p>
    <div class="bi-cards" v-else>
      <bi-card v-if="cards.ecommerce.status !== 'skip'" title="Ventas" :card="cards.ecommerce" chart-type="line" />
      <bi-card v-if="cards.booking.status !== 'skip'" title="Reservas" :card="cards.booking" chart-type="bar" />
      <bi-card v-if="cards.scrum.status !== 'skip'" title="Proyectos" :card="cards.scrum" chart-type="bar" />
      <bi-card v-if="cards.contable.status !== 'skip'" title="Contabilidad" :card="cards.contable" chart-type="bar" />
    </div>`,
};

// ── Entry point (misma firma que loadBiPanel en bi.js) ───────────────────

let biPanelVueInstance = null;

function loadBiPanel(suitId, suitName, systems) {
  document.getElementById('bi-suit-label').textContent = `BI de ${suitName}`;

  if (!biPanelVueInstance) {
    const mountEl = document.getElementById('bi-panel-app');
    if (!mountEl) return;
    biPanelVueInstance = Vue.createApp(BiPanelApp).mount(mountEl);
  }
  biPanelVueInstance.setSuit(suitId, systems);
}
