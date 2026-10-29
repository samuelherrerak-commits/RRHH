/* ==========================================================
   Cálculo del aporte trimestral al fideicomiso.
   Funciones puras: sin hojas, sin DOM, sin fecha del sistema.
   Las usan el servidor (Apps Script), el navegador y las pruebas.
   Las fechas se manejan como { y, m, d } (m = 1..12) para no
   depender de zonas horarias.
   ========================================================== */
(function (raiz) {
  'use strict';

  var PARAMETROS_POR_DEFECTO = {
    anioBase: 2025,
    diasMinimosMes: 1,
    diasUtilidades: 120,
    diasPorMes: 30,
    diasAntiguedadPorMes: 5,
    vacacionesBase: 15,
    vacacionesMaximo: 30,
    adicionalesMaximo: 30,
  };

  function redondear2(n) {
    var signo = n < 0 ? -1 : 1;
    return signo * Math.round((Math.abs(n) + 1e-9) * 100) / 100;
  }

  function diasDelMes(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /** Acepta {y,m,d}, "dd/mm/aaaa", "aaaa-mm-dd" o Date. Devuelve {y,m,d} o null. */
  function aFecha(v) {
    if (v == null || v === '') return null;
    var f = null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      f = { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    } else if (typeof v === 'object' && v.y) {
      f = { y: +v.y, m: +v.m, d: +v.d };
    } else if (typeof v === 'string') {
      var s = v.trim(), r;
      if ((r = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s))) f = { y: +r[3], m: +r[2], d: +r[1] };
      else if ((r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) f = { y: +r[1], m: +r[2], d: +r[3] };
    }
    if (!f || f.m < 1 || f.m > 12 || f.d < 1 || f.d > diasDelMes(f.y, f.m)) return null;
    return f;
  }

  /** Meses (1..12) que cubre un trimestre: T1 ene-mar ... T4 oct-dic. */
  function mesesDelTrimestre(trimestre) {
    if (!(trimestre >= 1 && trimestre <= 4)) throw new Error('Trimestre inválido: ' + trimestre);
    var primero = (trimestre - 1) * 3 + 1;
    return [primero, primero + 1, primero + 2];
  }

  /**
   * Meses que cuentan en el trimestre (0..3). Un mes cuenta si los días
   * trabajados en él son >= diasMinimosMes (por defecto 1: el mes completo
   * cuenta desde el primer día trabajado).
   */
  function mesesTrabajados(ingreso, anio, trimestre, diasMinimosMes) {
    var min = diasMinimosMes == null ? PARAMETROS_POR_DEFECTO.diasMinimosMes : diasMinimosMes;
    var f = aFecha(ingreso);
    if (!f) return 0;
    var cuenta = 0;
    mesesDelTrimestre(trimestre).forEach(function (m) {
      var dm = diasDelMes(anio, m), dias;
      if (f.y > anio || (f.y === anio && f.m > m)) dias = 0;
      else if (f.y === anio && f.m === m) dias = dm - f.d + 1;
      else dias = dm;
      if (dias >= min && dias > 0) cuenta++;
    });
    return cuenta;
  }

  /** Años cumplidos en el aniversario del trimestre, o null si no cae en él. */
  function aniosEnAniversario(ingreso, anio, trimestre) {
    var f = aFecha(ingreso);
    if (!f) return null;
    if (mesesDelTrimestre(trimestre).indexOf(f.m) === -1) return null;
    return anio - f.y;
  }

  function diasVacaciones(ingreso, p) {
    var f = aFecha(ingreso);
    var antig = f ? Math.max(0, p.anioBase - f.y) : 0;
    return Math.min(p.vacacionesMaximo, p.vacacionesBase + antig);
  }

  /**
   * Días adicionales por antigüedad: si el aniversario cae dentro del
   * trimestre, MIN(30, 2 × (años cumplidos − 1)); si no, 0.
   * Con 1 año cumplido (o menos) da 0.
   */
  function diasAdicionales(ingreso, anio, trimestre, p) {
    var anios = aniosEnAniversario(ingreso, anio, trimestre);
    if (anios == null) return 0;
    return Math.min(p.adicionalesMaximo, Math.max(0, 2 * (anios - 1)));
  }

  /**
   * Aporte de un empleado.
   * entrada: { monto, ingreso, anio, trimestre, diasAdicionalesForzados? }
   * Devuelve todos los componentes para mostrarlos en el detalle.
   */
  function calcularAporte(entrada, parametros) {
    var p = Object.assign({}, PARAMETROS_POR_DEFECTO, parametros || {});
    var monto = Number(entrada.monto);
    var meses = mesesTrabajados(entrada.ingreso, entrada.anio, entrada.trimestre, p.diasMinimosMes);
    var forzado = entrada.diasAdicionalesForzados;
    var hayForzado = forzado !== null && forzado !== undefined && forzado !== '';
    var r = {
      monto: monto,
      meses: meses,
      salarioDiario: 0,
      alicUtilidades: 0,
      diasVacaciones: diasVacaciones(entrada.ingreso, p),
      alicVacaciones: 0,
      diasAntiguedad: p.diasAntiguedadPorMes * meses,
      diasAdicionales: hayForzado ? Number(forzado) : diasAdicionales(entrada.ingreso, entrada.anio, entrada.trimestre, p),
      adicionalesForzados: hayForzado,
      total: 0,
    };
    if (!(meses > 0) || !isFinite(monto)) return r;
    r.salarioDiario = monto / (p.diasPorMes * meses);
    r.alicUtilidades = r.salarioDiario * p.diasUtilidades / 360;
    r.alicVacaciones = r.salarioDiario * r.diasVacaciones / 360;
    r.total = redondear2(
      (r.salarioDiario + r.alicUtilidades + r.alicVacaciones) * (r.diasAntiguedad + r.diasAdicionales)
    );
    return r;
  }

  var api = {
    PARAMETROS_POR_DEFECTO: PARAMETROS_POR_DEFECTO,
    redondear2: redondear2, diasDelMes: diasDelMes, aFecha: aFecha,
    mesesDelTrimestre: mesesDelTrimestre, mesesTrabajados: mesesTrabajados,
    aniosEnAniversario: aniosEnAniversario, diasVacaciones: diasVacaciones,
    diasAdicionales: diasAdicionales, calcularAporte: calcularAporte,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Calculo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
