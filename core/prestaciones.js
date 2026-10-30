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
    PENDIENTE: ['EN_ARCHIVO', 'APROBADA', 'RECHAZADA', 'CANCELADA'],   // sin aprobación: RRHH la incluye directo en el archivo del banco
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

  /* ---------- Aperturas de solicitudes (las abre RRHH con fecha de inicio y final) ----------
   * El colaborador no ve su saldo en el sistema: lo revisa en su banco. Cada apertura corresponde a un trimestre
   * (por ejemplo, del 05/01/2027 al 16/01/2027 por el 4.º trimestre de 2026) y admite UNA solicitud por persona.
   * Fechas como texto 'AAAA-MM-DD'. Una apertura: { id, clave:'2026-T4', inicio, fin }.
   */

  var ORDINAL = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º' };

  /** '2026-T4' → '4.º trimestre de 2026' */
  function etiquetaVentana(clave) {
    var m = /^(\d{4})-T([1-4])$/.exec(String(clave || ''));
    return m ? ORDINAL[m[2]] + ' trimestre de ' + m[1] : '';
  }

  function estadoApertura(c, hoy) { return hoy < c.inicio ? 'PROXIMA' : hoy > c.fin ? 'CERRADA' : 'ABIERTA'; }

  /** La apertura vigente hoy (o null) y la próxima programada (o null). */
  function aperturas(lista, hoy) {
    var orden = (lista || []).slice().sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
    return {
      activa: orden.filter(function (c) { return estadoApertura(c, hoy) === 'ABIERTA'; }).pop() || null,
      proxima: orden.filter(function (c) { return estadoApertura(c, hoy) === 'PROXIMA'; })[0] || null,
    };
  }

  /** Valida una apertura nueva o editada contra las existentes: fechas, trimestre único y sin cruces. */
  function validarApertura(c, lista) {
    var e = [], re = /^\d{4}-\d{2}-\d{2}$/;
    if (!etiquetaVentana(c.clave)) e.push('Elige el trimestre.');
    if (!re.test(c.inicio || '') || !re.test(c.fin || '')) e.push('Indica la fecha de inicio y la fecha final.');
    else if (c.fin < c.inicio) e.push('La fecha final no puede ser anterior a la de inicio.');
    if (e.length) return { ok: false, errores: e };
    (lista || []).forEach(function (o) {
      if (o.id === c.id) return;
      if (o.clave === c.clave) e.push('Ya hay una apertura para el ' + etiquetaVentana(c.clave) + '.');
      else if (!(c.fin < o.inicio || c.inicio > o.fin)) e.push('Se cruza con la apertura del ' + etiquetaVentana(o.clave) + '.');
    });
    return { ok: e.length === 0, errores: e };
  }

  /**
   * Solicitud sin saldo en el sistema: monto y motivo, aceptación de responsabilidad, apertura vigente y una por apertura.
   * c: { empleado, previas (anticipos del colaborador), activa, proxima, parametros }
   */
  function validarSolicitudBanco(sol, c) {
    var p = Object.assign({}, PARAMETROS, c.parametros || {}), e = [];
    var luego = c.proxima ? 'La próxima apertura es del ' + corta(c.proxima.inicio) + ' al ' + corta(c.proxima.fin) + '.' : 'Gestión Humana anunciará la próxima apertura.';
    if (!c.activa) return { ok: false, errores: ['La solicitud de anticipos no está abierta en este momento. ' + luego] };
    if (!c.empleado || c.empleado.estado === 'Inactivo') e.push('El empleado no está activo.');
    var monto = Number(sol.monto);
    if (!isFinite(monto) || monto <= 0) e.push('Escribe el monto que quieres solicitar.');
    if (p.motivos.indexOf(sol.motivo) === -1) e.push('Elige el motivo.');
    if (sol.motivo === 'Otro' && !String(sol.detalle || '').trim()) e.push('Explica el motivo.');
    if (sol.acepta !== true) e.push('Debes confirmar que revisaste tu disponible en el banco y que envías el monto bajo tu responsabilidad.');
    var ya = (c.previas || []).filter(function (a) { return a.ventana === c.activa.clave && a.estado !== 'CANCELADA'; })[0];
    if (ya) e.unshift('Ya enviaste tu solicitud del ' + etiquetaVentana(c.activa.clave) + '. ' + luego);
    return { ok: e.length === 0, errores: e };
  }

  function corta(txt) { var x = String(txt).split('-'); return x[2] + '/' + x[1] + '/' + x[0]; }

  var api = {
    etiquetaVentana: etiquetaVentana, estadoApertura: estadoApertura, aperturas: aperturas, validarApertura: validarApertura,
    validarSolicitudBanco: validarSolicitudBanco,
    PARAMETROS: PARAMETROS, ESTADOS_CIERRE: ESTADOS_CIERRE,
    SIGUIENTE_CIERRE: SIGUIENTE_CIERRE, SIGUIENTE_SOLICITUD: SIGUIENTE_SOLICITUD,
    puedePasar: puedePasar, resumenTrabajador: resumenTrabajador,
    validarSolicitudAnticipo: validarSolicitudAnticipo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Prestaciones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
