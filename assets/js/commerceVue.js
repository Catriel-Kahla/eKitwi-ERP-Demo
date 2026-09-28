/**
 * commerceVue.js
 * Vue del panel "Commerce". Mismo rol que commerce.js (que queda en el repo
 * sin cargarse — script tag removido de dashboard.html — de referencia/
 * rollback): expone loadCommercePanel (llamado desde dashboard.js) e
 * initCommerceEvents (no-op acá, @click/@input/v-model en el template
 * reemplazan los listeners manuales de esa función).
 *
 * Home (POS: escaneo → carrito → checkout, + últimos pedidos) + dos
 * sub-vistas (Pedidos: tabla completa con filtro y acciones; Caja/s:
 * directorio de cajas + detalle de sesión con movimientos y cierre).
 *
 * enterPedidosManagement()/enterCajaManagement() se preservan como funciones
 * globales aparte de los métodos de instancia: dashboard.js las referencia
 * por nombre en FEATURE_ENTRY (ver initGlobalNav) para saltar directo a esa
 * sub-vista cuando el usuario entra por "Pedidos" o "Cajas" en el menú
 * lateral en vez de por "Commerce" a secas.
 */

'use strict';

// Sucursal activa del POS — persiste por suit en localStorage (mismo patrón
// que suit-state.js) para no obligar a re-elegirla en cada visita al panel.
const posBranchKey = (suitId) => `ekitwi_erp_pos_branch_${suitId}`;
const getPosBranchId = (suitId) => localStorage.getItem(posBranchKey(suitId)) || '';
const setPosBranchId = (suitId, branchId) => {
  if (branchId) localStorage.setItem(posBranchKey(suitId), branchId);
  else localStorage.removeItem(posBranchKey(suitId));
};

const CommerceApp = {
  data() {
    return {
      suitId: null,
      suitName: '',
      currentView: 'home',

      posBranches: [],
      posBranchId: '',
      posCart: [],
      posPaymentMethod: '', // Fase 4: método de pago por venta — opcional, ventas viejas/pedidos aceptados quedan sin este dato
      posDiscountPercent: 0, // % sobre el subtotal, antes del recargo del medio de pago
      checkingOut: false,

      // Medios de venta configurables por suit (nombre + % de recargo) —
      // ver PaymentMethodsService. Se cargan una vez al entrar al suit.
      paymentMethods: [],
      paymentSettingsModal: { open: false, newKey: '', newLabel: '', newMarkup: 0, adding: false },

      // Búsqueda en vivo por nombre (capa visual, patrón SEC POS) — además
      // del escaneo por código que ya existía y sigue funcionando igual.
      posSearch: '',
      posSearchResults: [],
      posSearchTimer: null,

      pedidos: { status: 'idle', data: [], error: null },
      pedidoTypeFilter: '',

      cashRegisters: [],
      openSessionByRegister: {}, // registerId -> sesión abierta (si tiene)
      cashStatus: 'idle',
      cashError: null,
      currentCashSession: null, // sesión que se está viendo en el detalle

      cashRegisterModal: { open: false, editId: null, name: '', branchId: '', active: true, saving: false },
      openSessionModal:  { open: false, registerId: null, registerName: '', amount: '', saving: false },
      cashMovementModal: { open: false, type: 'ingreso', amount: '', description: '', saving: false },
      closeSessionModal: { open: false, expected: 0, amount: '', saving: false },

      // Fase 3 (merge SEC POS): canje cruzado de producto — devuelve uno,
      // se lleva otro distinto, liquida la diferencia (ver ExchangesService).
      cambio: {
        returnSearch: '', returnResults: [], returnProduct: null, returnQty: 1,
        newSearch: '', newResults: [], newProduct: null, newQty: 1,
        saving: false,
      },
    };
  },
  computed: {
    cartTotal() { return this.posCart.reduce((s, i) => s + i.unitPrice * i.quantity, 0); },
    canCheckout() { return this.posCart.length > 0 && !this.checkingOut; },

    activePaymentMethods() { return this.paymentMethods.filter(m => m.isActive); },
    selectedPaymentMethod() { return this.paymentMethods.find(m => m.key === this.posPaymentMethod) || null; },
    cartDiscountAmount() { return this.cartTotal * (Number(this.posDiscountPercent) || 0) / 100; },
    cartAfterDiscount() { return this.cartTotal - this.cartDiscountAmount; },
    cartMarkupAmount() {
      const markup = this.selectedPaymentMethod ? Number(this.selectedPaymentMethod.markupPercent) : 0;
      return this.cartAfterDiscount * markup / 100;
    },
    cartFinalTotal() { return this.cartAfterDiscount + this.cartMarkupAmount; },
    canManagePaymentMethods() { return ekCan('orders', 'write'); },

    cashSessionMeta() {
      const s = this.currentCashSession;
      if (!s) return '';
      let meta = `Abierta por ${s.openedBy?.email || '—'} el ${new Date(s.openedAt).toLocaleString('es-AR')}`;
      if (s.status === 'cerrada') meta += ` · Cerrada por ${s.closedBy?.email || '—'} el ${new Date(s.closedAt).toLocaleString('es-AR')}`;
      return meta;
    },
    cashSessionKpis() {
      const s = this.currentCashSession;
      if (!s) return [];
      const { ingresos, egresos, expected } = this.computeCashTotals(s);
      const kpis = [
        { label: 'Fondo inicial', value: fmtMoney(Number(s.initialAmount)) },
        { label: 'Ingresos', value: fmtMoney(ingresos) },
        { label: 'Egresos', value: fmtMoney(egresos) },
        { label: 'Esperado', value: fmtMoney(expected) },
      ];
      if (s.status === 'cerrada') {
        kpis.push({ label: 'Contado', value: fmtMoney(Number(s.finalAmount)) });
        kpis.push({ label: 'Diferencia', value: fmtMoney(Number(s.difference)) });
      }
      return kpis;
    },
    canManageCash() { return !!this.currentCashSession && this.currentCashSession.status === 'abierta' && ekCan('cash_management', 'create'); },
    canCloseCash() { return !!this.currentCashSession && this.currentCashSession.status === 'abierta' && ekCan('cash_management', 'write'); },

    // Aproximación con precio base (sin nivel de precio ni descuento de
    // categoría) — el valor real que se cobra/devuelve lo calcula el server
    // (ExchangesService, vía SalesService.resolveUnitPrice) y se muestra en
    // el toast al confirmar; esto es solo para orientar antes de enviar.
    cambioDifference() {
      const c = this.cambio;
      if (!c.returnProduct || !c.newProduct) return 0;
      return Number(c.newProduct.price) * c.newQty - Number(c.returnProduct.price) * c.returnQty;
    },
    canCambio() { return ekCan('orders', 'create'); },

    // Ventas hechas directo en el POS (channel='pos') vs. pedidos de la
    // tienda online (channel='ecommerce' o null en filas de antes de esta
    // columna — ver migración 45_add_order_channel).
    posOrders() { return this.pedidos.data.filter(o => o.channel === 'pos'); },
    ecommerceOrders() { return this.pedidos.data.filter(o => o.channel !== 'pos'); },
  },
  methods: {
    ekCan,
    fmtMoney,

    // ── Entry point público — lo llama loadCommercePanel() más abajo ─────
    async setSuit(suitId, suitName) {
      this.suitId = suitId;
      this.suitName = suitName;
      const labelEl = document.getElementById('commerce-suit-label');
      if (labelEl) labelEl.textContent = `Commerce de ${suitName}`;
      this.posCart = [];
      this.currentView = 'home';
      await Promise.all([this.loadPosBranches(), this.loadPaymentMethods()]);
    },

    async loadPaymentMethods() {
      try { this.paymentMethods = await listPaymentMethods(this.suitId); }
      catch { this.paymentMethods = []; }
    },

    backToHome() { this.currentView = 'home'; },

    // Suits sin sucursales creadas: el selector queda oculto y el POS vende
    // contra el pool sin sucursal, exactamente como siempre.
    async loadPosBranches() {
      try {
        this.posBranches = (await listBranches(this.suitId)).filter(b => b.isActive);
      } catch {
        this.posBranches = [];
      }
      if (!this.posBranches.length) { this.posBranchId = ''; return; }
      const saved = getPosBranchId(this.suitId);
      this.posBranchId = this.posBranches.some(b => b.id === saved) ? saved : '';
    },
    onBranchChange() { setPosBranchId(this.suitId, this.posBranchId); },

    // "Auriculares Pro x2, Mouse inalámbrico x1" — usado tanto en "Últimos
    // pedidos" como en la gestión de Pedidos para mostrar qué se vendió.
    orderItemsSummary(o) {
      if (o.exchange) return `Devuelve ${o.exchange.returnedProductName} ×${o.exchange.returnedQuantity} → Lleva ${o.exchange.newProductName} ×${o.exchange.newQuantity}`;
      const items = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
      if (!items.length) return '—';
      return items.map(i => `${i.productName || 'Producto'} ×${i.quantity ?? 1}`).join(', ');
    },
    // Si la venta tiene descuento/recargo aplicado, o.sale.total ya es el
    // total final cobrado — sumar los subtotales de línea daría el precio
    // de lista, sin esos ajustes (ver SalesService.createSaleInTransaction).
    orderTotal(o) {
      // Cambio: la diferencia de precio (positivo = ingreso, negativo = se devuelve plata).
      if (o.exchange) return Number(o.exchange.priceDifference);
      if (o.sale && o.sale.total != null) return Number(o.sale.total);
      const items = (o.sale && o.sale.items && o.sale.items.length) ? o.sale.items : (o.items || []);
      return items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
    },
    orderCustomer(o) { return (o.user && o.user.email) || o.guestName || 'Invitado'; },
    orderBadge(o) { return ORDER_BADGE[o.type] || 'badge-gray'; },
    orderDate(o) { return new Date(o.date).toLocaleString('es-AR'); },
    // Fase 4: null en pedidos aceptados online o ventas de antes de este
    // cambio — no todas las ventas tienen método de pago cargado.
    paymentMethodLabel(o) {
      const pm = o.sale?.paymentMethod;
      return pm ? ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' }[pm] || pm) : '—';
    },

    // ── POS ────────────────────────────────────────────────────────────
    async handleScanInput(e) {
      const raw = e.target.value.trim();
      if (!raw) return;
      if (!this.suitId) { showToast('Seleccioná un suit primero', 'err'); return; }
      try {
        const product = await findProductByCode(this.suitId, raw);
        e.target.value = '';
        await this.addToCart(product);
      } catch {
        showToast(`Producto no encontrado (${raw})`, 'err');
      }
    },
    // Cada línea guarda sus niveles de precio (StProductPrice) además del
    // precio base, para que el vendedor pueda elegir cuál cobrar. Un
    // producto sin niveles cargados vende siempre a precio base, como antes.
    async addToCart(product) {
      const existing = this.posCart.find(i => i.productId === product.id);
      if (existing) { existing.quantity += 1; return; }

      let prices = [];
      try { prices = await listProductPrices(this.suitId, product.id); } catch { prices = []; }

      this.posCart.push({
        productId: product.id, name: product.name,
        basePrice: Number(product.price), prices,
        priceId: null, unitPrice: Number(product.price), quantity: 1,
      });
    },
    removeFromCart(idx) { this.posCart.splice(idx, 1); },
    onQtyChange(item, e) { item.quantity = Math.max(1, parseInt(e.target.value, 10) || 1); },
    stepQty(item, delta) { item.quantity = Math.max(1, item.quantity + delta); },

    // Búsqueda en vivo por nombre — mismo wrapper listProducts que ya usan
    // purchaseOrdersVue.js y la vista Cambio, debounced 300ms.
    searchPosProducts() {
      clearTimeout(this.posSearchTimer);
      this.posSearchTimer = setTimeout(async () => {
        if (!this.posSearch.trim()) { this.posSearchResults = []; return; }
        try { this.posSearchResults = (await listProducts(this.suitId, { search: this.posSearch, take: 6 })).data; }
        catch { this.posSearchResults = []; }
      }, 300);
    },
    async addToCartFromSearch(p) {
      await this.addToCart(p);
      this.posSearch = '';
      this.posSearchResults = [];
    },
    stockBadgeClass(p) {
      if (p.stock <= 0) return 'zero';
      if (p.minStock != null && p.stock <= p.minStock) return 'low';
      return 'ok';
    },

    // ── Configuración de medios de venta (engranaje del carrito) ────────
    openPaymentSettings() {
      if (!this.canManagePaymentMethods) return;
      this.paymentSettingsModal = { open: true, newKey: '', newLabel: '', newMarkup: 0, adding: false };
    },
    closePaymentSettings() { this.paymentSettingsModal.open = false; },
    async savePaymentMethodRow(pm) {
      try {
        await updatePaymentMethod(this.suitId, pm.id, { label: pm.label, markupPercent: Number(pm.markupPercent) || 0, isActive: pm.isActive });
        showToast('Medio de venta actualizado');
        await this.loadPaymentMethods();
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar el medio de venta', 'err');
      }
    },
    async addPaymentMethod() {
      const m = this.paymentSettingsModal;
      const key = m.newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!key || !m.newLabel.trim()) return showToast('Completá nombre y un identificador válido', 'err');

      m.adding = true;
      try {
        await createPaymentMethod(this.suitId, { key, label: m.newLabel.trim(), markupPercent: Number(m.newMarkup) || 0 });
        m.newKey = ''; m.newLabel = ''; m.newMarkup = 0;
        showToast('Medio de venta agregado');
        await this.loadPaymentMethods();
      } catch (err) {
        showToast(err.message || 'No se pudo agregar el medio de venta', 'err');
      } finally {
        m.adding = false;
      }
    },
    onPriceChange(item) {
      const chosen = item.priceId ? item.prices.find(p => p.id === item.priceId) : null;
      item.unitPrice = chosen ? Number(chosen.price) : item.basePrice;
    },
    clearCart() { this.posCart = []; this.posPaymentMethod = ''; this.posDiscountPercent = 0; },
    async checkoutCart() {
      if (!this.posCart.length || !this.suitId) return;
      this.checkingOut = true;
      try {
        const items = this.posCart.map(i => ({ productId: i.productId, quantity: i.quantity, priceId: i.priceId || undefined }));
        await createPosSale(this.suitId, items, this.posBranchId || undefined, this.posPaymentMethod || undefined, this.posDiscountPercent || undefined);
        this.posCart = [];
        this.posPaymentMethod = '';
        this.posDiscountPercent = 0;
        showToast('Venta registrada');
        this.fetchOrders();
      } catch (err) {
        // Solicitud ya guardada para el owner (permiso "Preguntar"): se vacía el
        // carrito para no reenviarla duplicada.
        if (err.pendingApproval) { this.posCart = []; this.posPaymentMethod = ''; this.posDiscountPercent = 0; }
        showToast(err.message || 'No se pudo registrar la venta', 'err');
      } finally {
        this.checkingOut = false;
      }
    },

    // ── Cambio (canje cruzado de producto) ────────────────────────────
    enterCambio() {
      this.currentView = 'cambio';
      this.cambio = { returnSearch: '', returnResults: [], returnProduct: null, returnQty: 1, newSearch: '', newResults: [], newProduct: null, newQty: 1, saving: false };
    },
    async searchReturnProducts() {
      if (!this.cambio.returnSearch.trim()) { this.cambio.returnResults = []; return; }
      try { this.cambio.returnResults = (await listProducts(this.suitId, { search: this.cambio.returnSearch, take: 6 })).data; }
      catch { this.cambio.returnResults = []; }
    },
    selectReturnProduct(p) {
      this.cambio.returnProduct = p;
      this.cambio.returnSearch = '';
      this.cambio.returnResults = [];
    },
    async searchNewProducts() {
      if (!this.cambio.newSearch.trim()) { this.cambio.newResults = []; return; }
      try { this.cambio.newResults = (await listProducts(this.suitId, { search: this.cambio.newSearch, take: 6 })).data; }
      catch { this.cambio.newResults = []; }
    },
    selectNewProduct(p) {
      if (p.stock <= 0) { showToast('Ese producto no tiene stock disponible', 'err'); return; }
      this.cambio.newProduct = p;
      this.cambio.newSearch = '';
      this.cambio.newResults = [];
    },
    async submitCambio() {
      const c = this.cambio;
      if (!c.returnProduct || !c.newProduct) return showToast('Elegí el producto devuelto y el nuevo', 'err');

      const dto = {
        returnedProductId: c.returnProduct.id, returnedQuantity: Number(c.returnQty),
        newProductId: c.newProduct.id, newQuantity: Number(c.newQty),
        branchId: this.posBranchId || undefined,
      };

      c.saving = true;
      try {
        const result = await createExchange(this.suitId, dto);
        const diff = Number(result.priceDifference);
        const msg = diff > 0 ? `Cambio registrado — cobrar ${fmtMoney(diff)}`
          : diff < 0 ? `Cambio registrado — devolver ${fmtMoney(Math.abs(diff))}`
          : 'Cambio registrado, sin diferencia a cobrar';
        showToast(msg);
        this.backToHome();
      } catch (err) {
        if (err.pendingApproval) this.backToHome();
        showToast(err.message || 'No se pudo registrar el cambio', 'err');
      } finally {
        c.saving = false;
      }
    },

    // ── Pedidos ────────────────────────────────────────────────────────
    enterPedidos() { this.currentView = 'pedidos'; this.fetchOrders(); },
    async fetchOrders() {
      if (!this.suitId) return;
      this.pedidos.status = 'loading';
      try {
        const orders = await listOrders(this.suitId, this.pedidoTypeFilter);
        this.pedidos = { status: 'ok', data: orders, error: null };
      } catch (err) {
        this.pedidos = { status: 'error', data: [], error: err.message };
      }
    },
    // Aceptar/cancelar/devolver requieren permiso de escritura en 'orders' —
    // mismo criterio que el backend (OrdersController.changeStatus).
    acceptOrder(o) { this.runOrderAction(o.id, 'accept'); },
    confirmCancelOrder(o) {
      openConfirmModal({ message: '¿Cancelar este pedido?', onConfirm: () => this.runOrderAction(o.id, 'cancel') });
    },
    confirmReturnOrder(o) {
      openConfirmModal({
        message: '¿Confirmás la devolución de esta venta?',
        showRestock: true,
        onConfirm: (restock) => this.runOrderAction(o.id, 'return', restock),
      });
    },
    async runOrderAction(orderId, action, restock) {
      try {
        await updateOrderAction(this.suitId, orderId, action, restock);
        showToast('Pedido actualizado');
        this.fetchOrders();
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar el pedido', 'err');
      }
    },

    // ── Gestión de Caja/s ──────────────────────────────────────────────
    // Standalone: sin vínculo con las ventas del POS (no hay método de pago
    // por venta todavía) — expectedAmount al cerrar sale solo de los
    // movimientos manuales de la sesión.
    enterCaja() {
      this.currentView = 'caja';
      this.currentCashSession = null;
      this.fetchCashRegisters();
    },
    async fetchCashRegisters() {
      if (!this.suitId) return;
      this.cashStatus = 'loading';
      try {
        const [registers, openSessions] = await Promise.all([
          listCashRegisters(this.suitId),
          listCashSessions(this.suitId, { status: 'abierta' }),
        ]);
        this.cashRegisters = registers;
        const map = {};
        openSessions.forEach(s => { map[s.cashRegisterId] = s; });
        this.openSessionByRegister = map;
        this.cashStatus = 'ok';
      } catch (err) {
        this.cashStatus = 'error';
        this.cashError = err.message;
      }
    },
    computeCashTotals(s) {
      const ingresos = s.movements.filter(m => m.type === 'ingreso').reduce((sum, m) => sum + Number(m.amount), 0);
      const egresos = s.movements.filter(m => m.type === 'egreso').reduce((sum, m) => sum + Number(m.amount), 0);
      return { ingresos, egresos, expected: Number(s.initialAmount) + ingresos - egresos };
    },

    // ── Caja: alta/edición del directorio ──────────────────────────────
    openCashRegisterModal(id) {
      const register = id ? this.cashRegisters.find(r => r.id === id) : null;
      this.cashRegisterModal = {
        open: true, editId: id || null,
        name: register?.name || '', branchId: register?.branchId || '',
        active: register ? register.isActive : true,
        saving: false,
      };
    },
    closeCashRegisterModal() { this.cashRegisterModal.open = false; },
    async saveCashRegister() {
      const m = this.cashRegisterModal;
      const name = m.name.trim();
      if (!name) { showToast('El nombre es obligatorio', 'err'); return; }

      const dto = { name, branchId: m.branchId || undefined, isActive: m.active };
      m.saving = true;
      try {
        if (m.editId) { await updateCashRegister(this.suitId, m.editId, dto); showToast('Caja actualizada'); }
        else { await createCashRegister(this.suitId, dto); showToast('Caja creada'); }
        this.closeCashRegisterModal();
        await this.fetchCashRegisters();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar la caja', 'err');
      } finally {
        m.saving = false;
      }
    },
    confirmDeleteCashRegister(register) {
      openConfirmModal({
        message: '¿Eliminar esta caja?',
        onConfirm: async () => {
          try {
            await deleteCashRegister(this.suitId, register.id);
            showToast('Caja eliminada');
            await this.fetchCashRegisters();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la caja', 'err');
          }
        },
      });
    },

    // ── Caja: abrir sesión ───────────────────────────────────────────────
    openOpenSessionModal(registerId) {
      const register = this.cashRegisters.find(r => r.id === registerId);
      if (!register) return;
      this.openSessionModal = { open: true, registerId, registerName: register.name, amount: '', saving: false };
    },
    closeOpenSessionModal() { this.openSessionModal.open = false; },
    async confirmOpenSession() {
      const m = this.openSessionModal;
      const amount = parseFloat(m.amount);
      if (isNaN(amount) || amount < 0) { showToast('Ingresá un fondo inicial válido', 'err'); return; }

      m.saving = true;
      try {
        const session = await openCashSession(this.suitId, m.registerId, amount);
        showToast('Caja abierta');
        this.closeOpenSessionModal();
        await this.fetchCashRegisters();
        await this.viewCashSession(session.id);
      } catch (err) {
        showToast(err.message || 'No se pudo abrir la caja', 'err');
      } finally {
        m.saving = false;
      }
    },

    // ── Caja: detalle de una sesión (movimientos + cierre) ──────────────
    async viewCashSession(sessionId) {
      try {
        this.currentCashSession = await getCashSession(this.suitId, sessionId);
      } catch (err) {
        showToast(err.message || 'No se pudo cargar la caja', 'err');
      }
    },

    // ── Caja: movimientos ────────────────────────────────────────────────
    openCashMovementModal(type) {
      this.cashMovementModal = { open: true, type, amount: '', description: '', saving: false };
    },
    closeCashMovementModal() { this.cashMovementModal.open = false; },
    async saveCashMovement() {
      const m = this.cashMovementModal;
      const amount = parseFloat(m.amount);
      const description = m.description.trim();
      if (isNaN(amount) || amount <= 0) { showToast('Ingresá un importe válido', 'err'); return; }
      if (!description) { showToast('La descripción es obligatoria', 'err'); return; }

      m.saving = true;
      try {
        await addCashMovement(this.suitId, this.currentCashSession.id, { type: m.type, amount, description });
        showToast('Movimiento registrado');
        this.closeCashMovementModal();
        await this.viewCashSession(this.currentCashSession.id);
      } catch (err) {
        showToast(err.message || 'No se pudo registrar el movimiento', 'err');
      } finally {
        m.saving = false;
      }
    },
    confirmDeleteMovement(movementId) {
      openConfirmModal({
        message: '¿Eliminar este movimiento?',
        onConfirm: async () => {
          try {
            await deleteCashMovement(this.suitId, this.currentCashSession.id, movementId);
            showToast('Movimiento eliminado');
            await this.viewCashSession(this.currentCashSession.id);
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el movimiento', 'err');
          }
        },
      });
    },

    // ── Caja: cerrar sesión ──────────────────────────────────────────────
    openCloseCashSessionModal() {
      const { expected } = this.computeCashTotals(this.currentCashSession);
      this.closeSessionModal = { open: true, expected, amount: '', saving: false };
    },
    closeCloseCashSessionModal() { this.closeSessionModal.open = false; },
    async confirmCloseCashSession() {
      const m = this.closeSessionModal;
      const amount = parseFloat(m.amount);
      if (isNaN(amount) || amount < 0) { showToast('Ingresá el monto contado', 'err'); return; }

      m.saving = true;
      try {
        this.currentCashSession = await closeCashSession(this.suitId, this.currentCashSession.id, amount);
        showToast('Caja cerrada');
        this.closeCloseCashSessionModal();
        await this.fetchCashRegisters();
      } catch (err) {
        showToast(err.message || 'No se pudo cerrar la caja', 'err');
      } finally {
        m.saving = false;
      }
    },
  },
  template: `
    <!-- ── Home: POS + últimos pedidos ───────────────────────────────── -->
    <div v-if="currentView === 'home'" id="commerce-home">
      <div class="sec-split">
        <div class="card">
          <div class="sec-section-head">
            <div><div class="sec-eyebrow">Punto de venta</div><h2>Buscar producto</h2></div>
          </div>
          <div class="crm-toolbar" v-if="posBranches.length">
            <label class="crm-label" style="max-width:260px">
              Sucursal activa
              <select v-model="posBranchId" @change="onBranchChange">
                <option value="">Sin sucursal (depósito central)</option>
                <option v-for="b in posBranches" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </label>
          </div>
          <div class="crm-toolbar">
            <input type="text" id="pos-scan-input" placeholder="Escaneá el código y presioná Enter…" autocomplete="off" @keydown.enter="handleScanInput" />
          </div>
          <div class="crm-toolbar">
            <input type="text" v-model="posSearch" @input="searchPosProducts" placeholder="Buscar producto por nombre…" />
          </div>
          <div v-if="posSearchResults.length">
            <div class="sec-result-card" v-for="p in posSearchResults" :key="p.id">
              <img v-if="p.images && p.images[0]" :src="p.images[0].url" class="sec-result-thumb" alt="" />
              <div v-else class="sec-result-thumb"></div>
              <div class="sec-result-main">
                <div class="sec-result-title">{{ p.name }}</div>
                <div class="sec-result-meta">
                  <span>{{ fmtMoney(p.price) }}</span>
                  <span class="sec-stock-badge" :class="stockBadgeClass(p)">{{ p.stock }} en stock</span>
                </div>
              </div>
              <button class="ghost-btn" @click="addToCartFromSearch(p)">+ Agregar</button>
            </div>
          </div>
        </div>

        <div class="card sec-split-sticky">
          <div class="sec-section-head">
            <div><div class="sec-eyebrow">Carrito</div><h2>Venta actual</h2></div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="crm-badge badge-blue">{{ posCart.length }} ítem(s)</span>
              <button v-if="canManagePaymentMethods" class="ghost-btn" title="Configuración de medios de venta" @click="openPaymentSettings" style="padding:6px 10px">⚙️</button>
            </div>
          </div>
          <div class="crm-table-wrap">
            <p v-if="!posCart.length" class="crm-muted">Sin productos en la venta actual.</p>
            <table v-else class="crm-table">
              <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(item, idx) in posCart" :key="item.productId">
                  <td>{{ item.name }}</td>
                  <td>
                    <div class="sec-qty-stepper">
                      <button type="button" @click="stepQty(item, -1)">−</button>
                      <input type="number" min="1" class="pos-qty-input" :value="item.quantity" @change="onQtyChange(item, $event)" />
                      <button type="button" @click="stepQty(item, 1)">+</button>
                    </div>
                  </td>
                  <td>
                    <span v-if="!item.prices.length">{{ fmtMoney(item.unitPrice) }}</span>
                    <select v-else class="pos-price-select" v-model="item.priceId" @change="onPriceChange(item)">
                      <option :value="null">Base — {{ fmtMoney(item.basePrice) }}</option>
                      <option v-for="p in item.prices" :key="p.id" :value="p.id">{{ p.name }} — {{ fmtMoney(Number(p.price)) }}</option>
                    </select>
                  </td>
                  <td>{{ fmtMoney(item.unitPrice * item.quantity) }}</td>
                  <td><span class="crm-action-btn btn-del" title="Quitar" @click="removeFromCart(idx)">✕</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- Total: mismo orden que el Carrito de SEC POS — subtotal/descuento
               chicos y en gris arriba, total final grande abajo. -->
          <div class="pos-total-row" style="flex-direction:column;align-items:stretch;gap:4px">
            <div style="display:flex;justify-content:space-between" v-if="posDiscountPercent > 0 || cartMarkupAmount > 0">
              <span class="crm-muted" style="font-size:0.8rem">Subtotal</span>
              <span class="crm-muted" style="font-size:0.8rem">{{ fmtMoney(cartTotal) }}</span>
            </div>
            <div style="display:flex;justify-content:space-between" v-if="posDiscountPercent > 0">
              <span class="crm-muted" style="font-size:0.8rem;color:#dc2626">Descuento ({{ posDiscountPercent }}%)</span>
              <span class="crm-muted" style="font-size:0.8rem;color:#dc2626">−{{ fmtMoney(cartDiscountAmount) }}</span>
            </div>
            <div style="display:flex;justify-content:space-between" v-if="cartMarkupAmount > 0">
              <span class="crm-muted" style="font-size:0.8rem">Recargo {{ selectedPaymentMethod?.label }}</span>
              <span class="crm-muted" style="font-size:0.8rem">+{{ fmtMoney(cartMarkupAmount) }}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>Total</span>
              <span>{{ fmtMoney(cartFinalTotal) }}</span>
            </div>
          </div>

          <!-- Descuento + medio de pago, en la misma fila que las acciones —
               mismo agrupamiento que el .toolbar del Carrito de SEC POS. -->
          <div class="crm-toolbar" v-if="posCart.length">
            <label class="crm-label" style="max-width:130px">Descuento %
              <input type="number" min="0" max="100" step="0.01" v-model.number="posDiscountPercent" />
            </label>
            <select v-model="posPaymentMethod" style="max-width:200px">
              <option value="">Método de pago…</option>
              <option v-for="m in activePaymentMethods" :key="m.key" :value="m.key">{{ m.label }}{{ Number(m.markupPercent) > 0 ? ' +' + m.markupPercent + '%' : '' }}</option>
            </select>
            <span v-if="selectedPaymentMethod" class="crm-muted" style="font-size:0.8rem">{{ selectedPaymentMethod.label }} + {{ selectedPaymentMethod.markupPercent }}% · Total: {{ fmtMoney(cartFinalTotal) }}</span>
          </div>
          <div class="form-actions">
            <button class="ghost-btn" :disabled="!posCart.length" @click="clearCart">Vaciar</button>
            <button v-if="canCambio" class="ghost-btn" @click="enterCambio">🔄 Cambio</button>
            <button v-if="ekCan('orders', 'create')" class="primary-btn" :disabled="!canCheckout" @click="checkoutCart">Cobrar</button>
          </div>
        </div>
      </div>

      <div class="crm-overlay" :class="{ open: paymentSettingsModal.open }">
        <div class="crm-modal">
          <div class="crm-modal-header">
            <span class="crm-modal-title">Configuración de medios de venta</span>
            <span class="crm-modal-close" @click="closePaymentSettings">✕</span>
          </div>
          <div class="crm-table-wrap">
            <table class="crm-table">
              <thead><tr><th>Nombre</th><th>Recargo %</th><th>Activo</th><th></th></tr></thead>
              <tbody>
                <tr v-for="pm in paymentMethods" :key="pm.id">
                  <td><input type="text" v-model="pm.label" style="width:140px" /></td>
                  <td><input type="number" min="0" max="100" step="0.01" v-model.number="pm.markupPercent" style="width:80px" /></td>
                  <td><input type="checkbox" v-model="pm.isActive" /></td>
                  <td><button class="ghost-btn" @click="savePaymentMethodRow(pm)">Guardar</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="crm-section-title" style="margin-top:16px">Agregar medio de venta</div>
          <div class="crm-toolbar">
            <input type="text" v-model="paymentSettingsModal.newLabel" placeholder="Nombre (ej. Débito)" style="max-width:160px" />
            <input type="text" v-model="paymentSettingsModal.newKey" placeholder="Identificador (ej. debito)" style="max-width:160px" />
            <input type="number" min="0" max="100" step="0.01" v-model.number="paymentSettingsModal.newMarkup" placeholder="Recargo %" style="max-width:110px" />
            <button class="primary-btn" :disabled="paymentSettingsModal.adding" @click="addPaymentMethod">+ Agregar</button>
          </div>
          <div class="crm-toolbar" style="justify-content:flex-end;margin-top:12px">
            <button class="ghost-btn" @click="closePaymentSettings">Cerrar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Cambio: canje cruzado de producto con diferencia de precio ──── -->
    <div v-else-if="currentView === 'cambio'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>

      <div class="sec-split sec-split-narrow">
        <div class="card">
          <div class="sec-section-head">
            <div><div class="sec-eyebrow">Devolución</div><h2>Producto que devuelve</h2></div>
            <span class="crm-badge" :class="cambio.returnProduct ? 'badge-blue' : 'badge-gray'">{{ cambio.returnProduct ? 'Elegido' : 'Sin elegir' }}</span>
          </div>
          <div class="crm-toolbar" v-if="!cambio.returnProduct">
            <input type="text" v-model="cambio.returnSearch" @input="searchReturnProducts" placeholder="Buscar producto…" />
          </div>
          <div v-if="cambio.returnResults.length">
            <div class="sec-result-card" v-for="p in cambio.returnResults" :key="p.id">
              <div class="sec-result-thumb"></div>
              <div class="sec-result-main">
                <div class="sec-result-title">{{ p.name }}</div>
                <div class="sec-result-meta"><span>{{ fmtMoney(p.price) }}</span></div>
              </div>
              <button class="ghost-btn" @click="selectReturnProduct(p)">Elegir</button>
            </div>
          </div>
          <div v-if="cambio.returnProduct" class="sec-selected-box">
            <b>{{ cambio.returnProduct.name }}</b>
            <div class="crm-toolbar" style="margin-top:8px">
              <span>{{ fmtMoney(cambio.returnProduct.price) }} c/u</span>
              <div class="sec-qty-stepper">
                <button type="button" @click="cambio.returnQty = Math.max(1, cambio.returnQty - 1)">−</button>
                <input type="number" min="1" v-model.number="cambio.returnQty" />
                <button type="button" @click="cambio.returnQty++">+</button>
              </div>
              <button class="ghost-btn btn-danger" @click="cambio.returnProduct = null">Quitar</button>
            </div>
          </div>
          <p v-else class="crm-muted">Seleccioná el producto que vuelve al local.</p>
        </div>

        <div class="card">
          <div class="sec-section-head">
            <div><div class="sec-eyebrow">Entrega</div><h2>Producto que se lleva</h2></div>
            <span class="crm-badge" :class="cambio.newProduct ? 'badge-blue' : 'badge-gray'">{{ cambio.newProduct ? 'Elegido' : 'Sin elegir' }}</span>
          </div>
          <div class="crm-toolbar" v-if="!cambio.newProduct">
            <input type="text" v-model="cambio.newSearch" @input="searchNewProducts" placeholder="Buscar producto…" />
          </div>
          <div v-if="cambio.newResults.length">
            <div class="sec-result-card" v-for="p in cambio.newResults" :key="p.id">
              <div class="sec-result-thumb"></div>
              <div class="sec-result-main">
                <div class="sec-result-title">{{ p.name }}</div>
                <div class="sec-result-meta">
                  <span>{{ fmtMoney(p.price) }}</span>
                  <span class="sec-stock-badge" :class="stockBadgeClass(p)">{{ p.stock }} en stock</span>
                </div>
              </div>
              <button class="ghost-btn" @click="selectNewProduct(p)">Elegir</button>
            </div>
          </div>
          <div v-if="cambio.newProduct" class="sec-selected-box">
            <b>{{ cambio.newProduct.name }}</b>
            <div class="crm-toolbar" style="margin-top:8px">
              <span>{{ fmtMoney(cambio.newProduct.price) }} c/u</span>
              <div class="sec-qty-stepper">
                <button type="button" @click="cambio.newQty = Math.max(1, cambio.newQty - 1)">−</button>
                <input type="number" min="1" v-model.number="cambio.newQty" />
                <button type="button" @click="cambio.newQty++">+</button>
              </div>
              <button class="ghost-btn btn-danger" @click="cambio.newProduct = null">Quitar</button>
            </div>
          </div>
          <p v-else class="crm-muted">Seleccioná el producto que se lleva el cliente.</p>
        </div>
      </div>

      <div class="card" v-if="cambio.returnProduct && cambio.newProduct">
        <div class="sec-section-head"><div><h2>Resumen del cambio</h2></div></div>
        <div class="sec-totals-strip">
          <div><span>Devuelve</span><b>{{ fmtMoney(cambio.returnProduct.price * cambio.returnQty) }}</b></div>
          <div><span>Se lleva</span><b>{{ fmtMoney(cambio.newProduct.price * cambio.newQty) }}</b></div>
          <div>
            <span>{{ cambioDifference > 0 ? 'Cliente paga' : cambioDifference < 0 ? 'Devolver al cliente' : 'Diferencia' }}</span>
            <b :class="cambioDifference > 0 ? 'sec-positive' : cambioDifference < 0 ? 'sec-negative' : ''">{{ fmtMoney(Math.abs(cambioDifference)) }}</b>
          </div>
        </div>
        <div class="form-actions">
          <button class="primary-btn" :disabled="cambio.saving" @click="submitCambio">Confirmar cambio</button>
        </div>
      </div>
    </div>

    <!-- ── Pedidos: filtro + tabla completa + acciones ─────────────────── -->
    <div v-else-if="currentView === 'pedidos'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="crm-toolbar">
        <select v-model="pedidoTypeFilter" @change="fetchOrders">
          <option value="">Todos los estados</option>
          <option value="pedido">Pendientes de confirmación</option>
          <option value="pedido cancelado">Cancelados</option>
          <option value="venta">Confirmados</option>
          <option value="devolucion">Devueltos</option>
          <option value="cambio">Cambios</option>
        </select>
      </div>

      <p v-if="pedidos.status === 'idle'" class="crm-muted">Seleccioná un suit en el menú.</p>
      <p v-else-if="pedidos.status === 'loading'" class="crm-muted">Cargando…</p>
      <p v-else-if="pedidos.status === 'error'" class="crm-muted">No se pudieron cargar los pedidos ({{ pedidos.error }}).</p>

      <template v-else>
        <div class="card">
          <div class="sec-section-head"><div><div class="sec-eyebrow">Punto de venta</div><h2>Ventas (POS)</h2></div><span class="crm-badge badge-blue">{{ posOrders.length }}</span></div>
          <div class="crm-table-wrap">
            <p v-if="!posOrders.length" class="crm-muted">Sin ventas de POS para este filtro.</p>
            <table v-else class="crm-table">
              <thead><tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Estado</th><th>Pago</th><th>Total</th><th>Acciones</th></tr></thead>
              <tbody>
                <tr v-for="o in posOrders" :key="o.id">
                  <td>{{ orderDate(o) }}</td>
                  <td>{{ orderCustomer(o) }}</td>
                  <td class="crm-muted">{{ orderItemsSummary(o) }}</td>
                  <td><span class="crm-badge" :class="orderBadge(o)">{{ o.type }}</span></td>
                  <td>{{ paymentMethodLabel(o) }}</td>
                  <td>{{ fmtMoney(orderTotal(o)) }}</td>
                  <td class="td-actions">
                    <template v-if="ekCan('orders', 'write')">
                      <button v-if="o.type === 'venta'" class="ghost-btn btn-danger" @click="confirmReturnOrder(o)">Devolver</button>
                      <span v-else class="crm-muted">—</span>
                    </template>
                    <span v-else class="crm-muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="sec-section-head"><div><div class="sec-eyebrow">Tienda online</div><h2>Pedidos (eCommerce)</h2></div><span class="crm-badge badge-blue">{{ ecommerceOrders.length }}</span></div>
          <div class="crm-table-wrap">
            <p v-if="!ecommerceOrders.length" class="crm-muted">Sin pedidos de eCommerce para este filtro.</p>
            <table v-else class="crm-table">
              <thead><tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Estado</th><th>Pago</th><th>Total</th><th>Acciones</th></tr></thead>
              <tbody>
                <tr v-for="o in ecommerceOrders" :key="o.id">
                  <td>{{ orderDate(o) }}</td>
                  <td>{{ orderCustomer(o) }}</td>
                  <td class="crm-muted">{{ orderItemsSummary(o) }}</td>
                  <td><span class="crm-badge" :class="orderBadge(o)">{{ o.type }}</span></td>
                  <td>{{ paymentMethodLabel(o) }}</td>
                  <td>{{ fmtMoney(orderTotal(o)) }}</td>
                  <td class="td-actions">
                    <template v-if="ekCan('orders', 'write')">
                      <template v-if="o.type === 'pedido'">
                        <button class="ghost-btn" @click="acceptOrder(o)">Aceptar</button>
                        <button class="ghost-btn btn-danger" @click="confirmCancelOrder(o)">Cancelar</button>
                      </template>
                      <button v-else-if="o.type === 'venta'" class="ghost-btn btn-danger" @click="confirmReturnOrder(o)">Devolver</button>
                      <span v-else class="crm-muted">—</span>
                    </template>
                    <span v-else class="crm-muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>

    <!-- ── Gestión de Caja/s ────────────────────────────────────────────── -->
    <div v-else-if="currentView === 'caja'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>

      <div class="card">
        <div class="crm-section-title">Cajas</div>
        <div class="crm-toolbar">
          <button v-if="ekCan('cash_management', 'create')" class="primary-btn" @click="openCashRegisterModal(null)">+ Nueva caja</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="cashStatus === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="cashStatus === 'error'" class="crm-muted">No se pudieron cargar las cajas ({{ cashError }}).</p>
          <p v-else-if="!cashRegisters.length" class="crm-muted">Todavía no creaste ninguna caja.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Nombre</th><th>Sucursal</th><th>Estado</th><th>Sesión</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in cashRegisters" :key="r.id">
                <td>{{ r.name }}</td>
                <td class="crm-muted">{{ r.branch?.name || '—' }}</td>
                <td>
                  <span v-if="r.isActive" class="crm-badge badge-green">Activa</span>
                  <span v-else class="crm-badge badge-gray">Inactiva</span>
                </td>
                <td>
                  <span v-if="openSessionByRegister[r.id]" class="crm-badge badge-yellow">Caja abierta</span>
                  <span v-else class="crm-muted">Cerrada</span>
                </td>
                <td class="td-actions">
                  <span v-if="openSessionByRegister[r.id]" class="crm-action-btn" title="Ver caja" @click="viewCashSession(openSessionByRegister[r.id].id)">👁</span>
                  <span v-else-if="ekCan('cash_management', 'create')" class="crm-action-btn" title="Abrir caja" @click="openOpenSessionModal(r.id)">▶</span>
                  <span v-if="ekCan('cash_management', 'write')" class="crm-action-btn" title="Editar" @click="openCashRegisterModal(r.id)">✎</span>
                  <span v-if="ekCan('cash_management', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="confirmDeleteCashRegister(r)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" v-if="currentCashSession">
        <div class="crm-section-title">Caja: {{ currentCashSession.cashRegister?.name || '' }}</div>
        <p class="crm-muted">{{ cashSessionMeta }}</p>
        <div class="kpis">
          <div class="kpi-card" v-for="k in cashSessionKpis" :key="k.label">
            <div class="kpi-label">{{ k.label }}</div>
            <div class="kpi-value">{{ k.value }}</div>
          </div>
        </div>
        <div class="crm-toolbar">
          <button v-if="canManageCash" class="ghost-btn" @click="openCashMovementModal('ingreso')">+ Ingreso</button>
          <button v-if="canManageCash" class="ghost-btn" @click="openCashMovementModal('egreso')">+ Egreso</button>
          <button v-if="canCloseCash" class="primary-btn btn-danger" @click="openCloseCashSessionModal">Cerrar caja</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="!currentCashSession.movements.length" class="crm-muted">Sin movimientos todavía.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Importe</th><th>Descripción</th><th>Usuario</th><th v-if="currentCashSession.status === 'abierta'"></th></tr></thead>
            <tbody>
              <tr v-for="m in currentCashSession.movements" :key="m.id">
                <td class="crm-muted">{{ new Date(m.createdAt).toLocaleString('es-AR') }}</td>
                <td><span class="crm-badge" :class="m.type === 'ingreso' ? 'badge-green' : 'badge-red'">{{ m.type === 'ingreso' ? 'Ingreso' : 'Egreso' }}</span></td>
                <td>{{ fmtMoney(Number(m.amount)) }}</td>
                <td class="crm-muted">{{ m.description }}</td>
                <td class="crm-muted">{{ m.createdBy?.email || '—' }}</td>
                <td class="td-actions" v-if="currentCashSession.status === 'abierta'">
                  <span v-if="ekCan('cash_management', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="confirmDeleteMovement(m.id)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── Modal: Caja (alta/edición del directorio) ───────────────────── -->
    <div class="crm-overlay" :class="{ open: cashRegisterModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ cashRegisterModal.editId ? 'Editar caja' : 'Nueva caja' }}</span>
          <span class="crm-modal-close" @click="closeCashRegisterModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label">
            Nombre
            <input type="text" v-model="cashRegisterModal.name" placeholder="Ej: Caja 1" />
          </label>
          <label class="crm-label">
            Sucursal
            <select v-model="cashRegisterModal.branchId">
              <option value="">Sin sucursal</option>
              <option v-for="b in posBranches" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </label>
          <label class="crm-label-check">
            <input type="checkbox" v-model="cashRegisterModal.active" />
            Activa
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeCashRegisterModal">Cancelar</button>
          <button class="primary-btn" :disabled="cashRegisterModal.saving" @click="saveCashRegister">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Abrir caja ────────────────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: openSessionModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">Abrir caja</span>
          <span class="crm-modal-close" @click="closeOpenSessionModal">✕</span>
        </div>
        <p class="crm-muted">{{ openSessionModal.registerName }}</p>
        <div class="crm-form-group">
          <label class="crm-label">
            Fondo inicial
            <input type="number" v-model="openSessionModal.amount" placeholder="0.00" min="0" step="0.01" />
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeOpenSessionModal">Cancelar</button>
          <button class="primary-btn" :disabled="openSessionModal.saving" @click="confirmOpenSession">Abrir</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Movimiento de caja (ingreso/egreso) ──────────────────── -->
    <div class="crm-overlay" :class="{ open: cashMovementModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ cashMovementModal.type === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo egreso' }}</span>
          <span class="crm-modal-close" @click="closeCashMovementModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label">
            Importe
            <input type="number" v-model="cashMovementModal.amount" placeholder="0.00" min="0.01" step="0.01" />
          </label>
          <label class="crm-label">
            Descripción
            <input type="text" v-model="cashMovementModal.description" placeholder="Ej: Pago a proveedor" />
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeCashMovementModal">Cancelar</button>
          <button class="primary-btn" :disabled="cashMovementModal.saving" @click="saveCashMovement">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Cerrar caja ───────────────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: closeSessionModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">Cerrar caja</span>
          <span class="crm-modal-close" @click="closeCloseCashSessionModal">✕</span>
        </div>
        <p class="crm-muted">Esperado (fondo inicial + ingresos - egresos): <strong>{{ fmtMoney(closeSessionModal.expected) }}</strong></p>
        <div class="crm-form-group">
          <label class="crm-label">
            Monto contado
            <input type="number" v-model="closeSessionModal.amount" placeholder="0.00" min="0" step="0.01" />
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeCloseCashSessionModal">Cancelar</button>
          <button class="primary-btn btn-danger" :disabled="closeSessionModal.saving" @click="confirmCloseCashSession">Cerrar caja</button>
        </div>
      </div>
    </div>`,
};

// ── Entry point (misma firma que commerce.js) ──────────────────────────────

let commerceVueInstance = null;

function loadCommercePanel(suitId, suitName) {
  if (!commerceVueInstance) {
    const mountEl = document.getElementById('commerce-app');
    if (!mountEl) return Promise.resolve();
    commerceVueInstance = Vue.createApp(CommerceApp).mount(mountEl);
  }
  return commerceVueInstance.setSuit(suitId, suitName);
}

// Referenciadas por nombre en FEATURE_ENTRY (dashboard.js) para saltar
// directo a la sub-vista cuando se entra por "Pedidos"/"Cajas" del menú.
function enterPedidosManagement() { commerceVueInstance?.enterPedidos(); }
function enterCajaManagement() { commerceVueInstance?.enterCaja(); }

// @click/@input/v-model en el template reemplazan estos listeners — se deja
// vacía (no un no-op silencioso: dashboard.js la sigue llamando en el
// bootstrap) para no tener que tocar esa lista de initXEvents().
function initCommerceEvents() {}
