/**
 * constants.js
 * Small static lookup tables shared across the dashboard's panels — icons,
 * badge colors and pagination size. No state, no DOM, no network.
 */

'use strict';

const SYSTEM_META = {
  commerce:  { label: 'Commerce',  badge: 'badge-blue' },
  ecommerce: { label: 'eCommerce', badge: 'badge-green' },
  inventory: { label: 'Inventory', badge: 'badge-purple' },
  scrum:     { label: 'Projects',  badge: 'badge-red' },
  contable:  { label: 'Accounting', badge: 'badge-yellow' },
  booking:   { label: 'Bookings',  badge: 'badge-green' },
  bi:        { label: 'BI',        badge: 'badge-gray' },
  gallery:   { label: 'Gallery',   badge: 'badge-purple' }
};

const ICONS = {
  commerce:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h.01M11 8h6M7 12h.01M11 12h6M7 16h.01M11 16h6"/></svg>',
  inventory: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  contable:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>',
  scrum:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  booking:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  bi:        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  // Íconos por feature (pestañas propias del aside dentro de Commerce/Inventory,
  // ver FEATURE_META en shared-ui.js) — reutilizan los SVG de las nav-cards
  // internas de dashboard.html, salvo 'pos' que no tenía ícono propio.
  pos:             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  orders:          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>',
  cash_management: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  products:        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  prices:          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>',
  suppliers:       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  branches:        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg>',
  purchase_orders: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 3l-9 9"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>',
  assistant: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  // Plan Gallery: pestaña "Obras" (marco con imagen)
  gallery_obras: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  // "Suit Info": ítem fijo del menú (tarjeta de identidad + datos de contacto)
  suit_info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h3M15 12h3M7 16h10"/></svg>',
  // "Equipo": ítem fijo del menú, solo owner (alta de miembros + roles/permisos)
  team: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  // Feature desbloqueada sin panel propio todavía (ver ek_features.panel) —
  // el sidebar la muestra igual, apuntando al panel "Próximamente".
  placeholder: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  // Link externo real (ej. "Ver sitio web" cuando el suit tiene ek_suit.website cargado).
  external: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
};

const ORDER_BADGE = {
  'pedido':           'badge-yellow',
  'pedido cancelado': 'badge-red',
  'venta':            'badge-green',
  'devolucion':       'badge-purple',
  'cambio':           'badge-blue'
};

const BOOKING_STATUS_BADGE = {
  pending:   'badge-yellow',
  confirmed: 'badge-green',
  completed: 'badge-blue',
  cancelled: 'badge-red',
  no_show:   'badge-purple'
};

const BOOKING_RESOURCE_TYPE_LABEL = {
  nightly: 'Por noches',
  slot:    'Por turno'
};

const PROJECT_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#ea580c'];

const STORY_PRIORITY = {
  high:   { label: 'Alta',  badge: 'badge-red' },
  medium: { label: 'Media', badge: 'badge-yellow' },
  low:    { label: 'Baja',  badge: 'badge-gray' }
};

const STORY_STATUS = {
  backlog:    { label: 'Backlog',   badge: 'badge-gray' },
  'in-sprint': { label: 'En sprint', badge: 'badge-purple' },
  done:       { label: 'Hecho',     badge: 'badge-green' }
};

const SPRINT_STATUS = {
  planned:   { label: 'Planificado', badge: 'badge-gray' },
  active:    { label: 'Activo',      badge: 'badge-green' },
  completed: { label: 'Completado',  badge: 'badge-blue' }
};

const PRODUCTS_PER_PAGE = 15;
const BOOKING_RESOURCES_PER_PAGE = 15;
const BOOKINGS_PER_PAGE = 15;

// ── Accounting ───────────────────────────────────────────────────────────

const TIPO_CUENTA_LABEL = {
  ACTIVO: 'Activo', PASIVO: 'Pasivo', PATRIMONIO_NETO: 'Patrimonio Neto', INGRESO: 'Ingreso', EGRESO: 'Egreso'
};

// La naturaleza no se elige a mano: la determina el tipo de cuenta (mismo
// criterio que el server en cuentas-contables.service.ts). Activo y Egreso son
// deudoras; Pasivo, PN e Ingreso, acreedoras.
const NATURALEZA_POR_TIPO = {
  ACTIVO: 'DEUDORA', EGRESO: 'DEUDORA', PASIVO: 'ACREEDORA', PATRIMONIO_NETO: 'ACREEDORA', INGRESO: 'ACREEDORA'
};
const NATURALEZA_LABEL = { DEUDORA: 'Deudora', ACREEDORA: 'Acreedora' };

const ESTADO_ABIERTO_BADGE = { abierto: 'badge-green', cerrado: 'badge-gray' };

const ASIENTO_ESTADO_BADGE = { borrador: 'badge-yellow', confirmado: 'badge-green', anulado: 'badge-red' };
const ASIENTO_ESTADO_LABEL = { borrador: 'Borrador', confirmado: 'Confirmado', anulado: 'Anulado' };

const ASIENTOS_PER_PAGE = 20;
