/**
 * team.js
 * Pestaña "Equipo" (solo visible para el owner del suit, ver renderAppsMenu
 * en shared-ui.js): invitar usuarios eKitwi existentes con un rol, y definir
 * esos roles como una matriz de permisos por sección × acción. Ver
 * API/src/suit-roles y API/src/suit-members (migración
 * 38_add_suit_members_permissions).
 *
 * Entry point loadTeamPanel(suitId, suitName), llamado desde dashboard.js.
 */

'use strict';

// section key (ver API/src/suit-roles/suit-sections.ts) → etiqueta visible,
// mismo nombre que la pestaña del aside (FEATURE_META, shared-ui.js).
const TEAM_SECTION_LABEL = {
  products:        'Productos',
  suppliers:        'Proveedores',
  branches:         'Sucursales',
  cash_management:  'Caja',
  orders:           'Pedidos / Ventas',
  bookings:         'Reservas',
  accounting:       'Contabilidad',
  projects:         'Projects'
};
const TEAM_SECTIONS = Object.keys(TEAM_SECTION_LABEL);
const TEAM_ACTIONS = [
  { key: 'canRead',   label: 'Leer' },
  { key: 'canCreate', label: 'Crear' },
  { key: 'canWrite',  label: 'Editar' },
  { key: 'canDelete', label: 'Eliminar' }
];

let currentTeamSuit = null;
let teamRoles = [];
let teamMembers = [];
let editingRoleId = null;

async function loadTeamPanel(suitId, suitName) {
  currentTeamSuit = { id: suitId, name: suitName };
  document.getElementById('team-suit-label').textContent = `Quién tiene acceso al ERP de ${suitName} y con qué permisos.`;
  await Promise.all([fetchTeamRoles(), fetchTeamMembers()]);
}

async function fetchTeamRoles() {
  const wrap = document.getElementById('team-roles-wrap');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    teamRoles = await listSuitRoles(currentTeamSuit.id);
    renderTeamRoles();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los roles (${esc(err.message)}).</p>`;
  }
}

async function fetchTeamMembers() {
  const wrap = document.getElementById('team-members-wrap');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    teamMembers = await listSuitMembers(currentTeamSuit.id);
    renderTeamMembers();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los miembros (${esc(err.message)}).</p>`;
  }
}

// ── Roles ────────────────────────────────────────────────────────────────

function renderTeamRoles() {
  const wrap = document.getElementById('team-roles-wrap');
  if (!teamRoles.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no creaste ningún rol.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Rol</th><th>Descripción</th><th>Secciones</th><th>Miembros</th><th></th></tr></thead>
      <tbody>${teamRoles.map(r => {
        const sections = (r.permissions || []).filter(p => p.canRead || p.canCreate || p.canWrite || p.canDelete);
        return `
        <tr>
          <td>${esc(r.name)}</td>
          <td class="crm-muted">${esc(r.description || '—')}</td>
          <td class="crm-muted">${sections.length ? sections.map(p => esc(TEAM_SECTION_LABEL[p.section] || p.section)).join(', ') : '—'}</td>
          <td class="crm-muted">${r._count?.members ?? 0}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-edit-role="${r.id}" title="Editar">✎</span>
            <span class="crm-action-btn btn-del" data-del-role="${r.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

function roleMatrixHtml(permissionsBySection = {}) {
  return `
    <div class="crm-table-wrap">
      <table class="crm-table">
        <thead><tr><th>Sección</th>${TEAM_ACTIONS.map(a => `<th>${a.label}</th>`).join('')}</tr></thead>
        <tbody>${TEAM_SECTIONS.map(section => `
          <tr>
            <td>${esc(TEAM_SECTION_LABEL[section])}</td>
            ${TEAM_ACTIONS.map(a => `
              <td><input type="checkbox" data-perm-section="${section}" data-perm-action="${a.key}"
                ${permissionsBySection[section]?.[a.key] ? 'checked' : ''} /></td>
            `).join('')}
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function readRoleMatrixFromForm() {
  const permissions = {};
  document.querySelectorAll('#role-matrix-wrap input[type="checkbox"]').forEach(cb => {
    const section = cb.dataset.permSection;
    permissions[section] = permissions[section] || {};
    permissions[section][cb.dataset.permAction] = cb.checked;
  });
  return permissions;
}

function openRoleModal(roleId) {
  editingRoleId = roleId || null;
  const role = roleId ? teamRoles.find(r => r.id === roleId) : null;

  document.getElementById('modal-role-title').textContent = role ? 'Editar rol' : 'Nuevo rol';
  document.getElementById('role-name').value = role?.name || '';
  document.getElementById('role-description').value = role?.description || '';

  const permissionsBySection = Object.fromEntries((role?.permissions || []).map(p => [p.section, p]));
  document.getElementById('role-matrix-wrap').innerHTML = roleMatrixHtml(permissionsBySection);

  document.getElementById('modal-role').classList.add('open');
}

function closeRoleModal() {
  document.getElementById('modal-role').classList.remove('open');
  editingRoleId = null;
}

async function saveRole() {
  const name = document.getElementById('role-name').value.trim();
  if (name.length < 2) { showToast('El nombre del rol debe tener al menos 2 caracteres', 'err'); return; }

  const dto = {
    name,
    description: document.getElementById('role-description').value.trim(),
    permissions: readRoleMatrixFromForm()
  };

  const btn = document.getElementById('modal-role-save');
  btn.disabled = true;
  try {
    if (editingRoleId) {
      await updateSuitRole(currentTeamSuit.id, editingRoleId, dto);
      showToast('Rol actualizado');
    } else {
      await createSuitRole(currentTeamSuit.id, dto);
      showToast('Rol creado');
    }
    closeRoleModal();
    fetchTeamRoles();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el rol', 'err');
  } finally {
    btn.disabled = false;
  }
}

// ── Miembros ─────────────────────────────────────────────────────────────

function renderTeamMembers() {
  const wrap = document.getElementById('team-members-wrap');
  if (!teamMembers.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no invitaste a nadie a este suit.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Persona</th><th>Email</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
      <tbody>${teamMembers.map(m => `
        <tr>
          <td>${esc([m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || '—')}</td>
          <td class="crm-muted">${esc(m.user.email)}</td>
          <td class="crm-muted">${esc(m.role?.name || '—')}</td>
          <td>${m.isActive ? '<span class="crm-badge badge-green">Activo</span>' : '<span class="crm-badge badge-gray">Desactivado</span>'}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-toggle-member="${m.user.id}" data-active="${m.isActive}" title="${m.isActive ? 'Desactivar' : 'Reactivar'}">${m.isActive ? '⏸' : '▶'}</span>
            <span class="crm-action-btn btn-del" data-del-member="${m.user.id}" title="Quitar del equipo">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function openMemberModal() {
  document.getElementById('member-email').value = '';
  const select = document.getElementById('member-role');
  if (!teamRoles.length) {
    select.innerHTML = '<option value="">Creá un rol primero</option>';
  } else {
    select.innerHTML = teamRoles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  }
  document.getElementById('modal-member').classList.add('open');
}

function closeMemberModal() {
  document.getElementById('modal-member').classList.remove('open');
}

async function saveMember() {
  const email = document.getElementById('member-email').value.trim().toLowerCase();
  const suitRoleId = document.getElementById('member-role').value;
  if (!email) { showToast('Ingresá el email de la persona a invitar', 'err'); return; }
  if (!suitRoleId) { showToast('Elegí un rol para esta persona', 'err'); return; }

  const btn = document.getElementById('modal-member-save');
  btn.disabled = true;
  try {
    await createSuitMember(currentTeamSuit.id, { email, suitRoleId });
    showToast('Invitación enviada');
    closeMemberModal();
    fetchTeamMembers();
  } catch (err) {
    showToast(err.message || 'No se pudo agregar a esa persona', 'err');
  } finally {
    btn.disabled = false;
  }
}

// ── Eventos ──────────────────────────────────────────────────────────────

function initTeamEvents() {
  document.getElementById('btn-add-role')?.addEventListener('click', () => openRoleModal(null));
  document.getElementById('modal-role-close')?.addEventListener('click', closeRoleModal);
  document.getElementById('modal-role-cancel')?.addEventListener('click', closeRoleModal);
  document.getElementById('modal-role-save')?.addEventListener('click', saveRole);

  document.getElementById('btn-add-member')?.addEventListener('click', openMemberModal);
  document.getElementById('modal-member-close')?.addEventListener('click', closeMemberModal);
  document.getElementById('modal-member-cancel')?.addEventListener('click', closeMemberModal);
  document.getElementById('modal-member-save')?.addEventListener('click', saveMember);

  document.getElementById('team-roles-wrap')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-role]');
    const delBtn  = e.target.closest('[data-del-role]');
    if (editBtn) openRoleModal(editBtn.dataset.editRole);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este rol? Solo se puede si no tiene miembros asignados.',
        onConfirm: async () => {
          try {
            await deleteSuitRole(currentTeamSuit.id, delBtn.dataset.delRole);
            showToast('Rol eliminado');
            fetchTeamRoles();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el rol', 'err');
          }
        }
      });
    }
  });

  document.getElementById('team-members-wrap')?.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-toggle-member]');
    const delBtn     = e.target.closest('[data-del-member]');
    if (toggleBtn) {
      const isActive = toggleBtn.dataset.active === 'true';
      updateSuitMember(currentTeamSuit.id, toggleBtn.dataset.toggleMember, { isActive: !isActive })
        .then(() => { showToast(isActive ? 'Miembro desactivado' : 'Miembro reactivado'); fetchTeamMembers(); })
        .catch(err => showToast(err.message || 'No se pudo actualizar', 'err'));
    }
    if (delBtn) {
      openConfirmModal({
        message: '¿Quitar a esta persona del equipo? Pierde el acceso al ERP de este suit.',
        onConfirm: async () => {
          try {
            await deleteSuitMember(currentTeamSuit.id, delBtn.dataset.delMember);
            showToast('Miembro eliminado del equipo');
            fetchTeamMembers();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar', 'err');
          }
        }
      });
    }
  });
}
