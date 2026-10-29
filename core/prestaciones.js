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
    EN_ARCHIVO: ['PAGADA', 'APROBADA'],   // enviada al banco; se puede devolver
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

  var api = {
    PARAMETROS: PARAMETROS, ESTADOS_CIERRE: ESTADOS_CIERRE,
    SIGUIENTE_CIERRE: SIGUIENTE_CIERRE, SIGUIENTE_SOLICITUD: SIGUIENTE_SOLICITUD,
    puedePasar: puedePasar, resumenTrabajador: resumenTrabajador,
    validarSolicitudAnticipo: validarSolicitudAnticipo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Prestaciones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
