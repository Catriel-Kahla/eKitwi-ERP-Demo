/**
 * notifications.js
 * Campanita del navbar. Se alimenta de las solicitudes de aprobación del
 * permiso "Preguntar" (ver API/src/suit-approvals):
 *  - owner / SUPER_ADMIN: solicitudes pendientes de resolver → click abre
 *    la pestaña Equipo, donde se aceptan/rechazan.
 *  - miembro del equipo: estado de sus propias solicitudes (aprobada/
 *    rechazada/falló). "No leídas" = resueltas después de la última vez que
 *    abrió la campanita (localStorage por suit).
 * Polling cada 30 s mientras la pestaña está visible. Llamado desde
 * enterSuit() (shared-ui.js) vía initNotifications(suit).
 */

'use strict';

const NOTIF_POLL_MS = 30000;
let notifSuit = null;
let notifTimer = null;
let notifItems = [];
let notifUnread = 0;

const notifSeenKey = () => `ekitwi_erp_notif_seen_${notifSuit.id}`;
function notifGetSeen() {
  try { return Number(localStorage.getItem(notifSeenKey())) || 0; } catch { return 0; }
}
function notifSetSeen(ts) {
  try { localStorage.setItem(notifSeenKey(), String(ts)); } catch { /* sin storage */ }
}

function notifEnsureDom() {
  if (document.getElementById('notif-bell')) return;
  const right = document.querySelector('.nav-right');
  if (!right) return;
  const style = document.createElement('style');
  style.textContent = `
    #notif-bell { position: relative; background: none; border: none; color: var(--text, #fff); cursor: pointer; padding: 6px; margin-right: 8px; display: inline-flex; }
    #notif-bell svg { width: 22px; height: 22px; }
    #notif-badge { position: absolute; top: 0; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #ef4444; color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
    #notif-panel { position: absolute; top: calc(100% + 8px); right: 0; width: min(360px, calc(100vw - 32px)); max-height: 420px; overflow-y: auto; background: var(--surface, #111); border: 1px solid var(--border, #333); border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4); z-index: 1000; }
    #notif-panel .notif-head { padding: 12px 14px; font-weight: 600; border-bottom: 1px solid var(--border, #333); }
    #notif-panel .notif-item { display: block; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid var(--border, #333); color: inherit; padding: 10px 14px; cursor: pointer; font: inherit; }
    #notif-panel .notif-item:hover { background: rgba(255,255,255,.05); }
    #notif-panel .notif-item.unread { border-left: 3px solid #ef4444; }
    #notif-panel .notif-sub { font-size: 12px; color: var(--text-muted, #aaa); margin-top: 2px; }
    #notif-panel .notif-empty { padding: 20px 14px; color: var(--text-muted, #aaa); font-size: 14px; }`;
  document.head.appendChild(style);

  const bell = document.createElement('button');
  bell.id = 'notif-bell';
  bell.type = 'button';
  bell.title = 'Notificaciones';
  bell.setAttribute('aria-label', 'Notificaciones');
  bell.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span id="notif-badge" hidden></span>`;
  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.hidden = true;
  right.insertBefore(panel, right.firstChild);
  right.insertBefore(bell, right.firstChild);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) notifMarkSeen();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notif-panel') && !e.target.closest('#notif-bell')) panel.hidden = true;
  });
  panel.addEventListener('click', (e) => {
    if (!e.target.closest('[data-notif-go]')) return;
    panel.hidden = true;
    document.querySelector('.side-item[data-panel="team"]')?.click();
  });
}

const NOTIF_ACTION = { create: 'crear', write: 'editar', delete: 'eliminar' };
const NOTIF_STATUS = { approved: '✅ Aprobada', rejected: '❌ Rechazada', failed: '⚠️ Falló al ejecutarse' };

// Normaliza a { title, sub, ts, unread, go } según el rol del usuario.
function notifBuild(rows) {
  if (isCurrentSuitOwner()) {
    return rows.map(a => ({
      title: `${[a.requester.firstName, a.requester.lastName].filter(Boolean).join(' ') || a.requester.email} quiere ${NOTIF_ACTION[a.action] || a.action}`,
      sub: `${a.summary} · ${new Date(a.createdAt).toLocaleString('es-AR')}`,
      unread: true,
      go: true,
    }));
  }
  const seen = notifGetSeen();
  return rows.filter(a => a.status !== 'pending').map(a => {
    const ts = new Date(a.resolvedAt || a.createdAt).getTime();
    return {
      title: `${NOTIF_STATUS[a.status] || a.status}: ${NOTIF_ACTION[a.action] || a.action}`,
      sub: a.status === 'failed' && a.resultNote ? a.resultNote : a.summary,
      ts,
      unread: ts > seen,
      go: false,
    };
  });
}

function notifRender() {
  const badge = document.getElementById('notif-badge');
  const panel = document.getElementById('notif-panel');
  if (!badge || !panel) return;
  notifUnread = notifItems.filter(n => n.unread).length;
  badge.hidden = !notifUnread;
  badge.textContent = notifUnread > 9 ? '9+' : String(notifUnread);
  panel.innerHTML = `<div class="notif-head">Notificaciones</div>` + (notifItems.length
    ? notifItems.map(n => `<button type="button" class="notif-item${n.unread ? ' unread' : ''}"${n.go ? ' data-notif-go' : ''}>
        <div>${esc(n.title)}</div><div class="notif-sub">${esc(n.sub)}</div></button>`).join('')
    : `<div class="notif-empty">No tenés notificaciones.</div>`);
}

function notifMarkSeen() {
  if (isCurrentSuitOwner() || !notifItems.length) return;
  notifSetSeen(Math.max(...notifItems.map(n => n.ts || 0)));
  // El badge se apaga al abrir; el punto rojo de cada ítem queda hasta el próximo refresh.
  const badge = document.getElementById('notif-badge');
  if (badge) badge.hidden = true;
}

async function notifRefresh(silent) {
  if (!notifSuit) return;
  try {
    const rows = isCurrentSuitOwner()
      ? await listApprovals(notifSuit.id, 'pending')
      : await apiGet(`/suits/${notifSuit.id}/approvals/mine`);
    const prevUnread = notifUnread;
    notifItems = notifBuild(rows);
    notifRender();
    if (silent && notifUnread > prevUnread) {
      showToast(isCurrentSuitOwner() ? 'Nueva solicitud de aprobación' : 'Tenés novedades en tus solicitudes');
    }
  } catch { /* sin red / sin permiso: la campanita queda como estaba */ }
}

function initNotifications(suit) {
  if (window.EKITWI_DEV_MODE) return;
  notifSuit = suit;
  notifItems = [];
  notifUnread = 0;
  notifEnsureDom();
  notifRender();
  notifRefresh(false);
  clearInterval(notifTimer);
  notifTimer = setInterval(() => { if (!document.hidden) notifRefresh(true); }, NOTIF_POLL_MS);
}
