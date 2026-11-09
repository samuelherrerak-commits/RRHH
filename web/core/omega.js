/* ==========================================================
   Omega Capital: cestaticket y Omega Transferencia (complemento de alimentación
   y otros beneficios en $), por quincena y en 4 lotes:
     Cestaticket PCA · Cestaticket AIV · Transferencia PCA · Transferencia AIV.
   Reglas:
   - Cestaticket: $40 al mes por ley. Va a la tarjeta de alimentación. Quien no tiene tarjeta, o
     ingresó en el mes (cobra proporcional a los días), lo cobra por Transferencia.
   - Transferencia: complemento + ayuda de vehículo + bono especial + comisiones garantizadas
     (+ el cestaticket de quien no tiene tarjeta o ingresó en el mes).
   - 1.ª quincena: 50 % del monto en $ × tasa estimada de la 1Q (nada si ingresó después del 15).
   - 2.ª quincena: 100 % × tasa estimada de la 2Q − lo pagado en la 1Q en ese mismo lote.
   - Los egresados no cobran: se les paga en la liquidación.
   El TXT replica la macro «FORMATO DE SOLICITUD DE DEPÓSITO A BENEFICIARIOS V7.0» de Omega.
   Funciones puras: las usan el navegador, Apps Script y las pruebas. Fechas como { y, m, d }.
   ========================================================== */
(function (raiz) {
  'use strict';

  var PARAMETROS = { cestaticket: 40, comision: 0.013, iva: 0.16, retencion: 0.75 };
  var EMPRESAS = {
    PCA: { razonSocial: 'PROSEIN PROVEEDURIA Y SERVICIO INDUSTRIAL CA', rif: 'J001417710' },
    AIV: { razonSocial: 'AUSTRAL IMPORT DE VENEZUELA CA', rif: '' },
  };
  var LOTES = [
    { id: 'CT-PCA', tipo: 'CESTATICKET', empresa: 'PCA', nombre: 'Cestaticket PCA' },
    { id: 'CT-AIV', tipo: 'CESTATICKET', empresa: 'AIV', nombre: 'Cestaticket AIV' },
    { id: 'TR-PCA', tipo: 'TRANSFERENCIA', empresa: 'PCA', nombre: 'Omega Transferencia PCA' },
    { id: 'TR-AIV', tipo: 'TRANSFERENCIA', empresa: 'AIV', nombre: 'Omega Transferencia AIV' },
  ];
  var ADICIONALES = ['complemento', 'vehiculo', 'bono', 'comisiones'];

  function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  function esMes(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')); }
  function idQuincena(mes, q) { return mes + '-' + q; }
  function lote(id) { return LOTES.filter(function (l) { return l.id === id; })[0] || null; }

  /** Días del mes de cestaticket (mes comercial de 30 días): antes del mes 30; en el mes, del día de ingreso al 30; después 0. */
  function diasCestaticket(fechaIngreso, mes) {
    if (!fechaIngreso || !fechaIngreso.y) return 30;
    var y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
    var ing = fechaIngreso.y * 12 + fechaIngreso.m, act = y * 12 + m;
    if (ing < act) return 30;
    if (ing > act) return 0;
    return Math.max(0, 30 - Math.min(fechaIngreso.d, 30) + 1);
  }
  function ingresoEnElMes(fechaIngreso, mes) {
    return !!(fechaIngreso && fechaIngreso.y === Number(mes.slice(0, 4)) && fechaIngreso.m === Number(mes.slice(5, 7)));
  }
  /** ¿Ingresó después de la 1.ª quincena de ese mes? (no recibe anticipo). */
  function ingresoTrasPrimeraQuincena(fechaIngreso, mes) {
    return ingresoEnElMes(fechaIngreso, mes) && fechaIngreso.d > 15;
  }

  /**
   * Monto en $ del mes de una persona en cada tipo de lote.
   * persona: { fechaIngreso, sinTarjeta }; beneficio: { complemento, vehiculo, bono, comisiones } o null.
   * Devuelve { dias, cestaticketUSD, cestaticketPor: 'CESTATICKET'|'TRANSFERENCIA', CESTATICKET: $, TRANSFERENCIA: $, detalle }.
   */
  function montosDelMes(persona, mes, beneficio, parametros) {
    var p = Object.assign({}, PARAMETROS, parametros || {});
    var dias = diasCestaticket(persona.fechaIngreso, mes);
    var cesta = r2(p.cestaticket * dias / 30);
    var porTransferencia = !!persona.sinTarjeta || ingresoEnElMes(persona.fechaIngreso, mes);
    var det = { cestaticket: cesta };
    ADICIONALES.forEach(function (k) { det[k] = r2(beneficio && beneficio[k]); });
    var adic = ADICIONALES.reduce(function (t, k) { return t + det[k]; }, 0);
    return { dias: dias, cestaticketUSD: cesta, cestaticketPor: porTransferencia ? 'TRANSFERENCIA' : 'CESTATICKET',
      CESTATICKET: porTransferencia ? 0 : cesta, TRANSFERENCIA: r2(adic + (porTransferencia ? cesta : 0)), detalle: det };
  }

  /** Bs. a pagar en la quincena: 1Q = 50 % × tasa (0 si ingresó tras el 15); 2Q = 100 % × tasa − lo pagado en la 1Q. */
  function montoQuincena(usd, q, tasa, pagado1Q, sinAnticipo) {
    if (Number(q) === 1) return sinAnticipo ? 0 : r2(usd / 2 * Number(tasa || 0));
    return r2(usd * Number(tasa || 0) - Number(pagado1Q || 0));
  }

  /**
   * Líneas de los 4 lotes de una quincena.
   * personas: [{ clave, cedula, nombre, empresa, fechaIngreso, sinTarjeta }] (solo activos: los egresados no cobran)
   * beneficios: { clave: {...} }; pagado1Q: { loteId: { clave: Bs } } (lo cerrado en la 1Q, para la 2Q)
   * Devuelve { 'CT-PCA': [ { clave, cedula, nombre, usd, montoBs, dias, sinAnticipo, detalle } ], ... }.
   */
  function lineasQuincena(personas, beneficios, mes, q, tasa, pagado1Q, parametros) {
    var r = {}; LOTES.forEach(function (l) { r[l.id] = []; });
    personas.forEach(function (pe) {
      var m = montosDelMes(pe, mes, beneficios[pe.clave], parametros), sinAnticipo = ingresoTrasPrimeraQuincena(pe.fechaIngreso, mes);
      ['CESTATICKET', 'TRANSFERENCIA'].forEach(function (tipo) {
        var id = (tipo === 'CESTATICKET' ? 'CT-' : 'TR-') + pe.empresa;
        if (!r[id]) return;
        var pag = pagado1Q && pagado1Q[id] ? pagado1Q[id][pe.clave] : 0;
        if (!(m[tipo] > 0) && !(pag > 0)) return;
        var monto = montoQuincena(m[tipo], q, tasa, pag, sinAnticipo);
        r[id].push({ clave: pe.clave, cedula: pe.cedula, nombre: pe.nombre, usd: m[tipo], montoBs: monto, anticipoBs: Number(q) === 2 ? r2(pag) : 0,
          dias: m.dias, sinAnticipo: Number(q) === 1 && sinAnticipo, sinTarjeta: !!pe.sinTarjeta, ingresoMes: ingresoEnElMes(pe.fechaIngreso, mes),
          detalle: tipo === 'CESTATICKET' ? { cestaticket: m.CESTATICKET } : Object.assign({}, m.detalle, { cestaticket: m.cestaticketPor === 'TRANSFERENCIA' ? m.cestaticketUSD : 0 }) });
      });
    });
    Object.keys(r).forEach(function (k) { r[k].sort(function (a, b) { return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0; }); });
    return r;
  }

  /** Totales de un lote para Omega: subtotal + comisión + IVA de la comisión − retención del IVA. */
  function totalesOmega(subtotal, parametros) {
    var p = Object.assign({}, PARAMETROS, parametros || {});
    var comision = r2(subtotal * p.comision), iva = r2(comision * p.iva), retencion = r2(iva * p.retencion);
    return { subtotal: r2(subtotal), comision: comision, iva: iva, retencion: retencion, totalPagar: r2(subtotal + comision + iva - retencion) };
  }

  /** Avisos de la macro de Omega para una línea (no impiden generar el archivo, salvo los errores). */
  function revisarLinea(l) {
    var avisos = [], ced = Number(String(l.cedula).replace(/\D/g, ''));
    if (!(ced > 0)) avisos.push({ tipo: 'error', texto: 'Cédula no válida' });
    else if (ced < 1000000 || (ced > 30000000 && ced < 80000000) || ced > 100000000) avisos.push({ tipo: 'aviso', texto: 'Cédula fuera del rango habitual' });
    if (!(l.montoBs > 0)) avisos.push({ tipo: 'aviso', texto: 'Monto en cero: no va en el archivo' });
    return avisos;
  }

  function soloAlfanumerico(t) {
    return String(t || '').toUpperCase().replace(/ /g, ' ').split('').filter(function (c) { return c === ' ' || '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÄËÏÖÜ'.indexOf(c) !== -1; }).join('').trim();
  }

  /**
   * Archivo de solicitud de depósito de Omega (igual que la macro V7.0):
   *   control: '255' + aammdd + RIF (10) + n.º de beneficiarios (5) + '005' + aaaammdd + total en céntimos (18)
   *   detalle: n.º TAB cédula TAB monto en céntimos TAB, con CRLF; la última línea sin salto.
   * datos: { razonSocial, rif, fecha: { y, m, d }, lineas: [{ cedula, montoBs }] }. Solo van las líneas con monto > 0.
   */
  function archivoDeposito(datos) {
    var rif = String(datos.rif || '').replace(/-/g, '').trim().toUpperCase();
    if (!/^[JGVE]\d{9}$/.test(rif)) return { error: 'El RIF de la empresa debe ser una letra (J, G, V o E) y 9 dígitos. Ejemplo: J001417710.' };
    var empresa = soloAlfanumerico(datos.razonSocial);
    if (!empresa) return { error: 'Falta la razón social de la empresa.' };
    var f = datos.fecha, dos = function (n) { return ('0' + n).slice(-2); };
    var aammdd = String(f.y).slice(2) + dos(f.m) + dos(f.d);
    var lineas = (datos.lineas || []).filter(function (l) { return Math.round(r2(l.montoBs) * 100) > 0; });
    if (!lineas.length) return { error: 'El lote no tiene montos para depositar.' };
    var malas = lineas.filter(function (l) { return !(Number(String(l.cedula).replace(/\D/g, '')) > 0); });
    if (malas.length) return { error: 'Hay ' + malas.length + ' cédula(s) no válida(s).' };
    var total = lineas.reduce(function (t, l) { return t + Math.round(r2(l.montoBs) * 100); }, 0);
    var pad = function (n, k) { var s = String(n); while (s.length < k) s = '0' + s; return s; };
    var control = '255' + aammdd + (rif + '               ').slice(0, 10) + pad(lineas.length, 5) + '005' + f.y + dos(f.m) + dos(f.d) + pad(total, 18);
    var det = lineas.map(function (l, i) { return (i + 1) + '\t' + Number(String(l.cedula).replace(/\D/g, '')) + '\t' + Math.round(r2(l.montoBs) * 100) + '\t'; });
    return { nombre: 'DEP' + empresa.replace(/ /g, '') + aammdd + '.txt', contenido: control + '\r\n' + det.join('\r\n'), beneficiarios: lineas.length, total: total / 100 };
  }

  /**
   * Lee el Excel de beneficios de Omega Transferencia (encabezados en las primeras filas):
   * «Cédula», «Nombre…», «Monto de complemento de alimentación aprobado», «Ayuda de vehículo», «Bono especial», «Comisiones garantizadas».
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

  var api = { PARAMETROS: PARAMETROS, EMPRESAS: EMPRESAS, LOTES: LOTES, ADICIONALES: ADICIONALES, r2: r2, esMes: esMes, idQuincena: idQuincena, lote: lote,
    diasCestaticket: diasCestaticket, ingresoEnElMes: ingresoEnElMes, ingresoTrasPrimeraQuincena: ingresoTrasPrimeraQuincena, montosDelMes: montosDelMes,
    montoQuincena: montoQuincena, lineasQuincena: lineasQuincena, totalesOmega: totalesOmega, revisarLinea: revisarLinea, archivoDeposito: archivoDeposito,
    leerExcelBeneficios: leerExcelBeneficios, soloAlfanumerico: soloAlfanumerico };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Omega = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
