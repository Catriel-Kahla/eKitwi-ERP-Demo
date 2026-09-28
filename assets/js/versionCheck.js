// versionCheck.js - cache invalidation por versión global de eKitwi
//
// Compara la versión global (GET /api/version, tabla ek_version, editable
// por el superadmin desde Identity) contra la última vista en este
// navegador (localStorage). Si es la misma, no hace nada. Si cambió,
// invalida el cache y recarga una sola vez para traer CSS/JS/HTML
// actualizados. Ver API/src/version/version.service.ts.
(function () {
    const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '8000')
        ? 'http://localhost:8000'
        : 'https://api.ekitwi.com';

    const VERSION_KEY = 'ekitwi_version';
    const RELOAD_GUARD_KEY = 'ekitwi_version_reload_pending';

    async function checkVersion() {
        try {
            const res = await fetch(`${API_BASE}/api/version`, { cache: 'no-store' });
            if (!res.ok) return;
            const { version } = await res.json();
            if (!version) return;

            const stored = localStorage.getItem(VERSION_KEY);
            if (stored === version) {
                sessionStorage.removeItem(RELOAD_GUARD_KEY);
                return;
            }

            localStorage.setItem(VERSION_KEY, version);

            if (!stored) return; // primera visita en este navegador: nada que invalidar todavía

            if (sessionStorage.getItem(RELOAD_GUARD_KEY) === version) return; // ya se intentó con esta versión
            sessionStorage.setItem(RELOAD_GUARD_KEY, version);

            if (window.caches && caches.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
            }

            window.location.reload();
        } catch (e) {
            // API no disponible: no interrumpir la carga normal de la página.
        }
    }

    checkVersion();
})();
