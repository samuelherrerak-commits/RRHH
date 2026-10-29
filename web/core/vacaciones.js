/* ==========================================================
   Vacaciones: días hábiles, períodos, saldo y reglas de la solicitud.
   Funciones puras. Fechas como texto 'AAAA-MM-DD' (sin horas ni zonas).
   ========================================================== */
(function (raiz) {
  'use strict';

  var REGLAS = { anticipacionMin: 15, anticipacionMax: 20, diasBase: 15, diasTope: 30 };
  var ACTIVAS = ['PENDIENTE_JEFE', 'APROBADA_JEFE', 'REGISTRADA'];
  var CON_PAGO = 'Disfrute de días con pago';
  var SIN_PAGO = 'Disfrute';

  /* ---------- Fechas ---------- */

  function aDia(txt) {                       // 'AAAA-MM-DD' → número de día (UTC)
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(txt || ''));
    if (!m) return NaN;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return NaN;
    return t / 86400000;
  }
  function deDia(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function sumarDiasTxt(txt, n) { return deDia(aDia(txt) + n); }
  function esFecha(txt) { return !isNaN(aDia(txt)); }
  /** {y,m,d} → 'AAAA-MM-DD' */
  function deObjeto(f) { return f ? f.y + '-' + ('0' + f.m).slice(-2) + '-' + ('0' + f.d).slice(-2) : ''; }
  /** 'AAAA-MM-DD' → 'DD/MM/AAAA' */
  function corta(txt) { var p = String(txt).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  function conjunto(feriados) {
    var s = {};
    (feriados || []).forEach(function (f) { s[f] = true; });
    return s;
  }

  /** Lunes a viernes que no sea feriado. */
  function esHabil(txt, fer) {
    var dow = new Date(aDia(txt) * 86400000).getUTCDay();
    return dow !== 0 && dow !== 6 && !fer[txt];
  }

  /** Días hábiles entre dos fechas, ambas incluidas (como NETWORKDAYS). */
  function contarHabiles(desde, hasta, feriados) {
    var fer = conjunto(feriados), n = 0;
    for (var d = aDia(desde); d <= aDia(hasta); d++) if (esHabil(deDia(d), fer)) n++;
    return n;
  }

  /** Fecha del día hábil número `dias` contando desde `inicio` (inicio = día 1). */
  function culminacion(inicio, dias, feriados) {
    var fer = conjunto(feriados), d = aDia(inicio), cuenta = 0;
    for (var i = 0; i < 400; i++, d++) {
      if (esHabil(deDia(d), fer) && ++cuenta === dias) return deDia(d);
    }
    return '';
  }

  /** Siguiente día hábil después de `fecha` (reintegro). */
  function siguienteHabil(fecha, feriados) {
    var fer = conjunto(feriados), d = aDia(fecha) + 1;
    while (!esHabil(deDia(d), fer)) d++;
    return deDia(d);
  }

  /* ---------- Períodos y saldo ---------- */

  /** Días que corresponden al cumplir `anios` de servicio: 15 + (años − 1), tope 30. */
  function diasPorAnios(anios, r) {
    r = r || REGLAS;
    return anios >= 1 ? Math.min(r.diasTope, r.diasBase + anios - 1) : 0;
  }

  /** '2024-2025' → año en que termina (2025). */
  function finPeriodo(p) { return Number(String(p).split('-')[1]); }

  /**
   * Períodos de un empleado: los importados del cierre y, después del último (o desde el ingreso si
   * no hay cierre), uno por cada aniversario ya cumplido hasta `hoy`, con la regla de la ley.
   * importados: [{ periodo:'2024-2025', correspondientes, disfrutadosPrevios }]
   */
  function periodosDeEmpleado(ingreso, importados, hoy, r) {
    var lista = (importados || []).map(function (p) {
      return { periodo: p.periodo, correspondientes: Number(p.correspondientes) || 0, disfrutadosPrevios: Number(p.disfrutadosPrevios) || 0, origen: 'CIERRE' };
    }).sort(function (a, b) { return finPeriodo(a.periodo) - finPeriodo(b.periodo); });
    if (!esFecha(ingreso)) return lista;
    var yIng = Number(ingreso.slice(0, 4)), mmdd = ingreso.slice(5);
    var desde = lista.length ? finPeriodo(lista[lista.length - 1].periodo) + 1 : yIng + 1;
    var yHoy = Number(hoy.slice(0, 4));
    for (var y = desde; y <= yHoy; y++) {
      var aniversario = y + '-' + (mmdd === '02-29' ? '02-28' : mmdd);
      if (aniversario > hoy) break;                 // aún no lo cumple
      lista.push({ periodo: (y - 1) + '-' + y, correspondientes: diasPorAnios(y - yIng, r), disfrutadosPrevios: 0, origen: 'REGLA' });
    }
    return lista;
  }

  /**
   * Saldo por período descontando las solicitudes activas (pendientes, aprobadas o registradas).
   * Pago: nómina paga un período completo cuando se empieza a disfrutar. Según el cierre, están pagados
   * todos los períodos hasta el último que tenga días disfrutados (antes del sistema o en una solicitud activa),
   * aunque alguno anterior figure con 0 disfrutados.
   */
  function saldo(periodos, solicitudes) {
    var usados = {};
    (solicitudes || []).filter(function (s) { return ACTIVAS.indexOf(s.estado) !== -1; }).forEach(function (s) {
      (s.imputacion || []).forEach(function (i) { usados[i.periodo] = (usados[i.periodo] || 0) + i.dias; });
    });
    var ultimoPagado = -1;
    periodos.forEach(function (p, i) { if (p.disfrutadosPrevios > 0 || usados[p.periodo]) ultimoPagado = i; });
    var porPeriodo = periodos.map(function (p, i) {
      var enSistema = usados[p.periodo] || 0;
      return {
        periodo: p.periodo, correspondientes: p.correspondientes, disfrutadosPrevios: p.disfrutadosPrevios, enSistema: enSistema,
        pendientes: Math.max(0, p.correspondientes - p.disfrutadosPrevios - enSistema), origen: p.origen,
        pagado: i <= ultimoPagado,
      };
    });
    return { porPeriodo: porPeriodo, total: porPeriodo.reduce(function (t, p) { return t + p.pendientes; }, 0) };
  }

  /**
   * Reparte `dias` empezando por el período más antiguo con días pendientes.
   * Cada parte dice si con ella se paga el período (primera vez que se disfruta de él).
   */
  function imputar(saldoActual, dias) {
    var resto = dias, partes = [];
    saldoActual.porPeriodo.forEach(function (p) {
      if (resto <= 0 || p.pendientes <= 0) return;
      var toma = Math.min(resto, p.pendientes);
      partes.push({ periodo: p.periodo, dias: toma, pagaPeriodo: !p.pagado, diasDelPeriodo: p.correspondientes });
      resto -= toma;
    });
    return resto > 0 ? null : partes;
  }

  function condicion(imputacion) {
    return imputacion.some(function (i) { return i.pagaPeriodo; }) ? CON_PAGO : SIN_PAGO;
  }

  /**
   * Valida una solicitud. Devuelve { ok, errores[], calculo: { culminacion, reintegro, imputacion, condicion } }.
   * c: { hoy, feriados, saldo, solicitudes (propias), tieneJefe, reglas }
   */
  function validarSolicitud(sol, c) {
    var r = Object.assign({}, REGLAS, c.reglas || {}), e = [];
    var dias = Number(sol.dias), inicio = String(sol.inicio || '');
    if (!c.tieneJefe) e.push('No tienes jefe directo asignado. Comunícate con Gestión Humana para que lo registren.');
    if (!(dias >= 1) || Math.floor(dias) !== dias) e.push('Indica cuántos días hábiles quieres disfrutar.');
    if (!esFecha(inicio)) e.push('Elige la fecha de inicio.');
    if (e.length) return { ok: false, errores: e };

    var desde = sumarDiasTxt(c.hoy, r.anticipacionMin), hasta = sumarDiasTxt(c.hoy, r.anticipacionMax);
    if (inicio < desde || inicio > hasta) e.push('La fecha de inicio debe estar entre el ' + corta(desde) + ' y el ' + corta(hasta) + ' (de ' + r.anticipacionMin + ' a ' + r.anticipacionMax + ' días de anticipación).');
    else if (!esHabil(inicio, conjunto(c.feriados))) e.push('La fecha de inicio debe ser un día hábil (no fin de semana ni feriado).');
    if (dias > c.saldo.total) e.push('Solo tienes ' + c.saldo.total + ' días pendientes. Por ahora no se pueden adelantar días.');
    if (e.length) return { ok: false, errores: e };

    var fin = culminacion(inicio, dias, c.feriados);
    var choca = (c.solicitudes || []).filter(function (s) {
      return ACTIVAS.indexOf(s.estado) !== -1 && !(fin < s.inicio || inicio > s.culminacion);
    })[0];
    if (choca) return { ok: false, errores: ['Se cruza con otra solicitud tuya (del ' + corta(choca.inicio) + ' al ' + corta(choca.culminacion) + ').'] };
    var imp = imputar(c.saldo, dias);
    return { ok: true, errores: [], calculo: { culminacion: fin, reintegro: siguienteHabil(fin, c.feriados), imputacion: imp, condicion: condicion(imp) } };
  }

  /* ---------- Constancia de aprobación ---------- */

  /** Número de serie de Excel de una fecha (días desde 30/12/1899). */
  function serialExcel(txt) { return aDia(txt) + 25569; }

  /**
   * Número de constancia igual al del Excel de RRHH: serial(inicio) + cédula (8 dígitos) + serial(culminación) + serial(reintegro).
   * Ej.: 46272 + V07924627 + 46283 + 46286 → «46272V079246274628346286».
   */
  function numeroConstancia(sol, letra, numero) {
    var ced = (letra || 'V') + ('00000000' + String(numero)).slice(-8);
    return '' + serialExcel(sol.inicio) + ced + serialExcel(sol.culminacion) + serialExcel(sol.reintegro);
  }

  /**
   * Pendientes que quedan «una vez aplicado el presente disfrute»: cuenta esta solicitud y las activas
   * anteriores a ella (no las que se pidieron después).
   */
  function pendientesTras(periodos, solicitudes, sol) {
    var previas = (solicitudes || []).filter(function (x) {
      return x.id === sol.id || (ACTIVAS.indexOf(x.estado) !== -1 && x.creada <= sol.creada);
    }).map(function (x) { return x.id === sol.id ? Object.assign({}, x, { estado: 'REGISTRADA' }) : x; });
    if (!previas.some(function (x) { return x.id === sol.id; })) previas.push(Object.assign({}, sol, { estado: 'REGISTRADA' }));
    var s = saldo(periodos, previas);
    return { porPeriodo: s.porPeriodo.map(function (p) { return { periodo: p.periodo, pendientes: p.pendientes }; }), total: s.total };
  }

  /* ---------- Importar el «CIERRE DE VACACIONES» ---------- */

  /**
   * filas: matriz (primera fila = encabezados) de la hoja «CIERRE DE VACACIONES».
   * Por cada «DISFRUTADOS AA-AA» toma «CORRESPONDIENTE AA-AA» (o, si no tiene título, la columna anterior).
   * Devuelve { personas: [{ cedula, periodos:[{periodo:'2024-2025', correspondientes, disfrutadosPrevios}] }], periodos:[...] }
   */
  function mapearCierre(filas) {
    var norm = function (h) { return String(h == null ? '' : h).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); };
    var cab = (filas[0] || []).map(norm);
    var iCed = cab.indexOf('CEDULA');
    if (iCed === -1) throw new Error('No encontré la columna CEDULA en la hoja del cierre.');
    var cols = [];
    cab.forEach(function (h, j) {
      var m = /^DISFRUTADOS (\d{2})-(\d{2})$/.exec(h);
      if (!m) return;
      var jc = cab.indexOf('CORRESPONDIENTE ' + m[1] + '-' + m[2]);
      if (jc === -1) jc = j - 1;
      cols.push({ periodo: '20' + m[1] + '-20' + m[2], jc: jc, jd: j });
    });
    if (!cols.length) throw new Error('No encontré columnas «DISFRUTADOS AA-AA» en el cierre.');
    var num = function (v) { var n = Number(v); return isFinite(n) && v !== '' && v !== null ? n : 0; };
    var personas = [];
    filas.slice(1).forEach(function (f) {
      var ced = String(f[iCed] == null ? '' : f[iCed]).trim();
      if (!/^[VE]?-?\d{5,9}$/i.test(ced.replace(/\./g, ''))) return;
      personas.push({
        cedula: ced,
        periodos: cols.map(function (c) { return { periodo: c.periodo, correspondientes: num(f[c.jc]), disfrutadosPrevios: num(f[c.jd]) }; })
          .filter(function (p) { return p.correspondientes > 0 || p.disfrutadosPrevios > 0; }),
      });
    });
    return { personas: personas, periodos: cols.map(function (c) { return c.periodo; }) };
  }

  var api = {
    REGLAS: REGLAS, ACTIVAS: ACTIVAS, CON_PAGO: CON_PAGO, SIN_PAGO: SIN_PAGO,
    aDia: aDia, deDia: deDia, sumarDiasTxt: sumarDiasTxt, esFecha: esFecha, deObjeto: deObjeto, corta: corta,
    esHabil: function (txt, feriados) { return esHabil(txt, conjunto(feriados)); },
    contarHabiles: contarHabiles, culminacion: culminacion, siguienteHabil: siguienteHabil,
    diasPorAnios: diasPorAnios, periodosDeEmpleado: periodosDeEmpleado, saldo: saldo, imputar: imputar, condicion: condicion,
    validarSolicitud: validarSolicitud, mapearCierre: mapearCierre,
    serialExcel: serialExcel, numeroConstancia: numeroConstancia, pendientesTras: pendientesTras,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Vacaciones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
