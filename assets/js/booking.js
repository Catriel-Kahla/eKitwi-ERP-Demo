/**
 * booking.js
 * Bookings panel: Home + two sub-views (Recursos, Reservas), same
 * home → sub-view → back pattern as inventory.js. Entry point is
 * loadBookingPanel(suitId, suitName), called from dashboard.js when a
 * suit's "Bookings" sidebar button is clicked.
 *
 * "Nueva reserva" has no public storefront yet — the admin books on behalf
 * of a walk-in/phone customer. Before enabling "Reservar" it debounces a
 * call to the availability engine (same one the backend re-checks inside
 * its own transaction on create), so a race between two admins booking the
 * same slot still surfaces as a clean error instead of a silent conflict.
 */

'use strict';

let currentBookingSuit = null;
let bkResSearchTimer = null;
let bkgSearchTimer = null;
let bkAvailabilityTimer = null;
let bkResourcesPage = 1;
let bkgPage = 1;
let lastBkResourcesPage = [];
let lastBookingModalResources = [];
let currentClosuresResourceId = null;
let lastClosuresList = [];
let bkgAvailabilityOk = false;

// ── Home ─────────────────────────────────────────────────────────────────

async function loadBookingPanel(suitId, suitName) {
  currentBookingSuit = { id: suitId, name: suitName };
  document.getElementById('booking-suit-label').textContent = `Reservas de ${suitName}`;
  showBookingView('home');
  await refreshBookingHome();
}

function showBookingView(view) {
  document.getElementById('booking-home').hidden           = view !== 'home';
  document.getElementById('booking-resources-view').hidden = view !== 'resources';
  document.getElementById('booking-reservas-view').hidden  = view !== 'reservas';
}

async function refreshBookingHome() {
  const kpis = document.getElementById('kpis-booking');
  if (!currentBookingSuit) { kpis.innerHTML = ''; return; }

  try {
    const [resourcesRes, bookingsRes] = await Promise.all([
      listBookingResources(currentBookingSuit.id, { isActive: true, take: 100 }),
      listBookings(currentBookingSuit.id, { take: 100 })
    ]);

    document.getElementById('bk-resources-count').textContent =
      `${resourcesRes.pagination.total} recurso${resourcesRes.pagination.total === 1 ? '' : 's'}`;

    const pending = bookingsRes.data.filter(b => b.status === 'pending').length;
    document.getElementById('bk-reservas-pending-count').textContent =
      pending ? `${pending} pendiente${pending === 1 ? '' : 's'} de confirmación` : 'Sin pendientes';

    const todayStr = new Date().toDateString();
    const today = bookingsRes.data.filter(b => new Date(b.startAt).toDateString() === todayStr).length;

    const items = [
      { label: 'Recursos activos', value: resourcesRes.pagination.total },
      { label: 'Reservas pendientes', value: pending },
      { label: 'Reservas de hoy', value: today }
    ];
    kpis.innerHTML = items.map(i => `
      <div class="kpi-card">
        <div class="kpi-label">${i.label}</div>
        <div class="kpi-value">${i.value}</div>
      </div>
    `).join('');
  } catch (err) {
    kpis.innerHTML = `<p class="crm-muted">No se pudo cargar el resumen (${esc(err.message)}).</p>`;
  }
}

// ── Recursos ─────────────────────────────────────────────────────────────

async function enterBookingResources() {
  showBookingView('resources');
  gateCreateButton('btn-add-bkres', 'bookings');
  await fetchBookingResources(1);
}

async function fetchBookingResources(page) {
  bkResourcesPage = page;
  const wrap = document.getElementById('bkres-table-wrap');
  if (!currentBookingSuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const search = document.getElementById('bkres-search').value.trim();
  const type = document.getElementById('bkres-type-filter').value;

  try {
    const res = await listBookingResources(currentBookingSuit.id, {
      search, type, skip: (page - 1) * BOOKING_RESOURCES_PER_PAGE, take: BOOKING_RESOURCES_PER_PAGE
    });
    lastBkResourcesPage = res.data;
    renderBkResourcesTable(wrap, res.data);
    renderBkResourcesPagination(res.pagination.total, page);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los recursos (${esc(err.message)}).</p>`;
  }
}

function renderBkResourcesTable(wrap, resources) {
  if (!resources.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin recursos para este filtro.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Nombre</th><th>Tipo</th><th>Capacidad</th><th>Precio base</th><th>Estado</th><th></th></tr></thead>
      <tbody>${resources.map(bkResourceRow).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'bookings');
}

function bkResourceRow(r) {
  return `
    <tr>
      <td>${esc(r.name)}</td>
      <td class="crm-muted">${esc(BOOKING_RESOURCE_TYPE_LABEL[r.type] || r.type)}</td>
      <td>${r.capacity}</td>
      <td>${fmtMoney(Number(r.basePrice))}</td>
      <td>${r.isActive ? '<span class="crm-badge badge-green">Activo</span>' : '<span class="crm-badge badge-gray">Inactivo</span>'}</td>
      <td class="td-actions">
        <span class="crm-action-btn" data-closures-res="${r.id}" title="Cierres">📅</span>
        <span class="crm-action-btn" data-edit-bkres="${r.id}" title="Editar">✎</span>
        <span class="crm-action-btn btn-del" data-del-bkres="${r.id}" title="Eliminar">🗑</span>
      </td>
    </tr>`;
}

function renderBkResourcesPagination(total, page) {
  const el = document.getElementById('bkres-pagination');
  const pages = Math.max(1, Math.ceil(total / BOOKING_RESOURCES_PER_PAGE));

  if (pages <= 1) {
    el.innerHTML = total ? `<span class="page-info">${total} recurso${total === 1 ? '' : 's'}</span>` : '';
    return;
  }

  let html = `<span class="page-info">${total} recursos</span>`;
  html += `<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) {
      html += `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    } else if (Math.abs(p - page) === 2) {
      html += '<span class="page-ellipsis">…</span>';
    }
  }
  html += `<button class="page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;
}

function openBkResourceModal(resourceId) {
  const resource = resourceId ? lastBkResourcesPage.find(r => r.id === resourceId) : null;

  document.getElementById('modal-bkres-title').textContent = resource ? 'Editar recurso' : 'Nuevo recurso';
  document.getElementById('modal-bkres').dataset.editId = resourceId || '';

  document.getElementById('bkres-name').value = resource?.name || '';
  document.getElementById('bkres-desc').value = resource?.description || '';
  document.getElementById('bkres-type').value = resource?.type || 'nightly';
  // El type no es editable una vez creado (moverse de tipo rompe el motor de
  // disponibilidad ya validado contra ese recurso) — ver bookings.service.ts.
  document.getElementById('bkres-type').disabled = !!resource;
  document.getElementById('bkres-capacity').value = resource?.capacity ?? 1;
  document.getElementById('bkres-price').value = resource?.basePrice ?? '';
  document.getElementById('bkres-slot-duration').value = resource?.slotDurationMinutes ?? '';
  document.getElementById('bkres-daily-start').value = resource?.dailyStartTime || '';
  document.getElementById('bkres-daily-end').value = resource?.dailyEndTime || '';
  document.getElementById('bkres-active').checked = resource?.isActive ?? true;

  toggleBkResSlotFields();
  document.getElementById('modal-bkres').classList.add('open');
}

function toggleBkResSlotFields() {
  document.getElementById('bkres-slot-fields').hidden = document.getElementById('bkres-type').value !== 'slot';
}

function closeBkResourceModal() {
  document.getElementById('modal-bkres').classList.remove('open');
  document.getElementById('bkres-type').disabled = false;
}

async function saveBkResource() {
  const editId = document.getElementById('modal-bkres').dataset.editId;
  const name = document.getElementById('bkres-name').value.trim();
  const type = document.getElementById('bkres-type').value;
  const basePrice = parseFloat(document.getElementById('bkres-price').value);

  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }
  if (!editId && (isNaN(basePrice) || basePrice <= 0)) { showToast('El precio base es obligatorio', 'err'); return; }
  if (type === 'slot' && !document.getElementById('bkres-slot-duration').value) {
    showToast('La duración del turno es obligatoria para recursos por turno', 'err');
    return;
  }

  const dto = {
    name,
    description: document.getElementById('bkres-desc').value.trim() || undefined,
    type: editId ? undefined : type,
    capacity: parseInt(document.getElementById('bkres-capacity').value, 10) || 1,
    basePrice: isNaN(basePrice) ? undefined : basePrice,
    slotDurationMinutes: type === 'slot' ? (parseInt(document.getElementById('bkres-slot-duration').value, 10) || undefined) : undefined,
    dailyStartTime: type === 'slot' ? (document.getElementById('bkres-daily-start').value || undefined) : undefined,
    dailyEndTime: type === 'slot' ? (document.getElementById('bkres-daily-end').value || undefined) : undefined,
    isActive: document.getElementById('bkres-active').checked
  };

  try {
    if (editId) {
      await updateBookingResource(currentBookingSuit.id, editId, dto);
      showToast('Recurso actualizado');
    } else {
      await createBookingResource(currentBookingSuit.id, dto);
      showToast('Recurso creado');
    }
    closeBkResourceModal();
    fetchBookingResources(editId ? bkResourcesPage : 1);
    refreshBookingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el recurso', 'err');
  }
}

// ── Cierres (por recurso) ─────────────────────────────────────────────────

function openBkClosuresModal(resourceId) {
  const resource = lastBkResourcesPage.find(r => r.id === resourceId);
  currentClosuresResourceId = resourceId;
  document.getElementById('modal-bkclosures-resource').textContent = resource ? resource.name : '';
  document.getElementById('bkclosure-start').value = '';
  document.getElementById('bkclosure-end').value = '';
  document.getElementById('bkclosure-reason').value = '';
  document.getElementById('modal-bkclosures').classList.add('open');
  gateCreateButton('btn-add-bkclosure', 'bookings');
  fetchBkClosures();
}

async function fetchBkClosures() {
  const wrap = document.getElementById('bkclosures-table-wrap');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    lastClosuresList = await listClosures(currentBookingSuit.id, currentClosuresResourceId);
    renderBkClosuresTable(wrap);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los cierres (${esc(err.message)}).</p>`;
  }
}

function renderBkClosuresTable(wrap) {
  if (!lastClosuresList.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin cierres cargados.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${lastClosuresList.map(c => `
        <tr>
          <td>${esc(new Date(c.startAt).toLocaleDateString('es-AR'))}</td>
          <td>${esc(new Date(c.endAt).toLocaleDateString('es-AR'))}</td>
          <td class="crm-muted">${esc(c.reason || '—')}</td>
          <td class="td-actions">
            <span class="crm-action-btn btn-del" data-del-closure="${c.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'bookings');
}

function closeBkClosuresModal() {
  document.getElementById('modal-bkclosures').classList.remove('open');
  currentClosuresResourceId = null;
}

async function addBkClosure() {
  const start = document.getElementById('bkclosure-start').value;
  const end = document.getElementById('bkclosure-end').value;
  if (!start || !end) { showToast('Elegí un rango de fechas', 'err'); return; }

  const dto = {
    startAt: new Date(`${start}T00:00:00`).toISOString(),
    endAt: new Date(`${end}T23:59:59`).toISOString(),
    reason: document.getElementById('bkclosure-reason').value.trim() || undefined
  };

  try {
    await createClosure(currentBookingSuit.id, currentClosuresResourceId, dto);
    showToast('Cierre agregado');
    document.getElementById('bkclosure-start').value = '';
    document.getElementById('bkclosure-end').value = '';
    document.getElementById('bkclosure-reason').value = '';
    fetchBkClosures();
  } catch (err) {
    showToast(err.message || 'No se pudo agregar el cierre', 'err');
  }
}

// ── Reservas ─────────────────────────────────────────────────────────────

async function enterBookingReservas() {
  showBookingView('reservas');
  gateCreateButton('btn-add-booking', 'bookings');
  await fetchBookings(1);
}

async function fetchBookings(page) {
  bkgPage = page;
  const wrap = document.getElementById('bkg-table-wrap');
  if (!currentBookingSuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const search = document.getElementById('bkg-search').value.trim();
  const status = document.getElementById('bkg-status-filter').value;

  try {
    const res = await listBookings(currentBookingSuit.id, {
      search, status, skip: (page - 1) * BOOKINGS_PER_PAGE, take: BOOKINGS_PER_PAGE
    });
    renderBkgTable(wrap, res.data);
    renderBkgPagination(res.pagination.total, page);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar las reservas (${esc(err.message)}).</p>`;
  }
}

function renderBkgTable(wrap, bookings) {
  if (!bookings.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin reservas para este filtro.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Recurso</th><th>Cliente</th><th>Fechas</th><th>Cant.</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${bookings.map(bkgRow).join('')}</tbody>
    </table>`;
}

function bkgRow(b) {
  const dates = `${esc(new Date(b.startAt).toLocaleString('es-AR'))} – ${esc(new Date(b.endAt).toLocaleString('es-AR'))}`;
  return `
    <tr>
      <td>${esc((b.resource && b.resource.name) || '—')}</td>
      <td>${esc(b.customerName)}</td>
      <td class="crm-muted">${dates}</td>
      <td>${b.quantity}</td>
      <td>${fmtMoney(Number(b.totalPrice))}</td>
      <td><span class="crm-badge ${BOOKING_STATUS_BADGE[b.status] || 'badge-gray'}">${esc(b.status)}</span></td>
      <td class="td-actions">${bkgActionsHtml(b)}</td>
    </tr>`;
}

function bkgActionsHtml(b) {
  if (!ekCan('bookings', 'write')) return '<span class="crm-muted">—</span>';
  if (b.status === 'pending') {
    return `
      <button class="ghost-btn" data-bkg-action="confirm" data-bkg-id="${b.id}">Confirmar</button>
      <button class="ghost-btn btn-danger" data-bkg-action="cancel" data-bkg-id="${b.id}">Cancelar</button>`;
  }
  if (b.status === 'confirmed') {
    return `
      <button class="ghost-btn" data-bkg-action="complete" data-bkg-id="${b.id}">Completar</button>
      <button class="ghost-btn btn-danger" data-bkg-action="no_show" data-bkg-id="${b.id}">No-show</button>
      <button class="ghost-btn btn-danger" data-bkg-action="cancel" data-bkg-id="${b.id}">Cancelar</button>`;
  }
  return '<span class="crm-muted">—</span>';
}

// Cancelar/no-show liberan la capacidad de inmediato — la disponibilidad se
// recalcula excluyendo esos dos estados, sin un flag de "reingreso" (no hay
// stock que reponer, a diferencia de una devolución de StOrder).
async function runBkgAction(bookingId, action) {
  try {
    await updateBookingStatus(currentBookingSuit.id, bookingId, action);
    showToast('Reserva actualizada');
    fetchBookings(bkgPage);
    refreshBookingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar la reserva', 'err');
  }
}

function renderBkgPagination(total, page) {
  const el = document.getElementById('bkg-pagination');
  const pages = Math.max(1, Math.ceil(total / BOOKINGS_PER_PAGE));

  if (pages <= 1) {
    el.innerHTML = total ? `<span class="page-info">${total} reserva${total === 1 ? '' : 's'}</span>` : '';
    return;
  }

  let html = `<span class="page-info">${total} reservas</span>`;
  html += `<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) {
      html += `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    } else if (Math.abs(p - page) === 2) {
      html += '<span class="page-ellipsis">…</span>';
    }
  }
  html += `<button class="page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;
}

// ── Nueva reserva (con chequeo de disponibilidad en vivo) ─────────────────

function getSelectedBookingResource() {
  const id = document.getElementById('bkg-resource-select').value;
  return lastBookingModalResources.find(r => r.id === id) || null;
}

function toggleBookingResourceFields() {
  const isSlot = getSelectedBookingResource()?.type === 'slot';
  document.getElementById('bkg-nightly-fields').hidden = isSlot;
  document.getElementById('bkg-slot-fields').hidden = !isSlot;
}

// Deriva startAt/endAt en ISO a partir de los inputs, según el type del
// recurso elegido — null mientras falten datos para calcularlos.
function computeBookingDates() {
  const resource = getSelectedBookingResource();
  if (!resource) return null;

  if (resource.type === 'nightly') {
    const checkin = document.getElementById('bkg-checkin').value;
    const checkout = document.getElementById('bkg-checkout').value;
    if (!checkin || !checkout) return null;
    return {
      startAt: new Date(`${checkin}T00:00:00`).toISOString(),
      endAt: new Date(`${checkout}T00:00:00`).toISOString()
    };
  }

  const date = document.getElementById('bkg-slot-date').value;
  const time = document.getElementById('bkg-slot-time').value;
  if (!date || !time || !resource.slotDurationMinutes) return null;
  const startAt = new Date(`${date}T${time}:00`);
  const endAt = new Date(startAt.getTime() + resource.slotDurationMinutes * 60000);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

function setBkgAvailabilityStatus(text, cls) {
  const el = document.getElementById('bkg-availability-status');
  el.textContent = text;
  // crm-muted usa !important sobre color, así que "pos"/"neg" van solas
  // (sin combinar con crm-muted) para que su color se vea.
  el.className = cls || 'crm-muted';
}

function scheduleAvailabilityCheck() {
  clearTimeout(bkAvailabilityTimer);
  bkgAvailabilityOk = false;
  document.getElementById('modal-booking-save').disabled = true;
  bkAvailabilityTimer = setTimeout(runAvailabilityCheck, 300);
}

async function runAvailabilityCheck() {
  const resource = getSelectedBookingResource();
  const quantity = parseInt(document.getElementById('bkg-quantity').value, 10) || 1;
  const dates = computeBookingDates();

  if (!resource || !dates) {
    setBkgAvailabilityStatus('', '');
    return;
  }

  setBkgAvailabilityStatus('Verificando disponibilidad…', '');
  try {
    const availability = await checkAvailability(currentBookingSuit.id, resource.id, dates.startAt, dates.endAt, quantity);
    bkgAvailabilityOk = availability.available;
    document.getElementById('modal-booking-save').disabled = !availability.available;

    if (availability.available) {
      setBkgAvailabilityStatus(`Disponible ✓ (quedan ${availability.remaining})`, 'pos');
    } else {
      const reasonText = {
        closed: 'el recurso está cerrado en esas fechas',
        capacity: 'no hay disponibilidad para esa cantidad',
        inactive: 'el recurso no está activo'
      }[availability.reason] || 'no disponible';
      setBkgAvailabilityStatus(`No disponible ✗ (${reasonText})`, 'neg');
    }
  } catch (err) {
    bkgAvailabilityOk = false;
    document.getElementById('modal-booking-save').disabled = true;
    setBkgAvailabilityStatus(err.message || 'No se pudo verificar la disponibilidad', 'neg');
  }
}

async function openBookingModal() {
  document.getElementById('bkg-customer-name').value = '';
  document.getElementById('bkg-customer-phone').value = '';
  document.getElementById('bkg-notes').value = '';
  document.getElementById('bkg-quantity').value = 1;
  document.getElementById('bkg-checkin').value = '';
  document.getElementById('bkg-checkout').value = '';
  document.getElementById('bkg-slot-date').value = '';
  document.getElementById('bkg-slot-time').value = '';
  setBkgAvailabilityStatus('', '');
  bkgAvailabilityOk = false;
  document.getElementById('modal-booking-save').disabled = true;

  const select = document.getElementById('bkg-resource-select');
  select.innerHTML = '<option value="">Cargando…</option>';

  try {
    const res = await listBookingResources(currentBookingSuit.id, { isActive: true, take: 100 });
    lastBookingModalResources = res.data;
    select.innerHTML = '<option value="">Seleccioná un recurso…</option>' +
      res.data.map(r => `<option value="${r.id}">${esc(r.name)} (${esc(BOOKING_RESOURCE_TYPE_LABEL[r.type] || r.type)})</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">No se pudieron cargar los recursos</option>';
    showToast(err.message || 'No se pudieron cargar los recursos', 'err');
  }

  toggleBookingResourceFields();
  document.getElementById('modal-booking').classList.add('open');
}

function closeBookingModal() {
  document.getElementById('modal-booking').classList.remove('open');
}

async function saveBooking() {
  if (!bkgAvailabilityOk) { showToast('Verificá la disponibilidad antes de reservar', 'err'); return; }

  const resource = getSelectedBookingResource();
  const dates = computeBookingDates();
  const customerName = document.getElementById('bkg-customer-name').value.trim();
  if (!resource || !dates) { showToast('Completá el recurso y las fechas', 'err'); return; }
  if (!customerName) { showToast('El nombre del cliente es obligatorio', 'err'); return; }

  const dto = {
    resourceId: resource.id,
    customerName,
    customerPhone: document.getElementById('bkg-customer-phone').value.trim() || undefined,
    startAt: dates.startAt,
    endAt: dates.endAt,
    quantity: parseInt(document.getElementById('bkg-quantity').value, 10) || 1,
    notes: document.getElementById('bkg-notes').value.trim() || undefined
  };

  try {
    await createBooking(currentBookingSuit.id, dto);
    showToast('Reserva creada');
    closeBookingModal();
    fetchBookings(1);
    refreshBookingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo crear la reserva', 'err');
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────

function initBookingEvents() {
  document.getElementById('bk-enter-resources').addEventListener('click', enterBookingResources);
  document.getElementById('bk-enter-reservas').addEventListener('click', enterBookingReservas);

  document.getElementById('bk-resources-back').addEventListener('click', () => { showBookingView('home'); refreshBookingHome(); });
  document.getElementById('bkres-search').addEventListener('input', () => {
    clearTimeout(bkResSearchTimer);
    bkResSearchTimer = setTimeout(() => fetchBookingResources(1), 300);
  });
  document.getElementById('bkres-type-filter').addEventListener('change', () => fetchBookingResources(1));
  document.getElementById('bkres-pagination').addEventListener('click', (e) => {
    const btn = e.target.closest('.page-btn:not([disabled])');
    if (btn) fetchBookingResources(Number(btn.dataset.page));
  });
  document.getElementById('btn-add-bkres').addEventListener('click', () => openBkResourceModal(null));
  document.getElementById('bkres-type').addEventListener('change', toggleBkResSlotFields);
  document.getElementById('bkres-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-bkres]');
    const delBtn = e.target.closest('[data-del-bkres]');
    const closuresBtn = e.target.closest('[data-closures-res]');
    if (editBtn) openBkResourceModal(editBtn.dataset.editBkres);
    if (closuresBtn) openBkClosuresModal(closuresBtn.dataset.closuresRes);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este recurso? Esta acción no se puede deshacer.',
        onConfirm: async () => {
          try {
            await deleteBookingResource(currentBookingSuit.id, delBtn.dataset.delBkres);
            showToast('Recurso eliminado');
            fetchBookingResources(bkResourcesPage);
            refreshBookingHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el recurso', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-bkres-close').addEventListener('click', closeBkResourceModal);
  document.getElementById('modal-bkres-cancel').addEventListener('click', closeBkResourceModal);
  document.getElementById('modal-bkres-save').addEventListener('click', saveBkResource);

  document.getElementById('modal-bkclosures-close').addEventListener('click', closeBkClosuresModal);
  document.getElementById('modal-bkclosures-close-btn').addEventListener('click', closeBkClosuresModal);
  document.getElementById('btn-add-bkclosure').addEventListener('click', addBkClosure);
  document.getElementById('bkclosures-table-wrap').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del-closure]');
    if (!delBtn) return;
    openConfirmModal({
      message: '¿Eliminar este cierre?',
      onConfirm: async () => {
        try {
          await deleteClosure(currentBookingSuit.id, currentClosuresResourceId, delBtn.dataset.delClosure);
          showToast('Cierre eliminado');
          fetchBkClosures();
        } catch (err) {
          showToast(err.message || 'No se pudo eliminar el cierre', 'err');
        }
      }
    });
  });

  document.getElementById('bk-reservas-back').addEventListener('click', () => { showBookingView('home'); refreshBookingHome(); });
  document.getElementById('bkg-search').addEventListener('input', () => {
    clearTimeout(bkgSearchTimer);
    bkgSearchTimer = setTimeout(() => fetchBookings(1), 300);
  });
  document.getElementById('bkg-status-filter').addEventListener('change', () => fetchBookings(1));
  document.getElementById('bkg-pagination').addEventListener('click', (e) => {
    const btn = e.target.closest('.page-btn:not([disabled])');
    if (btn) fetchBookings(Number(btn.dataset.page));
  });
  document.getElementById('btn-add-booking').addEventListener('click', openBookingModal);
  document.getElementById('bkg-table-wrap').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bkg-action]');
    if (!btn) return;
    const action = btn.dataset.bkgAction;
    const bookingId = btn.dataset.bkgId;

    if (action === 'confirm') {
      runBkgAction(bookingId, 'confirm');
    } else if (action === 'complete') {
      runBkgAction(bookingId, 'complete');
    } else if (action === 'cancel') {
      openConfirmModal({ message: '¿Cancelar esta reserva?', onConfirm: () => runBkgAction(bookingId, 'cancel') });
    } else {
      openConfirmModal({ message: '¿Marcar esta reserva como no-show?', onConfirm: () => runBkgAction(bookingId, 'no_show') });
    }
  });

  document.getElementById('modal-booking-close').addEventListener('click', closeBookingModal);
  document.getElementById('modal-booking-cancel').addEventListener('click', closeBookingModal);
  document.getElementById('modal-booking-save').addEventListener('click', saveBooking);
  document.getElementById('bkg-resource-select').addEventListener('change', () => { toggleBookingResourceFields(); scheduleAvailabilityCheck(); });
  ['bkg-checkin', 'bkg-checkout', 'bkg-slot-date', 'bkg-slot-time', 'bkg-quantity'].forEach(id => {
    document.getElementById(id).addEventListener('input', scheduleAvailabilityCheck);
  });
}
