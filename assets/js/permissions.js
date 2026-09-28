/**
 * permissions.js
 * Permisos del usuario actual sobre el suit activo — ver API/src/suit-members
 * (GET /suits/:suitId/members/me/permissions) y la migración 38_add_suit_members_
 * permissions. El owner (o SUPER_ADMIN) tiene acceso total implícito; un
 * eKitwi-usuario invitado como miembro del equipo tiene una matriz de
 * permisos por sección (mismo vocabulario que ek_features.key) y acción
 * (leer/crear/escribir/eliminar).
 *
 * enterSuit() (shared-ui.js) llama a loadCurrentSuitPermissions() al entrar
 * a un suit; el resto del ERP usa ekCan(section, action) para decidir qué
 * mostrar — sidebar (suitModuleButtons) y botones Nuevo/Editar/Eliminar de
 * cada panel. Es gating de UI nada más: la API vuelve a chequear todo esto
 * server-side (SuitPermissionGuard) así que un 403 ahí es la fuente de
 * verdad, esto solo evita mostrar acciones que van a fallar.
 *
 * Cargar antes de shared-ui.js (enterSuit vive ahí y ya lo asume).
 */

'use strict';

let currentSuitPermissions = { isOwner: true, sections: {} };

// Recibe el suit completo (no solo el id): `suit.myRole` ('OWNER'|'STAFF') ya
// viene de GET /suits (SuitsService.findAll, sin depender del endpoint nuevo
// /me/permissions) — si el usuario es owner de ESTE suit no hace falta
// llamar a nada más, total access implícito. Solo un miembro del equipo
// (myRole 'STAFF') necesita la matriz real. Esto evita que un suit que el
// usuario posee le desaparezca todo el aside si /me/permissions falla por
// cualquier motivo (deploy en curso, error transitorio, etc.) — antes ese
// catch caía a isOwner:false y tapaba las pestañas incluso al dueño.
async function loadCurrentSuitPermissions(suit) {
  if (window.EKITWI_DEV_MODE || suit.myRole !== 'STAFF') {
    // isAdmin() en dev mode siempre da SUPER_ADMIN (ver auth.js); myRole
    // ausente (suits viejos en caché) también se trata como owner, no como
    // "sin acceso" — mismo criterio.
    currentSuitPermissions = { isOwner: true, sections: {} };
    return currentSuitPermissions;
  }
  try {
    currentSuitPermissions = await apiGet(`/suits/${suit.id}/members/me/permissions`);
  } catch {
    // Acá sí conviene fallar cerrado: es un miembro del equipo, no el owner.
    currentSuitPermissions = { isOwner: false, sections: {} };
  }
  return currentSuitPermissions;
}

// section: mismo vocabulario que ek_features.key (products, suppliers,
// branches, cash_management, orders, bookings, accounting — ver
// API/src/suit-roles/suit-sections.ts). action: 'read'|'create'|'write'|'delete'.
function ekCan(section, action = 'read') {
  if (currentSuitPermissions.isOwner) return true;
  const perm = currentSuitPermissions.sections?.[section];
  if (!perm) return false;
  const field = { read: 'canRead', create: 'canCreate', write: 'canWrite', delete: 'canDelete' }[action];
  if (perm[field]) return true;
  // "Preguntar": se muestra el botón; la API deja la acción como solicitud.
  const ask = { create: 'askCreate', write: 'askWrite', delete: 'askDelete' }[action];
  return !!(ask && perm[ask]);
}

function isCurrentSuitOwner() {
  return !!currentSuitPermissions.isOwner;
}

// ══════════════════════════════════════════════════════
// Pulido de UX: ocultar (no solo bloquear en la API) los botones de
// crear/editar/eliminar que el usuario actual no puede usar. Cada panel
// llama a estos dos helpers después de armar su toolbar/tabla — ver
// commerce.js, inventory.js, booking.js, accounting.js, gallery.js.
// ══════════════════════════════════════════════════════

// Botón fijo de la toolbar ("+ Nuevo X"): lo oculta si no hay canCreate en
// esa sección. Llamar al entrar al panel/sub-vista, antes de que el usuario
// pueda tocarlo.
function gateCreateButton(btnId, section) {
  const btn = document.getElementById(btnId);
  if (btn) btn.hidden = !ekCan(section, 'create');
}

// Acciones por fila de una tabla ya renderizada (editar/eliminar/confirmar/
// anular/etc.) — se identifican por el prefijo del atributo data-* que ya
// usa cada uno para enganchar su click (no por clase, que varía: crm-action-
// btn, ghost-btn, ghost-btn btn-danger…). Llamar después de setear el
// innerHTML de cada tabla, antes de que el usuario pueda tocarla.
const ROW_ACTION_PREFIXES = [
  { re: /^data-edit-/,                                     action: 'write' },
  { re: /^data-(confirmar|anular|cerrar|reabrir)-/,        action: 'write' },
  { re: /^data-set-primary-/,                              action: 'write' },
  { re: /^data-add-/,                                      action: 'create' },
  { re: /^data-del(ete)?-/,                                action: 'delete' },
];
function gateRowActions(container, section) {
  if (!container) return;
  container.querySelectorAll('*').forEach((el) => {
    for (const { re, action } of ROW_ACTION_PREFIXES) {
      if (el.getAttributeNames().some((attr) => re.test(attr))) {
        if (!ekCan(section, action)) el.remove();
        break;
      }
    }
  });
}

// Pestaña del aside (ek_features.key, ver FEATURE_META en shared-ui.js) →
// sección de permisos (ek_suit_role_section_permissions.section, ver
// API/src/suit-roles/suit-sections.ts) que la controla. 'pos' comparte
// sección con 'orders' porque ambas features cuelgan del mismo
// OrdersController; 'gallery_obras' reusa ProductsController → 'products'.
// Sin entrada acá (dashboard, projects, bi_dashboard, storefront) = la
// pestaña no se gatea por sección (ver suitModuleButtons, shared-ui.js).
const FEATURE_SECTION = {
  pos:              'orders',
  orders:           'orders',
  cash_management:  'cash_management',
  products:         'products',
  suppliers:        'suppliers',
  branches:         'branches',
  purchase_orders:  'purchase_orders',
  bookings:         'bookings',
  accounting:       'accounting',
  projects:         'projects',
  gallery_obras:    'products'
};
