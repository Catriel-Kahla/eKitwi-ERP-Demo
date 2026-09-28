/**
 * appsMenu.js — "Apps": panel flotante que reemplaza al viejo sidebar/aside.
 * El trigger (#apps-trigger) ya vive en el navbar (dashboard.html, igual que
 * #sidebar-toggle en eKitwi Identity); este archivo solo le ata el
 * click/toggle y arma el panel flotante (#apps-list) con animación
 * escalonada, igual que el menú "⋯" de fabMenu.js.
 *
 * La lista la llena renderAppsMenu(suit) en shared-ui.js con los mismos
 * elementos .side-item[data-panel] que antes vivía en el sidebar — así la
 * navegación (delegación de eventos en dashboard.js) no cambia.
 * closeAppsMenu() lo llama dashboard.js después de navegar.
 *
 * Se carga después de shared-ui.js y antes de dashboard.js.
 */

'use strict';

let appsMenuOpen = false;

function setAppsMenuOpen(open) {
  appsMenuOpen = !!open;
  const list = document.getElementById('apps-list');
  const trigger = document.getElementById('apps-trigger');
  if (list) list.classList.toggle('open', appsMenuOpen);
  if (trigger) trigger.setAttribute('aria-expanded', String(appsMenuOpen));
}

function closeAppsMenu() { setAppsMenuOpen(false); }
function toggleAppsMenu() { setAppsMenuOpen(!appsMenuOpen); }

function buildAppsMenu() {
  if (document.getElementById('apps-list')) return;

  const trigger = document.getElementById('apps-trigger');

  const list = document.createElement('div');
  list.id = 'apps-list';
  list.setAttribute('aria-label', 'Aplicaciones del suit');
  list.innerHTML = `<p class="apps-empty">Cargando…</p>`;
  document.body.appendChild(list);

  if (trigger) {
    trigger.addEventListener('click', (e) => { e.stopPropagation(); toggleAppsMenu(); });
  }

  document.addEventListener('click', (e) => {
    if (!appsMenuOpen) return;
    if (list.contains(e.target)) return;
    if (trigger && trigger.contains(e.target)) return;
    setAppsMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appsMenuOpen) setAppsMenuOpen(false);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildAppsMenu);
} else {
  buildAppsMenu();
}
