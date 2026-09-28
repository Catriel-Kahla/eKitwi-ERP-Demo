/**
 * vueCharts.js
 * Componentes Vue chicos, compartidos por todos los paneles que migran a
 * Vue (dashboardHomeVue.js, biPanelVue.js, los que sigan) — wrappean los
 * primitivos SVG de bi.js (renderBarChart/renderLineChart, con hover +
 * tooltip + crosshair ya incluidos ahí) sobre un <div ref>, el patrón normal
 * de Vue para integrar dibujo imperativo dentro de un componente.
 *
 * Se carga después de bi.js y antes de cualquier *Vue.js que los use.
 */

'use strict';

const ChartBar = {
  props: ['items'],
  template: `<div ref="el"></div>`,
  mounted() { renderBarChart(this.$refs.el, this.items); },
  updated() { renderBarChart(this.$refs.el, this.items); },
};

const ChartLine = {
  props: ['points', 'valuePrefix'],
  template: `<div ref="el"></div>`,
  mounted() { renderLineChart(this.$refs.el, this.points, { valuePrefix: this.valuePrefix }); },
  updated() { renderLineChart(this.$refs.el, this.points, { valuePrefix: this.valuePrefix }); },
};
