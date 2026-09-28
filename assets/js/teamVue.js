/**
 * teamVue.js
 * Vue de la pestaña "Equipo". Mismo rol que team.js (que queda en el repo
 * sin cargarse — script tag removido de dashboard.html — de referencia/
 * rollback): expone loadTeamPanel (llamado desde dashboard.js) e
 * initTeamEvents (no-op acá, @click en el template reemplaza los listeners
 * manuales de esa función).
 *
 * Roles (matriz de permisos por sección × acción) y miembros invitados —
 * mismos calls a data.js que team.js (listSuitRoles/listSuitMembers/
 * createSuitRole/etc.). Los modales (#modal-role/#modal-member antes,
 * ahora parte del template de acá) reusan el mismo toggle .crm-overlay/.open
 * que ya usa el resto de la app (openConfirmModal de shared-ui.js incluido,
 * para las confirmaciones de borrado — no se reimplementa ese modal).
 */

'use strict';

// section key (ver API/src/suit-roles/suit-sections.ts) → etiqueta visible,
// mismo nombre que la pestaña del aside (FEATURE_META, shared-ui.js).
const TEAM_SECTION_LABEL = {
  products:        'Productos',
  suppliers:        'Proveedores',
  branches:         'Sucursales',
  purchase_orders:  'Pedidos a Proveedores',
  receiving:        'Recepción de mercadería',
  cash_management:  'Caja',
  orders:           'Pedidos / Ventas',
  bookings:         'Reservas',
  accounting:       'Contabilidad',
  projects:         'Projects',
};
const TEAM_SECTIONS = Object.keys(TEAM_SECTION_LABEL);
// Crear/Editar/Eliminar tienen 3 estados: 'no' | 'ask' (Preguntar: queda como
// solicitud para el admin) | 'yes'. Se mapean a canX/askX al guardar.
const TEAM_ACTIONS = [
  { key: 'canRead',   ask: null,        label: 'Leer' },
  { key: 'canCreate', ask: 'askCreate', label: 'Crear' },
  { key: 'canWrite',  ask: 'askWrite',  label: 'Editar' },
  { key: 'canDelete', ask: 'askDelete', label: 'Eliminar' },
];

function emptyMatrix() {
  return Object.fromEntries(TEAM_SECTIONS.map(s => [s, { canRead: false, canCreate: 'no', canWrite: 'no', canDelete: 'no' }]));
}
const triState = (can, ask) => can ? 'yes' : ask ? 'ask' : 'no';
function matrixToDto(matrix) {
  const out = {};
  for (const [s, m] of Object.entries(matrix)) {
    out[s] = { canRead: !!m.canRead };
    for (const a of TEAM_ACTIONS.filter(x => x.ask)) {
      out[s][a.key] = m[a.key] === 'yes';
      out[s][a.ask] = m[a.key] === 'ask';
      // Cualquier acción habilitada implica Leer: sin lectura la pestaña
      // ni aparece en el aside del miembro (ver suitModuleButtons).
      if (m[a.key] !== 'no') out[s].canRead = true;
    }
  }
  return out;
}

const TeamApp = {
  data() {
    return {
      suitId: null,
      sections: TEAM_SECTIONS,
      actions: TEAM_ACTIONS,
      roles:   { status: 'loading', data: [], error: null },
      members: { status: 'loading', data: [], error: null },
      approvals: { status: 'loading', data: [], error: null, busyId: null },
      pollTimer: null,
      roleModal:   { open: false, editingId: null, name: '', description: '', matrix: emptyMatrix(), saving: false },
      memberModal: { open: false, email: '', roleId: '', saving: false },
    };
  },
  methods: {
    esc, // {{ }} ya escapa solo — se deja disponible por si hace falta en algún atributo crudo.
    sectionLabel(s) { return TEAM_SECTION_LABEL[s] || s; },
    sectionsOf(role) {
      const perms = (role.permissions || []).filter(p => p.canRead || p.canCreate || p.canWrite || p.canDelete || p.askCreate || p.askWrite || p.askDelete);
      return perms.length ? perms.map(p => this.sectionLabel(p.section)).join(', ') : '—';
    },
    memberName(m) { return [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || '—'; },

    // Entry point público — lo llama loadTeamPanel() más abajo, cada vez que
    // se entra a la pestaña (initGlobalNav() en dashboard.js).
    setSuit(suitId, suitName) {
      this.suitId = suitId;
      const labelEl = document.getElementById('team-suit-label');
      if (labelEl) labelEl.textContent = `Quién tiene acceso al ERP de ${suitName} y con qué permisos.`;
      this.fetchRoles();
      this.fetchMembers();
      this.fetchApprovals();
      // Aviso de solicitudes nuevas: refresca la bandeja mientras la app está montada.
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => { if (!document.hidden) this.fetchApprovals(true); }, 30000);
    },

    async fetchApprovals(silent) {
      if (!silent) this.approvals = { status: 'loading', data: [], error: null, busyId: null };
      try {
        const data = await listApprovals(this.suitId);
        const prev = this.approvals.data.filter(a => a.status === 'pending').length;
        const pending = data.filter(a => a.status === 'pending').length;
        this.approvals = { status: 'ok', data, error: null, busyId: this.approvals.busyId };
        if (silent && pending > prev) showToast(`Tenés ${pending} solicitud${pending === 1 ? '' : 'es'} pendiente${pending === 1 ? '' : 's'} en Equipo`);
      } catch (err) {
        if (!silent) this.approvals = { status: 'error', data: [], error: err.message || 'error', busyId: null };
      }
    },
    pendingApprovals() { return this.approvals.data.filter(a => a.status === 'pending'); },
    requesterName(a) { return [a.requester.firstName, a.requester.lastName].filter(Boolean).join(' ') || a.requester.email; },
    actionLabel(a) { return { create: 'Crear', write: 'Editar', delete: 'Eliminar' }[a.action] || a.action; },
    async resolveApproval(a, approve) {
      this.approvals.busyId = a.id;
      try {
        await (approve ? approveApproval(this.suitId, a.id) : rejectApproval(this.suitId, a.id));
        showToast(approve ? 'Solicitud aprobada y ejecutada' : 'Solicitud rechazada');
      } catch (err) {
        showToast(err.message || 'No se pudo resolver la solicitud', 'err');
      }
      this.approvals.busyId = null;
      this.fetchApprovals(true);
    },

    async fetchRoles() {
      this.roles = { status: 'loading', data: [], error: null };
      try {
        const data = await listSuitRoles(this.suitId);
        this.roles = { status: 'ok', data, error: null };
      } catch (err) {
        this.roles = { status: 'error', data: [], error: err.message || 'error' };
      }
    },
    async fetchMembers() {
      this.members = { status: 'loading', data: [], error: null };
      try {
        const data = await listSuitMembers(this.suitId);
        this.members = { status: 'ok', data, error: null };
      } catch (err) {
        this.members = { status: 'error', data: [], error: err.message || 'error' };
      }
    },

    // ── Roles ──────────────────────────────────────────────────────────
    openRoleModal(role) {
      const matrix = emptyMatrix();
      (role?.permissions || []).forEach(p => {
        if (matrix[p.section]) matrix[p.section] = {
          canRead: !!p.canRead,
          canCreate: triState(p.canCreate, p.askCreate),
          canWrite: triState(p.canWrite, p.askWrite),
          canDelete: triState(p.canDelete, p.askDelete),
        };
      });
      this.roleModal = { open: true, editingId: role?.id || null, name: role?.name || '', description: role?.description || '', matrix, saving: false };
    },
    closeRoleModal() { this.roleModal.open = false; },
    async saveRole() {
      const name = this.roleModal.name.trim();
      if (name.length < 2) { showToast('El nombre del rol debe tener al menos 2 caracteres', 'err'); return; }

      const dto = { name, description: this.roleModal.description.trim(), permissions: matrixToDto(this.roleModal.matrix) };
      this.roleModal.saving = true;
      try {
        if (this.roleModal.editingId) {
          await updateSuitRole(this.suitId, this.roleModal.editingId, dto);
          showToast('Rol actualizado');
        } else {
          await createSuitRole(this.suitId, dto);
          showToast('Rol creado');
        }
        this.closeRoleModal();
        this.fetchRoles();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el rol', 'err');
      } finally {
        this.roleModal.saving = false;
      }
    },
    deleteRole(role) {
      openConfirmModal({
        message: '¿Eliminar este rol? Solo se puede si no tiene miembros asignados.',
        onConfirm: async () => {
          try {
            await deleteSuitRole(this.suitId, role.id);
            showToast('Rol eliminado');
            this.fetchRoles();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el rol', 'err');
          }
        },
      });
    },

    // ── Miembros ───────────────────────────────────────────────────────
    openMemberModal() {
      this.memberModal = { open: true, email: '', roleId: '', saving: false };
    },
    closeMemberModal() { this.memberModal.open = false; },
    async saveMember() {
      const email = this.memberModal.email.trim().toLowerCase();
      const suitRoleId = this.memberModal.roleId;
      if (!email) { showToast('Ingresá el email de la persona a invitar', 'err'); return; }
      if (!suitRoleId) { showToast('Elegí un rol para esta persona', 'err'); return; }

      this.memberModal.saving = true;
      try {
        await createSuitMember(this.suitId, { email, suitRoleId });
        showToast('Invitación enviada');
        this.closeMemberModal();
        this.fetchMembers();
      } catch (err) {
        showToast(err.message || 'No se pudo agregar a esa persona', 'err');
      } finally {
        this.memberModal.saving = false;
      }
    },
    toggleMember(m) {
      const isActive = m.isActive;
      updateSuitMember(this.suitId, m.user.id, { isActive: !isActive })
        .then(() => { showToast(isActive ? 'Miembro desactivado' : 'Miembro reactivado'); this.fetchMembers(); })
        .catch(err => showToast(err.message || 'No se pudo actualizar', 'err'));
    },
    deleteMember(m) {
      openConfirmModal({
        message: '¿Quitar a esta persona del equipo? Pierde el acceso al ERP de este suit.',
        onConfirm: async () => {
          try {
            await deleteSuitMember(this.suitId, m.user.id);
            showToast('Miembro eliminado del equipo');
            this.fetchMembers();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar', 'err');
          }
        },
      });
    },
  },
  template: `
    <div class="card" v-if="approvals.status === 'ok' && approvals.data.length" style="margin-bottom:16px">
      <div class="crm-toolbar">
        <span class="crm-section-title">Solicitudes de aprobación</span>
        <span v-if="pendingApprovals().length" class="crm-badge badge-red">{{ pendingApprovals().length }} pendiente{{ pendingApprovals().length === 1 ? '' : 's' }}</span>
      </div>
      <div class="crm-table-wrap">
        <table class="crm-table">
          <thead><tr><th>Fecha</th><th>Persona</th><th>Sección</th><th>Acción</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in approvals.data" :key="a.id">
              <td class="crm-muted">{{ new Date(a.createdAt).toLocaleString('es-AR') }}</td>
              <td>{{ requesterName(a) }}</td>
              <td class="crm-muted">{{ sectionLabel(a.section) }}</td>
              <td class="crm-muted" :title="a.summary">{{ actionLabel(a) }} · {{ a.summary }}</td>
              <td>
                <span v-if="a.status === 'pending'" class="crm-badge badge-red">Pendiente</span>
                <span v-else-if="a.status === 'approved'" class="crm-badge badge-green">Aprobada</span>
                <span v-else-if="a.status === 'rejected'" class="crm-badge badge-gray">Rechazada</span>
                <span v-else class="crm-badge badge-gray" :title="a.resultNote">Falló</span>
              </td>
              <td class="td-actions">
                <template v-if="a.status === 'pending'">
                  <button class="primary-btn" :disabled="approvals.busyId === a.id" @click="resolveApproval(a, true)">Aceptar</button>
                  <button class="ghost-btn" :disabled="approvals.busyId === a.id" @click="resolveApproval(a, false)">Rechazar</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="crm-toolbar">
        <span class="crm-section-title">Roles</span>
        <button class="primary-btn" @click="openRoleModal(null)">+ Nuevo rol</button>
      </div>
      <div class="crm-table-wrap">
        <p v-if="roles.status === 'loading'" class="crm-muted">Cargando…</p>
        <p v-else-if="roles.status === 'error'" class="crm-muted">No se pudieron cargar los roles ({{ roles.error }}).</p>
        <p v-else-if="!roles.data.length" class="crm-muted">Todavía no creaste ningún rol.</p>
        <table v-else class="crm-table">
          <thead><tr><th>Rol</th><th>Descripción</th><th>Secciones</th><th>Miembros</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in roles.data" :key="r.id">
              <td>{{ r.name }}</td>
              <td class="crm-muted">{{ r.description || '—' }}</td>
              <td class="crm-muted">{{ sectionsOf(r) }}</td>
              <td class="crm-muted">{{ r._count?.members ?? 0 }}</td>
              <td class="td-actions">
                <span class="crm-action-btn" title="Editar" @click="openRoleModal(r)">✎</span>
                <span class="crm-action-btn btn-del" title="Eliminar" @click="deleteRole(r)">🗑</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="crm-toolbar">
        <span class="crm-section-title">Miembros</span>
        <button class="primary-btn" @click="openMemberModal">+ Invitar persona</button>
      </div>
      <div class="crm-table-wrap">
        <p v-if="members.status === 'loading'" class="crm-muted">Cargando…</p>
        <p v-else-if="members.status === 'error'" class="crm-muted">No se pudieron cargar los miembros ({{ members.error }}).</p>
        <p v-else-if="!members.data.length" class="crm-muted">Todavía no invitaste a nadie a este suit.</p>
        <table v-else class="crm-table">
          <thead><tr><th>Persona</th><th>Email</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in members.data" :key="m.user.id">
              <td>{{ memberName(m) }}</td>
              <td class="crm-muted">{{ m.user.email }}</td>
              <td class="crm-muted">{{ m.role?.name || '—' }}</td>
              <td>
                <span v-if="m.isActive" class="crm-badge badge-green">Activo</span>
                <span v-else class="crm-badge badge-gray">Desactivado</span>
              </td>
              <td class="td-actions">
                <span class="crm-action-btn" :title="m.isActive ? 'Desactivar' : 'Reactivar'" @click="toggleMember(m)">{{ m.isActive ? '⏸' : '▶' }}</span>
                <span class="crm-action-btn btn-del" title="Quitar del equipo" @click="deleteMember(m)">🗑</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Modal: Rol ─────────────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: roleModal.open }">
      <div class="crm-modal" style="max-width:760px">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ roleModal.editingId ? 'Editar rol' : 'Nuevo rol' }}</span>
          <span class="crm-modal-close" @click="closeRoleModal">✕</span>
        </div>
        <div class="crm-form-group">
          <div class="crm-form-row">
            <label class="crm-label crm-label-full">
              Nombre del rol
              <input type="text" v-model="roleModal.name" placeholder="Ej: Cajero" />
            </label>
          </div>
          <div class="crm-form-row">
            <label class="crm-label crm-label-full">
              Descripción
              <input type="text" v-model="roleModal.description" placeholder="Ej: Atiende el POS y cobra en caja" />
            </label>
          </div>
          <div class="crm-table-wrap">
            <table class="crm-table">
              <thead><tr><th>Sección</th><th v-for="a in actions" :key="a.key">{{ a.label }}</th></tr></thead>
              <tbody>
                <tr v-for="s in sections" :key="s">
                  <td>{{ sectionLabel(s) }}</td>
                  <td v-for="a in actions" :key="a.key">
                    <input v-if="!a.ask" type="checkbox" v-model="roleModal.matrix[s][a.key]" />
                    <select v-else v-model="roleModal.matrix[s][a.key]">
                      <option value="no">No</option>
                      <option value="ask">Preguntar</option>
                      <option value="yes">Sí</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeRoleModal">Cancelar</button>
          <button class="primary-btn" :disabled="roleModal.saving" @click="saveRole">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Invitar persona al equipo ─────────────────── -->
    <div class="crm-overlay" :class="{ open: memberModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">Invitar persona</span>
          <span class="crm-modal-close" @click="closeMemberModal">✕</span>
        </div>
        <div class="crm-form-group">
          <div class="crm-form-row">
            <label class="crm-label crm-label-full">
              Email
              <input type="email" v-model="memberModal.email" placeholder="Ej: trabajador@ejemplo.com" />
            </label>
          </div>
          <p class="crm-muted" style="margin:0 0 12px">Tiene que ser un email ya registrado en eKitwi.</p>
          <div class="crm-form-row">
            <label class="crm-label crm-label-full">
              Rol
              <select v-model="memberModal.roleId">
                <option value="" disabled>{{ roles.data.length ? 'Elegí un rol' : 'Creá un rol primero' }}</option>
                <option v-for="r in roles.data" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
            </label>
          </div>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeMemberModal">Cancelar</button>
          <button class="primary-btn" :disabled="memberModal.saving" @click="saveMember">Invitar</button>
        </div>
      </div>
    </div>`,
};

// ── Entry point (misma firma que team.js) ─────────────────────────────────

let teamVueInstance = null;

function loadTeamPanel(suitId, suitName) {
  if (!teamVueInstance) {
    const mountEl = document.getElementById('team-app');
    if (!mountEl) return;
    teamVueInstance = Vue.createApp(TeamApp).mount(mountEl);
  }
  teamVueInstance.setSuit(suitId, suitName);
}

// @click en el template reemplaza estos listeners — se deja vacía (no un
// no-op silencioso: dashboard.js la sigue llamando en el bootstrap) para no
// tener que tocar esa lista de initXEvents().
function initTeamEvents() {}
