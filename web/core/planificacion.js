/* ==========================================================
   Planificación anual de vacaciones y su cumplimiento.
   Funciones puras. Fechas como texto 'AAAA-MM-DD'.
   ========================================================== */
(function (raiz) {
  'use strict';

  function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var Vacaciones = isNode ? require('./vacaciones.js') : dependencia(raiz, 'Vacaciones');

  var ESTADOS = { BORRADOR: 'BORRADOR', ENVIADA: 'ENVIADA', APROBADA: 'APROBADA', RECHAZADA: 'RECHAZADA' };
  var DIA = 86400000;
  function aDia(t) { var p = String(t).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DIA); }
  function deDia(n) { return new Date(n * DIA).toISOString().slice(0, 10); }
  function esFecha(t) { return /^\d{4}-\d{2}-\d{2}$/.test(String(t)) && !isNaN(aDia(t)); }
  function corta(t) { var p = String(t).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  /** Valida las fechas de una planificación que abre RRHH. */
  function validarCiclo(c) {
    var e = [];
    if (!String(c.nombre || '').trim()) e.push('Escribe el nombre (por ejemplo, «Vacaciones 2027»).');
    ['desde', 'hasta', 'abre', 'cierra'].forEach(function (k) { if (!esFecha(c[k])) e.push('Falta la fecha «' + k + '».'); });
    if (!e.length) {
      if (c.hasta <= c.desde) e.push('El período a planificar debe terminar después de empezar.');
      if (c.cierra < c.abre) e.push('La fecha de cierre debe ser después de la de apertura.');
      if (aDia(c.hasta) - aDia(c.desde) > 450) e.push('El período a planificar no puede pasar de 15 meses.');
    }
    return { ok: !e.length, errores: e };
  }

  /**
   * Días que la persona debe planificar: sus pendientes de hoy más los de cada período que cumple dentro de
   * [desde, hasta]. disponibles: [{ fecha, dias }] — desde qué fecha puede usar cada grupo de días (no se adelantan).
   */
  function requeridos(saldoTotal, ingreso, importados, hoy, desde, hasta) {
    var actuales = Vacaciones.periodosDeEmpleado(ingreso, importados, hoy);
    var conocidos = {}; actuales.forEach(function (p) { conocidos[p.periodo] = true; });
    var disponibles = [{ fecha: desde, dias: saldoTotal, periodo: 'pendientes' }];
    var nuevos = Vacaciones.periodosDeEmpleado(ingreso, importados, hasta).filter(function (p) { return !conocidos[p.periodo]; });
    nuevos.forEach(function (p) {
      var y = Number(p.periodo.split('-')[1]), mmdd = String(ingreso).slice(5);
      var aniversario = y + '-' + (mmdd === '02-29' ? '02-28' : mmdd);
      disponibles.push({ fecha: aniversario < desde ? desde : aniversario, dias: p.correspondientes, periodo: p.periodo });
    });
    return { total: disponibles.reduce(function (t, d) { return t + d.dias; }, 0), pendientes: saldoTotal, nuevos: nuevos.map(function (p, i) {
      return { periodo: p.periodo, dias: p.correspondientes, desde: disponibles[i + 1].fecha };
    }), disponibles: disponibles };
  }

  /** Completa cada bloque { inicio, dias } con culminación y reintegro, en orden de fecha. */
  function calcularBloques(bloques, feriados) {
    return (bloques || []).map(function (b) {
      var dias = Number(b.dias), inicio = String(b.inicio || '');
      var fin = esFecha(inicio) && dias >= 1 ? Vacaciones.culminacion(inicio, dias, feriados) : '';
      return { inicio: inicio, dias: dias, culminacion: fin, reintegro: fin ? Vacaciones.siguienteHabil(fin, feriados) : '' };
    }).sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
  }

  /**
   * Revisa una planificación. Para enviarla: bloques dentro del período, en día hábil, sin cruzarse, sin usar días
   * antes de tenerlos y sumando exactamente los días requeridos. ciclo: { desde, hasta }; req: resultado de requeridos().
   */
  function validarPlan(bloques, ciclo, req, feriados, paraEnviar) {
    var e = [], calc = calcularBloques(bloques, feriados);
    calc.forEach(function (b, i) {
      var n = 'Bloque ' + (i + 1) + ': ';
      if (!esFecha(b.inicio)) { e.push(n + 'elige la fecha de inicio.'); return; }
      if (!(b.dias >= 1 && b.dias === Math.floor(b.dias))) { e.push(n + 'los días deben ser un número entero mayor que cero.'); return; }
      if (b.inicio < ciclo.desde || b.culminacion > ciclo.hasta) e.push(n + 'debe quedar entre el ' + corta(ciclo.desde) + ' y el ' + corta(ciclo.hasta) + '.');
      if (Vacaciones.contarHabiles(b.inicio, b.inicio, feriados) !== 1) e.push(n + 'debe empezar en un día hábil.');
      if (i > 0 && calc[i - 1].culminacion && b.inicio <= calc[i - 1].culminacion) e.push(n + 'se cruza con el bloque anterior.');
    });
    var total = calc.reduce(function (t, b) { return t + (b.dias > 0 ? b.dias : 0); }, 0);
    // sin adelantar días: hasta cada bloque, lo planificado no puede pasar de lo que ya tendría
    var acumulado = 0;
    calc.forEach(function (b, i) {
      if (!esFecha(b.inicio) || !(b.dias > 0)) return;
      acumulado += b.dias;
      var tiene = req.disponibles.filter(function (d) { return d.fecha <= b.inicio; }).reduce(function (t, d) { return t + d.dias; }, 0);
      if (acumulado > tiene) e.push('Bloque ' + (i + 1) + ': para el ' + corta(b.inicio) + ' solo tendrías ' + tiene + ' días acumulados (no se adelantan días).');
    });
    if (total > req.total) e.push('Planificaste ' + total + ' días y te corresponden ' + req.total + '.');
    if (paraEnviar && total < req.total) e.push('Te faltan ' + (req.total - total) + ' días por planificar (debes planificar ' + req.total + ').');
    if (paraEnviar && !calc.length) e.push('Agrega al menos un bloque de vacaciones.');
    return { ok: !e.length, errores: e, bloques: calc, total: total };
  }

  /** Días hábiles en que se cruzan dos rangos [a1, a2] y [b1, b2]. */
  function cruce(a1, a2, b1, b2, feriados) {
    var d = a1 > b1 ? a1 : b1, h = a2 < b2 ? a2 : b2;
    return d <= h ? Vacaciones.contarHabiles(d, h, feriados) : 0;
  }

  /** ¿La solicitud cae completa dentro de los bloques planificados? */
  function enPlan(sol, bloques, feriados) {
    var dentro = (bloques || []).reduce(function (t, b) { return t + (b.culminacion ? cruce(sol.inicio, sol.culminacion, b.inicio, b.culminacion, feriados) : 0); }, 0);
    return dentro >= Vacaciones.contarHabiles(sol.inicio, sol.culminacion, feriados);
  }

  /** Meses 'AAAA-MM' entre dos fechas. */
  function meses(desde, hasta) {
    var r = [], y = +desde.slice(0, 4), m = +desde.slice(5, 7), fy = +hasta.slice(0, 4), fm = +hasta.slice(5, 7);
    while (y < fy || (y === fy && m <= fm)) { r.push(y + '-' + ('0' + m).slice(-2)); m++; if (m > 12) { m = 1; y++; } }
    return r;
  }
  function finDeMes(mes) { var y = +mes.slice(0, 4), m = +mes.slice(5, 7); return deDia(aDia((m === 12 ? y + 1 : y) + '-' + ('0' + (m === 12 ? 1 : m + 1)).slice(-2) + '-01') - 1); }

  /**
   * Cumplimiento de una persona: lo planificado contra lo disfrutado (solicitudes aprobadas por el jefe o registradas).
   * aLaFecha: días planificados que ya debieron disfrutarse hasta hoy. coinciden: días disfrutados dentro de lo planificado.
   */
  function cumplimiento(bloques, solicitudes, ciclo, feriados, hoy) {
    var reales = (solicitudes || []).filter(function (s) { return (s.estado === 'APROBADA_JEFE' || s.estado === 'REGISTRADA') && s.culminacion >= ciclo.desde && s.inicio <= ciclo.hasta; });
    var tope = hoy < ciclo.hasta ? hoy : ciclo.hasta;
    var r = { planificados: 0, aLaFecha: 0, disfrutados: 0, coinciden: 0, fueraDePlan: 0, porMes: {} };
    meses(ciclo.desde, ciclo.hasta).forEach(function (m) { r.porMes[m] = { planificados: 0, disfrutados: 0 }; });
    (bloques || []).forEach(function (b) {
      if (!b.culminacion) return;
      r.planificados += b.dias;
      r.aLaFecha += cruce(b.inicio, b.culminacion, ciclo.desde, tope, feriados);
      Object.keys(r.porMes).forEach(function (m) { r.porMes[m].planificados += cruce(b.inicio, b.culminacion, m + '-01', finDeMes(m), feriados); });
    });
    reales.forEach(function (s) {
      var dias = cruce(s.inicio, s.culminacion, ciclo.desde, ciclo.hasta, feriados);
      var dentro = (bloques || []).reduce(function (t, b) { return t + (b.culminacion ? cruce(s.inicio, s.culminacion, b.inicio, b.culminacion, feriados) : 0); }, 0);
      r.disfrutados += dias; r.coinciden += dentro; r.fueraDePlan += Math.max(0, dias - dentro);
      Object.keys(r.porMes).forEach(function (m) { r.porMes[m].disfrutados += cruce(s.inicio, s.culminacion, m + '-01', finDeMes(m), feriados); });
    });
    // % sobre lo que ya debió cumplirse (si aún no toca nada, no hay porcentaje)
    r.porcentaje = r.aLaFecha ? Math.round(Math.min(r.coinciden, r.aLaFecha) / r.aLaFecha * 100) : null;
    return r;
  }

  var api = { ESTADOS: ESTADOS, validarCiclo: validarCiclo, requeridos: requeridos, calcularBloques: calcularBloques, validarPlan: validarPlan,
    enPlan: enPlan, cumplimiento: cumplimiento, meses: meses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Planificacion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
