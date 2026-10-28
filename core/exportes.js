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

  function aCsv(filas) {
    return filas.map(function (f) {
      return f.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
  }

  var api = { ENCABEZADO: ENCABEZADO, filasNomina: filasNomina, aCsv: aCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Exportes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
