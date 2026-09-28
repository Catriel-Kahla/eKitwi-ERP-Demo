/**
 * auth.js
 * Login form, session cookie and route guard for eKitwi ERP.
 * Authenticates against the same eKitwi Identity account used across the
 * whole Suite (POST /api/auth/login on the shared api.ekitwi.com backend) —
 * unless window.EKITWI_DEV_MODE is on (see constants/apiConfig.js), in
 * which case login is faked locally. On success (and when an already-
 * authenticated user lands back on the login page), this redirects
 * SUPER_ADMIN/ADMIN to pages/suitselection.html, not straight to the
 * dashboard — that page decides whether there's anything to pick and,
 * if not, forwards to pages/dashboard.html itself. See APIconnection.md.
 * Any other role (shared login across the whole Suite, e.g. a CUSTOMER
 * account from the storefront) goes to pages/upgrade.html instead — the
 * ERP has nothing to show them until they own a suit.
 */

'use strict';

const ERP_COOKIE_NAME       = 'ekitwi_erp_token';
// Built from window.EKITWI_SITE_ROOT (see constants/apiConfig.js), not
// hardcoded absolute paths — this fork isn't pinned to a domain root, so it
// has to work whether it's served at a GitHub Pages project URL, a custom
// domain, or a plain local file server.
const ERP_LOGIN_PATH        = window.EKITWI_SITE_ROOT + 'index.html';
const ERP_DASH_PATH         = window.EKITWI_SITE_ROOT + 'pages/dashboard.html';
const ERP_SUIT_SELECT_PATH  = window.EKITWI_SITE_ROOT + 'pages/suitselection.html';
const ERP_UPGRADE_PATH      = window.EKITWI_SITE_ROOT + 'pages/upgrade.html';

// ── Cookie helpers ───────────────────────────────────────────────────────

function setErpToken(token, expiresInSeconds) {
  const expires = new Date(Date.now() + expiresInSeconds * 1000).toUTCString();
  document.cookie = `${ERP_COOKIE_NAME}=${encodeURIComponent(token)}; expires=${expires}; path=/; SameSite=Strict; Secure`;
}

function getErpToken() {
  const match = document.cookie
    .split('; ')
    .find(row => row.startsWith(ERP_COOKIE_NAME + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function clearErpToken() {
  document.cookie = `${ERP_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict; Secure`;
}

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

// SUPER_ADMIN de plataforma — el mismo rol que da acceso al panel admin de
// Identity. Es el único que puede saltear un módulo en mantenimiento
// (system-status.allowAdminAccess), no el ADMIN dueño de un suit.
function isAdmin() {
  const token = getErpToken();
  const payload = token ? decodeJwt(token) : null;
  return payload?.roleName === 'SUPER_ADMIN';
}

// Fakes a JWT-shaped token so decodeJwt/dashboard.js work unchanged while
// EKITWI_DEV_MODE is on — no real backend call, no real signature.
function buildFakeToken(email) {
  const header  = { alg: 'none', typ: 'JWT' };
  const payload = {
    sub:      'dev-user',
    email,
    roleId:   'dev-role',
    roleName: 'SUPER_ADMIN',
    exp:      Math.floor(Date.now() / 1000) + 8 * 60 * 60
  };
  const b64 = obj => btoa(JSON.stringify(obj));
  return `${b64(header)}.${b64(payload)}.dev-signature`;
}

// ── Route guard ───────────────────────────────────────────────────────────
// Include auth.js on every page; redirects to login if there's no session,
// and away from the login page if there already is one.

(function routeGuard() {
  const path        = window.location.pathname;
  // path === EKITWI_SITE_ROOT covers the bare project-URL root too, e.g.
  // GitHub Pages serving "/ekitwi-erp-demo/" for index.html without the
  // filename showing up in the address bar.
  const onLogin     = path === '/' || path === window.EKITWI_SITE_ROOT || path.endsWith('/index.html');
  const onUpgrade   = path.endsWith(ERP_UPGRADE_PATH);
  const token       = getErpToken();
  const payload     = token ? decodeJwt(token) : null;

  // Login compartido con todo el Suite: un rol que no sea SUPER_ADMIN/ADMIN
  // (p.ej. CUSTOMER, la cuenta de comprador de la tienda online) no tiene
  // ningún suit que administrar acá — en vez de dejarlo entrar a un ERP
  // vacío, lo mandamos a la pantalla de "contratá un plan".
  const hasErpAccess = payload && (payload.roleName === 'SUPER_ADMIN' || payload.roleName === 'ADMIN');

  if (!onLogin && !token) {
    window.location.replace(ERP_LOGIN_PATH);
    return;
  }

  // Cubre tanto el login (redirect post-submit) como cualquier otra página
  // protegida cargada directamente con una sesión no admin ya activa.
  if (token && payload && !hasErpAccess && !onUpgrade) {
    window.location.replace(ERP_UPGRADE_PATH);
    return;
  }

  if (onLogin && token && payload && hasErpAccess) {
    window.location.replace(ERP_SUIT_SELECT_PATH);
  }
})();

// ── Login form ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('erp-login-form');
  if (!form) return; // not on the login page

  const btn   = document.getElementById('login-btn');
  const error = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email    = document.getElementById('erp-email').value.trim().toLowerCase();
    const password = document.getElementById('erp-password').value;

    if (!email || !password) {
      showError('Por favor completá todos los campos.');
      return;
    }

    setLoading(true);

    try {
      let accessToken;

      if (window.EKITWI_DEV_MODE) {
        // No backend call — see APIconnection.md.
        accessToken = buildFakeToken(email);
      } else {
        const res = await fetch(`${window.ADMIN_API_BASE_URL}/api/auth/login`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email, password })
        });

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error('Respuesta inválida del servidor.');
        }

        if (!res.ok || !data.access_token) {
          throw new Error(data.message || data.error || 'Credenciales incorrectas.');
        }

        accessToken = data.access_token;
      }

      let ttl = 8 * 60 * 60;
      const payload = decodeJwt(accessToken);
      if (payload?.exp) ttl = payload.exp - Math.floor(Date.now() / 1000);

      setErpToken(accessToken, ttl);
      const hasErpAccess = payload && (payload.roleName === 'SUPER_ADMIN' || payload.roleName === 'ADMIN');
      window.location.replace(hasErpAccess ? ERP_SUIT_SELECT_PATH : ERP_UPGRADE_PATH);

    } catch (err) {
      showError(err.message || 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  });

  function showError(msg) {
    error.textContent = msg;
    error.classList.remove('hidden');
  }

  function hideError() {
    error.textContent = '';
    error.classList.add('hidden');
  }

  function setLoading(loading) {
    btn.classList.toggle('loading', loading);
    btn.classList.toggle('disabled', loading);
  }
});

// ── Register form ─────────────────────────────────────────────────────────
// Crea la cuenta como ADMIN (rol por defecto de POST /auth/register cuando
// no se manda `role`) — mismo rol que un dueño de suit existente. No inicia
// sesión sola: el backend exige confirmar el email antes del primer login.

document.addEventListener('DOMContentLoaded', () => {
  const registerLink = document.getElementById('register-link');
  const backLink      = document.getElementById('back-to-login-from-register-link');
  const loginForm     = document.getElementById('erp-login-form');
  const registerPanel = document.getElementById('register-panel');
  const registerForm  = document.getElementById('register-form');

  if (!registerForm) return; // not on the login page

  registerLink?.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerPanel.style.display = 'block';
  });

  backLink?.addEventListener('click', (e) => {
    e.preventDefault();
    registerPanel.style.display = 'none';
    loginForm.style.display = '';
  });

  const regError   = document.getElementById('register-error');
  const regSuccess = document.getElementById('register-success');
  const regBtn     = document.getElementById('register-submit-btn');

  function showRegError(msg) {
    regSuccess.classList.add('hidden');
    regError.textContent = msg;
    regError.classList.remove('hidden');
  }

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    regError.classList.add('hidden');
    regSuccess.classList.add('hidden');

    const email    = document.getElementById('register-email').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;
    const confirm  = document.getElementById('register-confirm').value;
    const terms    = document.getElementById('register-terms').checked;

    if (!email || !password || !confirm) {
      showRegError('Por favor completá todos los campos.');
      return;
    }
    if (password !== confirm) {
      showRegError('Las contraseñas no coinciden.');
      return;
    }
    if (password.length < 8) {
      showRegError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!terms) {
      showRegError('Tenés que aceptar los Términos y Condiciones para crear la cuenta.');
      return;
    }

    regBtn.classList.add('loading', 'disabled');

    try {
      const res = await fetch(`${window.ADMIN_API_BASE_URL}/api/auth/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password, acceptedTerms: true })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        Array.from(registerForm.children).forEach(el => { el.style.display = 'none'; });
        regSuccess.textContent = data.message || 'Te enviamos un email para confirmar tu cuenta. Confirmala y después iniciá sesión.';
        regSuccess.classList.remove('hidden');
      } else {
        showRegError(data.message || data.error || 'No se pudo crear la cuenta.');
      }
    } catch (err) {
      showRegError('No se pudo conectar con el servidor.');
    } finally {
      regBtn.classList.remove('loading', 'disabled');
    }
  });
});

// ── Logout ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearErpToken();
    // The active-suit choice (suit-state.js) is only remembered for the
    // life of this session — closing it means picking again on next login,
    // even with just one suit's worth of "nothing to choose".
    if (typeof clearCurrentSuitId === 'function') clearCurrentSuitId();
    window.location.replace(ERP_LOGIN_PATH);
  });
});
