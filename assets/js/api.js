/**
 * api.js
 * Thin authenticated fetch helpers for the shared eKitwi backend, plus a
 * couple of formatting helpers used across dashboard.js.
 */

'use strict';

async function apiRequest(method, path, body) {
  const token = getErpToken();
  const res = await fetch(`${window.ADMIN_API_BASE_URL}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch { /* no body */ }
    throw new Error(message);
  }

  if (res.status === 204) return null;
  try {
    const data = await res.json();
    // 202 + pendingApproval: el permiso "Preguntar" dejó la acción como
    // solicitud para el admin (ver SuitPermissionGuard). Se corta el flujo
    // del caller con un error; showToast lo muestra como aviso, no como fallo.
    if (res.status === 202 && data && data.pendingApproval) {
      const err = new Error(data.message);
      err.pendingApproval = true;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.pendingApproval) throw err;
    console.log('[DEBUG] respuesta no-JSON de', method, path, '| status:', res.status, '| error:', err); // TODO quitar
    throw err;
  }
}

const apiGet    = (path)       => apiRequest('GET', path);
const apiPost   = (path, body) => apiRequest('POST', path, body ?? {});
const apiPatch  = (path, body) => apiRequest('PATCH', path, body ?? {});
const apiPut    = (path, body) => apiRequest('PUT', path, body ?? {});
const apiDelete = (path)       => apiRequest('DELETE', path);

// Subida de archivos (multipart/form-data) — separado de apiRequest porque
// ese siempre manda Content-Type: application/json y JSON.stringify()ea el
// body; acá el browser tiene que poner su propio boundary en el header.
async function apiUpload(path, formData) {
  const token = getErpToken();
  const res = await fetch(`${window.ADMIN_API_BASE_URL}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch { /* no body */ }
    throw new Error(message);
  }

  return res.json();
}

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtMoney = n =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0);

const slugify = s => {
  const stripped = String(s ?? '').toLowerCase().normalize('NFD')
    .split('').filter(ch => { const c = ch.codePointAt(0); return c < 0x0300 || c > 0x036f; }).join('');
  return stripped.trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
};

// ── Exportar / imprimir (sin dependencias) ──────────────────────────────
// downloadCsv: baja un CSV que abre bien en Excel/Sheets (separador ';',
// comillas escapadas, BOM UTF-8 para los acentos).
function downloadCsv(filename, header, rows) {
  const cell = v => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// printReport: abre una ventana nueva con el reporte en una hoja limpia
// (sin la shell del ERP) y dispara el diálogo de impresión (→ PDF).
function printReport(titleText, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { showToast('Permití las ventanas emergentes para imprimir', 'err'); return; }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>${esc(titleText)}</title>
    <style>
      *{box-sizing:border-box} body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;max-width:820px}
      h1{font-size:1.3rem;margin:0 0 2px} .rep-sub{color:#666;margin:0 0 20px;font-size:.85rem}
      table{width:100%;border-collapse:collapse;margin:10px 0 22px}
      th,td{padding:6px 10px;border-bottom:1px solid #ddd;text-align:left}
      td[style*="right"],td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .rep-total td,.report-total-row td{font-weight:700;border-top:2px solid #333;border-bottom:none}
      .rep-section td{font-weight:700;background:#f3f3f3;text-transform:uppercase;font-size:.72rem;letter-spacing:.04em}
      .report-check-ok{color:#15803d;font-weight:700} .report-check-bad{color:#b91c1c;font-weight:700}
      .crm-section-title{font-weight:700;margin:0 0 8px} .crm-badge{display:none}
      @media print{body{margin:0}}
    </style></head><body>${bodyHtml}
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}
