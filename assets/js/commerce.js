/**
 * commerce.js
 * Commerce panel: POS (scan → cart → checkout) and Pedidos (list + filter +
 * accept/cancel/return). Entry point is loadCommercePanel(suitId, suitName),
 * called from dashboard.js when a suit's "Commerce" sidebar button is clicked.
 *
 * POS sucursal activa: si el suit tiene sucursales activas (ver
 * inventory.js Sucursales), el POS muestra un selector — la venta descuenta
 * el stock de esa sucursal puntual (StProductBranchStock) en vez del pool
 * sin sucursal (StProduct.stock). Sin sucursales, el selector queda oculto
 * y el POS se comporta exactamente igual que siempre. La elección persiste
 * por suit en localStorage. Ver API/docs/migracion_18.md.
 */

'use strict';

let currentCommerceSuit = null;
let posCart = [];
let posBranches = [];

// Sucursal activa del POS — persiste por suit en localStorage (mismo patrón
// que suit-state.js) para no obligar a re-elegirla en cada visita al panel.
const posBranchKey = (suitId) => `ekitwi_erp_pos_branch_${suitId}`;
const getPosBranchId = (suitId) => localStorage.getItem(posBranchKey(suitId)) || '';
const setPosBranchId = (suitId, branchId) => {
  if (branchId) localStorage.setItem(posBranchKey(suitId), branchId);
  else localStorage.removeItem(posBranchKey(suitId));
};

async function loadCommercePanel(suitId, suitName) {
  currentCommerceSuit = { id: suitId, name: suitName };
  document.getElementById('commerce-suit-label').textContent = `Commerce de ${suitName}`;
  posCart = [];
  renderCart();
  showCommerceView('home');
  gateCreateButton('pos-checkout-btn', 'orders');
  gateCreateButton('btn-add-cash-register', 'cash_management');
  await Promise.all([refreshCommerceHome(), loadPosBranches()]);
}

// Suits sin sucursales creadas: el selector queda oculto y el POS vende
// contra el pool sin sucursal, exactamente como siempre.
async function loadPosBranches() {
  const wrap   = document.getElementById('pos-branch-wrap');
  const select = document.getElementById('pos-branch-select');

  try {
    posBranches = (await listBranches(currentCommerceSuit.id)).filter(b => b.isActive);
  } catch {
    posBranches = [];
  }

  if (!posBranches.length) {
    wrap.hidden = true;
    select.innerHTML = '';
    return;
  }

  const saved = getPosBranchId(currentCommerceSuit.id);
  select.innerHTML = '<option value="">Sin sucursal (depósito central)</option>' +
    posBranches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  select.value = posBranches.some(b => b.id === saved) ? saved : '';
  wrap.hidden = false;
}

function showCommerceView(view) {
  document.getElementById('commerce-home').hidden         = view !== 'home';
  document.getElementById('commerce-pedidos-view').hidden = view !== 'pedidos';
  document.getElementById('commerce-caja-view').hidden    = view !== 'caja';
}

async function refreshCommerceHome() {
  const wrap = document.getElementById('recent-orders-wrap');
  if (!currentCommerceSuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';

  try {
    const orders = await listOrders(currentCommerceSuit.id);
    const recent = orders.slice(0, 5);
    if (!recent.length) {
      wrap.innerHTML = '<p class="crm-muted">Sin pedidos todavía.</p>';
      return;
    }
    wrap.innerHTML = `
      <table class="crm-table">
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Estado</th><th>Total</th></tr></thead>
        <tbody>${recent.map(recentOrderRow).join('')}</tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los pedidos (${esc(err.message)}).</p>`;
  }
}

// "Auriculares Pro x2, Mouse inalámbrico x1" — usado tanto en "Últimos
// pedidos" como en la gestión de Pedidos para mostrar qué se vendió.
function orderItemsSummary(o) {
  const items = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
  if (!items.length) return '—';
  return items.map(i => `${esc(i.productName || 'Producto')} ×${i.quantity ?? 1}`).join(', ');
}

function recentOrderRow(o) {
  const items    = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
  const total    = items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
  const customer = (o.user && o.user.email) || o.guestName || 'Invitado';

  return `
    <tr>
      <td>${esc(new Date(o.date).toLocaleString('es-AR'))}</td>
      <td>${esc(customer)}</td>
      <td class="crm-muted">${orderItemsSummary(o)}</td>
      <td><span class="crm-badge ${ORDER_BADGE[o.type] || 'badge-gray'}">${esc(o.type)}</span></td>
      <td>${fmtMoney(total)}</td>
    </tr>`;
}

async function enterPedidosManagement() {
  showCommerceView('pedidos');
  await fetchAndRenderOrders();
}

// ── POS ──────────────────────────────────────────────────────────────────

async function handleScanInput(e) {
  if (e.key !== 'Enter') return;
  const raw = e.target.value.trim();
  if (!raw) return;
  if (!currentCommerceSuit) { showToast('Seleccioná un suit primero', 'err'); return; }

  try {
    const product = await findProductByCode(currentCommerceSuit.id, raw);
    e.target.value = '';
    await addToCart(product);
  } catch {
    showToast(`Producto no encontrado (${raw})`, 'err');
  }
}

// Cada línea guarda sus niveles de precio (StProductPrice) además del precio
// base, para que el vendedor pueda elegir cuál cobrar (ver renderCart). Un
// producto sin niveles cargados vende siempre a precio base, como antes.
async function addToCart(product) {
  const existing = posCart.find(i => i.productId === product.id);
  if (existing) {
    existing.quantity += 1;
    renderCart();
    return;
  }

  let prices = [];
  try {
    prices = await listProductPrices(currentCommerceSuit.id, product.id);
  } catch {
    prices = [];
  }

  posCart.push({
    productId: product.id,
    name: product.name,
    basePrice: Number(product.price),
    prices,
    priceId: null,
    unitPrice: Number(product.price),
    quantity: 1,
  });
  renderCart();
}

function renderCart() {
  const wrap = document.getElementById('pos-cart-wrap');

  if (!posCart.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin productos en la venta actual.</p>';
  } else {
    wrap.innerHTML = `
      <table class="crm-table">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead>
        <tbody>${posCart.map((i, idx) => `
          <tr>
            <td>${esc(i.name)}</td>
            <td><input type="number" min="1" class="pos-qty-input" data-idx="${idx}" value="${i.quantity}" style="width:64px" /></td>
            <td>${priceCellHtml(i, idx)}</td>
            <td>${fmtMoney(i.unitPrice * i.quantity)}</td>
            <td><span class="crm-action-btn btn-del" data-remove-idx="${idx}" title="Quitar">✕</span></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  const total = posCart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  document.getElementById('pos-total').textContent = fmtMoney(total);
  document.getElementById('pos-clear-btn').disabled = posCart.length === 0;
  document.getElementById('pos-checkout-btn').disabled = posCart.length === 0;
}

// Sin niveles de precio cargados: solo el precio base, como texto plano.
// Con niveles: selector "Base" + cada StProductPrice del producto.
function priceCellHtml(item, idx) {
  if (!item.prices.length) return fmtMoney(item.unitPrice);

  const options = [
    `<option value="" ${!item.priceId ? 'selected' : ''}>Base — ${fmtMoney(item.basePrice)}</option>`,
    ...item.prices.map(p => `<option value="${p.id}" ${item.priceId === p.id ? 'selected' : ''}>${esc(p.name)} — ${fmtMoney(Number(p.price))}</option>`),
  ];
  return `<select class="pos-price-select" data-idx="${idx}">${options.join('')}</select>`;
}

async function checkoutCart() {
  if (!posCart.length || !currentCommerceSuit) return;
  const btn = document.getElementById('pos-checkout-btn');
  btn.disabled = true;

  try {
    const branchId = document.getElementById('pos-branch-select').value || undefined;
    const items = posCart.map(i => ({ productId: i.productId, quantity: i.quantity, priceId: i.priceId || undefined }));
    await createPosSale(currentCommerceSuit.id, items, branchId);
    posCart = [];
    renderCart();
    showToast('Venta registrada');
    fetchAndRenderOrders();
  } catch (err) {
    showToast(err.message || 'No se pudo registrar la venta', 'err');
    btn.disabled = posCart.length === 0;
  }
}

// ── Pedidos ──────────────────────────────────────────────────────────────

async function fetchAndRenderOrders() {
  const wrap = document.getElementById('pedidos-table-wrap');
  if (!currentCommerceSuit) {
    wrap.innerHTML = '<p class="crm-muted">Seleccioná un suit en el menú.</p>';
    return;
  }

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const type = document.getElementById('pedido-type-filter').value;

  try {
    const orders = await listOrders(currentCommerceSuit.id, type);
    if (!orders.length) {
      wrap.innerHTML = '<p class="crm-muted">Sin pedidos para este filtro.</p>';
      return;
    }
    wrap.innerHTML = `
      <table class="crm-table">
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Estado</th><th>Total</th><th>Acciones</th></tr></thead>
        <tbody>${orders.map(orderRow).join('')}</tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los pedidos (${esc(err.message)}).</p>`;
  }
}

function orderRow(o) {
  const items    = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
  const total    = items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
  const customer = (o.user && o.user.email) || o.guestName || 'Invitado';

  return `
    <tr>
      <td>${esc(new Date(o.date).toLocaleString('es-AR'))}</td>
      <td>${esc(customer)}</td>
      <td class="crm-muted">${orderItemsSummary(o)}</td>
      <td><span class="crm-badge ${ORDER_BADGE[o.type] || 'badge-gray'}">${esc(o.type)}</span></td>
      <td>${fmtMoney(total)}</td>
      <td class="td-actions">${orderActionsHtml(o)}</td>
    </tr>`;
}

// Aceptar/cancelar/devolver requieren permiso de escritura en 'orders' —
// mismo criterio que el backend (OrdersController.changeStatus, ver
// hasSuitPermission(..., 'write')).
function orderActionsHtml(o) {
  if (!ekCan('orders', 'write')) return '<span class="crm-muted">—</span>';
  if (o.type === 'pedido') {
    return `
      <button class="ghost-btn" data-order-action="accept" data-order-id="${o.id}">Aceptar</button>
      <button class="ghost-btn btn-danger" data-order-action="cancel" data-order-id="${o.id}">Cancelar</button>`;
  }
  if (o.type === 'venta') {
    return `<button class="ghost-btn btn-danger" data-order-action="return" data-order-id="${o.id}">Devolver</button>`;
  }
  return '<span class="crm-muted">—</span>';
}

async function runOrderAction(orderId, action, restock) {
  try {
    await updateOrderAction(currentCommerceSuit.id, orderId, action, restock);
    showToast('Pedido actualizado');
    fetchAndRenderOrders();
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido', 'err');
  }
}

// ── Gestión de Caja/s ────────────────────────────────────────────────────
// Standalone: sin vínculo con las ventas del POS (no hay método de pago
// por venta todavía) — expectedAmount al cerrar sale solo de los
// movimientos manuales de la sesión. Ver API/docs/migracion_19.md.

let allCashRegistersFull = [];
let openSessionByRegister = new Map(); // registerId -> session abierta (si tiene)
let currentCashSession = null;         // sesión que se está viendo en el detalle
let cashMovementType = 'ingreso';      // qué modal de movimiento está abierto

async function enterCajaManagement() {
  showCommerceView('caja');
  document.getElementById('cash-session-detail').hidden = true;
  currentCashSession = null;
  await fetchCashRegisters();
}

async function fetchCashRegisters() {
  const wrap = document.getElementById('cash-registers-table-wrap');
  if (!currentCommerceSuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    const [registers, openSessions] = await Promise.all([
      listCashRegisters(currentCommerceSuit.id),
      listCashSessions(currentCommerceSuit.id, { status: 'abierta' })
    ]);
    allCashRegistersFull = registers;
    openSessionByRegister = new Map(openSessions.map(s => [s.cashRegisterId, s]));
    renderCashRegistersTable();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar las cajas (${esc(err.message)}).</p>`;
  }
}

function renderCashRegistersTable() {
  const wrap = document.getElementById('cash-registers-table-wrap');

  if (!allCashRegistersFull.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no creaste ninguna caja.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Nombre</th><th>Sucursal</th><th>Estado</th><th>Sesión</th><th></th></tr></thead>
      <tbody>${allCashRegistersFull.map(r => {
        const session = openSessionByRegister.get(r.id);
        return `
        <tr>
          <td>${esc(r.name)}</td>
          <td class="crm-muted">${esc(r.branch?.name || '—')}</td>
          <td>${r.isActive ? '<span class="crm-badge badge-green">Activa</span>' : '<span class="crm-badge badge-gray">Inactiva</span>'}</td>
          <td>${session ? '<span class="crm-badge badge-yellow">Caja abierta</span>' : '<span class="crm-muted">Cerrada</span>'}</td>
          <td class="td-actions">
            ${session
              ? `<span class="crm-action-btn" data-view-session="${session.id}" title="Ver caja">👁</span>`
              : (ekCan('cash_management', 'create') ? `<span class="crm-action-btn" data-open-session="${r.id}" title="Abrir caja">▶</span>` : '')}
            <span class="crm-action-btn" data-edit-register="${r.id}" title="Editar">✎</span>
            <span class="crm-action-btn btn-del" data-del-register="${r.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'cash_management');
}

// ── Caja: alta/edición del directorio ──────────────────────────────────

function openCashRegisterModal(registerId) {
  const register = registerId ? allCashRegistersFull.find(r => r.id === registerId) : null;
  document.getElementById('modal-cash-register-title').textContent = register ? 'Editar caja' : 'Nueva caja';
  document.getElementById('modal-cash-register').dataset.editId = registerId || '';

  const select = document.getElementById('cash-register-branch');
  select.innerHTML = '<option value="">Sin sucursal</option>' +
    posBranches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');

  document.getElementById('cash-register-name').value = register?.name || '';
  select.value = register?.branchId || '';
  document.getElementById('cash-register-active').checked = register?.isActive ?? true;
  document.getElementById('modal-cash-register').classList.add('open');
}

function closeCashRegisterModal() {
  document.getElementById('modal-cash-register').classList.remove('open');
}

async function saveCashRegister() {
  const editId = document.getElementById('modal-cash-register').dataset.editId;
  const name = document.getElementById('cash-register-name').value.trim();
  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }

  const dto = {
    name,
    branchId: document.getElementById('cash-register-branch').value || undefined,
    isActive: document.getElementById('cash-register-active').checked
  };

  try {
    if (editId) {
      await updateCashRegister(currentCommerceSuit.id, editId, dto);
      showToast('Caja actualizada');
    } else {
      await createCashRegister(currentCommerceSuit.id, dto);
      showToast('Caja creada');
    }
    closeCashRegisterModal();
    fetchCashRegisters();
    refreshCommerceHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la caja', 'err');
  }
}

// ── Caja: abrir sesión ──────────────────────────────────────────────────

function openOpenSessionModal(registerId) {
  const register = allCashRegistersFull.find(r => r.id === registerId);
  if (!register) return;
  document.getElementById('modal-open-cash-session').dataset.registerId = registerId;
  document.getElementById('open-cash-session-register-name').textContent = register.name;
  document.getElementById('open-cash-session-amount').value = '';
  document.getElementById('modal-open-cash-session').classList.add('open');
}

function closeOpenSessionModal() {
  document.getElementById('modal-open-cash-session').classList.remove('open');
}

async function confirmOpenSession() {
  const registerId = document.getElementById('modal-open-cash-session').dataset.registerId;
  const amount = parseFloat(document.getElementById('open-cash-session-amount').value);
  if (isNaN(amount) || amount < 0) { showToast('Ingresá un fondo inicial válido', 'err'); return; }

  try {
    const session = await openCashSession(currentCommerceSuit.id, registerId, amount);
    showToast('Caja abierta');
    closeOpenSessionModal();
    await fetchCashRegisters();
    viewCashSession(session.id);
  } catch (err) {
    showToast(err.message || 'No se pudo abrir la caja', 'err');
  }
}

// ── Caja: detalle de una sesión (movimientos + cierre) ─────────────────

async function viewCashSession(sessionId) {
  try {
    currentCashSession = await getCashSession(currentCommerceSuit.id, sessionId);
    renderCashSessionDetail();
  } catch (err) {
    showToast(err.message || 'No se pudo cargar la caja', 'err');
  }
}

function renderCashSessionDetail() {
  const s = currentCashSession;
  if (!s) return;

  document.getElementById('cash-session-detail').hidden = false;
  document.getElementById('cash-session-title').textContent = `Caja: ${s.cashRegister?.name || ''}`;
  document.getElementById('cash-session-meta').textContent =
    `Abierta por ${s.openedBy?.email || '—'} el ${new Date(s.openedAt).toLocaleString('es-AR')}` +
    (s.status === 'cerrada' ? ` · Cerrada por ${s.closedBy?.email || '—'} el ${new Date(s.closedAt).toLocaleString('es-AR')}` : '');

  const ingresos = s.movements.filter(m => m.type === 'ingreso').reduce((sum, m) => sum + Number(m.amount), 0);
  const egresos = s.movements.filter(m => m.type === 'egreso').reduce((sum, m) => sum + Number(m.amount), 0);
  const expected = Number(s.initialAmount) + ingresos - egresos;

  const kpis = [
    { label: 'Fondo inicial', value: fmtMoney(Number(s.initialAmount)) },
    { label: 'Ingresos', value: fmtMoney(ingresos) },
    { label: 'Egresos', value: fmtMoney(egresos) },
    { label: 'Esperado', value: fmtMoney(expected) }
  ];
  if (s.status === 'cerrada') {
    kpis.push({ label: 'Contado', value: fmtMoney(Number(s.finalAmount)) });
    kpis.push({ label: 'Diferencia', value: fmtMoney(Number(s.difference)) });
  }
  document.getElementById('cash-session-kpis').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value">${k.value}</div>
    </div>`).join('');

  const wrap = document.getElementById('cash-movements-table-wrap');
  if (!s.movements.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin movimientos todavía.</p>';
  } else {
    wrap.innerHTML = `
      <table class="crm-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Importe</th><th>Descripción</th><th>Usuario</th>${s.status === 'abierta' ? '<th></th>' : ''}</tr></thead>
        <tbody>${s.movements.map(m => `
          <tr>
            <td class="crm-muted">${new Date(m.createdAt).toLocaleString('es-AR')}</td>
            <td><span class="crm-badge ${m.type === 'ingreso' ? 'badge-green' : 'badge-red'}">${m.type === 'ingreso' ? 'Ingreso' : 'Egreso'}</span></td>
            <td>${fmtMoney(Number(m.amount))}</td>
            <td class="crm-muted">${esc(m.description)}</td>
            <td class="crm-muted">${esc(m.createdBy?.email || '—')}</td>
            ${s.status === 'abierta' ? `<td class="td-actions"><span class="crm-action-btn btn-del" data-del-movement="${m.id}" title="Eliminar">🗑</span></td>` : ''}
          </tr>`).join('')}</tbody>
      </table>`;
    gateRowActions(wrap, 'cash_management');
  }

  const canManageCash = s.status === 'abierta' && ekCan('cash_management', 'create');
  document.getElementById('btn-add-cash-ingreso').hidden = !canManageCash;
  document.getElementById('btn-add-cash-egreso').hidden  = !canManageCash;
  document.getElementById('btn-close-cash-session').hidden = s.status !== 'abierta' || !ekCan('cash_management', 'write');
}

// ── Caja: movimientos ────────────────────────────────────────────────────

function openCashMovementModal(type) {
  cashMovementType = type;
  document.getElementById('modal-cash-movement-title').textContent = type === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo egreso';
  document.getElementById('cash-movement-amount').value = '';
  document.getElementById('cash-movement-description').value = '';
  document.getElementById('modal-cash-movement').classList.add('open');
}

function closeCashMovementModal() {
  document.getElementById('modal-cash-movement').classList.remove('open');
}

async function saveCashMovement() {
  const amount = parseFloat(document.getElementById('cash-movement-amount').value);
  const description = document.getElementById('cash-movement-description').value.trim();
  if (isNaN(amount) || amount <= 0) { showToast('Ingresá un importe válido', 'err'); return; }
  if (!description) { showToast('La descripción es obligatoria', 'err'); return; }

  try {
    await addCashMovement(currentCommerceSuit.id, currentCashSession.id, { type: cashMovementType, amount, description });
    showToast('Movimiento registrado');
    closeCashMovementModal();
    viewCashSession(currentCashSession.id);
  } catch (err) {
    showToast(err.message || 'No se pudo registrar el movimiento', 'err');
  }
}

// ── Caja: cerrar sesión ──────────────────────────────────────────────────

function openCloseCashSessionModal() {
  const s = currentCashSession;
  const ingresos = s.movements.filter(m => m.type === 'ingreso').reduce((sum, m) => sum + Number(m.amount), 0);
  const egresos = s.movements.filter(m => m.type === 'egreso').reduce((sum, m) => sum + Number(m.amount), 0);
  const expected = Number(s.initialAmount) + ingresos - egresos;

  document.getElementById('close-cash-session-expected').textContent = fmtMoney(expected);
  document.getElementById('close-cash-session-amount').value = '';
  document.getElementById('modal-close-cash-session').classList.add('open');
}

function closeCloseCashSessionModal() {
  document.getElementById('modal-close-cash-session').classList.remove('open');
}

async function confirmCloseCashSession() {
  const amount = parseFloat(document.getElementById('close-cash-session-amount').value);
  if (isNaN(amount) || amount < 0) { showToast('Ingresá el monto contado', 'err'); return; }

  try {
    currentCashSession = await closeCashSession(currentCommerceSuit.id, currentCashSession.id, amount);
    showToast('Caja cerrada');
    closeCloseCashSessionModal();
    renderCashSessionDetail();
    fetchCashRegisters();
  } catch (err) {
    showToast(err.message || 'No se pudo cerrar la caja', 'err');
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────

function initCommerceEvents() {
  document.getElementById('pos-branch-select').addEventListener('change', (e) => {
    if (currentCommerceSuit) setPosBranchId(currentCommerceSuit.id, e.target.value);
  });

  document.getElementById('pos-scan-input').addEventListener('keydown', handleScanInput);
  document.getElementById('pos-clear-btn').addEventListener('click', () => { posCart = []; renderCart(); });
  document.getElementById('pos-checkout-btn').addEventListener('click', checkoutCart);

  document.getElementById('pos-cart-wrap').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-idx]');
    if (!rm) return;
    posCart.splice(Number(rm.dataset.removeIdx), 1);
    renderCart();
  });
  document.getElementById('pos-cart-wrap').addEventListener('change', (e) => {
    if (e.target.dataset.idx === undefined) return;
    const item = posCart[Number(e.target.dataset.idx)];

    if (e.target.classList.contains('pos-price-select')) {
      const priceId = e.target.value || null;
      const chosen = priceId ? item.prices.find(p => p.id === priceId) : null;
      item.priceId = priceId;
      item.unitPrice = chosen ? Number(chosen.price) : item.basePrice;
    } else {
      item.quantity = Math.max(1, parseInt(e.target.value, 10) || 1);
    }
    renderCart();
  });

  document.getElementById('commerce-pedidos-back').addEventListener('click', () => { showCommerceView('home'); refreshCommerceHome(); });

  document.getElementById('pedido-type-filter').addEventListener('change', fetchAndRenderOrders);

  document.getElementById('pedidos-table-wrap').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-order-action]');
    if (!btn) return;
    const action  = btn.dataset.orderAction;
    const orderId = btn.dataset.orderId;

    if (action === 'accept') {
      runOrderAction(orderId, 'accept');
    } else if (action === 'cancel') {
      openConfirmModal({ message: '¿Cancelar este pedido?', onConfirm: () => runOrderAction(orderId, 'cancel') });
    } else {
      openConfirmModal({
        message: '¿Confirmás la devolución de esta venta?',
        showRestock: true,
        onConfirm: (restock) => runOrderAction(orderId, 'return', restock)
      });
    }
  });

  document.getElementById('commerce-caja-back').addEventListener('click', () => { showCommerceView('home'); refreshCommerceHome(); });

  document.getElementById('btn-add-cash-register').addEventListener('click', () => openCashRegisterModal(null));
  document.getElementById('cash-registers-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-register]');
    const delBtn  = e.target.closest('[data-del-register]');
    const openBtn = e.target.closest('[data-open-session]');
    const viewBtn = e.target.closest('[data-view-session]');
    if (editBtn) openCashRegisterModal(editBtn.dataset.editRegister);
    if (openBtn) openOpenSessionModal(openBtn.dataset.openSession);
    if (viewBtn) viewCashSession(viewBtn.dataset.viewSession);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar esta caja?',
        onConfirm: async () => {
          try {
            await deleteCashRegister(currentCommerceSuit.id, delBtn.dataset.delRegister);
            showToast('Caja eliminada');
            fetchCashRegisters();
            refreshCommerceHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la caja', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-cash-register-close').addEventListener('click', closeCashRegisterModal);
  document.getElementById('modal-cash-register-cancel').addEventListener('click', closeCashRegisterModal);
  document.getElementById('modal-cash-register-save').addEventListener('click', saveCashRegister);

  document.getElementById('modal-open-cash-session-close').addEventListener('click', closeOpenSessionModal);
  document.getElementById('modal-open-cash-session-cancel').addEventListener('click', closeOpenSessionModal);
  document.getElementById('modal-open-cash-session-save').addEventListener('click', confirmOpenSession);

  document.getElementById('btn-add-cash-ingreso').addEventListener('click', () => openCashMovementModal('ingreso'));
  document.getElementById('btn-add-cash-egreso').addEventListener('click', () => openCashMovementModal('egreso'));
  document.getElementById('modal-cash-movement-close').addEventListener('click', closeCashMovementModal);
  document.getElementById('modal-cash-movement-cancel').addEventListener('click', closeCashMovementModal);
  document.getElementById('modal-cash-movement-save').addEventListener('click', saveCashMovement);

  document.getElementById('cash-movements-table-wrap').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del-movement]');
    if (!delBtn) return;
    openConfirmModal({
      message: '¿Eliminar este movimiento?',
      onConfirm: async () => {
        try {
          await deleteCashMovement(currentCommerceSuit.id, currentCashSession.id, delBtn.dataset.delMovement);
          showToast('Movimiento eliminado');
          viewCashSession(currentCashSession.id);
        } catch (err) {
          showToast(err.message || 'No se pudo eliminar el movimiento', 'err');
        }
      }
    });
  });

  document.getElementById('btn-close-cash-session').addEventListener('click', openCloseCashSessionModal);
  document.getElementById('modal-close-cash-session-close').addEventListener('click', closeCloseCashSessionModal);
  document.getElementById('modal-close-cash-session-cancel').addEventListener('click', closeCloseCashSessionModal);
  document.getElementById('modal-close-cash-session-save').addEventListener('click', confirmCloseCashSession);
}
