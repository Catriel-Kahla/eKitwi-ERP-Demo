/**
 * gallery.js
 * Panel "Galería" del plan eKitwi Gallery. Una vitrina simple: obras (con
 * imagen, título, descripción y precio opcional) y colecciones para
 * agruparlas. Reutiliza las tablas de store vía la misma capa de datos que
 * Inventory (createProduct/updateProduct/deleteProduct/listProducts +
 * listCategories/createCategory/updateCategory/deleteCategory +
 * uploadProductImage/listProductImages/setPrimaryProductImage/
 * deleteProductImage) — acá solo cambia la UI: sin stock, SKU, proveedor,
 * impuestos ni sucursales.
 *
 * Entry point loadGalleryPanel(suitId, suitName, feature) desde dashboard.js.
 */

'use strict';

let currentGallerySuit = null;
let galleryCategories  = [];
let gaSearchTimer      = null;
let lastObras          = [];

async function loadGalleryPanel(suitId, suitName, feature) {
  currentGallerySuit = { id: suitId, name: suitName };
  document.getElementById('gallery-suit-label').textContent = `Obras de ${suitName}`;
  showGalleryView(feature === 'gallery_obras' ? 'obras' : 'home');
  await refreshGalleryHome();
  if (feature === 'gallery_obras') await fetchObras();
}

function showGalleryView(view) {
  document.getElementById('gallery-home').hidden             = view !== 'home';
  document.getElementById('gallery-obras-view').hidden       = view !== 'obras';
  document.getElementById('gallery-colecciones-view').hidden = view !== 'colecciones';
  document.getElementById('gallery-historias-view').hidden   = view !== 'historias';
}

async function refreshGalleryHome() {
  if (!currentGallerySuit) return;
  try {
    const [obrasRes, cats] = await Promise.all([
      listProducts(currentGallerySuit.id, { take: 100 }),
      listCategories(currentGallerySuit.id),
    ]);
    galleryCategories = cats || [];
    const nObras = obrasRes.pagination.total;
    const nCols  = galleryCategories.length;
    document.getElementById('ga-obras-count').textContent       = `${nObras} obra${nObras === 1 ? '' : 's'}`;
    document.getElementById('ga-colecciones-count').textContent = `${nCols} colección${nCols === 1 ? '' : 'es'}`;
  } catch (err) {
    document.getElementById('ga-obras-count').textContent = 'Error al cargar';
  }
}

// ── Obras ────────────────────────────────────────────────────────────────

async function enterObras() {
  showGalleryView('obras');
  gateCreateButton('btn-add-obra', 'products');
  await fetchObras();
}

async function fetchObras() {
  const grid = document.getElementById('ga-obras-grid');
  if (!currentGallerySuit) return;
  grid.innerHTML = '<p class="crm-muted">Cargando…</p>';

  const search = document.getElementById('ga-search').value.trim();
  try {
    const res = await listProducts(currentGallerySuit.id, { search: search || undefined, take: 100 });
    lastObras = res.data || [];
    renderObrasGrid(lastObras);
  } catch (err) {
    grid.innerHTML = `<p class="crm-muted">No se pudieron cargar las obras (${esc(err.message)}).</p>`;
  }
}

function obraCover(obra) {
  const imgs = obra.images || [];
  const primary = imgs.find(i => i.isPrimary) || imgs[0];
  return primary ? primary.url : '';
}

function obraPriceLabel(obra) {
  if (obra.priceOnRequest) return 'Consultar';
  const n = Number(obra.price);
  return n > 0 ? fmtMoney(n) : '—';
}

function renderObrasGrid(obras) {
  const grid = document.getElementById('ga-obras-grid');
  if (!obras.length) {
    grid.innerHTML = '<p class="crm-muted">Todavía no hay obras. Tocá “+ Nueva obra” para agregar la primera.</p>';
    return;
  }
  grid.innerHTML = obras.map(o => {
    const cover = obraCover(o);
    return `
      <div class="ga-obra-card" data-obra-id="${o.id}">
        <div class="ga-obra-thumb">
          ${cover ? `<img src="${esc(cover)}" alt="${esc(o.name)}" loading="lazy" />` : '<span class="ga-obra-noimg">Sin foto</span>'}
          ${o.isActive ? '' : '<span class="ga-obra-hidden-badge">Oculta</span>'}
        </div>
        <div class="ga-obra-body">
          <div class="ga-obra-title">${esc(o.name)}</div>
          <div class="ga-obra-meta">${esc(o.category?.name || 'Sin colección')} · ${esc(obraPriceLabel(o))}</div>
        </div>
        <div class="ga-obra-actions">
          <span class="crm-action-btn" data-edit-obra="${o.id}" title="Editar">✎</span>
          <span class="crm-action-btn btn-del" data-del-obra="${o.id}" title="Eliminar">🗑</span>
        </div>
      </div>`;
  }).join('');
  gateRowActions(grid, 'products');
}

// ── Modal de obra ────────────────────────────────────────────────────────

async function openObraModal(obraId) {
  if (!currentGallerySuit) return;

  try {
    galleryCategories = await listCategories(currentGallerySuit.id);
  } catch {
    galleryCategories = [];
  }
  document.getElementById('obra-category').innerHTML =
    '<option value="">Sin colección</option>' +
    galleryCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const obra = obraId ? (lastObras.find(o => o.id === obraId) || null) : null;

  document.getElementById('modal-obra-title').textContent = obra ? 'Editar obra' : 'Nueva obra';
  document.getElementById('modal-obra').dataset.editId = obraId || '';

  document.getElementById('obra-name').value             = obra?.name || '';
  document.getElementById('obra-desc').value             = obra?.description || '';
  document.getElementById('obra-category').value         = obra?.category?.id || obra?.categoryId || '';
  document.getElementById('obra-price').value            = (obra && !obra.priceOnRequest && Number(obra.price) > 0) ? obra.price : '';
  document.getElementById('obra-price-on-request').checked = obra?.priceOnRequest ?? false;
  document.getElementById('obra-active').checked         = obra?.isActive ?? true;
  syncObraPriceInput();

  await refreshObraImagesSection(obraId);
  document.getElementById('modal-obra').classList.add('open');
}

function syncObraPriceInput() {
  const onRequest = document.getElementById('obra-price-on-request').checked;
  const priceInput = document.getElementById('obra-price');
  priceInput.disabled = onRequest;
  if (onRequest) priceInput.value = '';
}

function closeObraModal() {
  document.getElementById('modal-obra').classList.remove('open');
}

async function refreshObraImagesSection(obraId) {
  const hint      = document.getElementById('obra-images-hint');
  const grid      = document.getElementById('obra-images-grid');
  const uploadRow = document.getElementById('obra-images-upload-row');

  if (!obraId) {
    hint.hidden = false;
    hint.textContent = 'Guardá la obra para poder subir la foto.';
    grid.hidden = true; grid.innerHTML = '';
    uploadRow.hidden = true;
    return;
  }

  uploadRow.hidden = !ekCan('products', 'create');
  try {
    const images = await listProductImages(currentGallerySuit.id, obraId);
    renderObraImages(images);
  } catch (err) {
    grid.hidden = true;
    hint.hidden = false;
    hint.textContent = `No se pudieron cargar las imágenes (${esc(err.message)}).`;
  }
}

function renderObraImages(images) {
  const hint = document.getElementById('obra-images-hint');
  const grid = document.getElementById('obra-images-grid');

  if (!images.length) {
    hint.hidden = false;
    hint.textContent = 'Todavía no tiene foto. Subí una.';
    grid.hidden = true; grid.innerHTML = '';
    return;
  }

  hint.hidden = true;
  grid.hidden = false;
  grid.innerHTML = images.map(img => `
    <div class="prod-image-thumb${img.isPrimary ? ' is-primary' : ''}">
      <img src="${esc(img.url)}" alt="" />
      ${img.isPrimary ? '<span class="prod-image-primary-badge">Principal</span>' : ''}
      <div class="prod-image-actions">
        ${img.isPrimary ? '' : `<span class="crm-action-btn" data-set-primary-obra-image="${img.id}" title="Marcar como principal">★</span>`}
        <span class="crm-action-btn btn-del" data-del-obra-image="${img.id}" title="Eliminar">🗑</span>
      </div>
    </div>
  `).join('');
  gateRowActions(grid, 'products');
}

async function uploadCurrentObraImage(file) {
  const obraId = document.getElementById('modal-obra').dataset.editId;
  if (!obraId || !currentGallerySuit) return;

  const edited = await openImageEditor(file);
  if (!edited) return; // canceló el editor

  const btn = document.getElementById('obra-image-upload-btn');
  btn.disabled = true;
  try {
    await uploadProductImage(currentGallerySuit.id, obraId, edited);
    await refreshObraImagesSection(obraId);
  } catch (err) {
    showToast(err.message || 'No se pudo subir la imagen', 'err');
  } finally {
    btn.disabled = false;
  }
}

async function saveObra() {
  const editId = document.getElementById('modal-obra').dataset.editId;
  const name = document.getElementById('obra-name').value.trim();
  const desc = document.getElementById('obra-desc').value.trim();
  const onRequest = document.getElementById('obra-price-on-request').checked;
  const priceRaw = document.getElementById('obra-price').value;
  const price = parseFloat(priceRaw);

  if (name.length < 3) { showToast('El título debe tener al menos 3 caracteres', 'err'); return; }
  if (desc.length < 10) { showToast('Agregá una descripción (técnica, medidas…)', 'err'); return; }
  if (!onRequest && (isNaN(price) || price <= 0)) {
    showToast('Poné un precio o marcá “Precio a consultar”', 'err');
    return;
  }

  const dto = {
    name,
    description: desc,
    categoryId: document.getElementById('obra-category').value || undefined,
    priceOnRequest: onRequest,
    price: onRequest ? undefined : price,
    isActive: document.getElementById('obra-active').checked,
  };
  if (!editId) {
    dto.slug = (slugify(name) || 'obra') + '-' + Date.now().toString(36);
    // Campos de store que la galería no usa — valores neutros al crear.
    dto.stock = 0;
    dto.taxable = false;
  }

  const btn = document.getElementById('modal-obra-save');
  btn.disabled = true;
  try {
    if (editId) {
      await updateObraRequest(editId, dto);
      showToast('Obra actualizada');
      closeObraModal();
    } else {
      const created = await createProduct(currentGallerySuit.id, dto);
      showToast('Obra creada — ahora subí la foto');
      document.getElementById('modal-obra-title').textContent = 'Editar obra';
      document.getElementById('modal-obra').dataset.editId = created.id;
      lastObras.unshift(created);
      await refreshObraImagesSection(created.id);
    }
    await fetchObras();
    refreshGalleryHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la obra', 'err');
  } finally {
    btn.disabled = false;
  }
}

// updateProduct no permite mandar categoryId undefined para "desvincular"
// (usa null). Normalizamos acá.
async function updateObraRequest(obraId, dto) {
  const payload = { ...dto };
  if (payload.categoryId === undefined) payload.categoryId = null;
  return updateProduct(currentGallerySuit.id, obraId, payload);
}

async function deleteObra(obraId) {
  const obra = lastObras.find(o => o.id === obraId);
  openConfirmModal({
    message: `¿Eliminar la obra “${obra ? obra.name : ''}”? No se puede deshacer.`,
    onConfirm: async () => {
      try {
        await deleteProduct(currentGallerySuit.id, obraId);
        showToast('Obra eliminada');
        await fetchObras();
        refreshGalleryHome();
      } catch (err) {
        showToast(err.message || 'No se pudo eliminar', 'err');
      }
    },
  });
}

// ── Colecciones (alias de categorías) ────────────────────────────────────

async function enterColecciones() {
  showGalleryView('colecciones');
  gateCreateButton('btn-add-coleccion', 'products');
  await fetchColecciones();
}

async function fetchColecciones() {
  const wrap = document.getElementById('ga-colecciones-wrap');
  if (!currentGallerySuit) return;
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    galleryCategories = await listCategories(currentGallerySuit.id);
    renderColeccionesTable();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar las colecciones (${esc(err.message)}).</p>`;
  }
}

function renderColeccionesTable() {
  const wrap = document.getElementById('ga-colecciones-wrap');
  if (!galleryCategories.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin colecciones. Son opcionales: agrupan las obras en el sitio.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Nombre</th><th></th></tr></thead>
      <tbody>${galleryCategories.map(c => `
        <tr>
          <td>${esc(c.name)}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-edit-coleccion="${c.id}" title="Renombrar">✎</span>
            <span class="crm-action-btn btn-del" data-del-coleccion="${c.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'products');
}

function openColeccionModal(colId) {
  const col = colId ? galleryCategories.find(c => c.id === colId) : null;
  document.getElementById('modal-coleccion-title').textContent = col ? 'Renombrar colección' : 'Nueva colección';
  document.getElementById('modal-coleccion').dataset.editId = colId || '';
  document.getElementById('coleccion-name').value = col?.name || '';
  document.getElementById('modal-coleccion').classList.add('open');
}

function closeColeccionModal() {
  document.getElementById('modal-coleccion').classList.remove('open');
}

async function saveColeccion() {
  const editId = document.getElementById('modal-coleccion').dataset.editId;
  const name = document.getElementById('coleccion-name').value.trim();
  if (name.length < 2) { showToast('El nombre debe tener al menos 2 caracteres', 'err'); return; }
  const slug = (slugify(name) || 'coleccion').slice(0, 50);

  try {
    if (editId) {
      await updateCategory(currentGallerySuit.id, editId, { name, slug });
      showToast('Colección actualizada');
    } else {
      await createCategory(currentGallerySuit.id, { name, slug });
      showToast('Colección creada');
    }
    closeColeccionModal();
    await fetchColecciones();
    refreshGalleryHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la colección', 'err');
  }
}

async function deleteColeccion(colId) {
  const col = galleryCategories.find(c => c.id === colId);
  openConfirmModal({
    message: `¿Eliminar la colección “${col ? col.name : ''}”? Las obras quedan sin colección, no se borran.`,
    onConfirm: async () => {
      try {
        await deleteCategory(currentGallerySuit.id, colId);
        showToast('Colección eliminada');
        await fetchColecciones();
        refreshGalleryHome();
      } catch (err) {
        showToast(err.message || 'No se pudo eliminar', 'err');
      }
    },
  });
}

// ── Eventos ──────────────────────────────────────────────────────────────

function initGalleryEvents() {
  const panel = document.getElementById('panel-gallery');
  if (!panel) return;

  document.getElementById('ga-enter-obras')?.addEventListener('click', enterObras);
  document.getElementById('ga-enter-colecciones')?.addEventListener('click', enterColecciones);
  document.getElementById('ga-obras-back')?.addEventListener('click', () => showGalleryView('home'));
  document.getElementById('ga-colecciones-back')?.addEventListener('click', () => showGalleryView('home'));

  document.getElementById('ga-search')?.addEventListener('input', () => {
    clearTimeout(gaSearchTimer);
    gaSearchTimer = setTimeout(fetchObras, 300);
  });

  document.getElementById('btn-add-obra')?.addEventListener('click', () => openObraModal(null));
  document.getElementById('ga-obras-grid')?.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-obra]');
    const del  = e.target.closest('[data-del-obra]');
    const card = e.target.closest('.ga-obra-card');
    if (edit) return openObraModal(edit.dataset.editObra);
    if (del)  return deleteObra(del.dataset.delObra);
    if (card) return openObraModal(card.dataset.obraId);
  });

  // Modal obra
  document.getElementById('modal-obra-close')?.addEventListener('click', closeObraModal);
  document.getElementById('modal-obra-cancel')?.addEventListener('click', closeObraModal);
  document.getElementById('modal-obra-save')?.addEventListener('click', saveObra);
  document.getElementById('obra-price-on-request')?.addEventListener('change', syncObraPriceInput);
  document.getElementById('obra-image-upload-btn')?.addEventListener('click', () => document.getElementById('obra-image-file').click());
  document.getElementById('obra-image-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadCurrentObraImage(file);
    e.target.value = '';
  });
  document.getElementById('obra-images-grid')?.addEventListener('click', async (e) => {
    const obraId = document.getElementById('modal-obra').dataset.editId;
    if (!obraId) return;
    const setPrimary = e.target.closest('[data-set-primary-obra-image]');
    const del = e.target.closest('[data-del-obra-image]');
    try {
      if (setPrimary) {
        await setPrimaryProductImage(currentGallerySuit.id, obraId, setPrimary.dataset.setPrimaryObraImage);
        await refreshObraImagesSection(obraId);
        await fetchObras();
      } else if (del) {
        await deleteProductImage(currentGallerySuit.id, obraId, del.dataset.delObraImage);
        await refreshObraImagesSection(obraId);
        await fetchObras();
      }
    } catch (err) {
      showToast(err.message || 'No se pudo actualizar la imagen', 'err');
    }
  });

  // Colecciones
  document.getElementById('btn-add-coleccion')?.addEventListener('click', () => openColeccionModal(null));
  document.getElementById('ga-colecciones-wrap')?.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-coleccion]');
    const del  = e.target.closest('[data-del-coleccion]');
    if (edit) return openColeccionModal(edit.dataset.editColeccion);
    if (del)  return deleteColeccion(del.dataset.delColeccion);
  });
  document.getElementById('modal-coleccion-close')?.addEventListener('click', closeColeccionModal);
  document.getElementById('modal-coleccion-cancel')?.addEventListener('click', closeColeccionModal);
  document.getElementById('modal-coleccion-save')?.addEventListener('click', saveColeccion);
}
