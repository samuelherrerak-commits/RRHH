/* ==========================================================
   Base de empleados y cruce del aporte. Funciones puras.
   ========================================================== */
(function (raiz) {
  'use strict';

  // En Apps Script los archivos se cargan en el orden de la lista; así la dependencia se resuelve al usarla, no al cargar.
  function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }

  var Calculo = (typeof require === 'function' && typeof module !== 'undefined') ? require('./calculo.js') : dependencia(raiz, 'Calculo');

  /** Mayúsculas, sin tildes, sin signos raros y sin espacios dobles. */
  function normalizarNombre(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9Ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  var VALOR_LETRA = { V: 1, E: 2, J: 3, P: 4, G: 5 };

  /** Dígito verificador del RIF venezolano (letra + 8 dígitos). */
  function verificadorRif(letra, ocho) {
    var nums = [VALOR_LETRA[letra] || 1].concat(String(ocho).split('').map(Number));
    var pesos = [4, 3, 2, 7, 6, 5, 4, 3, 2], t = 0;
    for (var i = 0; i < 9; i++) t += nums[i] * pesos[i];
    var r = 11 - (t % 11);
    return r >= 10 ? 0 : r;
  }

  /**
   * Cédula tal como viene en el detalle (RIF: letra + 8 dígitos + verificador) → cédula real.
   * - 9 dígitos: el último es el verificador del RIF y se quita; si no coincide se marca para revisar.
   * - Los ceros a la izquierda se quitan: V09123456 es la cédula 9.123.456 (7 dígitos).
   * - 8 dígitos: cédula completa, salvo que el último dígito sea un verificador válido de una
   *   cédula de 7 dígitos; en ese caso queda dudoso y se marca para revisar.
   */
  function parsearCedula(crudo) {
    var s = String(crudo == null ? '' : crudo).toUpperCase().replace(/[^A-Z0-9]/g, '');
    var m = /^([VEJGP]?)(\d+)$/.exec(s);
    if (!m) return { letra: '', numero: '', revisar: true, motivo: 'Cédula vacía o con formato inesperado' };
    var letra = m[1] || 'V', dig = m[2], sinCeros = function (x) { return x.replace(/^0+/, '') || '0'; };
    if (dig.length === 9) {
      var coincide = verificadorRif(letra, dig.slice(0, 8)) === Number(dig[8]);
      return { letra: letra, numero: sinCeros(dig.slice(0, 8)), revisar: !coincide, motivo: coincide ? '' : 'El dígito verificador del RIF no coincide' };
    }
    if (dig.length === 8) {
      var dudoso = verificadorRif(letra, '0' + dig.slice(0, 7)) === Number(dig[7]);
      return { letra: letra, numero: sinCeros(dig), revisar: dudoso, motivo: dudoso ? '8 dígitos: podría traer verificador' : '' };
    }
    if (dig.length > 9) return { letra: letra, numero: dig, revisar: true, motivo: dig.length + ' dígitos' };
    return { letra: letra, numero: sinCeros(dig), revisar: false, motivo: '' };
  }

  /** 130 | "130" | "1.234,56" | "1234.56" → número; vacío o inválido → null. */
  function numeroDeMonto(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : null;
    var t = String(v == null ? '' : v).trim().replace(/[^\d.,]/g, '');
    if (!t) return null;
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  /** El export trae 'Active'; la hoja usa 'Activo' / 'Inactivo'. */
  function estadoEnEspanol(v) {
    var t = normalizarNombre(v);
    return /^(INACTIV|INACTIVE|RETIRAD|EGRESAD|BAJA)/.test(t) ? 'Inactivo' : 'Activo';
  }

  /**
   * Lo que escribe una persona (con o sin letra, con RIF o sin él, con ceros) → número de cédula limpio.
   * '305803231' (RIF) → '30580323'; '09123456' → '9123456'. Devuelve '' si no parece una cédula.
   */
  function numeroDeCedulaTexto(texto) {
    var d = String(texto == null ? '' : texto).replace(/\D/g, '');
    if (d.length < 5 || d.length > 9) return '';
    if (d.length === 9) d = d.slice(0, 8);
    return d.replace(/^0+/, '');
  }

  /** ¿Asignar `jefeClave` como jefe de `clave` crearía un ciclo (A jefe de B y B jefe de A, o más largo)? */
  function creaCicloDeJefes(empleados, clave, jefeClave) {
    var porClave = {};
    empleados.forEach(function (e) { porClave[claveCedula(e)] = e; });
    var actual = jefeClave, pasos = 0;
    while (actual && pasos++ < 100) {
      if (actual === clave) return true;
      actual = porClave[actual] ? porClave[actual].jefe : '';
    }
    return false;
  }

  /** AUSTRAL IMPORT DE VENEZUELA C.A → AIV; todo lo demás → PCA. */
  function empresaDesdeDetalle(texto) {
    return normalizarNombre(texto).indexOf('AUSTRAL IMPORT DE VENEZUELA') === 0 ? 'AIV' : 'PCA';
  }

  /** La columna editable "Empresa fideicomiso" anula la regla. */
  function empresaFideicomiso(emp) {
    return emp.empresaFideicomiso || emp.empresaDetalle || 'PCA';
  }

  /** Clave de unión: letra + número de cédula. */
  function claveCedula(emp) {
    return emp.cedulaLetra + emp.cedulaNumero;
  }

  /**
   * Fila del "Detalle de Empleado" → empleado.
   * fila: { organizacion, departamento, puesto, cedula, nombre, estado, fechaInicio }
   */
  function empleadoDesdeDetalle(fila) {
    var c = parsearCedula(fila.cedula);
    var f = Calculo.aFecha(fila.fechaInicio);
    return {
      cedulaLetra: c.letra,
      cedulaNumero: c.numero,
      revisarCedula: c.revisar,
      motivoRevision: c.motivo,
      nombre: String(fila.nombre || '').trim(),
      nombreNorm: normalizarNombre(fila.nombre),
      organizacion: String(fila.organizacion || '').trim(),
      departamento: String(fila.departamento || '').trim(),
      puesto: String(fila.puesto || '').trim(),
      estado: estadoEnEspanol(fila.estado),
      fechaIngreso: f,
      empresaDetalle: empresaDesdeDetalle(fila.organizacion),
      salarioMensual: numeroDeMonto(fila.salarioMensual),   // Salario M. del detalle; lo usa la constancia de trabajo
      empresaFideicomiso: '',
      jefe: '',            // clave de cédula del jefe directo (se asigna desde RRHH)
      editados: [],
    };
  }

  var CAMPOS_DETALLE = ['salarioMensual', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'cedulaLetra', 'cedulaNumero', 'revisarCedula', 'motivoRevision'];

  /**
   * Recarga del detalle: actualiza los existentes, agrega los nuevos y
   * conserva las correcciones manuales (campos listados en `editados` y
   * la empresa fideicomiso). Lo que no viene en el detalle pasa a "Inactivo"
   * (el detalle solo trae activos), sin borrarse.
   */
  function fusionarDetalle(existentes, filas) {
    var porClave = {};
    existentes.forEach(function (e) { porClave[claveCedula(e)] = e; });
    var vistos = {}, resumen = { agregados: 0, actualizados: 0, inactivados: 0 };
    var salida = existentes.map(function (e) { return Object.assign({}, e); });
    var idx = {};
    salida.forEach(function (e, i) { idx[claveCedula(e)] = i; });

    filas.forEach(function (fila) {
      var nuevo = empleadoDesdeDetalle(fila), k = claveCedula(nuevo);
      vistos[k] = true;
      if (k in idx) {
        var actual = salida[idx[k]];
        CAMPOS_DETALLE.forEach(function (c) {
          if (actual.editados && actual.editados.indexOf(c) !== -1) return;
          if (c === 'salarioMensual' && nuevo.salarioMensual == null) return;   // el archivo no trae sueldo: se conserva el anterior
          actual[c] = nuevo[c];
        });
        if (actual.estado === 'Inactivo') actual.estado = nuevo.estado;
        resumen.actualizados++;
      } else {
        idx[k] = salida.push(nuevo) - 1;
        resumen.agregados++;
      }
    });

    salida.forEach(function (e) {
      if (!vistos[claveCedula(e)] && e.estado !== 'Inactivo') { e.estado = 'Inactivo'; resumen.inactivados++; }
    });
    return { empleados: salida, resumen: resumen };
  }

  /* ---------- Cruce por nombre ---------- */

  function distancia(a, b) {
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /** 0..1: mezcla de palabras compartidas (sin importar el orden) y distancia de edición. */
  function similitud(a, b) {
    a = normalizarNombre(a); b = normalizarNombre(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    var ta = a.split(' '), tb = b.split(' ');
    var comunes = ta.filter(function (t) { return tb.indexOf(t) !== -1; }).length;
    var dice = (2 * comunes) / (ta.length + tb.length);
    var ed = 1 - distancia(a, b) / Math.max(a.length, b.length);
    var ordenadas = function (t) { return t.slice().sort().join(' '); };
    var edOrd = 1 - distancia(ordenadas(ta), ordenadas(tb)) / Math.max(a.length, b.length);
    return Math.max(ed, edOrd * 0.95, dice * 0.9);
  }

  /**
   * Cruza las filas del Excel (nombre, monto) con los empleados activos.
   * Devuelve { exactas, sugeridas, sinEmpleado, duplicadas }.
   * `sugeridas` lleva hasta 3 candidatos para resolver a mano.
   */
  function cruzarPorNombre(filasExcel, empleados, umbral) {
    umbral = umbral == null ? 0.72 : umbral;
    var porNorm = {};
    empleados.forEach(function (e) { (porNorm[e.nombreNorm] = porNorm[e.nombreNorm] || []).push(e); });
    var r = { exactas: [], sugeridas: [], sinEmpleado: [], duplicadas: [] };
    var usados = {};
    filasExcel.forEach(function (fila, i) {
      var n = normalizarNombre(fila.nombre);
      var hit = porNorm[n];
      if (hit && hit.length === 1) {
        var k = claveCedula(hit[0]);
        if (usados[k] != null) r.duplicadas.push({ fila: i, nombre: fila.nombre, empleado: hit[0] });
        else { usados[k] = i; r.exactas.push({ fila: i, monto: fila.monto, empleado: hit[0] }); }
        return;
      }
      var cand = empleados.map(function (e) { return { empleado: e, puntaje: similitud(n, e.nombreNorm) }; })
        .filter(function (c) { return c.puntaje >= umbral; })
        .sort(function (x, y) { return y.puntaje - x.puntaje; }).slice(0, 3);
      if (cand.length) r.sugeridas.push({ fila: i, nombre: fila.nombre, monto: fila.monto, candidatos: cand });
      else r.sinEmpleado.push({ fila: i, nombre: fila.nombre, monto: fila.monto });
    });
    return r;
  }

  /** Alertas del paso 3 del flujo. `asignados` = claves de cédula con monto. */
  function generarAlertas(cruce, empleadosEmpresa, asignados, montos) {
    var a = [];
    cruce.sinEmpleado.forEach(function (x) { a.push({ tipo: 'EXCEL_SIN_EMPLEADO', nombre: x.nombre }); });
    empleadosEmpresa.forEach(function (e) {
      var k = claveCedula(e);
      if (!(k in asignados)) a.push({ tipo: 'SIN_MONTO', nombre: e.nombre, cedula: k });
      if (!e.fechaIngreso) a.push({ tipo: 'SIN_FECHA_INGRESO', nombre: e.nombre, cedula: k });
    });
    Object.keys(montos).forEach(function (k) {
      if (!(montos[k] > 0)) a.push({ tipo: 'MONTO_NO_POSITIVO', cedula: k, monto: montos[k] });
    });
    return a;
  }

  /**
   * Nuevos ingresos: activos de la empresa que no estaban en el aporte
   * anterior, o cuya fecha de ingreso cae dentro del trimestre.
   * Retirados: estaban en el aporte anterior y ya no están activos.
   * `anterior` = claves de cédula del aporte previo (de la misma empresa).
   */
  function detectarNuevosYRetirados(empleadosEmpresa, anterior, anio, trimestre, todosEmpleados) {
    var meses = Calculo.mesesDelTrimestre(trimestre);
    var enAnterior = {};
    anterior.forEach(function (k) { enAnterior[k] = true; });
    var nuevos = empleadosEmpresa.filter(function (e) {
      if (e.estado === 'Inactivo') return false;
      var f = e.fechaIngreso;
      var dentro = f && f.y === anio && meses.indexOf(f.m) !== -1;
      return dentro || !enAnterior[claveCedula(e)];
    });
    var activos = {};
    empleadosEmpresa.forEach(function (e) { if (e.estado !== 'Inactivo') activos[claveCedula(e)] = true; });
    var porClave = {};
    (todosEmpleados || []).forEach(function (e) { porClave[claveCedula(e)] = e; });
    var retirados = anterior.filter(function (k) { return !activos[k]; })
      .map(function (k) { return { clave: k, empleado: porClave[k] || null }; });
    return { nuevos: nuevos, retirados: retirados };
  }

  /* ---------- Excel "Detalle de Empleado" ---------- */

  var COLUMNAS_DETALLE = {
    cedula: ['CEDULA', 'CI', 'DOCUMENTO'],
    nombre: ['NOMBRE', 'NOMBRE SOCIO DEL NEGOCIO', 'NOMBRES Y APELLIDOS', 'EMPLEADO'],
    organizacion: ['ORGANIZACION', 'EMPRESA'],
    departamento: ['DEPARTAMENTO'],
    puesto: ['PUESTO', 'PUESTO NOMINA', 'CARGO'],
    estado: ['ESTADO', 'STATUS'],
    salarioMensual: ['SALARIO M', 'SALARIO MENSUAL', 'SUELDO MENSUAL', 'SALARIO'],
    fechaInicio: ['FECHA INICIO', 'FECHA DE INICIO', 'FECHA INGRESO', 'FECHA DE INGRESO', 'INGRESO'],
  };

  /** Convierte un serial de Excel (p. ej. 45356) o texto en "dd/mm/aaaa". */
  function fechaDeExcel(v) {
    if (v == null || v === '') return '';
    var t = String(v).trim();
    if (/^\d{4,6}(\.\d+)?$/.test(t)) {   // algunos Excel traen hora: 45721.5
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
      return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear();
    }
    return t;
  }

  /**
   * Filas del Excel (objetos con los encabezados tal cual vienen) → filas del detalle.
   * Reconoce los encabezados sin importar tildes, mayúsculas ni espacios. Devuelve
   * { filas, faltantes: [columnas no encontradas], omitidas: n filas sin cédula ni nombre }.
   */
  function mapearDetalle(filasCrudas) {
    var encabezados = filasCrudas.length ? Object.keys(filasCrudas[0]) : [];
    var indice = {};
    encabezados.forEach(function (h) { indice[normalizarNombre(h)] = h; });
    var col = {}, faltantes = [];
    Object.keys(COLUMNAS_DETALLE).forEach(function (campo) {
      var hit = COLUMNAS_DETALLE[campo].filter(function (n) { return indice[n]; })[0];
      if (hit) col[campo] = indice[hit]; else faltantes.push(campo);
    });
    var omitidas = 0, filas = [];
    filasCrudas.forEach(function (f) {
      var cedula = col.cedula ? String(f[col.cedula] == null ? '' : f[col.cedula]).trim() : '';
      var nombre = col.nombre ? String(f[col.nombre] == null ? '' : f[col.nombre]).trim() : '';
      if (!cedula && !nombre) { omitidas++; return; }
      var o = { cedula: cedula, nombre: nombre };
      ['organizacion', 'departamento', 'puesto', 'estado'].forEach(function (k) { o[k] = col[k] ? f[col[k]] : ''; });
      o.salarioMensual = col.salarioMensual ? f[col.salarioMensual] : '';
      o.fechaInicio = col.fechaInicio ? fechaDeExcel(f[col.fechaInicio]) : '';
      filas.push(o);
    });
    return { filas: filas, faltantes: faltantes, omitidas: omitidas };
  }

  var api = {
    mapearDetalle: mapearDetalle, fechaDeExcel: fechaDeExcel,
    numeroDeMonto: numeroDeMonto, numeroDeCedulaTexto: numeroDeCedulaTexto, creaCicloDeJefes: creaCicloDeJefes,
    normalizarNombre: normalizarNombre, parsearCedula: parsearCedula, verificadorRif: verificadorRif, estadoEnEspanol: estadoEnEspanol,
    empresaDesdeDetalle: empresaDesdeDetalle, empresaFideicomiso: empresaFideicomiso,
    claveCedula: claveCedula, empleadoDesdeDetalle: empleadoDesdeDetalle,
    fusionarDetalle: fusionarDetalle, similitud: similitud, cruzarPorNombre: cruzarPorNombre,
    generarAlertas: generarAlertas, detectarNuevosYRetirados: detectarNuevosYRetirados,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Empleados = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
