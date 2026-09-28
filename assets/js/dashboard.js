/**
 * dashboard.js
 * eKitwi ERP hub — entry point. On login we ask the backend which suits
 * (tenants) the user owns (GET /suits) and which modules each one has
 * enabled (GET /suits/:id/systems — 'commerce' | 'ecommerce' | 'inventory'
 * | 'booking' | 'scrum' | 'contable' | 'bi'), then gate on a single *active*
 * suit (shared-ui.js's suit picker, if the user has more than one) and
 * build the sidebar for that suit alone. A module can unlock more than one
 * pestaña/feature (ek_module_features), and the same feature can be
 * unlocked by more than one module (ej. "orders" por Commerce y eCommerce)
 * — GET /modules trae ese catálogo módulo→features, cacheado por
 * loadAndCacheModulesCatalog() y cruzado contra suit.systems en
 * suitModuleButtons() (shared-ui.js) para armar el sidebar, en vez del
 * mapeo módulo→pestaña hardcodeado que había antes. Features sin panel
 * propio todavía (ek_features.panel = null) caen al placeholder
 * "Próximamente" (#panel-coming-soon) en vez de a uno de los paneles reales
 * de abajo. Ver API/docs/migracion_15.md.
 *
 * This file only wires the global nav (delegated panel-switching over the
 * "Apps" menu items) and bootstraps the page. Everything else lives in its
 * own file, loaded before this one:
 *   constants.js  → icons / badge colors / page size (no state, no DOM)
 *   mocks.js      → EKITWI_DEV_MODE fixtures
 *   data.js       → the data layer — the only place that checks EKITWI_DEV_MODE
 *   shared-ui.js  → toast, confirm modal, renderAppsMenu (llena el menú "Apps")
 *   appsMenu.js   → shell del menú "Apps" flotante (trigger + lista) + open/close
 *   dashboardHome.js → widgets del panel Dashboard (home)
 *   commerce.js   → Commerce panel (POS + Pedidos) + its own event wiring
 *   inventory.js  → Inventory panel (dólar, Productos, Categorías, Precios)
 *                   + its own event wiring
 *   booking.js    → Bookings panel (Recursos, Reservas) + its own event wiring
 *   projects.js   → Projects panel (SCRUM: Backlog, Sprints, Tablero)
 *                   + its own event wiring
 *   accounting.js → Accounting panel (Plan de Cuentas, Ejercicios, Centros
 *                   de Costo, Libro Diario) + its own event wiring
 *   bi.js         → BI panel: one stat row + SVG chart per enabled system,
 *                   read-only (no event wiring to init at bootstrap)
 *   assistant.js  → AI Assistant floating bubble + chat panel — global, not
 *                   gated by suit/panel state like the rest of this list
 * See APIconnection.md for what's read-only vs. still pending.
 */

'use strict';

// Cacheado una sola vez al bootstrap (ver DOMContentLoaded más abajo) e
// indexado por module — dashboard.html puede visitarse directo sin pasar
// por suitselection.html, así que este fetch no puede vivir solo ahí.
let systemStatusByModule = {};

async function loadAndCacheSystemStatus() {
  try {
    const rows = await loadSystemStatus();
    systemStatusByModule = Object.fromEntries((rows || []).map(r => [r.module, r]));
  } catch {
    // Si /system-status falla, no bloqueamos el ERP entero por eso.
    systemStatusByModule = {};
  }
}

// Catálogo módulo→features (GET /modules) — lo lee suitModuleButtons()
// (shared-ui.js) para armar el sidebar en vez del mapeo hardcodeado de
// antes. Cacheado por initSuits() antes de renderizar cualquier sidebar.
let modulesCatalog = [];

async function loadAndCacheModulesCatalog() {
  try {
    modulesCatalog = await loadModulesCatalog() || [];
  } catch {
    // Si /modules falla, el sidebar queda vacío en vez de romper el ERP.
    modulesCatalog = [];
  }
}

// Sub-vista a la que saltar dentro de #panel-commerce/#panel-inventory según
// la feature del aside que se clickeó (ver FEATURE_META en shared-ui.js).
// 'pos' no necesita entrada: es la vista por defecto que ya deja armada
// loadCommercePanel() ('home' = POS). 'products' SÍ necesita entrada aunque
// loadInventoryPanel() también deja 'home' por defecto — ese "home" quedó
// sin cotización del dólar/KPIs/Categorías (se movieron a
// inventory-products-view, ver dashboard.html) así que ya no sirve como
// pantalla de aterrizaje. Reutiliza las mismas funciones que ya usan las
// nav-cards internas (commerce.js/inventory.js).
const FEATURE_ENTRY = {
  cash_management: enterCajaManagement,
  orders:          enterPedidosManagement,
  products:        enterProducts,
  suppliers:       enterSuppliers,
  branches:        enterBranches,
  purchase_orders: enterPurchaseOrders
};

// Salida de las sub-vistas ("← Volver"): deja el Dashboard activo, igual que
// tocar "Dashboard" en el menú "Apps". Las sub-vistas de Inventory no pueden
// volver a su "home" — ese selector ya no tiene entrada propia en el menú
// (ver FEATURE_ENTRY arriba) y volver ahí dejaba al usuario en una pantalla
// muerta con las mismas tarjetas de las que acababa de salir.
function goToDashboard() {
  document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.side-item[data-panel="dashboard"]')?.classList.add('active');
  document.getElementById('panel-dashboard').classList.add('active');
}

// true si el panel debe bloquearse: está en maintenance y el usuario actual
// no es SUPER_ADMIN con allowAdminAccess habilitado para ese módulo.
function isPanelBlocked(panelKey) {
  const row = systemStatusByModule[panelKey];
  if (!row || row.status !== 'maintenance') return false;
  return !(isAdmin() && row.allowAdminAccess);
}

function initGlobalNav() {
  // Panel switching — delegado porque los ítems del menú "Apps" los inyecta
  // renderAppsMenu() (shared-ui.js) después de que se ata este listener.
  // closeAppsMenu() lo define appsMenu.js.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.side-item[data-panel]');
    if (!btn) return;

    if (isPanelBlocked(btn.dataset.panel)) {
      const label = btn.querySelector('.side-item-label')?.textContent.trim() || btn.dataset.panel;
      renderMaintenancePanel(systemStatusByModule[btn.dataset.panel], label);
      closeAppsMenu();
      return;
    }

    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.panel)?.classList.add('active');

    if (btn.dataset.panel === 'commerce') {
      loadCommercePanel(btn.dataset.suitId, btn.dataset.suitName).then(() => {
        const entry = FEATURE_ENTRY[btn.dataset.feature];
        if (entry) entry(); else document.getElementById('pos-scan-input')?.focus();
      }).catch(err => console.log('[DEBUG] loadCommercePanel/entry falló ->', err)); // TODO quitar
    } else if (btn.dataset.panel === 'inventory') {
      loadInventoryPanel(btn.dataset.suitId, btn.dataset.suitName, btn.dataset.feature).then(() => {
        const entry = FEATURE_ENTRY[btn.dataset.feature];
        if (entry) entry();
      }).catch(err => console.log('[DEBUG] loadInventoryPanel/entry falló ->', err)); // TODO quitar
    } else if (btn.dataset.panel === 'booking') {
      loadBookingPanel(btn.dataset.suitId, btn.dataset.suitName);
    } else if (btn.dataset.panel === 'projects') {
      loadProjectsPanel(btn.dataset.suitId, btn.dataset.suitName);
    } else if (btn.dataset.panel === 'accounting') {
      loadAccountingPanel(btn.dataset.suitId, btn.dataset.suitName);
    } else if (btn.dataset.panel === 'bi') {
      loadBiPanel(btn.dataset.suitId, btn.dataset.suitName, (btn.dataset.suitSystems || '').split(',').filter(Boolean));
    } else if (btn.dataset.panel === 'gallery') {
      loadGalleryPanel(btn.dataset.suitId, btn.dataset.suitName, btn.dataset.feature);
    } else if (btn.dataset.panel === 'suit-info') {
      loadSuitInfoPanel(btn.dataset.suitId, btn.dataset.suitName);
    } else if (btn.dataset.panel === 'team') {
      loadTeamPanel(btn.dataset.suitId, btn.dataset.suitName);
    } else if (btn.dataset.panel === 'coming-soon') {
      // Feature desbloqueada por el módulo pero todavía sin panel propio
      // (ek_features.panel = null) — ver API/docs/migracion_15.md.
      document.getElementById('coming-soon-title').textContent = btn.dataset.featureName || 'Próximamente';
      document.getElementById('coming-soon-message').textContent =
        btn.dataset.featureMessage || 'Estamos trabajando en esto — pronto vas a poder usarlo desde acá.';
    }

    closeAppsMenu();
  });

  // Links reales (<a href>): "Ver sitio web" e "Identity" (sin data-panel,
  // así que el listener de arriba los ignora) — solo cerrar el menú, la
  // navegación la maneja el navegador (target="_blank").
  document.addEventListener('click', (e) => {
    if (e.target.closest('.side-item[href]')) closeAppsMenu();
  });
}

// Menú del usuario en la navbar: al tocar el email se despliega "Cerrar
// sesión" (el <button id="logout-btn"> lo sigue manejando auth.js).
function initUserMenu() {
  const btn  = document.getElementById('nav-user-btn');
  const menu = document.getElementById('nav-user-menu');
  if (!btn || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderSession();
  renderIdentityLink();
  initGlobalNav();
  initUserMenu();
  initConfirmModal();
  initCommerceEvents();
  initInventoryEvents();
  initBookingEvents();
  initProjectsEvents();
  initIdeasEvents();
  initPlansEvents();
  initAccountingEvents();
  initGalleryEvents();
  initHistoriasEvents();
  initSuitInfoEvents();
  initTeamEvents();
  // initAssistant();  // Asistente IA deshabilitado hasta tener el modelo local (Gemini no rinde)
  initSuitSwitcher();
  loadAndCacheSystemStatus();
  initSuits();
});
