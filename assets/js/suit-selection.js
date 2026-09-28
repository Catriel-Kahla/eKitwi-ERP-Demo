/**
 * suit-selection.js
 * pages/suitselection.html — entry point. Loads the user's suits (GET
 * /suits + /suits/:id/systems, via data.js's loadSuitsWithSystems) and
 * decides what to show:
 *   - 0 suits  → empty state, stays on this page.
 *   - 1 suit   → nothing to choose, auto-selects it and jumps straight to
 *                the dashboard (no picker flash).
 *   - 2+ suits → if a previously-picked suit is still valid (this page was
 *                reached right after login, not via "Cambiar de suit" —
 *                that button clears the saved suit before navigating
 *                here), skip straight to the dashboard too. Otherwise show
 *                the picker; clicking a card fades the screen out, then
 *                navigates to the dashboard for that suit.
 * See suit-state.js for the localStorage read/write and APIconnection.md
 * for the full login → suitselection → dashboard flow.
 */

'use strict';

const BADGE_CLASS = {
  'badge-green':  'selection-badge--green',
  'badge-yellow': 'selection-badge--yellow',
  'badge-red':    'selection-badge--red',
  'badge-gray':   'selection-badge--gray',
  'badge-purple': 'selection-badge--purple',
  'badge-blue':   'selection-badge--blue'
};

function goToDashboard() {
  window.location.replace(ERP_DASH_PATH);
}

function fadeOutAndGoToDashboard() {
  const screen = document.getElementById('selection-screen');
  screen.classList.add('leaving');
  screen.addEventListener('transitionend', goToDashboard, { once: true });
  // Belt-and-suspenders in case transitionend doesn't fire (e.g. the user
  // already had reduced-motion / the transition got interrupted).
  setTimeout(goToDashboard, 350);
}

function showScreen() {
  const screen = document.getElementById('selection-screen');
  requestAnimationFrame(() => requestAnimationFrame(() => screen.classList.add('visible')));
}

function renderGrid(suits) {
  document.getElementById('selection-grid').innerHTML = suits.map(s => `
    <button class="selection-card" data-suit-id="${s.id}">
      <div class="selection-card-top">
        <span class="selection-card-name">${esc(s.name)}</span>
        <span class="selection-badge ${s.isActive ? 'selection-badge--green' : 'selection-badge--gray'}">${s.isActive ? 'Activa' : 'Inactiva'}</span>
      </div>
      <div class="selection-card-slug">/${esc(s.slug || '—')}</div>
      <div class="selection-card-tags">
        ${s.systems.length
          ? s.systems.map(t => `<span class="selection-badge ${BADGE_CLASS[(SYSTEM_META[t] || {}).badge] || 'selection-badge--gray'}">${esc((SYSTEM_META[t] || {}).label || t)}</span>`).join('')
          : '<span class="selection-empty" style="font-size:.8rem">Sin módulos habilitados</span>'}
      </div>
    </button>
  `).join('');

  document.getElementById('selection-grid').querySelectorAll('.selection-card').forEach(card => {
    card.addEventListener('click', () => {
      setCurrentSuitId(card.dataset.suitId);
      fadeOutAndGoToDashboard();
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  let suits;
  try {
    suits = window.EKITWI_DEV_MODE ? MOCK_SUITS : await loadSuitsWithSystems();
  } catch (err) {
    document.getElementById('selection-grid').innerHTML =
      `<p class="selection-empty">No se pudieron cargar tus suits (${esc(err.message)}).</p>`;
    showScreen();
    return;
  }

  if (!suits.length) {
    document.getElementById('selection-grid').innerHTML =
      '<p class="selection-empty">Todavía no tenés ningún suit asignado.</p>';
    showScreen();
    return;
  }

  if (suits.length === 1) {
    setCurrentSuitId(suits[0].id);
    goToDashboard();
    return;
  }

  const savedId = getCurrentSuitId();
  const saved   = savedId && suits.find(s => s.id === savedId);
  if (saved) {
    goToDashboard();
    return;
  }

  renderGrid(suits);
  showScreen();
});
