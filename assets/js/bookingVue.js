/**
 * bookingVue.js
 * Vue del panel "Bookings". Mismo rol que booking.js (que queda en el repo
 * sin cargarse — script tag removido de dashboard.html — de referencia/
 * rollback): expone loadBookingPanel (llamado desde dashboard.js) e
 * initBookingEvents (no-op acá, @click/@input en el template reemplazan
 * los listeners manuales de esa función).
 *
 * Home (KPIs) + dos sub-vistas con paginación (Recursos, Reservas) + tres
 * modales (Recurso, Cierres por recurso, Nueva reserva con chequeo de
 * disponibilidad en vivo, debounced 300ms igual que antes). Sin
 * dependencias cruzadas con otro panel (a diferencia de Galería/Historias),
 * así que no hay nada raro con el orden de montaje.
 */

'use strict';

// Paginación reusada por Recursos y Reservas — misma matemática de "…" que
// tenían renderBkResourcesPagination/renderBkgPagination en booking.js.
const Pagination = {
  props: { total: Number, page: Number, perPage: Number, labelSingular: String, labelPlural: String },
  emits: ['change'],
  computed: {
    pages() { return Math.max(1, Math.ceil(this.total / this.perPage)); },
    totalLabel() { return `${this.total} ${this.total === 1 ? this.labelSingular : this.labelPlural}`; },
    items() {
      const items = [];
      for (let p = 1; p <= this.pages; p++) {
        if (p === 1 || p === this.pages || Math.abs(p - this.page) <= 1) items.push({ type: 'page', n: p });
        else if (Math.abs(p - this.page) === 2) items.push({ type: 'ellipsis', n: p });
      }
      return items;
    },
  },
  template: `
    <div class="pagination">
      <span v-if="total" class="page-info">{{ totalLabel }}</span>
      <template v-if="pages > 1">
        <button class="page-btn" :disabled="page <= 1" @click="$emit('change', page - 1)">‹</button>
        <template v-for="it in items" :key="it.type + it.n">
          <span v-if="it.type === 'ellipsis'" class="page-ellipsis">…</span>
          <button v-else :class="['page-btn', { active: it.n === page }]" @click="$emit('change', it.n)">{{ it.n }}</button>
        </template>
        <button class="page-btn" :disabled="page >= pages" @click="$emit('change', page + 1)">›</button>
      </template>
    </div>`,
};

const BookingApp = {
  components: { Pagination },
  data() {
    return {
      suitId: null,
      currentView: 'home',
      kpis: { status: 'idle', data: [], error: null },

      resFilters: { search: '', type: '' },
      resources: { status: 'idle', data: [], total: 0, page: 1, error: null },

      bkgFilters: { search: '', status: '' },
      bookings: { status: 'idle', data: [], total: 0, page: 1, error: null },

      resourceModal: {
        open: false, editId: null, name: '', desc: '', type: 'nightly',
        capacity: 1, price: '', slotDuration: '', dailyStart: '', dailyEnd: '', active: true, saving: false,
      },

      closuresModal: {
        open: false, resourceId: null, resourceName: '', startDate: '', endDate: '', reason: '',
        list: { status: 'idle', data: [], error: null }, adding: false,
      },

      bookingModal: {
        open: false, resourceId: '', resources: [], resourcesStatus: 'idle',
        checkin: '', checkout: '', slotDate: '', slotTime: '', quantity: 1,
        customerName: '', customerPhone: '', notes: '', saving: false,
        availability: { status: 'idle', text: '', cls: '', ok: false },
      },
    };
  },
  computed: {
    selectedBookingResource() {
      return this.bookingModal.resources.find(r => r.id === this.bookingModal.resourceId) || null;
    },
    isSlotSelected() { return this.selectedBookingResource?.type === 'slot'; },
  },
  methods: {
    ekCan,
    fmtMoney,
    resourceTypeLabel(t) { return BOOKING_RESOURCE_TYPE_LABEL[t] || t; },

    // Entry point público — lo llama loadBookingPanel() más abajo.
    async setSuit(suitId, suitName) {
      this.suitId = suitId;
      const labelEl = document.getElementById('booking-suit-label');
      if (labelEl) labelEl.textContent = `Reservas de ${suitName}`;
      this.currentView = 'home';
      await this.refreshHome();
    },

    async refreshHome() {
      if (!this.suitId) return;
      this.kpis = { status: 'loading', data: [], error: null };
      try {
        const [resourcesRes, bookingsRes] = await Promise.all([
          listBookingResources(this.suitId, { isActive: true, take: 100 }),
          listBookings(this.suitId, { take: 100 }),
        ]);
        const pending = bookingsRes.data.filter(b => b.status === 'pending').length;
        const todayStr = new Date().toDateString();
        const today = bookingsRes.data.filter(b => new Date(b.startAt).toDateString() === todayStr).length;

        this.kpis = {
          status: 'ok',
          error: null,
          data: [
            { label: 'Recursos activos', value: resourcesRes.pagination.total },
            { label: 'Reservas pendientes', value: pending },
            { label: 'Reservas de hoy', value: today },
          ],
          resourcesCount: `${resourcesRes.pagination.total} recurso${resourcesRes.pagination.total === 1 ? '' : 's'}`,
          pendingLabel: pending ? `${pending} pendiente${pending === 1 ? '' : 's'} de confirmación` : 'Sin pendientes',
        };
      } catch (err) {
        this.kpis = { status: 'error', data: [], error: err.message || 'error' };
      }
    },

    // ── Recursos ───────────────────────────────────────────────────────
    enterResources() { this.currentView = 'resources'; this.fetchResources(1); },
    backToHome() { this.currentView = 'home'; this.refreshHome(); },
    onResSearchInput() {
      clearTimeout(this._resSearchTimer);
      this._resSearchTimer = setTimeout(() => this.fetchResources(1), 300);
    },
    async fetchResources(page) {
      if (!this.suitId) return;
      this.resources = { status: 'loading', data: [], total: this.resources.total, page, error: null };
      try {
        const res = await listBookingResources(this.suitId, {
          search: this.resFilters.search.trim(), type: this.resFilters.type,
          skip: (page - 1) * BOOKING_RESOURCES_PER_PAGE, take: BOOKING_RESOURCES_PER_PAGE,
        });
        this.resources = { status: 'ok', data: res.data, total: res.pagination.total, page, error: null };
      } catch (err) {
        this.resources = { status: 'error', data: [], total: 0, page, error: err.message || 'error' };
      }
    },

    openResourceModal(resource) {
      this.resourceModal = {
        open: true, editId: resource?.id || null,
        name: resource?.name || '', desc: resource?.description || '',
        type: resource?.type || 'nightly',
        capacity: resource?.capacity ?? 1,
        price: resource?.basePrice ?? '',
        slotDuration: resource?.slotDurationMinutes ?? '',
        dailyStart: resource?.dailyStartTime || '',
        dailyEnd: resource?.dailyEndTime || '',
        active: resource?.isActive ?? true,
        saving: false,
      };
    },
    closeResourceModal() { this.resourceModal.open = false; },
    async saveResource() {
      const m = this.resourceModal;
      const name = m.name.trim();
      const basePrice = parseFloat(m.price);

      if (!name) { showToast('El nombre es obligatorio', 'err'); return; }
      if (!m.editId && (isNaN(basePrice) || basePrice <= 0)) { showToast('El precio base es obligatorio', 'err'); return; }
      if (m.type === 'slot' && !m.slotDuration) {
        showToast('La duración del turno es obligatoria para recursos por turno', 'err');
        return;
      }

      const dto = {
        name,
        description: m.desc.trim() || undefined,
        type: m.editId ? undefined : m.type,
        capacity: parseInt(m.capacity, 10) || 1,
        basePrice: isNaN(basePrice) ? undefined : basePrice,
        slotDurationMinutes: m.type === 'slot' ? (parseInt(m.slotDuration, 10) || undefined) : undefined,
        dailyStartTime: m.type === 'slot' ? (m.dailyStart || undefined) : undefined,
        dailyEndTime: m.type === 'slot' ? (m.dailyEnd || undefined) : undefined,
        isActive: m.active,
      };

      m.saving = true;
      try {
        if (m.editId) {
          await updateBookingResource(this.suitId, m.editId, dto);
          showToast('Recurso actualizado');
        } else {
          await createBookingResource(this.suitId, dto);
          showToast('Recurso creado');
        }
        this.closeResourceModal();
        this.fetchResources(m.editId ? this.resources.page : 1);
        this.refreshHome();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el recurso', 'err');
      } finally {
        m.saving = false;
      }
    },
    deleteResource(r) {
      openConfirmModal({
        message: '¿Eliminar este recurso? Esta acción no se puede deshacer.',
        onConfirm: async () => {
          try {
            await deleteBookingResource(this.suitId, r.id);
            showToast('Recurso eliminado');
            this.fetchResources(this.resources.page);
            this.refreshHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el recurso', 'err');
          }
        },
      });
    },

    // ── Cierres (por recurso) ──────────────────────────────────────────
    openClosuresModal(resource) {
      this.closuresModal = {
        open: true, resourceId: resource.id, resourceName: resource.name,
        startDate: '', endDate: '', reason: '', adding: false,
        list: { status: 'idle', data: [], error: null },
      };
      this.fetchClosures();
    },
    closeClosuresModal() { this.closuresModal.open = false; },
    async fetchClosures() {
      this.closuresModal.list = { status: 'loading', data: [], error: null };
      try {
        const data = await listClosures(this.suitId, this.closuresModal.resourceId);
        this.closuresModal.list = { status: 'ok', data, error: null };
      } catch (err) {
        this.closuresModal.list = { status: 'error', data: [], error: err.message || 'error' };
      }
    },
    async addClosure() {
      const m = this.closuresModal;
      if (!m.startDate || !m.endDate) { showToast('Elegí un rango de fechas', 'err'); return; }

      const dto = {
        startAt: new Date(`${m.startDate}T00:00:00`).toISOString(),
        endAt: new Date(`${m.endDate}T23:59:59`).toISOString(),
        reason: m.reason.trim() || undefined,
      };

      m.adding = true;
      try {
        await createClosure(this.suitId, m.resourceId, dto);
        showToast('Cierre agregado');
        m.startDate = ''; m.endDate = ''; m.reason = '';
        await this.fetchClosures();
      } catch (err) {
        showToast(err.message || 'No se pudo agregar el cierre', 'err');
      } finally {
        m.adding = false;
      }
    },
    deleteClosureRow(c) {
      openConfirmModal({
        message: '¿Eliminar este cierre?',
        onConfirm: async () => {
          try {
            await deleteClosure(this.suitId, this.closuresModal.resourceId, c.id);
            showToast('Cierre eliminado');
            this.fetchClosures();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el cierre', 'err');
          }
        },
      });
    },

    // ── Reservas ───────────────────────────────────────────────────────
    enterReservas() { this.currentView = 'reservas'; this.fetchBookings(1); },
    onBkgSearchInput() {
      clearTimeout(this._bkgSearchTimer);
      this._bkgSearchTimer = setTimeout(() => this.fetchBookings(1), 300);
    },
    async fetchBookings(page) {
      if (!this.suitId) return;
      this.bookings = { status: 'loading', data: [], total: this.bookings.total, page, error: null };
      try {
        const res = await listBookings(this.suitId, {
          search: this.bkgFilters.search.trim(), status: this.bkgFilters.status,
          skip: (page - 1) * BOOKINGS_PER_PAGE, take: BOOKINGS_PER_PAGE,
        });
        this.bookings = { status: 'ok', data: res.data, total: res.pagination.total, page, error: null };
      } catch (err) {
        this.bookings = { status: 'error', data: [], total: 0, page, error: err.message || 'error' };
      }
    },
    bookingDates(b) {
      return `${new Date(b.startAt).toLocaleString('es-AR')} – ${new Date(b.endAt).toLocaleString('es-AR')}`;
    },
    statusBadgeClass(status) { return BOOKING_STATUS_BADGE[status] || 'badge-gray'; },
    // Cancelar/no-show liberan la capacidad de inmediato — la disponibilidad
    // se recalcula excluyendo esos dos estados, sin un flag de "reingreso"
    // (no hay stock que reponer, a diferencia de una devolución de StOrder).
    async runBkgAction(bookingId, action) {
      try {
        await updateBookingStatus(this.suitId, bookingId, action);
        showToast('Reserva actualizada');
        this.fetchBookings(this.bookings.page);
        this.refreshHome();
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar la reserva', 'err');
      }
    },
    confirmCancel(b) { openConfirmModal({ message: '¿Cancelar esta reserva?', onConfirm: () => this.runBkgAction(b.id, 'cancel') }); },
    confirmNoShow(b) { openConfirmModal({ message: '¿Marcar esta reserva como no-show?', onConfirm: () => this.runBkgAction(b.id, 'no_show') }); },

    // ── Nueva reserva (con chequeo de disponibilidad en vivo) ──────────
    async openBookingModal() {
      this.bookingModal = {
        open: true, resourceId: '', resources: [], resourcesStatus: 'loading',
        checkin: '', checkout: '', slotDate: '', slotTime: '', quantity: 1,
        customerName: '', customerPhone: '', notes: '', saving: false,
        availability: { status: 'idle', text: '', cls: '', ok: false },
      };
      try {
        const res = await listBookingResources(this.suitId, { isActive: true, take: 100 });
        this.bookingModal.resources = res.data;
        this.bookingModal.resourcesStatus = 'ok';
      } catch (err) {
        this.bookingModal.resourcesStatus = 'error';
        showToast(err.message || 'No se pudieron cargar los recursos', 'err');
      }
    },
    closeBookingModal() { this.bookingModal.open = false; },
    onBookingResourceChange() { this.scheduleAvailabilityCheck(); },
    computeBookingDates() {
      const resource = this.selectedBookingResource;
      if (!resource) return null;
      const m = this.bookingModal;

      if (resource.type === 'nightly') {
        if (!m.checkin || !m.checkout) return null;
        return { startAt: new Date(`${m.checkin}T00:00:00`).toISOString(), endAt: new Date(`${m.checkout}T00:00:00`).toISOString() };
      }
      if (!m.slotDate || !m.slotTime || !resource.slotDurationMinutes) return null;
      const startAt = new Date(`${m.slotDate}T${m.slotTime}:00`);
      const endAt = new Date(startAt.getTime() + resource.slotDurationMinutes * 60000);
      return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
    },
    scheduleAvailabilityCheck() {
      clearTimeout(this._availTimer);
      this.bookingModal.availability = { status: 'idle', text: '', cls: '', ok: false };
      this._availTimer = setTimeout(() => this.runAvailabilityCheck(), 300);
    },
    async runAvailabilityCheck() {
      const resource = this.selectedBookingResource;
      const quantity = parseInt(this.bookingModal.quantity, 10) || 1;
      const dates = this.computeBookingDates();

      if (!resource || !dates) {
        this.bookingModal.availability = { status: 'idle', text: '', cls: '', ok: false };
        return;
      }

      this.bookingModal.availability = { status: 'checking', text: 'Verificando disponibilidad…', cls: '', ok: false };
      try {
        const availability = await checkAvailability(this.suitId, resource.id, dates.startAt, dates.endAt, quantity);
        if (availability.available) {
          this.bookingModal.availability = { status: 'ok', text: `Disponible ✓ (quedan ${availability.remaining})`, cls: 'pos', ok: true };
        } else {
          const reasonText = {
            closed: 'el recurso está cerrado en esas fechas',
            capacity: 'no hay disponibilidad para esa cantidad',
            inactive: 'el recurso no está activo',
          }[availability.reason] || 'no disponible';
          this.bookingModal.availability = { status: 'ok', text: `No disponible ✗ (${reasonText})`, cls: 'neg', ok: false };
        }
      } catch (err) {
        this.bookingModal.availability = { status: 'error', text: err.message || 'No se pudo verificar la disponibilidad', cls: 'neg', ok: false };
      }
    },
    async saveBooking() {
      const m = this.bookingModal;
      if (!m.availability.ok) { showToast('Verificá la disponibilidad antes de reservar', 'err'); return; }

      const resource = this.selectedBookingResource;
      const dates = this.computeBookingDates();
      const customerName = m.customerName.trim();
      if (!resource || !dates) { showToast('Completá el recurso y las fechas', 'err'); return; }
      if (!customerName) { showToast('El nombre del cliente es obligatorio', 'err'); return; }

      const dto = {
        resourceId: resource.id,
        customerName,
        customerPhone: m.customerPhone.trim() || undefined,
        startAt: dates.startAt,
        endAt: dates.endAt,
        quantity: parseInt(m.quantity, 10) || 1,
        notes: m.notes.trim() || undefined,
      };

      m.saving = true;
      try {
        await createBooking(this.suitId, dto);
        showToast('Reserva creada');
        this.closeBookingModal();
        this.fetchBookings(1);
        this.refreshHome();
      } catch (err) {
        showToast(err.message || 'No se pudo crear la reserva', 'err');
      } finally {
        m.saving = false;
      }
    },
  },
  template: `
    <!-- Home: KPIs + entry cards -->
    <div v-if="currentView === 'home'">
      <div class="kpis">
        <p v-if="kpis.status === 'error'" class="crm-muted">No se pudo cargar el resumen ({{ kpis.error }}).</p>
        <template v-else>
          <div class="kpi-card" v-for="k in kpis.data" :key="k.label">
            <div class="kpi-label">{{ k.label }}</div>
            <div class="kpi-value">{{ k.value }}</div>
          </div>
        </template>
      </div>
      <div class="module-nav-grid">
        <button class="module-nav-card" @click="enterResources">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="module-nav-title">Recursos</div>
          <div class="module-nav-desc">{{ kpis.resourcesCount || '—' }}</div>
        </button>
        <button class="module-nav-card" @click="enterReservas">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
          </div>
          <div class="module-nav-title">Reservas</div>
          <div class="module-nav-desc">{{ kpis.pendingLabel || '—' }}</div>
        </button>
      </div>
    </div>

    <!-- Recursos sub-view -->
    <div v-else-if="currentView === 'resources'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <input type="text" v-model="resFilters.search" @input="onResSearchInput" placeholder="Buscar por nombre…" />
          <select v-model="resFilters.type" @change="fetchResources(1)">
            <option value="">Todos los tipos</option>
            <option value="nightly">Por noches</option>
            <option value="slot">Por turno</option>
          </select>
          <button v-if="ekCan('bookings', 'create')" class="primary-btn" @click="openResourceModal(null)">+ Nuevo recurso</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="resources.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="resources.status === 'error'" class="crm-muted">No se pudieron cargar los recursos ({{ resources.error }}).</p>
          <p v-else-if="!resources.data.length" class="crm-muted">Sin recursos para este filtro.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Capacidad</th><th>Precio base</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in resources.data" :key="r.id">
                <td>{{ r.name }}</td>
                <td class="crm-muted">{{ resourceTypeLabel(r.type) }}</td>
                <td>{{ r.capacity }}</td>
                <td>{{ fmtMoney(Number(r.basePrice)) }}</td>
                <td>
                  <span v-if="r.isActive" class="crm-badge badge-green">Activo</span>
                  <span v-else class="crm-badge badge-gray">Inactivo</span>
                </td>
                <td class="td-actions">
                  <span class="crm-action-btn" title="Cierres" @click="openClosuresModal(r)">📅</span>
                  <span v-if="ekCan('bookings', 'write')" class="crm-action-btn" title="Editar" @click="openResourceModal(r)">✎</span>
                  <span v-if="ekCan('bookings', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="deleteResource(r)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <pagination :total="resources.total" :page="resources.page" :per-page="15"
          label-singular="recurso" label-plural="recursos" @change="fetchResources" />
      </div>
    </div>

    <!-- Reservas sub-view -->
    <div v-else-if="currentView === 'reservas'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <input type="text" v-model="bkgFilters.search" @input="onBkgSearchInput" placeholder="Buscar por cliente…" />
          <select v-model="bkgFilters.status" @change="fetchBookings(1)">
            <option value="">Todos los estados</option>
            <option value="pending">Pendientes</option>
            <option value="confirmed">Confirmadas</option>
            <option value="completed">Completadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="no_show">No-show</option>
          </select>
          <button v-if="ekCan('bookings', 'create')" class="primary-btn" @click="openBookingModal">+ Nueva reserva</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="bookings.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="bookings.status === 'error'" class="crm-muted">No se pudieron cargar las reservas ({{ bookings.error }}).</p>
          <p v-else-if="!bookings.data.length" class="crm-muted">Sin reservas para este filtro.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Recurso</th><th>Cliente</th><th>Fechas</th><th>Cant.</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              <tr v-for="b in bookings.data" :key="b.id">
                <td>{{ (b.resource && b.resource.name) || '—' }}</td>
                <td>{{ b.customerName }}</td>
                <td class="crm-muted">{{ bookingDates(b) }}</td>
                <td>{{ b.quantity }}</td>
                <td>{{ fmtMoney(Number(b.totalPrice)) }}</td>
                <td><span class="crm-badge" :class="statusBadgeClass(b.status)">{{ b.status }}</span></td>
                <td class="td-actions">
                  <template v-if="ekCan('bookings', 'write')">
                    <template v-if="b.status === 'pending'">
                      <button class="ghost-btn" @click="runBkgAction(b.id, 'confirm')">Confirmar</button>
                      <button class="ghost-btn btn-danger" @click="confirmCancel(b)">Cancelar</button>
                    </template>
                    <template v-else-if="b.status === 'confirmed'">
                      <button class="ghost-btn" @click="runBkgAction(b.id, 'complete')">Completar</button>
                      <button class="ghost-btn btn-danger" @click="confirmNoShow(b)">No-show</button>
                      <button class="ghost-btn btn-danger" @click="confirmCancel(b)">Cancelar</button>
                    </template>
                    <span v-else class="crm-muted">—</span>
                  </template>
                  <span v-else class="crm-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <pagination :total="bookings.total" :page="bookings.page" :per-page="15"
          label-singular="reserva" label-plural="reservas" @change="fetchBookings" />
      </div>
    </div>

    <!-- ── Modal: Recurso ─────────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: resourceModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ resourceModal.editId ? 'Editar recurso' : 'Nuevo recurso' }}</span>
          <span class="crm-modal-close" @click="closeResourceModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label crm-label-full">
            Nombre
            <input type="text" v-model="resourceModal.name" placeholder="Ej: Habitación Doble Deluxe" />
          </label>
          <label class="crm-label crm-label-full">
            Descripción
            <textarea v-model="resourceModal.desc" rows="2" placeholder="Descripción del recurso…"></textarea>
          </label>
          <div class="crm-form-row">
            <label class="crm-label">
              Tipo
              <!-- No editable una vez creado: moverse de tipo rompe el motor
                   de disponibilidad ya validado contra ese recurso. -->
              <select v-model="resourceModal.type" :disabled="!!resourceModal.editId">
                <option value="nightly">Por noches (alojamiento)</option>
                <option value="slot">Por turno (horario)</option>
              </select>
            </label>
            <label class="crm-label">
              Capacidad
              <input type="number" v-model="resourceModal.capacity" placeholder="1" min="1" />
            </label>
          </div>
          <div class="crm-form-row">
            <label class="crm-label">
              Precio base
              <input type="number" v-model="resourceModal.price" placeholder="0.00" min="0" step="0.01" />
            </label>
          </div>
          <div class="crm-form-row" v-if="resourceModal.type === 'slot'">
            <label class="crm-label">
              Duración del turno (min)
              <input type="number" v-model="resourceModal.slotDuration" placeholder="60" min="5" />
            </label>
            <label class="crm-label">
              Apertura
              <input type="time" v-model="resourceModal.dailyStart" />
            </label>
            <label class="crm-label">
              Cierre
              <input type="time" v-model="resourceModal.dailyEnd" />
            </label>
          </div>
          <label class="crm-label-check">
            <input type="checkbox" v-model="resourceModal.active" />
            Activo
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeResourceModal">Cancelar</button>
          <button class="primary-btn" :disabled="resourceModal.saving" @click="saveResource">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Cierres de un recurso ─────────────────────── -->
    <div class="crm-overlay" :class="{ open: closuresModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">Cierres — {{ closuresModal.resourceName }}</span>
          <span class="crm-modal-close" @click="closeClosuresModal">✕</span>
        </div>
        <div class="crm-form-group">
          <div class="crm-form-row">
            <label class="crm-label">
              Desde
              <input type="date" v-model="closuresModal.startDate" />
            </label>
            <label class="crm-label">
              Hasta
              <input type="date" v-model="closuresModal.endDate" />
            </label>
          </div>
          <label class="crm-label crm-label-full">
            Motivo
            <input type="text" v-model="closuresModal.reason" placeholder="Ej: Mantenimiento programado" />
          </label>
          <button class="ghost-btn" :disabled="closuresModal.adding" @click="addClosure">+ Agregar cierre</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="closuresModal.list.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="closuresModal.list.status === 'error'" class="crm-muted">No se pudieron cargar los cierres ({{ closuresModal.list.error }}).</p>
          <p v-else-if="!closuresModal.list.data.length" class="crm-muted">Sin cierres cargados.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr></thead>
            <tbody>
              <tr v-for="c in closuresModal.list.data" :key="c.id">
                <td>{{ new Date(c.startAt).toLocaleDateString('es-AR') }}</td>
                <td>{{ new Date(c.endAt).toLocaleDateString('es-AR') }}</td>
                <td class="crm-muted">{{ c.reason || '—' }}</td>
                <td class="td-actions">
                  <span class="crm-action-btn btn-del" title="Eliminar" @click="deleteClosureRow(c)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeClosuresModal">Cerrar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Nueva reserva ──────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: bookingModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">Nueva reserva</span>
          <span class="crm-modal-close" @click="closeBookingModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label crm-label-full">
            Recurso
            <select v-model="bookingModal.resourceId" @change="onBookingResourceChange">
              <option value="" disabled>{{ bookingModal.resourcesStatus === 'loading' ? 'Cargando…' : (bookingModal.resourcesStatus === 'error' ? 'No se pudieron cargar los recursos' : 'Seleccioná un recurso…') }}</option>
              <option v-for="r in bookingModal.resources" :key="r.id" :value="r.id">{{ r.name }} ({{ resourceTypeLabel(r.type) }})</option>
            </select>
          </label>
          <div class="crm-form-row" v-if="!isSlotSelected">
            <label class="crm-label">
              Check-in
              <input type="date" v-model="bookingModal.checkin" @input="scheduleAvailabilityCheck" />
            </label>
            <label class="crm-label">
              Check-out
              <input type="date" v-model="bookingModal.checkout" @input="scheduleAvailabilityCheck" />
            </label>
          </div>
          <div class="crm-form-row" v-else>
            <label class="crm-label">
              Fecha
              <input type="date" v-model="bookingModal.slotDate" @input="scheduleAvailabilityCheck" />
            </label>
            <label class="crm-label">
              Hora
              <input type="time" v-model="bookingModal.slotTime" @input="scheduleAvailabilityCheck" />
            </label>
          </div>
          <div class="crm-form-row">
            <label class="crm-label">
              Cantidad
              <input type="number" v-model="bookingModal.quantity" @input="scheduleAvailabilityCheck" min="1" />
            </label>
          </div>
          <!-- crm-muted usa !important sobre color, así que "pos"/"neg" van
               solas (sin combinar con crm-muted) para que su color se vea. -->
          <p :class="bookingModal.availability.cls || 'crm-muted'">{{ bookingModal.availability.text }}</p>
          <div class="crm-form-row">
            <label class="crm-label">
              Cliente
              <input type="text" v-model="bookingModal.customerName" placeholder="Nombre y apellido" />
            </label>
            <label class="crm-label">
              Teléfono
              <input type="text" v-model="bookingModal.customerPhone" placeholder="Opcional" />
            </label>
          </div>
          <label class="crm-label crm-label-full">
            Notas
            <textarea v-model="bookingModal.notes" rows="2" placeholder="Opcional"></textarea>
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeBookingModal">Cancelar</button>
          <button class="primary-btn" :disabled="!bookingModal.availability.ok || bookingModal.saving" @click="saveBooking">Reservar</button>
        </div>
      </div>
    </div>`,
};

// ── Entry point (misma firma que booking.js) ──────────────────────────────

let bookingVueInstance = null;

function loadBookingPanel(suitId, suitName) {
  if (!bookingVueInstance) {
    const mountEl = document.getElementById('booking-app');
    if (!mountEl) return;
    bookingVueInstance = Vue.createApp(BookingApp).mount(mountEl);
  }
  bookingVueInstance.setSuit(suitId, suitName);
}

// @click/@input en el template reemplazan estos listeners — se deja vacía
// (no un no-op silencioso: dashboard.js la sigue llamando en el bootstrap)
// para no tener que tocar esa lista de initXEvents().
function initBookingEvents() {}
