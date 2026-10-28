/* ==========================================================
   Archivos para el banco. Funciones puras.
   Diseño NOMINA APORTES: FIDEICOMISO | Cedula (letra) | (número)
   | TIPO T | FORMA | MONTO | NS (nombre).
   Aportes: TIPO T = 1. Anticipos: TIPO T = 5.
   ========================================================== */
(function (raiz) {
  'use strict';

  var ENCABEZADO = ['FIDEICOMISO', 'Cedula', '', 'TIPO T', 'FORMA', 'MONTO', 'NS'];

  /**
   * items: [{ cedulaLetra, cedulaNumero, nombre, monto }]
   * config: { fideicomiso, tipoT, forma }  (por empresa y tipo de archivo)
   */
  function filasNomina(items, config) {
    var filas = items.map(function (x) {
      return [config.fideicomiso, x.cedulaLetra, x.cedulaNumero, config.tipoT, config.forma, x.monto, x.nombre];
    });
    return [ENCABEZADO].concat(filas);
  }

  /** opciones.decimales = { indiceColumna: n } fuerza n decimales en esa columna (no en el encabezado). */
  function aCsv(filas, opciones) {
    var dec = (opciones && opciones.decimales) || {};
    return filas.map(function (f, i) {
      return f.map(function (c, j) {
        var s = String(c == null ? '' : c);
        if (i > 0 && dec[j] != null && typeof c === 'number') s = c.toFixed(dec[j]);
        return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
  }

  var api = { ENCABEZADO: ENCABEZADO, filasNomina: filasNomina, aCsv: aCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Exportes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
