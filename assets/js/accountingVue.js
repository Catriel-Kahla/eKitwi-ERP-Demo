/**
 * accountingVue.js
 * Vue del panel "Accounting". Mismo rol que accounting.js (que queda en el
 * repo sin cargarse — script tag removido de dashboard.html — de
 * referencia/rollback): expone loadAccountingPanel (llamado desde
 * dashboard.js) e initAccountingEvents (no-op acá, @click/@input/v-model en
 * el template reemplazan los listeners manuales de esa función).
 *
 * Home (HUD Caja/PN + grilla de accesos + Reportes) + 4 sub-vistas ABM
 * (Plan de Cuentas, Ejercicios con Períodos anidados, Centros de Costo,
 * Libro Diario paginado) + 3 reportes (Libro Mayor, Balance de
 * comprobación, Estado de Situación Patrimonial, Estado de Resultados) +
 * 5 modales propios (Cuenta/Ejercicio/Período/Centro/Asiento).
 *
 * El HUD (indicadores de Caja y Patrimonio Neto) tenía animación a mano con
 * requestAnimationFrame directo sobre el DOM — se preserva igual acá, sólo
 * que apuntando a $refs en vez de getElementById. El resto del panel es
 * reactive state estándar.
 */

'use strict';

const AccountingApp = {
  data() {
    return {
      suitId: null,
      suitName: '',
      currentView: 'home',

      cuentas: [],
      ejercicios: [],
      centros: [],
      periodosByEjercicio: {}, // ejercicioId -> array, carga perezosa al expandir la tarjeta
      openEjercicios: {},      // ejercicioId -> bool (expandido)
      asientosConfirmadosLabel: '—',

      balances: null,

      asientosQuery: { ejercicioId: '', estado: '', desde: '', hasta: '', cuentaId: '', comprobante: '', skip: 0, take: ASIENTOS_PER_PAGE },
      asientosResult: { data: [], pagination: { skip: 0, take: ASIENTOS_PER_PAGE, total: 0, pages: 0 } },
      asientosStatus: 'idle',
      asientosError: null,
      openAsientos: {},
      exportingAsientos: false,

      cuentaModal:    { open: false, editId: null, codigo: '', nombre: '', tipo: 'ACTIVO', parentId: '', imputable: true, esEfectivo: false, activa: true, saving: false },
      ejercicioModal: { open: false, editId: null, nombre: '', fechaInicio: '', fechaFin: '', saving: false },
      periodoModal:   { open: false, ejercicioId: null, editId: null, nombre: '', fechaInicio: '', fechaFin: '', saving: false },
      centroModal:    { open: false, editId: null, codigo: '', nombre: '', activo: true, saving: false },
      asientoModal:   { open: false, fecha: '', descripcion: '', comprobante: '', rows: [], saving: false },

      mayor:   { cuentaId: '', ejercicioId: '', desde: '', hasta: '', data: null, status: 'idle', error: null },
      balcomp: { ejercicioId: '', hasta: '', rows: null, tD: 0, tH: 0, tSD: 0, tSA: 0, status: 'idle', error: null },
      esp:     { ejercicioId: '', hasta: '', bal: null, status: 'idle', error: null },
      er:      { ejercicioId: '', hasta: '', bal: null, status: 'idle', error: null },
    };
  },
  computed: {
    cuentasCountLabel() { return `${this.cuentas.length} cuenta${this.cuentas.length === 1 ? '' : 's'}`; },
    ejerciciosCountLabel() { return `${this.ejercicios.length} ejercicio${this.ejercicios.length === 1 ? '' : 's'}`; },
    centrosCountLabel() { return `${this.centros.length} centro${this.centros.length === 1 ? '' : 's'} de costo`; },

    cuentasOrdenadas() { return [...this.cuentas].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })); },
    cuentasImputablesOrdenadas() {
      return [...this.cuentas].filter(c => c.imputable).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    },
    cuentasImputablesActivasOrdenadas() {
      return [...this.cuentas].filter(c => c.imputable && c.activa).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    },
    centrosActivosOrdenados() {
      return [...this.centros].filter(c => c.activo).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    },
    cuentaParentOptions() {
      return [...this.cuentas]
        .filter(c => c.id !== this.cuentaModal.editId)
        .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    },
    naturalezaHint() { return NATURALEZA_LABEL[NATURALEZA_POR_TIPO[this.cuentaModal.tipo] || 'DEUDORA']; },

    ejerciciosOrdenados() { return [...this.ejercicios].sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio)); },
    centrosOrdenados() { return [...this.centros].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })); },

    asientosPage() { return Math.floor(this.asientosResult.pagination.skip / this.asientosResult.pagination.take) + 1; },

    // Recalculado en vivo mientras se editan las líneas del asiento —
    // reemplaza recalcularTotales() (antes disparado por el listener 'input').
    asientoTotales() {
      let totalDebe = 0, totalHaber = 0;
      this.asientoModal.rows.forEach(r => {
        totalDebe += parseFloat(r.debe) || 0;
        totalHaber += parseFloat(r.haber) || 0;
      });
      const diff = totalDebe - totalHaber;
      const balanceado = Math.abs(diff) < 0.005 && totalDebe > 0;
      const escala = Math.max(totalDebe, totalHaber, 1);
      const tilt = Math.max(-12, Math.min(12, (diff / escala) * 12));
      return { totalDebe, totalHaber, diff, balanceado, tilt: balanceado ? 0 : tilt };
    },

    efectivoCuentas() { return this.balances ? this.balances.cuentas.filter(c => c.esEfectivo) : []; },
    cajaSubText() {
      if (!this.balances) return '';
      return this.efectivoCuentas.length ? this.efectivoCuentas.map(c => c.nombre).join(' + ') : '⚠ Marcá una cuenta como efectivo en el Plan de Cuentas';
    },
    cajaSubWarn() { return !!this.balances && this.efectivoCuentas.length === 0; },
    pnSubText() {
      if (!this.balances) return '';
      const t = this.balances.totales;
      return `Activo $ ${this.fmtMoneyAcc(t.activo)} − Pasivo $ ${this.fmtMoneyAcc(t.pasivo)} · Resultado $ ${this.fmtMoneyAcc(t.resultadoEjercicio)}`;
    },

    balcompOkSumas() { return !!this.balcomp.rows && Math.abs(this.balcomp.tD - this.balcomp.tH) < 0.005; },
    balcompOkSaldos() { return !!this.balcomp.rows && Math.abs(this.balcomp.tSD - this.balcomp.tSA) < 0.005; },

    espComputed() {
      if (!this.esp.bal) return null;
      const t = this.esp.bal.totales;
      const resultado = Number(t.resultadoEjercicio);
      const pnTotal = Number(t.patrimonioNetoContable) + resultado;
      const activo = Number(t.activo), pasivo = Number(t.pasivo);
      return {
        resultado, pnTotal, activo, pasivo,
        cuadra: Math.abs(activo - (pasivo + pnTotal)) < 0.005,
        activoCuentas: this.saldosPorTipo(this.esp.bal, 'ACTIVO'),
        pasivoCuentas: this.saldosPorTipo(this.esp.bal, 'PASIVO'),
        pnCuentas: this.saldosPorTipo(this.esp.bal, 'PATRIMONIO_NETO'),
      };
    },
    erComputed() {
      if (!this.er.bal) return null;
      const t = this.er.bal.totales;
      const ingresos = Number(t.ingresos), egresos = Number(t.egresos), resultado = Number(t.resultadoEjercicio);
      return {
        ingresos, egresos, resultado, gana: resultado >= 0,
        ingresosCuentas: this.saldosPorTipo(this.er.bal, 'INGRESO'),
        egresosCuentas: this.saldosPorTipo(this.er.bal, 'EGRESO'),
      };
    },
  },
  methods: {
    ekCan,
    fmtMoneyAcc(n) { return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    money(n) { return '$ ' + this.fmtMoneyAcc(Number(n) || 0); },
    fmtDateAcc(d) { return d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR') : '—'; },
    tipoCuentaLabel(t) { return TIPO_CUENTA_LABEL[t] || t; },
    naturalezaLabel(n) { return NATURALEZA_LABEL[n] || n; },
    estadoAbiertoBadge(e) { return ESTADO_ABIERTO_BADGE[e] || 'badge-gray'; },
    asientoEstadoBadge(e) { return ASIENTO_ESTADO_BADGE[e] || 'badge-gray'; },
    asientoEstadoLabel(e) { return ASIENTO_ESTADO_LABEL[e] || e; },
    totalDebe(asiento) { return asiento.detalles.reduce((n, d) => n + Number(d.debe), 0); },

    nivelDeCuenta(cuenta) {
      let nivel = 0;
      let cursor = cuenta;
      const byId = Object.fromEntries(this.cuentas.map(c => [c.id, c]));
      while (cursor && cursor.parentId) {
        nivel++;
        cursor = byId[cursor.parentId];
        if (nivel > 20) break; // guarda contra ciclos inesperados
      }
      return nivel;
    },

    // ── Entry point público — lo llama loadAccountingPanel() más abajo ────
    async setSuit(suitId, suitName) {
      this.suitId = suitId;
      this.suitName = suitName;
      this.balances = null;
      const labelEl = document.getElementById('accounting-suit-label');
      if (labelEl) labelEl.textContent = `Contabilidad de ${suitName}`;
      this.currentView = 'home';
      await this.refreshCore();
      await this.refreshBalances({ animate: false });
      await this.refreshHome();
    },

    backToHome() { this.currentView = 'home'; this.refreshHome(); },

    async refreshCore() {
      if (!this.suitId) return;
      try {
        const [cuentas, ejercicios, centros] = await Promise.all([
          listCuentas(this.suitId), listEjercicios(this.suitId), listCentros(this.suitId),
        ]);
        this.cuentas = cuentas; this.ejercicios = ejercicios; this.centros = centros;
      } catch (err) {
        showToast(err.message || 'No se pudo cargar la información contable', 'err');
      }
      this.periodosByEjercicio = {};
      this.openEjercicios = {};
    },

    async refreshHome() {
      if (!this.suitId) return;
      try {
        const confirmados = await listAsientos(this.suitId, { estado: 'confirmado', take: 1 });
        const n = confirmados.pagination.total;
        this.asientosConfirmadosLabel = `${n} asiento${n === 1 ? '' : 's'} confirmado${n === 1 ? '' : 's'}`;
      } catch (err) {
        this.asientosConfirmadosLabel = 'No se pudo cargar';
      }
    },

    // ── HUD: saldos en vivo + animaciones ─────────────────────────────────
    accReducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; },
    animateNumber(el, from, to, { duration = 700 } = {}) {
      if (!el) return;
      from = Number(from) || 0;
      to = Number(to) || 0;
      if (this.accReducedMotion() || from === to) {
        el.textContent = '$ ' + this.fmtMoneyAcc(to);
        return;
      }
      const start = performance.now();
      if (el._accRaf) cancelAnimationFrame(el._accRaf);
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = '$ ' + this.fmtMoneyAcc(from + (to - from) * eased);
        if (t < 1) el._accRaf = requestAnimationFrame(step);
        else el._accRaf = null;
      };
      el._accRaf = requestAnimationFrame(step);
    },
    updateHudIndicator(hudEl, valEl, from, to, animate) {
      if (!hudEl || !valEl) return;
      if (!animate) { valEl.textContent = '$ ' + this.fmtMoneyAcc(to); return; }
      this.animateNumber(valEl, from, to);
      const dir = to > from ? 'acc-up' : (to < from ? 'acc-down' : null);
      hudEl.classList.remove('acc-up', 'acc-down');
      if (dir && !this.accReducedMotion()) {
        void hudEl.offsetWidth; // reflow para reiniciar la animación si se dispara dos veces seguidas
        hudEl.classList.add(dir);
        setTimeout(() => hudEl.classList.remove(dir), 1100);
      }
    },
    spawnCoinFlow() {
      const fx = this.$refs.hudCajaFx;
      if (!fx || this.accReducedMotion()) return;
      for (let i = 0; i < 3; i++) {
        const coin = document.createElement('span');
        coin.className = 'acc-coin';
        coin.textContent = '🪙';
        coin.style.animationDelay = (i * 120) + 'ms';
        coin.style.setProperty('--dx', ((i - 1) * 18) + 'px');
        coin.addEventListener('animationend', () => coin.remove());
        fx.appendChild(coin);
      }
    },
    async refreshBalances({ animate = false, flujoCuentaIds = [] } = {}) {
      if (!this.suitId) return;
      let balances;
      try {
        balances = await getBalances(this.suitId);
      } catch (err) {
        // El HUD es accesorio: si falla, no rompemos el panel.
        console.warn('[accounting] no se pudieron cargar los saldos:', err.message);
        return;
      }

      const prev = this.balances;
      const fromCaja = prev ? Number(prev.caja) : Number(balances.caja);
      const fromPn   = prev ? Number(prev.patrimonioNeto) : Number(balances.patrimonioNeto);
      this.balances = balances;

      this.updateHudIndicator(this.$refs.hudCaja, this.$refs.hudCajaValue, fromCaja, Number(balances.caja), animate && !!prev);
      this.updateHudIndicator(this.$refs.hudPn,   this.$refs.hudPnValue,   fromPn,   Number(balances.patrimonioNeto), animate && !!prev);

      if (animate && flujoCuentaIds.length) {
        const efectivoIds = new Set(balances.cuentas.filter(c => c.esEfectivo).map(c => c.id));
        if (flujoCuentaIds.some(id => efectivoIds.has(id))) this.spawnCoinFlow();
      }
    },

    // ══════════════════════════════════════════════════════════════════
    // PLAN DE CUENTAS
    // ══════════════════════════════════════════════════════════════════
    enterCuentas() { this.currentView = 'cuentas'; },
    openCuentaModal(id) {
      const cuenta = id ? this.cuentas.find(c => c.id === id) : null;
      this.cuentaModal = {
        open: true, editId: id || null,
        codigo: cuenta?.codigo || '', nombre: cuenta?.nombre || '',
        tipo: cuenta?.tipo || 'ACTIVO',
        parentId: cuenta?.parentId || '',
        imputable: cuenta ? cuenta.imputable : true,
        esEfectivo: cuenta ? !!cuenta.esEfectivo : false,
        activa: cuenta ? cuenta.activa : true,
        saving: false,
      };
    },
    closeCuentaModal() { this.cuentaModal.open = false; },
    async saveCuenta() {
      const m = this.cuentaModal;
      const codigo = m.codigo.trim();
      const nombre = m.nombre.trim();
      if (!codigo) { showToast('El código es obligatorio', 'err'); return; }
      if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }

      m.saving = true;
      try {
        if (m.editId) {
          await updateCuenta(this.suitId, m.editId, { codigo, nombre, tipo: m.tipo, parentId: m.parentId || null, imputable: m.imputable, esEfectivo: m.esEfectivo, activa: m.activa });
          showToast('Cuenta actualizada');
        } else {
          await createCuenta(this.suitId, { codigo, nombre, tipo: m.tipo, parentId: m.parentId || undefined, imputable: m.imputable, esEfectivo: m.esEfectivo });
          showToast('Cuenta creada');
        }
        this.closeCuentaModal();
        this.cuentas = await listCuentas(this.suitId);
        await this.refreshBalances({ animate: false }); // esEfectivo puede cambiar el saldo de Caja
      } catch (err) {
        showToast(err.message || 'No se pudo guardar la cuenta', 'err');
      } finally {
        m.saving = false;
      }
    },
    confirmDeleteCuenta(cuenta) {
      openConfirmModal({
        message: '¿Eliminar esta cuenta contable?',
        onConfirm: async () => {
          try {
            await deleteCuenta(this.suitId, cuenta.id);
            showToast('Cuenta eliminada');
            this.cuentas = await listCuentas(this.suitId);
            await this.refreshBalances({ animate: false });
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar la cuenta', 'err');
          }
        },
      });
    },

    // ══════════════════════════════════════════════════════════════════
    // EJERCICIOS + PERÍODOS
    // ══════════════════════════════════════════════════════════════════
    enterEjercicios() { this.currentView = 'ejercicios'; },
    periodosOrdenados(ejercicioId) {
      return [...(this.periodosByEjercicio[ejercicioId] || [])].sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
    },
    async toggleEjercicio(ejercicioId) {
      this.openEjercicios[ejercicioId] = !this.openEjercicios[ejercicioId];
      if (this.openEjercicios[ejercicioId] && !this.periodosByEjercicio[ejercicioId]) {
        try {
          this.periodosByEjercicio[ejercicioId] = await listPeriodos(this.suitId, ejercicioId);
        } catch (err) {
          this.periodosByEjercicio[ejercicioId] = [];
          showToast(err.message || 'No se pudieron cargar los períodos', 'err');
        }
      }
    },

    openEjercicioModal(id) {
      const ej = id ? this.ejercicios.find(e => e.id === id) : null;
      this.ejercicioModal = {
        open: true, editId: id || null,
        nombre: ej?.nombre || '',
        fechaInicio: ej ? ej.fechaInicio.slice(0, 10) : '',
        fechaFin: ej ? ej.fechaFin.slice(0, 10) : '',
        saving: false,
      };
    },
    closeEjercicioModal() { this.ejercicioModal.open = false; },
    async saveEjercicio() {
      const m = this.ejercicioModal;
      const nombre = m.nombre.trim();
      if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
      if (!m.fechaInicio || !m.fechaFin) { showToast('Completá las dos fechas', 'err'); return; }

      m.saving = true;
      try {
        if (m.editId) {
          await updateEjercicio(this.suitId, m.editId, { nombre, fechaInicio: m.fechaInicio, fechaFin: m.fechaFin });
          showToast('Ejercicio actualizado');
        } else {
          await createEjercicio(this.suitId, { nombre, fechaInicio: m.fechaInicio, fechaFin: m.fechaFin });
          showToast('Ejercicio creado');
        }
        this.closeEjercicioModal();
        this.ejercicios = await listEjercicios(this.suitId);
        this.openEjercicios = {};
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el ejercicio', 'err');
      } finally {
        m.saving = false;
      }
    },
    confirmCerrarEjercicio(ej) {
      openConfirmModal({
        message: '¿Cerrar este ejercicio? Hace falta que todos sus períodos estén cerrados.',
        onConfirm: () => this.runEjercicioAction(ej.id, 'cerrar'),
      });
    },
    async runEjercicioAction(id, action) {
      try {
        await changeEjercicioStatus(this.suitId, id, action);
        showToast(action === 'cerrar' ? 'Ejercicio cerrado' : 'Ejercicio reabierto');
        this.ejercicios = await listEjercicios(this.suitId);
        this.openEjercicios = {};
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar el ejercicio', 'err');
      }
    },

    openPeriodoModal(ejercicioId, id) {
      const periodos = this.periodosByEjercicio[ejercicioId] || [];
      const periodo = id ? periodos.find(p => p.id === id) : null;
      this.periodoModal = {
        open: true, ejercicioId, editId: id || null,
        nombre: periodo?.nombre || '',
        fechaInicio: periodo ? periodo.fechaInicio.slice(0, 10) : '',
        fechaFin: periodo ? periodo.fechaFin.slice(0, 10) : '',
        saving: false,
      };
    },
    closePeriodoModal() { this.periodoModal.open = false; },
    async savePeriodo() {
      const m = this.periodoModal;
      const nombre = m.nombre.trim();
      if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
      if (!m.editId && (!m.fechaInicio || !m.fechaFin)) { showToast('Completá las dos fechas', 'err'); return; }

      m.saving = true;
      try {
        if (m.editId) {
          // Las fechas de un período no se re-editan una vez creado, solo el nombre.
          await updatePeriodo(this.suitId, m.ejercicioId, m.editId, { nombre });
          showToast('Período actualizado');
        } else {
          await createPeriodo(this.suitId, m.ejercicioId, { nombre, fechaInicio: m.fechaInicio, fechaFin: m.fechaFin });
          showToast('Período creado');
        }
        this.periodosByEjercicio[m.ejercicioId] = await listPeriodos(this.suitId, m.ejercicioId);
        this.closePeriodoModal();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el período', 'err');
      } finally {
        m.saving = false;
      }
    },
    async runPeriodoAction(ejercicioId, id, action) {
      try {
        await changePeriodoStatus(this.suitId, ejercicioId, id, action);
        this.periodosByEjercicio[ejercicioId] = await listPeriodos(this.suitId, ejercicioId);
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar el período', 'err');
      }
    },
    confirmDeletePeriodo(ejercicioId, p) {
      openConfirmModal({
        message: '¿Eliminar este período?',
        onConfirm: async () => {
          try {
            await deletePeriodo(this.suitId, ejercicioId, p.id);
            showToast('Período eliminado');
            this.periodosByEjercicio[ejercicioId] = await listPeriodos(this.suitId, ejercicioId);
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el período', 'err');
          }
        },
      });
    },

    // ══════════════════════════════════════════════════════════════════
    // CENTROS DE COSTO
    // ══════════════════════════════════════════════════════════════════
    enterCentros() { this.currentView = 'centros'; },
    openCentroModal(id) {
      const centro = id ? this.centros.find(c => c.id === id) : null;
      this.centroModal = {
        open: true, editId: id || null,
        codigo: centro?.codigo || '', nombre: centro?.nombre || '',
        activo: centro ? centro.activo : true,
        saving: false,
      };
    },
    closeCentroModal() { this.centroModal.open = false; },
    async saveCentro() {
      const m = this.centroModal;
      const codigo = m.codigo.trim();
      const nombre = m.nombre.trim();
      if (!codigo) { showToast('El código es obligatorio', 'err'); return; }
      if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }

      m.saving = true;
      try {
        if (m.editId) {
          await updateCentro(this.suitId, m.editId, { codigo, nombre, activo: m.activo });
          showToast('Centro de costo actualizado');
        } else {
          await createCentro(this.suitId, { codigo, nombre });
          showToast('Centro de costo creado');
        }
        this.closeCentroModal();
        this.centros = await listCentros(this.suitId);
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el centro de costo', 'err');
      } finally {
        m.saving = false;
      }
    },
    confirmDeleteCentro(centro) {
      openConfirmModal({
        message: '¿Eliminar este centro de costo?',
        onConfirm: async () => {
          try {
            await deleteCentro(this.suitId, centro.id);
            showToast('Centro de costo eliminado');
            this.centros = await listCentros(this.suitId);
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el centro de costo', 'err');
          }
        },
      });
    },

    // ══════════════════════════════════════════════════════════════════
    // LIBRO DIARIO (ASIENTOS)
    // ══════════════════════════════════════════════════════════════════
    enterAsientos() { this.currentView = 'asientos'; this.fetchAsientos(); },
    onAsientosFilterChange() { this.asientosQuery.skip = 0; this.fetchAsientos(); },
    limpiarFiltrosAsientos() {
      this.asientosQuery = { ejercicioId: '', estado: '', desde: '', hasta: '', cuentaId: '', comprobante: '', skip: 0, take: ASIENTOS_PER_PAGE };
      this.fetchAsientos();
    },
    async fetchAsientos() {
      this.asientosStatus = 'loading';
      this.openAsientos = {}; // cada fetch re-renderiza la lista: los acordeones vuelven a colapsarse
      try {
        this.asientosResult = await listAsientos(this.suitId, this.asientosQuery);
        this.asientosStatus = 'ok';
      } catch (err) {
        this.asientosStatus = 'error';
        this.asientosError = err.message;
      }
    },
    toggleAsiento(id) { this.openAsientos[id] = !this.openAsientos[id]; },
    asientosPrev() { this.asientosQuery.skip = Math.max(0, this.asientosQuery.skip - this.asientosQuery.take); this.fetchAsientos(); },
    asientosNext() { this.asientosQuery.skip += this.asientosQuery.take; this.fetchAsientos(); },

    // Trae TODOS los asientos que matchean el filtro actual (paginando) y baja un CSV.
    async exportAsientosCsv() {
      this.exportingAsientos = true;
      try {
        const all = [];
        let skip = 0;
        const take = 200;
        for (;;) {
          const page = await listAsientos(this.suitId, { ...this.asientosQuery, skip, take });
          all.push(...page.data);
          skip += take;
          if (skip >= page.pagination.total || !page.data.length) break;
        }
        const rows = [];
        all.forEach(a => a.detalles.forEach(d => rows.push([
          this.fmtDateAcc(a.fecha), a.numero, a.comprobante || '', a.descripcion,
          `${d.cuenta.codigo} — ${d.cuenta.nombre}`, d.centroCosto ? d.centroCosto.nombre : '',
          Number(d.debe) || 0, Number(d.haber) || 0, ASIENTO_ESTADO_LABEL[a.estado] || a.estado,
        ])));
        downloadCsv(`libro-diario-${new Date().toISOString().slice(0, 10)}`,
          ['Fecha', 'N°', 'Comprobante', 'Descripción', 'Cuenta', 'Centro de costo', 'Debe', 'Haber', 'Estado'], rows);
      } catch (err) {
        showToast(err.message || 'No se pudo exportar', 'err');
      } finally {
        this.exportingAsientos = false;
      }
    },

    newDetalleRow() {
      const first = this.cuentasImputablesActivasOrdenadas[0];
      this._rowSeq = (this._rowSeq || 0) + 1;
      return { id: this._rowSeq, cuentaId: first ? first.id : '', centroCostoId: '', debe: '', haber: '' };
    },
    openAsientoModal() {
      if (!this.cuentasImputablesActivasOrdenadas.length) {
        showToast('No hay cuentas imputables activas. Creá al menos una cuenta en el Plan de Cuentas primero.', 'err');
        return;
      }
      this.asientoModal = {
        open: true,
        fecha: new Date().toISOString().slice(0, 10),
        descripcion: '', comprobante: '',
        rows: [this.newDetalleRow(), this.newDetalleRow()],
        saving: false,
      };
    },
    closeAsientoModal() { this.asientoModal.open = false; },
    addDetalleRow() { this.asientoModal.rows.push(this.newDetalleRow()); },
    removeDetalleRow(rowId) { this.asientoModal.rows = this.asientoModal.rows.filter(r => r.id !== rowId); },

    async saveAsiento() {
      const m = this.asientoModal;
      const fecha = m.fecha;
      const descripcion = m.descripcion.trim();
      const comprobante = m.comprobante.trim();
      if (!fecha) { showToast('Elegí una fecha', 'err'); return; }
      if (!descripcion) { showToast('La descripción es obligatoria', 'err'); return; }

      const detalles = [];
      let filasInvalidas = false;
      m.rows.forEach(row => {
        const debe  = parseFloat(row.debe)  || 0;
        const haber = parseFloat(row.haber) || 0;
        if (debe > 0 && haber > 0) filasInvalidas = true;
        if (debe === 0 && haber === 0) return; // ignora filas vacías
        detalles.push({ cuentaId: row.cuentaId, centroCostoId: row.centroCostoId || undefined, debe, haber });
      });

      if (filasInvalidas) { showToast('Una línea no puede tener importe en debe y en haber a la vez', 'err'); return; }
      if (detalles.length < 2) { showToast('Un asiento necesita al menos dos líneas con importe (partida doble)', 'err'); return; }

      const totalDebe  = detalles.reduce((n, d) => n + d.debe, 0);
      const totalHaber = detalles.reduce((n, d) => n + d.haber, 0);
      if (Math.abs(totalDebe - totalHaber) >= 0.005) { showToast('El asiento no está balanceado', 'err'); return; }

      const payload = { fecha, descripcion, ...(comprobante && { comprobante }), detalles };

      m.saving = true;
      try {
        await createAsiento(this.suitId, payload);
        showToast('Asiento guardado en borrador. Confirmalo desde el Libro Diario.');
        this.closeAsientoModal();
        this.asientosQuery.skip = 0;
        await this.fetchAsientos();
        await this.refreshHome();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el asiento', 'err');
      } finally {
        m.saving = false;
      }
    },
    confirmAnularAsiento(asiento) {
      openConfirmModal({
        message: '¿Anular este asiento? Esta acción no genera un contra-asiento automático.',
        onConfirm: () => this.runAsientoAction(asiento.id, 'anular'),
      });
    },
    confirmDeleteAsiento(asiento) {
      openConfirmModal({
        message: '¿Eliminar este borrador de asiento?',
        onConfirm: async () => {
          try {
            await deleteAsiento(this.suitId, asiento.id);
            showToast('Asiento eliminado');
            await this.fetchAsientos();
            await this.refreshHome();
          } catch (err) {
            showToast(err.message || 'No se pudo eliminar el asiento', 'err');
          }
        },
      });
    },
    async runAsientoAction(id, action) {
      const asiento = this.asientosResult.data.find(a => a.id === id);
      const flujoCuentaIds = asiento ? asiento.detalles.map(d => d.cuentaId) : [];
      try {
        await changeAsientoStatus(this.suitId, id, action);
        showToast(action === 'confirmar' ? 'Asiento confirmado' : 'Asiento anulado');
        await this.fetchAsientos();
        await this.refreshHome();
        // Confirmar y anular ambos mueven saldos (anular saca el asiento del cálculo).
        await this.refreshBalances({ animate: true, flujoCuentaIds });
      } catch (err) {
        showToast(err.message || 'No se pudo actualizar el asiento', 'err');
      }
    },

    // ══════════════════════════════════════════════════════════════════
    // REPORTES: Libro Mayor · Balance de comprobación · Estados contables
    // ══════════════════════════════════════════════════════════════════
    saldosPorTipo(bal, tipo) { return bal.cuentas.filter(c => c.tipo === tipo && Math.abs(Number(c.saldo)) > 0.005); },
    reportHeaderHtml(titulo, opts) {
      const partes = [];
      if (opts.ejercicioId) {
        const ej = this.ejercicios.find(e => e.id === opts.ejercicioId);
        if (ej) partes.push(esc(ej.nombre));
      } else {
        partes.push('Todos los ejercicios');
      }
      partes.push(opts.hasta ? `al ${this.fmtDateAcc(opts.hasta)}` : 'a la fecha');
      return `<h1>${esc(titulo)}</h1><p class="rep-sub">${esc(this.suitName)} · ${partes.join(' · ')} · sólo asientos confirmados</p>`;
    },
    estadoFilas(bal, bloques) {
      const out = [];
      bloques.forEach(([titulo, tipo, total, extra]) => {
        out.push([titulo, '', '']);
        this.saldosPorTipo(bal, tipo).forEach(c => out.push([c.codigo, c.nombre, Number(c.saldo)]));
        (extra || []).forEach(r => out.push(r));
        out.push([`Total ${titulo}`, '', total]);
      });
      return out;
    },

    // ── Libro Mayor ────────────────────────────────────────────────────
    enterMayor() { this.currentView = 'mayor'; this.renderMayor(); },
    async renderMayor() {
      const cuentaId = this.mayor.cuentaId;
      this.mayor.data = null;
      if (!cuentaId) { this.mayor.status = 'idle'; return; }

      this.mayor.status = 'loading';
      try {
        const opts = {
          cuentaId,
          ejercicioId: this.mayor.ejercicioId || undefined,
          desde: this.mayor.desde || undefined,
          hasta: this.mayor.hasta || undefined,
        };
        this.mayor.data = await getMayor(this.suitId, opts);
        this.mayor.status = 'ok';
      } catch (err) {
        this.mayor.status = 'error';
        this.mayor.error = err.message;
      }
    },
    exportMayorCsv() {
      if (!this.mayor.data) { showToast('Elegí una cuenta primero', 'err'); return; }
      const m = this.mayor.data;
      const rows = [['', '', '', 'Saldo inicial', '', '', m.saldoInicial]];
      m.movimientos.forEach(mv => rows.push([this.fmtDateAcc(mv.fecha), mv.numero, mv.comprobante || '', mv.descripcion, Number(mv.debe) || 0, Number(mv.haber) || 0, mv.saldo]));
      rows.push(['', '', '', 'Totales del período', m.totales.debe, m.totales.haber, m.saldoFinal]);
      downloadCsv(`libro-mayor-${slugify(m.cuenta.nombre)}`,
        ['Fecha', 'N°', 'Comprobante', 'Descripción', 'Debe', 'Haber', 'Saldo'], rows);
    },

    // ── Balance de comprobación (sumas y saldos) ────────────────────────
    enterBalComp() { this.currentView = 'balcomp'; this.renderBalComp(); },
    async renderBalComp() {
      this.balcomp.status = 'loading';
      try {
        const opts = { ejercicioId: this.balcomp.ejercicioId || undefined, hasta: this.balcomp.hasta || undefined };
        const bal = await getBalances(this.suitId, opts);
        const cuentas = bal.cuentas.filter(c => Number(c.debe) || Number(c.haber));
        let tD = 0, tH = 0, tSD = 0, tSA = 0;
        const rows = cuentas.map(c => {
          const debe = Number(c.debe), haber = Number(c.haber), raw = debe - haber;
          const sd = raw > 0 ? raw : 0, sa = raw < 0 ? -raw : 0;
          tD += debe; tH += haber; tSD += sd; tSA += sa;
          return { codigo: c.codigo, nombre: c.nombre, debe, haber, sd, sa };
        });
        this.balcomp = { ...this.balcomp, status: 'ok', rows, tD, tH, tSD, tSA };
      } catch (err) {
        this.balcomp.status = 'error';
        this.balcomp.error = err.message;
      }
    },
    exportBalCompCsv() {
      if (!this.balcomp.rows) return;
      const rows = this.balcomp.rows.map(c => [c.codigo, c.nombre, c.debe, c.haber, c.sd, c.sa]);
      rows.push(['', 'TOTALES', this.balcomp.tD, this.balcomp.tH, this.balcomp.tSD, this.balcomp.tSA]);
      downloadCsv(`balance-comprobacion-${new Date().toISOString().slice(0, 10)}`,
        ['Código', 'Cuenta', 'Sumas Debe', 'Sumas Haber', 'Saldo Deudor', 'Saldo Acreedor'], rows);
    },
    printBalComp() {
      if (!this.balcomp.rows) { showToast('Esperá a que cargue el reporte', 'err'); return; }
      const html = this.reportHeaderHtml('Balance de comprobación', { ejercicioId: this.balcomp.ejercicioId, hasta: this.balcomp.hasta }) + this.$refs.balcompResult.innerHTML;
      printReport('Balance de comprobación', html);
    },

    // ── Estados contables (comparten getBalances) ───────────────────────
    enterEsp() { this.currentView = 'esp'; this.renderEsp(); },
    async renderEsp() {
      this.esp.status = 'loading';
      try {
        const opts = { ejercicioId: this.esp.ejercicioId || undefined, hasta: this.esp.hasta || undefined };
        this.esp.bal = await getBalances(this.suitId, opts);
        this.esp.status = 'ok';
      } catch (err) {
        this.esp.status = 'error';
        this.esp.error = err.message;
      }
    },
    exportEspCsv() {
      if (!this.esp.bal) return;
      const t = this.esp.bal.totales;
      const resultado = Number(t.resultadoEjercicio);
      const rows = this.estadoFilas(this.esp.bal, [
        ['ACTIVO', 'ACTIVO', Number(t.activo)],
        ['PASIVO', 'PASIVO', Number(t.pasivo)],
        ['PATRIMONIO NETO', 'PATRIMONIO_NETO', Number(t.patrimonioNetoContable) + resultado, [['Resultado del ejercicio', '', resultado]]],
      ]);
      downloadCsv(`estado-situacion-patrimonial-${new Date().toISOString().slice(0, 10)}`, ['Concepto', 'Cuenta', 'Importe'], rows);
    },
    printEsp() {
      if (!this.esp.bal) { showToast('Esperá a que cargue el reporte', 'err'); return; }
      const html = this.reportHeaderHtml('Estado de Situación Patrimonial', { ejercicioId: this.esp.ejercicioId, hasta: this.esp.hasta }) + this.$refs.espResult.innerHTML;
      printReport('Estado de Situación Patrimonial', html);
    },

    enterEr() { this.currentView = 'er'; this.renderEr(); },
    async renderEr() {
      this.er.status = 'loading';
      try {
        const opts = { ejercicioId: this.er.ejercicioId || undefined, hasta: this.er.hasta || undefined };
        this.er.bal = await getBalances(this.suitId, opts);
        this.er.status = 'ok';
      } catch (err) {
        this.er.status = 'error';
        this.er.error = err.message;
      }
    },
    exportErCsv() {
      if (!this.er.bal) return;
      const t = this.er.bal.totales;
      const rows = this.estadoFilas(this.er.bal, [
        ['INGRESOS', 'INGRESO', Number(t.ingresos)],
        ['EGRESOS', 'EGRESO', Number(t.egresos)],
      ]);
      rows.push(['RESULTADO DEL EJERCICIO', '', Number(t.resultadoEjercicio)]);
      downloadCsv(`estado-de-resultados-${new Date().toISOString().slice(0, 10)}`, ['Concepto', 'Cuenta', 'Importe'], rows);
    },
    printEr() {
      if (!this.er.bal) { showToast('Esperá a que cargue el reporte', 'err'); return; }
      const html = this.reportHeaderHtml('Estado de Resultados', { ejercicioId: this.er.ejercicioId, hasta: this.er.hasta }) + this.$refs.erResult.innerHTML;
      printReport('Estado de Resultados', html);
    },
  },
  template: `
    <!-- ── HUD: Caja + Patrimonio Neto, sticky arriba del panel ─────── -->
    <div class="acc-hud-bar">
      <div class="acc-hud" ref="hudCaja" aria-live="polite">
        <div class="acc-hud-label">💵 Caja</div>
        <div class="acc-hud-value" ref="hudCajaValue">—</div>
        <div class="acc-hud-sub" :class="{ 'acc-hud-warn': cajaSubWarn }">{{ cajaSubText }}</div>
        <div class="acc-hud-fx" ref="hudCajaFx" aria-hidden="true"></div>
      </div>
      <div class="acc-hud" ref="hudPn" aria-live="polite">
        <div class="acc-hud-label">📊 Patrimonio Neto</div>
        <div class="acc-hud-value" ref="hudPnValue">—</div>
        <div class="acc-hud-sub">{{ pnSubText }}</div>
      </div>
    </div>

    <!-- ── Home ───────────────────────────────────────────────────── -->
    <div v-if="currentView === 'home'">
      <div class="acc-home-add">
        <button v-if="ekCan('accounting', 'create')" class="primary-btn" @click="openAsientoModal">+ Agregar asiento</button>
        <p class="crm-muted acc-home-add-hint">Se guarda como borrador. La confirmación se hace desde el Libro Diario.</p>
      </div>
      <div class="module-nav-grid acc-nav-grid">
        <button class="module-nav-card" @click="enterCuentas">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>
          </div>
          <div class="module-nav-title">Plan de Cuentas</div>
          <div class="module-nav-desc">{{ cuentasCountLabel }}</div>
        </button>
        <button class="module-nav-card" @click="enterEjercicios">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="module-nav-title">Ejercicios</div>
          <div class="module-nav-desc">{{ ejerciciosCountLabel }}</div>
        </button>
        <button class="module-nav-card" @click="enterCentros">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          </div>
          <div class="module-nav-title">Centros de Costo</div>
          <div class="module-nav-desc">{{ centrosCountLabel }}</div>
        </button>
        <button class="module-nav-card" @click="enterAsientos">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </div>
          <div class="module-nav-title">Libro Diario</div>
          <div class="module-nav-desc">{{ asientosConfirmadosLabel }}</div>
        </button>
      </div>

      <div class="crm-section-title" style="margin-top:1.5rem">Reportes</div>
      <div class="module-nav-grid acc-nav-grid">
        <button class="module-nav-card" @click="enterMayor">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </div>
          <div class="module-nav-title">Libro Mayor</div>
          <div class="module-nav-desc">Movimientos por cuenta, con saldo</div>
        </button>
        <button class="module-nav-card" @click="enterBalComp">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 8l-3 6h6z"/><path d="M22 14l-3-6-3 6z"/><path d="M2 14a4 4 0 0 0 8 0"/><path d="M14 14a4 4 0 0 0 8 0"/><path d="M5 8h14"/></svg>
          </div>
          <div class="module-nav-title">Balance de comprobación</div>
          <div class="module-nav-desc">Sumas y saldos de todas las cuentas</div>
        </button>
        <button class="module-nav-card" @click="enterEsp">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="12" y1="9" x2="12" y2="21"/></svg>
          </div>
          <div class="module-nav-title">Estado de Situación Patrimonial</div>
          <div class="module-nav-desc">Activo = Pasivo + Patrimonio Neto</div>
        </button>
        <button class="module-nav-card" @click="enterEr">
          <div class="module-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>
          </div>
          <div class="module-nav-title">Estado de Resultados</div>
          <div class="module-nav-desc">Ingresos − Egresos = Ganancia / Pérdida</div>
        </button>
      </div>
    </div>

    <!-- ── Plan de Cuentas ────────────────────────────────────────── -->
    <div v-else-if="currentView === 'cuentas'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <button v-if="ekCan('accounting', 'create')" class="primary-btn" @click="openCuentaModal(null)">+ Nueva cuenta</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="!cuentas.length" class="crm-muted">Todavía no hay cuentas. Creá la primera del plan de cuentas.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th></th><th></th></tr></thead>
            <tbody>
              <tr v-for="cuenta in cuentasOrdenadas" :key="cuenta.id" :class="{ 'crm-muted': !cuenta.activa }">
                <td>{{ cuenta.codigo }}</td>
                <td :style="{ paddingLeft: (1 + nivelDeCuenta(cuenta) * 1.25) + 'rem' }">{{ cuenta.nombre }}</td>
                <td><span class="crm-badge badge-blue">{{ tipoCuentaLabel(cuenta.tipo) }}</span></td>
                <td>
                  <span v-if="cuenta.esEfectivo" class="crm-badge badge-green" title="Equivalente de efectivo — suma al indicador de Caja">💵 Efectivo</span>
                  <span v-if="!cuenta.imputable" class="crm-badge badge-gray" title="No admite asientos directos">Agrupamiento</span>
                  <span v-if="!cuenta.activa" class="crm-badge badge-red">Inactiva</span>
                </td>
                <td class="td-actions">
                  <span v-if="ekCan('accounting', 'write')" class="crm-action-btn" title="Editar" @click="openCuentaModal(cuenta.id)">✎</span>
                  <span v-if="ekCan('accounting', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="confirmDeleteCuenta(cuenta)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── Ejercicios + Períodos ──────────────────────────────────── -->
    <div v-else-if="currentView === 'ejercicios'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <button v-if="ekCan('accounting', 'create')" class="primary-btn" @click="openEjercicioModal(null)">+ Nuevo Ejercicio</button>
        </div>
        <div class="sprint-list">
          <p v-if="!ejercicios.length" class="crm-muted">No hay ejercicios todavía. Creá el primero.</p>
          <div v-for="ej in ejerciciosOrdenados" :key="ej.id" class="sprint-card">
            <div class="sprint-card-header" @click="toggleEjercicio(ej.id)">
              <span class="sprint-toggle" :class="{ open: openEjercicios[ej.id] }">▸</span>
              <span class="sprint-card-title">{{ ej.nombre }}</span>
              <span class="crm-badge" :class="estadoAbiertoBadge(ej.estado)">{{ ej.estado === 'abierto' ? 'Abierto' : 'Cerrado' }}</span>
              <span class="sprint-card-meta">{{ fmtDateAcc(ej.fechaInicio) }} – {{ fmtDateAcc(ej.fechaFin) }}</span>
            </div>
            <div class="sprint-card-body" :class="{ open: openEjercicios[ej.id] }">
              <div class="sprint-actions">
                <template v-if="ej.estado === 'abierto'">
                  <button v-if="ekCan('accounting', 'write')" class="ghost-btn" @click="openEjercicioModal(ej.id)">Editar</button>
                  <button v-if="ekCan('accounting', 'write')" class="ghost-btn btn-danger" @click="confirmCerrarEjercicio(ej)">Cerrar Ejercicio</button>
                </template>
                <button v-else-if="ekCan('accounting', 'write')" class="ghost-btn" @click="runEjercicioAction(ej.id, 'reabrir')">Reabrir Ejercicio</button>
                <button v-if="ekCan('accounting', 'create')" class="primary-btn" :disabled="ej.estado !== 'abierto'" @click="openPeriodoModal(ej.id, null)">+ Nuevo Período</button>
              </div>
              <div>
                <p v-if="!periodosByEjercicio[ej.id]" class="crm-muted">Cargando…</p>
                <template v-else>
                  <p v-if="!periodosByEjercicio[ej.id].length" class="crm-muted" style="font-size:.85rem">Sin períodos todavía.</p>
                  <div v-for="p in periodosOrdenados(ej.id)" :key="p.id" class="sprint-story-item">
                    <span class="story-title">{{ p.nombre }} · {{ fmtDateAcc(p.fechaInicio) }} – {{ fmtDateAcc(p.fechaFin) }}</span>
                    <span class="crm-badge" :class="estadoAbiertoBadge(p.estado)">{{ p.estado === 'abierto' ? 'Abierto' : 'Cerrado' }}</span>
                    <div class="td-actions">
                      <span v-if="p.estado === 'abierto' && ekCan('accounting', 'write')" class="crm-action-btn" title="Cerrar período" @click="runPeriodoAction(ej.id, p.id, 'cerrar')">🔒</span>
                      <span v-else-if="ekCan('accounting', 'write')" class="crm-action-btn" title="Reabrir período" :style="ej.estado !== 'abierto' ? 'opacity:.4;pointer-events:none' : ''" @click="runPeriodoAction(ej.id, p.id, 'reabrir')">🔓</span>
                      <span v-if="ekCan('accounting', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="confirmDeletePeriodo(ej.id, p)">🗑</span>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Centros de Costo ───────────────────────────────────────── -->
    <div v-else-if="currentView === 'centros'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <button v-if="ekCan('accounting', 'create')" class="primary-btn" @click="openCentroModal(null)">+ Nuevo Centro de Costo</button>
        </div>
        <div class="crm-table-wrap">
          <p v-if="!centros.length" class="crm-muted">No hay centros de costo todavía.</p>
          <table v-else class="crm-table">
            <thead><tr><th>Código</th><th>Nombre</th><th></th><th></th></tr></thead>
            <tbody>
              <tr v-for="centro in centrosOrdenados" :key="centro.id" :class="{ 'crm-muted': !centro.activo }">
                <td>{{ centro.codigo }}</td>
                <td>{{ centro.nombre }}</td>
                <td><span v-if="!centro.activo" class="crm-badge badge-red">Inactivo</span></td>
                <td class="td-actions">
                  <span v-if="ekCan('accounting', 'write')" class="crm-action-btn" title="Editar" @click="openCentroModal(centro.id)">✎</span>
                  <span v-if="ekCan('accounting', 'delete')" class="crm-action-btn btn-del" title="Eliminar" @click="confirmDeleteCentro(centro)">🗑</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── Libro Diario (Asientos) ────────────────────────────────── -->
    <div v-else-if="currentView === 'asientos'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <select v-model="asientosQuery.ejercicioId" @change="onAsientosFilterChange">
            <option value="">Todos los ejercicios</option>
            <option v-for="e in ejercicios" :key="e.id" :value="e.id">{{ e.nombre }}</option>
          </select>
          <select v-model="asientosQuery.estado" @change="onAsientosFilterChange">
            <option value="">Todos los estados</option>
            <option value="borrador">Borrador</option>
            <option value="confirmado">Confirmado</option>
            <option value="anulado">Anulado</option>
          </select>
          <select v-model="asientosQuery.cuentaId" @change="onAsientosFilterChange">
            <option value="">Todas las cuentas</option>
            <option v-for="c in cuentasImputablesOrdenadas" :key="c.id" :value="c.id">{{ c.codigo }} — {{ c.nombre }}</option>
          </select>
          <label class="crm-inline-field">Desde <input type="date" v-model="asientosQuery.desde" @change="onAsientosFilterChange"></label>
          <label class="crm-inline-field">Hasta <input type="date" v-model="asientosQuery.hasta" @change="onAsientosFilterChange"></label>
          <input type="text" v-model="asientosQuery.comprobante" @change="onAsientosFilterChange" placeholder="Comprobante" style="max-width:160px">
          <button class="ghost-btn" @click="limpiarFiltrosAsientos">Limpiar</button>
          <button class="primary-btn" :disabled="exportingAsientos" @click="exportAsientosCsv">Exportar CSV</button>
        </div>
        <p class="crm-muted" style="margin:0 0 .75rem;font-size:.85rem">Confirmá o anulá borradores desde acá. Los asientos nuevos se cargan desde "+ Agregar asiento".</p>
        <div class="sprint-list">
          <p v-if="asientosStatus === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="asientosStatus === 'error'" class="crm-muted">Error al cargar: {{ asientosError }}</p>
          <p v-else-if="!asientosResult.data.length" class="crm-muted">No hay asientos con estos filtros.</p>
          <template v-else>
            <div v-for="asiento in asientosResult.data" :key="asiento.id" class="sprint-card">
              <div class="sprint-card-header" @click="toggleAsiento(asiento.id)">
                <span class="sprint-toggle" :class="{ open: openAsientos[asiento.id] }">▸</span>
                <span class="sprint-card-title">N° {{ asiento.numero }} — {{ asiento.descripcion }}</span>
                <span v-if="asiento.comprobante" class="crm-badge badge-gray" title="Comprobante">{{ asiento.comprobante }}</span>
                <span class="crm-badge" :class="asientoEstadoBadge(asiento.estado)">{{ asientoEstadoLabel(asiento.estado) }}</span>
                <span class="sprint-card-meta">{{ fmtDateAcc(asiento.fecha) }} · $ {{ fmtMoneyAcc(totalDebe(asiento)) }}</span>
              </div>
              <div class="sprint-card-body" :class="{ open: openAsientos[asiento.id] }">
                <table class="crm-table">
                  <thead><tr><th>Cuenta</th><th>Centro de costo</th><th>Debe</th><th>Haber</th></tr></thead>
                  <tbody>
                    <tr v-for="(d, i) in asiento.detalles" :key="i">
                      <td>{{ d.cuenta.codigo }} — {{ d.cuenta.nombre }}</td>
                      <td class="crm-muted">{{ d.centroCosto ? d.centroCosto.nombre : '—' }}</td>
                      <td style="text-align:right">{{ Number(d.debe) > 0 ? fmtMoneyAcc(d.debe) : '' }}</td>
                      <td style="text-align:right">{{ Number(d.haber) > 0 ? fmtMoneyAcc(d.haber) : '' }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="sprint-actions" v-if="asiento.estado === 'borrador' || asiento.estado === 'confirmado'">
                  <template v-if="asiento.estado === 'borrador'">
                    <button v-if="ekCan('accounting', 'write')" class="primary-btn" @click="runAsientoAction(asiento.id, 'confirmar')">Confirmar</button>
                    <button v-if="ekCan('accounting', 'delete')" class="ghost-btn btn-danger" @click="confirmDeleteAsiento(asiento)">Eliminar</button>
                  </template>
                  <button v-else-if="ekCan('accounting', 'write')" class="ghost-btn btn-danger" @click="confirmAnularAsiento(asiento)">Anular</button>
                </div>
              </div>
            </div>
          </template>
        </div>
        <div class="pagination" v-if="asientosResult.pagination.pages > 1">
          <button class="page-btn" :disabled="asientosPage <= 1" @click="asientosPrev">← Anterior</button>
          <span class="crm-muted" style="font-size:.85rem;align-self:center">Página {{ asientosPage }} de {{ asientosResult.pagination.pages }}</span>
          <button class="page-btn" :disabled="asientosPage >= asientosResult.pagination.pages" @click="asientosNext">Siguiente →</button>
        </div>
      </div>
    </div>

    <!-- ── Libro Mayor ────────────────────────────────────────────── -->
    <div v-else-if="currentView === 'mayor'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <select v-model="mayor.cuentaId" @change="renderMayor">
            <option value="">Elegí una cuenta…</option>
            <option v-for="c in cuentasImputablesOrdenadas" :key="c.id" :value="c.id">{{ c.codigo }} — {{ c.nombre }}</option>
          </select>
          <select v-model="mayor.ejercicioId" @change="renderMayor">
            <option value="">Todos los ejercicios</option>
            <option v-for="e in ejercicios" :key="e.id" :value="e.id">{{ e.nombre }}</option>
          </select>
          <label class="crm-inline-field">Desde <input type="date" v-model="mayor.desde" @change="renderMayor"></label>
          <label class="crm-inline-field">Hasta <input type="date" v-model="mayor.hasta" @change="renderMayor"></label>
          <button class="primary-btn" @click="exportMayorCsv">Exportar CSV</button>
        </div>
        <div>
          <p v-if="mayor.status === 'idle'" class="crm-muted">Elegí una cuenta para ver su mayor.</p>
          <p v-else-if="mayor.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="mayor.status === 'error'" class="crm-muted">Error: {{ mayor.error }}</p>
          <template v-else-if="mayor.data">
            <div class="crm-section-title">{{ mayor.data.cuenta.codigo }} — {{ mayor.data.cuenta.nombre }}
              <span class="crm-badge badge-blue">{{ naturalezaLabel(mayor.data.cuenta.naturaleza) }}</span></div>
            <div class="crm-table-wrap">
              <table class="crm-table">
                <thead><tr><th>Fecha</th><th>N°</th><th>Comprob.</th><th>Descripción</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
                <tbody>
                  <tr class="report-total-row"><td colspan="6">Saldo inicial</td><td style="text-align:right">{{ fmtMoneyAcc(mayor.data.saldoInicial) }}</td></tr>
                  <tr v-if="!mayor.data.movimientos.length"><td colspan="7" class="crm-muted">Sin movimientos en el período.</td></tr>
                  <tr v-for="(mv, i) in mayor.data.movimientos" :key="i">
                    <td>{{ fmtDateAcc(mv.fecha) }}</td>
                    <td>{{ mv.numero }}</td>
                    <td class="crm-muted">{{ mv.comprobante || '—' }}</td>
                    <td>{{ mv.descripcion }}</td>
                    <td style="text-align:right">{{ Number(mv.debe) ? fmtMoneyAcc(mv.debe) : '' }}</td>
                    <td style="text-align:right">{{ Number(mv.haber) ? fmtMoneyAcc(mv.haber) : '' }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(mv.saldo) }}</td>
                  </tr>
                  <tr class="report-total-row">
                    <td colspan="4">Totales del período</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(mayor.data.totales.debe) }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(mayor.data.totales.haber) }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(mayor.data.saldoFinal) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Balance de comprobación ─────────────────────────────────── -->
    <div v-else-if="currentView === 'balcomp'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <select v-model="balcomp.ejercicioId" @change="renderBalComp">
            <option value="">Todos los ejercicios</option>
            <option v-for="e in ejercicios" :key="e.id" :value="e.id">{{ e.nombre }}</option>
          </select>
          <label class="crm-inline-field">Al <input type="date" v-model="balcomp.hasta" @change="renderBalComp"></label>
          <button class="primary-btn" @click="exportBalCompCsv">Exportar CSV</button>
          <button class="ghost-btn" @click="printBalComp">Imprimir</button>
        </div>
        <div ref="balcompResult">
          <p v-if="balcomp.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="balcomp.status === 'error'" class="crm-muted">Error: {{ balcomp.error }}</p>
          <template v-else-if="balcomp.rows">
            <div class="crm-table-wrap">
              <table class="crm-table">
                <thead><tr><th>Código</th><th>Cuenta</th><th>Sumas Debe</th><th>Sumas Haber</th><th>Saldo Deudor</th><th>Saldo Acreedor</th></tr></thead>
                <tbody>
                  <tr v-if="!balcomp.rows.length"><td colspan="6" class="crm-muted">Sin movimientos.</td></tr>
                  <tr v-for="(c, i) in balcomp.rows" :key="i">
                    <td>{{ c.codigo }}</td><td>{{ c.nombre }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(c.debe) }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(c.haber) }}</td>
                    <td style="text-align:right">{{ c.sd ? fmtMoneyAcc(c.sd) : '' }}</td>
                    <td style="text-align:right">{{ c.sa ? fmtMoneyAcc(c.sa) : '' }}</td>
                  </tr>
                  <tr class="report-total-row">
                    <td colspan="2">Totales</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(balcomp.tD) }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(balcomp.tH) }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(balcomp.tSD) }}</td>
                    <td style="text-align:right">{{ fmtMoneyAcc(balcomp.tSA) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p :class="balcompOkSumas ? 'report-check-ok' : 'report-check-bad'">{{ balcompOkSumas ? '✔' : '✗' }} Sumas: Debe {{ money(balcomp.tD) }} {{ balcompOkSumas ? '=' : '≠' }} Haber {{ money(balcomp.tH) }}</p>
            <p :class="balcompOkSaldos ? 'report-check-ok' : 'report-check-bad'">{{ balcompOkSaldos ? '✔' : '✗' }} Saldos: Deudor {{ money(balcomp.tSD) }} {{ balcompOkSaldos ? '=' : '≠' }} Acreedor {{ money(balcomp.tSA) }}</p>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Estado de Situación Patrimonial ─────────────────────────── -->
    <div v-else-if="currentView === 'esp'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <select v-model="esp.ejercicioId" @change="renderEsp">
            <option value="">Todos los ejercicios</option>
            <option v-for="e in ejercicios" :key="e.id" :value="e.id">{{ e.nombre }}</option>
          </select>
          <label class="crm-inline-field">Al <input type="date" v-model="esp.hasta" @change="renderEsp"></label>
          <button class="primary-btn" @click="exportEspCsv">Exportar CSV</button>
          <button class="ghost-btn" @click="printEsp">Imprimir</button>
        </div>
        <div ref="espResult">
          <p v-if="esp.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="esp.status === 'error'" class="crm-muted">Error: {{ esp.error }}</p>
          <template v-else-if="espComputed">
            <div class="crm-table-wrap">
              <table class="crm-table report-table">
                <thead><tr><th>Código</th><th>Cuenta</th><th style="text-align:right">Saldo</th></tr></thead>
                <tbody>
                  <tr class="rep-section"><td colspan="3">ACTIVO</td></tr>
                  <tr v-if="!espComputed.activoCuentas.length"><td colspan="3" class="crm-muted">Sin saldos.</td></tr>
                  <tr v-for="(c, i) in espComputed.activoCuentas" :key="'a' + i"><td>{{ c.codigo }}</td><td>{{ c.nombre }}</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(c.saldo) }}</td></tr>
                  <tr class="report-total-row rep-total"><td colspan="2">Total ACTIVO</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(espComputed.activo) }}</td></tr>

                  <tr class="rep-section"><td colspan="3">PASIVO</td></tr>
                  <tr v-if="!espComputed.pasivoCuentas.length"><td colspan="3" class="crm-muted">Sin saldos.</td></tr>
                  <tr v-for="(c, i) in espComputed.pasivoCuentas" :key="'p' + i"><td>{{ c.codigo }}</td><td>{{ c.nombre }}</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(c.saldo) }}</td></tr>
                  <tr class="report-total-row rep-total"><td colspan="2">Total PASIVO</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(espComputed.pasivo) }}</td></tr>

                  <tr class="rep-section"><td colspan="3">PATRIMONIO NETO</td></tr>
                  <tr v-if="!espComputed.pnCuentas.length"><td colspan="3" class="crm-muted">Sin saldos.</td></tr>
                  <tr v-for="(c, i) in espComputed.pnCuentas" :key="'pn' + i"><td>{{ c.codigo }}</td><td>{{ c.nombre }}</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(c.saldo) }}</td></tr>
                  <tr><td colspan="2">Resultado del ejercicio</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(espComputed.resultado) }}</td></tr>
                  <tr class="report-total-row rep-total"><td colspan="2">Total PATRIMONIO NETO</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(espComputed.pnTotal) }}</td></tr>
                </tbody>
              </table>
            </div>
            <p :class="espComputed.cuadra ? 'report-check-ok' : 'report-check-bad'">{{ espComputed.cuadra ? '✔' : '✗' }} Activo {{ money(espComputed.activo) }} {{ espComputed.cuadra ? '=' : '≠' }} Pasivo {{ money(espComputed.pasivo) }} + Patrimonio Neto {{ money(espComputed.pnTotal) }}</p>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Estado de Resultados ────────────────────────────────────── -->
    <div v-else-if="currentView === 'er'" class="inventory-subview">
      <button class="ghost-btn" @click="backToHome">← Volver</button>
      <div class="card">
        <div class="crm-toolbar">
          <select v-model="er.ejercicioId" @change="renderEr">
            <option value="">Todos los ejercicios</option>
            <option v-for="e in ejercicios" :key="e.id" :value="e.id">{{ e.nombre }}</option>
          </select>
          <label class="crm-inline-field">Al <input type="date" v-model="er.hasta" @change="renderEr"></label>
          <button class="primary-btn" @click="exportErCsv">Exportar CSV</button>
          <button class="ghost-btn" @click="printEr">Imprimir</button>
        </div>
        <div ref="erResult">
          <p v-if="er.status === 'loading'" class="crm-muted">Cargando…</p>
          <p v-else-if="er.status === 'error'" class="crm-muted">Error: {{ er.error }}</p>
          <template v-else-if="erComputed">
            <div class="crm-table-wrap">
              <table class="crm-table report-table">
                <thead><tr><th>Código</th><th>Cuenta</th><th style="text-align:right">Saldo</th></tr></thead>
                <tbody>
                  <tr class="rep-section"><td colspan="3">INGRESOS</td></tr>
                  <tr v-if="!erComputed.ingresosCuentas.length"><td colspan="3" class="crm-muted">Sin saldos.</td></tr>
                  <tr v-for="(c, i) in erComputed.ingresosCuentas" :key="'i' + i"><td>{{ c.codigo }}</td><td>{{ c.nombre }}</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(c.saldo) }}</td></tr>
                  <tr class="report-total-row rep-total"><td colspan="2">Total INGRESOS</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(erComputed.ingresos) }}</td></tr>

                  <tr class="rep-section"><td colspan="3">EGRESOS</td></tr>
                  <tr v-if="!erComputed.egresosCuentas.length"><td colspan="3" class="crm-muted">Sin saldos.</td></tr>
                  <tr v-for="(c, i) in erComputed.egresosCuentas" :key="'e' + i"><td>{{ c.codigo }}</td><td>{{ c.nombre }}</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(c.saldo) }}</td></tr>
                  <tr class="report-total-row rep-total"><td colspan="2">Total EGRESOS</td><td class="num" style="text-align:right">{{ fmtMoneyAcc(erComputed.egresos) }}</td></tr>

                  <tr class="report-total-row rep-total"><td colspan="2">{{ erComputed.gana ? 'GANANCIA' : 'PÉRDIDA' }} del ejercicio (Ingresos − Egresos)</td><td class="num" :class="erComputed.gana ? 'report-check-ok' : 'report-check-bad'" style="text-align:right">{{ fmtMoneyAcc(erComputed.resultado) }}</td></tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Modal: Cuenta contable ──────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: cuentaModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ cuentaModal.editId ? 'Editar cuenta' : 'Nueva cuenta' }}</span>
          <span class="crm-modal-close" @click="closeCuentaModal">✕</span>
        </div>
        <div class="crm-form-group">
          <div class="crm-form-row">
            <label class="crm-label">
              Código
              <input type="text" v-model="cuentaModal.codigo" placeholder="1.1.01.01" />
            </label>
            <label class="crm-label">
              Nombre
              <input type="text" v-model="cuentaModal.nombre" placeholder="Caja" />
            </label>
          </div>
          <div class="crm-form-row">
            <label class="crm-label">
              Tipo
              <select v-model="cuentaModal.tipo">
                <option value="ACTIVO">Activo</option>
                <option value="PASIVO">Pasivo</option>
                <option value="PATRIMONIO_NETO">Patrimonio Neto</option>
                <option value="INGRESO">Ingreso</option>
                <option value="EGRESO">Egreso</option>
              </select>
            </label>
            <label class="crm-label">
              Naturaleza <span class="crm-muted" style="font-weight:400">(la define el tipo)</span>
              <output class="crm-readonly-field">{{ naturalezaHint }}</output>
            </label>
          </div>
          <label class="crm-label crm-label-full">
            Cuenta padre <span class="crm-muted" style="font-weight:400">(opcional, arma la jerarquía)</span>
            <select v-model="cuentaModal.parentId">
              <option value="">— Sin padre (cuenta raíz) —</option>
              <option v-for="c in cuentaParentOptions" :key="c.id" :value="c.id">{{ c.codigo }} — {{ c.nombre }}</option>
            </select>
          </label>
          <label class="crm-label-check">
            <input type="checkbox" v-model="cuentaModal.imputable" />
            Imputable (admite asientos directos)
          </label>
          <label class="crm-label-check">
            <input type="checkbox" v-model="cuentaModal.esEfectivo" />
            Es caja / equivalente de efectivo <span class="crm-muted" style="font-weight:400">(suma al indicador de Caja)</span>
          </label>
          <label class="crm-label-check" v-if="cuentaModal.editId">
            <input type="checkbox" v-model="cuentaModal.activa" />
            Activa
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeCuentaModal">Cancelar</button>
          <button class="primary-btn" :disabled="cuentaModal.saving" @click="saveCuenta">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Ejercicio contable ───────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: ejercicioModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ ejercicioModal.editId ? 'Editar Ejercicio' : 'Nuevo Ejercicio' }}</span>
          <span class="crm-modal-close" @click="closeEjercicioModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label crm-label-full">
            Nombre
            <input type="text" v-model="ejercicioModal.nombre" placeholder="Ejercicio 2026" />
          </label>
          <div class="crm-form-row">
            <label class="crm-label">
              Fecha de inicio
              <input type="date" v-model="ejercicioModal.fechaInicio" />
            </label>
            <label class="crm-label">
              Fecha de fin
              <input type="date" v-model="ejercicioModal.fechaFin" />
            </label>
          </div>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeEjercicioModal">Cancelar</button>
          <button class="primary-btn" :disabled="ejercicioModal.saving" @click="saveEjercicio">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Período contable ─────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: periodoModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ periodoModal.editId ? 'Editar Período' : 'Nuevo Período' }}</span>
          <span class="crm-modal-close" @click="closePeriodoModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label crm-label-full">
            Nombre
            <input type="text" v-model="periodoModal.nombre" placeholder="Enero 2026" />
          </label>
          <div class="crm-form-row">
            <label class="crm-label">
              Fecha de inicio
              <input type="date" v-model="periodoModal.fechaInicio" />
            </label>
            <label class="crm-label">
              Fecha de fin
              <input type="date" v-model="periodoModal.fechaFin" />
            </label>
          </div>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closePeriodoModal">Cancelar</button>
          <button class="primary-btn" :disabled="periodoModal.saving" @click="savePeriodo">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Centro de costo ──────────────────────────────────── -->
    <div class="crm-overlay" :class="{ open: centroModal.open }">
      <div class="crm-modal crm-modal-sm">
        <div class="crm-modal-header">
          <span class="crm-modal-title">{{ centroModal.editId ? 'Editar Centro de Costo' : 'Nuevo Centro de Costo' }}</span>
          <span class="crm-modal-close" @click="closeCentroModal">✕</span>
        </div>
        <div class="crm-form-group">
          <label class="crm-label">
            Código
            <input type="text" v-model="centroModal.codigo" placeholder="ADM" />
          </label>
          <label class="crm-label">
            Nombre
            <input type="text" v-model="centroModal.nombre" placeholder="Administración" />
          </label>
          <label class="crm-label-check" v-if="centroModal.editId">
            <input type="checkbox" v-model="centroModal.activo" />
            Activo
          </label>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeCentroModal">Cancelar</button>
          <button class="primary-btn" :disabled="centroModal.saving" @click="saveCentro">Guardar</button>
        </div>
      </div>
    </div>

    <!-- ── Modal: Asiento (Libro Diario) ───────────────────────────── -->
    <div class="crm-overlay" :class="{ open: asientoModal.open }">
      <div class="crm-modal">
        <div class="crm-modal-header">
          <span class="crm-modal-title">Nuevo asiento (borrador)</span>
          <span class="crm-modal-close" @click="closeAsientoModal">✕</span>
        </div>
        <div class="crm-form-group">
          <div class="crm-form-row">
            <label class="crm-label">
              Fecha
              <input type="date" v-model="asientoModal.fecha" />
            </label>
            <label class="crm-label">
              Comprobante <span class="crm-muted" style="font-weight:400">(opcional)</span>
              <input type="text" v-model="asientoModal.comprobante" maxlength="120" placeholder="FC A 0001-00001234" />
            </label>
          </div>
          <div class="crm-form-row">
            <label class="crm-label crm-label-full">
              Descripción
              <input type="text" v-model="asientoModal.descripcion" placeholder="Pago de alquiler julio" />
            </label>
          </div>

          <label class="crm-label-full" style="display:block;margin:1rem 0 .5rem;font-weight:700">Líneas del asiento</label>
          <div class="detalle-editor">
            <div class="detalle-row" v-for="row in asientoModal.rows" :key="row.id">
              <select class="detalle-cuenta" v-model="row.cuentaId">
                <option v-for="c in cuentasImputablesActivasOrdenadas" :key="c.id" :value="c.id">{{ c.codigo }} — {{ c.nombre }}</option>
              </select>
              <select class="detalle-centro" v-model="row.centroCostoId">
                <option value="">— Sin centro de costo —</option>
                <option v-for="c in centrosActivosOrdenados" :key="c.id" :value="c.id">{{ c.codigo }} — {{ c.nombre }}</option>
              </select>
              <input type="number" class="detalle-debe" v-model="row.debe" placeholder="Debe" min="0" step="0.01">
              <input type="number" class="detalle-haber" v-model="row.haber" placeholder="Haber" min="0" step="0.01">
              <span class="detalle-remove-btn" title="Quitar línea" @click="removeDetalleRow(row.id)">✕</span>
            </div>
          </div>
          <button type="button" class="ghost-btn" style="margin-top:.6rem" @click="addDetalleRow">+ Agregar línea</button>

          <div class="detalle-totales" :class="{ balanceado: asientoTotales.balanceado }">
            <div class="balanza" :class="{ balanceada: asientoTotales.balanceado }" :style="{ '--tilt': asientoTotales.tilt + 'deg' }" aria-hidden="true">
              <span class="balanza-beam">
                <span class="balanza-pan balanza-pan-debe"></span>
                <span class="balanza-pan balanza-pan-haber"></span>
              </span>
              <span class="balanza-base"></span>
            </div>
            <div class="detalle-totales-nums">
              <span>Debe: <strong>{{ fmtMoneyAcc(asientoTotales.totalDebe) }}</strong></span>
              <span>Haber: <strong>{{ fmtMoneyAcc(asientoTotales.totalHaber) }}</strong></span>
              <span class="detalle-diff">Diferencia: {{ fmtMoneyAcc(asientoTotales.diff) }}</span>
            </div>
          </div>
        </div>
        <div class="form-actions modal-actions">
          <button class="ghost-btn" @click="closeAsientoModal">Cancelar</button>
          <button class="primary-btn" :disabled="!asientoTotales.balanceado || asientoModal.saving" @click="saveAsiento">Guardar borrador</button>
        </div>
      </div>
    </div>`,
};

// ── Entry point (misma firma que accounting.js) ────────────────────────────

let accountingVueInstance = null;

function loadAccountingPanel(suitId, suitName) {
  if (!accountingVueInstance) {
    const mountEl = document.getElementById('accounting-app');
    if (!mountEl) return;
    accountingVueInstance = Vue.createApp(AccountingApp).mount(mountEl);
  }
  accountingVueInstance.setSuit(suitId, suitName);
}

// @click/@input/v-model en el template reemplazan estos listeners — se deja
// vacía (no un no-op silencioso: dashboard.js la sigue llamando en el
// bootstrap) para no tener que tocar esa lista de initXEvents().
function initAccountingEvents() {}
