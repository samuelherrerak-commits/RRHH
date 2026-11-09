/* ==========================================================
   Omega Capital: cestaticket y complemento de alimentación (y los otros
   beneficios en dólares que se pagan por la misma vía).
   Regla de la empresa, para cada concepto en $:
     1.ª quincena: anticipo del 50 % del monto del mes × tasa estimada de la 1Q.
     2.ª quincena: 100 % del monto del mes × tasa estimada de la 2Q − lo anticipado en la 1Q.
   El cestaticket ($40 por ley) es para todos; quien ingresa en el mes cobra la parte proporcional.
   Funciones puras: las usan el navegador, Apps Script y las pruebas. Fechas como { y, m, d }.
   ========================================================== */
(function (raiz) {
  'use strict';

  var PARAMETROS = { cestaticket: 40, comision: 0.013, iva: 0.16, retencion: 0.75 };
  /** Conceptos en $ que paga Omega, en el orden en que se muestran. */
  var CONCEPTOS = [
    { id: 'cestaticket', nombre: 'Cestaticket' },
    { id: 'complemento', nombre: 'Complemento de alimentación' },
    { id: 'vehiculo', nombre: 'Ayuda de vehículo' },
    { id: 'bono', nombre: 'Bono especial' },
    { id: 'comisiones', nombre: 'Comisiones garantizadas' },
  ];
  var ADICIONALES = ['complemento', 'vehiculo', 'bono', 'comisiones'];

  function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  function esMes(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')); }

  /**
   * Días del mes que corresponden de cestaticket (mes comercial de 30 días).
   * Ingresó antes del mes: 30. Ingresó en el mes: del día de ingreso al 30. Ingresó después: 0.
   */
  function diasCestaticket(fechaIngreso, mes) {
    if (!fechaIngreso || !fechaIngreso.y) return 30;
    var y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
    var ing = fechaIngreso.y * 12 + fechaIngreso.m, act = y * 12 + m;
    if (ing < act) return 30;
    if (ing > act) return 0;
    return Math.max(0, 30 - Math.min(fechaIngreso.d, 30) + 1);
  }

  /** ¿Ingresó después de la 1.ª quincena de ese mes? (entonces no recibe anticipo). */
  function ingresoTrasPrimeraQuincena(fechaIngreso, mes) {
    if (!fechaIngreso || !fechaIngreso.y) return false;
    return fechaIngreso.y === Number(mes.slice(0, 4)) && fechaIngreso.m === Number(mes.slice(5, 7)) && fechaIngreso.d > 15;
  }

  /**
   * Montos en $ del mes de una persona.
   * beneficio: { complemento, vehiculo, bono, comisiones } (o null). ajuste: { dias } para cambiar los días de cestaticket (p. ej. un egreso).
   */
  function montosDelMes(fechaIngreso, mes, beneficio, ajuste, parametros) {
    var p = Object.assign({}, PARAMETROS, parametros || {});
    var dias = ajuste && ajuste.dias != null && ajuste.dias !== '' ? Math.max(0, Math.min(30, Number(ajuste.dias))) : diasCestaticket(fechaIngreso, mes);
    var m = { dias: dias, cestaticket: r2(p.cestaticket * dias / 30) };
    ADICIONALES.forEach(function (k) { m[k] = r2(beneficio && beneficio[k]); });
    m.totalUSD = r2(CONCEPTOS.reduce(function (t, c) { return t + m[c.id]; }, 0));
    return m;
  }

  /** Bs. de la 1.ª quincena: 50 % del total en $ × tasa de la 1Q (nada si ingresó después del 15). */
  function primeraQuincena(totalUSD, tasa1, sinAnticipo) {
    return sinAnticipo ? 0 : r2(totalUSD / 2 * Number(tasa1 || 0));
  }

  /** Bs. de la 2.ª quincena: 100 % en $ × tasa de la 2Q − lo pagado en la 1Q. */
  function segundaQuincena(totalUSD, tasa2, pagado1Q) {
    return r2(totalUSD * Number(tasa2 || 0) - Number(pagado1Q || 0));
  }

  /** Totales de una quincena para Omega: subtotal + comisión + IVA de la comisión − retención del IVA. */
  function totalesOmega(subtotal, parametros) {
    var p = Object.assign({}, PARAMETROS, parametros || {});
    var comision = r2(subtotal * p.comision), iva = r2(comision * p.iva), retencion = r2(iva * p.retencion);
    return { subtotal: r2(subtotal), comision: comision, iva: iva, retencion: retencion, totalPagar: r2(subtotal + comision + iva - retencion) };
  }

  /** Totales por empresa ({ PCA: {...}, AIV: {...}, TODAS: {...} }) de una lista de líneas, sumando el campo indicado. */
  function totalesPorEmpresa(lineas, campo, parametros) {
    var suma = {}, total = 0;
    lineas.forEach(function (l) { suma[l.empresa] = (suma[l.empresa] || 0) + (Number(l[campo]) || 0); total += Number(l[campo]) || 0; });
    var r = {};
    Object.keys(suma).sort().forEach(function (e) { r[e] = Object.assign({ personas: lineas.filter(function (l) { return l.empresa === e; }).length }, totalesOmega(suma[e], parametros)); });
    r.TODAS = Object.assign({ personas: lineas.length }, totalesOmega(total, parametros));
    return r;
  }

  /**
   * Lee las filas del Excel de beneficios (una fila por persona) con encabezados como los de Gestión Humana:
   * «Cédula», «Nombre…», «Monto de complemento de alimentación aprobado», «Ayuda de vehículo», «Bono especial», «Comisiones garantizadas».
   * filas: matriz (primera fila con encabezados en las primeras 5 filas). Devuelve { filas: [{ cedula, nombre, complemento, vehiculo, bono, comisiones }], faltan: [] }.
   */
  function leerExcelBeneficios(matriz) {
    var norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); };
    var REGLAS = {
      cedula: function (h) { return /^cedula/.test(h); },
      nombre: function (h) { return /^nombre/.test(h); },
      complemento: function (h) { return /complemento/.test(h) && !/pagar/.test(h); },
      vehiculo: function (h) { return /vehiculo/.test(h); },
      bono: function (h) { return /^bono/.test(h); },
      comisiones: function (h) { return /comisiones? garantizad/.test(h); },
    };
    for (var f = 0; f < Math.min(6, matriz.length); f++) {
      var cab = (matriz[f] || []).map(norm), col = {};
      Object.keys(REGLAS).forEach(function (k) { for (var j = 0; j < cab.length; j++) if (col[k] == null && REGLAS[k](cab[j])) col[k] = j; });
      if (col.cedula == null || col.complemento == null) continue;
      var monto = function (v) { var n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? r2(n) : 0; };
      var filas = [];
      for (var i = f + 1; i < matriz.length; i++) {
        var row = matriz[i] || [], ced = String(row[col.cedula] == null ? '' : row[col.cedula]).replace(/\D/g, '');
        if (ced.length < 5) continue;
        var o = { cedula: ced, nombre: col.nombre != null ? String(row[col.nombre] || '').trim() : '' };
        ADICIONALES.forEach(function (k) { o[k] = col[k] != null ? monto(row[col[k]]) : 0; });
        filas.push(o);
      }
      return { filas: filas, faltan: ADICIONALES.filter(function (k) { return col[k] == null; }) };
    }
    return { filas: [], faltan: ['cedula', 'complemento'], error: 'No encontré las columnas «Cédula» y «Monto de complemento de alimentación aprobado».' };
  }

  var api = { PARAMETROS: PARAMETROS, CONCEPTOS: CONCEPTOS, ADICIONALES: ADICIONALES, esMes: esMes, diasCestaticket: diasCestaticket,
    ingresoTrasPrimeraQuincena: ingresoTrasPrimeraQuincena, montosDelMes: montosDelMes, primeraQuincena: primeraQuincena,
    segundaQuincena: segundaQuincena, totalesOmega: totalesOmega, totalesPorEmpresa: totalesPorEmpresa, leerExcelBeneficios: leerExcelBeneficios, r2: r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Omega = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
