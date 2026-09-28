/**
 * demo-autologin.js — public demo fork only, not part of the real product.
 *
 * Fills and submits the real login form with a fixed demo identity, reusing
 * auth.js's own DEV_MODE branch unchanged (fake JWT, no backend call) so the
 * rest of the login → suitselection → dashboard flow behaves exactly like
 * the real app. Must be included AFTER auth.js so its submit handler is
 * already attached when this runs.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('erp-login-form');
  if (!form) return; // not on the login page

  document.getElementById('erp-email').value = 'demo@ekitwi.com';
  document.getElementById('erp-password').value = 'demo-viewer';

  const caption = document.createElement('p');
  caption.textContent = 'Entrando como usuario demo…';
  caption.style.cssText =
    'text-align:center;margin-top:12px;font-size:.85rem;color:var(--admin-text-muted)';
  form.appendChild(caption);

  // Small delay so the branded login screen is visible for a beat instead
  // of flashing straight past it.
  setTimeout(() => {
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true }));
  }, 500);
});
