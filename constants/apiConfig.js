// apiConfig.js - Centralized API endpoint configuration
//
// ── THIS IS THE PUBLIC PORTFOLIO DEMO FORK ──────────────────────────────
// Forked from the real eKitwi ERP frontend, deployable anywhere static
// (GitHub Pages project URL, a custom domain, a plain file server) with
// zero backend: DEV_MODE is force-enabled below and never toggled by
// hostname. All data comes from assets/js/mocks.js (fake business data) —
// nothing here ever touches the real product, its API or its database.
// See ../README.md for what else changed (auto-login, reset banner).

// ── DEV MODE ─────────────────────────────────────────────────────────────
// While true: login fakes a session locally (no backend call) and
// dashboard.js renders MOCK_SUITS instead of calling GET /suits — lets the
// whole front end (sidebar, Commerce, Inventory) be reviewed with no
// backend reachable at all.
window.EKITWI_DEV_MODE = true;

// No real backend, ever, in this fork — deliberately not the real API's
// hostname, so any DEV_MODE check someone forgets fails loudly (network
// error) instead of silently hitting eKitwi's production API.
window.API_BASE_URL       = '';
window.ADMIN_API_BASE_URL = '';

// ── Site root ─────────────────────────────────────────────────────────────
// The real product deploys at a domain root (erp.ekitwi.com), so its HTML/JS
// link every internal page with absolute paths ("/pages/dashboard.html").
// This fork has no fixed domain — it needs to work at a GitHub Pages project
// URL (github.io/<repo>/), a custom domain, or a plain local file server —
// so every page-to-page redirect is built from this instead. Derived purely
// from the current URL, not a hardcoded repo name: whatever sits before
// "/pages/" (or before the current file, if we're not under pages/) is the
// site root. See assets/js/auth.js, the only file that used those 4
// hardcoded paths.
window.EKITWI_SITE_ROOT = (() => {
    const path = window.location.pathname;
    const pagesAt = path.indexOf('/pages/');
    if (pagesAt !== -1) return path.slice(0, pagesAt + 1);
    return path.slice(0, path.lastIndexOf('/') + 1);
})();

// Other eKitwi Suite apps this ERP hub links out to, keyed by suit "system"
// type (see GET /suits/:id/systems — 'ecommerce' | 'booking' | 'scrum' |
// 'contable'). 'identity' isn't a system, it's the always-present
// account/account-admin link. Every system (Commerce/Inventory, Bookings,
// Projects, Accounting) now lives natively in this ERP — 'identity' is the
// only entry left here, since it's account management, not a suit module.
window.EKITWI_MODULE_URLS = {
    identity: 'https://identity.ekitwi.com'
};
