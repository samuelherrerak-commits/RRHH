/* ==========================================================
   Planilla AR-I (ISLR sobre sueldos y salarios): mismo cálculo que el formato del SENIAT
   que usa Gestión Humana («Planilla de ARI»), casilla por casilla.
   Funciones puras: las usan el navegador, Apps Script y las pruebas.
   ========================================================== */
(function (raiz) {
  'use strict';

  var UT_DEFECTO = 43;                 // valor de la unidad tributaria (Bs.) del Excel de Gestión Humana
  var DESGRAVAMEN_UNICO = 774;         // U.T. (art. 61 de la Ley)
  var REBAJA_PERSONAL = 10;            // U.T. (art. 63)
  var REBAJA_CARGA = 10;               // U.T. por cada carga familiar
  var UMBRAL = 1000;                   // U.T.: por debajo no hay retención obligatoria
  // Tarifa N.º 1: [hasta U.T., tasa, sustraendo U.T.]
  var TARIFA = [[1000, 0.06, 0], [1500, 0.09, 30], [2000, 0.12, 75], [2500, 0.16, 155], [3000, 0.20, 255], [4000, 0.24, 375], [6000, 0.29, 575], [Infinity, 0.34, 875]];
  var DESGRAVAMENES = [
    { id: 'educacion', nombre: 'Institutos docentes por la educación del contribuyente y descendientes no mayores de 25 años' },
    { id: 'hcm', nombre: 'Primas de seguros de hospitalización, cirugía y maternidad' },
    { id: 'medicos', nombre: 'Servicios médicos, odontológicos y de hospitalización (incluye carga familiar)' },
    { id: 'vivienda', nombre: 'Intereses para la adquisición de la vivienda principal o lo pagado por alquiler de la vivienda' },
  ];
  var MESES_VARIACION = { 3: 'MARZO', 6: 'JUNIO', 9: 'SEPT.', 12: 'DIC.' };

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function r2(v) { return Math.round((n(v) + Number.EPSILON) * 100) / 100; }

  /** Impuesto (U.T.) de la tarifa N.º 1 para un enriquecimiento F (U.T.), igual que la fórmula de la casilla G del Excel. */
  function impuestoTarifa(f) {
    for (var i = 0; i < TARIFA.length; i++) if (f <= TARIFA[i][0]) return f * TARIFA[i][1] - TARIFA[i][2];
    return 0;
  }

  /**
   * datos: { ut, remuneraciones: [a, b, c, d] (Bs.; a = esta empresa), desgravamenes: { educacion, hcm, medicos, vivienda } (Bs.),
   *          cargas (cantidad), retenidoDeMas (Bs., años anteriores), variacion: { retenido, percibido } (Bs., hasta la fecha) }
   * Devuelve todas las casillas: A (Bs.), B (U.T.), C (Bs.), D, E, F, G, H (U.T.), I (U.T.), J y K (%).
   */
  function calcular(datos) {
    var d = datos || {}, ut = n(d.ut) > 0 ? n(d.ut) : UT_DEFECTO;
    var rem = [0, 1, 2, 3].map(function (i) { return Math.max(0, n((d.remuneraciones || [])[i])); });
    var A = rem[0] + rem[1] + rem[2] + rem[3];
    var B = A / ut;
    var des = {}; DESGRAVAMENES.forEach(function (x) { des[x.id] = Math.max(0, n((d.desgravamenes || {})[x.id])); });
    var C = des.educacion + des.hcm + des.medicos + des.vivienda;
    var D = C / ut;
    var E = C > 0 ? 0 : DESGRAVAMEN_UNICO;
    var F = B - (D === 0 ? E : D);
    var G = impuestoTarifa(F);
    var cargas = Math.max(0, Math.floor(n(d.cargas)));
    var h3 = Math.max(0, n(d.retenidoDeMas)) / ut;
    var H = REBAJA_PERSONAL + cargas * REBAJA_CARGA + h3;
    var I = G < H ? 0 : G - H;
    var J = B > 0 ? I / B * 100 : 0;
    var v = d.variacion || null, K = null;
    if (v) {
      var base = rem[0] - n(v.percibido);
      K = base > 0 ? (I * ut - n(v.retenido)) / base * 100 : 0;
      if (K < 0) K = 0;
    }
    return {
      ut: ut, remuneraciones: rem, A: r2(A), B: r2(B), desgravamenes: des, C: r2(C), D: r2(D), E: E, unico: C === 0,
      F: r2(F), G: r2(G), cargas: cargas, rebajas: { personal: REBAJA_PERSONAL, cargas: cargas * REBAJA_CARGA, retenido: r2(h3) }, H: r2(H),
      I: r2(I), J: r2(J), K: K == null ? null : r2(K), sobreUmbral: B > UMBRAL,
    };
  }

  /**
   * Estimación de lo que cobrará en el año en esta empresa (casilla a): salario y otras asignaciones del mes × 12,
   * más utilidades (días × salario diario) y bono vacacional (15 días + 1 por año de servicio, hasta 30).
   * El salario diario incluye las otras asignaciones (comisiones), como el salario normal.
   */
  function estimarRemuneracion(p) {
    var sal = Math.max(0, n(p.salarioMensual)), otras = Math.max(0, n(p.otrasPromedio));
    var diario = (sal + otras) / 30, anios = Math.max(0, Math.floor(n(p.aniosServicio)));
    var diasBono = Math.min(30, 15 + Math.max(0, anios - 1)), diasUtil = n(p.diasUtilidades) > 0 ? n(p.diasUtilidades) : 120;
    var partes = { salario: r2(sal * 12), otras: r2(otras * 12), utilidades: r2(diario * diasUtil), bonoVacacional: r2(diario * diasBono) };
    return { partes: partes, diasUtilidades: diasUtil, diasBono: diasBono, total: r2(partes.salario + partes.otras + partes.utilidades + partes.bonoVacacional) };
  }

  var api = { UT_DEFECTO: UT_DEFECTO, DESGRAVAMEN_UNICO: DESGRAVAMEN_UNICO, UMBRAL: UMBRAL, TARIFA: TARIFA, DESGRAVAMENES: DESGRAVAMENES, MESES_VARIACION: MESES_VARIACION,
    impuestoTarifa: impuestoTarifa, calcular: calcular, estimarRemuneracion: estimarRemuneracion, r2: r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Ari = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
