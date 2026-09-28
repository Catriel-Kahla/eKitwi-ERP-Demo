/**
 * mocks.js
 * DEV_MODE fixtures — let the whole front (sidebar, Commerce, Inventory,
 * create/edit/delete) be reviewed without a reachable backend. Mutated in
 * place by the data layer (data.js) so writes "stick" for the session.
 * Only used when window.EKITWI_DEV_MODE is true — see constants/apiConfig.js.
 *
 * Public demo fork: trimmed to a single suit with all 7 modules enabled, so
 * pages/suitselection.html auto-selects it (its own "1 suit → skip the
 * picker" rule) and every visitor lands straight on a fully-populated
 * dashboard — see assets/js/demo-autologin.js for the rest of the flow.
 */

'use strict';

const MOCK_SUITS = [
  { id: 'mock-3', name: 'eKitwi Demo', slug: 'ekitwi-demo', website: 'https://ekitwi.com', isActive: true, systems: ['commerce', 'ecommerce', 'inventory', 'booking', 'scrum', 'contable', 'bi', 'gallery'] }
];

// Mismo shape que GET /modules (ver API/src/modules-catalog) — mantené esto
// en sync con el seed real (API/prisma/seed.ts) si cambia el catálogo.
const MOCK_MODULES_CATALOG = [
  { key: 'commerce', name: 'Commerce', order: 1, features: [
    { key: 'pos', name: 'POS', panel: 'commerce', order: 1 },
    { key: 'orders', name: 'Pedidos/Ventas', panel: 'commerce', order: 2 },
    { key: 'cash_management', name: 'Gestión de Caja/s', panel: 'commerce', order: 3 },
  ] },
  { key: 'ecommerce', name: 'eCommerce', order: 2, features: [
    { key: 'storefront', name: 'Ver sitio web', panel: null, order: 1 },
    { key: 'orders', name: 'Pedidos/Ventas', panel: 'commerce', order: 2 },
  ] },
  { key: 'inventory', name: 'Inventory', order: 3, features: [
    { key: 'products', name: 'Productos', panel: 'inventory', order: 1 },
    { key: 'suppliers', name: 'Proveedores', panel: 'inventory', order: 3 },
    { key: 'branches', name: 'Sucursales', panel: 'inventory', order: 4 },
  ] },
  { key: 'booking', name: 'Bookings', order: 4, features: [
    { key: 'bookings', name: 'Bookings', panel: 'booking', order: 1 },
  ] },
  { key: 'scrum', name: 'Projects', order: 5, features: [
    { key: 'projects', name: 'Projects', panel: 'projects', order: 1 },
  ] },
  { key: 'contable', name: 'Accounting', order: 6, features: [
    { key: 'accounting', name: 'Accounting', panel: 'accounting', order: 1 },
  ] },
  { key: 'bi', name: 'BI', order: 7, features: [
    { key: 'bi_dashboard', name: 'BI', panel: 'bi', order: 1 },
  ] },
  { key: 'gallery', name: 'Gallery', order: 8, features: [
    { key: 'gallery_obras', name: 'Obras', panel: 'gallery', order: 1 },
    { key: 'storefront', name: 'Ver sitio web', panel: null, order: 2 },
  ] },
];

const MOCK_CATEGORIES = [
  { id: 'mock-c1', name: 'Electrónica', slug: 'electronica', _count: { products: 2 },
    discountPercent: 15, isFeaturedInCarousel: true, carouselOrder: 0 },
  { id: 'mock-c2', name: 'Accesorios',  slug: 'accesorios',  _count: { products: 1 },
    discountPercent: null, isFeaturedInCarousel: false, carouselOrder: 0 }
];

const MOCK_SUPPLIERS = [
  { id: 'mock-sup1', name: 'Distribuidora del Sur', contactName: 'Juan Pérez', phone: '+54 11 4444-5555', email: 'ventas@distribuidora.com', taxId: '30-12345678-9', address: null, notes: null, isActive: true, _count: { products: 1 } },
  { id: 'mock-sup2', name: 'Import Tech SRL',        contactName: null,        phone: null,               email: null,                        taxId: null,          address: null, notes: null, isActive: true, _count: { products: 0 } }
];

const MOCK_BRANCHES = [
  { id: 'mock-branch1', name: 'Sucursal Centro', address: 'Av. Siempre Viva 123', phone: '+54 11 1111-2222', managerName: 'María López', isActive: true },
  { id: 'mock-branch2', name: 'Sucursal Norte',  address: null,                   phone: null,               managerName: null,          isActive: true }
];

// Keyed by productId -> { branchId: stock } — el "pool sin sucursal" sigue
// siendo MOCK_PRODUCTS[].stock, esto es solo el desglose adicional.
const MOCK_PRODUCT_BRANCH_STOCK = {
  'mock-p1': { 'mock-branch1': 5, 'mock-branch2': 3 }
};

const MOCK_PURCHASE_ORDERS = [
  { id: 'mock-po1', status: 'draft', notes: null,
    supplier: { id: 'mock-sup1', name: 'Distribuidora del Sur' }, branch: null,
    createdBy: { id: 'mock-user', email: 'dev@ekitwi.com' }, sentBy: null,
    createdAt: new Date().toISOString(),
    items: [{ id: 'mock-poi1', productId: 'mock-p1', productName: 'Auriculares Pro', quantity: 20, unitCost: 9000, quantityReceived: 0 }] },
  { id: 'mock-po2', status: 'sent', notes: 'Urgente para reposición',
    supplier: { id: 'mock-sup2', name: 'Import Tech SRL' }, branch: { id: 'mock-branch1', name: 'Sucursal Centro' },
    createdBy: { id: 'mock-user', email: 'dev@ekitwi.com' }, sentBy: { id: 'mock-user', email: 'dev@ekitwi.com' },
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    items: [{ id: 'mock-poi2', productId: 'mock-p2', productName: 'Mouse inalámbrico', quantity: 15, unitCost: 4200, quantityReceived: 5 }] }
];

const MOCK_PAYMENT_METHODS = [
  { id: 'mock-pm1', key: 'efectivo', label: 'Efectivo', markupPercent: 0, order: 1, isActive: true },
  { id: 'mock-pm2', key: 'tarjeta', label: 'Tarjeta', markupPercent: 8, order: 2, isActive: true },
  { id: 'mock-pm3', key: 'transferencia', label: 'Transferencia', markupPercent: 0, order: 3, isActive: true },
  { id: 'mock-pm4', key: 'otro', label: 'Otro', markupPercent: 0, order: 4, isActive: true }
];

const MOCK_CASH_REGISTERS = [
  { id: 'mock-reg1', name: 'Caja 1', branchId: 'mock-branch1', branch: { id: 'mock-branch1', name: 'Sucursal Centro' }, isActive: true },
  { id: 'mock-reg2', name: 'Caja Mostrador', branchId: null, branch: null, isActive: true }
];

const MOCK_CASH_SESSIONS = [
  {
    id: 'mock-sess1', cashRegisterId: 'mock-reg2', status: 'abierta',
    initialAmount: 5000, expectedAmount: null, finalAmount: null, difference: null,
    openedBy: { email: 'dev@ekitwi.com' }, openedAt: new Date().toISOString(),
    closedBy: null, closedAt: null,
    cashRegister: { id: 'mock-reg2', name: 'Caja Mostrador' },
    movements: [
      { id: 'mock-mov1', type: 'egreso', amount: 800, description: 'Pago a proveedor', createdBy: { email: 'dev@ekitwi.com' }, createdAt: new Date().toISOString() }
    ]
  }
];

const MOCK_PRODUCTS = [
  { id: 'mock-p1', name: 'Auriculares Pro',   sku: 'AUD-001', scanId: '7791234560001', categoryId: 'mock-c1', category: { id: 'mock-c1', name: 'Electrónica' }, supplierId: 'mock-sup1', supplier: { id: 'mock-sup1', name: 'Distribuidora del Sur' }, stock: 12, minStock: 5, price: 15999, isActive: true },
  { id: 'mock-p2', name: 'Mouse inalámbrico', sku: 'MOU-014', scanId: '7791234560002', categoryId: 'mock-c1', category: { id: 'mock-c1', name: 'Electrónica' }, supplierId: null,        supplier: null,                                                stock: 2,  minStock: 5, price: 6999,  isActive: true },
  { id: 'mock-p3', name: 'Teclado mecánico',  sku: 'TEC-022', scanId: '7791234560003', categoryId: 'mock-c2', category: { id: 'mock-c2', name: 'Accesorios' },  supplierId: null,        supplier: null,                                                stock: 0,  minStock: 3, price: 21999, isActive: false }
];

// Keyed by productId, mirrors the real API's shape (nested under a product).
const MOCK_PRICES = {
  'mock-p1': [{ id: 'mock-pr1', name: 'Mayorista', price: 12999 }]
};

// Keyed by productId, mirrors StProductImage's shape — vacío hasta que se
// suba algo desde el modal de producto en dev mode.
const MOCK_PRODUCT_IMAGES = {};

// Keyed by suitId — mirrors the real table's shape (one row per suit).
const MOCK_DOLAR_PRICE = {
  'mock-3': { dolarPrice: 1250.5, updatedAt: new Date().toISOString() }
};

// Todos operational por defecto — cambiar `status` a 'maintenance' acá para
// probar la pantalla de bloqueo de un panel en dev mode.
const MOCK_SYSTEM_STATUS = [
  { module: 'identity',   status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false },
  { module: 'commerce',   status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false },
  { module: 'inventory',  status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false },
  { module: 'booking',    status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false },
  { module: 'projects',   status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false },
  { module: 'accounting', status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false },
  { module: 'bi',         status: 'operational', title: null, message: null, estimatedEnd: null, allowAdminAccess: false }
];

const MOCK_ORDERS = [
  { id: 1, date: new Date().toISOString(), type: 'pedido', user: { email: 'cliente@demo.com' },
    items: [{ productId: 'mock-p1', productName: 'Auriculares Pro', unitPrice: 15999, quantity: 1, subtotal: 15999 }] },
  { id: 2, date: new Date(Date.now() - 86400000).toISOString(), type: 'venta', guestName: 'Juan Pérez',
    sale: { items: [{ productId: 'mock-p2', productName: 'Mouse inalámbrico', unitPrice: 6999, quantity: 1, subtotal: 6999 }] } },
  { id: 3, date: new Date(Date.now() - 2 * 86400000).toISOString(), type: 'devolucion', user: { email: 'otro@demo.com' },
    sale: { items: [{ productId: 'mock-p1', productName: 'Auriculares Pro', unitPrice: 15999, quantity: 1, subtotal: 15999 },
                     { productId: 'mock-p2', productName: 'Mouse inalámbrico', unitPrice: 6999, quantity: 1, subtotal: 6999 }] } }
];

const MOCK_BOOKING_RESOURCES = [
  { id: 'mock-bkr1', name: 'Habitación Doble Deluxe', description: 'Vista al mar, cama queen, hasta 2 huéspedes', type: 'nightly', capacity: 3, basePrice: 45000, slotDurationMinutes: null, dailyStartTime: null, dailyEndTime: null, isActive: true },
  { id: 'mock-bkr2', name: 'Corte de pelo', description: 'Turno de peluquería', type: 'slot', capacity: 1, basePrice: 8000, slotDurationMinutes: 60, dailyStartTime: '09:00', dailyEndTime: '18:00', isActive: true }
];

// Keyed by resourceId, mirrors MOCK_PRICES' per-product shape.
const MOCK_CLOSURES = {};

// ── Projects (SCRUM + Ideas + Plans) ─────────────────────────────────────
// Suit-scoped en el backend real (ver data.js) — en dev mode no hay
// multi-suit real, así que estos mocks no filtran por suitId.

const MOCK_PROJECTS = [
  { id: 'mock-proj1', name: 'Rediseño eCommerce', description: 'Nueva UI de la tienda online', color: '#7c3aed',
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(), _count: { stories: 3, sprints: 2 } }
];

const MOCK_STORIES = [
  { id: 'mock-st1', projectId: 'mock-proj1', title: 'Como cliente quiero filtrar productos por categoría, para encontrar lo que busco más rápido.', priority: 'high', points: 5, status: 'in-sprint', order: 0, assignedToId: null, assignedTo: null, createdAt: new Date(Date.now() - 18 * 86400000).toISOString() },
  { id: 'mock-st2', projectId: 'mock-proj1', title: 'Como cliente quiero guardar productos favoritos, para volver a verlos después.', priority: 'medium', points: 3, status: 'in-sprint', order: 1, assignedToId: null, assignedTo: null, createdAt: new Date(Date.now() - 18 * 86400000).toISOString() },
  { id: 'mock-st3', projectId: 'mock-proj1', title: 'Como admin quiero exportar el catálogo a CSV, para compartirlo con contabilidad.', priority: 'low', points: 2, status: 'backlog', order: 2, assignedToId: null, assignedTo: null, createdAt: new Date(Date.now() - 15 * 86400000).toISOString() }
];

const MOCK_IDEAS = [
  { id: 'mock-idea1', title: 'Modo oscuro para el ERP', notes: 'Varios usuarios lo pidieron en Incidencias', tags: 'ux,erp', status: 'new', createdAt: new Date(Date.now() - 5 * 86400000).toISOString() }
];

const MOCK_PLANS = [
  { id: 'mock-plan1', objective: 'Migrar a Prisma 8 en el próximo trimestre', notes: 'Coordinar con Accounting por las migraciones pendientes', targetDate: new Date(Date.now() + 60 * 86400000).toISOString(), status: 'draft', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() }
];

const MOCK_SPRINTS = [
  { id: 'mock-sp1', projectId: 'mock-proj1', name: 'Sprint 1', goal: 'Filtros y favoritos', status: 'active',
    startDate: new Date(Date.now() - 3 * 86400000).toISOString(), endDate: new Date(Date.now() + 10 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(), completedAt: null },
  { id: 'mock-sp2', projectId: 'mock-proj1', name: 'Sprint 0', goal: 'Setup inicial del proyecto', status: 'completed',
    startDate: new Date(Date.now() - 25 * 86400000).toISOString(), endDate: new Date(Date.now() - 14 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 26 * 86400000).toISOString(), completedAt: new Date(Date.now() - 14 * 86400000).toISOString() }
];

// Sin joinear (título/prioridad/puntos) — data.js las joinea desde
// MOCK_STORIES al leer, igual que sprint-stories.service.ts en el backend real.
const MOCK_SPRINT_STORIES = [
  { sprintId: 'mock-sp1', storyId: 'mock-st1', boardStatus: 'in-progress', addedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
  { sprintId: 'mock-sp1', storyId: 'mock-st2', boardStatus: 'todo', addedAt: new Date(Date.now() - 3 * 86400000).toISOString() }
];

const MOCK_BOOKINGS = [
  {
    id: 'mock-bk1',
    resourceId: 'mock-bkr1',
    resource: { id: 'mock-bkr1', name: 'Habitación Doble Deluxe', type: 'nightly' },
    customerName: 'Juana Pérez',
    customerPhone: '+54 9 11 5555-5555',
    startAt: new Date(Date.now() + 86400000).toISOString(),
    endAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    quantity: 1,
    totalPrice: 90000,
    status: 'pending'
  }
];

// ── Accounting (Contable) ─────────────────────────────────────────────────
// Plan de cuentas con 3 niveles (raíz de agrupamiento → sub-agrupamiento →
// cuenta imputable), un ejercicio abierto (con un período cerrado y uno
// abierto) y uno cerrado, dos centros de costo, y tres asientos que cubren
// los tres estados (anulado / confirmado / borrador).

const MOCK_CUENTAS = [
  { id: 'mock-cta-1',    codigo: '1',       nombre: 'Activo',                     tipo: 'ACTIVO',    naturaleza: 'DEUDORA',   parentId: null,           imputable: false, activa: true },
  { id: 'mock-cta-11',   codigo: '1.1',     nombre: 'Activo Corriente',           tipo: 'ACTIVO',    naturaleza: 'DEUDORA',   parentId: 'mock-cta-1',   imputable: false, activa: true },
  { id: 'mock-cta-1101', codigo: '1.1.01',  nombre: 'Caja',                       tipo: 'ACTIVO',    naturaleza: 'DEUDORA',   parentId: 'mock-cta-11',  imputable: true,  activa: true, esEfectivo: true },
  { id: 'mock-cta-1102', codigo: '1.1.02',  nombre: 'Banco Cuenta Corriente',     tipo: 'ACTIVO',    naturaleza: 'DEUDORA',   parentId: 'mock-cta-11',  imputable: true,  activa: true, esEfectivo: true },
  { id: 'mock-cta-2',    codigo: '2',       nombre: 'Pasivo',                     tipo: 'PASIVO',    naturaleza: 'ACREEDORA', parentId: null,           imputable: false, activa: true },
  { id: 'mock-cta-21',   codigo: '2.1',     nombre: 'Pasivo Corriente',           tipo: 'PASIVO',    naturaleza: 'ACREEDORA', parentId: 'mock-cta-2',   imputable: false, activa: true },
  { id: 'mock-cta-2101', codigo: '2.1.01',  nombre: 'Proveedores',                tipo: 'PASIVO',    naturaleza: 'ACREEDORA', parentId: 'mock-cta-21',  imputable: true,  activa: true },
  { id: 'mock-cta-4',    codigo: '4',       nombre: 'Ingresos',                   tipo: 'INGRESO',   naturaleza: 'ACREEDORA', parentId: null,           imputable: false, activa: true },
  { id: 'mock-cta-4101', codigo: '4.1.01',  nombre: 'Ventas de servicios',        tipo: 'INGRESO',   naturaleza: 'ACREEDORA', parentId: 'mock-cta-4',   imputable: true,  activa: true },
  { id: 'mock-cta-5',    codigo: '5',       nombre: 'Egresos',                    tipo: 'EGRESO',    naturaleza: 'DEUDORA',   parentId: null,           imputable: false, activa: true },
  { id: 'mock-cta-5101', codigo: '5.1.01',  nombre: 'Alquiler',                   tipo: 'EGRESO',    naturaleza: 'DEUDORA',   parentId: 'mock-cta-5',   imputable: true,  activa: true },
  { id: 'mock-cta-5102', codigo: '5.1.02',  nombre: 'Sueldos',                    tipo: 'EGRESO',    naturaleza: 'DEUDORA',   parentId: 'mock-cta-5',   imputable: true,  activa: true }
];

const MOCK_EJERCICIOS = [
  { id: 'mock-ej-2026', nombre: 'Ejercicio 2026', fechaInicio: '2026-01-01', fechaFin: '2026-12-31', estado: 'abierto' },
  { id: 'mock-ej-2025', nombre: 'Ejercicio 2025', fechaInicio: '2025-01-01', fechaFin: '2025-12-31', estado: 'cerrado' }
];

// Keyed by ejercicioId — carga perezosa en la app real, pero en dev mode ya
// están todos precargados para simplificar.
const MOCK_PERIODOS = {
  'mock-ej-2026': [
    { id: 'mock-per-2026-07', ejercicioId: 'mock-ej-2026', nombre: 'Julio 2026',  fechaInicio: '2026-07-01', fechaFin: '2026-07-31', estado: 'cerrado' },
    { id: 'mock-per-2026-08', ejercicioId: 'mock-ej-2026', nombre: 'Agosto 2026', fechaInicio: '2026-08-01', fechaFin: '2026-08-31', estado: 'abierto' }
  ],
  'mock-ej-2025': [
    { id: 'mock-per-2025-12', ejercicioId: 'mock-ej-2025', nombre: 'Diciembre 2025', fechaInicio: '2025-12-01', fechaFin: '2025-12-31', estado: 'cerrado' }
  ]
};

const MOCK_CENTROS = [
  { id: 'mock-cco-adm', codigo: 'ADM', nombre: 'Administración', activo: true },
  { id: 'mock-cco-com', codigo: 'COM', nombre: 'Comercial',      activo: true }
];

const cuentaById = id => MOCK_CUENTAS.find(c => c.id === id);
const centroById = id => MOCK_CENTROS.find(c => c.id === id) || null;

const MOCK_ASIENTOS = [
  {
    id: 'mock-as-1', ejercicioId: 'mock-ej-2026', periodoId: 'mock-per-2026-07', numero: 1,
    fecha: '2026-07-10', descripcion: 'Venta de servicios', comprobante: 'FC A 0001-00000015', estado: 'anulado',
    confirmadoAt: '2026-07-10T15:00:00.000Z', anuladoAt: '2026-08-01T10:00:00.000Z',
    detalles: [
      { cuentaId: 'mock-cta-1101', centroCostoId: null,             debe: 80000, haber: 0,     descripcion: null, orden: 0, cuenta: cuentaById('mock-cta-1101'), centroCosto: null },
      { cuentaId: 'mock-cta-4101', centroCostoId: 'mock-cco-com',    debe: 0,     haber: 80000, descripcion: null, orden: 1, cuenta: cuentaById('mock-cta-4101'), centroCosto: centroById('mock-cco-com') }
    ]
  },
  {
    id: 'mock-as-2', ejercicioId: 'mock-ej-2026', periodoId: 'mock-per-2026-08', numero: 2,
    fecha: '2026-08-05', descripcion: 'Pago de alquiler agosto', comprobante: 'REC 0042', estado: 'confirmado',
    confirmadoAt: '2026-08-05T18:00:00.000Z', anuladoAt: null,
    detalles: [
      { cuentaId: 'mock-cta-5101', centroCostoId: 'mock-cco-adm',   debe: 150000, haber: 0,      descripcion: null, orden: 0, cuenta: cuentaById('mock-cta-5101'), centroCosto: centroById('mock-cco-adm') },
      { cuentaId: 'mock-cta-1101', centroCostoId: null,             debe: 0,      haber: 150000, descripcion: null, orden: 1, cuenta: cuentaById('mock-cta-1101'), centroCosto: null }
    ]
  },
  {
    id: 'mock-as-3', ejercicioId: 'mock-ej-2026', periodoId: 'mock-per-2026-08', numero: 3,
    fecha: '2026-08-07', descripcion: 'Sueldos agosto (a pagar)', estado: 'borrador',
    confirmadoAt: null, anuladoAt: null,
    detalles: [
      { cuentaId: 'mock-cta-5102', centroCostoId: 'mock-cco-adm',   debe: 300000, haber: 0,      descripcion: null, orden: 0, cuenta: cuentaById('mock-cta-5102'), centroCosto: centroById('mock-cco-adm') },
      { cuentaId: 'mock-cta-1102', centroCostoId: null,             debe: 0,      haber: 300000, descripcion: null, orden: 1, cuenta: cuentaById('mock-cta-1102'), centroCosto: null }
    ]
  }
];
