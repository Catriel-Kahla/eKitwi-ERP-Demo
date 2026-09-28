/**
 * assistant.js
 * Asistente virtual flotante — disponible desde cualquier panel del
 * dashboard, no atado a un panel de suit como los demás. Mantiene una sola
 * conversación en memoria por suit activo (se crea sola la primera vez que
 * se abre el panel para ese suit); si el modelo pide una acción de
 * escritura, el backend la deja como "pending_confirmation" en vez de
 * ejecutarla — acá se muestra como una tarjeta con Confirmar/Cancelar,
 * igual que el resto del ERP nunca borra/cancela/devuelve sin ese paso.
 */

'use strict';

let assistantConversationId = null;
let assistantConversationSuitId = null;
let assistantSending = false;

function initAssistant() {
  const bubble   = document.getElementById('assistant-bubble');
  const panel    = document.getElementById('assistant-panel');
  const closeBtn = document.getElementById('assistant-close');
  const form     = document.getElementById('assistant-form');
  const input    = document.getElementById('assistant-input');

  bubble.innerHTML = ICONS.assistant;

  bubble.addEventListener('click', async () => {
    const opening = !panel.classList.contains('open');
    panel.classList.toggle('open');
    if (opening) {
      input.focus();
      try {
        await ensureAssistantConversation();
      } catch (err) {
        showToast(err.message, 'err');
      }
    }
  });

  closeBtn.addEventListener('click', () => panel.classList.remove('open'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content || assistantSending) return;

    input.value = '';
    renderAssistantMessage({ role: 'user', content, status: 'done' });
    assistantSending = true;
    try {
      await ensureAssistantConversation();
      const suitId = getCurrentSuitId();
      const reply = await sendAssistantMessage(suitId, assistantConversationId, content);
      renderAssistantMessage(reply);
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      assistantSending = false;
    }
  });
}

async function ensureAssistantConversation() {
  const suitId = getCurrentSuitId();
  if (assistantConversationId && assistantConversationSuitId === suitId) return;

  document.getElementById('assistant-messages').innerHTML = '';
  const conv = await startAssistantConversation(suitId);
  assistantConversationId = conv.id;
  assistantConversationSuitId = suitId;

  const history = await listAssistantMessages(suitId, assistantConversationId);
  history.filter((m) => m.role !== 'tool').forEach(renderAssistantMessage);

  if (!history.length) {
    renderAssistantMessage({
      role: 'assistant',
      status: 'done',
      content: '¡Hola! Preguntame algo sobre tus datos (ej. "¿qué productos tienen stock bajo?") o pedime una acción.'
    });
  }
}

function renderAssistantMessage(msg) {
  const messagesEl = document.getElementById('assistant-messages');
  const wrap = document.createElement('div');

  if (msg.status === 'pending_confirmation') {
    wrap.className = 'assistant-msg assistant-msg-pending';
    wrap.innerHTML = `
      <div>${esc(msg.content)}</div>
      <div class="assistant-msg-actions">
        <button class="primary-btn assistant-confirm-btn" type="button">Confirmar</button>
        <button class="ghost-btn assistant-cancel-btn" type="button">Cancelar</button>
      </div>
    `;
    wrap.querySelector('.assistant-confirm-btn').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const reply = await confirmAssistantAction(getCurrentSuitId(), assistantConversationId, msg.id);
        wrap.remove();
        renderAssistantMessage(reply);
      } catch (err) {
        showToast(err.message, 'err');
        e.currentTarget.disabled = false;
      }
    });
    wrap.querySelector('.assistant-cancel-btn').addEventListener('click', async () => {
      try {
        await cancelAssistantAction(getCurrentSuitId(), assistantConversationId, msg.id);
        wrap.remove();
      } catch (err) {
        showToast(err.message, 'err');
      }
    });
  } else {
    wrap.className = 'assistant-msg ' + (msg.role === 'user' ? 'assistant-msg-user' : 'assistant-msg-assistant');
    wrap.textContent = msg.content;
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
