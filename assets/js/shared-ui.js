/**
 * shared-ui.js
 * Bits used across every panel: the toast, the generic confirm modal
 * (delete product/category, cancel/return an order), the nav session
 * label, and the suit-driven "Apps" menu (renderAppsMenu — fills the
 * floating menu whose shell appsMenu.js injects; also kicks off the
 * Dashboard home widgets, see dashboardHome.js).
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════
// Toast
// ══════════════════════════════════════════════════════════════════════

let toastTimer;
function showToast(msg, type = 'ok') {
  // Solicitud enviada a aprobación (permiso "Preguntar", ver api.js): aviso, no error.
  if (type === 'err' && /^Solicitud enviada/.test(msg)) {
    const el = document.getElementById('crm-toast');
    el.textContent = '⏳ ' + msg;
    el.className = 'crm-toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
    return;
  }
  const el = document.getElementById('crm-toast');
  el.textContent = (type === 'ok' ? '✓ ' : '✗ ') + msg;
  el.className = 'crm-toast show' + (type === 'err' ? ' toast-err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ══════════════════════════════════════════════════════════════════════
// Generic confirm modal (delete product/category, cancel/return order)
// ══════════════════════════════════════════════════════════════════════

let confirmCb = null;

function openConfirmModal({ message, showRestock = false, onConfirm }) {
  document.getElementById('modal-confirm-msg').textContent = message;
  document.getElementById('modal-confirm-restock-wrap').hidden = !showRestock;
  document.getElementById('modal-confirm-restock').checked = true;
  confirmCb = onConfirm;
  document.getElementById('modal-confirm').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('modal-confirm').classList.remove('open');
  confirmCb = null;
}

function initConfirmModal() {
  document.getElementById('modal-confirm-close').addEventListener('click', closeConfirmModal);
  document.getElementById('modal-confirm-cancel').addEventListener('click', closeConfirmModal);
  document.getElementById('modal-confirm-ok').addEventListener('click', () => {
    const restockWrap = document.getElementById('modal-confirm-restock-wrap');
    const restock = restockWrap.hidden ? undefined : document.getElementById('modal-confirm-restock').checked;
    const cb = confirmCb;
    closeConfirmModal();
    if (cb) cb(restock);
  });
}

// ══════════════════════════════════════════════════════════════════════
// System status — pantalla de bloqueo cuando un panel está en mantenimiento
// ══════════════════════════════════════════════════════════════════════

// statusRow: fila de GET /system-status para el módulo bloqueado.
// panelLabel: nombre del panel a mostrar (ej. "Accounting").
function renderMaintenancePanel(statusRow, panelLabel) {
  document.getElementById('maintenance-title').textContent = statusRow.title || `${panelLabel} en mantenimiento`;
  document.getElementById('maintenance-subtitle').textContent = panelLabel;
  document.getElementById('maintenance-message').textContent =
    statusRow.message || 'Estamos trabajando en este módulo. Volvé a intentarlo en unos minutos.';

  const estimatedEl = document.getElementById('maintenance-estimated');
  if (statusRow.estimatedEnd) {
    estimatedEl.textContent = 'Vuelve aproximadamente: ' + new Date(statusRow.estimatedEnd).toLocaleString('es-AR');
    estimatedEl.hidden = false;
  } else {
    estimatedEl.textContent = '';
    estimatedEl.hidden = true;
  }

  document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-maintenance').classList.add('active');
}

// ══════════════════════════════════════════════════════════════════════
// Session (Resumen KPIs) + sidebar
// ══════════════════════════════════════════════════════════════════════

function renderSession() {
  const token = getErpToken();
  const payload = token ? decodeJwt(token) : null;
  if (!payload) return;

  document.getElementById('nav-user-name').textContent = payload.email || '';
}

function renderIdentityLink() {
  const url = (window.EKITWI_MODULE_URLS || {}).identity;
  const link = document.getElementById('identity-link'); // lo crea renderAppsMenu()
  if (url && link) link.href = url;
}

// ══════════════════════════════════════════════════════════════════════
// Active suit — which suit is "active" gates what the sidebar shows.
// Picking it happens on its own page (pages/suitselection.html); this
// dashboard only ever reads the choice (suit-state.js) and bounces there
// when there's nothing valid to read.
// ══════════════════════════════════════════════════════════════════════

async function initSuits() {
  const grid = document.getElementById('suits-grid');

  // Catálogo módulo→features, necesario antes de armar cualquier sidebar
  // (suitModuleButtons() lo lee vía la variable global modulesCatalog).
  await loadAndCacheModulesCatalog();

  let suits;
  try {
    suits = window.EKITWI_DEV_MODE ? MOCK_SUITS : await loadSuitsWithSystems();
  } catch (err) {
    grid.innerHTML = `<p class="crm-muted">No se pudieron cargar tus suits (${esc(err.message)}).</p>`;
    clearAppsMenu('No se pudieron cargar tus suits.');
    return;
  }

  if (!suits.length) {
    renderSuitsGrid(null);
    clearAppsMenu('Todavía no tenés ningún suit asignado.');
    document.getElementById('dashboard-widgets').innerHTML =
      '<p class="crm-muted">Todavía no tenés ningún suit asignado.</p>';
    return;
  }

  // Single suit: nothing to choose, same as suit-selection.js's own rule.
  if (suits.length === 1) {
    enterSuit(suits[0], suits.length);
    return;
  }

  const savedId = getCurrentSuitId();
  const saved   = savedId && suits.find(s => s.id === savedId);
  if (saved) {
    enterSuit(saved, suits.length);
  } else {
    // No (valid) suit picked yet — go pick one.
    clearCurrentSuitId();
    window.location.replace(ERP_SUIT_SELECT_PATH);
  }
}

async function enterSuit(suit, totalSuits) {
  setCurrentSuitId(suit.id);
  // Antes de armar el aside (renderAppsMenu la filtra por sección/lectura,
  // ver permissions.js) — necesitamos saber si el usuario es owner o un
  // miembro del equipo, y con qué permisos.
  await loadCurrentSuitPermissions(suit);
  renderSuitsGrid(suit);
  renderAppsMenu(suit, { canSwitchSuit: totalSuits >= 2 });
  // dashboardHome.js se carga después; en el arranque ya está definido.
  if (typeof renderDashboardHome === 'function') renderDashboardHome(suit);
  if (typeof initNotifications === 'function') initNotifications(suit);
}

// El botón "Cambiar de suit" lo regenera renderAppsMenu() cada vez, así que
// el listener va por delegación (no sobre el elemento puntual).
function initSuitSwitcher() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#switch-suit-btn')) return;
    clearCurrentSuitId();
    window.location.href = ERP_SUIT_SELECT_PATH;
  });
}

function renderSuitsGrid(suit) {
  const grid = document.getElementById('suits-grid');
  if (!suit) {
    grid.innerHTML = '<p class="crm-muted">Todavía no tenés ningún suit asignado.</p>';
    return;
  }
  grid.innerHTML = `
    <div class="suit-card">
      <div class="suit-card-top">
        <span class="suit-card-name">${esc(suit.name)}</span>
        <span class="crm-badge ${suit.isActive ? 'badge-green' : 'badge-gray'}">${suit.isActive ? 'Activa' : 'Inactiva'}</span>
      </div>
      <div class="suit-card-slug">/${esc(suit.slug || '—')}</div>
      <div class="suit-card-tags">
        ${suit.systems.length
          ? suit.systems.map(t => `<span class="crm-badge ${(SYSTEM_META[t] || {}).badge || 'badge-gray'}">${esc((SYSTEM_META[t] || {}).label || t)}</span>`).join('')
          : '<span class="crm-muted" style="font-size:.8rem">Sin módulos habilitados</span>'}
      </div>
    </div>
  `;
}

// Íconos de los ítems que no son features de un módulo (los otros los trae
// FEATURE_META más abajo).
const NAV_ICONS = {
  dashboard: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  identity:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>',
  switchSuit:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
};

// Llena la lista del menú "Apps" (#apps-list, shell inyectado por
// appsMenu.js): Dashboard arriba, después los subsistemas del suit
// (suitModuleButtons, mismos .side-item[data-panel] de siempre — la
// navegación la maneja la delegación de dashboard.js), y al final Identity +
// Cambiar de suit. `--i` por ítem para la entrada escalonada (ver erp.css).
function renderAppsMenu(suit, { canSwitchSuit } = {}) {
  const list = document.getElementById('apps-list');
  if (!list) return;

  const dashActive = document.getElementById('panel-dashboard')?.classList.contains('active') ? ' active' : '';

  const suitInfoActive = document.getElementById('panel-suit-info')?.classList.contains('active') ? ' active' : '';
  const teamActive = document.getElementById('panel-team')?.classList.contains('active') ? ' active' : '';

  const parts = [
    `<button class="side-item${dashActive}" data-panel="dashboard" title="Dashboard">${NAV_ICONS.dashboard}<span class="side-item-label">Dashboard</span></button>`,
    `<button class="side-item${suitInfoActive}" data-panel="suit-info" data-suit-id="${suit.id}" data-suit-name="${esc(suit.name)}" title="Suit Info — ${esc(suit.name)}">${ICONS.suit_info}<span class="side-item-label">Suit Info</span></button>`,
    // "Equipo": administrar quién tiene acceso al ERP de este suit y con qué
    // permisos — exclusivo del owner, no una feature/sección delegable (ver
    // API/src/suit-roles y suit-members).
    isCurrentSuitOwner()
      ? `<button class="side-item${teamActive}" data-panel="team" data-suit-id="${suit.id}" data-suit-name="${esc(suit.name)}" title="Equipo — ${esc(suit.name)}">${ICONS.team}<span class="side-item-label">Equipo</span></button>`
      : '',
    '<div class="apps-divider"></div>',
    suitModuleButtons(suit),
    '<div class="apps-divider"></div>',
    `<a class="side-item" id="identity-link" href="#" target="_blank" rel="noopener" title="eKitwi Identity">${NAV_ICONS.identity}<span class="side-item-label">Identity</span></a>`,
  ];
  if (canSwitchSuit) {
    parts.push(`<button class="side-item" id="switch-suit-btn" title="Cambiar de suit">${NAV_ICONS.switchSuit}<span class="side-item-label">Cambiar de suit</span></button>`);
  }

  list.innerHTML = parts.join('');
  [...list.querySelectorAll('.side-item')].forEach((el, i) => el.style.setProperty('--i', i));

  renderIdentityLink();
}

function clearAppsMenu(msg) {
  const list = document.getElementById('apps-list');
  if (list) list.innerHTML = `<p class="apps-empty">${esc(msg || '')}</p>`;
}

// Ícono + panel físico (`ek_features.panel`, qué contenedor #panel-X abrir)
// por cada feature ya implementada — una pestaña propia del aside por
// feature, ya no una por módulo (ver API/docs/migracion_21.md). Una feature
// sin entrada acá (todavía sin implementación propia) cae al placeholder
// "Próximamente". `storefront` es un caso aparte (ver más abajo): no es un
// panel interno, nunca tiene `panel` — es un link externo a ek_suit.website.
const FEATURE_META = {
  pos:             { icon: ICONS.pos,             panel: 'commerce' },
  orders:          { icon: ICONS.orders,          panel: 'commerce' },
  cash_management: { icon: ICONS.cash_management, panel: 'commerce' },
  products:        { icon: ICONS.products,        panel: 'inventory' },
  suppliers:       { icon: ICONS.suppliers,       panel: 'inventory' },
  branches:        { icon: ICONS.branches,        panel: 'inventory' },
  purchase_orders: { icon: ICONS.purchase_orders, panel: 'inventory' },
  bookings:        { icon: ICONS.booking,         panel: 'booking' },
  projects:        { icon: ICONS.scrum,           panel: 'projects' },
  accounting:      { icon: ICONS.contable,         panel: 'accounting' },
  bi_dashboard:    { icon: ICONS.bi,              panel: 'bi' },
  gallery_obras:   { icon: ICONS.gallery_obras,   panel: 'gallery' }
};

// Features que el catálogo de módulos (o los mocks) puede traer pero que ya
// no queremos como pestaña del aside. "prices": los precios adicionales se
// administran ahora dentro del editor de producto (modal Nuevo/Editar
// producto), así que la pestaña propia quedó redundante.
const HIDDEN_FEATURES = new Set(['prices']);

// Arma el sidebar del suit activo a partir de sus módulos habilitados
// (suit.systems) cruzados contra el catálogo módulo→features (modulesCatalog,
// cacheado en dashboard.js por loadAndCacheModulesCatalog()) — una pestaña
// por feature (ver FEATURE_META arriba), en el orden del catálogo. Una misma
// feature desbloqueada por más de un módulo (ej. "orders", por Commerce y
// eCommerce) se deduplica para no repetir el botón.
function suitModuleButtons(suit) {
  const nameAttr    = esc(suit.name);
  const suitTypes   = new Set(suit.systems);
  const seen        = new Set();
  const featureBtns = []; // conserva el orden del catálogo
  const linkBtns    = []; // links externos reales (storefront con website cargado)
  const comingSoon  = [];

  for (const mod of (modulesCatalog || [])) {
    if (!suitTypes.has(mod.key)) continue;

    for (const feature of mod.features) {
      if (seen.has(feature.key)) continue;
      seen.add(feature.key);
      if (HIDDEN_FEATURES.has(feature.key)) continue;

      // Si la feature está gateada por sección (FEATURE_SECTION, ver
      // permissions.js) y el usuario actual (owner o miembro del equipo) no
      // tiene lectura ahí, la pestaña ni se arma — ver ekCan().
      const gatingSection = FEATURE_SECTION[feature.key];
      if (gatingSection && !ekCan(gatingSection, 'read')) continue;

      // "Ver sitio web": con ek_suit.website cargado es un <a> real que abre
      // la tienda pública en una pestaña nueva; sin eso, cae al placeholder
      // "Próximamente" como cualquier otra feature sin implementación.
      if (feature.key === 'storefront' && suit.website) {
        linkBtns.push(`<a class="side-item" href="${esc(suit.website)}" target="_blank" rel="noopener noreferrer" data-suit-id="${suit.id}" data-suit-name="${nameAttr}" title="Ver sitio web — ${nameAttr}">${ICONS.external}<span class="side-item-label">Ver sitio web</span></a>`);
        continue;
      }

      const meta = FEATURE_META[feature.key];
      if (meta) {
        // data-suit-systems: bi.js necesita saber qué otros sistemas tiene
        // el suit para decidir qué cards mostrar, sin pedir GET /systems de nuevo.
        const extra = meta.panel === 'bi' ? ` data-suit-systems="${suit.systems.join(',')}"` : '';
        featureBtns.push(`<button class="side-item" data-panel="${meta.panel}" data-feature="${feature.key}" data-suit-id="${suit.id}" data-suit-name="${nameAttr}"${extra} title="${esc(feature.name)} — ${nameAttr}">${meta.icon}<span class="side-item-label">${esc(feature.name)}</span></button>`);
      } else {
        const message = feature.key === 'storefront' ? 'Este suit todavía no tiene un sitio web configurado.' : '';
        comingSoon.push(`<button class="side-item" data-panel="coming-soon" data-feature-name="${esc(feature.name)}" data-feature-message="${esc(message)}" data-suit-id="${suit.id}" data-suit-name="${nameAttr}" title="${esc(feature.name)} — ${nameAttr}">${ICONS.placeholder}<span class="side-item-label">${esc(feature.name)}</span></button>`);
      }
    }
  }

  const buttons = [...featureBtns, ...linkBtns, ...comingSoon];
  return buttons.length ? buttons.join('') : '<p class="sidebar-empty">Sin módulos habilitados</p>';
}
