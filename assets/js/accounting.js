/**
 * accounting.js
 * Accounting panel: Plan de Cuentas, Ejercicios (+ Períodos anidados),
 * Centros de Costo y Libro Diario (Asientos), reachable from a home screen
 * with entry cards — same "home + subviews" shape as inventory.js. On top
 * sits a live HUD (Caja + Patrimonio Neto derivado) fed by getBalances().
 * Entry point is loadAccountingPanel(suitId, suitName), called from
 * dashboard.js when a suit's "Accounting" sidebar button is clicked.
 *
 * Ported from the standalone eKitwi Accounting app (jQuery + Fomantic UI)
 * onto this ERP's own render/modal/openConfirmModal conventions — see
 * APIconnection.md. Unlike Projects, these five resources ARE suit-scoped
 * (/suits/:suitId/accounting/...), same pattern as Commerce/Inventory/
 * Bookings.
 */

'use strict';

let currentAccountingSuit = null;
let allCuentas   = [];
let allEjercicios = [];
let allCentros   = [];
let periodosByEjercicio = {}; // ejercicioId -> array, carga perezosa al expandir la tarjeta
let detalleRowSeq = 0;

let asientosQuery  = { ejercicioId: '', estado: '', desde: '', hasta: '', cuentaId: '', comprobante: '', skip: 0, take: ASIENTOS_PER_PAGE };
let asientosResult = { data: [], pagination: { skip: 0, take: ASIENTOS_PER_PAGE, total: 0, pages: 0 } };

// helper: <option>s de cuentas imputables ordenadas por código
function cuentasImputablesOptions(selectedId) {
  return [...allCuentas]
    .filter(c => c.imputable)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
    .map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${esc(c.codigo)} — ${esc(c.nombre)}</option>`)
    .join('');
}
function ejerciciosOptions(selectedId) {
  return allEjercicios
    .map(e => `<option value="${e.id}"${e.id === selectedId ? ' selected' : ''}>${esc(e.nombre)}</option>`)
    .join('');
}

function fmtDateAcc(d) {
  return d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR') : '—';
}

// Sin símbolo de moneda a propósito (a diferencia del fmtMoney global de
// api.js) — en el Libro Diario el "$" ya se antepone a mano donde hace
// falta, para no duplicarlo dentro de la fila "Debe: … Haber: …".
function fmtMoneyAcc(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Contabilidad gamificada: saldos en vivo + animaciones ────────────────

let lastBalances = null; // último snapshot de getBalances(), para animar deltas

function accReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Tween de un número con requestAnimationFrame + ease-out. Respeta
// prefers-reduced-motion (salta directo al valor final).
function animateNumber(el, from, to, { duration = 700, prefix = '$ ' } = {}) {
  if (!el) return;
  from = Number(from) || 0;
  to = Number(to) || 0;
  if (accReducedMotion() || from === to) {
    el.textContent = prefix + fmtMoneyAcc(to);
    return;
  }
  const start = performance.now();
  if (el._accRaf) cancelAnimationFrame(el._accRaf);
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = prefix + fmtMoneyAcc(from + (to - from) * eased);
    if (t < 1) el._accRaf = requestAnimationFrame(step);
    else el._accRaf = null;
  };
  el._accRaf = requestAnimationFrame(step);
}

// Actualiza un indicador del HUD: tween del número + pulso verde/rojo según
// si el valor subió o bajó.
function updateHudIndicator(hudId, valueId, from, to, animate) {
  const hud = document.getElementById(hudId);
  const valEl = document.getElementById(valueId);
  if (!hud || !valEl) return;

  if (!animate) {
    valEl.textContent = '$ ' + fmtMoneyAcc(to);
    return;
  }

  animateNumber(valEl, from, to);
  const dir = to > from ? 'acc-up' : (to < from ? 'acc-down' : null);
  hud.classList.remove('acc-up', 'acc-down');
  if (dir && !accReducedMotion()) {
    // reflow para reiniciar la animación si se dispara dos veces seguidas
    void hud.offsetWidth;
    hud.classList.add(dir);
    setTimeout(() => hud.classList.remove(dir), 1100);
  }
}

// Moneda que "viaja" hacia el indicador de Caja cuando un asiento la toca.
function spawnCoinFlow() {
  const fx = document.getElementById('acc-hud-caja-fx');
  if (!fx || accReducedMotion()) return;
  for (let i = 0; i < 3; i++) {
    const coin = document.createElement('span');
    coin.className = 'acc-coin';
    coin.textContent = '🪙';
    coin.style.animationDelay = (i * 120) + 'ms';
    coin.style.setProperty('--dx', ((i - 1) * 18) + 'px');
    coin.addEventListener('animationend', () => coin.remove());
    fx.appendChild(coin);
  }
}

async function refreshBalances({ animate = false, flujoCuentaIds = [] } = {}) {
  if (!currentAccountingSuit) return;

  let balances;
  try {
    balances = await getBalances(currentAccountingSuit.id);
  } catch (err) {
    // El HUD es accesorio: si falla, no rompemos el panel.
    console.warn('[accounting] no se pudieron cargar los saldos:', err.message);
    return;
  }

  const prev = lastBalances;
  lastBalances = balances;

  const fromCaja = prev ? Number(prev.caja) : Number(balances.caja);
  const fromPn   = prev ? Number(prev.patrimonioNeto) : Number(balances.patrimonioNeto);

  updateHudIndicator('acc-hud-caja', 'acc-hud-caja-value', fromCaja, Number(balances.caja), animate && !!prev);
  updateHudIndicator('acc-hud-pn',   'acc-hud-pn-value',   fromPn,   Number(balances.patrimonioNeto), animate && !!prev);

  const efectivoCuentas = balances.cuentas.filter(c => c.esEfectivo);

  const cajaSub = document.getElementById('acc-hud-caja-sub');
  if (cajaSub) {
    cajaSub.textContent = efectivoCuentas.length
      ? efectivoCuentas.map(c => c.nombre).join(' + ')
      : '⚠ Marcá una cuenta como efectivo en el Plan de Cuentas';
    cajaSub.classList.toggle('acc-hud-warn', efectivoCuentas.length === 0);
  }

  const pnSub = document.getElementById('acc-hud-pn-sub');
  if (pnSub) {
    const t = balances.totales;
    pnSub.textContent = `Activo $ ${fmtMoneyAcc(t.activo)} − Pasivo $ ${fmtMoneyAcc(t.pasivo)} · Resultado $ ${fmtMoneyAcc(t.resultadoEjercicio)}`;
  }

  if (animate && flujoCuentaIds.length) {
    const efectivoIds = new Set(efectivoCuentas.map(c => c.id));
    if (flujoCuentaIds.some(id => efectivoIds.has(id))) spawnCoinFlow();
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

async function loadAccountingPanel(suitId, suitName) {
  currentAccountingSuit = { id: suitId, name: suitName };
  lastBalances = null;
  document.getElementById('accounting-suit-label').textContent = `Contabilidad de ${suitName}`;
  showAccountingView('home');
  await refreshAccountingCore();
  await refreshBalances({ animate: false });
  await refreshAccountingHome();
}

function showAccountingView(view) {
  const setHidden = (id, hidden) => { const el = document.getElementById(id); if (el) el.hidden = hidden; };
  setHidden('accounting-home',           view !== 'home');
  setHidden('accounting-cuentas-view',    view !== 'cuentas');
  setHidden('accounting-ejercicios-view', view !== 'ejercicios');
  setHidden('accounting-centros-view',    view !== 'centros');
  setHidden('accounting-asientos-view',   view !== 'asientos');
  setHidden('accounting-mayor-view',      view !== 'mayor');
  setHidden('accounting-balcomp-view',    view !== 'balcomp');
  setHidden('accounting-esp-view',        view !== 'esp');
  setHidden('accounting-er-view',         view !== 'er');
}

async function refreshAccountingCore() {
  if (!currentAccountingSuit) return;
  try {
    [allCuentas, allEjercicios, allCentros] = await Promise.all([
      listCuentas(currentAccountingSuit.id),
      listEjercicios(currentAccountingSuit.id),
      listCentros(currentAccountingSuit.id)
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudo cargar la información contable', 'err');
  }
  periodosByEjercicio = {};
}

// ── Home ─────────────────────────────────────────────────────────────────

async function refreshAccountingHome() {
  if (!currentAccountingSuit) return;

  document.getElementById('acc-cuentas-count').textContent    = `${allCuentas.length} cuenta${allCuentas.length === 1 ? '' : 's'}`;
  document.getElementById('acc-ejercicios-count').textContent = `${allEjercicios.length} ejercicio${allEjercicios.length === 1 ? '' : 's'}`;
  document.getElementById('acc-centros-count').textContent    = `${allCentros.length} centro${allCentros.length === 1 ? '' : 's'} de costo`;

  // Los indicadores de Caja y Patrimonio Neto viven en la barra superior
  // (.acc-hud-bar). Acá sólo la tarjeta del Libro Diario: cantidad de
  // asientos confirmados.
  const asientosDesc = document.getElementById('acc-asientos-count');
  try {
    const confirmados = await listAsientos(currentAccountingSuit.id, { estado: 'confirmado', take: 1 });
    const n = confirmados.pagination.total;
    asientosDesc.textContent = `${n} asiento${n === 1 ? '' : 's'} confirmado${n === 1 ? '' : 's'}`;
  } catch (err) {
    asientosDesc.textContent = 'No se pudo cargar';
  }
}

// ══════════════════════════════════════════════════════════════════════
// PLAN DE CUENTAS
// ══════════════════════════════════════════════════════════════════════

function enterCuentas() {
  showAccountingView('cuentas');
  gateCreateButton('btn-add-cuenta', 'accounting');
  refreshCuentasList();
}

function nivelDeCuenta(cuenta) {
  let nivel = 0;
  let cursor = cuenta;
  const byId = Object.fromEntries(allCuentas.map(c => [c.id, c]));
  while (cursor && cursor.parentId) {
    nivel++;
    cursor = byId[cursor.parentId];
    if (nivel > 20) break; // guarda contra ciclos inesperados
  }
  return nivel;
}

function refreshCuentasList() {
  const wrap = document.getElementById('cuentas-table-wrap');
  if (!allCuentas.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no hay cuentas. Creá la primera del plan de cuentas.</p>';
    return;
  }

  const sorted = [...allCuentas].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th></th><th></th></tr></thead>
      <tbody>${sorted.map(cuenta => {
        const nivel = nivelDeCuenta(cuenta);
        return `
          <tr class="${!cuenta.activa ? 'crm-muted' : ''}">
            <td>${esc(cuenta.codigo)}</td>
            <td style="padding-left:${1 + nivel * 1.25}rem">${esc(cuenta.nombre)}</td>
            <td><span class="crm-badge badge-blue">${esc(TIPO_CUENTA_LABEL[cuenta.tipo] || cuenta.tipo)}</span></td>
            <td>
              ${cuenta.esEfectivo ? '<span class="crm-badge badge-green" title="Equivalente de efectivo — suma al indicador de Caja">💵 Efectivo</span>' : ''}
              ${!cuenta.imputable ? '<span class="crm-badge badge-gray" title="No admite asientos directos">Agrupamiento</span>' : ''}
              ${!cuenta.activa ? '<span class="crm-badge badge-red">Inactiva</span>' : ''}
            </td>
            <td class="td-actions">
              <span class="crm-action-btn" data-edit-cuenta="${cuenta.id}" title="Editar">✎</span>
              <span class="crm-action-btn btn-del" data-del-cuenta="${cuenta.id}" title="Eliminar">🗑</span>
            </td>
          </tr>`;
      }).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'accounting');
}

function openCuentaModal(id) {
  const cuenta = id ? allCuentas.find(c => c.id === id) : null;
  document.getElementById('modal-cuenta-title').textContent = cuenta ? 'Editar cuenta' : 'Nueva cuenta';
  document.getElementById('modal-cuenta').dataset.editId = id || '';
  document.getElementById('cuenta-codigo').value = cuenta?.codigo || '';
  document.getElementById('cuenta-nombre').value = cuenta?.nombre || '';
  document.getElementById('cuenta-tipo').value = cuenta?.tipo || 'ACTIVO';
  syncNaturalezaHint();
  document.getElementById('cuenta-imputable').checked = cuenta ? cuenta.imputable : true;
  const esEfectivoInput = document.getElementById('cuenta-es-efectivo');
  if (esEfectivoInput) esEfectivoInput.checked = cuenta ? !!cuenta.esEfectivo : false;
  document.getElementById('cuenta-activa').checked = cuenta ? cuenta.activa : true;
  document.getElementById('cuenta-activa-field').hidden = !cuenta;

  const parentSelect = document.getElementById('cuenta-parent');
  parentSelect.innerHTML = '<option value="">— Sin padre (cuenta raíz) —</option>' +
    [...allCuentas]
      .filter(c => c.id !== id) // no puede ser padre de sí misma
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
      .map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  parentSelect.value = cuenta?.parentId || '';

  document.getElementById('modal-cuenta').classList.add('open');
}

function closeCuentaModal() {
  document.getElementById('modal-cuenta').classList.remove('open');
}

// La naturaleza la determina el tipo (mismo criterio que el server): se
// muestra, no se elige.
function syncNaturalezaHint() {
  const hint = document.getElementById('cuenta-naturaleza-hint');
  if (!hint) return;
  const tipo = document.getElementById('cuenta-tipo').value;
  hint.textContent = NATURALEZA_LABEL[NATURALEZA_POR_TIPO[tipo] || 'DEUDORA'];
}

async function saveCuenta() {
  const editId     = document.getElementById('modal-cuenta').dataset.editId;
  const codigo     = document.getElementById('cuenta-codigo').value.trim();
  const nombre     = document.getElementById('cuenta-nombre').value.trim();
  const tipo       = document.getElementById('cuenta-tipo').value;
  const parentId   = document.getElementById('cuenta-parent').value || null;
  const imputable  = document.getElementById('cuenta-imputable').checked;
  const esEfectivo = !!document.getElementById('cuenta-es-efectivo')?.checked;
  const activa     = document.getElementById('cuenta-activa').checked;

  if (!codigo) { showToast('El código es obligatorio', 'err'); return; }
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }

  try {
    if (editId) {
      await updateCuenta(currentAccountingSuit.id, editId, { codigo, nombre, tipo, parentId, imputable, esEfectivo, activa });
      showToast('Cuenta actualizada');
    } else {
      await createCuenta(currentAccountingSuit.id, { codigo, nombre, tipo, parentId: parentId || undefined, imputable, esEfectivo });
      showToast('Cuenta creada');
    }
    closeCuentaModal();
    allCuentas = await listCuentas(currentAccountingSuit.id);
    refreshCuentasList();
    await refreshBalances({ animate: false }); // esEfectivo puede cambiar el saldo de Caja
    refreshAccountingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la cuenta', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// EJERCICIOS + PERÍODOS
// ══════════════════════════════════════════════════════════════════════

function enterEjercicios() {
  showAccountingView('ejercicios');
  gateCreateButton('btn-add-ejercicio', 'accounting');
  refreshEjerciciosList();
}

function refreshEjerciciosList() {
  const list = document.getElementById('ejercicios-list');
  if (!allEjercicios.length) {
    list.innerHTML = '<p class="crm-muted">No hay ejercicios todavía. Creá el primero.</p>';
    return;
  }

  const sorted = [...allEjercicios].sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
  list.innerHTML = sorted.map(ej => {
    const actions = ej.estado === 'abierto'
      ? `<button class="ghost-btn" data-edit-ejercicio="${ej.id}">Editar</button>
         <button class="ghost-btn btn-danger" data-cerrar-ejercicio="${ej.id}">Cerrar Ejercicio</button>`
      : `<button class="ghost-btn" data-reabrir-ejercicio="${ej.id}">Reabrir Ejercicio</button>`;

    return `
      <div class="sprint-card" data-id="${ej.id}">
        <div class="sprint-card-header" data-ejercicio-toggle="${ej.id}">
          <span class="sprint-toggle">▸</span>
          <span class="sprint-card-title">${esc(ej.nombre)}</span>
          <span class="crm-badge ${ESTADO_ABIERTO_BADGE[ej.estado] || 'badge-gray'}">${ej.estado === 'abierto' ? 'Abierto' : 'Cerrado'}</span>
          <span class="sprint-card-meta">${fmtDateAcc(ej.fechaInicio)} – ${fmtDateAcc(ej.fechaFin)}</span>
        </div>
        <div class="sprint-card-body" data-ejercicio-body="${ej.id}">
          <div class="sprint-actions">
            ${actions}
            <button class="primary-btn" data-add-periodo="${ej.id}" ${ej.estado !== 'abierto' ? 'disabled' : ''}>+ Nuevo Período</button>
          </div>
          <div id="periodos-${ej.id}"><p class="crm-muted">Cargando…</p></div>
        </div>
      </div>`;
  }).join('');
  gateRowActions(list, 'accounting');
}

async function toggleEjercicio(ejercicioId) {
  const header = document.querySelector(`[data-ejercicio-toggle="${ejercicioId}"]`);
  const body   = document.querySelector(`[data-ejercicio-body="${ejercicioId}"]`);
  header.querySelector('.sprint-toggle').classList.toggle('open');
  body.classList.toggle('open');

  if (body.classList.contains('open') && !periodosByEjercicio[ejercicioId]) {
    try {
      periodosByEjercicio[ejercicioId] = await listPeriodos(currentAccountingSuit.id, ejercicioId);
    } catch (err) {
      periodosByEjercicio[ejercicioId] = [];
      showToast(err.message || 'No se pudieron cargar los períodos', 'err');
    }
    refreshPeriodosList(ejercicioId);
  }
}

function refreshPeriodosList(ejercicioId) {
  const wrap = document.getElementById(`periodos-${ejercicioId}`);
  if (!wrap) return;

  const periodos = periodosByEjercicio[ejercicioId] || [];
  if (!periodos.length) {
    wrap.innerHTML = '<p class="crm-muted" style="font-size:.85rem">Sin períodos todavía.</p>';
    return;
  }

  const ejercicio = allEjercicios.find(e => e.id === ejercicioId);
  const sorted = [...periodos].sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

  wrap.innerHTML = sorted.map(p => {
    const action = p.estado === 'abierto'
      ? `<span class="crm-action-btn" data-cerrar-periodo="${p.id}" data-ejercicio-id="${ejercicioId}" title="Cerrar período">🔒</span>`
      : `<span class="crm-action-btn" data-reabrir-periodo="${p.id}" data-ejercicio-id="${ejercicioId}" title="Reabrir período"${ejercicio?.estado !== 'abierto' ? ' style="opacity:.4;pointer-events:none"' : ''}>🔓</span>`;

    return `
      <div class="sprint-story-item">
        <span class="story-title">${esc(p.nombre)} · ${fmtDateAcc(p.fechaInicio)} – ${fmtDateAcc(p.fechaFin)}</span>
        <span class="crm-badge ${ESTADO_ABIERTO_BADGE[p.estado] || 'badge-gray'}">${p.estado === 'abierto' ? 'Abierto' : 'Cerrado'}</span>
        <div class="td-actions">
          ${action}
          <span class="crm-action-btn btn-del" data-del-periodo="${p.id}" data-ejercicio-id="${ejercicioId}" title="Eliminar">🗑</span>
        </div>
      </div>`;
  }).join('');
  gateRowActions(wrap, 'accounting');
}

function openEjercicioModal(id) {
  const ej = id ? allEjercicios.find(e => e.id === id) : null;
  document.getElementById('modal-ejercicio-title').textContent = ej ? 'Editar Ejercicio' : 'Nuevo Ejercicio';
  document.getElementById('modal-ejercicio').dataset.editId = id || '';
  document.getElementById('ejercicio-nombre').value = ej?.nombre || '';
  document.getElementById('ejercicio-inicio').value = ej ? ej.fechaInicio.slice(0, 10) : '';
  document.getElementById('ejercicio-fin').value = ej ? ej.fechaFin.slice(0, 10) : '';
  document.getElementById('modal-ejercicio').classList.add('open');
}

function closeEjercicioModal() {
  document.getElementById('modal-ejercicio').classList.remove('open');
}

async function saveEjercicio() {
  const editId      = document.getElementById('modal-ejercicio').dataset.editId;
  const nombre      = document.getElementById('ejercicio-nombre').value.trim();
  const fechaInicio = document.getElementById('ejercicio-inicio').value;
  const fechaFin    = document.getElementById('ejercicio-fin').value;

  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  if (!fechaInicio || !fechaFin) { showToast('Completá las dos fechas', 'err'); return; }

  try {
    if (editId) {
      await updateEjercicio(currentAccountingSuit.id, editId, { nombre, fechaInicio, fechaFin });
      showToast('Ejercicio actualizado');
    } else {
      await createEjercicio(currentAccountingSuit.id, { nombre, fechaInicio, fechaFin });
      showToast('Ejercicio creado');
    }
    closeEjercicioModal();
    allEjercicios = await listEjercicios(currentAccountingSuit.id);
    refreshEjerciciosList();
    refreshAccountingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el ejercicio', 'err');
  }
}

async function runEjercicioAction(id, action) {
  try {
    await changeEjercicioStatus(currentAccountingSuit.id, id, action);
    showToast(action === 'cerrar' ? 'Ejercicio cerrado' : 'Ejercicio reabierto');
    allEjercicios = await listEjercicios(currentAccountingSuit.id);
    refreshEjerciciosList();
    refreshAccountingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el ejercicio', 'err');
  }
}

function openPeriodoModal(ejercicioId, id) {
  const periodos = periodosByEjercicio[ejercicioId] || [];
  const periodo  = id ? periodos.find(p => p.id === id) : null;
  document.getElementById('modal-periodo-title').textContent = periodo ? 'Editar Período' : 'Nuevo Período';
  document.getElementById('modal-periodo').dataset.ejercicioId = ejercicioId;
  document.getElementById('modal-periodo').dataset.editId = id || '';
  document.getElementById('periodo-nombre').value = periodo?.nombre || '';
  document.getElementById('periodo-inicio').value = periodo ? periodo.fechaInicio.slice(0, 10) : '';
  document.getElementById('periodo-fin').value = periodo ? periodo.fechaFin.slice(0, 10) : '';
  document.getElementById('modal-periodo').classList.add('open');
}

function closePeriodoModal() {
  document.getElementById('modal-periodo').classList.remove('open');
}

async function savePeriodo() {
  const modal       = document.getElementById('modal-periodo');
  const ejercicioId = modal.dataset.ejercicioId;
  const editId      = modal.dataset.editId;
  const nombre      = document.getElementById('periodo-nombre').value.trim();
  const fechaInicio = document.getElementById('periodo-inicio').value;
  const fechaFin    = document.getElementById('periodo-fin').value;

  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  if (!editId && (!fechaInicio || !fechaFin)) { showToast('Completá las dos fechas', 'err'); return; }

  try {
    if (editId) {
      // Las fechas de un período no se re-editan una vez creado, solo el nombre.
      await updatePeriodo(currentAccountingSuit.id, ejercicioId, editId, { nombre });
      showToast('Período actualizado');
    } else {
      await createPeriodo(currentAccountingSuit.id, ejercicioId, { nombre, fechaInicio, fechaFin });
      showToast('Período creado');
    }
    periodosByEjercicio[ejercicioId] = await listPeriodos(currentAccountingSuit.id, ejercicioId);
    closePeriodoModal();
    refreshPeriodosList(ejercicioId);
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el período', 'err');
  }
}

async function runPeriodoAction(ejercicioId, id, action) {
  try {
    await changePeriodoStatus(currentAccountingSuit.id, ejercicioId, id, action);
    periodosByEjercicio[ejercicioId] = await listPeriodos(currentAccountingSuit.id, ejercicioId);
    refreshPeriodosList(ejercicioId);
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el período', 'err');
  }
}

async function deletePeriodoAction(ejercicioId, id) {
  try {
    await deletePeriodo(currentAccountingSuit.id, ejercicioId, id);
    showToast('Período eliminado');
    periodosByEjercicio[ejercicioId] = await listPeriodos(currentAccountingSuit.id, ejercicioId);
    refreshPeriodosList(ejercicioId);
  } catch (err) {
    showToast(err.message || 'No se pudo eliminar el período', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// CENTROS DE COSTO
// ══════════════════════════════════════════════════════════════════════

function enterCentros() {
  showAccountingView('centros');
  gateCreateButton('btn-add-centro', 'accounting');
  refreshCentrosList();
}

function refreshCentrosList() {
  const wrap = document.getElementById('centros-table-wrap');
  if (!allCentros.length) {
    wrap.innerHTML = '<p class="crm-muted">No hay centros de costo todavía.</p>';
    return;
  }

  const sorted = [...allCentros].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Código</th><th>Nombre</th><th></th><th></th></tr></thead>
      <tbody>${sorted.map(centro => `
        <tr class="${!centro.activo ? 'crm-muted' : ''}">
          <td>${esc(centro.codigo)}</td>
          <td>${esc(centro.nombre)}</td>
          <td>${!centro.activo ? '<span class="crm-badge badge-red">Inactivo</span>' : ''}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-edit-centro="${centro.id}" title="Editar">✎</span>
            <span class="crm-action-btn btn-del" data-del-centro="${centro.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'accounting');
}

function openCentroModal(id) {
  const centro = id ? allCentros.find(c => c.id === id) : null;
  document.getElementById('modal-centro-title').textContent = centro ? 'Editar Centro de Costo' : 'Nuevo Centro de Costo';
  document.getElementById('modal-centro').dataset.editId = id || '';
  document.getElementById('centro-codigo').value = centro?.codigo || '';
  document.getElementById('centro-nombre').value = centro?.nombre || '';
  document.getElementById('centro-activo').checked = centro ? centro.activo : true;
  document.getElementById('centro-activo-field').hidden = !centro;
  document.getElementById('modal-centro').classList.add('open');
}

function closeCentroModal() {
  document.getElementById('modal-centro').classList.remove('open');
}

async function saveCentro() {
  const editId = document.getElementById('modal-centro').dataset.editId;
  const codigo = document.getElementById('centro-codigo').value.trim();
  const nombre = document.getElementById('centro-nombre').value.trim();
  const activo = document.getElementById('centro-activo').checked;

  if (!codigo) { showToast('El código es obligatorio', 'err'); return; }
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }

  try {
    if (editId) {
      await updateCentro(currentAccountingSuit.id, editId, { codigo, nombre, activo });
      showToast('Centro de costo actualizado');
    } else {
      await createCentro(currentAccountingSuit.id, { codigo, nombre });
      showToast('Centro de costo creado');
    }
    closeCentroModal();
    allCentros = await listCentros(currentAccountingSuit.id);
    refreshCentrosList();
    refreshAccountingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el centro de costo', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// LIBRO DIARIO (ASIENTOS)
// ══════════════════════════════════════════════════════════════════════

function enterAsientos() {
  showAccountingView('asientos');
  gateCreateButton('acc-add-asiento', 'accounting');

  document.getElementById('filter-ejercicio').innerHTML =
    '<option value="">Todos los ejercicios</option>' + ejerciciosOptions(asientosQuery.ejercicioId);
  document.getElementById('filter-cuenta').innerHTML =
    '<option value="">Todas las cuentas</option>' + cuentasImputablesOptions(asientosQuery.cuentaId);
  document.getElementById('filter-estado').value      = asientosQuery.estado;
  document.getElementById('filter-desde').value       = asientosQuery.desde;
  document.getElementById('filter-hasta').value       = asientosQuery.hasta;
  document.getElementById('filter-comprobante').value = asientosQuery.comprobante;

  fetchAsientos();
}

function limpiarFiltrosAsientos() {
  asientosQuery = { ...asientosQuery, ejercicioId: '', estado: '', desde: '', hasta: '', cuentaId: '', comprobante: '', skip: 0 };
  enterAsientos();
}

// Trae TODOS los asientos que matchean el filtro actual (paginando) y baja un CSV.
async function exportAsientosCsv() {
  const btn = document.getElementById('btn-asientos-export');
  btn.disabled = true;
  try {
    const all = [];
    let skip = 0;
    const take = 200;
    for (;;) {
      const page = await listAsientos(currentAccountingSuit.id, { ...asientosQuery, skip, take });
      all.push(...page.data);
      skip += take;
      if (skip >= page.pagination.total || !page.data.length) break;
    }
    const rows = [];
    all.forEach(a => a.detalles.forEach(d => rows.push([
      fmtDateAcc(a.fecha), a.numero, a.comprobante || '', a.descripcion,
      `${d.cuenta.codigo} — ${d.cuenta.nombre}`, d.centroCosto ? d.centroCosto.nombre : '',
      Number(d.debe) || 0, Number(d.haber) || 0, ASIENTO_ESTADO_LABEL[a.estado] || a.estado,
    ])));
    downloadCsv(`libro-diario-${new Date().toISOString().slice(0, 10)}`,
      ['Fecha', 'N°', 'Comprobante', 'Descripción', 'Cuenta', 'Centro de costo', 'Debe', 'Haber', 'Estado'], rows);
  } catch (err) {
    showToast(err.message || 'No se pudo exportar', 'err');
  } finally {
    btn.disabled = false;
  }
}

async function fetchAsientos() {
  const list = document.getElementById('asientos-list');
  list.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    asientosResult = await listAsientos(currentAccountingSuit.id, asientosQuery);
  } catch (err) {
    list.innerHTML = `<p class="crm-muted">Error al cargar: ${esc(err.message)}</p>`;
    return;
  }
  refreshAsientosList();
}

function refreshAsientosList() {
  const list  = document.getElementById('asientos-list');
  const pager = document.getElementById('asientos-pagination');
  const { data, pagination } = asientosResult;

  if (!data.length) {
    list.innerHTML = '<p class="crm-muted">No hay asientos con estos filtros.</p>';
    pager.innerHTML = '';
    return;
  }

  list.innerHTML = data.map(asiento => {
    const totalDebe = asiento.detalles.reduce((n, d) => n + Number(d.debe), 0);

    const filas = asiento.detalles.map(d => `
      <tr>
        <td>${esc(d.cuenta.codigo)} — ${esc(d.cuenta.nombre)}</td>
        <td class="crm-muted">${d.centroCosto ? esc(d.centroCosto.nombre) : '—'}</td>
        <td style="text-align:right">${Number(d.debe) > 0 ? fmtMoneyAcc(d.debe) : ''}</td>
        <td style="text-align:right">${Number(d.haber) > 0 ? fmtMoneyAcc(d.haber) : ''}</td>
      </tr>`).join('');

    let actions = '';
    if (asiento.estado === 'borrador') {
      actions += `<button class="primary-btn" data-confirmar-asiento="${asiento.id}">Confirmar</button>`;
      actions += `<button class="ghost-btn btn-danger" data-del-asiento="${asiento.id}">Eliminar</button>`;
    } else if (asiento.estado === 'confirmado') {
      actions += `<button class="ghost-btn btn-danger" data-anular-asiento="${asiento.id}">Anular</button>`;
    }

    return `
      <div class="sprint-card" data-id="${asiento.id}">
        <div class="sprint-card-header" data-asiento-toggle="${asiento.id}">
          <span class="sprint-toggle">▸</span>
          <span class="sprint-card-title">N° ${asiento.numero} — ${esc(asiento.descripcion)}</span>
          ${asiento.comprobante ? `<span class="crm-badge badge-gray" title="Comprobante">${esc(asiento.comprobante)}</span>` : ''}
          <span class="crm-badge ${ASIENTO_ESTADO_BADGE[asiento.estado] || 'badge-gray'}">${ASIENTO_ESTADO_LABEL[asiento.estado] || asiento.estado}</span>
          <span class="sprint-card-meta">${fmtDateAcc(asiento.fecha)} · $ ${fmtMoneyAcc(totalDebe)}</span>
        </div>
        <div class="sprint-card-body" data-asiento-body="${asiento.id}">
          <table class="crm-table">
            <thead><tr><th>Cuenta</th><th>Centro de costo</th><th>Debe</th><th>Haber</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
          ${actions ? `<div class="sprint-actions">${actions}</div>` : ''}
        </div>
      </div>`;
  }).join('');
  gateRowActions(list, 'accounting');

  pager.innerHTML = '';
  if (pagination.pages > 1) {
    const page = Math.floor(pagination.skip / pagination.take) + 1;
    pager.innerHTML = `
      <button class="page-btn" id="asientos-prev" ${page <= 1 ? 'disabled' : ''}>← Anterior</button>
      <span class="crm-muted" style="font-size:.85rem;align-self:center">Página ${page} de ${pagination.pages}</span>
      <button class="page-btn" id="asientos-next" ${page >= pagination.pages ? 'disabled' : ''}>Siguiente →</button>`;
  }
}

function openAsientoModal() {
  const cuentasImputables = allCuentas.filter(c => c.imputable && c.activa);
  if (!cuentasImputables.length) {
    showToast('No hay cuentas imputables activas. Creá al menos una cuenta en el Plan de Cuentas primero.', 'err');
    return;
  }

  document.getElementById('asiento-fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('asiento-descripcion').value = '';
  document.getElementById('asiento-comprobante').value = '';
  document.getElementById('detalle-editor-rows').innerHTML = '';
  addDetalleRow();
  addDetalleRow();
  recalcularTotales();

  document.getElementById('modal-asiento').classList.add('open');
}

function closeAsientoModal() {
  document.getElementById('modal-asiento').classList.remove('open');
}

function addDetalleRow() {
  const cuentasImputables = [...allCuentas]
    .filter(c => c.imputable && c.activa)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  const centrosActivos = [...allCentros]
    .filter(c => c.activo)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  const rowId = ++detalleRowSeq;
  const cuentaOptions = cuentasImputables.map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  const centroOptions = centrosActivos.map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');

  document.getElementById('detalle-editor-rows').insertAdjacentHTML('beforeend', `
    <div class="detalle-row" data-row-id="${rowId}">
      <select class="detalle-cuenta">${cuentaOptions}</select>
      <select class="detalle-centro"><option value="">— Sin centro de costo —</option>${centroOptions}</select>
      <input type="number" class="detalle-debe" placeholder="Debe" min="0" step="0.01">
      <input type="number" class="detalle-haber" placeholder="Haber" min="0" step="0.01">
      <span class="detalle-remove-btn" title="Quitar línea">✕</span>
    </div>`);
}

function recalcularTotales() {
  let totalDebe = 0, totalHaber = 0;
  document.querySelectorAll('#detalle-editor-rows .detalle-row').forEach(row => {
    totalDebe  += parseFloat(row.querySelector('.detalle-debe').value)  || 0;
    totalHaber += parseFloat(row.querySelector('.detalle-haber').value) || 0;
  });

  const diff = totalDebe - totalHaber;
  document.getElementById('total-debe').textContent = fmtMoneyAcc(totalDebe);
  document.getElementById('total-haber').textContent = fmtMoneyAcc(totalHaber);
  document.getElementById('detalle-diff').textContent = `Diferencia: ${fmtMoneyAcc(diff)}`;

  const balanceado = Math.abs(diff) < 0.005 && totalDebe > 0;
  document.getElementById('detalle-totales').classList.toggle('balanceado', balanceado);
  document.getElementById('modal-asiento-save').disabled = !balanceado;

  // Balanza: se inclina según la diferencia debe−haber. Se satura a ±12° para
  // que un desbalance grande no la haga girar de más.
  const balanza = document.getElementById('balanza');
  if (balanza) {
    const escala = Math.max(totalDebe, totalHaber, 1);
    const tilt = Math.max(-12, Math.min(12, (diff / escala) * 12));
    balanza.style.setProperty('--tilt', `${balanceado ? 0 : tilt}deg`);
    balanza.classList.toggle('balanceada', balanceado);
  }
}

// Lee las líneas del editor y valida partida doble. Devuelve el payload o
// null (mostrando el toast del error).
function collectAsientoPayload() {
  const fecha       = document.getElementById('asiento-fecha').value;
  const descripcion = document.getElementById('asiento-descripcion').value.trim();
  const comprobante = document.getElementById('asiento-comprobante').value.trim();

  if (!fecha) { showToast('Elegí una fecha', 'err'); return null; }
  if (!descripcion) { showToast('La descripción es obligatoria', 'err'); return null; }

  const detalles = [];
  let filasInvalidas = false;
  document.querySelectorAll('#detalle-editor-rows .detalle-row').forEach(row => {
    const cuentaId      = row.querySelector('.detalle-cuenta').value;
    const centroCostoId = row.querySelector('.detalle-centro').value || undefined;
    const debe  = parseFloat(row.querySelector('.detalle-debe').value)  || 0;
    const haber = parseFloat(row.querySelector('.detalle-haber').value) || 0;

    if (debe > 0 && haber > 0) filasInvalidas = true;
    if (debe === 0 && haber === 0) return; // ignora filas vacías

    detalles.push({ cuentaId, centroCostoId, debe, haber });
  });

  if (filasInvalidas) { showToast('Una línea no puede tener importe en debe y en haber a la vez', 'err'); return null; }
  if (detalles.length < 2) { showToast('Un asiento necesita al menos dos líneas con importe (partida doble)', 'err'); return null; }

  const totalDebe  = detalles.reduce((n, d) => n + d.debe, 0);
  const totalHaber = detalles.reduce((n, d) => n + d.haber, 0);
  if (Math.abs(totalDebe - totalHaber) >= 0.005) { showToast('El asiento no está balanceado', 'err'); return null; }

  return { fecha, descripcion, ...(comprobante && { comprobante }), detalles };
}

async function saveAsiento() {
  const payload = collectAsientoPayload();
  if (!payload) return;

  try {
    await createAsiento(currentAccountingSuit.id, payload);
    showToast('Asiento guardado en borrador. Confirmalo desde el Libro Diario.');
    closeAsientoModal();
    asientosQuery.skip = 0;
    fetchAsientos();
    refreshAccountingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el asiento', 'err');
  }
}

async function runAsientoAction(id, action) {
  const asiento = asientosResult.data.find(a => a.id === id);
  const flujoCuentaIds = asiento ? asiento.detalles.map(d => d.cuentaId) : [];
  try {
    await changeAsientoStatus(currentAccountingSuit.id, id, action);
    showToast(action === 'confirmar' ? 'Asiento confirmado' : 'Asiento anulado');
    fetchAsientos();
    refreshAccountingHome();
    // Confirmar y anular ambos mueven saldos (anular saca el asiento del cálculo).
    refreshBalances({ animate: true, flujoCuentaIds });
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el asiento', 'err');
  }
}

async function deleteAsientoAction(id) {
  try {
    await deleteAsiento(currentAccountingSuit.id, id);
    showToast('Asiento eliminado');
    fetchAsientos();
    refreshAccountingHome();
  } catch (err) {
    showToast(err.message || 'No se pudo eliminar el asiento', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// REPORTES: Libro Mayor · Balance de comprobación · Estados contables
// ══════════════════════════════════════════════════════════════════════

const money = n => '$ ' + fmtMoneyAcc(Number(n) || 0);

function reportHeaderHtml(titulo, opts) {
  const partes = [];
  if (opts.ejercicioId) {
    const ej = allEjercicios.find(e => e.id === opts.ejercicioId);
    if (ej) partes.push(esc(ej.nombre));
  } else {
    partes.push('Todos los ejercicios');
  }
  partes.push(opts.hasta ? `al ${fmtDateAcc(opts.hasta)}` : 'a la fecha');
  return `<h1>${esc(titulo)}</h1><p class="rep-sub">${esc(currentAccountingSuit.name)} · ${partes.join(' · ')} · sólo asientos confirmados</p>`;
}

// ── Libro Mayor ─────────────────────────────────────────────────────────

let mayorData = null;

function enterMayor() {
  showAccountingView('mayor');
  document.getElementById('mayor-cuenta').innerHTML =
    '<option value="">Elegí una cuenta…</option>' + cuentasImputablesOptions(document.getElementById('mayor-cuenta').value);
  document.getElementById('mayor-ejercicio').innerHTML =
    '<option value="">Todos los ejercicios</option>' + ejerciciosOptions(document.getElementById('mayor-ejercicio').value);
  renderMayor();
}

async function renderMayor() {
  const wrap = document.getElementById('mayor-result');
  const cuentaId = document.getElementById('mayor-cuenta').value;
  mayorData = null;
  if (!cuentaId) { wrap.innerHTML = '<p class="crm-muted">Elegí una cuenta para ver su mayor.</p>'; return; }

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const opts = {
    cuentaId,
    ejercicioId: document.getElementById('mayor-ejercicio').value || undefined,
    desde: document.getElementById('mayor-desde').value || undefined,
    hasta: document.getElementById('mayor-hasta').value || undefined,
  };
  let m;
  try {
    m = await getMayor(currentAccountingSuit.id, opts);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">Error: ${esc(err.message)}</p>`;
    return;
  }
  mayorData = m;

  const filas = m.movimientos.map(mv => `
    <tr>
      <td>${fmtDateAcc(mv.fecha)}</td>
      <td>${mv.numero}</td>
      <td class="crm-muted">${esc(mv.comprobante || '—')}</td>
      <td>${esc(mv.descripcion)}</td>
      <td style="text-align:right">${Number(mv.debe) ? fmtMoneyAcc(mv.debe) : ''}</td>
      <td style="text-align:right">${Number(mv.haber) ? fmtMoneyAcc(mv.haber) : ''}</td>
      <td style="text-align:right">${fmtMoneyAcc(mv.saldo)}</td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div class="crm-section-title">${esc(m.cuenta.codigo)} — ${esc(m.cuenta.nombre)}
      <span class="crm-badge badge-blue">${esc(NATURALEZA_LABEL[m.cuenta.naturaleza] || m.cuenta.naturaleza)}</span></div>
    <div class="crm-table-wrap">
      <table class="crm-table">
        <thead><tr><th>Fecha</th><th>N°</th><th>Comprob.</th><th>Descripción</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
        <tbody>
          <tr class="report-total-row"><td colspan="6">Saldo inicial</td><td style="text-align:right">${fmtMoneyAcc(m.saldoInicial)}</td></tr>
          ${filas || '<tr><td colspan="7" class="crm-muted">Sin movimientos en el período.</td></tr>'}
          <tr class="report-total-row">
            <td colspan="4">Totales del período</td>
            <td style="text-align:right">${fmtMoneyAcc(m.totales.debe)}</td>
            <td style="text-align:right">${fmtMoneyAcc(m.totales.haber)}</td>
            <td style="text-align:right">${fmtMoneyAcc(m.saldoFinal)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function exportMayorCsv() {
  if (!mayorData) { showToast('Elegí una cuenta primero', 'err'); return; }
  const m = mayorData;
  const rows = [['', '', '', 'Saldo inicial', '', '', m.saldoInicial]];
  m.movimientos.forEach(mv => rows.push([fmtDateAcc(mv.fecha), mv.numero, mv.comprobante || '', mv.descripcion, Number(mv.debe) || 0, Number(mv.haber) || 0, mv.saldo]));
  rows.push(['', '', '', 'Totales del período', m.totales.debe, m.totales.haber, m.saldoFinal]);
  downloadCsv(`libro-mayor-${slugify(m.cuenta.nombre)}`,
    ['Fecha', 'N°', 'Comprobante', 'Descripción', 'Debe', 'Haber', 'Saldo'], rows);
}

// ── Balance de comprobación (sumas y saldos) ────────────────────────────

let balCompRows = null;

function enterBalComp() {
  showAccountingView('balcomp');
  document.getElementById('balcomp-ejercicio').innerHTML =
    '<option value="">Todos los ejercicios</option>' + ejerciciosOptions(document.getElementById('balcomp-ejercicio').value);
  renderBalComp();
}

function balCompOpts() {
  return {
    ejercicioId: document.getElementById('balcomp-ejercicio').value || undefined,
    hasta: document.getElementById('balcomp-hasta').value || undefined,
  };
}

async function renderBalComp() {
  const wrap = document.getElementById('balcomp-result');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  let bal;
  try { bal = await getBalances(currentAccountingSuit.id, balCompOpts()); }
  catch (err) { wrap.innerHTML = `<p class="crm-muted">Error: ${esc(err.message)}</p>`; return; }

  const cuentas = bal.cuentas.filter(c => Number(c.debe) || Number(c.haber));
  let tD = 0, tH = 0, tSD = 0, tSA = 0;
  const filas = cuentas.map(c => {
    const debe = Number(c.debe), haber = Number(c.haber), raw = debe - haber;
    const sd = raw > 0 ? raw : 0, sa = raw < 0 ? -raw : 0;
    tD += debe; tH += haber; tSD += sd; tSA += sa;
    return `<tr>
      <td>${esc(c.codigo)}</td><td>${esc(c.nombre)}</td>
      <td style="text-align:right">${fmtMoneyAcc(debe)}</td>
      <td style="text-align:right">${fmtMoneyAcc(haber)}</td>
      <td style="text-align:right">${sd ? fmtMoneyAcc(sd) : ''}</td>
      <td style="text-align:right">${sa ? fmtMoneyAcc(sa) : ''}</td>
    </tr>`;
  }).join('');

  const okSumas = Math.abs(tD - tH) < 0.005;
  const okSaldos = Math.abs(tSD - tSA) < 0.005;
  balCompRows = { cuentas, tD, tH, tSD, tSA };

  wrap.innerHTML = `
    <div class="crm-table-wrap">
      <table class="crm-table">
        <thead><tr><th>Código</th><th>Cuenta</th><th>Sumas Debe</th><th>Sumas Haber</th><th>Saldo Deudor</th><th>Saldo Acreedor</th></tr></thead>
        <tbody>
          ${filas || '<tr><td colspan="6" class="crm-muted">Sin movimientos.</td></tr>'}
          <tr class="report-total-row">
            <td colspan="2">Totales</td>
            <td style="text-align:right">${fmtMoneyAcc(tD)}</td>
            <td style="text-align:right">${fmtMoneyAcc(tH)}</td>
            <td style="text-align:right">${fmtMoneyAcc(tSD)}</td>
            <td style="text-align:right">${fmtMoneyAcc(tSA)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="${okSumas ? 'report-check-ok' : 'report-check-bad'}">${okSumas ? '✔' : '✗'} Sumas: Debe ${money(tD)} ${okSumas ? '=' : '≠'} Haber ${money(tH)}</p>
    <p class="${okSaldos ? 'report-check-ok' : 'report-check-bad'}">${okSaldos ? '✔' : '✗'} Saldos: Deudor ${money(tSD)} ${okSaldos ? '=' : '≠'} Acreedor ${money(tSA)}</p>`;
}

function exportBalCompCsv() {
  if (!balCompRows) return;
  const rows = balCompRows.cuentas.map(c => {
    const debe = Number(c.debe), haber = Number(c.haber), raw = debe - haber;
    return [c.codigo, c.nombre, debe, haber, raw > 0 ? raw : 0, raw < 0 ? -raw : 0];
  });
  rows.push(['', 'TOTALES', balCompRows.tD, balCompRows.tH, balCompRows.tSD, balCompRows.tSA]);
  downloadCsv(`balance-comprobacion-${new Date().toISOString().slice(0, 10)}`,
    ['Código', 'Cuenta', 'Sumas Debe', 'Sumas Haber', 'Saldo Deudor', 'Saldo Acreedor'], rows);
}

// ── Estados contables (comparten getBalances) ──────────────────────────

function saldosPorTipo(bal, tipo) {
  return bal.cuentas.filter(c => c.tipo === tipo && Math.abs(Number(c.saldo)) > 0.005);
}
function bloqueEstadoHtml(titulo, cuentas, total, extraRows = '') {
  const filas = cuentas.map(c => `<tr><td>${esc(c.codigo)}</td><td>${esc(c.nombre)}</td><td class="num" style="text-align:right">${fmtMoneyAcc(c.saldo)}</td></tr>`).join('');
  return `
    <tr class="rep-section"><td colspan="3">${esc(titulo)}</td></tr>
    ${filas || '<tr><td colspan="3" class="crm-muted">Sin saldos.</td></tr>'}
    ${extraRows}
    <tr class="report-total-row rep-total"><td colspan="2">Total ${esc(titulo)}</td><td class="num" style="text-align:right">${fmtMoneyAcc(total)}</td></tr>`;
}

let espBal = null, erBal = null;

function enterEsp() {
  showAccountingView('esp');
  document.getElementById('esp-ejercicio').innerHTML =
    '<option value="">Todos los ejercicios</option>' + ejerciciosOptions(document.getElementById('esp-ejercicio').value);
  renderEsp();
}
function enterEr() {
  showAccountingView('er');
  document.getElementById('er-ejercicio').innerHTML =
    '<option value="">Todos los ejercicios</option>' + ejerciciosOptions(document.getElementById('er-ejercicio').value);
  renderEr();
}

async function renderEsp() {
  const wrap = document.getElementById('esp-result');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const opts = { ejercicioId: document.getElementById('esp-ejercicio').value || undefined, hasta: document.getElementById('esp-hasta').value || undefined };
  let bal;
  try { bal = await getBalances(currentAccountingSuit.id, opts); }
  catch (err) { wrap.innerHTML = `<p class="crm-muted">Error: ${esc(err.message)}</p>`; return; }
  espBal = { bal, opts };

  const t = bal.totales;
  const resultado = Number(t.resultadoEjercicio);
  const pnTotal = Number(t.patrimonioNetoContable) + resultado;
  const activo = Number(t.activo), pasivo = Number(t.pasivo);
  const cuadra = Math.abs(activo - (pasivo + pnTotal)) < 0.005;

  const resultadoRow = `<tr><td colspan="2">Resultado del ejercicio</td><td class="num" style="text-align:right">${fmtMoneyAcc(resultado)}</td></tr>`;

  wrap.innerHTML = `
    <div class="crm-table-wrap">
      <table class="crm-table report-table">
        <thead><tr><th>Código</th><th>Cuenta</th><th style="text-align:right">Saldo</th></tr></thead>
        <tbody>
          ${bloqueEstadoHtml('ACTIVO', saldosPorTipo(bal, 'ACTIVO'), activo)}
          ${bloqueEstadoHtml('PASIVO', saldosPorTipo(bal, 'PASIVO'), pasivo)}
          ${bloqueEstadoHtml('PATRIMONIO NETO', saldosPorTipo(bal, 'PATRIMONIO_NETO'), pnTotal, resultadoRow)}
        </tbody>
      </table>
    </div>
    <p class="${cuadra ? 'report-check-ok' : 'report-check-bad'}">${cuadra ? '✔' : '✗'} Activo ${money(activo)} ${cuadra ? '=' : '≠'} Pasivo ${money(pasivo)} + Patrimonio Neto ${money(pnTotal)}</p>`;
}

async function renderEr() {
  const wrap = document.getElementById('er-result');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const opts = { ejercicioId: document.getElementById('er-ejercicio').value || undefined, hasta: document.getElementById('er-hasta').value || undefined };
  let bal;
  try { bal = await getBalances(currentAccountingSuit.id, opts); }
  catch (err) { wrap.innerHTML = `<p class="crm-muted">Error: ${esc(err.message)}</p>`; return; }
  erBal = { bal, opts };

  const t = bal.totales;
  const ingresos = Number(t.ingresos), egresos = Number(t.egresos), resultado = Number(t.resultadoEjercicio);
  const gana = resultado >= 0;

  wrap.innerHTML = `
    <div class="crm-table-wrap">
      <table class="crm-table report-table">
        <thead><tr><th>Código</th><th>Cuenta</th><th style="text-align:right">Saldo</th></tr></thead>
        <tbody>
          ${bloqueEstadoHtml('INGRESOS', saldosPorTipo(bal, 'INGRESO'), ingresos)}
          ${bloqueEstadoHtml('EGRESOS', saldosPorTipo(bal, 'EGRESO'), egresos)}
          <tr class="report-total-row rep-total"><td colspan="2">${gana ? 'GANANCIA' : 'PÉRDIDA'} del ejercicio (Ingresos − Egresos)</td><td class="num ${gana ? 'report-check-ok' : 'report-check-bad'}" style="text-align:right">${fmtMoneyAcc(resultado)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

// Filas planas [seccion|cuenta, '', importe] para CSV/impresión de un estado.
function estadoFilas(bal, bloques) {
  const out = [];
  bloques.forEach(([titulo, tipo, total, extra]) => {
    out.push([titulo, '', '']);
    saldosPorTipo(bal, tipo).forEach(c => out.push([c.codigo, c.nombre, Number(c.saldo)]));
    (extra || []).forEach(r => out.push(r));
    out.push([`Total ${titulo}`, '', total]);
  });
  return out;
}

function exportEspCsv() {
  if (!espBal) return;
  const { bal } = espBal;
  const t = bal.totales;
  const resultado = Number(t.resultadoEjercicio);
  const rows = estadoFilas(bal, [
    ['ACTIVO', 'ACTIVO', Number(t.activo)],
    ['PASIVO', 'PASIVO', Number(t.pasivo)],
    ['PATRIMONIO NETO', 'PATRIMONIO_NETO', Number(t.patrimonioNetoContable) + resultado, [['Resultado del ejercicio', '', resultado]]],
  ]);
  downloadCsv(`estado-situacion-patrimonial-${new Date().toISOString().slice(0, 10)}`, ['Concepto', 'Cuenta', 'Importe'], rows);
}
function exportErCsv() {
  if (!erBal) return;
  const { bal } = erBal;
  const t = bal.totales;
  const rows = estadoFilas(bal, [
    ['INGRESOS', 'INGRESO', Number(t.ingresos)],
    ['EGRESOS', 'EGRESO', Number(t.egresos)],
  ]);
  rows.push(['RESULTADO DEL EJERCICIO', '', Number(t.resultadoEjercicio)]);
  downloadCsv(`estado-de-resultados-${new Date().toISOString().slice(0, 10)}`, ['Concepto', 'Cuenta', 'Importe'], rows);
}

function printEstado(kind) {
  const ctx = kind === 'esp' ? espBal : erBal;
  if (!ctx) { showToast('Esperá a que cargue el reporte', 'err'); return; }
  const titulo = kind === 'esp' ? 'Estado de Situación Patrimonial' : 'Estado de Resultados';
  const tableHtml = document.getElementById(kind === 'esp' ? 'esp-result' : 'er-result').innerHTML;
  printReport(titulo, reportHeaderHtml(titulo, ctx.opts) + tableHtml);
}

// ── Event wiring ─────────────────────────────────────────────────────────

// accOn(id, ev, fn): wire defensivo — si el id no está (deploy a medias: JS nuevo
// vs HTML cacheado o al revés) no tira y no corta el resto del wiring.
function accOn(id, ev, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
}

function initAccountingEvents() {
  accOn('acc-add-asiento', 'click', openAsientoModal);
  accOn('acc-enter-cuentas', 'click', enterCuentas);
  accOn('acc-enter-ejercicios', 'click', enterEjercicios);
  accOn('acc-enter-centros', 'click', enterCentros);
  accOn('acc-enter-asientos', 'click', enterAsientos);
  accOn('acc-enter-mayor', 'click', enterMayor);
  accOn('acc-enter-balcomp', 'click', enterBalComp);
  accOn('acc-enter-esp', 'click', enterEsp);
  accOn('acc-enter-er', 'click', enterEr);

  // ── Reportes (Libro Mayor / Balance de comprobación / Estados) ────────
  const volverHome = () => { showAccountingView('home'); refreshAccountingHome(); };
  accOn('acc-mayor-back', 'click', volverHome);
  accOn('acc-balcomp-back', 'click', volverHome);
  accOn('acc-esp-back', 'click', volverHome);
  accOn('acc-er-back', 'click', volverHome);

  ['mayor-cuenta', 'mayor-ejercicio', 'mayor-desde', 'mayor-hasta'].forEach(id => accOn(id, 'change', renderMayor));
  accOn('btn-mayor-export', 'click', exportMayorCsv);

  ['balcomp-ejercicio', 'balcomp-hasta'].forEach(id => accOn(id, 'change', renderBalComp));
  accOn('btn-balcomp-export', 'click', exportBalCompCsv);
  accOn('btn-balcomp-print', 'click', () =>
    printReport('Balance de comprobación', reportHeaderHtml('Balance de comprobación', balCompOpts()) + document.getElementById('balcomp-result').innerHTML));

  ['esp-ejercicio', 'esp-hasta'].forEach(id => accOn(id, 'change', renderEsp));
  accOn('btn-esp-export', 'click', exportEspCsv);
  accOn('btn-esp-print', 'click', () => printEstado('esp'));

  ['er-ejercicio', 'er-hasta'].forEach(id => accOn(id, 'change', renderEr));
  accOn('btn-er-export', 'click', exportErCsv);
  accOn('btn-er-print', 'click', () => printEstado('er'));

  // ── Plan de Cuentas ──────────────────────────────────────────────────
  document.getElementById('acc-cuentas-back').addEventListener('click', () => { showAccountingView('home'); refreshAccountingHome(); });
  document.getElementById('btn-add-cuenta').addEventListener('click', () => openCuentaModal(null));
  document.getElementById('cuentas-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-cuenta]');
    const delBtn  = e.target.closest('[data-del-cuenta]');
    if (editBtn) openCuentaModal(editBtn.dataset.editCuenta);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar esta cuenta contable?',
        onConfirm: async () => {
          try {
            await deleteCuenta(currentAccountingSuit.id, delBtn.dataset.delCuenta);
            showToast('Cuenta eliminada');
            allCuentas = await listCuentas(currentAccountingSuit.id);
            refreshCuentasList();
            await refreshBalances({ animate: false });
            refreshAccountingHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la cuenta', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-cuenta-close').addEventListener('click', closeCuentaModal);
  document.getElementById('modal-cuenta-cancel').addEventListener('click', closeCuentaModal);
  document.getElementById('modal-cuenta-save').addEventListener('click', saveCuenta);
  // ?. defensivo: durante un cambio de versión el navegador puede servir
  // brevemente un accounting.js nuevo contra un dashboard.html cacheado viejo
  // (o al revés) — un id faltante no tiene que tumbar todo el wiring del panel.
  document.getElementById('cuenta-tipo')?.addEventListener('change', syncNaturalezaHint);

  // ── Ejercicios + Períodos ────────────────────────────────────────────
  document.getElementById('acc-ejercicios-back').addEventListener('click', () => { showAccountingView('home'); refreshAccountingHome(); });
  document.getElementById('btn-add-ejercicio').addEventListener('click', () => openEjercicioModal(null));
  document.getElementById('ejercicios-list').addEventListener('click', (e) => {
    const editBtn         = e.target.closest('[data-edit-ejercicio]');
    const cerrarBtn       = e.target.closest('[data-cerrar-ejercicio]');
    const reabrirBtn      = e.target.closest('[data-reabrir-ejercicio]');
    const addPeriodoBtn   = e.target.closest('[data-add-periodo]');
    const cerrarPerBtn    = e.target.closest('[data-cerrar-periodo]');
    const reabrirPerBtn   = e.target.closest('[data-reabrir-periodo]');
    const delPerBtn       = e.target.closest('[data-del-periodo]');
    const toggle          = e.target.closest('[data-ejercicio-toggle]');

    if (editBtn)       { openEjercicioModal(editBtn.dataset.editEjercicio); return; }
    if (cerrarBtn) {
      openConfirmModal({
        message: '¿Cerrar este ejercicio? Hace falta que todos sus períodos estén cerrados.',
        onConfirm: () => runEjercicioAction(cerrarBtn.dataset.cerrarEjercicio, 'cerrar')
      });
      return;
    }
    if (reabrirBtn)    { runEjercicioAction(reabrirBtn.dataset.reabrirEjercicio, 'reabrir'); return; }
    if (addPeriodoBtn) { openPeriodoModal(addPeriodoBtn.dataset.addPeriodo, null); return; }
    if (cerrarPerBtn)  { runPeriodoAction(cerrarPerBtn.dataset.ejercicioId, cerrarPerBtn.dataset.cerrarPeriodo, 'cerrar'); return; }
    if (reabrirPerBtn) { runPeriodoAction(reabrirPerBtn.dataset.ejercicioId, reabrirPerBtn.dataset.reabrirPeriodo, 'reabrir'); return; }
    if (delPerBtn) {
      openConfirmModal({
        message: '¿Eliminar este período?',
        onConfirm: () => deletePeriodoAction(delPerBtn.dataset.ejercicioId, delPerBtn.dataset.delPeriodo)
      });
      return;
    }
    if (toggle) toggleEjercicio(toggle.dataset.ejercicioToggle);
  });
  document.getElementById('modal-ejercicio-close').addEventListener('click', closeEjercicioModal);
  document.getElementById('modal-ejercicio-cancel').addEventListener('click', closeEjercicioModal);
  document.getElementById('modal-ejercicio-save').addEventListener('click', saveEjercicio);
  document.getElementById('modal-periodo-close').addEventListener('click', closePeriodoModal);
  document.getElementById('modal-periodo-cancel').addEventListener('click', closePeriodoModal);
  document.getElementById('modal-periodo-save').addEventListener('click', savePeriodo);

  // ── Centros de Costo ─────────────────────────────────────────────────
  document.getElementById('acc-centros-back').addEventListener('click', () => { showAccountingView('home'); refreshAccountingHome(); });
  document.getElementById('btn-add-centro').addEventListener('click', () => openCentroModal(null));
  document.getElementById('centros-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-centro]');
    const delBtn  = e.target.closest('[data-del-centro]');
    if (editBtn) openCentroModal(editBtn.dataset.editCentro);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este centro de costo?',
        onConfirm: async () => {
          try {
            await deleteCentro(currentAccountingSuit.id, delBtn.dataset.delCentro);
            showToast('Centro de costo eliminado');
            allCentros = await listCentros(currentAccountingSuit.id);
            refreshCentrosList();
            refreshAccountingHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el centro de costo', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-centro-close').addEventListener('click', closeCentroModal);
  document.getElementById('modal-centro-cancel').addEventListener('click', closeCentroModal);
  document.getElementById('modal-centro-save').addEventListener('click', saveCentro);

  // ── Libro Diario (Asientos) ──────────────────────────────────────────
  document.getElementById('acc-asientos-back').addEventListener('click', () => { showAccountingView('home'); refreshAccountingHome(); });
  const asientoFiltro = (id, key, ev = 'change') => document.getElementById(id).addEventListener(ev, (e) => {
    asientosQuery[key] = e.target.value;
    asientosQuery.skip = 0;
    fetchAsientos();
  });
  asientoFiltro('filter-ejercicio', 'ejercicioId');
  asientoFiltro('filter-estado', 'estado');
  asientoFiltro('filter-cuenta', 'cuentaId');
  asientoFiltro('filter-desde', 'desde');
  asientoFiltro('filter-hasta', 'hasta');
  asientoFiltro('filter-comprobante', 'comprobante'); // change (Enter/blur), no un fetch por tecla
  document.getElementById('btn-asientos-limpiar').addEventListener('click', limpiarFiltrosAsientos);
  document.getElementById('btn-asientos-export').addEventListener('click', exportAsientosCsv);
  document.getElementById('asientos-pagination').addEventListener('click', (e) => {
    if (e.target.closest('#asientos-prev')) { asientosQuery.skip = Math.max(0, asientosQuery.skip - asientosQuery.take); fetchAsientos(); }
    if (e.target.closest('#asientos-next')) { asientosQuery.skip += asientosQuery.take; fetchAsientos(); }
  });
  document.getElementById('asientos-list').addEventListener('click', (e) => {
    const confirmarBtn = e.target.closest('[data-confirmar-asiento]');
    const anularBtn    = e.target.closest('[data-anular-asiento]');
    const delBtn       = e.target.closest('[data-del-asiento]');
    const toggle       = e.target.closest('[data-asiento-toggle]');

    if (confirmarBtn) { runAsientoAction(confirmarBtn.dataset.confirmarAsiento, 'confirmar'); return; }
    if (anularBtn) {
      openConfirmModal({
        message: '¿Anular este asiento? Esta acción no genera un contra-asiento automático.',
        onConfirm: () => runAsientoAction(anularBtn.dataset.anularAsiento, 'anular')
      });
      return;
    }
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este borrador de asiento?',
        onConfirm: () => deleteAsientoAction(delBtn.dataset.delAsiento)
      });
      return;
    }
    if (toggle) {
      toggle.querySelector('.sprint-toggle').classList.toggle('open');
      document.querySelector(`[data-asiento-body="${toggle.dataset.asientoToggle}"]`).classList.toggle('open');
    }
  });
  document.getElementById('modal-asiento-close').addEventListener('click', closeAsientoModal);
  document.getElementById('modal-asiento-cancel').addEventListener('click', closeAsientoModal);
  document.getElementById('modal-asiento-save').addEventListener('click', saveAsiento);
  document.getElementById('btn-add-detalle-row').addEventListener('click', () => { addDetalleRow(); recalcularTotales(); });
  document.getElementById('detalle-editor-rows').addEventListener('click', (e) => {
    const rm = e.target.closest('.detalle-remove-btn');
    if (rm) { rm.closest('.detalle-row').remove(); recalcularTotales(); }
  });
  document.getElementById('detalle-editor-rows').addEventListener('input', (e) => {
    if (e.target.classList.contains('detalle-debe') || e.target.classList.contains('detalle-haber')) recalcularTotales();
  });
}
