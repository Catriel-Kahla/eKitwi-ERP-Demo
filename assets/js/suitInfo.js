/**
 * suitInfo.js
 * Pestaña "Suit Info" (siempre visible en el menú "Apps"): el owner edita el
 * nombre del suit, su descripción y los canales de contacto (Instagram,
 * Facebook, WhatsApp) que se muestran dinámicamente en su sitio web.
 * Entry point loadSuitInfoPanel(suitId, suitName), llamado desde
 * dashboard.js. Escribe con PATCH /suits/:id/profile (updateSuitProfile).
 */

'use strict';

let currentInfoSuit = null;

async function loadSuitInfoPanel(suitId, suitName) {
  currentInfoSuit = { id: suitId, name: suitName };
  document.getElementById('suitinfo-suit-label').textContent =
    `Datos y canales de contacto de ${suitName}.`;

  const form = document.getElementById('suitinfo-form');
  setSuitInfoFields({ name: suitName, description: '', instagram: '', facebook: '', whatsapp: '' });
  form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });

  try {
    const suit = await getSuit(suitId);
    setSuitInfoFields(suit);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los datos del suit', 'err');
  } finally {
    form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = false; });
  }
}

function setSuitInfoFields(suit) {
  document.getElementById('si-name').value      = suit.name || '';
  document.getElementById('si-desc').value      = suit.description || '';
  document.getElementById('si-instagram').value = suit.instagram || '';
  document.getElementById('si-facebook').value  = suit.facebook || '';
  document.getElementById('si-whatsapp').value  = suit.whatsapp || '';
}

async function saveSuitInfo(e) {
  e.preventDefault();
  if (!currentInfoSuit) return;

  const name = document.getElementById('si-name').value.trim();
  if (name.length < 3) { showToast('El nombre debe tener al menos 3 caracteres', 'err'); return; }

  // Se mandan "" para poder borrar un canal (el DTO los acepta vacíos).
  const dto = {
    name,
    description: document.getElementById('si-desc').value.trim(),
    instagram:  document.getElementById('si-instagram').value.trim(),
    facebook:   document.getElementById('si-facebook').value.trim(),
    whatsapp:   document.getElementById('si-whatsapp').value.trim(),
  };

  const btn = document.getElementById('si-save');
  btn.disabled = true;
  try {
    const updated = await updateSuitProfile(currentInfoSuit.id, dto);
    setSuitInfoFields(updated);
    currentInfoSuit.name = updated.name || name;
    showToast('Datos guardados');
    // Refrescar el nombre en la tarjeta del suit y el menú "Apps".
    if (typeof getCurrentSuitId === 'function') {
      // renderAppsMenu se re-arma con el próximo enterSuit; acá alcanza con
      // actualizar la etiqueta visible del panel.
      document.getElementById('suitinfo-suit-label').textContent =
        `Datos y canales de contacto de ${currentInfoSuit.name}.`;
    }
  } catch (err) {
    showToast(err.message || 'No se pudo guardar', 'err');
  } finally {
    btn.disabled = false;
  }
}

function initSuitInfoEvents() {
  const form = document.getElementById('suitinfo-form');
  if (form) form.addEventListener('submit', saveSuitInfo);
}
