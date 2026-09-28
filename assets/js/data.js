/**
 * data.js
 * Data layer — the ONLY file that branches on window.EKITWI_DEV_MODE.
 * Every function here returns the same shape whether it hit the real API
 * (api.js) or the in-memory mocks (mocks.js); every render function in
 * commerce.js/inventory.js just consumes plain data and doesn't care which.
 * See APIconnection.md for what's read-only vs. still pending.
 */

'use strict';

async function loadSuitsWithSystems() {
  const suits = await apiGet('/suits');
  return Promise.all((suits || []).map(async (s) => {
    try {
      const systems = await apiGet(`/suits/${s.id}/systems`);
      return { ...s, systems: (systems || []).map(sys => sys.type) };
    } catch (err) {
      // No tragarlo en silencio: un 403 acá deja el aside en "Sin módulos habilitados".
      console.warn(`No se pudieron cargar los sistemas del suit ${s.id}:`, err?.message || err);
      return { ...s, systems: [] };
    }
  }));
}

// Detalle de un suit (para la pestaña "Suit Info": nombre, descripción y
// canales de contacto instagram/facebook/whatsapp).
async function getSuit(suitId) {
  if (window.EKITWI_DEV_MODE) {
    const s = (MOCK_SUITS || []).find(x => x.id === suitId) || {};
    return { instagram: '', facebook: '', whatsapp: '', description: '', ...s };
  }
  return apiGet(`/suits/${suitId}`);
}

// Edición restringida del suit por su owner (nombre, descripción, canales de
// contacto, color placeholder) — PATCH /suits/:id/profile.
async function updateSuitProfile(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const s = (MOCK_SUITS || []).find(x => x.id === suitId);
    if (s) Object.assign(s, dto);
    return { ...(s || {}), ...dto };
  }
  return apiPatch(`/suits/${suitId}/profile`, dto);
}

// ══════════════════════════════════════════════════════
// Equipo — roles del suit (plantillas de permisos) y miembros invitados.
// Exclusivo del owner (ver pestaña "Equipo", team.js). Sin mocks de
// EKITWI_DEV_MODE: dev mode siempre entra como owner/SUPER_ADMIN con acceso
// total (ver permissions.js), esta pestaña no aporta nada nuevo ahí.
// ══════════════════════════════════════════════════════

async function listSuitRoles(suitId) {
  return apiGet(`/suits/${suitId}/roles`);
}

async function createSuitRole(suitId, dto) {
  return apiPost(`/suits/${suitId}/roles`, dto);
}

async function updateSuitRole(suitId, roleId, dto) {
  return apiPatch(`/suits/${suitId}/roles/${roleId}`, dto);
}

async function deleteSuitRole(suitId, roleId) {
  return apiDelete(`/suits/${suitId}/roles/${roleId}`);
}

async function listApprovals(suitId, status) {
  return apiGet(`/suits/${suitId}/approvals${status ? `?status=${status}` : ''}`);
}
async function approveApproval(suitId, id) { return apiPost(`/suits/${suitId}/approvals/${id}/approve`); }
async function rejectApproval(suitId, id)  { return apiPost(`/suits/${suitId}/approvals/${id}/reject`); }

async function listSuitMembers(suitId) {
  return apiGet(`/suits/${suitId}/members`);
}

async function createSuitMember(suitId, dto) {
  return apiPost(`/suits/${suitId}/members`, dto);
}

async function updateSuitMember(suitId, userId, dto) {
  return apiPatch(`/suits/${suitId}/members/${userId}`, dto);
}

async function deleteSuitMember(suitId, userId) {
  return apiDelete(`/suits/${suitId}/members/${userId}`);
}

// Indexado por module (identity | commerce | inventory | booking | projects
// | accounting | bi), lo consulta dashboard.js una sola vez al bootstrap.
async function loadSystemStatus() {
  if (window.EKITWI_DEV_MODE) return MOCK_SYSTEM_STATUS;
  return apiGet('/system-status');
}

// Catálogo de módulos (commerce | ecommerce | inventory | booking | scrum |
// contable | bi) y las features/pestañas que cada uno desbloquea — lo
// consulta initSuits() (shared-ui.js) una sola vez para armar el sidebar
// data-driven en vez del mapeo módulo→pestaña hardcodeado de antes.
async function loadModulesCatalog() {
  if (window.EKITWI_DEV_MODE) return MOCK_MODULES_CATALOG;
  return apiGet('/modules');
}

async function listOrders(suitId, type, take = 30) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_ORDERS.filter(o => !type || o.type === type).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  const qs = new URLSearchParams({ take: String(take) });
  if (type) qs.set('type', type);
  const res = await apiGet(`/suits/${suitId}/orders?${qs}`);
  return res.data;
}

async function createPosSale(suitId, items, branchId, paymentMethod, discountPercent) {
  if (window.EKITWI_DEV_MODE) {
    // Misma regla que el backend real (sales.service.ts): el stock se valida
    // recién acá, al confirmar la venta, no al escanear/agregar al carrito.
    // Con branchId descuenta de MOCK_PRODUCT_BRANCH_STOCK; sin eso, del pool
    // sin sucursal (p.stock) — mismo comportamiento de siempre.
    for (const i of items) {
      const p = MOCK_PRODUCTS.find(mp => mp.id === i.productId);
      const available = branchId ? ((MOCK_PRODUCT_BRANCH_STOCK[i.productId] || {})[branchId] ?? 0) : (p ? p.stock : 0);
      if (!p || available < i.quantity) {
        throw new Error(`Stock insuficiente para "${p ? p.name : i.productId}" (disponible: ${available})`);
      }
    }
    let baseTotal = 0;
    const saleItems = items.map(i => {
      const p = MOCK_PRODUCTS.find(mp => mp.id === i.productId);
      let unitPrice = Number(p.price);
      if (i.priceId) {
        const price = (MOCK_PRICES[p.id] || []).find(pr => pr.id === i.priceId);
        if (price) unitPrice = Number(price.price);
      }
      const subtotal = unitPrice * i.quantity;
      baseTotal += subtotal;
      if (branchId) {
        MOCK_PRODUCT_BRANCH_STOCK[p.id] = MOCK_PRODUCT_BRANCH_STOCK[p.id] || {};
        MOCK_PRODUCT_BRANCH_STOCK[p.id][branchId] = (MOCK_PRODUCT_BRANCH_STOCK[p.id][branchId] ?? 0) - i.quantity;
      } else {
        p.stock -= i.quantity;
      }
      return { productId: p.id, priceId: i.priceId || null, productName: p.name, unitPrice, quantity: i.quantity, subtotal };
    });
    const discount = discountPercent || 0;
    const pm = MOCK_PAYMENT_METHODS.find(m => m.key === paymentMethod);
    const markup = pm ? Number(pm.markupPercent) : 0;
    const finalTotal = baseTotal * (1 - discount / 100) * (1 + markup / 100);
    const order = {
      id: Math.max(0, ...MOCK_ORDERS.map(o => o.id)) + 1,
      date: new Date().toISOString(),
      type: 'venta',
      user: { email: 'dev@ekitwi.com' },
      sale: { items: saleItems, branchId: branchId || null, paymentMethod: paymentMethod || null, discountPercent: discount, markupPercent: markup, total: finalTotal }
    };
    MOCK_ORDERS.unshift(order);
    return order;
  }
  return apiPost(`/suits/${suitId}/orders/pos`, { type: 'venta', items, branchId: branchId || undefined, paymentMethod: paymentMethod || undefined, discountPercent: discountPercent || undefined });
}

async function updateOrderAction(suitId, orderId, action, restock) {
  if (window.EKITWI_DEV_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === Number(orderId));
    if (!order) throw new Error('Pedido no encontrado');
    if (action === 'accept') order.type = 'venta';
    if (action === 'cancel') order.type = 'pedido cancelado';
    if (action === 'return') order.type = 'devolucion';
    return order;
  }
  const body = { action };
  if (restock !== undefined) body.restock = restock;
  return apiPatch(`/suits/${suitId}/orders/${orderId}`, body);
}

async function findProductByCode(suitId, code) {
  if (window.EKITWI_DEV_MODE) {
    // Un producto inactivo no debe poder escanearse, igual que en el backend
    // real (products.service.ts: findBySku/findByScanId).
    const p = MOCK_PRODUCTS.find(mp => (mp.scanId === code || mp.sku === code) && mp.isActive);
    if (!p) throw new Error('Producto no encontrado');
    return p;
  }
  try {
    return await apiGet(`/suits/${suitId}/products/scan/${encodeURIComponent(code)}`);
  } catch {
    return apiGet(`/suits/${suitId}/products/sku/${encodeURIComponent(code)}`);
  }
}

async function listProducts(suitId, { search, categoryId, skip = 0, take = 20, minStockAlert } = {}) {
  if (window.EKITWI_DEV_MODE) {
    let data = MOCK_PRODUCTS.slice();
    if (search) data = data.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (categoryId) data = data.filter(p => p.categoryId === categoryId);
    if (minStockAlert) data = data.filter(p => p.minStock != null && p.stock <= p.minStock);
    const total = data.length;
    return { data: data.slice(skip, skip + take), pagination: { total } };
  }
  const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
  if (search) qs.set('search', search);
  if (categoryId) qs.set('categoryId', categoryId);
  if (minStockAlert) qs.set('minStockAlert', 'true');
  return apiGet(`/suits/${suitId}/products?${qs}`);
}

// Aplica el mismo % (positivo aumenta, negativo disminuye) sobre el precio
// actual de cada producto — misma lógica que products.service.ts
// bulkPriceChange() en el backend real, para que el preview en dev mode
// coincida con lo que haría la API.
async function bulkPriceChangeProducts(suitId, productIds, percent) {
  if (window.EKITWI_DEV_MODE) {
    const factor = 1 + percent / 100;
    const updated = [];
    for (const id of productIds) {
      const p = MOCK_PRODUCTS.find(mp => mp.id === id);
      if (!p) throw new Error(`No se encontraron los siguientes productos en esta tienda: ${id}`);
      p.price = Math.round(p.price * factor * 100) / 100;
      updated.push(p);
    }
    return updated;
  }
  return apiPatch(`/suits/${suitId}/products/bulk-price-change`, { productIds, percent });
}

async function createProduct(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const cat = MOCK_CATEGORIES.find(c => c.id === dto.categoryId);
    const sup = MOCK_SUPPLIERS.find(s => s.id === dto.supplierId);
    const product = {
      id: 'mock-p' + (Date.now()), ...dto,
      category: cat ? { id: cat.id, name: cat.name } : null,
      supplier: sup ? { id: sup.id, name: sup.name } : null
    };
    MOCK_PRODUCTS.unshift(product);
    return product;
  }
  return apiPost(`/suits/${suitId}/products`, dto);
}

async function updateProduct(suitId, productId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const p = MOCK_PRODUCTS.find(mp => mp.id === productId);
    if (!p) throw new Error('Producto no encontrado');
    Object.assign(p, dto);
    if (dto.categoryId !== undefined) {
      const cat = MOCK_CATEGORIES.find(c => c.id === dto.categoryId);
      p.category = cat ? { id: cat.id, name: cat.name } : null;
    }
    if (dto.supplierId !== undefined) {
      const sup = MOCK_SUPPLIERS.find(s => s.id === dto.supplierId);
      p.supplier = sup ? { id: sup.id, name: sup.name } : null;
    }
    return p;
  }
  return apiPatch(`/suits/${suitId}/products/${productId}`, dto);
}

async function deleteProduct(suitId, productId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_PRODUCTS.findIndex(p => p.id === productId);
    if (idx >= 0) MOCK_PRODUCTS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/products/${productId}`);
}

async function listCategories(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_CATEGORIES;
  return apiGet(`/suits/${suitId}/categories`);
}

async function createCategory(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const cat = { id: 'mock-c' + Date.now(), ...dto, _count: { products: 0 } };
    MOCK_CATEGORIES.unshift(cat);
    return cat;
  }
  return apiPost(`/suits/${suitId}/categories`, dto);
}

async function updateCategory(suitId, categoryId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const c = MOCK_CATEGORIES.find(mc => mc.id === categoryId);
    if (!c) throw new Error('Categoría no encontrada');
    Object.assign(c, dto);
    return c;
  }
  return apiPatch(`/suits/${suitId}/categories/${categoryId}`, dto);
}

async function deleteCategory(suitId, categoryId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_CATEGORIES.findIndex(c => c.id === categoryId);
    if (idx >= 0) MOCK_CATEGORIES.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/categories/${categoryId}`);
}

// ── Suppliers ────────────────────────────────────────────────────────────

async function listSuppliers(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_SUPPLIERS;
  return apiGet(`/suits/${suitId}/suppliers`);
}

async function createSupplier(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const supplier = { id: 'mock-sup' + Date.now(), ...dto, _count: { products: 0 } };
    MOCK_SUPPLIERS.unshift(supplier);
    return supplier;
  }
  return apiPost(`/suits/${suitId}/suppliers`, dto);
}

async function updateSupplier(suitId, supplierId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_SUPPLIERS.find(ms => ms.id === supplierId);
    if (!s) throw new Error('Proveedor no encontrado');
    Object.assign(s, dto);
    return s;
  }
  return apiPatch(`/suits/${suitId}/suppliers/${supplierId}`, dto);
}

async function deleteSupplier(suitId, supplierId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_SUPPLIERS.findIndex(s => s.id === supplierId);
    if (idx >= 0) MOCK_SUPPLIERS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/suppliers/${supplierId}`);
}

// ── Branches ─────────────────────────────────────────────────────────────

async function listBranches(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_BRANCHES;
  return apiGet(`/suits/${suitId}/branches`);
}

async function createBranch(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const branch = { id: 'mock-branch' + Date.now(), ...dto };
    MOCK_BRANCHES.unshift(branch);
    return branch;
  }
  return apiPost(`/suits/${suitId}/branches`, dto);
}

async function updateBranch(suitId, branchId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const b = MOCK_BRANCHES.find(mb => mb.id === branchId);
    if (!b) throw new Error('Sucursal no encontrada');
    Object.assign(b, dto);
    return b;
  }
  return apiPatch(`/suits/${suitId}/branches/${branchId}`, dto);
}

async function deleteBranch(suitId, branchId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_BRANCHES.findIndex(b => b.id === branchId);
    if (idx >= 0) MOCK_BRANCHES.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/branches/${branchId}`);
}

// ── Purchase Orders (Pedidos a Proveedores) ─────────────────────────────────
// Fase 1: ciclo draft -> sent -> cancelled, sin recepción todavía (ver plan
// de merge SEC POS). "send" es el paso de aprobación, gateado por permiso
// de escritura en la sección 'purchase_orders', no por un rol hardcodeado.

async function listPurchaseOrders(suitId, status) {
  if (window.EKITWI_DEV_MODE) return status ? MOCK_PURCHASE_ORDERS.filter(po => po.status === status) : MOCK_PURCHASE_ORDERS;
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet(`/suits/${suitId}/purchase-orders${qs}`);
}

async function getPurchaseOrder(suitId, poId) {
  if (window.EKITWI_DEV_MODE) {
    const po = MOCK_PURCHASE_ORDERS.find(p => p.id === poId);
    if (!po) throw new Error('Pedido a proveedor no encontrado');
    return po;
  }
  return apiGet(`/suits/${suitId}/purchase-orders/${poId}`);
}

async function createPurchaseOrder(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const supplier = MOCK_SUPPLIERS.find(s => s.id === dto.supplierId);
    const branch = MOCK_BRANCHES.find(b => b.id === dto.branchId);
    const po = {
      id: 'mock-po' + Date.now(),
      status: 'draft',
      notes: dto.notes || null,
      supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      branch: branch ? { id: branch.id, name: branch.name } : null,
      createdBy: { id: 'mock-user', email: 'dev@ekitwi.com' },
      sentBy: null,
      createdAt: new Date().toISOString(),
      items: dto.items.map((it, i) => ({ id: 'mock-poi' + i, quantityReceived: 0, ...it }))
    };
    MOCK_PURCHASE_ORDERS.unshift(po);
    return po;
  }
  return apiPost(`/suits/${suitId}/purchase-orders`, dto);
}

async function updatePurchaseOrder(suitId, poId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const po = MOCK_PURCHASE_ORDERS.find(p => p.id === poId);
    if (!po) throw new Error('Pedido a proveedor no encontrado');
    if (dto.items) po.items = dto.items.map((it, i) => ({ id: 'mock-poi' + i, quantityReceived: 0, ...it }));
    if (dto.notes !== undefined) po.notes = dto.notes;
    return po;
  }
  return apiPatch(`/suits/${suitId}/purchase-orders/${poId}`, dto);
}

async function sendPurchaseOrder(suitId, poId) {
  if (window.EKITWI_DEV_MODE) {
    const po = MOCK_PURCHASE_ORDERS.find(p => p.id === poId);
    if (!po) throw new Error('Pedido a proveedor no encontrado');
    po.status = 'sent';
    po.sentBy = { id: 'mock-user', email: 'dev@ekitwi.com' };
    return po;
  }
  return apiPost(`/suits/${suitId}/purchase-orders/${poId}/send`);
}

async function cancelPurchaseOrder(suitId, poId) {
  if (window.EKITWI_DEV_MODE) {
    const po = MOCK_PURCHASE_ORDERS.find(p => p.id === poId);
    if (!po) throw new Error('Pedido a proveedor no encontrado');
    po.status = 'cancelled';
    return po;
  }
  return apiPost(`/suits/${suitId}/purchase-orders/${poId}/cancel`);
}

// Fase 2: recibir mercadería (posiblemente parcial) contra un pedido
// 'sent'/'partially_received' — ver PurchaseOrdersService.receive().
async function receivePurchaseOrder(suitId, poId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const po = MOCK_PURCHASE_ORDERS.find(p => p.id === poId);
    if (!po) throw new Error('Pedido a proveedor no encontrado');
    for (const line of dto.items) {
      const item = po.items.find(it => it.id === line.purchaseOrderItemId);
      if (item) item.quantityReceived = (item.quantityReceived || 0) + line.quantityReceived;
    }
    po.status = po.items.every(it => it.quantityReceived >= it.quantity) ? 'received' : 'partially_received';
    return po;
  }
  return apiPost(`/suits/${suitId}/purchase-orders/${poId}/receipts`, dto);
}

// ── Exchanges (Cambio: canje cruzado de producto) ───────────────────────────
// Fase 3 del merge con SEC POS — ver ExchangesService.create(). Reusa el
// permiso de sección 'orders', no tiene sección propia.

async function createExchange(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const returned = MOCK_PRODUCTS.find(p => p.id === dto.returnedProductId);
    const created = MOCK_PRODUCTS.find(p => p.id === dto.newProductId);
    const returnedUnitPrice = returned ? Number(returned.price) : 0;
    const newUnitPrice = created ? Number(created.price) : 0;
    return {
      id: 'mock-exch' + Date.now(),
      returnedProduct: returned ? { id: returned.id, name: returned.name } : null,
      returnedQuantity: dto.returnedQuantity, returnedUnitPrice,
      newProduct: created ? { id: created.id, name: created.name } : null,
      newQuantity: dto.newQuantity, newUnitPrice,
      priceDifference: newUnitPrice * dto.newQuantity - returnedUnitPrice * dto.returnedQuantity,
      createdAt: new Date().toISOString(),
    };
  }
  return apiPost(`/suits/${suitId}/exchanges`, dto);
}

// ── Payment Methods (Medios de venta) ───────────────────────────────────────
// Config por suit de cómo se puede cobrar una venta (nombre + % de recargo).
// El POS usa esto para el selector de pago y el cálculo del total final —
// ver PaymentMethodsService/SalesService.createSaleInTransaction.

async function listPaymentMethods(suitId, onlyActive) {
  if (window.EKITWI_DEV_MODE) return onlyActive ? MOCK_PAYMENT_METHODS.filter(m => m.isActive) : MOCK_PAYMENT_METHODS;
  const qs = onlyActive ? '?onlyActive=true' : '';
  return apiGet(`/suits/${suitId}/payment-methods${qs}`);
}

async function createPaymentMethod(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const pm = { id: 'mock-pm' + Date.now(), suitId, isActive: true, order: MOCK_PAYMENT_METHODS.length, markupPercent: 0, ...dto };
    MOCK_PAYMENT_METHODS.push(pm);
    return pm;
  }
  return apiPost(`/suits/${suitId}/payment-methods`, dto);
}

async function updatePaymentMethod(suitId, id, dto) {
  if (window.EKITWI_DEV_MODE) {
    const pm = MOCK_PAYMENT_METHODS.find(m => m.id === id);
    if (!pm) throw new Error('Medio de venta no encontrado');
    Object.assign(pm, dto);
    return pm;
  }
  return apiPatch(`/suits/${suitId}/payment-methods/${id}`, dto);
}

async function listGoodsReceipts(suitId, poId) {
  if (window.EKITWI_DEV_MODE) return [];
  return apiGet(`/suits/${suitId}/purchase-orders/${poId}/receipts`);
}

// Stock de un producto por sucursal — trae todas las sucursales activas del
// suit con el stock de ese producto en cada una (0 si nunca se cargó).
async function listProductBranchStock(suitId, productId) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_BRANCHES.filter(b => b.isActive).map(b => ({
      branchId: b.id,
      branchName: b.name,
      stock: (MOCK_PRODUCT_BRANCH_STOCK[productId] || {})[b.id] ?? 0
    }));
  }
  return apiGet(`/suits/${suitId}/products/${productId}/branch-stock`);
}

async function setProductBranchStock(suitId, productId, branchId, stock) {
  if (window.EKITWI_DEV_MODE) {
    MOCK_PRODUCT_BRANCH_STOCK[productId] = MOCK_PRODUCT_BRANCH_STOCK[productId] || {};
    MOCK_PRODUCT_BRANCH_STOCK[productId][branchId] = stock;
    return { productId, branchId, stock };
  }
  return apiPut(`/suits/${suitId}/products/${productId}/branch-stock/${branchId}`, { stock });
}

// ── Cash registers (Caja/s) ─────────────────────────────────────────────

async function listCashRegisters(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_CASH_REGISTERS;
  return apiGet(`/suits/${suitId}/cash-registers`);
}

async function createCashRegister(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const branch = MOCK_BRANCHES.find(b => b.id === dto.branchId);
    const register = { id: 'mock-reg' + Date.now(), ...dto, branch: branch ? { id: branch.id, name: branch.name } : null };
    MOCK_CASH_REGISTERS.unshift(register);
    return register;
  }
  return apiPost(`/suits/${suitId}/cash-registers`, dto);
}

async function updateCashRegister(suitId, registerId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const r = MOCK_CASH_REGISTERS.find(mr => mr.id === registerId);
    if (!r) throw new Error('Caja no encontrada');
    Object.assign(r, dto);
    return r;
  }
  return apiPatch(`/suits/${suitId}/cash-registers/${registerId}`, dto);
}

async function deleteCashRegister(suitId, registerId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_CASH_REGISTERS.findIndex(r => r.id === registerId);
    if (idx >= 0) MOCK_CASH_REGISTERS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/cash-registers/${registerId}`);
}

// ── Cash sessions (apertura/cierre + movimientos) ───────────────────────
// Standalone: sin vínculo con las ventas del POS (no hay método de pago
// por venta todavía) — expectedAmount/difference salen solo de los
// movimientos manuales de la sesión. Ver API/docs/migracion_19.md.

async function listCashSessions(suitId, filters = {}) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_CASH_SESSIONS.filter(s =>
      (!filters.cashRegisterId || s.cashRegisterId === filters.cashRegisterId) &&
      (!filters.status || s.status === filters.status)
    );
  }
  const qs = new URLSearchParams();
  if (filters.cashRegisterId) qs.set('cashRegisterId', filters.cashRegisterId);
  if (filters.status) qs.set('status', filters.status);
  const res = await apiGet(`/suits/${suitId}/cash-sessions?${qs}`);
  return res.data;
}

async function openCashSession(suitId, cashRegisterId, initialAmount) {
  if (window.EKITWI_DEV_MODE) {
    if (MOCK_CASH_SESSIONS.some(s => s.cashRegisterId === cashRegisterId && s.status === 'abierta')) {
      throw new Error('Esa caja ya tiene una sesión abierta.');
    }
    const register = MOCK_CASH_REGISTERS.find(r => r.id === cashRegisterId);
    const session = {
      id: 'mock-sess' + Date.now(), cashRegisterId, status: 'abierta',
      initialAmount, expectedAmount: null, finalAmount: null, difference: null,
      openedBy: { email: 'dev@ekitwi.com' }, openedAt: new Date().toISOString(),
      closedBy: null, closedAt: null,
      cashRegister: register ? { id: register.id, name: register.name } : null,
      movements: []
    };
    MOCK_CASH_SESSIONS.unshift(session);
    return session;
  }
  return apiPost(`/suits/${suitId}/cash-sessions`, { cashRegisterId, initialAmount });
}

async function getCashSession(suitId, sessionId) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_CASH_SESSIONS.find(ms => ms.id === sessionId);
    if (!s) throw new Error('Sesión no encontrada');
    return s;
  }
  return apiGet(`/suits/${suitId}/cash-sessions/${sessionId}`);
}

async function closeCashSession(suitId, sessionId, finalAmount) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_CASH_SESSIONS.find(ms => ms.id === sessionId);
    if (!s) throw new Error('Sesión no encontrada');
    const ingresos = s.movements.filter(m => m.type === 'ingreso').reduce((sum, m) => sum + m.amount, 0);
    const egresos = s.movements.filter(m => m.type === 'egreso').reduce((sum, m) => sum + m.amount, 0);
    s.expectedAmount = s.initialAmount + ingresos - egresos;
    s.finalAmount = finalAmount;
    s.difference = finalAmount - s.expectedAmount;
    s.status = 'cerrada';
    s.closedAt = new Date().toISOString();
    s.closedBy = { email: 'dev@ekitwi.com' };
    return s;
  }
  return apiPatch(`/suits/${suitId}/cash-sessions/${sessionId}/status`, { action: 'cerrar', finalAmount });
}

async function addCashMovement(suitId, sessionId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_CASH_SESSIONS.find(ms => ms.id === sessionId);
    if (!s) throw new Error('Sesión no encontrada');
    const movement = { id: 'mock-mov' + Date.now(), ...dto, createdBy: { email: 'dev@ekitwi.com' }, createdAt: new Date().toISOString() };
    s.movements.push(movement);
    return movement;
  }
  return apiPost(`/suits/${suitId}/cash-sessions/${sessionId}/movements`, dto);
}

async function deleteCashMovement(suitId, sessionId, movementId) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_CASH_SESSIONS.find(ms => ms.id === sessionId);
    if (s) s.movements = s.movements.filter(m => m.id !== movementId);
    return;
  }
  return apiDelete(`/suits/${suitId}/cash-sessions/${sessionId}/movements/${movementId}`);
}

// Prices are nested under a single product (no suit-wide "all prices" list).
async function listProductPrices(suitId, productId) {
  if (window.EKITWI_DEV_MODE) return MOCK_PRICES[productId] || [];
  return apiGet(`/suits/${suitId}/products/${productId}/prices`);
}

async function createProductPrice(suitId, productId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const price = { id: 'mock-pr' + Date.now(), ...dto };
    (MOCK_PRICES[productId] ||= []).push(price);
    return price;
  }
  return apiPost(`/suits/${suitId}/products/${productId}/prices`, dto);
}

async function updateProductPrice(suitId, productId, priceId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const price = (MOCK_PRICES[productId] || []).find(p => p.id === priceId);
    if (!price) throw new Error('Precio no encontrado');
    Object.assign(price, dto);
    return price;
  }
  return apiPatch(`/suits/${suitId}/products/${productId}/prices/${priceId}`, dto);
}

async function deleteProductPrice(suitId, productId, priceId) {
  if (window.EKITWI_DEV_MODE) {
    const list = MOCK_PRICES[productId] || [];
    const idx = list.findIndex(p => p.id === priceId);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/products/${productId}/prices/${priceId}`);
}

// ── Product Images ───────────────────────────────────────────────────────

async function listProductImages(suitId, productId) {
  if (window.EKITWI_DEV_MODE) return MOCK_PRODUCT_IMAGES[productId] || [];
  return apiGet(`/suits/${suitId}/products/${productId}/images`);
}

// file: un File del <input type="file">. En dev mode se lo convierte a data
// URL nomás para poder previsualizarlo — no hay Cloudinary de mentira.
async function uploadProductImage(suitId, productId, file) {
  if (window.EKITWI_DEV_MODE) {
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
    const list = (MOCK_PRODUCT_IMAGES[productId] ||= []);
    const image = { id: 'mock-img' + Date.now(), url, isPrimary: list.length === 0, order: list.length };
    list.push(image);
    return image;
  }
  const formData = new FormData();
  formData.append('image', file);
  return apiUpload(`/suits/${suitId}/products/${productId}/images`, formData);
}

async function setPrimaryProductImage(suitId, productId, imageId) {
  if (window.EKITWI_DEV_MODE) {
    const list = MOCK_PRODUCT_IMAGES[productId] || [];
    list.forEach(img => { img.isPrimary = img.id === imageId; });
    return list.find(img => img.id === imageId);
  }
  return apiPatch(`/suits/${suitId}/products/${productId}/images/${imageId}`, { isPrimary: true });
}

async function deleteProductImage(suitId, productId, imageId) {
  if (window.EKITWI_DEV_MODE) {
    const list = MOCK_PRODUCT_IMAGES[productId] || [];
    const idx = list.findIndex(img => img.id === imageId);
    const wasPrimary = idx >= 0 && list[idx].isPrimary;
    if (idx >= 0) list.splice(idx, 1);
    if (wasPrimary && list.length) list[0].isPrimary = true;
    return { success: true };
  }
  return apiDelete(`/suits/${suitId}/products/${productId}/images/${imageId}`);
}

// ── Booking Resources ────────────────────────────────────────────────────

async function listBookingResources(suitId, { type, search, isActive, skip = 0, take = 20 } = {}) {
  if (window.EKITWI_DEV_MODE) {
    let data = MOCK_BOOKING_RESOURCES.slice();
    if (type) data = data.filter(r => r.type === type);
    if (isActive !== undefined) data = data.filter(r => r.isActive === isActive);
    if (search) data = data.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    const total = data.length;
    return { data: data.slice(skip, skip + take), pagination: { total } };
  }
  const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
  if (type) qs.set('type', type);
  if (search) qs.set('search', search);
  if (isActive !== undefined) qs.set('isActive', String(isActive));
  return apiGet(`/suits/${suitId}/booking-resources?${qs}`);
}

async function createBookingResource(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const resource = { ...dto, id: 'mock-bkr' + Date.now(), capacity: dto.capacity ?? 1, isActive: dto.isActive ?? true };
    MOCK_BOOKING_RESOURCES.unshift(resource);
    return resource;
  }
  return apiPost(`/suits/${suitId}/booking-resources`, dto);
}

async function updateBookingResource(suitId, resourceId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const r = MOCK_BOOKING_RESOURCES.find(mr => mr.id === resourceId);
    if (!r) throw new Error('Recurso no encontrado');
    Object.assign(r, dto);
    return r;
  }
  return apiPatch(`/suits/${suitId}/booking-resources/${resourceId}`, dto);
}

async function deleteBookingResource(suitId, resourceId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_BOOKING_RESOURCES.findIndex(r => r.id === resourceId);
    if (idx >= 0) MOCK_BOOKING_RESOURCES.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/booking-resources/${resourceId}`);
}

// Motor de disponibilidad — usado por la tabla de Recursos (indirectamente
// no) y, sobre todo, por el modal de "Nueva reserva" antes de habilitar el
// botón de guardar. El backend revalida esto mismo dentro de su propia
// transacción al crear/editar, así que este chequeo es solo UX.
async function checkAvailability(suitId, resourceId, startAt, endAt, quantity = 1, excludeBookingId) {
  if (window.EKITWI_DEV_MODE) {
    const resource = MOCK_BOOKING_RESOURCES.find(r => r.id === resourceId);
    if (!resource) throw new Error('Recurso no encontrado');
    if (!resource.isActive) return { available: false, reason: 'inactive', remaining: 0 };
    const start = new Date(startAt), end = new Date(endAt);
    const overlapping = MOCK_BOOKINGS.filter(b =>
      b.resourceId === resourceId &&
      !['cancelled', 'no_show'].includes(b.status) &&
      (excludeBookingId ? b.id !== excludeBookingId : true) &&
      new Date(b.startAt) < end && new Date(b.endAt) > start
    );
    const occupied = overlapping.reduce((sum, b) => sum + b.quantity, 0);
    const remaining = resource.capacity - occupied;
    if (remaining < quantity) return { available: false, reason: 'capacity', remaining: Math.max(0, remaining) };
    return { available: true, remaining: remaining - quantity };
  }
  const qs = new URLSearchParams({ startAt, endAt, quantity: String(quantity) });
  if (excludeBookingId) qs.set('excludeBookingId', excludeBookingId);
  return apiGet(`/suits/${suitId}/booking-resources/${resourceId}/availability?${qs}`);
}

// ── Booking Closures (cierres manuales por recurso) ──────────────────────

async function listClosures(suitId, resourceId) {
  if (window.EKITWI_DEV_MODE) return MOCK_CLOSURES[resourceId] || [];
  return apiGet(`/suits/${suitId}/booking-resources/${resourceId}/closures`);
}

async function createClosure(suitId, resourceId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const closure = { id: 'mock-cl' + Date.now(), ...dto };
    (MOCK_CLOSURES[resourceId] ||= []).push(closure);
    return closure;
  }
  return apiPost(`/suits/${suitId}/booking-resources/${resourceId}/closures`, dto);
}

async function deleteClosure(suitId, resourceId, closureId) {
  if (window.EKITWI_DEV_MODE) {
    const list = MOCK_CLOSURES[resourceId] || [];
    const idx = list.findIndex(c => c.id === closureId);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/booking-resources/${resourceId}/closures/${closureId}`);
}

// ── Bookings ─────────────────────────────────────────────────────────────

async function listBookings(suitId, { status, resourceId, search, skip = 0, take = 20 } = {}) {
  if (window.EKITWI_DEV_MODE) {
    let data = MOCK_BOOKINGS.slice();
    if (status) data = data.filter(b => b.status === status);
    if (resourceId) data = data.filter(b => b.resourceId === resourceId);
    if (search) data = data.filter(b => b.customerName.toLowerCase().includes(search.toLowerCase()));
    data.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    const total = data.length;
    return { data: data.slice(skip, skip + take), pagination: { total } };
  }
  const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
  if (status) qs.set('status', status);
  if (resourceId) qs.set('resourceId', resourceId);
  if (search) qs.set('search', search);
  return apiGet(`/suits/${suitId}/bookings?${qs}`);
}

async function createBooking(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const resource = MOCK_BOOKING_RESOURCES.find(r => r.id === dto.resourceId);
    const quantity = dto.quantity ?? 1;
    const totalPrice = dto.totalPrice ?? (resource ? Number(resource.basePrice) * quantity : 0);
    const booking = {
      ...dto,
      id: 'mock-bk' + Date.now(),
      status: 'pending',
      quantity,
      totalPrice,
      resource: resource ? { id: resource.id, name: resource.name, type: resource.type } : null
    };
    MOCK_BOOKINGS.unshift(booking);
    return booking;
  }
  return apiPost(`/suits/${suitId}/bookings`, dto);
}

async function updateBookingStatus(suitId, bookingId, action) {
  if (window.EKITWI_DEV_MODE) {
    const b = MOCK_BOOKINGS.find(mb => mb.id === bookingId);
    if (!b) throw new Error('Reserva no encontrada');
    if (action === 'confirm')  b.status = 'confirmed';
    if (action === 'complete') b.status = 'completed';
    if (action === 'cancel')   b.status = 'cancelled';
    if (action === 'no_show')  b.status = 'no_show';
    return b;
  }
  return apiPatch(`/suits/${suitId}/bookings/${bookingId}/status`, { action });
}

// One row per suit — GET returns null until the suit has a value set.
async function getDolarPrice(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_DOLAR_PRICE[suitId] || null;
  return apiGet(`/suits/${suitId}/dolar-price`);
}

async function setDolarPrice(suitId, dolarPrice) {
  if (window.EKITWI_DEV_MODE) {
    const entry = { dolarPrice, updatedAt: new Date().toISOString() };
    MOCK_DOLAR_PRICE[suitId] = entry;
    return entry;
  }
  return apiPut(`/suits/${suitId}/dolar-price`, { dolarPrice });
}

// ── Accounting: Saldos en vivo (Caja + Patrimonio Neto derivado) ─────────
// GET /suits/:id/accounting/balances — recalcula siempre desde los asientos
// CONFIRMADOS (los borradores y anulados no mueven saldos). Alimenta los
// indicadores en vivo del panel. El Patrimonio Neto es un valor derivado
// (Activo − Pasivo); no hay un "PN de apertura" declarado a mano. En dev mode
// se calcula el mismo shape desde MOCK_ASIENTOS + MOCK_CUENTAS con la misma
// regla que API/src/saldos/saldos.service.ts.

async function getBalances(suitId, { ejercicioId, hasta } = {}) {
  if (window.EKITWI_DEV_MODE) return computeBalancesFromMocks({ ejercicioId, hasta });
  const qs = new URLSearchParams();
  if (ejercicioId) qs.set('ejercicioId', ejercicioId);
  if (hasta) qs.set('hasta', hasta);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet(`/suits/${suitId}/accounting/balances${suffix}`);
}

function computeBalancesFromMocks({ ejercicioId, hasta }) {
  const cuentas = MOCK_CUENTAS.slice().sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  const asientos = MOCK_ASIENTOS.filter(a =>
    a.estado === 'confirmado' &&
    (!ejercicioId || a.ejercicioId === ejercicioId) &&
    (!hasta || a.fecha <= hasta)
  );

  const mov = {}; // cuentaId -> { debe, haber }
  for (const a of asientos) {
    for (const d of a.detalles) {
      const m = mov[d.cuentaId] || (mov[d.cuentaId] = { debe: 0, haber: 0 });
      m.debe  += Number(d.debe)  || 0;
      m.haber += Number(d.haber) || 0;
    }
  }

  const totales = { activo: 0, pasivo: 0, patrimonioNetoContable: 0, ingresos: 0, egresos: 0, resultadoEjercicio: 0 };
  let caja = 0;

  const cuentasOut = cuentas.map(c => {
    const m = mov[c.id] || { debe: 0, haber: 0 };
    const raw = m.debe - m.haber;
    const saldo = (c.naturaleza === 'DEUDORA') ? raw : -raw;
    if (c.tipo === 'ACTIVO') totales.activo += saldo;
    else if (c.tipo === 'PASIVO') totales.pasivo += saldo;
    else if (c.tipo === 'PATRIMONIO_NETO') totales.patrimonioNetoContable += saldo;
    else if (c.tipo === 'INGRESO') totales.ingresos += saldo;
    else if (c.tipo === 'EGRESO') totales.egresos += saldo;
    if (c.esEfectivo) caja += saldo;
    return { id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza, esEfectivo: !!c.esEfectivo, debe: m.debe, haber: m.haber, saldo };
  });

  totales.resultadoEjercicio = totales.ingresos - totales.egresos;

  return {
    caja,
    patrimonioNeto: totales.activo - totales.pasivo,
    totales,
    cuentas: cuentasOut,
  };
}

// ── Accounting: Cuentas Contables (Plan de Cuentas) ──────────────────────

async function listCuentas(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_CUENTAS.slice();
  return apiGet(`/suits/${suitId}/accounting/accounts`);
}

async function createCuenta(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const cuenta = {
      id: 'mock-cta' + Date.now(), imputable: true, activa: true, parentId: null, esEfectivo: false,
      ...dto,
      naturaleza: NATURALEZA_POR_TIPO[dto.tipo] || 'DEUDORA', // el server la deriva del tipo
    };
    MOCK_CUENTAS.push(cuenta);
    return cuenta;
  }
  return apiPost(`/suits/${suitId}/accounting/accounts`, dto);
}

async function updateCuenta(suitId, cuentaId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const c = MOCK_CUENTAS.find(mc => mc.id === cuentaId);
    if (!c) throw new Error('Cuenta no encontrada');
    Object.assign(c, dto);
    c.naturaleza = NATURALEZA_POR_TIPO[c.tipo] || c.naturaleza; // el server la deriva del tipo
    return c;
  }
  return apiPatch(`/suits/${suitId}/accounting/accounts/${cuentaId}`, dto);
}

async function deleteCuenta(suitId, cuentaId) {
  if (window.EKITWI_DEV_MODE) {
    if (MOCK_CUENTAS.some(c => c.parentId === cuentaId)) throw new Error('No se puede eliminar: tiene cuentas hijas.');
    if (MOCK_ASIENTOS.some(a => a.detalles.some(d => d.cuentaId === cuentaId))) throw new Error('No se puede eliminar: ya tiene asientos imputados.');
    const idx = MOCK_CUENTAS.findIndex(c => c.id === cuentaId);
    if (idx >= 0) MOCK_CUENTAS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/accounting/accounts/${cuentaId}`);
}

// ── Accounting: Ejercicios ────────────────────────────────────────────────

async function listEjercicios(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_EJERCICIOS.slice();
  return apiGet(`/suits/${suitId}/accounting/fiscal-years`);
}

async function createEjercicio(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const overlap = MOCK_EJERCICIOS.some(e => dto.fechaInicio <= e.fechaFin && dto.fechaFin >= e.fechaInicio);
    if (overlap) throw new Error('Las fechas se superponen con otro ejercicio.');
    const ejercicio = { id: 'mock-ej' + Date.now(), estado: 'abierto', ...dto };
    MOCK_EJERCICIOS.push(ejercicio);
    MOCK_PERIODOS[ejercicio.id] = [];
    return ejercicio;
  }
  return apiPost(`/suits/${suitId}/accounting/fiscal-years`, dto);
}

async function updateEjercicio(suitId, ejercicioId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const e = MOCK_EJERCICIOS.find(me => me.id === ejercicioId);
    if (!e) throw new Error('Ejercicio no encontrado');
    if (e.estado === 'cerrado') throw new Error('No se puede editar un ejercicio cerrado.');
    Object.assign(e, dto);
    return e;
  }
  return apiPatch(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}`, dto);
}

// action: 'cerrar' | 'reabrir' — cerrar exige que todos los períodos del
// ejercicio estén cerrados primero (misma regla que ejercicios.service.ts).
async function changeEjercicioStatus(suitId, ejercicioId, action) {
  if (window.EKITWI_DEV_MODE) {
    const e = MOCK_EJERCICIOS.find(me => me.id === ejercicioId);
    if (!e) throw new Error('Ejercicio no encontrado');
    if (action === 'cerrar') {
      const periodos = MOCK_PERIODOS[ejercicioId] || [];
      if (periodos.some(p => p.estado === 'abierto')) throw new Error('Hace falta que todos sus períodos estén cerrados.');
      e.estado = 'cerrado';
    } else {
      e.estado = 'abierto';
    }
    return e;
  }
  return apiPatch(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}/status`, { action });
}

async function deleteEjercicio(suitId, ejercicioId) {
  if (window.EKITWI_DEV_MODE) {
    if (MOCK_ASIENTOS.some(a => a.ejercicioId === ejercicioId)) throw new Error('No se puede eliminar: ya tiene asientos registrados.');
    const idx = MOCK_EJERCICIOS.findIndex(e => e.id === ejercicioId);
    if (idx >= 0) MOCK_EJERCICIOS.splice(idx, 1);
    delete MOCK_PERIODOS[ejercicioId];
    return;
  }
  return apiDelete(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}`);
}

// ── Accounting: Períodos (anidados bajo un Ejercicio) ────────────────────

async function listPeriodos(suitId, ejercicioId) {
  if (window.EKITWI_DEV_MODE) return (MOCK_PERIODOS[ejercicioId] || []).slice();
  return apiGet(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}/periods`);
}

async function createPeriodo(suitId, ejercicioId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const ejercicio = MOCK_EJERCICIOS.find(e => e.id === ejercicioId);
    if (!ejercicio || ejercicio.estado !== 'abierto') throw new Error('El ejercicio no está abierto.');
    const periodos = MOCK_PERIODOS[ejercicioId] ||= [];
    const overlap = periodos.some(p => dto.fechaInicio <= p.fechaFin && dto.fechaFin >= p.fechaInicio);
    if (overlap) throw new Error('Las fechas se superponen con otro período de este ejercicio.');
    const periodo = { id: 'mock-per' + Date.now(), ejercicioId, estado: 'abierto', ...dto };
    periodos.push(periodo);
    return periodo;
  }
  return apiPost(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}/periods`, dto);
}

async function updatePeriodo(suitId, ejercicioId, periodoId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const p = (MOCK_PERIODOS[ejercicioId] || []).find(mp => mp.id === periodoId);
    if (!p) throw new Error('Período no encontrado');
    Object.assign(p, dto);
    return p;
  }
  return apiPatch(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}/periods/${periodoId}`, dto);
}

// action: 'cerrar' | 'reabrir' — reabrir exige que el ejercicio siga abierto.
async function changePeriodoStatus(suitId, ejercicioId, periodoId, action) {
  if (window.EKITWI_DEV_MODE) {
    const ejercicio = MOCK_EJERCICIOS.find(e => e.id === ejercicioId);
    const p = (MOCK_PERIODOS[ejercicioId] || []).find(mp => mp.id === periodoId);
    if (!p) throw new Error('Período no encontrado');
    if (action === 'reabrir' && ejercicio?.estado !== 'abierto') throw new Error('El ejercicio tiene que estar abierto para reabrir un período.');
    p.estado = action === 'cerrar' ? 'cerrado' : 'abierto';
    return p;
  }
  return apiPatch(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}/periods/${periodoId}/status`, { action });
}

async function deletePeriodo(suitId, ejercicioId, periodoId) {
  if (window.EKITWI_DEV_MODE) {
    if (MOCK_ASIENTOS.some(a => a.periodoId === periodoId)) throw new Error('No se puede eliminar: ya tiene asientos registrados.');
    const periodos = MOCK_PERIODOS[ejercicioId] || [];
    const idx = periodos.findIndex(p => p.id === periodoId);
    if (idx >= 0) periodos.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/accounting/fiscal-years/${ejercicioId}/periods/${periodoId}`);
}

// ── Accounting: Centros de Costo ──────────────────────────────────────────

async function listCentros(suitId) {
  if (window.EKITWI_DEV_MODE) return MOCK_CENTROS.slice();
  return apiGet(`/suits/${suitId}/accounting/cost-centers`);
}

async function createCentro(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const centro = { id: 'mock-cco' + Date.now(), activo: true, ...dto };
    MOCK_CENTROS.push(centro);
    return centro;
  }
  return apiPost(`/suits/${suitId}/accounting/cost-centers`, dto);
}

async function updateCentro(suitId, centroId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const c = MOCK_CENTROS.find(mc => mc.id === centroId);
    if (!c) throw new Error('Centro de costo no encontrado');
    Object.assign(c, dto);
    return c;
  }
  return apiPatch(`/suits/${suitId}/accounting/cost-centers/${centroId}`, dto);
}

async function deleteCentro(suitId, centroId) {
  if (window.EKITWI_DEV_MODE) {
    if (MOCK_ASIENTOS.some(a => a.detalles.some(d => d.centroCostoId === centroId))) throw new Error('No se puede eliminar: ya tiene asientos imputados.');
    const idx = MOCK_CENTROS.findIndex(c => c.id === centroId);
    if (idx >= 0) MOCK_CENTROS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/accounting/cost-centers/${centroId}`);
}

// ── Accounting: Asientos (Libro Diario) ───────────────────────────────────
// Partida doble validada acá también (además de en el backend real) para
// que el preview en dev mode se comporte igual — misma regla que
// asientos.service.ts validateBalance().

async function listAsientos(suitId, { ejercicioId, periodoId, estado, desde, hasta, cuentaId, comprobante, skip = 0, take = 20 } = {}) {
  if (window.EKITWI_DEV_MODE) {
    let data = MOCK_ASIENTOS.slice();
    if (ejercicioId) data = data.filter(a => a.ejercicioId === ejercicioId);
    if (periodoId) data = data.filter(a => a.periodoId === periodoId);
    if (estado) data = data.filter(a => a.estado === estado);
    if (desde) data = data.filter(a => a.fecha >= desde);
    if (hasta) data = data.filter(a => a.fecha <= hasta);
    if (cuentaId) data = data.filter(a => a.detalles.some(d => d.cuentaId === cuentaId));
    if (comprobante) data = data.filter(a => (a.comprobante || '').toLowerCase().includes(comprobante.toLowerCase()));
    data.sort((a, b) => new Date(b.fecha) - new Date(a.fecha) || b.numero - a.numero);
    const total = data.length;
    return { data: data.slice(skip, skip + take), pagination: { skip, take, total, pages: Math.ceil(total / take) } };
  }
  const qs = new URLSearchParams({ skip: String(skip), take: String(take) });
  if (ejercicioId) qs.set('ejercicioId', ejercicioId);
  if (periodoId) qs.set('periodoId', periodoId);
  if (estado) qs.set('estado', estado);
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  if (cuentaId) qs.set('cuentaId', cuentaId);
  if (comprobante) qs.set('comprobante', comprobante);
  return apiGet(`/suits/${suitId}/accounting/journal-entries?${qs}`);
}

// ── Accounting: Libro Mayor de una cuenta ────────────────────────────────
async function getMayor(suitId, { cuentaId, ejercicioId, desde, hasta } = {}) {
  if (window.EKITWI_DEV_MODE) return computeMayorFromMocks({ cuentaId, ejercicioId, desde, hasta });
  const qs = new URLSearchParams({ cuentaId });
  if (ejercicioId) qs.set('ejercicioId', ejercicioId);
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  return apiGet(`/suits/${suitId}/accounting/ledger?${qs}`);
}

function computeMayorFromMocks({ cuentaId, ejercicioId, desde, hasta }) {
  const cuenta = MOCK_CUENTAS.find(c => c.id === cuentaId);
  if (!cuenta) throw new Error('Cuenta no encontrada');
  const adj = (debe, haber) => (cuenta.naturaleza === 'DEUDORA' ? debe - haber : haber - debe);

  const confirmados = MOCK_ASIENTOS
    .filter(a => a.estado === 'confirmado' && (!ejercicioId || a.ejercicioId === ejercicioId))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero);

  let saldoInicial = 0;
  if (desde) {
    for (const a of confirmados.filter(a => a.fecha < desde)) {
      for (const d of a.detalles.filter(d => d.cuentaId === cuentaId)) saldoInicial += adj(Number(d.debe) || 0, Number(d.haber) || 0);
    }
  }

  let corrido = saldoInicial, totalDebe = 0, totalHaber = 0;
  const movimientos = [];
  for (const a of confirmados) {
    if (desde && a.fecha < desde) continue;
    if (hasta && a.fecha > hasta) continue;
    for (const d of a.detalles.filter(d => d.cuentaId === cuentaId)) {
      const debe = Number(d.debe) || 0, haber = Number(d.haber) || 0;
      corrido += adj(debe, haber);
      totalDebe += debe; totalHaber += haber;
      movimientos.push({ asientoId: a.id, numero: a.numero, fecha: a.fecha, descripcion: a.descripcion, comprobante: a.comprobante || null, debe, haber, saldo: corrido });
    }
  }

  return {
    cuenta: { id: cuenta.id, codigo: cuenta.codigo, nombre: cuenta.nombre, tipo: cuenta.tipo, naturaleza: cuenta.naturaleza },
    saldoInicial, movimientos, totales: { debe: totalDebe, haber: totalHaber }, saldoFinal: corrido,
  };
}

async function createAsiento(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    let totalDebe = 0, totalHaber = 0;
    for (const linea of dto.detalles) {
      const debe = linea.debe || 0, haber = linea.haber || 0;
      if ((debe > 0) === (haber > 0)) throw new Error('Cada línea debe tener un importe en el debe o en el haber (no ambos, no ninguno).');
      totalDebe += debe; totalHaber += haber;
    }
    if (Math.abs(totalDebe - totalHaber) >= 0.005) throw new Error(`El asiento no está balanceado: debe ${totalDebe} ≠ haber ${totalHaber}`);

    const fecha = dto.fecha;
    const periodo = Object.values(MOCK_PERIODOS).flat().find(p => p.fechaInicio <= fecha && p.fechaFin >= fecha);
    if (!periodo) throw new Error('No hay un período contable que contenga esa fecha. Creá el ejercicio/período correspondiente primero.');
    const ejercicio = MOCK_EJERCICIOS.find(e => e.id === periodo.ejercicioId);
    if (periodo.estado !== 'abierto' || ejercicio?.estado !== 'abierto') throw new Error(`El período "${periodo.nombre}" está cerrado.`);

    for (const linea of dto.detalles) {
      const cuenta = MOCK_CUENTAS.find(c => c.id === linea.cuentaId);
      if (!cuenta) throw new Error(`Cuenta contable ${linea.cuentaId} no encontrada`);
      if (!cuenta.imputable) throw new Error(`La cuenta "${cuenta.nombre}" es de agrupamiento, no admite asientos directos`);
      if (!cuenta.activa) throw new Error(`La cuenta "${cuenta.nombre}" está inactiva`);
    }

    const numero = Math.max(0, ...MOCK_ASIENTOS.filter(a => a.ejercicioId === periodo.ejercicioId).map(a => a.numero)) + 1;
    const asiento = {
      id: 'mock-as' + Date.now(),
      ejercicioId: periodo.ejercicioId,
      periodoId: periodo.id,
      numero,
      fecha: dto.fecha,
      descripcion: dto.descripcion,
      comprobante: dto.comprobante || null,
      estado: 'borrador',
      confirmadoAt: null,
      anuladoAt: null,
      detalles: dto.detalles.map((linea, idx) => ({
        cuentaId: linea.cuentaId,
        centroCostoId: linea.centroCostoId || null,
        debe: linea.debe || 0,
        haber: linea.haber || 0,
        descripcion: linea.descripcion || null,
        orden: idx,
        cuenta: MOCK_CUENTAS.find(c => c.id === linea.cuentaId),
        centroCosto: linea.centroCostoId ? MOCK_CENTROS.find(c => c.id === linea.centroCostoId) : null
      }))
    };
    MOCK_ASIENTOS.unshift(asiento);
    return asiento;
  }
  return apiPost(`/suits/${suitId}/accounting/journal-entries`, dto);
}

// action: 'confirmar' | 'anular'
async function changeAsientoStatus(suitId, asientoId, action) {
  if (window.EKITWI_DEV_MODE) {
    const a = MOCK_ASIENTOS.find(ma => ma.id === asientoId);
    if (!a) throw new Error('Asiento no encontrado');
    if (action === 'confirmar') {
      if (a.estado !== 'borrador') throw new Error('Solo se pueden confirmar asientos en estado "borrador".');
      const periodo = (MOCK_PERIODOS[a.ejercicioId] || []).find(p => p.id === a.periodoId);
      const ejercicio = MOCK_EJERCICIOS.find(e => e.id === a.ejercicioId);
      if (!periodo || periodo.estado !== 'abierto' || ejercicio?.estado !== 'abierto') throw new Error('El período de este asiento ya no está abierto.');
      a.estado = 'confirmado';
      a.confirmadoAt = new Date().toISOString();
    } else {
      if (a.estado !== 'confirmado') throw new Error('Solo se pueden anular asientos en estado "confirmado".');
      a.estado = 'anulado';
      a.anuladoAt = new Date().toISOString();
    }
    return a;
  }
  return apiPatch(`/suits/${suitId}/accounting/journal-entries/${asientoId}/status`, { action });
}

async function deleteAsiento(suitId, asientoId) {
  if (window.EKITWI_DEV_MODE) {
    const a = MOCK_ASIENTOS.find(ma => ma.id === asientoId);
    if (!a) throw new Error('Asiento no encontrado');
    if (a.estado !== 'borrador') throw new Error('Solo se pueden eliminar asientos en estado "borrador". Un asiento confirmado se anula, no se borra.');
    const idx = MOCK_ASIENTOS.findIndex(ma => ma.id === asientoId);
    if (idx >= 0) MOCK_ASIENTOS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/accounting/journal-entries/${asientoId}`);
}

// ── Projects (SCRUM + Ideas + Plans) ────────────────────────────────────
// Suit-scoped como el resto de esta capa (/suits/:suitId/scrum/...) — ver
// [[project_suit_team_permissions]], antes era por usuario (createdById).

async function listProjects(suitId) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_PROJECTS.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return apiGet(`/suits/${suitId}/scrum/projects`);
}

async function getProject(suitId, projectId) {
  if (window.EKITWI_DEV_MODE) {
    const p = MOCK_PROJECTS.find(mp => mp.id === projectId);
    if (!p) throw new Error('Proyecto no encontrado');
    return p;
  }
  return apiGet(`/suits/${suitId}/scrum/projects/${projectId}`);
}

async function getProjectMetrics(suitId, projectId) {
  if (window.EKITWI_DEV_MODE) {
    const sprints = MOCK_SPRINTS.filter(s => s.projectId === projectId);
    const linksBySprint = sprintId => MOCK_SPRINT_STORIES.filter(ss => ss.sprintId === sprintId);
    const pointsOf = storyId => (MOCK_STORIES.find(s => s.id === storyId) || {}).points || 0;

    const velocity = sprints.filter(s => s.status === 'completed').map(s => {
      const links = linksBySprint(s.id);
      return {
        sprintId: s.id,
        name: s.name,
        completedAt: s.completedAt,
        committedPoints: links.reduce((sum, l) => sum + pointsOf(l.storyId), 0),
        completedPoints: links.filter(l => l.boardStatus === 'done').reduce((sum, l) => sum + pointsOf(l.storyId), 0)
      };
    });

    const active = sprints.find(s => s.status === 'active');
    let activeSprint = null;
    if (active) {
      const links = linksBySprint(active.id);
      const totalPoints = links.reduce((sum, l) => sum + pointsOf(l.storyId), 0);
      const donePoints = links.filter(l => l.boardStatus === 'done').reduce((sum, l) => sum + pointsOf(l.storyId), 0);
      const byStatus = { todo: 0, 'in-progress': 0, review: 0, done: 0 };
      links.forEach(l => { byStatus[l.boardStatus] = (byStatus[l.boardStatus] || 0) + pointsOf(l.storyId); });
      activeSprint = {
        sprintId: active.id, name: active.name, startDate: active.startDate, endDate: active.endDate,
        totalPoints, donePoints, pctDone: totalPoints ? Math.round(donePoints / totalPoints * 100) : 0,
        byStatus, byAssignee: []
      };
    }
    return { velocity, activeSprint };
  }
  return apiGet(`/suits/${suitId}/scrum/projects/${projectId}/metrics`);
}

async function createProject(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const project = {
      id: 'mock-proj' + Date.now(),
      name: dto.name,
      description: dto.description || null,
      color: dto.color || PROJECT_COLORS[0],
      createdAt: new Date().toISOString(),
      _count: { stories: 0, sprints: 0 }
    };
    MOCK_PROJECTS.unshift(project);
    return project;
  }
  return apiPost(`/suits/${suitId}/scrum/projects`, dto);
}

async function updateProject(suitId, projectId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const p = MOCK_PROJECTS.find(mp => mp.id === projectId);
    if (!p) throw new Error('Proyecto no encontrado');
    Object.assign(p, dto);
    return p;
  }
  return apiPut(`/suits/${suitId}/scrum/projects/${projectId}`, dto);
}

async function deleteProject(suitId, projectId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_PROJECTS.findIndex(p => p.id === projectId);
    if (idx >= 0) MOCK_PROJECTS.splice(idx, 1);
    const sprintIds = MOCK_SPRINTS.filter(s => s.projectId === projectId).map(s => s.id);
    for (let i = MOCK_SPRINT_STORIES.length - 1; i >= 0; i--) {
      if (sprintIds.includes(MOCK_SPRINT_STORIES[i].sprintId)) MOCK_SPRINT_STORIES.splice(i, 1);
    }
    for (let i = MOCK_SPRINTS.length - 1; i >= 0; i--) {
      if (MOCK_SPRINTS[i].projectId === projectId) MOCK_SPRINTS.splice(i, 1);
    }
    for (let i = MOCK_STORIES.length - 1; i >= 0; i--) {
      if (MOCK_STORIES[i].projectId === projectId) MOCK_STORIES.splice(i, 1);
    }
    return;
  }
  return apiDelete(`/suits/${suitId}/scrum/projects/${projectId}`);
}

async function listStories(suitId, projectId) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_STORIES.filter(s => s.projectId === projectId)
      .slice().sort((a, b) => a.order - b.order || new Date(a.createdAt) - new Date(b.createdAt));
  }
  return apiGet(`/suits/${suitId}/scrum/stories?project_id=${projectId}`);
}

async function createStory(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const siblings = MOCK_STORIES.filter(s => s.projectId === dto.projectId);
    const story = {
      id: 'mock-st' + Date.now(),
      projectId: dto.projectId,
      title: dto.title,
      priority: dto.priority || 'medium',
      points: dto.points ?? 1,
      status: 'backlog',
      order: siblings.length,
      assignedToId: dto.assignedToId || null,
      assignedTo: null, // dev mode: sin catálogo mock de miembros del suit
      createdAt: new Date().toISOString()
    };
    MOCK_STORIES.push(story);
    const project = MOCK_PROJECTS.find(p => p.id === dto.projectId);
    if (project) project._count.stories++;
    return story;
  }
  return apiPost(`/suits/${suitId}/scrum/stories`, dto);
}

async function updateStory(suitId, storyId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_STORIES.find(ms => ms.id === storyId);
    if (!s) throw new Error('Historia no encontrada');
    Object.assign(s, dto);
    if (dto.assignedToId !== undefined) s.assignedTo = null; // dev mode: sin catálogo mock de miembros del suit
    return s;
  }
  return apiPut(`/suits/${suitId}/scrum/stories/${storyId}`, dto);
}

async function deleteStory(suitId, storyId) {
  if (window.EKITWI_DEV_MODE) {
    const story = MOCK_STORIES.find(s => s.id === storyId);
    const idx = MOCK_STORIES.findIndex(s => s.id === storyId);
    if (idx >= 0) MOCK_STORIES.splice(idx, 1);
    for (let i = MOCK_SPRINT_STORIES.length - 1; i >= 0; i--) {
      if (MOCK_SPRINT_STORIES[i].storyId === storyId) MOCK_SPRINT_STORIES.splice(i, 1);
    }
    if (story) {
      const project = MOCK_PROJECTS.find(p => p.id === story.projectId);
      if (project) project._count.stories--;
    }
    return;
  }
  return apiDelete(`/suits/${suitId}/scrum/stories/${storyId}`);
}

async function listSprints(suitId, projectId) {
  if (window.EKITWI_DEV_MODE) {
    const order = { active: 0, planned: 1, completed: 2 };
    return MOCK_SPRINTS.filter(s => s.projectId === projectId)
      .slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  }
  return apiGet(`/suits/${suitId}/scrum/sprints?project_id=${projectId}`);
}

async function createSprint(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const sprint = {
      id: 'mock-sp' + Date.now(),
      projectId: dto.projectId,
      name: dto.name,
      goal: dto.goal || null,
      startDate: dto.startDate || null,
      endDate: dto.endDate || null,
      status: 'planned',
      createdAt: new Date().toISOString(),
      completedAt: null
    };
    MOCK_SPRINTS.push(sprint);
    const project = MOCK_PROJECTS.find(p => p.id === dto.projectId);
    if (project) project._count.sprints++;
    return sprint;
  }
  return apiPost(`/suits/${suitId}/scrum/sprints`, dto);
}

async function updateSprint(suitId, sprintId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const s = MOCK_SPRINTS.find(ms => ms.id === sprintId);
    if (!s) throw new Error('Sprint no encontrado');
    Object.assign(s, dto);
    return s;
  }
  return apiPut(`/suits/${suitId}/scrum/sprints/${sprintId}`, dto);
}

// Misma lógica que sprints.service.ts changeStatus(): "activate" y "reopen"
// rechazan si ya hay otro sprint activo en el proyecto; "complete" manda las
// historias 'done' a status done y el resto vuelve a 'backlog'; "reopen"
// manda las historias del sprint de vuelta a 'in-sprint'.
async function changeSprintStatus(suitId, sprintId, action) {
  if (window.EKITWI_DEV_MODE) {
    const sprint = MOCK_SPRINTS.find(s => s.id === sprintId);
    if (!sprint) throw new Error('Sprint no encontrado');
    const hasActive = MOCK_SPRINTS.some(s => s.projectId === sprint.projectId && s.status === 'active' && s.id !== sprintId);

    if (action === 'activate') {
      if (sprint.status !== 'planned') throw new Error('Solo se pueden activar sprints en estado "planned".');
      if (hasActive) throw new Error('Ya existe un sprint activo para este proyecto.');
      sprint.status = 'active';
    } else if (action === 'reopen') {
      if (sprint.status !== 'completed') throw new Error('Solo se pueden reabrir sprints en estado "completed".');
      if (hasActive) throw new Error('Ya existe un sprint activo para este proyecto. Completalo antes de reabrir este.');
      MOCK_SPRINT_STORIES.filter(ss => ss.sprintId === sprintId).forEach(ss => {
        const story = MOCK_STORIES.find(s => s.id === ss.storyId);
        if (story) story.status = 'in-sprint';
      });
      sprint.status = 'active';
      sprint.completedAt = null;
    } else {
      if (sprint.status !== 'active') throw new Error('Solo se pueden completar sprints en estado "active".');
      MOCK_SPRINT_STORIES.filter(ss => ss.sprintId === sprintId).forEach(ss => {
        const story = MOCK_STORIES.find(s => s.id === ss.storyId);
        if (story) story.status = ss.boardStatus === 'done' ? 'done' : 'backlog';
      });
      sprint.status = 'completed';
      sprint.completedAt = new Date().toISOString();
    }
    return sprint;
  }
  return apiPatch(`/suits/${suitId}/scrum/sprints/${sprintId}`, { action });
}

async function deleteSprint(suitId, sprintId) {
  if (window.EKITWI_DEV_MODE) {
    const sprint = MOCK_SPRINTS.find(s => s.id === sprintId);
    MOCK_SPRINT_STORIES.filter(ss => ss.sprintId === sprintId).forEach(ss => {
      const story = MOCK_STORIES.find(s => s.id === ss.storyId);
      if (story) story.status = 'backlog';
    });
    for (let i = MOCK_SPRINT_STORIES.length - 1; i >= 0; i--) {
      if (MOCK_SPRINT_STORIES[i].sprintId === sprintId) MOCK_SPRINT_STORIES.splice(i, 1);
    }
    const idx = MOCK_SPRINTS.findIndex(s => s.id === sprintId);
    if (idx >= 0) MOCK_SPRINTS.splice(idx, 1);
    if (sprint) {
      const project = MOCK_PROJECTS.find(p => p.id === sprint.projectId);
      if (project) project._count.sprints--;
    }
    return;
  }
  return apiDelete(`/suits/${suitId}/scrum/sprints/${sprintId}`);
}

// Devuelve los links sprint-story ya joineados con título/prioridad/puntos/
// asignado de la historia, igual que sprint-stories.service.ts en el backend real.
async function listSprintStoriesByProject(suitId, projectId) {
  if (window.EKITWI_DEV_MODE) {
    const sprintIds = MOCK_SPRINTS.filter(s => s.projectId === projectId).map(s => s.id);
    return MOCK_SPRINT_STORIES.filter(ss => sprintIds.includes(ss.sprintId)).map(joinSprintStory);
  }
  return apiGet(`/suits/${suitId}/scrum/sprint-stories?project_id=${projectId}`);
}

function joinSprintStory(ss) {
  const story = MOCK_STORIES.find(s => s.id === ss.storyId);
  return {
    storyId: ss.storyId,
    sprintId: ss.sprintId,
    title: story ? story.title : '',
    priority: story ? story.priority : 'medium',
    points: story ? story.points : 0,
    order: story ? story.order : 0,
    boardStatus: ss.boardStatus,
    addedAt: ss.addedAt,
    assignedTo: story ? story.assignedTo || null : null
  };
}

async function addStoryToSprint(suitId, sprintId, storyId) {
  if (window.EKITWI_DEV_MODE) {
    const existing = MOCK_SPRINT_STORIES.find(ss => ss.sprintId === sprintId && ss.storyId === storyId);
    if (!existing) {
      MOCK_SPRINT_STORIES.push({ sprintId, storyId, boardStatus: 'todo', addedAt: new Date().toISOString() });
      const story = MOCK_STORIES.find(s => s.id === storyId);
      if (story) story.status = 'in-sprint';
    }
    return;
  }
  return apiPost(`/suits/${suitId}/scrum/sprint-stories`, { sprintId, storyId });
}

async function updateBoardStatus(suitId, sprintId, storyId, boardStatus) {
  if (window.EKITWI_DEV_MODE) {
    const link = MOCK_SPRINT_STORIES.find(ss => ss.sprintId === sprintId && ss.storyId === storyId);
    if (!link) throw new Error('La historia no está en este sprint');
    link.boardStatus = boardStatus;
    return;
  }
  return apiPatch(`/suits/${suitId}/scrum/sprint-stories`, { sprintId, storyId, boardStatus });
}

async function removeStoryFromSprint(suitId, sprintId, storyId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_SPRINT_STORIES.findIndex(ss => ss.sprintId === sprintId && ss.storyId === storyId);
    if (idx >= 0) MOCK_SPRINT_STORIES.splice(idx, 1);
    const story = MOCK_STORIES.find(s => s.id === storyId);
    if (story) story.status = 'backlog';
    return;
  }
  return apiDelete(`/suits/${suitId}/scrum/sprint-stories?sprint_id=${sprintId}&story_id=${storyId}`);
}

// ── Ideas ────────────────────────────────────────────────────────────────

async function listIdeas(suitId) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_IDEAS.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return apiGet(`/suits/${suitId}/scrum/ideas`);
}

async function createIdea(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const idea = {
      id: 'mock-idea' + Date.now(),
      title: dto.title,
      notes: dto.notes || null,
      tags: dto.tags || null,
      status: dto.status || 'new',
      createdAt: new Date().toISOString()
    };
    MOCK_IDEAS.unshift(idea);
    return idea;
  }
  return apiPost(`/suits/${suitId}/scrum/ideas`, dto);
}

async function updateIdea(suitId, ideaId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const idea = MOCK_IDEAS.find(i => i.id === ideaId);
    if (!idea) throw new Error('Idea no encontrada');
    Object.assign(idea, dto);
    return idea;
  }
  return apiPut(`/suits/${suitId}/scrum/ideas/${ideaId}`, dto);
}

async function deleteIdea(suitId, ideaId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_IDEAS.findIndex(i => i.id === ideaId);
    if (idx >= 0) MOCK_IDEAS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/scrum/ideas/${ideaId}`);
}

// ── Plans ────────────────────────────────────────────────────────────────

async function listPlans(suitId) {
  if (window.EKITWI_DEV_MODE) {
    return MOCK_PLANS.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return apiGet(`/suits/${suitId}/scrum/plans`);
}

async function createPlan(suitId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const plan = {
      id: 'mock-plan' + Date.now(),
      objective: dto.objective,
      notes: dto.notes || null,
      targetDate: dto.targetDate || null,
      status: dto.status || 'draft',
      createdAt: new Date().toISOString()
    };
    MOCK_PLANS.unshift(plan);
    return plan;
  }
  return apiPost(`/suits/${suitId}/scrum/plans`, dto);
}

async function updatePlan(suitId, planId, dto) {
  if (window.EKITWI_DEV_MODE) {
    const plan = MOCK_PLANS.find(p => p.id === planId);
    if (!plan) throw new Error('Plan no encontrado');
    Object.assign(plan, dto);
    return plan;
  }
  return apiPut(`/suits/${suitId}/scrum/plans/${planId}`, dto);
}

async function deletePlan(suitId, planId) {
  if (window.EKITWI_DEV_MODE) {
    const idx = MOCK_PLANS.findIndex(p => p.id === planId);
    if (idx >= 0) MOCK_PLANS.splice(idx, 1);
    return;
  }
  return apiDelete(`/suits/${suitId}/scrum/plans/${planId}`);
}

// ── AI Assistant ─────────────────────────────────────────────────────────
// En dev mode no hay Ollama disponible, así que se simula una conversación
// mínima en memoria — alcanza para probar la UI del chat (burbujas, acción
// pendiente de confirmación) sin backend ni modelo levantados.

const MOCK_ASSISTANT_MESSAGES = [];

async function startAssistantConversation(suitId) {
  if (window.EKITWI_DEV_MODE) {
    MOCK_ASSISTANT_MESSAGES.length = 0;
    return { id: 'mock-conv' };
  }
  return apiPost(`/suits/${suitId}/assistant/conversations`);
}

async function listAssistantMessages(suitId, conversationId) {
  if (window.EKITWI_DEV_MODE) return MOCK_ASSISTANT_MESSAGES.slice();
  return apiGet(`/suits/${suitId}/assistant/conversations/${conversationId}/messages`);
}

async function sendAssistantMessage(suitId, conversationId, content) {
  if (window.EKITWI_DEV_MODE) {
    MOCK_ASSISTANT_MESSAGES.push({ id: 'mock-msg' + Date.now(), role: 'user', content, status: 'done' });
    const reply = mockAssistantReply(content);
    MOCK_ASSISTANT_MESSAGES.push(reply);
    return reply;
  }
  return apiPost(`/suits/${suitId}/assistant/conversations/${conversationId}/messages`, { content });
}

async function confirmAssistantAction(suitId, conversationId, messageId) {
  if (window.EKITWI_DEV_MODE) {
    const pending = MOCK_ASSISTANT_MESSAGES.find(m => m.id === messageId);
    if (pending) pending.status = 'done';
    const reply = { id: 'mock-msg' + Date.now(), role: 'assistant', content: 'Listo, lo hice (simulado en modo desarrollo).', status: 'done' };
    MOCK_ASSISTANT_MESSAGES.push(reply);
    return reply;
  }
  return apiPost(`/suits/${suitId}/assistant/conversations/${conversationId}/messages/${messageId}/confirm`);
}

async function cancelAssistantAction(suitId, conversationId, messageId) {
  if (window.EKITWI_DEV_MODE) {
    const pending = MOCK_ASSISTANT_MESSAGES.find(m => m.id === messageId);
    if (pending) pending.status = 'cancelled';
    return pending;
  }
  return apiPost(`/suits/${suitId}/assistant/conversations/${conversationId}/messages/${messageId}/cancel`);
}

// Respuesta simulada muy simple, solo para poder probar la UI del chat sin
// Ollama levantado: cubre una consulta de ejemplo (stock) y una acción de
// ejemplo con confirmación pendiente (crear producto).
function mockAssistantReply(content) {
  const lower = content.toLowerCase();

  if (lower.includes('stock')) {
    const bajo = MOCK_PRODUCTS.filter(p => p.minStock != null && p.stock <= p.minStock);
    const text = bajo.length
      ? `Productos con stock bajo: ${bajo.map(p => `${p.name} (${p.stock})`).join(', ')}.`
      : 'No hay productos con stock bajo el mínimo ahora mismo.';
    return { id: 'mock-msg' + Date.now(), role: 'assistant', content: text, status: 'done' };
  }

  if (lower.includes('crear') && lower.includes('producto')) {
    return {
      id: 'mock-msg' + Date.now(),
      role: 'assistant',
      content: '¿Confirmás crear un producto de ejemplo llamado "Producto de prueba"?',
      toolName: 'create_product',
      toolArgs: { name: 'Producto de prueba', slug: 'producto-de-prueba', description: 'Creado desde el asistente (modo desarrollo)', price: 100 },
      status: 'pending_confirmation'
    };
  }

  return {
    id: 'mock-msg' + Date.now(),
    role: 'assistant',
    content: '(Modo desarrollo) Todavía no tengo una respuesta simulada para eso — probá preguntando por "stock" o pedime "crear un producto".',
    status: 'done'
  };
}
