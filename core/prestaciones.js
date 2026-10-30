/* ==========================================================
   Módulo 1 · Prestaciones sociales: lo que ve el trabajador y
   las reglas del anticipo. Funciones puras.
   ========================================================== */
(function (raiz) {
  'use strict';

  // En Apps Script los archivos se cargan en el orden de la lista; así la dependencia se resuelve al usarla, no al cargar.
  function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }

  var Calculo = (typeof require === 'function' && typeof module !== 'undefined') ? require('./calculo.js') : dependencia(raiz, 'Calculo');

  var PARAMETROS = {
    porcentajeAnticipoMax: 0.75,      // editable en PARAMETROS
    motivos: ['Vivienda', 'Salud', 'Educación', 'Otro'],
  };

  /** Ciclo de vida de un cierre trimestral por empresa. */
  var ESTADOS_CIERRE = ['ABIERTO', 'CERRADO', 'ACREDITADO'];
  var SIGUIENTE_CIERRE = { ABIERTO: ['CERRADO'], CERRADO: ['ACREDITADO', 'ABIERTO'], ACREDITADO: [] };

  /** Ciclo de vida de una solicitud de anticipo. */
  var SIGUIENTE_SOLICITUD = {
    PENDIENTE: ['APROBADA', 'RECHAZADA', 'CANCELADA'],
    APROBADA: ['EN_ARCHIVO', 'RECHAZADA'],
    EN_ARCHIVO: ['PAGADA', 'APROBADA', 'RECHAZADA'],   // enviada al banco; se puede devolver, o el banco la rechaza
    PAGADA: [], RECHAZADA: [], CANCELADA: [],
  };

  function puedePasar(tabla, de, a) {
    return (tabla[de] || []).indexOf(a) !== -1;
  }

  /**
   * Lo que ve el trabajador: solo aportes de cierres ACREDITADOS
   * (el banco ya los procesó). aportes: [{anio, trimestre, empresa, total, estadoCierre}]
   */
  function resumenTrabajador(aportes, anticipos, parametros) {
    var p = Object.assign({}, PARAMETROS, parametros || {});
    var visibles = aportes.filter(function (a) { return a.estadoCierre === 'ACREDITADO'; })
      .sort(function (a, b) { return a.anio - b.anio || a.trimestre - b.trimestre; });
    var acumulado = 0;
    var detalle = visibles.map(function (a) {
      acumulado = Calculo.redondear2(acumulado + a.total);
      return { anio: a.anio, trimestre: a.trimestre, empresa: a.empresa, aporte: a.total, acumulado: acumulado };
    });
    var pagado = anticipos.filter(function (x) { return x.estado === 'PAGADA'; })
      .reduce(function (s, x) { return s + x.monto; }, 0);
    var comprometido = anticipos.filter(function (x) { return ['PENDIENTE', 'APROBADA', 'EN_ARCHIVO'].indexOf(x.estado) !== -1; })
      .reduce(function (s, x) { return s + x.monto; }, 0);
    var tope = Calculo.redondear2(acumulado * p.porcentajeAnticipoMax);
    return {
      totalAportado: acumulado,
      anticiposPagados: Calculo.redondear2(pagado),
      anticiposEnTramite: Calculo.redondear2(comprometido),
      disponible: Math.max(0, Calculo.redondear2(tope - pagado - comprometido)),
      porcentajeMax: p.porcentajeAnticipoMax,
      detalle: detalle,
    };
  }

  /** Validación de una solicitud nueva. Devuelve { ok, errores[] }. */
  function validarSolicitudAnticipo(sol, resumen, empleado, parametros) {
    var p = Object.assign({}, PARAMETROS, parametros || {});
    var e = [];
    if (!empleado || empleado.estado === 'Inactivo') e.push('El empleado no está activo.');
    var monto = Number(sol.monto);
    if (!isFinite(monto) || monto <= 0) e.push('El monto debe ser mayor a cero.');
    else if (monto > resumen.disponible) e.push('El monto supera lo disponible (' + resumen.disponible.toFixed(2) + ').');
    if (p.motivos.indexOf(sol.motivo) === -1) e.push('Motivo no válido.');
    if (sol.motivo === 'Otro' && !String(sol.detalle || '').trim()) e.push('Explica el motivo.');
    return { ok: e.length === 0, errores: e };
  }

  /* ---------- Ventana trimestral de solicitudes (sin saldo en el sistema: el colaborador lo ve en su banco) ---------- */

  var ORDINAL = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º' };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /** '2026-T4' → '4.º trimestre de 2026' */
  function etiquetaVentana(clave) {
    var m = /^(\d{4})-T([1-4])$/.exec(String(clave || ''));
    return m ? ORDINAL[m[2]] + ' trimestre de ' + m[1] : '';
  }

  /**
   * Cada trimestre calendario se puede enviar UNA solicitud, y corresponde al trimestre anterior
   * (en enero de 2027 se solicita por el 4.º trimestre de 2026). hoy: 'AAAA-MM-DD'.
   */
  function ventanaAnticipo(hoy) {
    var y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7)), q = Math.ceil(m / 3);
    var vy = q === 1 ? y - 1 : y, vq = q === 1 ? 4 : q - 1;
    var sy = q === 4 ? y + 1 : y, sq = q === 4 ? 1 : q + 1;          // próxima ventana (calendario)
    var mesProx = (sq - 1) * 3;                                      // 0 = enero
    var clave = vy + '-T' + vq, siguiente = (q === 4 ? y : sy) + '-T' + q;
    return {
      clave: clave, etiqueta: etiquetaVentana(clave),
      siguiente: { clave: siguiente, etiqueta: etiquetaVentana(siguiente), abre: sy + '-' + ('0' + (mesProx + 1)).slice(-2) + '-01', mes: MESES[mesProx] + ' de ' + sy },
    };
  }

  /**
   * Solicitud sin saldo en el sistema: monto y motivo, aceptación de responsabilidad y una por ventana.
   * c: { empleado, previas (anticipos del colaborador), ventana, parametros }
   */
  function validarSolicitudBanco(sol, c) {
    var p = Object.assign({}, PARAMETROS, c.parametros || {}), e = [];
    if (!c.empleado || c.empleado.estado === 'Inactivo') e.push('El empleado no está activo.');
    var monto = Number(sol.monto);
    if (!isFinite(monto) || monto <= 0) e.push('Escribe el monto que quieres solicitar.');
    if (p.motivos.indexOf(sol.motivo) === -1) e.push('Elige el motivo.');
    if (sol.motivo === 'Otro' && !String(sol.detalle || '').trim()) e.push('Explica el motivo.');
    if (sol.acepta !== true) e.push('Debes confirmar que revisaste tu disponible en el banco y que envías el monto bajo tu responsabilidad.');
    var ya = (c.previas || []).filter(function (a) { return a.ventana === c.ventana.clave && a.estado !== 'CANCELADA'; })[0];
    if (ya) e.unshift('Ya enviaste tu solicitud del ' + c.ventana.etiqueta + '. Podrás hacer otra a partir de ' + c.ventana.siguiente.mes + ' (' + c.ventana.siguiente.etiqueta + ').');
    return { ok: e.length === 0, errores: e };
  }

  var api = {
    etiquetaVentana: etiquetaVentana, ventanaAnticipo: ventanaAnticipo, validarSolicitudBanco: validarSolicitudBanco,
    PARAMETROS: PARAMETROS, ESTADOS_CIERRE: ESTADOS_CIERRE,
    SIGUIENTE_CIERRE: SIGUIENTE_CIERRE, SIGUIENTE_SOLICITUD: SIGUIENTE_SOLICITUD,
    puedePasar: puedePasar, resumenTrabajador: resumenTrabajador,
    validarSolicitudAnticipo: validarSolicitudAnticipo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Prestaciones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
