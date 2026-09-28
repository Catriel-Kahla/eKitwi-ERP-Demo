// reportWidget.js — botón flotante "Reportar" para abrir una incidencia
// (bug tracker de eKitwi). El equipo eKitwi las revisa desde Identity.
//
// Autocontenido: sin jQuery ni Fomantic. Solo aparece si hay sesión.
// Se adapta por app cambiando CFG (cookie de sesión + origen). Backend:
// POST /api/incidencias — ver API/src/incidencias/incidencias.service.ts.
(function () {
    'use strict';

    // ── Config por app ────────────────────────────────────────────────────────
    const CFG = {
        cookie:    'ekitwi_erp_token', // nombre de la cookie de sesión de esta app
        appOrigin: 'erp',
        area:      'erp',              // área preseleccionada en el form
    };

    const API_BASE = (window.ADMIN_API_BASE_URL !== undefined && window.ADMIN_API_BASE_URL !== '')
        ? window.ADMIN_API_BASE_URL
        : ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:8000'
            : 'https://api.ekitwi.com');

    const SEVERITIES = [
        ['baja', 'Baja'], ['media', 'Media'], ['alta', 'Alta'], ['critica', 'Crítica'],
    ];

    function getToken() {
        const row = document.cookie.split('; ').find(r => r.startsWith(CFG.cookie + '='));
        return row ? decodeURIComponent(row.split('=')[1]) : null;
    }

    if (!getToken()) return; // sin sesión: no mostrar nada

    // ── Estilos ──────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        #ek-report-fab {
            position: fixed; right: 18px; bottom: 18px; z-index: 99998;
            background: #7c3aed; color: #fff; border: none; border-radius: 999px;
            padding: 10px 16px; font: 600 14px/1 system-ui, sans-serif; cursor: pointer;
            box-shadow: 0 4px 14px rgba(0,0,0,.35);
        }
        #ek-report-fab:hover { background: #6d28d9; }
        #ek-report-overlay {
            position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        #ek-report-overlay[hidden] { display: none; }
        #ek-report-card {
            background: #1a1a22; color: #e5e5ef; width: 100%; max-width: 460px;
            border-radius: 10px; border: 1px solid rgba(255,255,255,.1); overflow: hidden;
            font: 14px/1.45 system-ui, sans-serif;
        }
        #ek-report-card h3 { margin: 0; padding: 14px 16px; background: #14141c; font-size: 15px;
            border-bottom: 1px solid rgba(255,255,255,.08); }
        #ek-report-body { padding: 16px; display: grid; gap: 10px; }
        #ek-report-body label { font-size: 12px; color: #9a9aae; display: block; margin-bottom: 4px; }
        #ek-report-body input, #ek-report-body textarea, #ek-report-body select {
            width: 100%; box-sizing: border-box; background: #14141c; color: #e5e5ef;
            border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 8px 10px;
            font: inherit;
        }
        #ek-report-body textarea { resize: vertical; min-height: 90px; }
        #ek-report-err { color: #e55e5e; font-size: 13px; display: none; }
        #ek-report-actions { padding: 12px 16px; background: #14141c; display: flex; gap: 8px;
            justify-content: flex-end; border-top: 1px solid rgba(255,255,255,.08); }
        #ek-report-actions button { border: none; border-radius: 6px; padding: 8px 14px;
            font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
        #ek-report-cancel { background: transparent; color: #9a9aae; }
        #ek-report-send { background: #7c3aed; color: #fff; }
        #ek-report-send[disabled] { opacity: .6; cursor: default; }
        #ek-report-toast {
            position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%);
            z-index: 100000; background: #222; color: #fff; padding: 10px 16px; border-radius: 8px;
            font: 14px/1 system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.35); display: none;
        }
    `;

    const sevOptions = SEVERITIES
        .map(([v, l]) => `<option value="${v}"${v === 'media' ? ' selected' : ''}>${l}</option>`)
        .join('');

    const fab = document.createElement('button');
    fab.id = 'ek-report-fab';
    fab.type = 'button';
    fab.innerHTML = '🐞 Reportar';

    const overlay = document.createElement('div');
    overlay.id = 'ek-report-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div id="ek-report-card" role="dialog" aria-modal="true" aria-label="Reportar incidencia">
            <h3>Reportar una incidencia</h3>
            <div id="ek-report-body">
                <div>
                    <label for="ek-report-title">Título</label>
                    <input id="ek-report-title" type="text" maxlength="160" placeholder="Resumen corto del problema">
                </div>
                <div>
                    <label for="ek-report-sev">Severidad</label>
                    <select id="ek-report-sev">${sevOptions}</select>
                </div>
                <div>
                    <label for="ek-report-desc">Descripción</label>
                    <textarea id="ek-report-desc" placeholder="Qué pasó, qué esperabas y pasos para reproducirlo."></textarea>
                </div>
                <p id="ek-report-err"></p>
            </div>
            <div id="ek-report-actions">
                <button id="ek-report-cancel" type="button">Cancelar</button>
                <button id="ek-report-send" type="button">Enviar</button>
            </div>
        </div>`;

    const toast = document.createElement('div');
    toast.id = 'ek-report-toast';

    document.head.appendChild(style);
    document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(fab);
        document.body.appendChild(overlay);
        document.body.appendChild(toast);
        wire();
    });

    function showToast(msg, ok) {
        toast.textContent = (ok ? '✓ ' : '✗ ') + msg;
        toast.style.background = ok ? '#1e7e34' : '#8a2b2b';
        toast.style.display = 'block';
        setTimeout(function () { toast.style.display = 'none'; }, 3200);
    }

    function open() {
        document.getElementById('ek-report-title').value = '';
        document.getElementById('ek-report-desc').value = '';
        document.getElementById('ek-report-sev').value = 'media';
        document.getElementById('ek-report-err').style.display = 'none';
        overlay.hidden = false;
        document.getElementById('ek-report-title').focus();
    }
    function close() { overlay.hidden = true; }

    function wire() {
        fab.addEventListener('click', open);
        document.getElementById('ek-report-cancel').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !overlay.hidden) close();
        });

        document.getElementById('ek-report-send').addEventListener('click', function () {
            const btn   = this;
            const title = document.getElementById('ek-report-title').value.trim();
            const desc  = document.getElementById('ek-report-desc').value.trim();
            const sev   = document.getElementById('ek-report-sev').value;
            const err   = document.getElementById('ek-report-err');

            if (!title || !desc) {
                err.textContent = 'Título y descripción son requeridos.';
                err.style.display = 'block';
                return;
            }
            err.style.display = 'none';
            btn.disabled = true;

            fetch(API_BASE + '/api/incidencias', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken(),
                },
                body: JSON.stringify({
                    title: title,
                    description: desc,
                    severity: sev,
                    area: CFG.area,
                    appOrigin: CFG.appOrigin,
                    pageUrl: location.href,
                }),
            }).then(function (res) {
                if (!res.ok) throw new Error('http ' + res.status);
                close();
                showToast('Incidencia enviada. ¡Gracias!', true);
            }).catch(function () {
                err.textContent = 'No se pudo enviar. Intentá de nuevo.';
                err.style.display = 'block';
            }).finally(function () {
                btn.disabled = false;
            });
        });
    }
})();
