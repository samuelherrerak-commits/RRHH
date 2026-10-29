/* ==========================================================
   Constancia de trabajo: textos, monto en letras y vigencia (30 días).
   Funciones puras; las usan el servidor, el navegador (PDF) y las pruebas.
   Las fechas de emisión se calculan en hora de Caracas (UTC-4, sin horario de verano).
   ========================================================== */
(function (raiz) {
  'use strict';

  var VIGENCIA_DIAS = 30;
  var OFFSET_CARACAS_MS = -4 * 3600 * 1000;
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  var UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  var DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  var CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  /** 0..999 en letras (sin apócope: «uno», «veintiuno»). */
  function menorAMil(n) {
    if (n === 100) return 'cien';
    var c = Math.floor(n / 100), r = n % 100, partes = [];
    if (c) partes.push(CENTENAS[c]);
    if (r) {
      if (r < 30) partes.push(UNIDADES[r]);
      else partes.push(DECENAS[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNIDADES[r % 10] : ''));
    }
    return partes.join(' ');
  }

  /** Entero 0..999 999 999 999 en letras. «un» antes de mil y millón: «veintiún mil», «un millón». */
  function enteroEnLetras(n) {
    if (n === 0) return 'cero';
    var mm = Math.floor(n / 1e9), m = Math.floor((n % 1e9) / 1e6), k = Math.floor((n % 1e6) / 1e3), u = n % 1e3, partes = [];
    var apocope = function (txt) { return txt.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un'); };
    if (mm) partes.push(mm === 1 ? 'mil' : apocope(menorAMil(mm)) + ' mil', m ? '' : 'millones');
    if (m) partes.push(m === 1 ? 'un millón' : apocope(menorAMil(m)) + ' millones');
    if (k) partes.push(k === 1 ? 'mil' : apocope(menorAMil(k)) + ' mil');
    if (u) partes.push(menorAMil(u));
    // «mil millones» cuando hay miles de millones exactos; se limpia lo vacío
    return partes.filter(Boolean).join(' ').replace('mil millones millones', 'mil millones').replace(/\s+/g, ' ').trim();
  }

  function redondear2(n) { return Math.round((Math.abs(n) + 1e-9) * 100) / 100 * (n < 0 ? -1 : 1); }

  /** 5500 → «Cinco mil quinientos bolívares con 00/100 Céntimos» */
  function montoEnLetras(monto) {
    var m = redondear2(Number(monto));
    if (!isFinite(m) || m < 0 || m >= 1e12) throw new Error('Monto fuera de rango');
    var ent = Math.floor(m + 1e-9), cent = Math.round((m - ent) * 100);
    var texto = ent === 1 ? 'un' : enteroEnLetras(ent);
    var unidad = ent === 1 ? 'bolívar' : (ent >= 1e6 && ent % 1e6 === 0 ? 'de bolívares' : 'bolívares');
    var cc = (cent < 10 ? '0' : '') + cent;
    var frase = texto + ' ' + unidad + ' con ' + cc + '/100 Céntimos';
    return frase.charAt(0).toUpperCase() + frase.slice(1);
  }

  /** 5500 → «5.500,00» */
  function formatoMonto(monto) {
    var m = redondear2(Number(monto)).toFixed(2).split('.');
    return m[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + m[1];
  }

  /** ms → { y, m, d, dia } en hora de Caracas. */
  function fechaCaracas(ms) {
    var d = new Date(ms + OFFSET_CARACAS_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dia: d.getUTCDay() };
  }

  function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  /** Suma meses a una fecha {y,m,d}; si el día no existe en el mes destino queda en su último día. */
  function sumarMeses(f, meses) {
    var idx = f.y * 12 + (f.m - 1) + meses, y = Math.floor(idx / 12), m = idx % 12 + 1;
    return { y: y, m: m, d: Math.min(f.d, diasDelMes(y, m)) };
  }

  /** Fin del día {y,m,d} en Caracas, como ms. */
  function finDelDia(f) {
    return Date.UTC(f.y, f.m - 1, f.d, 23, 59, 59) - OFFSET_CARACAS_MS;
  }

  /** Suma días a una fecha {y,m,d}. */
  function sumarDias(f, dias) {
    var d = new Date(Date.UTC(f.y, f.m - 1, f.d) + dias * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  /** Vencimiento: 30 días después de la emisión, hasta el final de ese día (hora de Caracas). */
  function vencimiento(emisionMs) {
    return finDelDia(sumarDias(fechaCaracas(emisionMs), VIGENCIA_DIAS));
  }

  /** 'VIGENTE' | 'VENCIDA' | 'ANULADA' */
  function estadoConstancia(c, ahoraMs) {
    if (c.estado === 'ANULADA') return 'ANULADA';
    return ahoraMs > c.vence ? 'VENCIDA' : 'VIGENTE';
  }

  /** 29 de octubre de 2026 */
  function fechaLarga(f) { return f.d + ' de ' + MESES[f.m - 1] + ' de ' + f.y; }

  /** jueves, 29 de octubre de 2026 */
  function fechaLargaConDia(f) { return DIAS[f.dia] + ', ' + fechaLarga(f); }

  /** {y,m,d} → 29/10/2026 */
  function fechaCorta(f) { return ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y; }

  var NOMBRES_EMPRESA = { PCA: 'PROSEIN CENTRAL', AIV: 'AUSTRAL IMPORT DE VENEZUELA C.A' };

  var api = {
    VIGENCIA_DIAS: VIGENCIA_DIAS, sumarDias: sumarDias, NOMBRES_EMPRESA: NOMBRES_EMPRESA,
    enteroEnLetras: enteroEnLetras, montoEnLetras: montoEnLetras, formatoMonto: formatoMonto,
    fechaCaracas: fechaCaracas, sumarMeses: sumarMeses, vencimiento: vencimiento, estadoConstancia: estadoConstancia,
    fechaLarga: fechaLarga, fechaLargaConDia: fechaLargaConDia, fechaCorta: fechaCorta,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Constancia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
