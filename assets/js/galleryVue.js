/**
 * galleryVue.js
 * Vue de las vistas "Home/Obras/Colecciones" del panel Galería. Mismo rol
 * que gallery.js (que queda en el repo sin cargarse — script tag removido
 * de dashboard.html — de referencia/rollback): expone loadGalleryPanel
 * (llamado desde dashboard.js) e initGalleryEvents.
 *
 * OJO: la sub-vista "Historias" (placa para Instagram, historias.js) NO se
 * convierte acá — sigue siendo vanilla, vive en su propio
 * #gallery-historias-view (sin tocar), y depende de cosas que este archivo
 * tiene que seguir exponiendo tal cual para no romperla:
 *   - currentGallerySuit (variable global, no reactiva — historias.js solo
 *     lee currentGallerySuit.id)
 *   - lastObras (variable global, no reactiva — historias.js arma un
 *     <select> a partir de esto)
 *   - showGalleryView(view) (función global — historias.js la llama para
 *     entrar/salir de su propia vista; acá además mueve el currentView
 *     reactivo de este componente)
 *   - enterHistorias (función global de historias.js) — el botón "Historias"
 *     de la vista home la llama por @click en vez del addEventListener
 *     externo que usaba antes historias.js:initHistoriasEvents(): ese nodo
 *     vive dentro de un v-if de Vue, así que se destruye y recrea cada vez
 *     que currentView sale y vuelve a 'home' — un listener atado desde
 *     afuera se perdería con él. Por eso historias.js ya no intenta atarlo.
 *
 * initGalleryEvents() monta la app acá (no lazy en loadGalleryPanel, como
 * los demás pilotos) simplemente para que "Historias" ya se pueda tocar
 * apenas carga el dashboard, sin depender de haber entrado antes a Galería.
 */

'use strict';

let currentGallerySuit = null;
let lastObras = [];

function showGalleryView(view) {
  if (galleryVueInstance) galleryVueInstance.currentView = view;
  const hv = document.getElementById('gallery-historias-view');
  if (hv) hv.hidden = view !== 'historias';
}

const GalleryApp = {
  data() {
    return {
      currentView: 'home',
      homeCounts: { obras: '—', colecciones: '—' },
      categories: [],
      search: '',
      obras:       { status: 'idle', data: [], error: null },
      colecciones: { status: 'idle', data: [], error: null },
      obraModal: {
        open: false, editId: null, name: '', desc: '', categoryId: '',
        priceOnRequest: false, price: '', active: true, saving: false, uploading: false,
        images: { status: 'empty-new', data: [], error: null },
      },
      coleccionModal: { open: false, editId: null, name: '', saving: false },
    };
  },
  methods: {
    ekCan,
    showGalleryView,
    enterHistorias, // global de historias.js — ver nota junto a #ga-enter-historias en el template.

    // Entry point público — lo llama loadGalleryPanel() más abajo.
    async setSuit(suitId, suitName, feature) {
      currentGallerySuit = { id: suitId, name: suitName };
      showGalleryView(feature === 'gallery_obras' ? 'obras' : 'home');
      await this.refreshHome();
      if (feature === 'gallery_obras') await this.fetchObras();
    },

    async refreshHome() {
      if (!currentGallerySuit) return;
      try {
        const [obrasRes, cats] = await Promise.all([
          listProducts(currentGallerySuit.id, { take: 100 }),
          listCategories(currentGallerySuit.id),
        ]);
        this.categories = cats || [];
        const nObras = obrasRes.pagination.total;
        const nCols = this.categories.length;
        this.homeCounts = {
          obras: `${nObras} obra${nObras === 1 ? '' : 's'}`,
          colecciones: `${nCols} colección${nCols === 1 ? '' : 'es'}`,
        };
      } catch {
        this.homeCounts.obras = 'Error al cargar';
      }
    },

    // ── Obras ────────────────────────────────────────────────────────
    enterObras() { showGalleryView('obras'); this.fetchObras(); },
    onSearchInput() {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.fetchObras(), 300);
    },
    async fetchObras() {
      if (!currentGallerySuit) return;
      this.obras = { status: 'loading', data: this.obras.data, error: null };
      try {
        const res = await listProducts(currentGallerySuit.id, { search: this.search.trim() || undefined, take: 100 });
        const data = res.data || [];
        lastObras = data;
        this.obras = { status: 'ok', data, error: null };
      } catch (err) {
        this.obras = { status: 'error', data: [], error: err.message || 'error' };
      }
    },
    obraCover(obra) {
      const imgs = obra.images || [];
      const primary = imgs.find(i => i.isPrimary) || imgs[0];
      return primary ? primary.url : '';
    },
    obraPriceLabel(obra) {
      if (obra.priceOnRequest) return 'Consultar';
      const n = Number(obra.price);
      return n > 0 ? fmtMoney(n) : '—';
    },

    async openObraModal(obraId) {
      if (!currentGallerySuit) return;
      try { this.categories = await listCategories(currentGallerySuit.id); } catch { this.categories = []; }

      const obra = obraId ? (this.obras.data.find(o => o.id === obraId) || null) : null;
      this.obraModal = {
        open: true, editId: obraId || null,
        name: obra?.name || '', desc: obra?.description || '',
        categoryId: obra?.category?.id || obra?.categoryId || '',
        priceOnRequest: obra?.priceOnRequest ?? false,
        price: (obra && !obra.priceOnRequest && Number(obra.price) > 0) ? obra.price : '',
        active: obra?.isActive ?? true,
        saving: false, uploading: false,
        images: { status: 'empty-new', data: [], error: null },
      };
      await this.refreshObraImages(obraId);
    },
    closeObraModal() { this.obraModal.open = false; },
    onPriceOnRequestChange() { if (this.obraModal.priceOnRequest) this.obraModal.price = ''; },

    async refreshObraImages(obraId) {
      if (!obraId) { this.obraModal.images = { status: 'empty-new', data: [], error: null }; return; }
      this.obraModal.images = { status: 'loading', data: [], error: null };
      try {
        const images = await listProductImages(currentGallerySuit.id, obraId);
        this.obraModal.images = { status: images.length ? 'ok' : 'empty', data: images, error: null };
      } catch (err) {
        this.obraModal.images = { status: 'error', data: [], error: err.message || 'error' };
      }
    },
    async uploadObraImage(e) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !this.obraModal.editId || !currentGallerySuit) return;

      const edited = await openImageEditor(file);
      if (!edited) return;

      this.obraModal.uploading = true;
      try {
        await uploadProductImage(currentGallerySuit.id, this.obraModal.editId, edited);
        await this.refreshObraImages(this.obraModal.editId);
      } catch (err) {
        showToast(err.message || 'No se pudo subir la imagen', 'err');
      } finally {
        this.obraModal.uploading = false;
      }
    },
    // Reabre una foto ya subida en el editor (recorte / brillo / etc.). Al
    // aplicar, se sube la versión editada, se conserva el "principal" y recién
    // ahí se elimina la anterior (si algo falla, la original queda intacta).
    async editObraImage(img) {
      if (!this.obraModal.editId || !currentGallerySuit || this.obraModal.uploading) return;
      let file;
      try {
        const res = await fetch(img.url, { mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        file = new File([blob], 'obra.' + ext, { type: blob.type || 'image/jpeg' });
      } catch (err) {
        showToast('No se pudo abrir esta imagen para editarla', 'err');
        return;
      }
      const edited = await openImageEditor(file);
      if (!edited) return;

      this.obraModal.uploading = true;
      try {
        const created = await uploadProductImage(currentGallerySuit.id, this.obraModal.editId, edited);
        if (img.isPrimary && created && created.id) {
          await setPrimaryProductImage(currentGallerySuit.id, this.obraModal.editId, created.id);
        }
        await deleteProductImage(currentGallerySuit.id, this.obraModal.editId, img.id);
        await this.refreshObraImages(this.obraModal.editId);
        await this.fetchObras();
        showToast('Imagen actualizada');
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar la imagen', 'err');
        await this.refreshObraImages(this.obraModal.editId);
      } finally {
        this.obraModal.uploading = false;
      }
    },
    async setObraImagePrimary(imgId) {
      try {
        await setPrimaryProductImage(currentGallerySuit.id, this.obraModal.editId, imgId);
        await this.refreshObraImages(this.obraModal.editId);
        await this.fetchObras();
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar la imagen', 'err');
      }
    },
    async deleteObraImage(imgId) {
      try {
        await deleteProductImage(currentGallerySuit.id, this.obraModal.editId, imgId);
        await this.refreshObraImages(this.obraModal.editId);
        await this.fetchObras();
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar la imagen', 'err');
      }
    },

    async saveObra() {
      const m = this.obraModal;
      const name = m.name.trim();
      const desc = m.desc.trim();
      const price = parseFloat(m.price);

      if (name.length < 3) { showToast('El título debe tener al menos 3 caracteres', 'err'); return; }
      if (desc.length < 10) { showToast('Agregá una descripción (técnica, medidas…)', 'err'); return; }
      if (!m.priceOnRequest && (isNaN(price) || price <= 0)) {
        showToast('Poné un precio o marcá “Precio a consultar”', 'err');
        return;
      }

      const dto = {
        name, description: desc,
        categoryId: m.categoryId || undefined,
        priceOnRequest: m.priceOnRequest,
        price: m.priceOnRequest ? undefined : price,
        isActive: m.active,
      };
      if (!m.editId) {
        dto.slug = (slugify(name) || 'obra') + '-' + Date.now().toString(36);
        // Campos de store que la galería no usa — valores neutros al crear.
        dto.stock = 0;
        dto.taxable = false;
      }

      m.saving = true;
      try {
        if (m.editId) {
          await this.updateObraRequest(m.editId, dto);
          showToast('Obra actualizada');
          this.closeObraModal();
        } else {
          const created = await createProduct(currentGallerySuit.id, dto);
          showToast('Obra creada — ahora subí la foto');
          m.editId = created.id;
          lastObras.unshift(created);
          await this.refreshObraImages(created.id);
        }
        await this.fetchObras();
        this.refreshHome();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar la obra', 'err');
      } finally {
        m.saving = false;
      }
    },
    // updateProduct no permite mandar categoryId undefined para "desvincular"
    // (usa null). Normalizamos acá.
    async updateObraRequest(obraId, dto) {
      const payload = { ...dto };
      if (payload.categoryId === undefined) payload.categoryId = null;
      return updateProduct(currentGallerySuit.id, obraId, payload);
    },
    deleteObra(obra) {
      openConfirmModal({
        message: `¿Eliminar la obra “${obra.name}”? No se puede deshacer.`,
        onConfirm: async () => {
          try {
            await deleteProduct(currentGallerySuit.id, obra.id);
            showToast('Obra eliminada');
            await this.fetchObras();
            this.refreshHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar', 'err');
          }
        },
      });
    },

    // ── Colecciones (alias de categorías) ─────────────────────────────
    enterColecciones() { showGalleryView('colecciones'); this.fetchColecciones(); },
    async fetchColecciones() {
      if (!currentGallerySuit) return;
      this.colecciones = { status: 'loading', data: [], error: null };
      try {
        const data = await listCategories(currentGallerySuit.id);
        this.categories = data;
        this.colecciones = { status: 'ok', data, error: null };
      } catch (err) {
        this.colecciones = { status: 'error', data: [], error: err.message || 'error' };
      }
    },
    openColeccionModal(col) {
      this.coleccionModal = { open: true, editId: col?.id || null, name: col?.name || '', saving: false };
    },
    closeColeccionModal() { this.coleccionModal.open = false; },
    async saveColeccion() {
      const m = this.coleccionModal;
      const name = m.name.trim();
      if (name.length < 2) { showToast('El nombre debe tener al menos 2 caracteres', 'err'); return; }
      const slug = (slugify(name) || 'coleccion').slice(0, 50);

      m.saving = true;
      try {
        if (m.editId) {
          await updateCategory(currentGallerySuit.id, m.editId, { name, slug });
          showToast('Colección actualizada');
        } else {
          await createCategory(currentGallerySuit.id, { name, slug });
          showToast('Colección creada');
        }
        this.closeColeccionModal();
        await this.fetchColecciones();
        this.refreshHome();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar la colección', 'err');
      } finally {
        m.saving = false;
      }
    },
    deleteColeccion(col) {
      const n = col._count?.products || 0;
      if (n > 0) {
        showToast(`No se puede eliminar “${col.name}”: tiene ${n} obra${n === 1 ? '' : 's'} relacionada${n === 1 ? '' : 's'}. Movelas a otra colección primero.`, 'err');
        return;
      }
      openConfirmModal({
        message: `¿Eliminar la colección “${col.name}”?`,
        onConfirm: async () => {
          try {
            await deleteCategory(currentGallerySuit.id, col.id);
            showToast('Colección eliminada');
            await this.fetchColecciones();
            this.refreshHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar', 'err');
          }
        },
      });
    },
  },
  template: `
    <!-- Home: entry cards -->
    <div v-if="currentView === 'home'" class="module-nav-grid">
      <button class="module-nav-card" id="ga-enter-obras" @click="enterObras">
        <div class="module-nav-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="module-nav-title">Obras</div>
        <div class="module-nav-desc">{{ homeCounts.obras }}</div>
      </button>
      <button class="module-nav-card" id="ga-enter-colecciones" @click="enterColecciones">
        <div class="module-nav-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        </div>
        <div class="module-nav-title">Colecciones</div>
        <div class="module-nav-desc">{{ homeCounts.colecciones }}</div>
      </button>
      <!-- "Historias" sigue viviendo en historias.js (vanilla) — este botón
           solo llama a su enterHistorias() global. No puede atarse por
           addEventListener externo como antes: este nodo se destruye y
           recrea cada vez que currentView sale y vuelve a 'home', así que
           cualquier listener externo se pierde con él (por eso ya no vive
           en historias.js:initHistoriasEvents). -->
      <button class="module-nav-card" id="ga-enter-historias" @click="enterHistorias">
        <div class="module-nav-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        </div>
        <div class="module-nav-title">Historias</div>
        <div class="module-nav-desc">Placas para Instagram</div>
      </button>
    </div>

    <!-- Obras sub-view -->
    <div v-else-if="currentView === 'obras'" class="inventory-subview">
      <button class="ghost-btn" @click="showGalleryView('home')">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <input type="text" v-model="search" @input="onSearchInput" placeholder="Buscar obra por título…" />
          <button v-if="ekCan('products', 'create')" class="primary-btn" @click="openObraModal(null)">+ Nueva obra</button>
        </div>
        <div class="ga-obras-grid">
          <p v-if="obras.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="obras.status === 'error'" class="crm-muted">No se pudieron cargar las obras ({{ obras.error }}).</p>
          <p v-else-if="!obras.data.length" class="crm-muted">Todavía no hay obras. Tocá “+ Nueva obra” para agregar la primera.</p>
          <template v-else>
            <div v-for="o in obras.data" :key="o.id" class="ga-obra-card" @click="openObraModal(o.id)">
              <div class="ga-obra-thumb">
                <img v-if="obraCover(o)" :src="obraCover(o)" :alt="o.name" loading="lazy" />
                <span v-else class="ga-obra-noimg">Sin foto</span>
                <span v-if="!o.isActive" class="ga-obra-hidden-badge">Oculta</span>
              </div>
              <div class="ga-obra-body">
                <div class="ga-obra-title">{{ o.name }}</div>
                <div class="ga-obra-meta">{{ o.category?.name || 'Sin colección' }} · {{ obraPriceLabel(o) }}</div>
              </div>
              <div class="ga-obra-actions">
                <span v-if="ekCan('products', 'write')" class="crm-action-btn" title="Editar" @click.stop="openObraModal(o.id)">✎</span>
                <span v-if="ekCan('products', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click.stop="deleteObra(o)">🗑</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Colecciones sub-view -->
    <div v-else-if="currentView === 'colecciones'" class="inventory-subview">
      <button class="ghost-btn" @click="showGalleryView('home')">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <button v-if="ekCan('products', 'create')" class="primary-btn" @click="openColeccionModal(null)">+ Nueva colección</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="colecciones.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="colecciones.status === 'error'" class="crm-muted">No se pudieron cargar las colecciones ({{ colecciones.error }}).</p>
          <p v-else-if="!colecciones.data.length" class="crm-muted">Sin colecciones. Son opcionales: agrupan las obras en el sitio.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Nombre</th><th></th></tr></thead>
            <tbody>
              <tr v-for="c in colecciones.data" :key="c.id">
                <td>{{ c.name }}</td>
                <td class="td-actions">
                  <span v-if="ekCan('products', 'write')" class="crm-action-btn" title="Renombrar" @click="openColeccionModal(c)">✎</span>
                  <span v-if="ekCan('products', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="deleteColeccion(c)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── Modal: Obra ─────────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: obraModal.open }">
      <div class="crm-modal prod-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ obraModal.editId ? 'Editar obra' : 'Nueva obra' }}</span>
          <span class="crm-modal-close" @click="closeObraModal">✕</span>
        </div>

        <div class="crm-form-group prod-modal-section">
          <label class="crm-label crm-label-full">
            Título
            <input type="text" v-model="obraModal.name" placeholder="Ej: Amanecer en el valle" />
          </label>
          <label class="crm-label crm-label-full">
            Descripción <span class="crm-muted">(técnica, medidas, año…)</span>
            <textarea v-model="obraModal.desc" rows="3" placeholder="Óleo sobre lienzo · 80 × 60 cm · 2024"></textarea>
          </label>
          <div class="crm-form-row">
            <label class="crm-label">
              Colección
              <select v-model="obraModal.categoryId">
                <option value="">Sin colección</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label class="crm-label">
              Precio
              <input type="number" v-model="obraModal.price" :disabled="obraModal.priceOnRequest" placeholder="0.00" min="0" step="0.01" />
            </label>
          </div>
          <div class="crm-form-row">
            <label class="crm-label-check">
              <input type="checkbox" v-model="obraModal.priceOnRequest" @change="onPriceOnRequestChange" />
              Precio a consultar (no se muestra el precio)
            </label>
            <label class="crm-label-check">
              <input type="checkbox" v-model="obraModal.active" />
              Visible en el sitio
            </label>
          </div>
        </div>

        <div class="crm-form-group prod-modal-section">
          <div class="prod-modal-section-title">Imagen</div>
          <p v-if="obraModal.images.status === 'empty-new'" class="crm-muted">Guardá la obra para poder subir la foto.</p>
          <p v-else-if="obraModal.images.status === 'error'" class="crm-muted">No se pudieron cargar las imágenes ({{ obraModal.images.error }}).</p>
          <p v-else-if="obraModal.images.status === 'empty'" class="crm-muted">Todavía no tiene foto. Subí una.</p>
          <div v-if="obraModal.images.status === 'ok'" class="prod-images-grid">
            <div v-for="img in obraModal.images.data" :key="img.id" :class="['prod-image-thumb', 'is-contain', img.isPrimary && 'is-primary']">
              <a :href="img.url" target="_blank" rel="noopener" title="Ver imagen completa"><img :src="img.url" alt="" /></a>
              <span v-if="img.isPrimary" class="prod-image-primary-badge">Principal</span>
              <div class="prod-image-actions">
                <a class="crm-action-btn" title="Ver completa" :href="img.url" target="_blank" rel="noopener">👁</a>
                <span v-if="ekCan('products', 'write')" class="crm-action-btn" title="Editar (recortar / ajustar)" @click="editObraImage(img)">✎</span>
                <span v-if="!img.isPrimary && ekCan('products', 'write')" class="crm-action-btn" title="Marcar como principal" @click="setObraImagePrimary(img.id)">★</span>
                <span v-if="ekCan('products', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="deleteObraImage(img.id)">🗑</span>
              </div>
            </div>
          </div>
          <div v-if="obraModal.editId && ekCan('products', 'create')" class="crm-toolbar">
            <input type="file" ref="obraFileInput" @change="uploadObraImage" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
            <button class="ghost-btn" type="button" :disabled="obraModal.uploading" @click="$refs.obraFileInput.click()">+ Subir imagen</button>
          </div>
        </div>

        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeObraModal">Cerrar</button>
          <button class="primary-btn" :disabled="obraModal.saving" @click="saveObra">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Colección ────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: coleccionModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ coleccionModal.editId ? 'Renombrar colección' : 'Nueva colección' }}</span>
          <span class="crm-modal-close" @click="closeColeccionModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label crm-label-full">
            Nombre
            <input type="text" v-model="coleccionModal.name" placeholder="Ej: Paisajes" />
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeColeccionModal">Cancelar</button>
          <button class="primary-btn" :disabled="coleccionModal.saving" @click="saveColeccion">Guardar</button>
        </div>
      </div>
    </div>`,
};

// ── Entry points (mismas firmas que gallery.js) ───────────────────────────

let galleryVueInstance = null;

// Se llama en el bootstrap (dashboard.js), no en loadGalleryPanel — ver nota
// al principio del archivo sobre por qué #ga-enter-historias necesita
// existir ya en el DOM cuando corre initHistoriasEvents(), justo después.
function initGalleryEvents() {
  const mountEl = document.getElementById('gallery-app');
  if (!mountEl) return;
  galleryVueInstance = Vue.createApp(GalleryApp).mount(mountEl);
}

function loadGalleryPanel(suitId, suitName, feature) {
  document.getElementById('gallery-suit-label').textContent = `Obras de ${suitName}`;
  galleryVueInstance?.setSuit(suitId, suitName, feature);
}
