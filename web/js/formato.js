const nf = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const bs = (n) => 'Bs. ' + nf.format(Number(n) || 0);
export const fechaHora = (ms) => (ms ? new Date(ms).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** "1.234,56" o "1234.56" → 1234.56 ; vacío o inválido → NaN */
export function leerMonto(texto) {
  let t = String(texto || '').trim().replace(/[^\d.,]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  return Math.round(parseFloat(t) * 100) / 100;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ESTADOS = {
  PENDIENTE: ['En revisión', 'espera'], APROBADA: ['Aprobada', 'ok'], EN_ARCHIVO: ['Enviada al banco', 'austral'],
  PAGADA: ['Pagada', 'ok'], RECHAZADA: ['Rechazada', 'error'], CANCELADA: ['Cancelada', 'neutro'],
};
export const chip = (estado) => {
  const [txt, tono] = ESTADOS[estado] || [estado, 'neutro'];
  return `<span class="chip chip-${tono}">${esc(txt)}</span>`;
};

/** ms → 29/10/2026 en hora de Caracas (la misma fecha que ve cualquiera, esté donde esté). */
export const fechaCaracas = (ms) => window.Constancia.fechaCorta(window.Constancia.fechaCaracas(ms));

export const chipConstancia = (estado) => {
  const [txt, tono] = { VIGENTE: ['Vigente', 'ok'], VENCIDA: ['Vencida', 'espera'], ANULADA: ['Anulada', 'error'] }[estado] || [estado, 'neutro'];
  return `<span class="chip chip-${tono}">${esc(txt)}</span>`;
};
