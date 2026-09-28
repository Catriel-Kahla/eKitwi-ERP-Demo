/**
 * purchaseOrdersVue.js
 * Vue island de "Pedidos a Proveedores" (feature `purchase_orders`, dentro
 * del panel Inventory — ver dashboard.html #inventory-purchaseorders-view).
 * Mismo patrón que commerceVue.js: singleton montado una vez, `currentView`
 * alterna list/detail dentro de un único template inline, sin vue-router.
 *
 * Merge con SEC POS (ver plan de merge): ciclo draft -> sent ->
 * partially_received/received -> (cancelled solo antes de estar recibido
 * del todo). "Enviar" es el paso de aprobación, gateado por permiso de
 * escritura en la sección 'purchase_orders'; "Recibir" es una sección de
 * permisos aparte ('receiving', Fase 2) — un rol puede tener una habilitada
 * sin la otra. Todo vía ekCan(), no un chequeo de rol hardcodeado.
 *
 * enterPurchaseOrders() es referenciada por nombre desde FEATURE_ENTRY
 * (dashboard.js) e inv-enter-purchaseorders (inventory.js) — ambos caminos
 * para entrar a esta sub-vista desde Inventory.
 */

'use strict';

const PurchaseOrdersApp = {
  data() {
    return {
      suitId: null,
      suitName: '',
      currentView: 'list', // 'list' | 'detail'

      orders: { status: 'idle', data: [], error: null },
      statusFilter: '',

      suppliers: [],
      branches: [],
      productResults: [],
      productSearch: '',

      editing: null, // pedido en edición (null = uno nuevo)
      form: { supplierId: '', branchId: '', notes: '', items: [] },
      saving: false,

      receiveModal: { open: false, po: null, lines: [], notes: '', saving: false },
    };
  },
  computed: {
    canWrite() { return ekCan('purchase_orders', 'write'); },
    canReceive() { return ekCan('receiving', 'write'); },
    filteredOrders() {
      if (!this.statusFilter) return this.orders.data;
      return this.orders.data.filter(po => po.status === this.statusFilter);
    },
    formTotal() {
      if (this.form.items.some(it => it.unitCost === null)) return null;
      return this.form.items.reduce((sum, it) => sum + (Number(it.unitCost) || 0) * (Number(it.quantity) || 0), 0);
    },
    formQtyTotal() {
      return this.form.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    },
  },
  methods: {
    esc, fmtMoney, ekCan,

    async setSuit(suitId, suitName) {
      this.suitId = suitId;
      this.suitName = suitName;
      this.currentView = 'list';
      await this.refreshOrders();
    },

    enterList() {
      this.currentView = 'list';
      this.refreshOrders();
    },

    goBack() {
      if (this.currentView === 'detail') this.enterList();
      else goToDashboard();
    },

    async refreshOrders() {
      if (!this.suitId) return;
      this.orders.status = 'loading';
      try {
        this.orders.data = await listPurchaseOrders(this.suitId);
        this.orders.status = 'idle';
      } catch (err) {
        this.orders.status = 'error';
        this.orders.error = err.message;
      }
    },

    // Fase 4: unitCost llega en null cuando el rol no tiene permiso de
    // escritura en 'purchase_orders' (ver PurchaseOrdersService.redactCost) —
    // sin costo no se puede calcular el total, se muestra "—" en su lugar.
    orderTotal(po) {
      if ((po.items || []).some(it => it.unitCost === null)) return null;
      return (po.items || []).reduce((sum, it) => sum + Number(it.unitCost) * it.quantity, 0);
    },
    costLabel(value) {
      return value === null ? '—' : fmtMoney(value);
    },

    statusBadge(status) {
      return {
        draft: 'badge-yellow', sent: 'badge-blue', partially_received: 'badge-purple',
        received: 'badge-green', cancelled: 'badge-red',
      }[status] || 'badge-gray';
    },
    statusLabel(status) {
      return {
        draft: 'Borrador', sent: 'Enviado', partially_received: 'Recibido parcial',
        received: 'Recibido', cancelled: 'Cancelado',
      }[status] || status;
    },
    canCancel(po) {
      return ['draft', 'sent', 'partially_received'].includes(po.status);
    },
    canReceiveOrder(po) {
      return ['sent', 'partially_received'].includes(po.status);
    },
    pendingQty(item) {
      return item.quantity - (item.quantityReceived || 0);
    },

    async openNew() {
      this.editing = null;
      this.form = { supplierId: '', branchId: '', notes: '', items: [] };
      this.productSearch = '';
      this.productResults = [];
      await this.loadSuppliersAndBranches();
      this.currentView = 'detail';
    },

    async openDetail(po) {
      this.editing = po;
      this.form = {
        supplierId: po.supplier?.id || '',
        branchId: po.branch?.id || '',
        notes: po.notes || '',
        items: (po.items || []).map(it => ({ ...it })),
      };
      this.productSearch = '';
      this.productResults = [];
      await this.loadSuppliersAndBranches();
      this.currentView = 'detail';
    },

    async loadSuppliersAndBranches() {
      try {
        [this.suppliers, this.branches] = await Promise.all([
          listSuppliers(this.suitId),
          listBranches(this.suitId),
        ]);
      } catch (err) {
        showToast('No se pudieron cargar proveedores/sucursales (' + err.message + ')', 'err');
      }
    },

    async searchProducts() {
      if (!this.productSearch.trim()) { this.productResults = []; return; }
      try {
        const res = await listProducts(this.suitId, { search: this.productSearch, take: 8 });
        this.productResults = res.data;
      } catch (err) {
        this.productResults = [];
      }
    },

    addProductToItems(product) {
      this.form.items.push({
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitCost: product.cost != null ? Number(product.cost) : 0,
      });
      this.productSearch = '';
      this.productResults = [];
    },

    addFreeItem() {
      this.form.items.push({ productId: null, productName: '', quantity: 1, unitCost: 0 });
    },

    // Como "Pedido de stock bajo" de SEC POS: suma al pedido los productos en
    // o bajo su stock mínimo, con la cantidad que falta para volver al mínimo
    // (o al máximo si está definido). Si ya hay proveedor elegido, solo los
    // de ese proveedor. No duplica productos que ya están en el pedido.
    async addLowStock() {
      try {
        const res = await listProducts(this.suitId, { minStockAlert: true, take: 100 });
        const inOrder = new Set(this.form.items.map(it => it.productId).filter(Boolean));
        const rows = res.data.filter(p =>
          !inOrder.has(p.id) && (!this.form.supplierId || p.supplierId === this.form.supplierId));
        rows.forEach(p => this.form.items.push({
          productId: p.id,
          productName: p.name,
          quantity: Math.max(1, (p.maxStock ?? p.minStock ?? 0) - p.stock),
          unitCost: p.cost != null ? Number(p.cost) : 0,
        }));
        showToast(rows.length
          ? `Se agregaron ${rows.length} producto(s) con stock bajo`
          : 'No hay productos con stock bajo para agregar');
      } catch (err) {
        showToast('No se pudo generar desde stock bajo (' + err.message + ')', 'err');
      }
    },

    async openNewFromLowStock() {
      await this.openNew();
      await this.addLowStock();
    },

    clearItems() {
      if (!this.form.items.length) return;
      openConfirmModal({
        message: '¿Vaciar todos los ítems del pedido?',
        onConfirm: () => { this.form.items = []; },
      });
    },

    // CSV con BOM + separador ';' → Excel (es-AR) lo abre directo con columnas.
    exportItems() {
      if (!this.form.items.length) return showToast('El pedido está vacío', 'err');
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Producto', 'Cantidad', 'Costo unitario', 'Subtotal']].concat(
        this.form.items.map(it => [
          it.productName, it.quantity,
          it.unitCost === null ? '' : it.unitCost,
          it.unitCost === null ? '' : (Number(it.unitCost) || 0) * (Number(it.quantity) || 0),
        ]));
      const csv = '\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n');
      const supplier = this.suppliers.find(x => x.id === this.form.supplierId)?.name || 'pedido';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `Pedido_${supplier.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },

    removeItem(idx) {
      this.form.items.splice(idx, 1);
    },

    stepItemQty(it, delta) {
      it.quantity = Math.max(1, (Number(it.quantity) || 1) + delta);
    },

    stockBadgeClass(p) {
      if (p.stock <= 0) return 'zero';
      if (p.minStock != null && p.stock <= p.minStock) return 'low';
      return 'ok';
    },

    // Editar un pedido YA creado requiere ver el costo (mismo permiso
    // 'purchase_orders:write' que el backend usa para no redactarlo) — sin
    // eso, guardar reescribiría el costo real con el valor oculto (null).
    // Crear uno nuevo no depende de esto: los costos ahí salen frescos del
    // buscador de productos, no de un pedido ya redactado.
    isDraftEditable() {
      if (!this.editing) return true;
      return this.editing.status === 'draft' && this.canWrite;
    },

    async saveDraft() {
      if (!this.form.supplierId) return showToast('Elegí un proveedor', 'err');
      if (!this.form.items.length) return showToast('Agregá al menos un ítem', 'err');
      if (this.form.items.some(it => !it.productName?.trim() || !it.quantity || it.quantity < 1 || it.unitCost < 0)) {
        return showToast('Revisá los ítems: nombre, cantidad y costo son obligatorios', 'err');
      }

      const dto = {
        supplierId: this.form.supplierId,
        branchId: this.form.branchId || undefined,
        notes: this.form.notes || undefined,
        items: this.form.items.map(it => ({
          productId: it.productId || undefined,
          productName: it.productName,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
        })),
      };

      this.saving = true;
      try {
        if (this.editing) {
          await updatePurchaseOrder(this.suitId, this.editing.id, dto);
          showToast('Pedido actualizado');
        } else {
          await createPurchaseOrder(this.suitId, dto);
          showToast('Pedido guardado como borrador');
        }
        await this.refreshOrders();
        this.currentView = 'list';
      } catch (err) {
        showToast('No se pudo guardar (' + err.message + ')', 'err');
      } finally {
        this.saving = false;
      }
    },

    async sendOrder(po) {
      if (!this.canWrite) return;
      openConfirmModal({
        message: `¿Enviar el pedido a "${po.supplier?.name || 'proveedor'}"? Una vez enviado no se puede editar.`,
        onConfirm: async () => {
          try {
            await sendPurchaseOrder(this.suitId, po.id);
            showToast('Pedido enviado');
            await this.refreshOrders();
            if (this.currentView === 'detail') this.currentView = 'list';
          } catch (err) {
            showToast('No se pudo enviar (' + err.message + ')', 'err');
          }
        },
      });
    },

    async cancelOrder(po) {
      if (!this.canWrite) return;
      openConfirmModal({
        message: `¿Cancelar el pedido a "${po.supplier?.name || 'proveedor'}"?`,
        onConfirm: async () => {
          try {
            await cancelPurchaseOrder(this.suitId, po.id);
            showToast('Pedido cancelado');
            await this.refreshOrders();
            if (this.currentView === 'detail') this.currentView = 'list';
          } catch (err) {
            showToast('No se pudo cancelar (' + err.message + ')', 'err');
          }
        },
      });
    },

    openReceiveModal(po) {
      if (!this.canReceive) return;
      this.receiveModal = {
        open: true,
        po,
        notes: '',
        saving: false,
        lines: (po.items || [])
          .filter(it => this.pendingQty(it) > 0)
          .map(it => ({ purchaseOrderItemId: it.id, productName: it.productName, pending: this.pendingQty(it), quantityReceived: this.pendingQty(it) })),
      };
    },

    closeReceiveModal() {
      this.receiveModal = { open: false, po: null, lines: [], notes: '', saving: false };
    },

    async submitReceive() {
      const active = this.receiveModal.lines.filter(l => l.quantityReceived > 0);
      if (!active.length) return showToast('Ingresá al menos una cantidad recibida', 'err');
      if (active.some(l => l.quantityReceived > l.pending)) {
        return showToast('Hay cantidades que superan lo pendiente de ese ítem', 'err');
      }

      const dto = {
        notes: this.receiveModal.notes || undefined,
        items: active.map(l => ({ purchaseOrderItemId: l.purchaseOrderItemId, quantityReceived: Number(l.quantityReceived) })),
      };

      this.receiveModal.saving = true;
      try {
        const updated = await receivePurchaseOrder(this.suitId, this.receiveModal.po.id, dto);
        showToast('Recepción registrada');
        this.closeReceiveModal();
        await this.refreshOrders();
        if (this.currentView === 'detail' && this.editing?.id === updated.id) this.editing = updated;
      } catch (err) {
        showToast('No se pudo registrar la recepción (' + err.message + ')', 'err');
      } finally {
        this.receiveModal.saving = false;
      }
    },
  },
  template: `
    <div class="inventory-subview">
      <button class="ghost-btn" @click="goBack">← Volver</button>

      <template v-if="currentView === 'list'">
        <div class="card">
          <div class="sec-section-head">
            <div><div class="sec-eyebrow">Reposición</div><h2>Pedidos a proveedores</h2></div>
            <span class="crm-badge badge-blue">{{ filteredOrders.length }} pedido(s)</span>
          </div>

          <div class="sec-quick-filters">
            <button type="button" class="ghost-btn sec-quick-filter" :class="{active: statusFilter==='draft'}" @click="statusFilter = statusFilter==='draft' ? '' : 'draft'">📝 Borrador</button>
            <button type="button" class="ghost-btn sec-quick-filter" :class="{active: statusFilter==='sent'}" @click="statusFilter = statusFilter==='sent' ? '' : 'sent'">📤 Enviado</button>
            <button type="button" class="ghost-btn sec-quick-filter" :class="{active: statusFilter==='partially_received'}" @click="statusFilter = statusFilter==='partially_received' ? '' : 'partially_received'">📦 Parcial</button>
            <button type="button" class="ghost-btn sec-quick-filter" :class="{active: statusFilter==='received'}" @click="statusFilter = statusFilter==='received' ? '' : 'received'">✅ Recibido</button>
          </div>

          <div class="crm-toolbar">
            <select v-model="statusFilter">
              <option value="">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="sent">Enviado</option>
              <option value="partially_received">Recibido parcial</option>
              <option value="received">Recibido</option>
              <option value="cancelled">Cancelado</option>
            </select>
            <button class="ghost-btn" @click="openNewFromLowStock" v-if="ekCan('purchase_orders', 'create')">⚠️ Pedido de stock bajo</button>
            <button class="primary-btn" @click="openNew" v-if="ekCan('purchase_orders', 'create')">+ Nuevo pedido</button>
          </div>

          <div class="crm-table-wrap">
            <p class="crm-muted" v-if="orders.status === 'loading'">Cargando…</p>
            <p class="crm-muted" v-else-if="orders.status === 'error'">No se pudieron cargar los pedidos ({{ esc(orders.error) }}).</p>
            <p class="crm-muted" v-else-if="!filteredOrders.length">No hay pedidos a proveedores todavía.</p>
            <table class="crm-table" v-else>
              <thead>
                <tr><th>Proveedor</th><th>Sucursal</th><th>Ítems</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="po in filteredOrders" :key="po.id">
                  <td>{{ po.supplier?.name || '—' }}</td>
                  <td>{{ po.branch?.name || 'Sin sucursal' }}</td>
                  <td>{{ (po.items || []).length }}</td>
                  <td>{{ orderTotal(po) !== null ? fmtMoney(orderTotal(po)) : '—' }}</td>
                  <td><span class="badge" :class="statusBadge(po.status)">{{ statusLabel(po.status) }}</span></td>
                  <td>{{ new Date(po.createdAt).toLocaleDateString('es-AR') }}</td>
                  <td>
                    <button class="ghost-btn" @click="openDetail(po)">Ver</button>
                    <button class="ghost-btn" v-if="po.status === 'draft' && canWrite" @click="sendOrder(po)">Enviar</button>
                    <button class="ghost-btn" v-if="canReceiveOrder(po) && canReceive" @click="openReceiveModal(po)">Recibir</button>
                    <button class="ghost-btn btn-danger" v-if="canCancel(po) && canWrite" @click="cancelOrder(po)">Cancelar</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="sec-split">
          <div class="card">
            <div class="sec-section-head">
              <div><div class="sec-eyebrow">Reposición</div><h2>{{ editing ? 'Pedido a ' + (editing.supplier?.name || '') : 'Nuevo pedido a proveedor' }}</h2></div>
              <span class="badge" :class="statusBadge(editing.status)" v-if="editing">{{ statusLabel(editing.status) }}</span>
            </div>

            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <label style="flex:1;min-width:220px">Proveedor
                <select v-model="form.supplierId" :disabled="!isDraftEditable()" style="width:100%">
                  <option value="">Elegí un proveedor…</option>
                  <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
              </label>
              <label style="flex:1;min-width:220px">Sucursal destino (opcional)
                <select v-model="form.branchId" :disabled="!isDraftEditable()" style="width:100%">
                  <option value="">Sin sucursal (pool general)</option>
                  <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
              </label>
            </div>
            <label style="display:block;margin-top:8px">Notas
              <textarea v-model="form.notes" :disabled="!isDraftEditable()" rows="2" style="width:100%"></textarea>
            </label>

            <div v-if="isDraftEditable()">
              <div class="sec-section-head" style="margin-top:16px">
                <div><div class="sec-eyebrow">Catálogo</div><h2>Agregar productos</h2></div>
              </div>
              <div class="crm-toolbar">
                <input type="text" v-model="productSearch" @input="searchProducts" placeholder="Buscar producto del catálogo…" />
                <button class="ghost-btn" @click="addFreeItem">+ Ítem libre</button>
                <button class="ghost-btn" @click="addLowStock">⚠️ Agregar stock bajo</button>
              </div>
              <div v-if="productResults.length">
                <div class="sec-result-card" v-for="p in productResults" :key="p.id">
                  <div class="sec-result-thumb"></div>
                  <div class="sec-result-main">
                    <div class="sec-result-title">{{ p.name }}</div>
                    <div class="sec-result-meta">
                      <span>Costo: {{ fmtMoney(p.cost || 0) }}</span>
                      <span class="sec-stock-badge" :class="stockBadgeClass(p)">{{ p.stock }} en stock</span>
                    </div>
                  </div>
                  <button class="ghost-btn" @click="addProductToItems(p)">+ Agregar</button>
                </div>
              </div>
            </div>
          </div>

          <div class="card sec-split-sticky">
            <div class="sec-section-head">
              <div><div class="sec-eyebrow">Lista de compra</div><h2>Carrito del pedido</h2></div>
              <span class="crm-badge badge-blue">{{ form.items.length }} ítem(s)</span>
            </div>

            <div class="crm-table-wrap">
              <p v-if="!form.items.length" class="crm-muted">Todavía no agregaste ítems.</p>
              <table v-else class="crm-table">
                <thead><tr><th>Producto</th><th>Cant.</th><th v-if="editing">Recibido</th><th>Costo unit.</th><th>Subtotal</th><th v-if="isDraftEditable()"></th></tr></thead>
                <tbody>
                  <tr v-for="(it, idx) in form.items" :key="idx">
                    <td>
                      <input v-if="isDraftEditable() && !it.productId" type="text" v-model="it.productName" placeholder="Nombre del ítem" />
                      <span v-else>{{ it.productName }}</span>
                    </td>
                    <td>
                      <div class="sec-qty-stepper" v-if="isDraftEditable()">
                        <button type="button" @click="stepItemQty(it, -1)">−</button>
                        <input type="number" min="1" v-model.number="it.quantity" />
                        <button type="button" @click="stepItemQty(it, 1)">+</button>
                      </div>
                      <span v-else>{{ it.quantity }}</span>
                    </td>
                    <td v-if="editing">{{ it.quantityReceived || 0 }} / {{ it.quantity }}</td>
                    <td>
                      <span v-if="it.unitCost === null" class="crm-muted">Sin permiso</span>
                      <input v-else-if="isDraftEditable()" type="number" min="0" step="0.01" v-model.number="it.unitCost" style="width:100px" />
                      <span v-else>{{ fmtMoney(it.unitCost) }}</span>
                    </td>
                    <td>{{ it.unitCost === null ? '—' : fmtMoney((Number(it.unitCost) || 0) * (Number(it.quantity) || 0)) }}</td>
                    <td v-if="isDraftEditable()"><button class="ghost-btn btn-danger" @click="removeItem(idx)">✕</button></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="sec-totals-strip">
              <div><span>Productos</span><b>{{ form.items.length }}</b></div>
              <div><span>Unidades</span><b>{{ formQtyTotal }}</b></div>
              <div><span>Costo estimado</span><b>{{ formTotal !== null ? fmtMoney(formTotal) : '—' }}</b></div>
            </div>
            <p v-if="editing && !canWrite" class="crm-muted">No tenés permiso para ver el costo de este pedido — no se puede editar.</p>

            <div class="crm-toolbar" style="justify-content:flex-end">
              <button class="ghost-btn" v-if="isDraftEditable() && form.items.length" @click="clearItems">Vaciar</button>
              <button class="ghost-btn" v-if="form.items.length" @click="exportItems">⬇ Exportar Excel</button>
              <button class="ghost-btn" v-if="editing && canCancel(editing) && canWrite" @click="cancelOrder(editing)">Cancelar pedido</button>
              <button class="ghost-btn" v-if="editing && editing.status === 'draft' && canWrite" @click="sendOrder(editing)">Enviar</button>
              <button class="ghost-btn" v-if="editing && canReceiveOrder(editing) && canReceive" @click="openReceiveModal(editing)">Recibir mercadería</button>
              <button class="primary-btn" v-if="isDraftEditable()" :disabled="saving" @click="saveDraft">{{ editing ? 'Guardar cambios' : 'Guardar borrador' }}</button>
            </div>
          </div>
        </div>
      </template>

      <div class="crm-overlay" :class="{ open: receiveModal.open }">
        <div class="crm-modal">
          <div class="crm-modal-header">
            <span class="crm-modal-title">Recibir mercadería — {{ receiveModal.po?.supplier?.name }}</span>
            <span class="crm-modal-close" @click="closeReceiveModal">✕</span>
          </div>
          <div class="crm-table-wrap">
            <table class="crm-table">
              <thead><tr><th>Producto</th><th>Pendiente</th><th>Recibiendo ahora</th></tr></thead>
              <tbody>
                <tr v-for="line in receiveModal.lines" :key="line.purchaseOrderItemId">
                  <td>{{ line.productName }}</td>
                  <td>{{ line.pending }}</td>
                  <td>
                    <div class="sec-qty-stepper">
                      <button type="button" @click="line.quantityReceived = Math.max(0, line.quantityReceived - 1)">−</button>
                      <input type="number" min="0" :max="line.pending" v-model.number="line.quantityReceived" />
                      <button type="button" @click="line.quantityReceived = Math.min(line.pending, line.quantityReceived + 1)">+</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <label style="display:block;margin-top:8px">Notas
            <textarea v-model="receiveModal.notes" rows="2" style="width:100%"></textarea>
          </label>
          <div class="crm-toolbar" style="justify-content:flex-end;margin-top:12px">
            <button class="ghost-btn" @click="closeReceiveModal" :disabled="receiveModal.saving">Cancelar</button>
            <button class="primary-btn" :disabled="receiveModal.saving" @click="submitReceive">Confirmar recepción</button>
          </div>
        </div>
      </div>
    </div>`,
};

// ── Entry point ──────────────────────────────────────────────────────────

let purchaseOrdersVueInstance = null;

function loadPurchaseOrdersPanel(suitId, suitName) {
  if (!purchaseOrdersVueInstance) {
    const mountEl = document.getElementById('purchaseorders-app');
    if (!mountEl) return Promise.resolve();
    purchaseOrdersVueInstance = Vue.createApp(PurchaseOrdersApp).mount(mountEl);
  }
  return purchaseOrdersVueInstance.setSuit(suitId, suitName);
}

// Referenciada por nombre en FEATURE_ENTRY (dashboard.js) y en el click de
// la nav-card "Pedidos a Proveedores" (inventory.js) — ambos caminos entran
// por acá luego de que loadInventoryPanel ya mostró la sub-vista.
function enterPurchaseOrders() {
  showInventoryView('purchaseorders');
  if (currentInventorySuit) loadPurchaseOrdersPanel(currentInventorySuit.id, currentInventorySuit.name);
}
