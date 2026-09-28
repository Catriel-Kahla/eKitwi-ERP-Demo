/**
 * scrum-ideas.js
 * Sub-vista "Ideas" del panel Projects: anotaciones libres del equipo,
 * independientes de los proyectos Scrum. Entry point enterIdeasView(),
 * llamado desde el nav-card de projects.js (ver loadProjectsPanel).
 */

'use strict';

let lastIdeasList = [];

const IDEA_STATUS_LABEL = {
  new: { label: 'Nueva', badge: 'badge-blue' },
  in_review: { label: 'En revisión', badge: 'badge-yellow' },
  approved: { label: 'Aprobada', badge: 'badge-green' },
  discarded: { label: 'Descartada', badge: 'badge-gray' }
};

async function enterIdeasView() {
  showProjectsView('ideas');
  gateCreateButton('btn-add-idea', 'projects');
  await fetchIdeas();
}

async function fetchIdeas() {
  const wrap = document.getElementById('ideas-table-wrap');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    lastIdeasList = await listIdeas(currentProjectsSuit.id);
    renderIdeasTable(wrap, lastIdeasList);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar las ideas (${esc(err.message)}).</p>`;
  }
}

function renderIdeasTable(wrap, ideas) {
  if (!ideas.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no hay ideas anotadas. Agregá la primera.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Título</th><th>Tags</th><th>Estado</th><th>Creada</th><th></th></tr></thead>
      <tbody>${ideas.map(ideaRow).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'projects');
}

function ideaRow(i) {
  const status = IDEA_STATUS_LABEL[i.status] || { label: i.status, badge: 'badge-gray' };
  const created = new Date(i.createdAt).toLocaleDateString('es-AR');
  return `
    <tr>
      <td>${esc(i.title)}</td>
      <td class="crm-muted">${esc(i.tags || '—')}</td>
      <td><span class="crm-badge ${status.badge}">${status.label}</span></td>
      <td class="crm-muted">${created}</td>
      <td class="td-actions">
        <span class="crm-action-btn" data-edit-idea="${i.id}" title="Editar">✎</span>
        <span class="crm-action-btn btn-del" data-del-idea="${i.id}" title="Eliminar">🗑</span>
      </td>
    </tr>`;
}

function openIdeaModal(id) {
  const idea = id ? lastIdeasList.find(i => i.id === id) : null;
  document.getElementById('modal-idea-title').textContent = idea ? 'Editar idea' : 'Nueva idea';
  document.getElementById('modal-idea').dataset.editId = id || '';
  document.getElementById('idea-title').value  = idea?.title || '';
  document.getElementById('idea-notes').value  = idea?.notes || '';
  document.getElementById('idea-tags').value   = idea?.tags || '';
  document.getElementById('idea-status').value = idea?.status || 'new';
  document.getElementById('modal-idea').classList.add('open');
}

function closeIdeaModal() {
  document.getElementById('modal-idea').classList.remove('open');
}

async function saveIdea() {
  const editId = document.getElementById('modal-idea').dataset.editId;
  const title  = document.getElementById('idea-title').value.trim();
  const notes  = document.getElementById('idea-notes').value.trim();
  const tags   = document.getElementById('idea-tags').value.trim();
  const status = document.getElementById('idea-status').value;

  if (!title) { showToast('El título es obligatorio', 'err'); return; }

  try {
    const dto = { title, notes, tags: tags || null, status };
    if (editId) {
      await updateIdea(currentProjectsSuit.id, editId, dto);
      showToast('Idea actualizada');
    } else {
      await createIdea(currentProjectsSuit.id, dto);
      showToast('Idea creada');
    }
    closeIdeaModal();
    fetchIdeas();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la idea', 'err');
  }
}

function initIdeasEvents() {
  document.getElementById('proj-enter-ideas').addEventListener('click', enterIdeasView);
  document.getElementById('proj-ideas-back').addEventListener('click', () => { showProjectsView('home'); refreshProjectsHome(); });
  document.getElementById('btn-add-idea').addEventListener('click', () => openIdeaModal(null));

  document.getElementById('ideas-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-idea]');
    const delBtn  = e.target.closest('[data-del-idea]');
    if (editBtn) { openIdeaModal(editBtn.dataset.editIdea); return; }
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar esta idea?',
        onConfirm: async () => {
          try {
            await deleteIdea(currentProjectsSuit.id, delBtn.dataset.delIdea);
            showToast('Idea eliminada');
            fetchIdeas();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la idea', 'err');
          }
        }
      });
    }
  });

  document.getElementById('modal-idea-close').addEventListener('click', closeIdeaModal);
  document.getElementById('modal-idea-cancel').addEventListener('click', closeIdeaModal);
  document.getElementById('modal-idea-save').addEventListener('click', saveIdea);
}
