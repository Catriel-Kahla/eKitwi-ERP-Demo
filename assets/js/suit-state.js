/**
 * suit-state.js
 * Which suit is "active" — shared between pages/suitselection.html (writes
 * it) and pages/dashboard.html (reads it to scope the sidebar). Just a
 * localStorage wrapper, no DOM, no network — load before shared-ui.js and
 * suit-selection.js.
 */

'use strict';

const CURRENT_SUIT_KEY = 'ekitwi_erp_current_suit';

function getCurrentSuitId() {
  return localStorage.getItem(CURRENT_SUIT_KEY);
}

function setCurrentSuitId(id) {
  localStorage.setItem(CURRENT_SUIT_KEY, id);
}

function clearCurrentSuitId() {
  localStorage.removeItem(CURRENT_SUIT_KEY);
}
