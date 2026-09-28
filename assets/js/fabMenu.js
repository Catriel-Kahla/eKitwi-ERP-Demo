/**
 * fabMenu.js — junta los dos botones flotantes de la esquina inferior
 * derecha (Asistente IA + Reportar incidencia) en un solo "speed dial":
 * un botón "⋯" que al tocarlo despliega dos botones circulares.
 *
 * Antes se pisaban entre sí (el FAB de reportWidget.js tapaba la burbuja
 * del asistente). Este archivo NO toca a assistant.js ni reportWidget.js
 * (este último es compartido con Identity/Tools): solo esconde sus botones
 * originales y dispara su `.click()` desde los botones del menú, así toda
 * su lógica sigue igual.
 *
 * Se carga después de assistant.js y reportWidget.js en dashboard.html.
 */
(function () {
    'use strict';

    function hide(el) {
        if (el) el.style.setProperty('display', 'none', 'important');
    }

    function build() {
        const assistantBubble = document.getElementById('assistant-bubble');
        const reportFab = document.getElementById('ek-report-fab');

        // Necesita al menos uno de los dos para tener sentido.
        if (!assistantBubble && !reportFab) return;

        // Si ya lo armamos (p. ej. reintento), no duplicar.
        if (document.getElementById('ek-fab-menu')) return;

        const style = document.createElement('style');
        style.textContent = `
            #ek-fab-menu {
                position: fixed; right: 24px; bottom: 24px; z-index: 998;
                display: flex; flex-direction: column-reverse; align-items: center; gap: 12px;
                pointer-events: none; /* el hueco de las acciones colapsadas no bloquea la página */
            }
            #ek-fab-trigger {
                width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
                background: var(--purple-grad, #7c3aed); color: var(--purple-ink, #fff);
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 12px 32px rgba(12,4,24,.55);
                transition: transform .2s, filter .15s;
                pointer-events: auto;
            }
            #ek-fab-trigger:hover { filter: brightness(1.18); }
            #ek-fab-menu.open #ek-fab-trigger { transform: rotate(90deg); }
            #ek-fab-trigger svg { width: 24px; height: 24px; }
            .ek-fab-action {
                width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                font-size: 20px; line-height: 1;
                background: var(--surface, #1a1a22); color: var(--text, #e5e5ef);
                border: 1px solid var(--border, rgba(255,255,255,.14));
                box-shadow: 0 8px 24px rgba(0,0,0,.4);
                opacity: 0; transform: translateY(12px) scale(.8); pointer-events: none;
                transition: opacity .18s, transform .18s;
            }
            .ek-fab-action svg { width: 22px; height: 22px; }
            #ek-fab-menu.open .ek-fab-action {
                opacity: 1; transform: translateY(0) scale(1); pointer-events: auto;
            }
            #ek-fab-menu.open .ek-fab-action:nth-child(2) { transition-delay: .04s; }
            #ek-fab-menu.open .ek-fab-action:nth-child(3) { transition-delay: .08s; }
            .ek-fab-action:hover { border-color: #7c3aed; }
            .ek-fab-label {
                position: absolute; right: 60px; white-space: nowrap;
                background: #14141c; color: #e5e5ef; font: 600 12px/1 system-ui, sans-serif;
                padding: 6px 10px; border-radius: 6px; opacity: 0; pointer-events: none;
                transition: opacity .15s;
            }
            .ek-fab-action { position: relative; }
            .ek-fab-action:hover .ek-fab-label { opacity: 1; }
            @media (max-width: 640px) {
                #ek-fab-menu { right: 16px; bottom: 16px; }
            }
        `;
        document.head.appendChild(style);

        const menu = document.createElement('div');
        menu.id = 'ek-fab-menu';

        const trigger = document.createElement('button');
        trigger.id = 'ek-fab-trigger';
        trigger.type = 'button';
        trigger.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

        function setOpen(open) {
            menu.classList.toggle('open', open);
            trigger.setAttribute('aria-expanded', String(open));
        }

        const actions = [];
        if (assistantBubble) {
            actions.push({
                label: 'Asistente IA',
                html: (typeof ICONS !== 'undefined' && ICONS.assistant) ||
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
                onClick: () => assistantBubble.click(),
            });
        }
        if (reportFab) {
            actions.push({
                label: 'Reportar un bug',
                html: '🐞',
                onClick: () => reportFab.click(),
            });
        }

        // Un solo botón → sin menú, el trigger lo dispara directo.
        if (actions.length === 1) {
            trigger.innerHTML = actions[0].html;
            trigger.setAttribute('aria-label', actions[0].label);
            trigger.addEventListener('click', actions[0].onClick);
            menu.appendChild(trigger);
            hide(assistantBubble);
            hide(reportFab);
            document.body.appendChild(menu);
            return;
        }

        // column-reverse: el primer hijo del DOM queda abajo (en la esquina).
        // Orden DOM [trigger, action0, action1] → visual (abajo→arriba)
        // trigger, action0, action1.
        trigger.setAttribute('aria-label', 'Más acciones');
        trigger.setAttribute('aria-expanded', 'false');
        menu.appendChild(trigger);

        actions.forEach(({ label, html, onClick }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ek-fab-action';
            btn.setAttribute('aria-label', label);
            btn.innerHTML = `${html}<span class="ek-fab-label">${label}</span>`;
            btn.addEventListener('click', () => {
                setOpen(false);
                onClick();
            });
            menu.appendChild(btn);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(!menu.classList.contains('open'));
        });
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target)) setOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') setOpen(false);
        });

        hide(assistantBubble);
        hide(reportFab);
        document.body.appendChild(menu);
    }

    // Corre después de que reportWidget.js y dashboard.js (initAssistant)
    // hayan armado sus botones.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(build, 0));
    } else {
        setTimeout(build, 0);
    }
})();
