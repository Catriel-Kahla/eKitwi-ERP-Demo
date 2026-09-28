/**
 * scrum-plans.js
 * Sub-vista "Plans" del panel Projects: planes de alto nivel del suit,
 * independientes de los proyectos Scrum. Entry point enterPlansView(),
 * llamado desde el nav-card de projects.js (ver loadProjectsPanel).
 */

'use strict';

let lastPlansList = [];

const PLAN_STATUS_LABEL = {
  draft: { label: 'Borrador', badge: 'badge-gray' },
  in_progress: { label: 'En curso', badge: 'badge-blue' },
  done: { label: 'Cumplido', badge: 'badge-green' },
  cancelled: { label: 'Cancelado', badge: 'badge-red' }
};

async function enterPlansView() {
  showProjectsView('plans');
  gateCreateButton('btn-add-plan', 'projects');
  await fetchPlans();
}

async function fetchPlans() {
  const wrap = document.getElementById('plans-table-wrap');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    lastPlansList = await listPlans(currentProjectsSuit.id);
    renderPlansTable(wrap, lastPlansList);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los planes (${esc(err.message)}).</p>`;
  }
}

function renderPlansTable(wrap, plans) {
  if (!plans.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no hay planes. Agregá el primero.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Objetivo</th><th>Fecha objetivo</th><th>Estado</th><th></th></tr></thead>
      <tbody>${plans.map(planRow).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'projects');
}

function planRow(p) {
  const status = PLAN_STATUS_LABEL[p.status] || { label: p.status, badge: 'badge-gray' };
  const target = p.targetDate ? new Date(p.targetDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR') : '—';
  return `
    <tr>
      <td>${esc(p.objective)}</td>
      <td class="crm-muted">${target}</td>
      <td><span class="crm-badge ${status.badge}">${status.label}</span></td>
      <td class="td-actions">
        <span class="crm-action-btn" data-edit-plan="${p.id}" title="Editar">✎</span>
        <span class="crm-action-btn btn-del" data-del-plan="${p.id}" title="Eliminar">🗑</span>
      </td>
    </tr>`;
}

function openPlanModal(id) {
  const plan = id ? lastPlansList.find(p => p.id === id) : null;
  document.getElementById('modal-plan-title').textContent = plan ? 'Editar plan' : 'Nuevo plan';
  document.getElementById('modal-plan').dataset.editId = id || '';
  document.getElementById('plan-objective').value   = plan?.objective || '';
  document.getElementById('plan-notes').value        = plan?.notes || '';
  document.getElementById('plan-target-date').value  = plan?.targetDate ? plan.targetDate.slice(0, 10) : '';
  document.getElementById('plan-status').value       = plan?.status || 'draft';
  document.getElementById('modal-plan').classList.add('open');
}

function closePlanModal() {
  document.getElementById('modal-plan').classList.remove('open');
}

async function savePlan() {
  const editId     = document.getElementById('modal-plan').dataset.editId;
  const objective  = document.getElementById('plan-objective').value.trim();
  const notes      = document.getElementById('plan-notes').value.trim();
  const targetDate = document.getElementById('plan-target-date').value;
  const status     = document.getElementById('plan-status').value;

  if (!objective) { showToast('El objetivo es obligatorio', 'err'); return; }

  try {
    const dto = { objective, notes, targetDate: targetDate || null, status };
    if (editId) {
      await updatePlan(currentProjectsSuit.id, editId, dto);
      showToast('Plan actualizado');
    } else {
      await createPlan(currentProjectsSuit.id, dto);
      showToast('Plan creado');
    }
    closePlanModal();
    fetchPlans();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el plan', 'err');
  }
}

function initPlansEvents() {
  document.getElementById('proj-enter-plans').addEventListener('click', enterPlansView);
  document.getElementById('proj-plans-back').addEventListener('click', () => { showProjectsView('home'); refreshProjectsHome(); });
  document.getElementById('btn-add-plan').addEventListener('click', () => openPlanModal(null));

  document.getElementById('plans-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-plan]');
    const delBtn  = e.target.closest('[data-del-plan]');
    if (editBtn) { openPlanModal(editBtn.dataset.editPlan); return; }
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este plan?',
        onConfirm: async () => {
          try {
            await deletePlan(currentProjectsSuit.id, delBtn.dataset.delPlan);
            showToast('Plan eliminado');
            fetchPlans();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el plan', 'err');
          }
        }
      });
    }
  });

  document.getElementById('modal-plan-close').addEventListener('click', closePlanModal);
  document.getElementById('modal-plan-cancel').addEventListener('click', closePlanModal);
  document.getElementById('modal-plan-save').addEventListener('click', savePlan);
}
