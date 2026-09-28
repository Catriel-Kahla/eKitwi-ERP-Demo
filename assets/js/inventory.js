/**
 * inventory.js
 * Inventory panel: dólar quote, then three sub-views reached from a home
 * screen (Productos, Categorías, Precios) instead of one big table. Entry
 * point is loadInventoryPanel(suitId, suitName), called from dashboard.js
 * when a suit's "Inventory" sidebar button is clicked.
 */

'use strict';

let currentInventorySuit = null;
let invSearchTimer  = null;
let catSearchTimer  = null;
let supSearchTimer  = null;
let branchSearchTimer = null;
let productsPage    = 1;
let allCategories   = [];

// Cuál de los 3 KPI clickeables ("Productos" / "Stock bajo" / "Sin stock")
// está activo — decide qué tabla se muestra abajo en la vista Productos.
let productsFilter  = 'all'; // 'all' | 'low' | 'out'

// Selección para "Cambio Porcentual ($)" — Map<productId, product> para
// evitar duplicados sea cual sea el origen (categoría o búsqueda).
let pctSelected        = new Map();
let pctSearchTimer     = null;
let lastPctSearchResults = [];

// ── Cotización del dólar ─────────────────────────────────────────────────

async function refreshDolarPrice() {
  const input = document.getElementById('dolar-price-input');
  const updatedEl = document.getElementById('dolar-price-updated');
  if (!currentInventorySuit) return;

  // PUT /dolar-price → acción 'write' (default por verbo HTTP, ver
  // SuitPermissionGuard).
  const canWrite = ekCan('cash_management', 'write');
  document.getElementById('dolar-price-save').hidden = !canWrite;
  input.disabled = !canWrite;
  input.value = '';
  updatedEl.textContent = 'Cargando…';

  try {
    const entry = await getDolarPrice(currentInventorySuit.id);
    input.value = entry ? entry.dolarPrice : '';
    updatedEl.textContent = entry
      ? `Actualizado: ${new Date(entry.updatedAt).toLocaleString('es-AR')}`
      : 'Sin cotización cargada todavía';
  } catch (err) {
    updatedEl.textContent = '';
    showToast(err.message || 'No se pudo cargar la cotización', 'err');
  }
}

async function saveDolarPrice() {
  if (!currentInventorySuit) return;
  const value = parseFloat(document.getElementById('dolar-price-input').value);
  if (isNaN(value) || value <= 0) { showToast('Ingresá un valor de cotización válido', 'err'); return; }

  try {
    await setDolarPrice(currentInventorySuit.id, value);
    showToast('Cotización actualizada');
    refreshDolarPrice();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la cotización', 'err');
  }
}

// ── Home ─────────────────────────────────────────────────────────────────

// `feature` viene del botón del aside (ver FEATURE_META / FEATURE_ENTRY):
// arrancamos ya en la sub-vista destino en vez de mostrar 'home' y saltar
// después de los fetch — ese salto era el "flash" de las 4 tarjetas.
async function loadInventoryPanel(suitId, suitName, feature) {
  currentInventorySuit = { id: suitId, name: suitName };
  document.getElementById('inventory-suit-label').textContent = `Stock de ${suitName}`;
  const INITIAL_VIEW = { products: 'products', suppliers: 'suppliers', branches: 'branches', purchase_orders: 'purchaseorders' };
  showInventoryView(INITIAL_VIEW[feature] || 'home');
  await Promise.all([refreshInventoryHome(), refreshDolarPrice()]);
}

function showInventoryView(view) {
  document.getElementById('inventory-home').hidden               = view !== 'home';
  document.getElementById('inventory-products-view').hidden      = view !== 'products';
  document.getElementById('inventory-categories-view').hidden    = view !== 'categories';
  document.getElementById('inventory-suppliers-view').hidden     = view !== 'suppliers';
  document.getElementById('inventory-branches-view').hidden      = view !== 'branches';
  document.getElementById('inventory-purchaseorders-view').hidden = view !== 'purchaseorders';
}

async function refreshInventoryHome() {
  if (!currentInventorySuit) return;

  try {
    const [productsRes, categories, suppliers, branches, purchaseOrders] = await Promise.all([
      listProducts(currentInventorySuit.id, { take: 100 }),
      listCategories(currentInventorySuit.id),
      listSuppliers(currentInventorySuit.id),
      listBranches(currentInventorySuit.id),
      listPurchaseOrders(currentInventorySuit.id)
    ]);

    document.getElementById('inv-products-count').textContent   = `${productsRes.pagination.total} producto${productsRes.pagination.total === 1 ? '' : 's'}`;
    document.getElementById('inv-categories-count').textContent = `${categories.length} categoría${categories.length === 1 ? '' : 's'}`;
    document.getElementById('inv-suppliers-count').textContent  = `${suppliers.length} proveedor${suppliers.length === 1 ? '' : 'es'}`;
    document.getElementById('inv-branches-count').textContent   = `${branches.length} sucursal${branches.length === 1 ? '' : 'es'}`;
    const pendingPOs = purchaseOrders.filter(po => po.status !== 'cancelled').length;
    document.getElementById('inv-purchaseorders-count').textContent = `${pendingPOs} pedido${pendingPOs === 1 ? '' : 's'}`;

  } catch (err) {
    showToast(`No se pudo cargar el resumen (${err.message})`, 'err');
  }
}

// ── Products ─────────────────────────────────────────────────────────────

async function enterProducts() {
  productsFilter = 'all';
  document.querySelectorAll('.sec-quick-filter[data-products-filter]').forEach(c =>
    c.classList.toggle('active', c.dataset.productsFilter === productsFilter));
  showInventoryView('products');
  gateCreateButton('btn-add-product', 'products');
  // Cambio de precio masivo — PATCH .../bulk-price-change, 'write' (mismo
  // criterio que el default por verbo HTTP de SuitPermissionGuard).
  const pctBtn = document.getElementById('btn-percent-change');
  if (pctBtn) pctBtn.hidden = !ekCan('products', 'write');
  await fetchProducts(1);
}

// La tabla de abajo muestra según el KPI clickeado:
//   'all' → página paginada de todos los productos (con búsqueda por nombre)
//   'low' → sólo los de stock bajo (stock > 0 y <= mínimo)
//   'out' → sólo los sin stock (stock <= 0)
// Para 'low'/'out' se reusa el endpoint minStockAlert (máx. 100) y se filtra
// por nombre en el cliente; no se pagina.
async function fetchProducts(page) {
  productsPage = page;
  const wrap = document.getElementById('inv-table-wrap');
  if (!currentInventorySuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  const search = document.getElementById('inv-search').value.trim();

  try {
    if (productsFilter === 'all') {
      const res = await listProducts(currentInventorySuit.id, { search, skip: (page - 1) * PRODUCTS_PER_PAGE, take: PRODUCTS_PER_PAGE });
      lastProductsPage = res.data;
      renderProductsTable(wrap, res.data);
      renderPagination(res.pagination.total, page);
    } else {
      const alertsRes = await listProducts(currentInventorySuit.id, { minStockAlert: true, take: 100 });
      const term = search.toLowerCase();
      const rows = alertsRes.data
        .filter(p => productsFilter === 'out' ? p.stock <= 0 : p.stock > 0)
        .filter(p => !term
          || p.name.toLowerCase().includes(term)
          || (p.sku || '').toLowerCase().includes(term)
          || (p.scanId || '').toLowerCase().includes(term));
      lastProductsPage = rows;
      renderProductsTable(wrap, rows);
      document.getElementById('inv-pagination').innerHTML = '';
    }
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los productos (${esc(err.message)}).</p>`;
  }
}

function renderProductsTable(wrap, products) {
  if (!products.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin productos para este filtro.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Stock</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
      <tbody>${products.map(productRow).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'products');
}

function productRow(p) {
  const stockClass = p.stock <= 0 ? 'zero' : (p.minStock != null && p.stock <= p.minStock) ? 'low' : 'ok';
  return `
    <tr>
      <td>${esc(p.name)}</td>
      <td class="crm-muted">${esc(p.sku || '—')}</td>
      <td class="crm-muted">${esc((p.category && p.category.name) || '—')}</td>
      <td><span class="sec-stock-badge ${stockClass}">${p.stock}</span></td>
      <td>${fmtMoney(Number(p.price))}</td>
      <td>${p.isActive ? '<span class="crm-badge badge-green">Activo</span>' : '<span class="crm-badge badge-gray">Inactivo</span>'}</td>
      <td class="td-actions">
        <span class="crm-action-btn" data-branch-stock-product="${p.id}" title="Stock por sucursal">📦</span>
        <span class="crm-action-btn" data-edit-product="${p.id}" title="Editar">✎</span>
        <span class="crm-action-btn btn-del" data-del-product="${p.id}" title="Eliminar">🗑</span>
      </td>
    </tr>`;
}

function renderPagination(total, page) {
  const el = document.getElementById('inv-pagination');
  const pages = Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE));

  if (pages <= 1) {
    el.innerHTML = total ? `<span class="page-info">${total} producto${total === 1 ? '' : 's'}</span>` : '';
    return;
  }

  let html = `<span class="page-info">${total} productos</span>`;
  html += `<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) {
      html += `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    } else if (Math.abs(p - page) === 2) {
      html += '<span class="page-ellipsis">…</span>';
    }
  }
  html += `<button class="page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;
}

// The row was already fetched into the current page — avoids a second
// round trip just to populate the edit form.
let lastProductsPage = [];
async function findProductInCurrentPage(id) {
  return lastProductsPage.find(p => p.id === id) || null;
}

async function openProductModal(productId) {
  if (!currentInventorySuit) return;

  try {
    allCategories = await listCategories(currentInventorySuit.id);
  } catch {
    allCategories = [];
  }
  const catSelect = document.getElementById('prod-category');
  catSelect.innerHTML = '<option value="">Sin categoría</option>' +
    allCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  let allSuppliersForModal = [];
  try {
    allSuppliersForModal = await listSuppliers(currentInventorySuit.id);
  } catch {
    allSuppliersForModal = [];
  }
  const supSelect = document.getElementById('prod-supplier');
  supSelect.innerHTML = '<option value="">Sin proveedor</option>' +
    allSuppliersForModal.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  const product = productId ? await findProductInCurrentPage(productId) : null;

  document.getElementById('modal-product-title').textContent = product ? 'Editar producto' : 'Nuevo producto';
  document.getElementById('modal-product').dataset.editId = productId || '';

  document.getElementById('prod-name').value       = product?.name || '';
  document.getElementById('prod-sku').value         = product?.sku || '';
  document.getElementById('prod-scanid').value      = product?.scanId || '';
  document.getElementById('prod-desc').value        = product?.description || '';
  document.getElementById('prod-price').value       = product?.price ?? '';
  document.getElementById('prod-cost').value        = product?.cost ?? '';
  document.getElementById('prod-category').value    = product?.categoryId || product?.category?.id || '';
  document.getElementById('prod-supplier').value    = product?.supplierId || product?.supplier?.id || '';
  document.getElementById('prod-stock').value       = product?.stock ?? 0;
  document.getElementById('prod-min-stock').value   = product?.minStock ?? '';
  document.getElementById('prod-max-stock').value   = product?.maxStock ?? '';
  document.getElementById('prod-taxable').checked   = product?.taxable ?? true;
  document.getElementById('prod-active').checked    = product?.isActive ?? true;

  await refreshProductImagesSection(productId);
  await refreshProductPricesSection(productId);

  document.getElementById('modal-product').classList.add('open');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.remove('open');
}

// Los precios adicionales (StProductPrice) cuelgan de
// .../products/:productId/prices — igual que las imágenes, no hay productId
// para un producto nuevo, así que hasta el primer guardado sólo se muestra
// el aviso. Es el mismo dato que administra la vista Precios del aside.
let lastModalPrices = [];

async function refreshProductPricesSection(productId) {
  const hint   = document.getElementById('prod-prices-hint');
  const wrap   = document.getElementById('prod-prices-wrap');
  const addRow = document.getElementById('prod-price-add-row');

  document.getElementById('prod-price-new-name').value  = '';
  document.getElementById('prod-price-new-value').value = '';

  if (!productId || !currentInventorySuit) {
    hint.hidden = false;
    wrap.hidden = true;
    wrap.innerHTML = '';
    addRow.hidden = true;
    return;
  }

  hint.hidden = true;
  wrap.hidden = false;
  addRow.hidden = !ekCan('products', 'create');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';

  try {
    lastModalPrices = await listProductPrices(currentInventorySuit.id, productId);
    renderModalPricesTable(lastModalPrices);
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los precios (${esc(err.message)}).</p>`;
  }
}

function renderModalPricesTable(prices) {
  const wrap = document.getElementById('prod-prices-wrap');
  if (!prices.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no tiene precios adicionales.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="crm-table">
      <tbody>${prices.map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${fmtMoney(Number(p.price))}</td>
          <td class="td-actions"><span class="crm-action-btn btn-del" data-del-modal-price="${p.id}" title="Eliminar">🗑</span></td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'products');
}

async function addProductModalPrice() {
  const productId = document.getElementById('modal-product').dataset.editId;
  if (!productId || !currentInventorySuit) return;

  const name  = document.getElementById('prod-price-new-name').value.trim();
  const value = parseFloat(document.getElementById('prod-price-new-value').value);
  if (!name) { showToast('El nombre del precio es obligatorio', 'err'); return; }
  if (isNaN(value) || value <= 0) { showToast('Ingresá un precio válido', 'err'); return; }

  const btn = document.getElementById('prod-price-add-btn');
  btn.disabled = true;
  try {
    await createProductPrice(currentInventorySuit.id, productId, { name, price: value });
    showToast('Precio adicional agregado');
    await refreshProductPricesSection(productId);
  } catch (err) {
    showToast(err.message || 'No se pudo agregar el precio', 'err');
  } finally {
    btn.disabled = false;
  }
}

// Las imágenes cuelgan de POST .../products/:productId/images — no existe
// productId todavía para un producto nuevo, así que hasta que no se guarde
// una primera vez solo se muestra el aviso, sin subida ni galería.
async function refreshProductImagesSection(productId) {
  const hint = document.getElementById('prod-images-hint');
  const grid = document.getElementById('prod-images-grid');
  const uploadRow = document.getElementById('prod-images-upload-row');

  if (!productId) {
    hint.hidden = false;
    hint.textContent = 'Guardá el producto para poder agregarle fotos.';
    grid.hidden = true;
    grid.innerHTML = '';
    uploadRow.hidden = true;
    return;
  }

  uploadRow.hidden = !ekCan('products', 'create');

  try {
    const images = await listProductImages(currentInventorySuit.id, productId);
    renderProductImages(images);
  } catch (err) {
    grid.hidden = true;
    hint.hidden = false;
    hint.textContent = `No se pudieron cargar las imágenes (${esc(err.message)}).`;
  }
}

function renderProductImages(images) {
  const hint = document.getElementById('prod-images-hint');
  const grid = document.getElementById('prod-images-grid');

  if (!images.length) {
    hint.hidden = false;
    hint.textContent = 'Todavía no tiene fotos.';
    grid.hidden = true;
    grid.innerHTML = '';
    return;
  }

  hint.hidden = true;
  grid.hidden = false;
  grid.innerHTML = images.map(img => `
    <div class="prod-image-thumb${img.isPrimary ? ' is-primary' : ''}">
      <img src="${esc(img.url)}" alt="" />
      ${img.isPrimary ? '<span class="prod-image-primary-badge">Principal</span>' : ''}
      <div class="prod-image-actions">
        ${img.isPrimary ? '' : `<span class="crm-action-btn" data-set-primary-image="${img.id}" title="Marcar como principal">★</span>`}
        <span class="crm-action-btn btn-del" data-del-image="${img.id}" title="Eliminar">🗑</span>
      </div>
    </div>
  `).join('');
  gateRowActions(grid, 'products');
}

async function uploadCurrentProductImage(file) {
  const productId = document.getElementById('modal-product').dataset.editId;
  if (!productId || !currentInventorySuit) return;

  const edited = await openImageEditor(file);
  if (!edited) return; // canceló el editor

  const btn = document.getElementById('prod-image-upload-btn');
  btn.disabled = true;
  try {
    await uploadProductImage(currentInventorySuit.id, productId, edited);
    await refreshProductImagesSection(productId);
  } catch (err) {
    showToast(err.message || 'No se pudo subir la imagen', 'err');
  } finally {
    btn.disabled = false;
  }
}

async function saveProduct() {
  const editId = document.getElementById('modal-product').dataset.editId;
  const name = document.getElementById('prod-name').value.trim();
  const price = parseFloat(document.getElementById('prod-price').value);

  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }
  if (!editId && (isNaN(price) || price <= 0)) { showToast('El precio es obligatorio', 'err'); return; }

  const dto = {
    name,
    price: isNaN(price) ? undefined : price,
    sku: document.getElementById('prod-sku').value.trim() || undefined,
    scanId: document.getElementById('prod-scanid').value.trim() || undefined,
    description: document.getElementById('prod-desc').value.trim() || (editId ? undefined : 'Sin descripción'),
    cost: document.getElementById('prod-cost').value ? parseFloat(document.getElementById('prod-cost').value) : undefined,
    categoryId: document.getElementById('prod-category').value || undefined,
    supplierId: document.getElementById('prod-supplier').value || undefined,
    stock: document.getElementById('prod-stock').value ? parseInt(document.getElementById('prod-stock').value, 10) : 0,
    minStock: document.getElementById('prod-min-stock').value ? parseInt(document.getElementById('prod-min-stock').value, 10) : undefined,
    maxStock: document.getElementById('prod-max-stock').value ? parseInt(document.getElementById('prod-max-stock').value, 10) : undefined,
    taxable: document.getElementById('prod-taxable').checked,
    isActive: document.getElementById('prod-active').checked
  };
  if (!editId) dto.slug = slugify(name) + '-' + Date.now().toString(36);

  try {
    if (editId) {
      await updateProduct(currentInventorySuit.id, editId, dto);
      showToast('Producto actualizado');
      closeProductModal();
    } else {
      const created = await createProduct(currentInventorySuit.id, dto);
      showToast('Producto creado — ahora podés agregarle fotos');
      // Se queda abierto en modo edición en vez de cerrar: recién ahora el
      // producto tiene id, y las imágenes cuelgan de
      // .../products/:productId/images.
      document.getElementById('modal-product-title').textContent = 'Editar producto';
      document.getElementById('modal-product').dataset.editId = created.id;
      await refreshProductImagesSection(created.id);
      await refreshProductPricesSection(created.id);
    }
    fetchProducts(editId ? productsPage : 1);
    refreshInventoryHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el producto', 'err');
  }
}

// ── Cambio Porcentual ($) ───────────────────────────────────────────────
// Aumentar/disminuir el precio de varios productos a la vez, elegidos por
// categoría y/o buscados uno por uno, con preview antes de aplicar.

async function openPercentChangeModal() {
  if (!currentInventorySuit) return;

  pctSelected = new Map();
  document.getElementById('pct-percent-input').value = '';
  document.getElementById('pct-product-search').value = '';
  document.getElementById('pct-product-results').hidden = true;
  document.getElementById('pct-product-results').innerHTML = '';
  renderPctSelectionList();
  showPctStep('select');

  const select = document.getElementById('pct-category-select');
  select.innerHTML = '<option value="">Cargando…</option>';
  try {
    const categories = await listCategories(currentInventorySuit.id);
    select.innerHTML = '<option value="">Elegí una categoría…</option>' +
      categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">No se pudieron cargar las categorías</option>';
    showToast(err.message || 'No se pudieron cargar las categorías', 'err');
  }

  document.getElementById('modal-percent-change').classList.add('open');
}

function closePercentChangeModal() {
  document.getElementById('modal-percent-change').classList.remove('open');
}

function showPctStep(step) {
  document.getElementById('pct-step-select').hidden   = step !== 'select';
  document.getElementById('pct-step-preview').hidden  = step !== 'preview';
  document.getElementById('pct-footer-select').hidden  = step !== 'select';
  document.getElementById('pct-footer-preview').hidden = step !== 'preview';
}

function renderPctSelectionList() {
  const wrap  = document.getElementById('pct-selection-wrap');
  const count = document.getElementById('pct-selection-count');
  const items = [...pctSelected.values()];

  count.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} seleccionado${items.length === 1 ? '' : 's'}`;

  if (!items.length) {
    wrap.innerHTML = '<p class="crm-muted">Todavía no seleccionaste productos.</p>';
  } else {
    wrap.innerHTML = `
      <table class="crm-table">
        <thead><tr><th>Producto</th><th>Precio actual</th><th></th></tr></thead>
        <tbody>${items.map(p => `
          <tr>
            <td>${esc(p.name)}</td>
            <td class="crm-muted">${fmtMoney(Number(p.price))}</td>
            <td class="td-actions"><span class="crm-action-btn btn-del" data-remove-pct-product="${p.id}" title="Quitar">✕</span></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }
  document.getElementById('pct-preview-btn').disabled = !items.length;
}

// La API pagina de a 100 como máximo (QueryProductDto.take), así que una
// categoría con más productos que eso necesita más de una vuelta.
async function addProductsFromCategory(categoryId) {
  if (!categoryId || !currentInventorySuit) return;
  const btn = document.getElementById('pct-add-category-btn');
  btn.disabled = true;

  try {
    let skip = 0;
    let total = Infinity;
    let added = 0;
    while (skip < total) {
      const res = await listProducts(currentInventorySuit.id, { categoryId, skip, take: 100 });
      total = res.pagination.total;
      res.data.forEach(p => {
        if (!pctSelected.has(p.id)) { pctSelected.set(p.id, p); added++; }
      });
      if (!res.data.length) break;
      skip += 100;
    }
    renderPctSelectionList();
    showToast(added ? `${added} producto${added === 1 ? '' : 's'} agregado${added === 1 ? '' : 's'}` : 'Esos productos ya estaban seleccionados');
  } catch (err) {
    showToast(err.message || 'No se pudieron agregar los productos de la categoría', 'err');
  } finally {
    btn.disabled = false;
  }
}

async function searchPctProducts(term) {
  const results = document.getElementById('pct-product-results');
  if (!term.trim() || !currentInventorySuit) {
    results.hidden = true;
    results.innerHTML = '';
    return;
  }

  results.hidden = false;
  results.innerHTML = '<div class="search-picker-empty">Buscando…</div>';

  try {
    const res = await listProducts(currentInventorySuit.id, { search: term.trim(), take: 10 });
    lastPctSearchResults = res.data;
    if (!res.data.length) {
      results.innerHTML = '<div class="search-picker-empty">Sin productos que coincidan.</div>';
      return;
    }
    results.innerHTML = res.data.map(p => `
      <div class="search-picker-item" data-pick-pct-product="${p.id}">
        <span>${esc(p.name)}</span>
        <span class="crm-muted">${fmtMoney(Number(p.price))}</span>
      </div>`).join('');
  } catch (err) {
    results.innerHTML = `<div class="search-picker-empty">${esc(err.message || 'No se pudo buscar')}</div>`;
  }
}

function addPctProduct(productId) {
  const product = lastPctSearchResults.find(p => p.id === productId);
  if (!product) return;

  pctSelected.set(product.id, product);
  renderPctSelectionList();

  document.getElementById('pct-product-search').value = '';
  document.getElementById('pct-product-results').hidden = true;
  document.getElementById('pct-product-results').innerHTML = '';
}

function renderPctPreview(percent) {
  const wrap  = document.getElementById('pct-preview-wrap');
  const items = [...pctSelected.values()];

  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Producto</th><th>Precio actual</th><th>Precio nuevo</th></tr></thead>
      <tbody>${items.map(p => {
        const current = Number(p.price);
        const next    = Math.max(0, Math.round(current * (1 + percent / 100) * 100) / 100);
        const cls     = next > current ? 'pos' : next < current ? 'neg' : '';
        return `
          <tr>
            <td>${esc(p.name)}</td>
            <td class="crm-muted">${fmtMoney(current)}</td>
            <td class="${cls}">${fmtMoney(next)}</td>
          </tr>`;
      }).join('')}</tbody>
    </table>`;
}

function goToPctPreview() {
  const percent = parseFloat(document.getElementById('pct-percent-input').value);
  if (isNaN(percent) || percent === 0) { showToast('Ingresá un porcentaje distinto de cero', 'err'); return; }
  if (percent < -100) { showToast('El porcentaje no puede ser menor a -100%', 'err'); return; }
  if (!pctSelected.size) { showToast('Seleccioná al menos un producto', 'err'); return; }

  renderPctPreview(percent);
  showPctStep('preview');
}

async function applyPercentChange() {
  const percent = parseFloat(document.getElementById('pct-percent-input').value);
  const ids = [...pctSelected.keys()];
  const btn = document.getElementById('pct-apply-btn');
  btn.disabled = true;

  try {
    await bulkPriceChangeProducts(currentInventorySuit.id, ids, percent);
    showToast('Precios actualizados');
    closePercentChangeModal();
    fetchProducts(productsPage);
    refreshInventoryHome();
  } catch (err) {
    showToast(err.message || 'No se pudieron actualizar los precios', 'err');
  } finally {
    btn.disabled = false;
  }
}

// ── Categories ───────────────────────────────────────────────────────────

async function enterCategories() {
  showInventoryView('categories');
  gateCreateButton('btn-add-cat', 'products');
  await fetchCategories();
}

let allCategoriesFull = [];
async function fetchCategories() {
  const wrap = document.getElementById('cat-table-wrap');
  if (!currentInventorySuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    allCategoriesFull = await listCategories(currentInventorySuit.id);
    renderCategoriesTable();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar las categorías (${esc(err.message)}).</p>`;
  }
}

function renderCategoriesTable() {
  const wrap = document.getElementById('cat-table-wrap');
  const search = document.getElementById('cat-search').value.trim().toLowerCase();
  const rows = allCategoriesFull.filter(c => !search || c.name.toLowerCase().includes(search));

  if (!rows.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin categorías para este filtro.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Nombre</th><th>Slug</th><th>Productos</th><th>Descuento</th><th>Carrusel</th><th></th></tr></thead>
      <tbody>${rows.map(c => `
        <tr>
          <td>${esc(c.name)}</td>
          <td class="crm-muted">${esc(c.slug)}</td>
          <td class="crm-muted">${c._count?.products ?? 0}</td>
          <td class="crm-muted">${c.discountPercent != null ? Number(c.discountPercent) + '%' : '—'}</td>
          <td>${c.isFeaturedInCarousel ? '<span class="crm-badge badge-green">Destacada</span>' : '<span class="crm-muted">—</span>'}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-edit-cat="${c.id}" title="Editar">✎</span>
            <span class="crm-action-btn btn-del" data-del-cat="${c.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'products');
}

function openCategoryModal(categoryId) {
  const category = categoryId ? allCategoriesFull.find(c => c.id === categoryId) : null;
  document.getElementById('modal-cat-title').textContent = category ? 'Editar categoría' : 'Nueva categoría';
  document.getElementById('modal-cat').dataset.editId = categoryId || '';
  document.getElementById('cat-name').value = category?.name || '';
  document.getElementById('cat-slug').value = category?.slug || '';
  document.getElementById('cat-discount').value = category?.discountPercent ?? '';
  document.getElementById('cat-featured').checked = category?.isFeaturedInCarousel ?? false;
  document.getElementById('cat-order').value = category?.carouselOrder ?? '';
  document.getElementById('cat-order-field').hidden = !category?.isFeaturedInCarousel;
  document.getElementById('modal-cat').classList.add('open');
}

function closeCategoryModal() {
  document.getElementById('modal-cat').classList.remove('open');
}

async function saveCategory() {
  const editId = document.getElementById('modal-cat').dataset.editId;
  const name = document.getElementById('cat-name').value.trim();
  const slug = document.getElementById('cat-slug').value.trim() || slugify(name);

  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }

  const discountRaw = document.getElementById('cat-discount').value;
  const discountPercent = discountRaw !== '' ? parseFloat(discountRaw) : undefined;
  if (discountPercent !== undefined && (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100)) {
    showToast('El descuento debe ser un número entre 0 y 100', 'err');
    return;
  }

  const isFeaturedInCarousel = document.getElementById('cat-featured').checked;
  const carouselOrder = isFeaturedInCarousel
    ? (parseInt(document.getElementById('cat-order').value, 10) || 0)
    : undefined;

  const dto = { name, slug, discountPercent, isFeaturedInCarousel, carouselOrder };

  try {
    if (editId) {
      await updateCategory(currentInventorySuit.id, editId, dto);
      showToast('Categoría actualizada');
    } else {
      await createCategory(currentInventorySuit.id, dto);
      showToast('Categoría creada');
    }
    closeCategoryModal();
    fetchCategories();
    refreshInventoryHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la categoría', 'err');
  }
}

// ── Suppliers ────────────────────────────────────────────────────────────

async function enterSuppliers() {
  showInventoryView('suppliers');
  gateCreateButton('btn-add-sup', 'suppliers');
  await fetchSuppliers();
}

let allSuppliersFull = [];
async function fetchSuppliers() {
  const wrap = document.getElementById('sup-table-wrap');
  if (!currentInventorySuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    allSuppliersFull = await listSuppliers(currentInventorySuit.id);
    renderSuppliersTable();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar los proveedores (${esc(err.message)}).</p>`;
  }
}

function renderSuppliersTable() {
  const wrap = document.getElementById('sup-table-wrap');
  const search = document.getElementById('sup-search').value.trim().toLowerCase();
  const rows = allSuppliersFull.filter(s => !search || s.name.toLowerCase().includes(search));

  if (!rows.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin proveedores para este filtro.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Nombre</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>Productos</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows.map(s => `
        <tr>
          <td>${esc(s.name)}</td>
          <td class="crm-muted">${esc(s.contactName || '—')}</td>
          <td class="crm-muted">${esc(s.phone || '—')}</td>
          <td class="crm-muted">${esc(s.email || '—')}</td>
          <td class="crm-muted">${s._count?.products ?? 0}</td>
          <td>${s.isActive ? '<span class="crm-badge badge-green">Activo</span>' : '<span class="crm-badge badge-gray">Inactivo</span>'}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-edit-sup="${s.id}" title="Editar">✎</span>
            <span class="crm-action-btn btn-del" data-del-sup="${s.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'suppliers');
}

function openSupplierModal(supplierId) {
  const supplier = supplierId ? allSuppliersFull.find(s => s.id === supplierId) : null;
  document.getElementById('modal-sup-title').textContent = supplier ? 'Editar proveedor' : 'Nuevo proveedor';
  document.getElementById('modal-sup').dataset.editId = supplierId || '';
  document.getElementById('sup-name').value    = supplier?.name || '';
  document.getElementById('sup-contact').value = supplier?.contactName || '';
  document.getElementById('sup-taxid').value   = supplier?.taxId || '';
  document.getElementById('sup-phone').value   = supplier?.phone || '';
  document.getElementById('sup-email').value   = supplier?.email || '';
  document.getElementById('sup-address').value = supplier?.address || '';
  document.getElementById('sup-notes').value   = supplier?.notes || '';
  document.getElementById('sup-active').checked = supplier?.isActive ?? true;
  document.getElementById('modal-sup').classList.add('open');
}

function closeSupplierModal() {
  document.getElementById('modal-sup').classList.remove('open');
}

async function saveSupplier() {
  const editId = document.getElementById('modal-sup').dataset.editId;
  const name = document.getElementById('sup-name').value.trim();

  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }

  const dto = {
    name,
    contactName: document.getElementById('sup-contact').value.trim() || undefined,
    taxId: document.getElementById('sup-taxid').value.trim() || undefined,
    phone: document.getElementById('sup-phone').value.trim() || undefined,
    email: document.getElementById('sup-email').value.trim() || undefined,
    address: document.getElementById('sup-address').value.trim() || undefined,
    notes: document.getElementById('sup-notes').value.trim() || undefined,
    isActive: document.getElementById('sup-active').checked
  };

  try {
    if (editId) {
      await updateSupplier(currentInventorySuit.id, editId, dto);
      showToast('Proveedor actualizado');
    } else {
      await createSupplier(currentInventorySuit.id, dto);
      showToast('Proveedor creado');
    }
    closeSupplierModal();
    fetchSuppliers();
    refreshInventoryHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el proveedor', 'err');
  }
}

// ── Branches ─────────────────────────────────────────────────────────────

async function enterBranches() {
  showInventoryView('branches');
  gateCreateButton('btn-add-branch', 'branches');
  await fetchBranches();
}

let allBranchesFull = [];
async function fetchBranches() {
  const wrap = document.getElementById('branch-table-wrap');
  if (!currentInventorySuit) return;

  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  try {
    allBranchesFull = await listBranches(currentInventorySuit.id);
    renderBranchesTable();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudieron cargar las sucursales (${esc(err.message)}).</p>`;
  }
}

function renderBranchesTable() {
  const wrap = document.getElementById('branch-table-wrap');
  const search = document.getElementById('branch-search').value.trim().toLowerCase();
  const rows = allBranchesFull.filter(b => !search || b.name.toLowerCase().includes(search));

  if (!rows.length) {
    wrap.innerHTML = '<p class="crm-muted">Sin sucursales para este filtro.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Nombre</th><th>Encargado</th><th>Teléfono</th><th>Dirección</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows.map(b => `
        <tr>
          <td>${esc(b.name)}</td>
          <td class="crm-muted">${esc(b.managerName || '—')}</td>
          <td class="crm-muted">${esc(b.phone || '—')}</td>
          <td class="crm-muted">${esc(b.address || '—')}</td>
          <td>${b.isActive ? '<span class="crm-badge badge-green">Activa</span>' : '<span class="crm-badge badge-gray">Inactiva</span>'}</td>
          <td class="td-actions">
            <span class="crm-action-btn" data-edit-branch="${b.id}" title="Editar">✎</span>
            <span class="crm-action-btn btn-del" data-del-branch="${b.id}" title="Eliminar">🗑</span>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  gateRowActions(wrap, 'branches');
}

function openBranchModal(branchId) {
  const branch = branchId ? allBranchesFull.find(b => b.id === branchId) : null;
  document.getElementById('modal-branch-title').textContent = branch ? 'Editar sucursal' : 'Nueva sucursal';
  document.getElementById('modal-branch').dataset.editId = branchId || '';
  document.getElementById('branch-name').value    = branch?.name || '';
  document.getElementById('branch-manager').value = branch?.managerName || '';
  document.getElementById('branch-phone').value   = branch?.phone || '';
  document.getElementById('branch-address').value = branch?.address || '';
  document.getElementById('branch-active').checked = branch?.isActive ?? true;
  document.getElementById('modal-branch').classList.add('open');
}

function closeBranchModal() {
  document.getElementById('modal-branch').classList.remove('open');
}

async function saveBranch() {
  const editId = document.getElementById('modal-branch').dataset.editId;
  const name = document.getElementById('branch-name').value.trim();

  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }

  const dto = {
    name,
    managerName: document.getElementById('branch-manager').value.trim() || undefined,
    phone: document.getElementById('branch-phone').value.trim() || undefined,
    address: document.getElementById('branch-address').value.trim() || undefined,
    isActive: document.getElementById('branch-active').checked
  };

  try {
    if (editId) {
      await updateBranch(currentInventorySuit.id, editId, dto);
      showToast('Sucursal actualizada');
    } else {
      await createBranch(currentInventorySuit.id, dto);
      showToast('Sucursal creada');
    }
    closeBranchModal();
    fetchBranches();
    refreshInventoryHome();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la sucursal', 'err');
  }
}

// ── Stock por sucursal (por producto) ──────────────────────────────────
// Modal accedido desde la fila de un producto en la vista Productos —
// muestra todas las sucursales activas del suit con el stock de ese
// producto en cada una, editable de a una. No reemplaza el stock "sin
// sucursal" del producto (prod-stock), es un desglose adicional.

let branchStockProduct = null;
let lastBranchStockRows = [];

async function openBranchStockModal(productId) {
  if (!currentInventorySuit) return;
  const product = await findProductInCurrentPage(productId);
  if (!product) return;

  branchStockProduct = product;
  document.getElementById('branch-stock-product-name').textContent = product.name;
  document.getElementById('branch-stock-pool').textContent = `${product.stock} sin sucursal`;

  const wrap = document.getElementById('branch-stock-table-wrap');
  wrap.innerHTML = '<p class="crm-muted">Cargando…</p>';
  document.getElementById('modal-branch-stock').classList.add('open');

  try {
    lastBranchStockRows = await listProductBranchStock(currentInventorySuit.id, productId);
    renderBranchStockTable();
  } catch (err) {
    wrap.innerHTML = `<p class="crm-muted">No se pudo cargar el stock por sucursal (${esc(err.message)}).</p>`;
  }
}

function renderBranchStockTable() {
  const wrap = document.getElementById('branch-stock-table-wrap');

  if (!lastBranchStockRows.length) {
    wrap.innerHTML = '<p class="crm-muted">Este suit todavía no tiene sucursales activas.</p>';
    return;
  }

  const canWrite = ekCan('products', 'write');
  wrap.innerHTML = `
    <table class="crm-table">
      <thead><tr><th>Sucursal</th><th>Stock</th></tr></thead>
      <tbody>${lastBranchStockRows.map(r => `
        <tr>
          <td>${esc(r.branchName)}</td>
          <td><input type="number" min="0" class="branch-stock-input" data-branch-id="${r.branchId}" value="${r.stock}" style="width:90px" ${canWrite ? '' : 'disabled'} /></td>
        </tr>`).join('')}</tbody>
    </table>`;
  document.getElementById('modal-branch-stock-save').hidden = !canWrite;
}

function closeBranchStockModal() {
  document.getElementById('modal-branch-stock').classList.remove('open');
  branchStockProduct = null;
}

async function saveBranchStock() {
  if (!branchStockProduct || !currentInventorySuit) return;
  const btn = document.getElementById('modal-branch-stock-save');
  btn.disabled = true;

  try {
    const inputs = document.querySelectorAll('#branch-stock-table-wrap .branch-stock-input');
    await Promise.all([...inputs].map(input => {
      const branchId = input.dataset.branchId;
      const stock = Math.max(0, parseInt(input.value, 10) || 0);
      return setProductBranchStock(currentInventorySuit.id, branchStockProduct.id, branchId, stock);
    }));
    showToast('Stock por sucursal actualizado');
    closeBranchStockModal();
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el stock por sucursal', 'err');
  } finally {
    btn.disabled = false;
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────

function initInventoryEvents() {
  document.getElementById('dolar-price-save').addEventListener('click', saveDolarPrice);

  document.getElementById('inv-enter-products').addEventListener('click', enterProducts);
  document.getElementById('inv-enter-categories').addEventListener('click', enterCategories);
  document.getElementById('inv-enter-suppliers').addEventListener('click', enterSuppliers);
  document.getElementById('inv-enter-branches').addEventListener('click', enterBranches);
  document.getElementById('inv-enter-purchaseorders').addEventListener('click', enterPurchaseOrders);

  document.getElementById('inv-products-back').addEventListener('click', goToDashboard);
  document.getElementById('inv-search').addEventListener('input', () => {
    clearTimeout(invSearchTimer);
    invSearchTimer = setTimeout(() => fetchProducts(1), 300);
  });
  // Chips de filtro rápido (.sec-quick-filter) controlan productsFilter.
  const applyProductsFilter = (filter) => {
    if (filter === productsFilter) return;
    productsFilter = filter;
    document.querySelectorAll('.sec-quick-filter[data-products-filter]').forEach(c =>
      c.classList.toggle('active', c.dataset.productsFilter === productsFilter));
    fetchProducts(1);
  };
  document.querySelectorAll('.sec-quick-filter[data-products-filter]').forEach((btn) => {
    btn.addEventListener('click', () => applyProductsFilter(btn.dataset.productsFilter));
  });
  document.getElementById('inv-pagination').addEventListener('click', (e) => {
    const btn = e.target.closest('.page-btn:not([disabled])');
    if (btn) fetchProducts(Number(btn.dataset.page));
  });
  document.getElementById('btn-add-product').addEventListener('click', () => openProductModal(null));
  document.getElementById('inv-table-wrap').addEventListener('click', (e) => {
    const editBtn   = e.target.closest('[data-edit-product]');
    const delBtn    = e.target.closest('[data-del-product]');
    const stockBtn  = e.target.closest('[data-branch-stock-product]');
    if (stockBtn) openBranchStockModal(stockBtn.dataset.branchStockProduct);
    if (editBtn) openProductModal(editBtn.dataset.editProduct);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este producto? Esta acción no se puede deshacer.',
        onConfirm: async () => {
          try {
            await deleteProduct(currentInventorySuit.id, delBtn.dataset.delProduct);
            showToast('Producto eliminado');
            fetchProducts(productsPage);
            refreshInventoryHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el producto', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-product-close').addEventListener('click', closeProductModal);
  document.getElementById('modal-product-cancel').addEventListener('click', closeProductModal);
  document.getElementById('modal-product-save').addEventListener('click', saveProduct);

  document.getElementById('prod-price-add-btn').addEventListener('click', addProductModalPrice);
  document.getElementById('prod-price-new-value').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addProductModalPrice(); }
  });
  document.getElementById('prod-prices-wrap').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del-modal-price]');
    if (!delBtn) return;
    const productId = document.getElementById('modal-product').dataset.editId;
    openConfirmModal({
      message: '¿Eliminar este precio adicional?',
      onConfirm: async () => {
        try {
          await deleteProductPrice(currentInventorySuit.id, productId, delBtn.dataset.delModalPrice);
          showToast('Precio eliminado');
          await refreshProductPricesSection(productId);
        } catch (err) {
          showToast(err.message || 'No se pudo eliminar el precio', 'err');
        }
      }
    });
  });

  document.getElementById('prod-image-upload-btn').addEventListener('click', () => {
    document.getElementById('prod-image-file').click();
  });
  document.getElementById('prod-image-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) uploadCurrentProductImage(file);
  });
  document.getElementById('prod-images-grid').addEventListener('click', async (e) => {
    const productId = document.getElementById('modal-product').dataset.editId;
    if (!productId) return;

    const setBtn = e.target.closest('[data-set-primary-image]');
    const delBtn = e.target.closest('[data-del-image]');

    if (setBtn) {
      try {
        await setPrimaryProductImage(currentInventorySuit.id, productId, setBtn.dataset.setPrimaryImage);
        await refreshProductImagesSection(productId);
      } catch (err) {
        showToast(err.message || 'No se pudo marcar como principal', 'err');
      }
    }
    if (delBtn) {
      try {
        await deleteProductImage(currentInventorySuit.id, productId, delBtn.dataset.delImage);
        await refreshProductImagesSection(productId);
      } catch (err) {
        showToast(err.message || 'No se pudo eliminar la imagen', 'err');
      }
    }
  });

  document.getElementById('btn-percent-change').addEventListener('click', openPercentChangeModal);
  document.getElementById('modal-percent-change-close').addEventListener('click', closePercentChangeModal);
  document.getElementById('modal-percent-change-cancel').addEventListener('click', closePercentChangeModal);

  document.getElementById('pct-add-category-btn').addEventListener('click', () => {
    addProductsFromCategory(document.getElementById('pct-category-select').value);
  });
  document.getElementById('pct-product-search').addEventListener('input', (e) => {
    clearTimeout(pctSearchTimer);
    const term = e.target.value;
    pctSearchTimer = setTimeout(() => searchPctProducts(term), 300);
  });
  document.getElementById('pct-product-results').addEventListener('click', (e) => {
    const item = e.target.closest('[data-pick-pct-product]');
    if (item) addPctProduct(item.dataset.pickPctProduct);
  });
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('pct-product-picker');
    if (!picker.contains(e.target)) document.getElementById('pct-product-results').hidden = true;
  });
  document.getElementById('pct-selection-wrap').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-pct-product]');
    if (rm) { pctSelected.delete(rm.dataset.removePctProduct); renderPctSelectionList(); }
  });
  document.getElementById('pct-preview-btn').addEventListener('click', goToPctPreview);
  document.getElementById('pct-back-btn').addEventListener('click', () => showPctStep('select'));
  document.getElementById('pct-apply-btn').addEventListener('click', applyPercentChange);

  // Categorías se entra desde adentro de Productos (#inv-enter-categories),
  // así que "Volver" es a Productos, no al Dashboard.
  document.getElementById('inv-categories-back').addEventListener('click', () => { enterProducts(); refreshInventoryHome(); });
  document.getElementById('cat-search').addEventListener('input', () => {
    clearTimeout(catSearchTimer);
    catSearchTimer = setTimeout(renderCategoriesTable, 300);
  });
  document.getElementById('btn-add-cat').addEventListener('click', () => openCategoryModal(null));
  document.getElementById('cat-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-cat]');
    const delBtn  = e.target.closest('[data-del-cat]');
    if (editBtn) openCategoryModal(editBtn.dataset.editCat);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar esta categoría?',
        onConfirm: async () => {
          try {
            await deleteCategory(currentInventorySuit.id, delBtn.dataset.delCat);
            showToast('Categoría eliminada');
            fetchCategories();
            refreshInventoryHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la categoría', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-cat-close').addEventListener('click', closeCategoryModal);
  document.getElementById('modal-cat-cancel').addEventListener('click', closeCategoryModal);
  document.getElementById('modal-cat-save').addEventListener('click', saveCategory);
  document.getElementById('cat-featured').addEventListener('change', (e) => {
    document.getElementById('cat-order-field').hidden = !e.target.checked;
  });

  document.getElementById('inv-suppliers-back').addEventListener('click', goToDashboard);
  document.getElementById('sup-search').addEventListener('input', () => {
    clearTimeout(supSearchTimer);
    supSearchTimer = setTimeout(renderSuppliersTable, 300);
  });
  document.getElementById('btn-add-sup').addEventListener('click', () => openSupplierModal(null));
  document.getElementById('sup-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-sup]');
    const delBtn  = e.target.closest('[data-del-sup]');
    if (editBtn) openSupplierModal(editBtn.dataset.editSup);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar este proveedor?',
        onConfirm: async () => {
          try {
            await deleteSupplier(currentInventorySuit.id, delBtn.dataset.delSup);
            showToast('Proveedor eliminado');
            fetchSuppliers();
            refreshInventoryHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el proveedor', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-sup-close').addEventListener('click', closeSupplierModal);
  document.getElementById('modal-sup-cancel').addEventListener('click', closeSupplierModal);
  document.getElementById('modal-sup-save').addEventListener('click', saveSupplier);

  document.getElementById('inv-branches-back').addEventListener('click', goToDashboard);
  document.getElementById('branch-search').addEventListener('input', () => {
    clearTimeout(branchSearchTimer);
    branchSearchTimer = setTimeout(renderBranchesTable, 300);
  });
  document.getElementById('btn-add-branch').addEventListener('click', () => openBranchModal(null));
  document.getElementById('branch-table-wrap').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-branch]');
    const delBtn  = e.target.closest('[data-del-branch]');
    if (editBtn) openBranchModal(editBtn.dataset.editBranch);
    if (delBtn) {
      openConfirmModal({
        message: '¿Eliminar esta sucursal?',
        onConfirm: async () => {
          try {
            await deleteBranch(currentInventorySuit.id, delBtn.dataset.delBranch);
            showToast('Sucursal eliminada');
            fetchBranches();
            refreshInventoryHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la sucursal', 'err');
          }
        }
      });
    }
  });
  document.getElementById('modal-branch-close').addEventListener('click', closeBranchModal);
  document.getElementById('modal-branch-cancel').addEventListener('click', closeBranchModal);
  document.getElementById('modal-branch-save').addEventListener('click', saveBranch);

  document.getElementById('modal-branch-stock-close').addEventListener('click', closeBranchStockModal);
  document.getElementById('modal-branch-stock-cancel').addEventListener('click', closeBranchStockModal);
  document.getElementById('modal-branch-stock-save').addEventListener('click', saveBranchStock);
}
