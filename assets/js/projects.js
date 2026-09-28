/**
 * projects.js
 * Panel Projects: home (Ideas / Plans / Proyectos) + el área Scrum
 * (Proyectos → Backlog / Sprints / Tablero / Métricas). Entry point es
 * loadProjectsPanel(suitId, suitName), llamado desde dashboard.js cuando
 * se clickea el tab "Projects" del suit. Ideas y Plans viven en
 * scrum-ideas.js / scrum-plans.js — este archivo cubre el home y el área
 * Scrum. Suit-scoped como el resto del ERP (ver [[project_suit_team_permissions]]).
 */

'use strict';

let currentProjectsSuit  = null;
let currentProjectsView  = 'home'; // 'home' | 'ideas' | 'plans' | 'scrum'
let currentProject       = null; // full project row {id, name, description, color, ...}
let projectStories       = [];
let projectSprints       = [];
let projectSprintStories = []; // sprint-story links for the whole project, joined with story fields
let activeProjectsTab    = 'backlog';
let lastProjectsGrid     = [];
let selectedProjectColor = PROJECT_COLORS[0];
let sprintsView          = 'list'; // 'list' | 'timeline' — vista activa dentro de la tab Sprints
let boardAssigneeFilter  = ''; // '' = todos — filtro client-side del tablero

// ── Date helpers (para el cronograma) ───────────────────────────────────

const MS_DAY = 86400000;
const TIMELINE_DAY_WIDTH = 34;

function parseDateOnly(str) {
  return new Date(str.slice(0, 10) + 'T00:00:00');
}
function addDays(date, n) {
  return new Date(date.getTime() + n * MS_DAY);
}
function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ── Entry point ──────────────────────────────────────────────────────────

async function loadProjectsPanel(suitId, suitName) {
  currentProjectsSuit = { id: suitId, name: suitName };
  document.getElementById('projects-suit-label').textContent = `Projects de ${suitName}`;
  showProjectsView('home');
  await refreshProjectsHome();
}

// 'home' | 'ideas' | 'plans' | 'scrum' — dentro de 'scrum' además alterna
// projects-list-view / projects-detail-view (ver openProjectDetail).
function showProjectsView(view) {
  currentProjectsView = view;
  document.getElementById('projects-home').hidden        = view !== 'home';
  document.getElementById('projects-ideas-view').hidden   = view !== 'ideas';
  document.getElementById('projects-plans-view').hidden   = view !== 'plans';
  document.getElementById('projects-scrum-view').hidden   = view !== 'scrum';
  if (view === 'scrum') {
    document.getElementById('projects-list-view').hidden   = false;
    document.getElementById('projects-detail-view').hidden = true;
  }
}

async function refreshProjectsHome() {
  const kpis = document.getElementById('kpis-projects');
  if (!currentProjectsSuit) { kpis.innerHTML = ''; return; }

  try {
    const [ideas, plans, projects] = await Promise.all([
      listIdeas(currentProjectsSuit.id),
      listPlans(currentProjectsSuit.id),
      listProjects(currentProjectsSuit.id)
    ]);

    document.getElementById('proj-ideas-count').textContent = `${ideas.length} idea${ideas.length === 1 ? '' : 's'}`;
    document.getElementById('proj-plans-count').textContent = `${plans.length} plan${plans.length === 1 ? '' : 'es'}`;
    document.getElementById('proj-scrum-count').textContent = `${projects.length} proyecto${projects.length === 1 ? '' : 's'}`;

    kpis.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Ideas anotadas</div><div class="kpi-value">${ideas.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Planes activos</div><div class="kpi-value">${plans.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Proyectos Scrum</div><div class="kpi-value">${projects.length}</div></div>`;
  } catch (err) {
    kpis.innerHTML = `<p class="crm-muted">No se pudo cargar el resumen (${esc(err.message)}).</p>`;
  }
}

async function enterProjectsScrum() {
  showProjectsView('scrum');
  await refreshProjectsGrid();
}

// ── Lista de proyectos ───────────────────────────────────────────────────

async function refreshProjectsGrid() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '<p class="crm-muted">Cargando…</p>';

  let bodyHtml;
  try {
    const projects = await listProjects(currentProjectsSuit.id);
    lastProjectsGrid = projects;
    bodyHtml = projects.length
      ? projects.map(projectCard).join('')
      : '<p class="crm-muted">Todavía no hay proyectos. Creá el primero.</p>';
  } catch (err) {
    bodyHtml = `<p class="crm-muted">No se pudieron cargar los proyectos (${esc(err.message)}).</p>`;
  }
  // La tarjeta "+" siempre se arma, incluso si la lista falló o está vacía —
  // gateRowActions la saca si el usuario no tiene create en "projects"
  // (matchea data-add-project, mismo prefijo data-add- que create-only).
  grid.innerHTML = bodyHtml + newProjectCard();
  gateRowActions(grid, 'projects');
}

function projectCard(p) {
  const storyCount  = p._count?.stories ?? 0;
  const sprintCount = p._count?.sprints ?? 0;
  const created     = new Date(p.createdAt).toLocaleDateString('es-AR');

  return `
    <div class="project-card" data-open-project="${p.id}">
      <div class="project-card-top">
        <div class="project-card-name">${esc(p.name)}</div>
        <div class="project-card-actions">
          <span class="crm-action-btn" data-edit-project="${p.id}" title="Editar">✎</span>
          <span class="crm-action-btn btn-del" data-del-project="${p.id}" title="Eliminar">🗑</span>
        </div>
      </div>
      ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ''}
      <div class="project-card-meta">
        <span>${storyCount} historia${storyCount === 1 ? '' : 's'}</span>
        <span>${sprintCount} sprint${sprintCount === 1 ? '' : 's'}</span>
        <span>${created}</span>
      </div>
    </div>`;
}

function newProjectCard() {
  return `
    <div class="project-card project-card-new" data-add-project>
      <span class="project-card-new-icon">+</span>
      <span>Nuevo proyecto</span>
    </div>`;
}

// ── Modal: Proyecto ──────────────────────────────────────────────────────

function openProjectModal(id) {
  const project = id ? lastProjectsGrid.find(p => p.id === id) : null;
  document.getElementById('modal-project-title').textContent = project ? 'Editar proyecto' : 'Nuevo proyecto';
  document.getElementById('modal-project').dataset.editId = id || '';
  document.getElementById('project-name').value = project?.name || '';
  document.getElementById('project-description').value = project?.description || '';
  renderColorSwatches(project?.color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]);
  document.getElementById('modal-project').classList.add('open');
}

function closeProjectModal() {
  document.getElementById('modal-project').classList.remove('open');
}

function renderColorSwatches(selected) {
  selectedProjectColor = selected;
  document.getElementById('project-color-swatches').innerHTML = PROJECT_COLORS.map(c => `
    <span class="color-swatch ${c === selected ? 'selected' : ''}" style="background:${c}" data-color="${c}"></span>
  `).join('');
}

async function saveProject() {
  const editId      = document.getElementById('modal-project').dataset.editId;
  const name        = document.getElementById('project-name').value.trim();
  const description = document.getElementById('project-description').value.trim();

  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }

  try {
    if (editId) {
      await updateProject(currentProjectsSuit.id, editId, { name, description, color: selectedProjectColor });
      showToast('Proyecto actualizado');
    } else {
      await createProject(currentProjectsSuit.id, { name, description, color: selectedProjectColor });
      showToast('Proyecto creado');
    }
    closeProjectModal();
    refreshProjectsGrid();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el proyecto', 'err');
  }
}

// ── Detalle de proyecto ──────────────────────────────────────────────────

// Dentro del área Scrum (showProjectsView('scrum')), alterna la grilla de
// proyectos y el detalle de uno — no confundir con showProjectsView, que
// alterna los 4 sub-paneles de todo el tab Projects (home/ideas/plans/scrum).
function showScrumSubView(view) {
  document.getElementById('projects-list-view').hidden   = view !== 'list';
  document.getElementById('projects-detail-view').hidden = view !== 'detail';
}

async function openProjectDetail(projectId) {
  showScrumSubView('detail');
  document.getElementById('projects-detail-content').innerHTML = '<p class="crm-muted">Cargando…</p>';

  try {
    await loadProjectState(projectId);
    document.getElementById('projects-detail-name').textContent = currentProject.name;
    document.getElementById('projects-detail-desc').textContent = currentProject.description || '';
    document.getElementById('projects-detail-desc').hidden = !currentProject.description;
    switchProjectsTab('backlog');
  } catch (err) {
    showToast(err.message || 'No se pudo cargar el proyecto', 'err');
    showScrumSubView('list');
  }
}

async function loadProjectState(projectId) {
  const suitId = currentProjectsSuit.id;
  const [project, stories, sprints, sprintStories] = await Promise.all([
    getProject(suitId, projectId),
    listStories(suitId, projectId),
    listSprints(suitId, projectId),
    listSprintStoriesByProject(suitId, projectId)
  ]);
  currentProject       = project;
  projectStories       = stories;
  projectSprints       = sprints;
  projectSprintStories = sprintStories;
}

const PROJECTS_TAB_ACTION = {
  backlog: '<button class="primary-btn" id="btn-add-story">+ Agregar historia</button>',
  sprints: '<button class="primary-btn" id="btn-add-sprint">+ Nuevo Sprint</button>',
  board:   '',
  metrics: ''
};

function switchProjectsTab(tab) {
  activeProjectsTab = tab;
  document.querySelectorAll('.projects-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('projects-tab-action').innerHTML = PROJECTS_TAB_ACTION[tab] || '';
  if (tab === 'backlog') gateCreateButton('btn-add-story', 'projects');
  if (tab === 'sprints') gateCreateButton('btn-add-sprint', 'projects');

  const c = document.getElementById('projects-detail-content');
  if (tab === 'backlog') renderBacklogTab(c);
  if (tab === 'sprints') renderSprintsTab(c);
  if (tab === 'board')   renderBoardTab(c);
  if (tab === 'metrics') renderMetricsTab(c);
}

// ══════════════════════════════════════════════════════════════════════
// BACKLOG
// ══════════════════════════════════════════════════════════════════════

function renderBacklogTab(c) {
  c.innerHTML = '<div class="backlog-list" id="backlog-list"></div>';
  renderBacklogList();
}

function renderBacklogList() {
  const list = document.getElementById('backlog-list');
  if (!list) return;

  if (!projectStories.length) {
    list.innerHTML = '<p class="crm-muted">El backlog está vacío. Agregá la primera historia de usuario.</p>';
    return;
  }

  const hasOpenSprint = projectSprints.some(s => s.status !== 'completed');

  list.innerHTML = projectStories.map((story, idx) => {
    const inSprint = story.status === 'in-sprint';
    const canMove  = inSprint || (story.status === 'backlog' && hasOpenSprint);
    const priority = STORY_PRIORITY[story.priority] || { label: story.priority, badge: 'badge-gray' };
    const status   = STORY_STATUS[story.status] || { label: story.status, badge: 'badge-gray' };

    const assignee = story.assignedTo ? assigneeInitials(story.assignedTo) : null;

    return `
      <div class="backlog-row">
        <div class="backlog-row-num">${idx + 1}</div>
        <div class="backlog-row-title">${esc(story.title)}</div>
        <div class="backlog-row-badges">
          <span class="crm-badge ${priority.badge}">${priority.label}</span>
          <span class="crm-badge badge-blue">${story.points} pts</span>
          <span class="crm-badge ${status.badge}">${status.label}</span>
          ${assignee ? `<span class="avatar-chip" title="${esc(assigneeName(story.assignedTo))}">${assignee}</span>` : ''}
        </div>
        <div class="backlog-row-actions">
          ${canMove ? `<span class="crm-action-btn" data-move-story="${story.id}" title="${inSprint ? 'Reasignar / quitar del sprint' : 'Mover a sprint'}">⇄</span>` : ''}
          <span class="crm-action-btn" data-edit-story="${story.id}" title="Editar">✎</span>
          <span class="crm-action-btn btn-del" data-del-story="${story.id}" title="Eliminar">🗑</span>
        </div>
      </div>`;
  }).join('');
  gateRowActions(list, 'projects');
}

function assigneeName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Sin nombre';
}

function assigneeInitials(user) {
  const name = assigneeName(user);
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

// Miembros del equipo asignables — no incluye al owner (no tiene fila en
// eKSuitMember, ver [[project_suit_team_permissions]]); alcanza para v1.
let projectAssignableMembers = [];

async function loadAssignableMembers() {
  try {
    const members = await listSuitMembers(currentProjectsSuit.id);
    projectAssignableMembers = (members || []).filter(m => m.isActive).map(m => m.user);
  } catch {
    projectAssignableMembers = [];
  }
}

function renderAssigneeOptions(selectedId) {
  const select = document.getElementById('story-assignee');
  select.innerHTML = '<option value="">Sin asignar</option>' +
    projectAssignableMembers.map(u => `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${esc(assigneeName(u))}</option>`).join('');
}

async function openStoryModal(id) {
  const story = id ? projectStories.find(s => s.id === id) : null;
  document.getElementById('modal-story-title').textContent = story ? 'Editar historia' : 'Nueva historia';
  document.getElementById('modal-story').dataset.editId = id || '';
  document.getElementById('story-title').value    = story?.title || '';
  document.getElementById('story-priority').value = story?.priority || 'medium';
  document.getElementById('story-points').value   = story?.points ?? 3;
  await loadAssignableMembers();
  renderAssigneeOptions(story?.assignedToId || null);
  document.getElementById('modal-story').classList.add('open');
}

function closeStoryModal() {
  document.getElementById('modal-story').classList.remove('open');
}

async function saveStory() {
  const editId       = document.getElementById('modal-story').dataset.editId;
  const title        = document.getElementById('story-title').value.trim();
  const priority     = document.getElementById('story-priority').value;
  const points       = Math.max(1, parseInt(document.getElementById('story-points').value, 10) || 1);
  const assignedToId = document.getElementById('story-assignee').value || null;

  if (!title) { showToast('La historia de usuario es obligatoria', 'err'); return; }

  try {
    if (editId) {
      await updateStory(currentProjectsSuit.id, editId, { title, priority, points, assignedToId });
    } else {
      await createStory(currentProjectsSuit.id, { projectId: currentProject.id, title, priority, points, assignedToId });
    }
    await loadProjectState(currentProject.id);
    closeStoryModal();
    renderBacklogList();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la historia', 'err');
  }
}

// Un vínculo cuenta como asignación "activa" solo si el status de la
// historia sigue siendo 'in-sprint': tras completar un sprint los vínculos
// viejos no se borran (quedan para el historial), así que hay que filtrar
// por esto para no enganchar un sprint ya completado.
function currentSprintLinkFor(storyId) {
  const story = projectStories.find(s => s.id === storyId);
  if (!story || story.status !== 'in-sprint') return null;
  return projectSprintStories.find(ss => ss.storyId === storyId) || null;
}

function openMoveModal(storyId) {
  const currentLink = currentSprintLinkFor(storyId);
  const sprints = projectSprints.filter(s => s.status !== 'completed' && (!currentLink || s.id !== currentLink.sprintId));

  if (!sprints.length && !currentLink) {
    showToast('No hay sprints activos o planificados. Creá uno en la pestaña Sprints.', 'err');
    return;
  }

  document.getElementById('modal-move-sprint').dataset.storyId = storyId;
  document.getElementById('modal-move-sprint-title').textContent = currentLink ? 'Reasignar historia' : 'Agregar al Sprint';

  const note = document.getElementById('move-current-sprint-note');
  if (currentLink) {
    const currentSprint = projectSprints.find(s => s.id === currentLink.sprintId);
    note.textContent = `Actualmente en: ${currentSprint ? currentSprint.name : 'sprint desconocido'}`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  const select      = document.getElementById('move-sprint-select');
  const selectField = document.getElementById('move-select-field');
  const confirmBtn  = document.getElementById('move-confirm-btn');

  if (sprints.length) {
    selectField.hidden = false;
    select.innerHTML = sprints.map(s => `<option value="${s.id}">${esc(s.name)} (${(SPRINT_STATUS[s.status] || {}).label || s.status})</option>`).join('');
    confirmBtn.hidden = false;
    confirmBtn.textContent = currentLink ? 'Reasignar' : 'Agregar';
  } else {
    selectField.hidden = true;
    confirmBtn.hidden = true;
  }

  document.getElementById('move-remove-btn').hidden = !currentLink;
  document.getElementById('modal-move-sprint').classList.add('open');
}

function closeMoveModal() {
  document.getElementById('modal-move-sprint').classList.remove('open');
}

async function confirmMove() {
  const storyId     = document.getElementById('modal-move-sprint').dataset.storyId;
  const sprintId     = document.getElementById('move-sprint-select').value;
  const currentLink  = currentSprintLinkFor(storyId);

  try {
    if (currentLink) await removeStoryFromSprint(currentProjectsSuit.id, currentLink.sprintId, storyId);
    await addStoryToSprint(currentProjectsSuit.id, sprintId, storyId);
    await loadProjectState(currentProject.id);
    closeMoveModal();
    renderBacklogList();
  } catch (err) {
    showToast(err.message || 'No se pudo mover la historia', 'err');
  }
}

async function confirmRemoveFromSprint() {
  const storyId     = document.getElementById('modal-move-sprint').dataset.storyId;
  const currentLink  = currentSprintLinkFor(storyId);
  if (!currentLink) { closeMoveModal(); return; }

  try {
    await removeStoryFromSprint(currentProjectsSuit.id, currentLink.sprintId, storyId);
    await loadProjectState(currentProject.id);
    closeMoveModal();
    renderBacklogList();
  } catch (err) {
    showToast(err.message || 'No se pudo quitar la historia del sprint', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// SPRINTS
// ══════════════════════════════════════════════════════════════════════

function renderSprintsTab(c) {
  c.innerHTML = `
    <div class="crm-toolbar">
      <div class="view-toggle" id="sprint-view-toggle">
        <button class="view-toggle-btn ${sprintsView === 'list' ? 'active' : ''}" data-sprint-view="list">Lista</button>
        <button class="view-toggle-btn ${sprintsView === 'timeline' ? 'active' : ''}" data-sprint-view="timeline">Cronograma</button>
      </div>
    </div>
    <div id="sprint-view-container"></div>`;
  renderSprintViewContent();
}

function renderSprintViewContent() {
  const container = document.getElementById('sprint-view-container');
  if (sprintsView === 'timeline') {
    renderSprintTimeline(container);
  } else {
    container.innerHTML = '<div class="sprint-list" id="sprint-list"></div>';
    renderSprintList();
  }
}

function renderSprintList() {
  const list = document.getElementById('sprint-list');
  if (!list) return;

  if (!projectSprints.length) {
    list.innerHTML = '<p class="crm-muted">No hay sprints todavía. Creá el primero.</p>';
    return;
  }

  const order  = { active: 0, planned: 1, completed: 2 };
  const sorted = [...projectSprints].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
  const fmt    = d => d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR') : '—';

  list.innerHTML = sorted.map(sprint => {
    const items    = projectSprintStories.filter(ss => ss.sprintId === sprint.id);
    const totalPts = items.reduce((n, ss) => n + (ss.points || 0), 0);
    const donePts  = items.filter(ss => ss.boardStatus === 'done').reduce((n, ss) => n + (ss.points || 0), 0);

    const canUnassign = sprint.status !== 'completed';
    const storyRows = items.length
      ? items.map(ss => {
          const icon = ss.boardStatus === 'done' ? '✓' : ss.boardStatus === 'in-progress' ? '◐' : '○';
          return `
            <div class="sprint-story-item">
              <span>${icon}</span>
              <span class="story-title">${esc(ss.title)}</span>
              <span class="crm-badge badge-blue">${ss.points} pts</span>
              ${canUnassign ? `<span class="crm-action-btn" data-remove-sprint-story data-sprint-id="${ss.sprintId}" data-story-id="${ss.storyId}" title="Quitar del sprint">✕</span>` : ''}
            </div>`;
        }).join('')
      : '<p class="crm-muted" style="margin:.25rem 0">Sin historias asignadas. Podés agregarlas desde el Backlog.</p>';

    let actions = '';
    if (sprint.status === 'planned') {
      actions += `<button class="primary-btn" data-activate-sprint="${sprint.id}">Activar</button>`;
      actions += `<button class="ghost-btn" data-edit-sprint="${sprint.id}">Editar</button>`;
      actions += `<button class="ghost-btn btn-danger" data-del-sprint="${sprint.id}">Eliminar</button>`;
    }
    if (sprint.status === 'active') {
      actions += `<button class="primary-btn" data-complete-sprint="${sprint.id}">Completar Sprint</button>`;
      actions += `<button class="ghost-btn" data-edit-sprint="${sprint.id}">Editar</button>`;
    }
    if (sprint.status === 'completed') {
      actions += `<button class="ghost-btn" data-reopen-sprint="${sprint.id}">Reabrir Sprint</button>`;
    }

    const status = SPRINT_STATUS[sprint.status] || { label: sprint.status, badge: 'badge-gray' };

    return `
      <div class="sprint-card" data-id="${sprint.id}">
        <div class="sprint-card-header">
          <span class="sprint-toggle">▸</span>
          <span class="sprint-card-title">${esc(sprint.name)}</span>
          <span class="crm-badge ${status.badge}">${status.label}</span>
          <span class="sprint-card-meta">
            ${fmt(sprint.startDate)} – ${fmt(sprint.endDate)} · ${totalPts} pts${sprint.status !== 'planned' ? ` · ${donePts} completados` : ''}
          </span>
        </div>
        <div class="sprint-card-body" data-id="${sprint.id}">
          ${sprint.goal ? `<p class="crm-muted" style="margin:0 0 .75rem">${esc(sprint.goal)}</p>` : ''}
          <div>${storyRows}</div>
          ${actions ? `<div class="sprint-actions">${actions}</div>` : ''}
        </div>
      </div>`;
  }).join('');
  gateRowActions(list, 'projects');
}

async function runSprintAction(sprintId, action) {
  try {
    await changeSprintStatus(currentProjectsSuit.id, sprintId, action);
    await loadProjectState(currentProject.id);
    renderSprintViewContent();
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el sprint', 'err');
  }
}

function openSprintModal(id) {
  const sprint = id ? projectSprints.find(s => s.id === id) : null;
  document.getElementById('modal-sprint-title').textContent = sprint ? 'Editar Sprint' : 'Nuevo Sprint';
  document.getElementById('modal-sprint').dataset.editId = id || '';
  document.getElementById('sprint-name').value  = sprint ? sprint.name : `Sprint ${projectSprints.length + 1}`;
  document.getElementById('sprint-goal').value  = sprint?.goal || '';
  document.getElementById('sprint-start').value = sprint?.startDate ? sprint.startDate.slice(0, 10) : '';
  document.getElementById('sprint-end').value   = sprint?.endDate ? sprint.endDate.slice(0, 10) : '';
  document.getElementById('modal-sprint').classList.add('open');
}

function closeSprintModal() {
  document.getElementById('modal-sprint').classList.remove('open');
}

async function saveSprint() {
  const editId = document.getElementById('modal-sprint').dataset.editId;
  const name   = document.getElementById('sprint-name').value.trim();
  const goal   = document.getElementById('sprint-goal').value.trim();
  const start  = document.getElementById('sprint-start').value;
  const end    = document.getElementById('sprint-end').value;

  if (!name) { showToast('El nombre del sprint es obligatorio', 'err'); return; }

  try {
    if (editId) {
      await updateSprint(currentProjectsSuit.id, editId, { name, goal, startDate: start, endDate: end });
    } else {
      await createSprint(currentProjectsSuit.id, { projectId: currentProject.id, name, goal, startDate: start, endDate: end });
    }
    await loadProjectState(currentProject.id);
    closeSprintModal();
    renderSprintViewContent();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el sprint', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// SPRINT TIMELINE (cronograma / roadmap)
// ══════════════════════════════════════════════════════════════════════
//
// Arrastrar una barra completa reordena el sprint en el tiempo (mueve
// inicio y fin juntos). Arrastrar los bordes cambia la duración (mueve
// solo esa fecha). No hay campo de "orden" en el backend: el orden lo
// define startDate, así que persiste directo contra PUT /scrum/sprints/:id.

function renderSprintTimeline(container) {
  const dated   = projectSprints.filter(s => s.startDate && s.endDate);
  const undated = projectSprints.filter(s => !s.startDate || !s.endDate);

  if (!dated.length) {
    container.innerHTML = `
      <p class="crm-muted">Ningún sprint tiene fecha de inicio y fin definidas.<br>
      Asigná fechas desde <strong>Lista</strong> (Editar) para verlo en el cronograma.</p>`;
    return;
  }

  let rangeStart = new Date(Math.min(...dated.map(s => parseDateOnly(s.startDate))));
  let rangeEnd   = new Date(Math.max(...dated.map(s => parseDateOnly(s.endDate))));
  const today = new Date(new Date().toDateString());
  if (today < rangeStart) rangeStart = today;
  if (today > rangeEnd)   rangeEnd   = today;
  rangeStart = addDays(rangeStart, -3);
  rangeEnd   = addDays(rangeEnd, 4);

  const totalDays  = Math.round((rangeEnd - rangeStart) / MS_DAY) + 1;
  const trackWidth = totalDays * TIMELINE_DAY_WIDTH;
  const dayOffset  = d => Math.round((d - rangeStart) / MS_DAY);

  const months = [];
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor <= rangeEnd) {
    const segStart  = cursor < rangeStart ? rangeStart : cursor;
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const segEnd    = nextMonth <= rangeEnd ? addDays(nextMonth, -1) : rangeEnd;
    months.push({
      label: cursor.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }),
      left:  dayOffset(segStart) * TIMELINE_DAY_WIDTH,
      width: (dayOffset(segEnd) - dayOffset(segStart) + 1) * TIMELINE_DAY_WIDTH
    });
    cursor = nextMonth;
  }

  const gridlines = [];
  for (let i = 0; i < totalDays; i += 7) gridlines.push(i * TIMELINE_DAY_WIDTH);

  const todayLeft = (today >= rangeStart && today <= rangeEnd) ? dayOffset(today) * TIMELINE_DAY_WIDTH : null;

  const sorted = [...dated].sort((a, b) => parseDateOnly(a.startDate) - parseDateOnly(b.startDate));

  const rows = sorted.map(sprint => {
    const s      = parseDateOnly(sprint.startDate);
    const e      = parseDateOnly(sprint.endDate);
    const left   = dayOffset(s) * TIMELINE_DAY_WIDTH;
    const width  = (dayOffset(e) - dayOffset(s) + 1) * TIMELINE_DAY_WIDTH;
    const locked = sprint.status === 'completed';
    const status = SPRINT_STATUS[sprint.status] || { label: sprint.status, badge: 'badge-gray' };

    return `
      <div class="timeline-row">
        <div class="timeline-label-cell">
          <span class="timeline-label-name">${esc(sprint.name)}</span>
          <span class="crm-badge ${status.badge}">${status.label}</span>
        </div>
        <div class="timeline-track" style="width:${trackWidth}px">
          <div class="timeline-bar bar-${sprint.status}${locked ? ' locked' : ''}" data-id="${sprint.id}"
               style="left:${left}px;width:${width}px" title="${locked ? 'Sprint completado — no se puede mover' : ''}">
            ${!locked ? '<div class="timeline-handle handle-left"></div>' : ''}
            <span class="timeline-bar-label">${esc(sprint.name)}</span>
            ${!locked ? '<div class="timeline-handle handle-right"></div>' : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="timeline-scroll">
      <div class="timeline-grid">
        <div class="timeline-header-row">
          <div class="timeline-label-cell timeline-label-head"></div>
          <div class="timeline-header-track" style="width:${trackWidth}px">
            ${months.map(m => `<div class="timeline-month" style="left:${m.left}px;width:${m.width}px">${esc(m.label)}</div>`).join('')}
            ${gridlines.map(l => `<div class="timeline-gridline" style="left:${l}px"></div>`).join('')}
            ${todayLeft !== null ? `<div class="timeline-today" style="left:${todayLeft}px"><span>Hoy</span></div>` : ''}
          </div>
        </div>
        ${rows}
      </div>
    </div>
    ${undated.length ? `
      <div class="timeline-undated">
        <p>${undated.length} sprint${undated.length > 1 ? 's' : ''} sin fechas — no ${undated.length > 1 ? 'aparecen' : 'aparece'} en el cronograma:</p>
        <div class="timeline-undated-list">
          ${undated.map(s => `<button class="timeline-undated-item" data-edit-sprint="${s.id}">${esc(s.name)} ✎</button>`).join('')}
        </div>
      </div>` : ''}
  `;

  bindTimelineDrag(container);
}

function bindTimelineDrag(container) {
  let drag = null;
  let tooltipEl = null;

  function tooltipText(mode, origStart, origEnd, deltaDays) {
    let s = origStart, e = origEnd;
    if (mode === 'move')               { s = addDays(origStart, deltaDays); e = addDays(origEnd, deltaDays); }
    else if (mode === 'resize-left')     s = addDays(origStart, deltaDays);
    else if (mode === 'resize-right')    e = addDays(origEnd, deltaDays);
    const days = Math.round((e - s) / MS_DAY) + 1;
    const f = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    return `${f(s)} – ${f(e)} · ${days} día${days !== 1 ? 's' : ''}`;
  }

  function positionTooltip(e) {
    if (!tooltipEl) return;
    tooltipEl.style.left = e.clientX + 'px';
    tooltipEl.style.top  = e.clientY + 'px';
  }

  function onDragMove(e) {
    if (!drag) return;
    const deltaPx  = e.clientX - drag.startX;
    const origDays = Math.round(drag.origWidth / TIMELINE_DAY_WIDTH);
    let deltaDays  = Math.round(deltaPx / TIMELINE_DAY_WIDTH);

    if (drag.mode === 'resize-left') {
      deltaDays = Math.min(deltaDays, origDays - 1);
      drag.bar.style.left  = (drag.origLeft + deltaDays * TIMELINE_DAY_WIDTH) + 'px';
      drag.bar.style.width = (drag.origWidth - deltaDays * TIMELINE_DAY_WIDTH) + 'px';
    } else if (drag.mode === 'resize-right') {
      deltaDays = Math.max(deltaDays, -(origDays - 1));
      drag.bar.style.width = (drag.origWidth + deltaDays * TIMELINE_DAY_WIDTH) + 'px';
    } else {
      drag.bar.style.left = (drag.origLeft + deltaDays * TIMELINE_DAY_WIDTH) + 'px';
    }

    drag.deltaDays = deltaDays;
    positionTooltip(e);
    tooltipEl.textContent = tooltipText(drag.mode, drag.origStart, drag.origEnd, deltaDays);
  }

  async function onDragEnd() {
    if (!drag) return;
    const { id, mode, origStart, origEnd, deltaDays, bar } = drag;
    bar.classList.remove('dragging');
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    drag = null;

    if (deltaDays === 0) return;

    let newStart = origStart, newEnd = origEnd;
    if (mode === 'move')              { newStart = addDays(origStart, deltaDays); newEnd = addDays(origEnd, deltaDays); }
    else if (mode === 'resize-left')    newStart = addDays(origStart, deltaDays);
    else if (mode === 'resize-right')   newEnd   = addDays(origEnd, deltaDays);

    try {
      await updateSprint(currentProjectsSuit.id, id, { startDate: toISODate(newStart), endDate: toISODate(newEnd) });
      await loadProjectState(currentProject.id);
    } catch (err) {
      showToast(err.message || 'No se pudo mover el sprint', 'err');
      await loadProjectState(currentProject.id);
    }
    renderSprintTimeline(document.getElementById('sprint-view-container'));
  }

  function startDrag(e, bar, mode) {
    e.preventDefault();
    const id     = bar.dataset.id;
    const sprint = projectSprints.find(s => s.id === id);
    drag = {
      id, mode,
      startX:    e.clientX,
      origLeft:  parseFloat(bar.style.left),
      origWidth: parseFloat(bar.style.width),
      origStart: parseDateOnly(sprint.startDate),
      origEnd:   parseDateOnly(sprint.endDate),
      deltaDays: 0,
      bar
    };
    bar.classList.add('dragging');
    try { bar.setPointerCapture(e.pointerId); } catch { /* no soportado */ }

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'timeline-tooltip';
    document.body.appendChild(tooltipEl);
    positionTooltip(e);
    tooltipEl.textContent = tooltipText(mode, drag.origStart, drag.origEnd, 0);

    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  container.querySelectorAll('.timeline-bar:not(.locked)').forEach(bar => {
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('timeline-handle')) return;
      startDrag(e, bar, 'move');
    });
    const leftHandle  = bar.querySelector('.handle-left');
    const rightHandle = bar.querySelector('.handle-right');
    if (leftHandle)  leftHandle.addEventListener('pointerdown',  (e) => { e.stopPropagation(); startDrag(e, bar, 'resize-left'); });
    if (rightHandle) rightHandle.addEventListener('pointerdown', (e) => { e.stopPropagation(); startDrag(e, bar, 'resize-right'); });
  });
}

// ══════════════════════════════════════════════════════════════════════
// TABLERO
// ══════════════════════════════════════════════════════════════════════

const BOARD_ORDER = ['todo', 'in-progress', 'review', 'done'];

function renderBoardTab(c) {
  const activeSprint = projectSprints.find(s => s.status === 'active');

  if (!activeSprint) {
    c.innerHTML = '<p class="crm-muted">No hay un sprint activo.<br>Activá un sprint desde la pestaña Sprints para ver el tablero.</p>';
    return;
  }

  const allItems = projectSprintStories.filter(ss => ss.sprintId === activeSprint.id);
  const assignees = [...new Map(allItems.filter(ss => ss.assignedTo).map(ss => [ss.assignedTo.id, ss.assignedTo])).values()];
  const items = boardAssigneeFilter ? allItems.filter(ss => ss.assignedTo?.id === boardAssigneeFilter) : allItems;

  const todo     = items.filter(ss => ss.boardStatus === 'todo');
  const progress = items.filter(ss => ss.boardStatus === 'in-progress');
  const review   = items.filter(ss => ss.boardStatus === 'review');
  const done     = items.filter(ss => ss.boardStatus === 'done');

  const totalPts = allItems.reduce((n, ss) => n + (ss.points || 0), 0);
  const donePts  = allItems.filter(ss => ss.boardStatus === 'done').reduce((n, ss) => n + (ss.points || 0), 0);
  const pct      = totalPts ? Math.round((donePts / totalPts) * 100) : 0;
  const endFmt   = activeSprint.endDate
    ? new Date(activeSprint.endDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR')
    : null;

  c.innerHTML = `
    <div class="board-header">
      <div class="board-sprint-name">${esc(activeSprint.name)}</div>
      ${activeSprint.goal ? `<div class="board-goal">${esc(activeSprint.goal)}</div>` : ''}
      <div class="board-progress">
        <div class="board-progress-bar"><div class="board-progress-fill" style="width:${pct}%"></div></div>
        <span class="board-progress-label">${donePts}/${totalPts} pts · ${pct}%${endFmt ? ' · Fin: ' + endFmt : ''}</span>
      </div>
      ${assignees.length ? `
        <select id="board-assignee-filter" class="board-assignee-filter">
          <option value="">Todos los asignados</option>
          ${assignees.map(u => `<option value="${u.id}" ${u.id === boardAssigneeFilter ? 'selected' : ''}>${esc(assigneeName(u))}</option>`).join('')}
        </select>` : ''}
    </div>
    <div class="board-columns board-columns-4">
      ${boardColumn('Por Hacer', todo)}
      ${boardColumn('En Progreso', progress)}
      ${boardColumn('Revisión', review)}
      ${boardColumn('Hecho', done)}
    </div>`;
  gateRowActions(c, 'projects');
}

function boardColumn(label, items) {
  return `
    <div class="board-col">
      <div class="board-col-header">${esc(label)} <span class="col-count">${items.length}</span></div>
      <div class="board-cards">${items.map(boardCard).join('')}</div>
    </div>`;
}

function boardCard(ss) {
  const idx      = BOARD_ORDER.indexOf(ss.boardStatus);
  const canLeft  = idx > 0;
  const canRight = idx < BOARD_ORDER.length - 1;
  const priority = STORY_PRIORITY[ss.priority] || { label: ss.priority, badge: 'badge-gray' };
  const assignee = ss.assignedTo ? assigneeInitials(ss.assignedTo) : null;

  return `
    <div class="board-card" data-story-id="${ss.storyId}" data-sprint-id="${ss.sprintId}">
      <div class="board-card-title">${esc(ss.title)}</div>
      <div class="board-card-footer">
        <span class="crm-badge badge-blue">${ss.points} pts</span>
        <span class="crm-badge ${priority.badge}">${priority.label}</span>
        ${assignee ? `<span class="avatar-chip" title="${esc(assigneeName(ss.assignedTo))}">${assignee}</span>` : ''}
        <div class="board-card-btns">
          ${canLeft  ? '<span class="crm-action-btn" data-board-move="left" title="Mover atrás">‹</span>'   : ''}
          ${canRight ? '<span class="crm-action-btn" data-board-move="right" title="Mover adelante">›</span>' : ''}
          <span class="crm-action-btn btn-del" data-board-remove title="Quitar del sprint">✕</span>
        </div>
      </div>
    </div>`;
}

async function moveBoardCard(storyId, sprintId, direction) {
  const ss = projectSprintStories.find(x => x.storyId === storyId && x.sprintId === sprintId);
  if (!ss) return;

  const newIdx = BOARD_ORDER.indexOf(ss.boardStatus) + (direction === 'right' ? 1 : -1);
  if (newIdx < 0 || newIdx >= BOARD_ORDER.length) return;

  try {
    await updateBoardStatus(currentProjectsSuit.id, sprintId, storyId, BOARD_ORDER[newIdx]);
    await loadProjectState(currentProject.id);
    renderBoardTab(document.getElementById('projects-detail-content'));
  } catch (err) {
    showToast(err.message || 'No se pudo mover la historia', 'err');
  }
}

// ══════════════════════════════════════════════════════════════════════
// MÉTRICAS
// ══════════════════════════════════════════════════════════════════════
// Calculadas on-demand por el backend (sin historial): velocity por sprint
// completado + progreso del sprint activo por columna y por asignado.

async function renderMetricsTab(c) {
  c.innerHTML = '<p class="crm-muted">Cargando…</p>';
  let metrics;
  try {
    metrics = await getProjectMetrics(currentProjectsSuit.id, currentProject.id);
  } catch (err) {
    c.innerHTML = `<p class="crm-muted">No se pudieron cargar las métricas (${esc(err.message)}).</p>`;
    return;
  }

  const velocityRows = metrics.velocity.length
    ? metrics.velocity.map(v => `
        <div class="metrics-velocity-row">
          <span class="metrics-velocity-name">${esc(v.name)}</span>
          <div class="board-progress-bar"><div class="board-progress-fill" style="width:${v.committedPoints ? Math.round(v.completedPoints / v.committedPoints * 100) : 0}%"></div></div>
          <span class="metrics-velocity-pts">${v.completedPoints}/${v.committedPoints} pts</span>
        </div>`).join('')
    : '<p class="crm-muted">Todavía no hay sprints completados.</p>';

  let activeHtml = '<p class="crm-muted">No hay un sprint activo.</p>';
  if (metrics.activeSprint) {
    const a = metrics.activeSprint;
    const byAssigneeRows = a.byAssignee.length
      ? a.byAssignee.map(x => `
          <div class="metrics-velocity-row">
            <span class="metrics-velocity-name">${esc(x.name)}</span>
            <div class="board-progress-bar"><div class="board-progress-fill" style="width:${x.totalPoints ? Math.round(x.donePoints / x.totalPoints * 100) : 0}%"></div></div>
            <span class="metrics-velocity-pts">${x.donePoints}/${x.totalPoints} pts</span>
          </div>`).join('')
      : '';

    activeHtml = `
      <div class="board-progress" style="margin-bottom:1rem">
        <div class="board-progress-bar"><div class="board-progress-fill" style="width:${a.pctDone}%"></div></div>
        <span class="board-progress-label">${a.donePoints}/${a.totalPoints} pts · ${a.pctDone}%</span>
      </div>
      <div class="crm-form-row" style="margin-bottom:1rem">
        ${BOARD_ORDER.map(s => `<span class="crm-badge badge-blue">${(BOARD_COLUMN_LABEL[s] || s)}: ${a.byStatus[s] || 0} pts</span>`).join(' ')}
      </div>
      ${byAssigneeRows}`;
  }

  c.innerHTML = `
    <div class="card">
      <h3>Velocity (sprints completados)</h3>
      ${velocityRows}
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Sprint activo</h3>
      ${activeHtml}
    </div>`;
}

const BOARD_COLUMN_LABEL = { todo: 'Por Hacer', 'in-progress': 'En Progreso', review: 'Revisión', done: 'Hecho' };

// ── Wiring ───────────────────────────────────────────────────────────────

function initProjectsEvents() {
  document.getElementById('proj-enter-scrum').addEventListener('click', enterProjectsScrum);
  document.getElementById('proj-scrum-back').addEventListener('click', () => { showProjectsView('home'); refreshProjectsHome(); });

  document.getElementById('projects-grid').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-project]');
    const delBtn  = e.target.closest('[data-del-project]');

    if (editBtn) { openProjectModal(editBtn.dataset.editProject); return; }
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este proyecto? Esta acción no se puede deshacer.',
        onConfirm: async () => {
          try {
            await deleteProject(currentProjectsSuit.id, delBtn.dataset.delProject);
            showToast('Proyecto eliminado');
            refreshProjectsGrid();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el proyecto', 'err');
          }
        }
      });
      return;
    }

    if (e.target.closest('[data-add-project]')) { openProjectModal(null); return; }

    const card = e.target.closest('[data-open-project]');
    if (card) openProjectDetail(card.dataset.openProject);
  });

  document.getElementById('modal-project-close').addEventListener('click', closeProjectModal);
  document.getElementById('modal-project-cancel').addEventListener('click', closeProjectModal);
  document.getElementById('modal-project-save').addEventListener('click', saveProject);
  document.getElementById('project-color-swatches').addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    document.querySelectorAll('#project-color-swatches .color-swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
    selectedProjectColor = swatch.dataset.color;
  });

  document.getElementById('projects-detail-back').addEventListener('click', () => { showScrumSubView('list'); refreshProjectsGrid(); });
  document.getElementById('projects-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.projects-tab');
    if (btn) switchProjectsTab(btn.dataset.tab);
  });
  document.getElementById('projects-tab-action').addEventListener('click', (e) => {
    if (e.target.closest('#btn-add-story'))  { openStoryModal(null); return; }
    if (e.target.closest('#btn-add-sprint')) { openSprintModal(null); }
  });

  document.getElementById('modal-story-close').addEventListener('click', closeStoryModal);
  document.getElementById('modal-story-cancel').addEventListener('click', closeStoryModal);
  document.getElementById('modal-story-save').addEventListener('click', saveStory);

  document.getElementById('modal-move-sprint-close').addEventListener('click', closeMoveModal);
  document.getElementById('modal-move-sprint-cancel').addEventListener('click', closeMoveModal);
  document.getElementById('move-confirm-btn').addEventListener('click', confirmMove);
  document.getElementById('move-remove-btn').addEventListener('click', confirmRemoveFromSprint);

  document.getElementById('modal-sprint-close').addEventListener('click', closeSprintModal);
  document.getElementById('modal-sprint-cancel').addEventListener('click', closeSprintModal);
  document.getElementById('modal-sprint-save').addEventListener('click', saveSprint);

  // Un único listener delegado cubre las 3 tabs (Backlog/Sprints/Tablero):
  // su contenido se reemplaza entero (innerHTML) en cada render, así que no
  // hay necesidad (ni riesgo de doble-bind) de volver a engancharlo por tab.
  document.getElementById('projects-detail-content').addEventListener('click', (e) => {
    const moveBtn = e.target.closest('[data-move-story]');
    if (moveBtn) { openMoveModal(moveBtn.dataset.moveStory); return; }

    const editStoryBtn = e.target.closest('[data-edit-story]');
    if (editStoryBtn) { openStoryModal(editStoryBtn.dataset.editStory); return; }

    const delStoryBtn = e.target.closest('[data-del-story]');
    if (delStoryBtn) {
      openConfirmModal({
        message: '¿Eliminar esta historia de usuario?',
        onConfirm: async () => {
          try {
            await deleteStory(currentProjectsSuit.id, delStoryBtn.dataset.delStory);
            await loadProjectState(currentProject.id);
            renderBacklogList();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la historia', 'err');
          }
        }
      });
      return;
    }

    const viewToggleBtn = e.target.closest('[data-sprint-view]');
    if (viewToggleBtn) {
      sprintsView = viewToggleBtn.dataset.sprintView;
      document.querySelectorAll('#sprint-view-toggle .view-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.sprintView === sprintsView));
      renderSprintViewContent();
      return;
    }

    const header = e.target.closest('.sprint-card-header');
    if (header) {
      const id = header.closest('.sprint-card').dataset.id;
      header.querySelector('.sprint-toggle').classList.toggle('open');
      document.querySelector(`.sprint-card-body[data-id="${id}"]`).classList.toggle('open');
      return;
    }

    const activateBtn = e.target.closest('[data-activate-sprint]');
    if (activateBtn) {
      openConfirmModal({ message: '¿Activar este sprint?', onConfirm: () => runSprintAction(activateBtn.dataset.activateSprint, 'activate') });
      return;
    }
    const completeBtn = e.target.closest('[data-complete-sprint]');
    if (completeBtn) {
      openConfirmModal({ message: '¿Completar este sprint? Las historias no terminadas volverán al backlog.', onConfirm: () => runSprintAction(completeBtn.dataset.completeSprint, 'complete') });
      return;
    }
    const reopenBtn = e.target.closest('[data-reopen-sprint]');
    if (reopenBtn) {
      openConfirmModal({ message: '¿Reabrir este sprint? Volverá a estado "Activo" y sus historias volverán a "En sprint" para poder corregir el tablero.', onConfirm: () => runSprintAction(reopenBtn.dataset.reopenSprint, 'reopen') });
      return;
    }
    const editSprintBtn = e.target.closest('[data-edit-sprint]');
    if (editSprintBtn) { openSprintModal(editSprintBtn.dataset.editSprint); return; }

    const delSprintBtn = e.target.closest('[data-del-sprint]');
    if (delSprintBtn) {
      openConfirmModal({
        message: '¿Eliminar este sprint? Las historias asignadas volverán al backlog.',
        onConfirm: async () => {
          try {
            await deleteSprint(currentProjectsSuit.id, delSprintBtn.dataset.delSprint);
            await loadProjectState(currentProject.id);
            renderSprintViewContent();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el sprint', 'err');
          }
        }
      });
      return;
    }

    const removeSprintStoryBtn = e.target.closest('[data-remove-sprint-story]');
    if (removeSprintStoryBtn) {
      openConfirmModal({
        message: '¿Quitar esta historia del sprint? Volverá al backlog.',
        onConfirm: async () => {
          try {
            await removeStoryFromSprint(currentProjectsSuit.id, removeSprintStoryBtn.dataset.sprintId, removeSprintStoryBtn.dataset.storyId);
            await loadProjectState(currentProject.id);
            renderSprintViewContent();
          } catch (err) {
            showToast(err.message || 'No se pudo quitar la historia', 'err');
          }
        }
      });
      return;
    }

    const boardMoveBtn = e.target.closest('[data-board-move]');
    if (boardMoveBtn) {
      const card = boardMoveBtn.closest('.board-card');
      moveBoardCard(card.dataset.storyId, card.dataset.sprintId, boardMoveBtn.dataset.boardMove);
      return;
    }

    const boardRemoveBtn = e.target.closest('[data-board-remove]');
    if (boardRemoveBtn) {
      const card = boardRemoveBtn.closest('.board-card');
      openConfirmModal({
        message: '¿Quitar esta historia del sprint? Volverá al backlog.',
        onConfirm: async () => {
          try {
            await removeStoryFromSprint(currentProjectsSuit.id, card.dataset.sprintId, card.dataset.storyId);
            await loadProjectState(currentProject.id);
            renderBoardTab(document.getElementById('projects-detail-content'));
          } catch (err) {
            showToast(err.message || 'No se pudo quitar la historia', 'err');
          }
        }
      });
    }
  });

  // El filtro de asignado del tablero se re-renderiza entero en cada tab
  // switch (igual que el resto de projects-detail-content), así que se
  // engancha con delegación de 'change' en vez de re-bindearlo a mano.
  document.getElementById('projects-detail-content').addEventListener('change', (e) => {
    const filter = e.target.closest('#board-assignee-filter');
    if (filter) {
      boardAssigneeFilter = filter.value;
      renderBoardTab(document.getElementById('projects-detail-content'));
    }
  });
}
