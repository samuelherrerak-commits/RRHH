/* ==========================================================
   Aporte trimestral al fideicomiso: arma la vista previa a partir del Excel (nombre + monto).
   Función pura: recibe empleados, filas, días adicionales forzados y el aporte anterior.
   ========================================================== */
(function (raiz) {
  'use strict';

  function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var Calculo = isNode ? require('./calculo.js') : dependencia(raiz, 'Calculo');
  var Empleados = isNode ? require('./empleados.js') : dependencia(raiz, 'Empleados');

  function trimestreAnterior(anio, trimestre) { return trimestre === 1 ? { anio: anio - 1, trimestre: 4 } : { anio: anio, trimestre: trimestre - 1 }; }
  function fechaTexto(f) { return f ? ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y : ''; }

  /**
   * e: { anio, trimestre, empresa, filas:[{ nombre, monto, clave? }], forzados:{ clave: dias }, empleados (todos),
   *      anterior: [claves del aporte del trimestre anterior] o null si no hay (primer aporte en el sistema), parametros }
   * Devuelve { lineas, sugeridas, sinEmpleado, alertas, retirados, totales, primeraCarga, listo }.
   */
  function prepararAporte(e) {
    var empresaDe = function (x) { return Empleados.empresaFideicomiso(x); };
    var deLaEmpresa = (e.empleados || []).filter(function (x) { return x.cedulaNumero && empresaDe(x) === e.empresa; });
    var porClave = {};
    (e.empleados || []).forEach(function (x) { porClave[Empleados.claveCedula(x)] = x; });

    // 1) Filas ya resueltas a mano (traen clave) y el resto por nombre
    var asignadas = [], porNombre = [], alertas = [];
    (e.filas || []).forEach(function (f, i) {
      var monto = Number(f.monto);
      if (f.clave && porClave[f.clave]) asignadas.push({ fila: i, monto: monto, empleado: porClave[f.clave] });
      else porNombre.push(Object.assign({}, f, { _i: i, monto: monto }));
    });
    var cruce = Empleados.cruzarPorNombre(porNombre, deLaEmpresa);
    var orig = function (j) { return porNombre[j]._i; };
    cruce.exactas.forEach(function (x) { asignadas.push({ fila: orig(x.fila), monto: x.monto, empleado: x.empleado }); });
    var sugeridas = cruce.sugeridas.map(function (x) {
      return { fila: orig(x.fila), nombre: x.nombre, monto: x.monto, candidatos: x.candidatos.map(function (c) { return { clave: Empleados.claveCedula(c.empleado), nombre: c.empleado.nombre, puntaje: Math.round(c.puntaje * 100) }; }) };
    });
    var sinEmpleado = cruce.sinEmpleado.map(function (x) { return { fila: orig(x.fila), nombre: x.nombre, monto: x.monto }; });
    cruce.duplicadas.forEach(function (x) { alertas.push({ tipo: 'DUPLICADA', texto: '«' + x.nombre + '» aparece más de una vez en el Excel: se toma solo la primera fila.' }); });

    // 2) Una línea por empleado (si una misma persona quedó dos veces, se toma la primera)
    var vistos = {}, montos = {};
    asignadas.sort(function (a, b) { return a.fila - b.fila; });
    asignadas = asignadas.filter(function (a) {
      var k = Empleados.claveCedula(a.empleado);
      if (vistos[k]) { alertas.push({ tipo: 'DUPLICADA', texto: a.empleado.nombre + ' tiene más de una fila en el Excel: se toma solo la primera.' }); return false; }
      vistos[k] = true; montos[k] = a.monto; return true;
    });

    // 3) Nuevos ingresos y retirados
    var primeraCarga = !e.anterior;
    var activos = deLaEmpresa.filter(function (x) { return x.estado !== 'Inactivo'; });
    var nyr = Empleados.detectarNuevosYRetirados(activos, e.anterior || [], e.anio, e.trimestre, e.empleados);
    var nuevos = {};
    nyr.nuevos.forEach(function (x) {
      var f = x.fechaIngreso, dentro = f && f.y === e.anio && Calculo.mesesDelTrimestre(e.trimestre).indexOf(f.m) !== -1;
      if (!primeraCarga || dentro) nuevos[Empleados.claveCedula(x)] = true;    // en la primera carga solo cuentan los que ingresaron en el trimestre
    });
    var retirados = primeraCarga ? [] : nyr.retirados.map(function (r) {
      return { clave: r.clave, nombre: r.empleado ? r.empleado.nombre : '', fechaIngreso: r.empleado ? fechaTexto(r.empleado.fechaIngreso) : '' };
    });

    // 4) Cálculo por persona
    var lineas = asignadas.map(function (a) {
      var x = a.empleado, k = Empleados.claveCedula(x), forz = e.forzados && e.forzados[k];
      var c = Calculo.calcularAporte({ monto: a.monto, ingreso: x.fechaIngreso, anio: e.anio, trimestre: e.trimestre, diasAdicionalesForzados: forz }, e.parametros);
      if (c.meses === 0 && x.fechaIngreso) alertas.push({ tipo: 'SIN_MESES', texto: x.nombre + ': ingresó después del trimestre, su aporte da 0.' });
      return {
        clave: k, nombre: x.nombre, fechaIngreso: fechaTexto(x.fechaIngreso), estado: x.estado, nuevo: !!nuevos[k],
        monto: c.monto, meses: c.meses, salarioDiario: Calculo.redondear2(c.salarioDiario), alicUtilidades: Calculo.redondear2(c.alicUtilidades),
        diasVacaciones: c.diasVacaciones, alicVacaciones: Calculo.redondear2(c.alicVacaciones), diasAntiguedad: c.diasAntiguedad,
        diasAdicionales: c.diasAdicionales, adicionalesForzados: c.adicionalesForzados, total: c.total,
      };
    }).sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; });

    // 5) Alertas del paso 3
    Empleados.generarAlertas({ sinEmpleado: [] }, activos, montos, montos).forEach(function (a) {
      var nom = a.nombre || (porClave[a.cedula] ? porClave[a.cedula].nombre : a.cedula);
      if (a.tipo === 'SIN_MONTO') alertas.push({ tipo: a.tipo, texto: nom + ' está activo en ' + e.empresa + ' y no tiene monto en el Excel.' });
      else if (a.tipo === 'SIN_FECHA_INGRESO') alertas.push({ tipo: a.tipo, texto: nom + ' no tiene fecha de ingreso: su aporte da 0.' });
      else if (a.tipo === 'MONTO_NO_POSITIVO') alertas.push({ tipo: a.tipo, texto: nom + ': el monto es cero o negativo.' });
    });
    sinEmpleado.forEach(function (x) { alertas.push({ tipo: 'EXCEL_SIN_EMPLEADO', texto: '«' + x.nombre + '» del Excel no corresponde a ningún empleado de ' + e.empresa + ': no se incluye.' }); });

    var suma = function (ls) { return Calculo.redondear2(ls.reduce(function (t, l) { return t + l.total; }, 0)); };
    var lNuevos = lineas.filter(function (l) { return l.nuevo; });
    return {
      lineas: lineas, sugeridas: sugeridas, sinEmpleado: sinEmpleado, alertas: alertas, retirados: retirados, primeraCarga: primeraCarga,
      totales: { personas: lineas.length, total: suma(lineas), nuevos: lNuevos.length, totalNuevos: suma(lNuevos), retirados: retirados.length },
      listo: sugeridas.length === 0 && lineas.length > 0,
    };
  }

  var api = { trimestreAnterior: trimestreAnterior, prepararAporte: prepararAporte };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Aportes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
