/**
 * demo-banner.js — public demo fork only, not part of the real product.
 *
 * Shows a persistent "this is a demo" ribbon on every authenticated page, and
 * reloads the tab periodically so mocks.js's in-memory fixtures (mutated by
 * whatever a visitor clicked) go back to their pristine values — mock data
 * lives only in JS variables re-initialized on script load, nothing is
 * persisted to a backend, so a reload IS the reset. The session (login
 * cookie + selected suit, both in auth.js/suit-state.js) survives the
 * reload, so visitors land back on the dashboard, not the login screen.
 */

'use strict';

const DEMO_RESET_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

document.addEventListener('DOMContentLoaded', () => {
  const banner = document.createElement('div');
  banner.id = 'demo-banner';
  banner.innerHTML = `
    <span>🧪 Demo pública de eKitwi ERP — datos de ejemplo, se reinician automáticamente.</span>
    <button type="button" id="demo-reset-now">Reiniciar ahora</button>
  `;
  banner.style.cssText = `
    position: fixed; left: 0; right: 0; z-index: 90;
    display: flex; align-items: center; justify-content: center; gap: 14px;
    flex-wrap: wrap; padding: 8px 16px;
    background: #eda100; color: #1f2530; font-size: 0.82rem; font-weight: 500;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    opacity: 0.5;
  `;
  document.body.appendChild(banner);

  // Sits below the real product's top nav (.bubble-nav, `position: fixed;
  // top: 20px`) instead of covering it — z-index kept under the nav's (100)
  // too, in case they ever overlap on a narrow viewport. Positioned off the
  // nav's own measured height so this never depends on a hardcoded number.
  const nav = document.querySelector('.bubble-nav');
  const navBottom = nav ? nav.getBoundingClientRect().bottom : 84;
  banner.style.top = `${navBottom + 12}px`;

  document.getElementById('demo-reset-now').addEventListener('click', () => location.reload());
  document.getElementById('demo-reset-now').style.cssText =
    'border:1px solid #1f2530;background:transparent;border-radius:6px;padding:2px 10px;cursor:pointer;font:inherit;color:inherit';

  setTimeout(() => location.reload(), DEMO_RESET_INTERVAL_MS);
});
