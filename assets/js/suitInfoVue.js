/**
 * suitInfoVue.js
 * Vue de la pestaña "Suit Info". Mismo rol que suitInfo.js (que queda en el
 * repo sin cargarse — script tag removido de dashboard.html — de referencia/
 * rollback, igual que dashboardHome.js/bi.js): expone loadSuitInfoPanel
 * (llamado desde dashboard.js) e initSuitInfoEvents (no-op acá — @submit.
 * prevent en el template reemplaza el listener manual que armaba esa
 * función antes).
 *
 * Un solo formulario reactivo: nombre/descripción/canales de contacto del
 * suit. GET /suits/:id (getSuit) al entrar, PATCH /suits/:id/profile
 * (updateSuitProfile) al guardar — mismos calls que suitInfo.js.
 */

'use strict';

const SuitInfoApp = {
  data() {
    return {
      suitId: null,
      loading: false,
      saving: false,
      fields: { name: '', description: '', instagram: '', facebook: '', whatsapp: '' },
    };
  },
  methods: {
    // Entry point público — lo llama loadSuitInfoPanel() más abajo, cada vez
    // que se entra a la pestaña (initGlobalNav() en dashboard.js).
    async setSuit(suitId, suitName) {
      this.suitId = suitId;
      const labelEl = document.getElementById('suitinfo-suit-label');
      if (labelEl) labelEl.textContent = `Datos y canales de contacto de ${suitName}.`;
      this.fields = { name: suitName, description: '', instagram: '', facebook: '', whatsapp: '' };
      this.loading = true;
      try {
        const suit = await getSuit(suitId);
        this.fields = {
          name: suit.name || '', description: suit.description || '',
          instagram: suit.instagram || '', facebook: suit.facebook || '', whatsapp: suit.whatsapp || '',
        };
      } catch (err) {
        showToast(err.message || 'No se pudieron cargar los datos del suit', 'err');
      } finally {
        this.loading = false;
      }
    },
    async save() {
      if (!this.suitId) return;
      const name = this.fields.name.trim();
      if (name.length < 3) { showToast('El nombre debe tener al menos 3 caracteres', 'err'); return; }

      // Se mandan "" para poder borrar un canal (el DTO los acepta vacíos).
      const dto = {
        name,
        description: this.fields.description.trim(),
        instagram: this.fields.instagram.trim(),
        facebook: this.fields.facebook.trim(),
        whatsapp: this.fields.whatsapp.trim(),
      };

      this.saving = true;
      try {
        const updated = await updateSuitProfile(this.suitId, dto);
        this.fields = {
          name: updated.name || name, description: updated.description || '',
          instagram: updated.instagram || '', facebook: updated.facebook || '', whatsapp: updated.whatsapp || '',
        };
        showToast('Datos guardados');
        // #suitinfo-suit-label es vanilla (lo pone loadSuitInfoPanel), no
        // reactivo — se refresca acá igual que hacía suitInfo.js.
        const labelEl = document.getElementById('suitinfo-suit-label');
        if (labelEl) labelEl.textContent = `Datos y canales de contacto de ${this.fields.name}.`;
      } catch (err) {
        showToast(err.message || 'No se pudo guardar', 'err');
      } finally {
        this.saving = false;
      }
    },
  },
  template: `
    <div class="card" style="max-width:640px">
      <form @submit.prevent="save">
        <label class="crm-label crm-label-full">
          Nombre del suit
          <input type="text" v-model="fields.name" :disabled="loading || saving" placeholder="Ej: Martina" />
        </label>
        <label class="crm-label crm-label-full">
          Descripción
          <textarea v-model="fields.description" :disabled="loading || saving" rows="3" placeholder="Una línea sobre el comercio o el trabajo…"></textarea>
        </label>

        <div class="prod-modal-section-title" style="margin-top:8px">Canales de contacto</div>
        <p class="crm-muted" style="margin:0 0 12px">Se muestran en el sitio web del suit. Dejá un campo vacío para ocultar ese canal.</p>
        <label class="crm-label crm-label-full">
          Instagram
          <input type="text" v-model="fields.instagram" :disabled="loading || saving" placeholder="usuario o link (ej: martinaalonsogiq)" />
        </label>
        <label class="crm-label crm-label-full">
          Facebook
          <input type="text" v-model="fields.facebook" :disabled="loading || saving" placeholder="usuario, página o link" />
        </label>
        <label class="crm-label crm-label-full">
          WhatsApp
          <input type="text" v-model="fields.whatsapp" :disabled="loading || saving" placeholder="+54 9 2284 55-3324" />
        </label>

        <div class="form-actions" style="margin-top:16px">
          <button class="primary-btn" type="submit" :disabled="loading || saving">Guardar</button>
        </div>
      </form>
    </div>`,
};

// ── Entry point (misma firma que suitInfo.js) ─────────────────────────────

let suitInfoVueInstance = null;

function loadSuitInfoPanel(suitId, suitName) {
  if (!suitInfoVueInstance) {
    const mountEl = document.getElementById('suit-info-app');
    if (!mountEl) return;
    suitInfoVueInstance = Vue.createApp(SuitInfoApp).mount(mountEl);
  }
  suitInfoVueInstance.setSuit(suitId, suitName);
}

// El @submit.prevent del template reemplaza este listener — se deja vacía
// (no un no-op silencioso: dashboard.js la sigue llamando en el bootstrap)
// para no tener que tocar esa lista de initX Events().
function initSuitInfoEvents() {}
