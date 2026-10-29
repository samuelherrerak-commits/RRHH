/* ============================================================
 * RRHH Prosein / Austral · API de Apps Script (ARCHIVO GENERADO)
 * No lo edites aquí: cambia los archivos de core/ o apps-script/Code.gs
 * y ejecuta `npm run build:gas`.
 *
 * Cómo usarlo: en Apps Script borra todos los archivos del proyecto,
 * deja uno solo y pega TODO este contenido.
 * ============================================================ */
// ===== core/calculo.js =====
var Calculo = (function () {
  var module = { exports: {} }, exports = module.exports;
  var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './servicio.js': Servicio })[ruta]; };
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
  return module.exports;
})();

// ===== core/empleados.js =====
var Empleados = (function () {
  var module = { exports: {} }, exports = module.exports;
  var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './servicio.js': Servicio })[ruta]; };
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
  return module.exports;
})();

// ===== core/prestaciones.js =====
var Prestaciones = (function () {
  var module = { exports: {} }, exports = module.exports;
  var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './servicio.js': Servicio })[ruta]; };
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
  return module.exports;
})();

// ===== core/exportes.js =====
var Exportes = (function () {
  var module = { exports: {} }, exports = module.exports;
  var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './servicio.js': Servicio })[ruta]; };
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
  return module.exports;
})();

// ===== core/constancia.js =====
var Constancia = (function () {
  var module = { exports: {} }, exports = module.exports;
  var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './servicio.js': Servicio })[ruta]; };
  /* ==========================================================
     Constancia de trabajo: textos, monto en letras y vigencia.
     Funciones puras; las usan el servidor, el navegador (PDF) y las pruebas.
     Las fechas de emisión se calculan en hora de Caracas (UTC-4, sin horario de verano).
     ========================================================== */
  (function (raiz) {
    'use strict';
  
    var VIGENCIA_MESES = 3;
    var OFFSET_CARACAS_MS = -4 * 3600 * 1000;
    var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  
    var UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
      'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    var DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    var CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  
    /** 0..999 en letras (sin apócope: «uno», «veintiuno»). */
    function menorAMil(n) {
      if (n === 100) return 'cien';
      var c = Math.floor(n / 100), r = n % 100, partes = [];
      if (c) partes.push(CENTENAS[c]);
      if (r) {
        if (r < 30) partes.push(UNIDADES[r]);
        else partes.push(DECENAS[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNIDADES[r % 10] : ''));
      }
      return partes.join(' ');
    }
  
    /** Entero 0..999 999 999 999 en letras. «un» antes de mil y millón: «veintiún mil», «un millón». */
    function enteroEnLetras(n) {
      if (n === 0) return 'cero';
      var mm = Math.floor(n / 1e9), m = Math.floor((n % 1e9) / 1e6), k = Math.floor((n % 1e6) / 1e3), u = n % 1e3, partes = [];
      var apocope = function (txt) { return txt.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un'); };
      if (mm) partes.push(mm === 1 ? 'mil' : apocope(menorAMil(mm)) + ' mil', m ? '' : 'millones');
      if (m) partes.push(m === 1 ? 'un millón' : apocope(menorAMil(m)) + ' millones');
      if (k) partes.push(k === 1 ? 'mil' : apocope(menorAMil(k)) + ' mil');
      if (u) partes.push(menorAMil(u));
      // «mil millones» cuando hay miles de millones exactos; se limpia lo vacío
      return partes.filter(Boolean).join(' ').replace('mil millones millones', 'mil millones').replace(/\s+/g, ' ').trim();
    }
  
    function redondear2(n) { return Math.round((Math.abs(n) + 1e-9) * 100) / 100 * (n < 0 ? -1 : 1); }
  
    /** 5500 → «Cinco mil quinientos bolívares con 00/100 Céntimos» */
    function montoEnLetras(monto) {
      var m = redondear2(Number(monto));
      if (!isFinite(m) || m < 0 || m >= 1e12) throw new Error('Monto fuera de rango');
      var ent = Math.floor(m + 1e-9), cent = Math.round((m - ent) * 100);
      var texto = ent === 1 ? 'un' : enteroEnLetras(ent);
      var unidad = ent === 1 ? 'bolívar' : (ent >= 1e6 && ent % 1e6 === 0 ? 'de bolívares' : 'bolívares');
      var cc = (cent < 10 ? '0' : '') + cent;
      var frase = texto + ' ' + unidad + ' con ' + cc + '/100 Céntimos';
      return frase.charAt(0).toUpperCase() + frase.slice(1);
    }
  
    /** 5500 → «5.500,00» */
    function formatoMonto(monto) {
      var m = redondear2(Number(monto)).toFixed(2).split('.');
      return m[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + m[1];
    }
  
    /** ms → { y, m, d, dia } en hora de Caracas. */
    function fechaCaracas(ms) {
      var d = new Date(ms + OFFSET_CARACAS_MS);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dia: d.getUTCDay() };
    }
  
    function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  
    /** Suma meses a una fecha {y,m,d}; si el día no existe en el mes destino queda en su último día. */
    function sumarMeses(f, meses) {
      var idx = f.y * 12 + (f.m - 1) + meses, y = Math.floor(idx / 12), m = idx % 12 + 1;
      return { y: y, m: m, d: Math.min(f.d, diasDelMes(y, m)) };
    }
  
    /** Fin del día {y,m,d} en Caracas, como ms. */
    function finDelDia(f) {
      return Date.UTC(f.y, f.m - 1, f.d, 23, 59, 59) - OFFSET_CARACAS_MS;
    }
  
    /** Vencimiento: 3 meses después de la emisión, hasta el final de ese día. */
    function vencimiento(emisionMs) {
      return finDelDia(sumarMeses(fechaCaracas(emisionMs), VIGENCIA_MESES));
    }
  
    /** 'VIGENTE' | 'VENCIDA' | 'ANULADA' */
    function estadoConstancia(c, ahoraMs) {
      if (c.estado === 'ANULADA') return 'ANULADA';
      return ahoraMs > c.vence ? 'VENCIDA' : 'VIGENTE';
    }
  
    /** 29 de octubre de 2026 */
    function fechaLarga(f) { return f.d + ' de ' + MESES[f.m - 1] + ' de ' + f.y; }
  
    /** jueves, 29 de octubre de 2026 */
    function fechaLargaConDia(f) { return DIAS[f.dia] + ', ' + fechaLarga(f); }
  
    /** {y,m,d} → 29/10/2026 */
    function fechaCorta(f) { return ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y; }
  
    var NOMBRES_EMPRESA = { PCA: 'PROSEIN CENTRAL', AIV: 'AUSTRAL IMPORT DE VENEZUELA C.A' };
  
    var api = {
      VIGENCIA_MESES: VIGENCIA_MESES, NOMBRES_EMPRESA: NOMBRES_EMPRESA,
      enteroEnLetras: enteroEnLetras, montoEnLetras: montoEnLetras, formatoMonto: formatoMonto,
      fechaCaracas: fechaCaracas, sumarMeses: sumarMeses, vencimiento: vencimiento, estadoConstancia: estadoConstancia,
      fechaLarga: fechaLarga, fechaLargaConDia: fechaLargaConDia, fechaCorta: fechaCorta,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.Constancia = api;
  })(typeof globalThis !== 'undefined' ? globalThis : this);
  return module.exports;
})();

// ===== core/servicio.js =====
var Servicio = (function () {
  var module = { exports: {} }, exports = module.exports;
  var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './servicio.js': Servicio })[ruta]; };
  /* ==========================================================
     Casos de uso del módulo de prestaciones. No sabe de Sheets:
     recibe un `repo` (hojas en producción, memoria en pruebas) y
     un `ctx` { ahora(), firmar(texto), hash(clave, sal) }.
     Cada función devuelve { ok:true, data } o { ok:false, code, message }.
     ========================================================== */
  (function (raiz) {
    'use strict';
  
    // En Apps Script los archivos se cargan en el orden de la lista; así la dependencia se resuelve al usarla, no al cargar.
    function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }
  
    var isNode = typeof require === 'function' && typeof module !== 'undefined';
    var Calculo = isNode ? require('./calculo.js') : dependencia(raiz, 'Calculo');
    var Empleados = isNode ? require('./empleados.js') : dependencia(raiz, 'Empleados');
    var Prestaciones = isNode ? require('./prestaciones.js') : dependencia(raiz, 'Prestaciones');
    var Exportes = isNode ? require('./exportes.js') : dependencia(raiz, 'Exportes');
    var Constancia = isNode ? require('./constancia.js') : dependencia(raiz, 'Constancia');
  
    var HORAS_SESION = 8;
    var MAX_FALLOS_CEDULA = 5;
    var MAX_FALLOS_GLOBAL = 60;
  
    function ok(data) { return { ok: true, data: data }; }
    function err(code, message) { return { ok: false, code: code, message: message }; }
  
    /* ---------- Sesiones firmadas ---------- */
  
    function crearToken(ctx, clave, rol) {
      var carga = JSON.stringify({ c: clave, r: rol, e: ctx.ahora() + HORAS_SESION * 3600 * 1000 });
      var b = ctx.base64(carga);
      return b + '.' + ctx.firmar(b);
    }
  
    function leerToken(ctx, token, roles) {
      var partes = String(token || '').split('.');
      if (partes.length !== 2 || ctx.firmar(partes[0]) !== partes[1]) return null;
      var s;
      try { s = JSON.parse(ctx.desbase64(partes[0])); } catch (e) { return null; }
      if (!s || s.e < ctx.ahora() || (roles && roles.indexOf(s.r) === -1)) return null;
      return { clave: s.c, rol: s.r };
    }
  
    /* ---------- Acceso ---------- */
  
    /**
     * Primer paso de la entrada: la cédula. Si esa cédula tiene usuario de RRHH/administrador
     * no se entrega sesión: se pide la clave (iniciarSesionAdmin). Si no, entra como trabajador.
     * Acepta con o sin letra, con RIF o sin él, y con o sin ceros a la izquierda.
     */
    function iniciarSesion(repo, ctx, cedulaTexto) {
      var digitos = Empleados.numeroDeCedulaTexto(cedulaTexto);
      if (!digitos) return err('CEDULA', 'Escribe tu cédula, solo números.');
      if (repo.fallos('global') >= MAX_FALLOS_GLOBAL || repo.fallos(digitos) >= MAX_FALLOS_CEDULA) {
        return err('BLOQUEADO', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.');
      }
      if (repo.usuario(digitos)) return ok({ requiereClave: true });
      var emp = repo.empleadoPorClave('V' + digitos) || repo.empleadoPorClave('E' + digitos);
      if (!emp || emp.estado === 'Inactivo') {
        repo.registrarFallo(digitos); repo.registrarFallo('global');
        return err('NO_ENCONTRADO', 'No encontramos esa cédula. Revisa el número o consulta con Recursos Humanos.');
      }
      var clave = Empleados.claveCedula(emp);
      repo.log('LOGIN', clave, 'Entrada de trabajador');
      return ok({ token: crearToken(ctx, clave, 'TRABAJADOR'), nombre: emp.nombre, empresa: Empleados.empresaFideicomiso(emp) });
    }
  
    /**
     * RRHH / administrador: cédula y clave (huella con sal en USUARIOS). Si además es empleado activo
     * recibe un segundo token de trabajador para ver su propio estado de cuenta.
     */
    function iniciarSesionAdmin(repo, ctx, cedulaTexto, claveTexto) {
      var digitos = Empleados.numeroDeCedulaTexto(cedulaTexto);
      if (!digitos) return err('CEDULA', 'Escribe tu cédula, solo números.');
      if (repo.fallos('admin:' + digitos) >= MAX_FALLOS_CEDULA) return err('BLOQUEADO', 'Demasiados intentos. Espera unos minutos.');
      var u = repo.usuario(digitos);
      if (u && !u.hash) return err('SIN_CLAVE', 'Tu usuario aún no tiene clave. Pídele a un administrador que la cree desde la hoja de Google (menú RRHH).');
      if (!u || ctx.hash(String(claveTexto || ''), u.sal) !== u.hash) {
        repo.registrarFallo('admin:' + digitos);
        return err('CREDENCIALES', 'Clave incorrecta.');
      }
      var emp = repo.empleadoPorClave('V' + digitos) || repo.empleadoPorClave('E' + digitos);
      repo.log('LOGIN_ADMIN', digitos, 'Entrada ' + u.rol);
      var data = { token: crearToken(ctx, digitos, u.rol), rol: u.rol, nombre: emp ? emp.nombre : '' };
      if (emp && emp.estado !== 'Inactivo') data.tokenTrabajador = crearToken(ctx, Empleados.claveCedula(emp), 'TRABAJADOR');
      return ok(data);
    }
  
    /* ---------- Trabajador ---------- */
  
    function miEstadoDeCuenta(repo, ctx, token) {
      var s = leerToken(ctx, token, ['TRABAJADOR']);
      if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
      var p = repo.parametros();
      var resumen = Prestaciones.resumenTrabajador(repo.aportesDe(s.clave), repo.anticiposDe(s.clave), parametrosPrestaciones(p));
      return ok({ resumen: resumen, anticipos: repo.anticiposDe(s.clave).map(vistaAnticipo) });
    }
  
    function solicitarAnticipo(repo, ctx, token, datos) {
      var s = leerToken(ctx, token, ['TRABAJADOR']);
      if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
      var emp = repo.empleadoPorClave(s.clave);
      var resumen = Prestaciones.resumenTrabajador(repo.aportesDe(s.clave), repo.anticiposDe(s.clave), parametrosPrestaciones(repo.parametros()));
      var sol = { monto: Calculo.redondear2(Number(datos && datos.monto)), motivo: datos && datos.motivo, detalle: datos && datos.detalle };
      var v = Prestaciones.validarSolicitudAnticipo(sol, resumen, emp, parametrosPrestaciones(repo.parametros()));
      if (!v.ok) return err('VALIDACION', v.errores.join(' '));
      var a = {
        id: repo.nuevoId(), clave: s.clave, monto: sol.monto, motivo: sol.motivo, detalle: String(sol.detalle || '').trim(),
        estado: 'PENDIENTE', creada: ctx.ahora(), decididaPor: '', motivoRechazo: '',
      };
      repo.guardarAnticipo(a);
      repo.log('ANTICIPO_SOLICITADO', s.clave, a.id + ' · ' + a.monto);
      return ok(vistaAnticipo(a));
    }
  
    function cancelarAnticipo(repo, ctx, token, id) {
      var s = leerToken(ctx, token, ['TRABAJADOR']);
      if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
      var a = repo.anticipoPorId(id);
      if (!a || a.clave !== s.clave) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
      return cambiarEstado(repo, ctx, a, 'CANCELADA', s.clave, {});
    }
  
    /* ---------- RRHH ---------- */
  
    function bandejaAnticipos(repo, ctx, token, estado) {
      if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
      return ok(repo.anticiposPorEstado(estado || 'PENDIENTE').map(function (a) {
        var e = repo.empleadoPorClave(a.clave) || {};
        return Object.assign(vistaAnticipo(a), { clave: a.clave, nombre: e.nombre || '', empresa: e.nombre ? Empleados.empresaFideicomiso(e) : '' });
      }));
    }
  
    function decidirAnticipo(repo, ctx, token, id, aprobar, motivoRechazo) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      var a = repo.anticipoPorId(id);
      if (!a) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
      if (!aprobar && !String(motivoRechazo || '').trim()) return err('VALIDACION', 'Indica el motivo del rechazo.');
      return cambiarEstado(repo, ctx, a, aprobar ? 'APROBADA' : 'RECHAZADA', s.clave, { motivoRechazo: aprobar ? '' : String(motivoRechazo).trim() });
    }
  
    /**
     * Genera el archivo de anticipos de una empresa con las APROBADAS y las pasa
     * a EN_ARCHIVO. Mismo diseño que NOMINA APORTES con TIPO T = 5.
     */
    function generarArchivoAnticipos(repo, ctx, token, empresa) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      var cfg = repo.empresaConfig(empresa);
      if (!cfg) return err('VALIDACION', 'Empresa desconocida.');
      var pendientes = repo.anticiposPorEstado('APROBADA').filter(function (a) {
        var e = repo.empleadoPorClave(a.clave);
        return e && Empleados.empresaFideicomiso(e) === empresa;
      });
      if (!pendientes.length) return err('VACIO', 'No hay anticipos aprobados para ' + empresa + '.');
      var items = pendientes.map(function (a) {
        var e = repo.empleadoPorClave(a.clave);
        return { cedulaLetra: e.cedulaLetra, cedulaNumero: e.cedulaNumero, nombre: e.nombre, monto: a.monto };
      });
      var filas = Exportes.filasNomina(items, { fideicomiso: cfg.fideicomiso, tipoT: cfg.tipoTAnticipo, forma: cfg.forma });
      pendientes.forEach(function (a) { cambiarEstado(repo, ctx, a, 'EN_ARCHIVO', s.clave, {}); });
      repo.log('ARCHIVO_ANTICIPOS', s.clave, empresa + ' · ' + pendientes.length + ' anticipos');
      return ok({ filas: filas, csv: Exportes.aCsv(filas, { decimales: { 5: 2 } }), cantidad: pendientes.length });
    }
  
    function marcarAnticiposPagados(repo, ctx, token, ids) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      var cambiados = 0;
      for (var i = 0; i < ids.length; i++) {
        var a = repo.anticipoPorId(ids[i]);
        if (a && Prestaciones.puedePasar(Prestaciones.SIGUIENTE_SOLICITUD, a.estado, 'PAGADA')) {
          cambiarEstado(repo, ctx, a, 'PAGADA', s.clave, {}); cambiados++;
        }
      }
      return ok({ cambiados: cambiados });
    }
  
    /** Cierre del trimestre: CERRADO → ACREDITADO (el trabajador lo ve desde ahí). */
    function cambiarEstadoCierre(repo, ctx, token, anio, trimestre, empresa, nuevo) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      var c = repo.cierre(anio, trimestre, empresa);
      if (!c) return err('NO_ENCONTRADO', 'Ese trimestre no tiene aporte cerrado.');
      if (!Prestaciones.puedePasar(Prestaciones.SIGUIENTE_CIERRE, c.estado, nuevo)) {
        return err('TRANSICION', 'No se puede pasar de ' + c.estado + ' a ' + nuevo + '.');
      }
      c.estado = nuevo; c.actualizado = ctx.ahora(); c.por = s.clave;
      repo.guardarCierre(c);
      repo.log('CIERRE_' + nuevo, s.clave, anio + ' T' + trimestre + ' ' + empresa);
      return ok(c);
    }
  
    /* ---------- Constancia de trabajo ---------- */
  
    var MAX_CONSTANCIAS_MES = 5;
    var MAX_FALLOS_VERIFICAR = 40;
  
    function firmante(p) {
      return {
        nombre: String(p.firmaNombre || 'Lic. Luis Paul Rojas'),
        cargo: String(p.firmaCargo || 'Gerente de Gestión Humana'),
        telefono: String(p.firmaTelefono || '(0412) 205.11.60.'),
        ciudad: String(p.ciudad || 'Caracas'),
      };
    }
  
    /** Vista de una constancia: datos guardados + estado calculado hoy. */
    function vistaConstancia(c, ahora, p) {
      return {
        id: c.id, nombre: c.nombre, cedula: c.cedula, empresa: c.empresa, empresaNombre: Constancia.NOMBRES_EMPRESA[c.empresa] || c.empresa,
        cargo: c.cargo, organizacion: c.organizacion, fechaIngreso: c.fechaIngreso, salario: c.salario,
        emision: c.emision, vence: c.vence, estado: Constancia.estadoConstancia(c, ahora),
        firmante: p ? firmante(p) : undefined,
      };
    }
  
    /**
     * El trabajador pide su constancia: se guarda una copia fija de sus datos de hoy (cargo, ingreso, sueldo),
     * con vigencia de 3 meses y un código único para el QR. Sale sola, sin aprobación.
     */
    function emitirConstancia(repo, ctx, token) {
      var s = leerToken(ctx, token, ['TRABAJADOR']);
      if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
      var emp = repo.empleadoPorClave(s.clave);
      if (!emp || emp.estado === 'Inactivo') return err('VALIDACION', 'No encontramos tus datos activos. Consulta con Recursos Humanos.');
      if (!emp.fechaIngreso) return err('VALIDACION', 'Falta tu fecha de ingreso. Consulta con Recursos Humanos.');
      if (!(emp.salarioMensual > 0)) return err('VALIDACION', 'Falta tu salario en el sistema. Consulta con Recursos Humanos.');
      var p = repo.parametros(), ahora = ctx.ahora();
      var max = Number(p.constanciasMaxPorMes) > 0 ? Number(p.constanciasMaxPorMes) : MAX_CONSTANCIAS_MES;
      var recientes = repo.constanciasDe(s.clave).filter(function (c) { return c.emision > ahora - 30 * 86400000; });
      if (recientes.length >= max) return err('LIMITE', 'Ya generaste ' + max + ' constancias este mes. Si necesitas otra, consulta con Recursos Humanos.');
      var c = {
        id: repo.nuevoIdConstancia(), clave: s.clave, nombre: emp.nombre, cedula: emp.cedulaLetra + '-' + emp.cedulaNumero,
        empresa: Empleados.empresaFideicomiso(emp), cargo: emp.puesto, organizacion: emp.organizacion,
        fechaIngreso: Constancia.fechaCorta(emp.fechaIngreso), salario: Calculo.redondear2(emp.salarioMensual),
        emision: ahora, vence: Constancia.vencimiento(ahora), estado: 'VIGENTE', emitidaPor: s.clave,
      };
      repo.guardarConstancia(c);
      repo.log('CONSTANCIA_EMITIDA', s.clave, c.id);
      return ok(vistaConstancia(c, ahora, p));
    }
  
    function misConstancias(repo, ctx, token) {
      var s = leerToken(ctx, token, ['TRABAJADOR']);
      if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
      var p = repo.parametros(), ahora = ctx.ahora();
      return ok(repo.constanciasDe(s.clave).sort(function (a, b) { return b.emision - a.emision; })
        .slice(0, 20).map(function (c) { return vistaConstancia(c, ahora, p); }));
    }
  
    /**
     * Público (lo abre el QR): confirma si la constancia existe y está vigente.
     * El código es largo y aleatorio; las consultas con códigos inexistentes se limitan.
     */
    function verificarConstancia(repo, ctx, id) {
      id = String(id || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{10,40}$/.test(id)) return err('NO_ENCONTRADO', 'Código de constancia no válido.');
      if (repo.fallos('verificar') >= MAX_FALLOS_VERIFICAR) return err('BLOQUEADO', 'Demasiadas consultas. Intenta de nuevo en unos minutos.');
      var c = repo.constanciaPorId(id);
      if (!c) { repo.registrarFallo('verificar'); return err('NO_ENCONTRADO', 'No existe ninguna constancia con ese código.'); }
      return ok(vistaConstancia(c, ctx.ahora()));
    }
  
    function listarConstancias(repo, ctx, token) {
      if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
      var ahora = ctx.ahora();
      return ok(repo.todasConstancias().sort(function (a, b) { return b.emision - a.emision; })
        .slice(0, 100).map(function (c) { return vistaConstancia(c, ahora); }));
    }
  
    function anularConstancia(repo, ctx, token, id) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      var c = repo.constanciaPorId(String(id || '').toUpperCase());
      if (!c) return err('NO_ENCONTRADO', 'No encontramos esa constancia.');
      c.estado = 'ANULADA';
      repo.guardarConstancia(c);
      repo.log('CONSTANCIA_ANULADA', s.clave, c.id);
      return ok(vistaConstancia(c, ctx.ahora()));
    }
  
    /* ---------- Base de empleados (RRHH) ---------- */
  
    /**
     * Recarga del "Detalle de Empleado": actualiza, agrega y conserva las correcciones
     * manuales. filas = salida de Empleados.mapearDetalle().filas
     */
    function cargarEmpleados(repo, ctx, token, filas) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      if (!Array.isArray(filas) || !filas.length) return err('VALIDACION', 'El archivo no trae empleados.');
      if (filas.length > 5000) return err('VALIDACION', 'El archivo trae demasiadas filas.');
      var r = Empleados.fusionarDetalle(repo.todosEmpleados(), filas);
      repo.guardarEmpleados(r.empleados);
      var revisar = r.empleados.filter(function (e) { return e.revisarCedula && e.estado !== 'Inactivo'; })
        .map(function (e) { return { clave: Empleados.claveCedula(e), nombre: e.nombre, motivo: e.motivoRevision }; });
      var sinFecha = r.empleados.filter(function (e) { return !e.fechaIngreso && e.estado !== 'Inactivo'; }).length;
      repo.log('EMPLEADOS_CARGADOS', s.clave, JSON.stringify(r.resumen));
      return ok({ resumen: r.resumen, total: r.empleados.length, revisar: revisar, sinFecha: sinFecha });
    }
  
    /** opciones: { buscar, departamento, sinJefe } */
    function listarEmpleados(repo, ctx, token, opciones) {
      if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
      if (typeof opciones === 'string') opciones = { buscar: opciones };
      opciones = opciones || {};
      var q = Empleados.normalizarNombre(opciones.buscar || '');
      var todos = repo.todosEmpleados(), porClave = {};
      todos.forEach(function (e) { porClave[Empleados.claveCedula(e)] = e; });
      var departamentos = {};
      todos.forEach(function (e) { if (e.estado !== 'Inactivo' && e.departamento) departamentos[e.departamento] = true; });
      var lista = todos.filter(function (e) {
        if (opciones.departamento && e.departamento !== opciones.departamento) return false;
        if (opciones.sinJefe && (e.jefe || e.estado === 'Inactivo')) return false;
        return !q || e.nombreNorm.indexOf(q) !== -1 || Empleados.claveCedula(e).indexOf(q.replace(/\s/g, '')) !== -1;
      });
      return ok({
        total: lista.length,
        departamentos: Object.keys(departamentos).sort(),
        empleados: lista.slice(0, 100).map(function (e) {
          var j = e.jefe ? porClave[e.jefe] : null;
          return {
            clave: Empleados.claveCedula(e), nombre: e.nombre, puesto: e.puesto, departamento: e.departamento, estado: e.estado,
            empresaDetalle: e.empresaDetalle, empresaFideicomiso: e.empresaFideicomiso, empresa: Empleados.empresaFideicomiso(e),
            revisarCedula: !!e.revisarCedula, fechaIngreso: e.fechaIngreso ? e.fechaIngreso.d + '/' + e.fechaIngreso.m + '/' + e.fechaIngreso.y : '',
            jefe: e.jefe || '', jefeNombre: j ? j.nombre : '',
          };
        }),
      });
    }
  
    /** Asigna (o quita, con '') el jefe directo de uno o varios empleados. */
    function asignarJefe(repo, ctx, token, claves, jefeClave) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      claves = [].concat(claves || []);
      if (!claves.length) return err('VALIDACION', 'Elige a quién asignar el jefe.');
      var lista = repo.todosEmpleados(), por = {};
      lista.forEach(function (e) { por[Empleados.claveCedula(e)] = e; });
      if (jefeClave) {
        var j = por[jefeClave];
        if (!j || j.estado === 'Inactivo') return err('VALIDACION', 'El jefe debe ser un empleado activo.');
      }
      var cambiados = 0, omitidos = [];
      claves.forEach(function (c) {
        var e = por[c];
        if (!e) { omitidos.push(c); return; }
        if (jefeClave && (jefeClave === c || Empleados.creaCicloDeJefes(lista, c, jefeClave))) { omitidos.push(e.nombre + ' (sería su propio jefe)'); return; }
        if ((e.jefe || '') !== (jefeClave || '')) { e.jefe = jefeClave || ''; cambiados++; }
      });
      if (cambiados) repo.guardarEmpleados(lista);
      repo.log('JEFE_ASIGNADO', s.clave, (jefeClave || 'sin jefe') + ' ← ' + claves.length + ' empleados');
      return ok({ cambiados: cambiados, omitidos: omitidos });
    }
  
    /** Asigna el mismo jefe a todos los activos de un departamento (sin tocar al propio jefe). */
    function asignarJefeDepartamento(repo, ctx, token, departamento, jefeClave) {
      if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
      var claves = repo.todosEmpleados().filter(function (e) {
        return e.departamento === departamento && e.estado !== 'Inactivo' && Empleados.claveCedula(e) !== jefeClave;
      }).map(Empleados.claveCedula);
      if (!claves.length) return err('VALIDACION', 'Ese departamento no tiene empleados activos.');
      return asignarJefe(repo, ctx, token, claves, jefeClave);
    }
  
    /** Empresa del fideicomiso editable por empleado ('' vuelve a la regla automática). */
    function fijarEmpresaFideicomiso(repo, ctx, token, clave, empresa) {
      var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
      if (!s) return err('SESION', 'No autorizado.');
      if (['', 'AIV', 'PCA'].indexOf(empresa) === -1) return err('VALIDACION', 'Empresa no válida.');
      var lista = repo.todosEmpleados();
      var e = lista.filter(function (x) { return Empleados.claveCedula(x) === clave; })[0];
      if (!e) return err('NO_ENCONTRADO', 'No encontramos ese empleado.');
      e.empresaFideicomiso = empresa;
      repo.guardarEmpleados(lista);
      repo.log('EMPRESA_FIDEICOMISO', s.clave, clave + ' → ' + (empresa || 'automática'));
      return ok({ clave: clave, empresa: Empleados.empresaFideicomiso(e) });
    }
  
    /* ---------- Internas ---------- */
  
    function cambiarEstado(repo, ctx, a, nuevo, actor, extra) {
      if (!Prestaciones.puedePasar(Prestaciones.SIGUIENTE_SOLICITUD, a.estado, nuevo)) {
        return err('TRANSICION', 'La solicitud está ' + a.estado + ' y no puede pasar a ' + nuevo + '.');
      }
      Object.assign(a, extra, { estado: nuevo, decididaPor: actor, actualizada: ctx.ahora() });
      repo.guardarAnticipo(a);
      repo.log('ANTICIPO_' + nuevo, actor, a.id);
      return ok(vistaAnticipo(a));
    }
  
    function vistaAnticipo(a) {
      return { id: a.id, monto: a.monto, motivo: a.motivo, detalle: a.detalle, estado: a.estado, creada: a.creada, motivoRechazo: a.motivoRechazo || '' };
    }
  
    function parametrosPrestaciones(p) {
      return p && p.porcentajeAnticipoMax != null ? { porcentajeAnticipoMax: Number(p.porcentajeAnticipoMax) } : {};
    }
  
    var api = {
      iniciarSesion: iniciarSesion, iniciarSesionAdmin: iniciarSesionAdmin,
      miEstadoDeCuenta: miEstadoDeCuenta, solicitarAnticipo: solicitarAnticipo, cancelarAnticipo: cancelarAnticipo,
      bandejaAnticipos: bandejaAnticipos, decidirAnticipo: decidirAnticipo,
      generarArchivoAnticipos: generarArchivoAnticipos, marcarAnticiposPagados: marcarAnticiposPagados,
      cambiarEstadoCierre: cambiarEstadoCierre, leerToken: leerToken,
      emitirConstancia: emitirConstancia, misConstancias: misConstancias, verificarConstancia: verificarConstancia,
      listarConstancias: listarConstancias, anularConstancia: anularConstancia,
      cargarEmpleados: cargarEmpleados, listarEmpleados: listarEmpleados, asignarJefe: asignarJefe, asignarJefeDepartamento: asignarJefeDepartamento, fijarEmpresaFideicomiso: fijarEmpresaFideicomiso,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.Servicio = api;
  })(typeof globalThis !== 'undefined' ? globalThis : this);
  return module.exports;
})();

// ===== apps-script/Code.gs =====
/* ==========================================================
   API de RRHH (Google Apps Script). Recibe POST de texto plano
   con JSON { action, ... } y responde JSON { ok, data | code, message }.
   Toda la lógica está en core/servicio.js; aquí solo se leen
   y escriben las hojas.
   ========================================================== */

// Cambia este número cuando publiques una versión nueva; así se comprueba desde el navegador cuál está activa.
var VERSION = '2026-10-29.4';
var MODULOS = ['Calculo', 'Empleados', 'Prestaciones', 'Exportes', 'Constancia', 'Servicio'];

/** Qué módulos están cargados (se nombran uno a uno: no se busca por texto en el global). */
function modulosCargados_() {
  return {
    Calculo: typeof Calculo !== 'undefined' && !!Calculo, Empleados: typeof Empleados !== 'undefined' && !!Empleados,
    Prestaciones: typeof Prestaciones !== 'undefined' && !!Prestaciones, Exportes: typeof Exportes !== 'undefined' && !!Exportes,
    Constancia: typeof Constancia !== 'undefined' && !!Constancia, Servicio: typeof Servicio !== 'undefined' && !!Servicio,
  };
}

var HOJAS = {
  PARAMETROS: ['clave', 'valor'],
  EMPRESAS: ['empresa', 'fideicomiso', 'tipoTAporte', 'tipoTAnticipo', 'forma'],
  EMPLEADOS: ['cedulaLetra', 'cedulaNumero', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'empresaFideicomiso', 'revisarCedula', 'editados', 'motivoRevision', 'jefe', 'salarioMensual'],
  APORTES: ['clave', 'anio', 'trimestre', 'empresa', 'total', 'monto', 'meses', 'diasAdicionales', 'adicionalesForzados', 'nuevo'],
  CIERRES: ['anio', 'trimestre', 'empresa', 'estado', 'por', 'actualizado'],
  ANTICIPOS: ['id', 'clave', 'monto', 'motivo', 'detalle', 'estado', 'creada', 'actualizada', 'decididaPor', 'motivoRechazo'],
  CONSTANCIAS: ['id', 'clave', 'nombre', 'cedula', 'empresa', 'cargo', 'organizacion', 'fechaIngreso', 'salario', 'emision', 'vence', 'estado', 'emitidaPor'],
  USUARIOS: ['cedula', 'sal', 'hash', 'rol', 'nombre'],
  LOG: ['cuando', 'accion', 'actor', 'detalle'],
};

/**
 * Personal de Recursos Humanos que se crea al configurar las hojas. Todavía NO tienen clave:
 * cada uno la pone desde el menú RRHH → «2 · Poner o cambiar clave». Para agregar a otra persona,
 * añádela aquí (cédula sin letra ni verificador) y ejecuta «1 · Configurar hojas».
 */
var USUARIOS_RRHH_INICIALES = [
  { cedula: '30580323', nombre: 'Samuel Herrera', rol: 'ADMIN' },
  { cedula: '7952013', nombre: 'Luis Paul Rojas', rol: 'ADMIN' },
];

var RUTAS_TRABAJADOR = {
  emitirConstancia: function (repo, ctx, d) { return Servicio.emitirConstancia(repo, ctx, d.token); },
  misConstancias: function (repo, ctx, d) { return Servicio.misConstancias(repo, ctx, d.token); },
  verificarConstancia: function (repo, ctx, d) { return Servicio.verificarConstancia(repo, ctx, d.id); },   // pública (QR)
  login: function (repo, ctx, d) { return Servicio.iniciarSesion(repo, ctx, d.cedula); },
  estadoDeCuenta: function (repo, ctx, d) { return Servicio.miEstadoDeCuenta(repo, ctx, d.token); },
  solicitarAnticipo: function (repo, ctx, d) { return Servicio.solicitarAnticipo(repo, ctx, d.token, d); },
  cancelarAnticipo: function (repo, ctx, d) { return Servicio.cancelarAnticipo(repo, ctx, d.token, d.id); },
};

var RUTAS_RRHH = {
  listarConstancias: function (repo, ctx, d) { return Servicio.listarConstancias(repo, ctx, d.token); },
  anularConstancia: function (repo, ctx, d) { return Servicio.anularConstancia(repo, ctx, d.token, d.id); },
  loginAdmin: function (repo, ctx, d) { return Servicio.iniciarSesionAdmin(repo, ctx, d.cedula, d.clave); },
  bandejaAnticipos: function (repo, ctx, d) { return Servicio.bandejaAnticipos(repo, ctx, d.token, d.estado); },
  decidirAnticipo: function (repo, ctx, d) { return Servicio.decidirAnticipo(repo, ctx, d.token, d.id, !!d.aprobar, d.motivoRechazo); },
  archivoAnticipos: function (repo, ctx, d) { return Servicio.generarArchivoAnticipos(repo, ctx, d.token, d.empresa); },
  pagarAnticipos: function (repo, ctx, d) { return Servicio.marcarAnticiposPagados(repo, ctx, d.token, d.ids || []); },
  cargarEmpleados: function (repo, ctx, d) { return Servicio.cargarEmpleados(repo, ctx, d.token, d.filas); },
  listarEmpleados: function (repo, ctx, d) { return Servicio.listarEmpleados(repo, ctx, d.token, { buscar: d.buscar, departamento: d.departamento, sinJefe: !!d.sinJefe }); },
  asignarJefe: function (repo, ctx, d) { return Servicio.asignarJefe(repo, ctx, d.token, d.claves, d.jefe); },
  asignarJefeDepartamento: function (repo, ctx, d) { return Servicio.asignarJefeDepartamento(repo, ctx, d.token, d.departamento, d.jefe); },
  fijarEmpresa: function (repo, ctx, d) { return Servicio.fijarEmpresaFideicomiso(repo, ctx, d.token, d.clave, d.empresa); },
  estadoCierre: function (repo, ctx, d) {
    return Servicio.cambiarEstadoCierre(repo, ctx, d.token, Number(d.anio), Number(d.trimestre), d.empresa, d.estado);
  },
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // Filtro básico: el sitio envía este token. No es un secreto (va en config.js), solo frena visitas al azar.
    var esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (esperado && d.api_token !== esperado) return salida_({ ok: false, code: 'TOKEN', message: 'Acceso no autorizado.' });
    var cargados = modulosCargados_(), sinCargar = MODULOS.filter(function (k) { return !cargados[k]; });
    if (sinCargar.length) throw new Error('Falta código en Apps Script (' + sinCargar.join(', ') + '). Pega RRHH.gs completo y publica una nueva versión de la implementación.');
    var ruta = RUTAS_TRABAJADOR[d.action] || RUTAS_RRHH[d.action];
    if (!ruta) return salida_({ ok: false, code: 'ACCION', message: 'Acción desconocida.' });
    return salida_(ruta(crearRepo_(), crearCtx_(), d));
  } catch (err) {
    console.error(err && err.stack || err);
    // Los errores de puesta en marcha ("Falta la hoja…", "Falta la propiedad…") se muestran tal cual para poder corregirlos.
    var falta = err && /^Falta /.test(String(err.message));
    var sinCodigo = err && err.name === 'ReferenceError';   // falta pegar o publicar algún módulo
    registrarError_(err);
    return salida_({ ok: false, code: 'SERVER', message: falta ? err.message
      : sinCodigo ? 'Falta código en Apps Script (' + err.message + '). Pega RRHH.gs completo y publica una nueva versión de la implementación.'
      : 'Error del servidor. Intenta de nuevo.' });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* sin bloqueo */ }
  }
}

/** Abrir la URL /exec en el navegador muestra qué versión está publicada y si todos los módulos cargaron. */
function doGet() {
  var m = modulosCargados_(), completo = MODULOS.every(function (k) { return m[k]; });
  return salida_({ ok: true, data: 'API de RRHH activa', version: VERSION, modulosCompletos: completo, modulos: m });
}

/** Guarda el error en la hoja LOG para poder consultarlo desde «Diagnóstico». */
function registrarError_(err) {
  try { hoja_('LOG').appendRow([new Date(), 'ERROR', '', String(err && (err.stack || err.message || err)).slice(0, 500)]); } catch (x) { /* sin hoja */ }
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Contexto: reloj, firma y hash ---------- */

function crearCtx_() {
  var secreto = PropertiesService.getScriptProperties().getProperty('SECRETO');
  if (!secreto) throw new Error('Falta la propiedad SECRETO. Ejecuta configurarInicial().');
  return {
    ahora: function () { return Date.now(); },
    firmar: function (s) { return hex_(Utilities.computeHmacSha256Signature(s, secreto)); },
    base64: function (s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8); },
    desbase64: function (s) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString(); },
    hash: function (clave, sal) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + clave, Utilities.Charset.UTF_8)); },
  };
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ---------- Repositorio sobre Google Sheets ---------- */

function hoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(nombre);
  if (!h) throw new Error('Falta la hoja ' + nombre + '. Ejecuta configurarInicial().');
  return h;
}

function leer_(nombre) {
  var h = hoja_(nombre), vals = h.getDataRange().getValues();
  var cab = vals[0], filas = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _fila: i + 1 };
    for (var j = 0; j < cab.length; j++) o[cab[j]] = vals[i][j];
    filas.push(o);
  }
  return filas;
}

function escribirFila_(nombre, obj) {
  var h = hoja_(nombre), cab = HOJAS[nombre];
  var fila = cab.map(function (c) { return obj[c] == null ? '' : obj[c]; });
  if (obj._fila) h.getRange(obj._fila, 1, 1, cab.length).setValues([fila]);
  else { h.appendRow(fila); obj._fila = h.getLastRow(); }
}

function texto_(v) { return v == null ? '' : String(v); }

function empleado_(f) {
  var editados = [];
  try { editados = f.editados ? JSON.parse(f.editados) : []; } catch (e) { /* vacío */ }
  return {
    cedulaLetra: texto_(f.cedulaLetra), cedulaNumero: texto_(f.cedulaNumero), nombre: texto_(f.nombre),
    organizacion: texto_(f.organizacion), departamento: texto_(f.departamento), puesto: texto_(f.puesto),
    estado: texto_(f.estado) || 'Activo', fechaIngreso: Calculo.aFecha(f.fechaIngreso),
    empresaDetalle: texto_(f.empresaDetalle) || 'PCA', empresaFideicomiso: texto_(f.empresaFideicomiso),
    revisarCedula: f.revisarCedula === true || f.revisarCedula === 'TRUE', motivoRevision: texto_(f.motivoRevision),
    salarioMensual: Empleados.numeroDeMonto(f.salarioMensual), jefe: texto_(f.jefe), editados: editados, nombreNorm: Empleados.normalizarNombre(f.nombre),
  };
}

function fechaTexto_(f) {
  return f ? ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y : '';
}

function anticipo_(f) {
  return {
    _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), monto: Number(f.monto), motivo: texto_(f.motivo),
    detalle: texto_(f.detalle), estado: texto_(f.estado), creada: Number(f.creada) || 0, actualizada: Number(f.actualizada) || 0,
    decididaPor: texto_(f.decididaPor), motivoRechazo: texto_(f.motivoRechazo),
  };
}

var constanciasCache = null;
function constancias_() {
  return constanciasCache || (constanciasCache = leer_('CONSTANCIAS').map(function (f) {
    return {
      _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), nombre: texto_(f.nombre), cedula: texto_(f.cedula), empresa: texto_(f.empresa),
      cargo: texto_(f.cargo), organizacion: texto_(f.organizacion), fechaIngreso: texto_(f.fechaIngreso), salario: Number(f.salario),
      emision: Number(f.emision), vence: Number(f.vence), estado: texto_(f.estado) || 'VIGENTE', emitidaPor: texto_(f.emitidaPor),
    };
  }));
}

function crearRepo_() {
  var cache = CacheService.getScriptCache();
  var anticipos = null, cierres = null;
  function anticiposTodos() { return anticipos || (anticipos = leer_('ANTICIPOS').map(anticipo_)); }
  function cierresTodos() { return cierres || (cierres = leer_('CIERRES')); }

  return {
    parametros: function () {
      var p = {};
      leer_('PARAMETROS').forEach(function (f) { p[f.clave] = f.valor; });
      return p;
    },
    constanciasDe: function (clave) { return constancias_().filter(function (c) { return c.clave === clave; }); },
    constanciaPorId: function (id) { return constancias_().filter(function (c) { return c.id === id; })[0] || null; },
    todasConstancias: function () { return constancias_(); },
    guardarConstancia: function (c) { escribirFila_('CONSTANCIAS', c); constanciasCache = null; },
    /** Código largo y aleatorio: va dentro del QR y no se puede adivinar. */
    nuevoIdConstancia: function () { return Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase(); },
    todosEmpleados: function () { return leer_('EMPLEADOS').map(empleado_); },
    /** Reescribe toda la hoja EMPLEADOS de una vez (mucho más rápido que fila por fila). */
    guardarEmpleados: function (lista) {
      var h = hoja_('EMPLEADOS'), cab = HOJAS.EMPLEADOS;
      var ultima = h.getLastRow();
      if (ultima > 1) h.getRange(2, 1, ultima - 1, cab.length).clearContent();
      if (!lista.length) return;
      var filas = lista.map(function (e) {
        return [e.cedulaLetra, String(e.cedulaNumero), e.nombre, e.organizacion, e.departamento, e.puesto, e.estado, fechaTexto_(e.fechaIngreso),
          e.empresaDetalle, e.empresaFideicomiso || '', !!e.revisarCedula, JSON.stringify(e.editados || []), e.motivoRevision || '', e.jefe || '', e.salarioMensual == null ? '' : e.salarioMensual];
      });
      var rango = h.getRange(2, 1, filas.length, cab.length);
      rango.setNumberFormat('@');   // cédulas y fechas como texto: Sheets no les quita ceros ni las convierte
      rango.setValues(filas);
    },
    empleadoPorClave: function (clave) {
      var filas = leer_('EMPLEADOS');
      for (var i = 0; i < filas.length; i++) {
        if (texto_(filas[i].cedulaLetra) + texto_(filas[i].cedulaNumero) === clave) return empleado_(filas[i]);
      }
      return null;
    },
    aportesDe: function (clave) {
      return leer_('APORTES').filter(function (a) { return texto_(a.clave) === clave; }).map(function (a) {
        var c = cierresTodos().filter(function (x) {
          return Number(x.anio) === Number(a.anio) && Number(x.trimestre) === Number(a.trimestre) && x.empresa === a.empresa;
        })[0];
        return { anio: Number(a.anio), trimestre: Number(a.trimestre), empresa: a.empresa, total: Number(a.total), estadoCierre: c ? c.estado : 'ABIERTO' };
      });
    },
    anticiposDe: function (clave) { return anticiposTodos().filter(function (a) { return a.clave === clave; }); },
    anticipoPorId: function (id) { return anticiposTodos().filter(function (a) { return a.id === id; })[0] || null; },
    anticiposPorEstado: function (estado) { return anticiposTodos().filter(function (a) { return a.estado === estado; }); },
    guardarAnticipo: function (a) {
      escribirFila_('ANTICIPOS', a);
      if (anticipos && anticipos.indexOf(a) === -1) anticipos.push(a);
    },
    cierre: function (anio, trimestre, empresa) {
      return cierresTodos().filter(function (c) {
        return Number(c.anio) === anio && Number(c.trimestre) === trimestre && c.empresa === empresa;
      })[0] || null;
    },
    guardarCierre: function (c) { escribirFila_('CIERRES', c); },
    empresaConfig: function (empresa) {
      var f = leer_('EMPRESAS').filter(function (x) { return x.empresa === empresa; })[0];
      return f ? { fideicomiso: f.fideicomiso, tipoTAporte: f.tipoTAporte, tipoTAnticipo: f.tipoTAnticipo, forma: f.forma } : null;
    },
    usuario: function (cedula) {
      var f = leer_('USUARIOS').filter(function (u) { return texto_(u.cedula) === cedula; })[0];
      return f ? { sal: texto_(f.sal), hash: texto_(f.hash), rol: texto_(f.rol) } : null;
    },
    fallos: function (k) { return Number(cache.get('fallo:' + k)) || 0; },
    registrarFallo: function (k) { cache.put('fallo:' + k, String((Number(cache.get('fallo:' + k)) || 0) + 1), 900); },
    nuevoId: function () { return 'ANT-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },
    log: function (accion, actor, detalle) {
      hoja_('LOG').appendRow([new Date(), accion, actor, detalle]);
    },
  };
}

/* ---------- Puesta en marcha (se ejecutan desde el editor) ---------- */

/** Crea las hojas con sus encabezados, los parámetros y la clave secreta. Se puede repetir sin dañar datos. */
function configurarInicial() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HOJAS).forEach(function (nombre) {
    var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    h.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]).setFontWeight('bold');
    h.setFrozenRows(1);
  });
  var sem = function (nombre, filas) {
    var h = ss.getSheetByName(nombre);
    if (h.getLastRow() <= 1) h.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
  };
  sem('PARAMETROS', [['anioBase', 2025], ['diasMinimosMes', 1], ['diasUtilidades', 120], ['porcentajeAnticipoMax', 0.75]]);
  // Parámetros nuevos: se agregan solo si no existen, sin tocar los que ya editaste.
  var hp = ss.getSheetByName('PARAMETROS'), existentes = {};
  hp.getDataRange().getValues().forEach(function (f) { existentes[String(f[0])] = true; });
  [['firmaNombre', 'Lic. Luis Paul Rojas'], ['firmaCargo', 'Gerente de Gestión Humana'], ['firmaTelefono', '(0412) 205.11.60.'], ['ciudad', 'Caracas'], ['constanciasMaxPorMes', 5]]
    .forEach(function (f) { if (!existentes[f[0]]) hp.appendRow(f); });
  sem('EMPRESAS', [['PCA', 5847, 1, 5, 'A'], ['AIV', 5847, 1, 5, 'A']]);
  // Usuarios de RRHH iniciales (sin clave todavía; no pueden entrar hasta ponerla)
  var existentes_ = {};
  leer_('USUARIOS').forEach(function (u) { existentes_[texto_(u.cedula)] = u; });
  USUARIOS_RRHH_INICIALES.forEach(function (u) {
    var ya = existentes_[u.cedula];
    if (!ya) escribirFila_('USUARIOS', { cedula: u.cedula, sal: '', hash: '', rol: u.rol, nombre: u.nombre });
    else if (!texto_(ya.nombre)) { ya.nombre = u.nombre; escribirFila_('USUARIOS', ya); }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRETO')) props.setProperty('SECRETO', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('API_TOKEN')) props.setProperty('API_TOKEN', 'RRHH2026');
  ['EMPLEADOS', 'APORTES', 'USUARIOS'].forEach(function (n) {
    // cédulas y claves como texto, para que Sheets no les quite ceros ni letras
    ss.getSheetByName(n).getRange(2, 1, 1000, n === 'EMPLEADOS' ? 2 : 1).setNumberFormat('@');
  });
}

/* ---------- Menú «RRHH» dentro de la hoja ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RRHH')
    .addItem('1 · Configurar hojas y usuarios', 'configurarInicial')
    .addItem('2 · Poner o cambiar clave de RRHH', 'ponerClaveRRHH')
    .addItem('Diagnóstico', 'diagnostico')
    .addToUi();
}

/** Avisa con claridad si falta pegar algún archivo del sistema (en vez de un error técnico). */
function requerirModulos_() {
  var m = modulosCargados_(), faltan = MODULOS.filter(function (k) { return !m[k]; });
  if (faltan.length) {
    SpreadsheetApp.getUi().alert('Falta código en Apps Script',
      'No se encontró: ' + faltan.join(', ') + '.\n\nBorra todos los archivos del proyecto y pega UN solo archivo: RRHH.gs (carpeta apps-script del repositorio).',
      SpreadsheetApp.getUi().ButtonSet.OK);
    throw new Error('Faltan módulos: ' + faltan.join(', '));
  }
}

/**
 * Pone o cambia la clave de una persona de RRHH. Muestra el nombre para confirmar.
 * La clave no queda escrita en ningún sitio, solo su huella. Solo quien edita esta hoja puede hacerlo.
 */
function ponerClaveRRHH() {
  var ui = SpreadsheetApp.getUi();
  requerirModulos_();
  configurarInicial();
  var lista = leer_('USUARIOS').map(function (u, i) {
    return (i + 1) + ') ' + texto_(u.cedula) + ' · ' + (texto_(u.nombre) || '—') + (texto_(u.hash) ? '' : '  (sin clave)');
  }).join('\n');
  var c = ui.prompt('Clave de RRHH', 'Escribe la cédula de la persona (solo números):\n\n' + lista, ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  var cedula = Empleados.numeroDeCedulaTexto(c.getResponseText());
  if (!cedula) { ui.alert('La cédula no es válida.'); return; }
  var existente = leer_('USUARIOS').filter(function (u) { return texto_(u.cedula) === cedula; })[0];
  var emp = crearRepo_().empleadoPorClave('V' + cedula) || crearRepo_().empleadoPorClave('E' + cedula);
  var quien = (existente && texto_(existente.nombre)) || (emp && emp.nombre) || '(no está en la lista de empleados todavía)';
  var rol = existente ? texto_(existente.rol) : '';
  if (!existente) {
    if (ui.alert('Persona nueva', quien + '\nCédula ' + cedula + '\n\nNo es un usuario de RRHH todavía. ¿Crearla?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    rol = ui.alert('Rol', '¿Administrador? Sí = ADMIN (todo). No = RRHH.', ui.ButtonSet.YES_NO) === ui.Button.YES ? 'ADMIN' : 'RRHH';
  } else if (ui.alert('Confirmar', quien + '\nCédula ' + cedula + ' · ' + rol + '\n\n¿Poner o cambiar su clave?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var k = ui.prompt('Clave', 'Clave de ' + quien + ' (mínimo 8 caracteres). Se pedirá cada vez que entre:', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  var clave = k.getResponseText();
  if (clave.length < 8) { ui.alert('La clave debe tener al menos 8 caracteres.'); return; }
  guardarUsuario_(cedula, clave, rol, (existente && texto_(existente.nombre)) || (emp && emp.nombre) || '');
  ui.alert('Listo', 'Clave guardada para ' + quien + '.\nAl escribir su cédula en el sitio, el sistema le pedirá la clave.', ui.ButtonSet.OK);
}

function guardarUsuario_(cedula, clave, rol, nombre) {
  var sal = Utilities.getUuid();
  var existente = leer_('USUARIOS').filter(function (u) { return texto_(u.cedula) === cedula; })[0];
  escribirFila_('USUARIOS', { _fila: existente ? existente._fila : 0, cedula: cedula, sal: sal, hash: crearCtx_().hash(clave, sal), rol: rol, nombre: nombre || (existente ? texto_(existente.nombre) : '') });
}

/** Revisa que todo esté en su sitio y lo muestra en pantalla. */
function diagnostico() {
  var ui = SpreadsheetApp.getUi(), l = [], ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HOJAS).forEach(function (n) {
    var h = ss.getSheetByName(n);
    l.push((h ? '✔ ' : '✘ FALTA ') + 'hoja ' + n + (h ? ' (' + Math.max(0, h.getLastRow() - 1) + ' filas)' : ''));
  });
  var pr = PropertiesService.getScriptProperties();
  l.push((pr.getProperty('SECRETO') ? '✔ ' : '✘ FALTA ') + 'clave secreta');
  l.push((pr.getProperty('API_TOKEN') ? '✔ ' : '✘ FALTA ') + 'token de la API');
  var cargados = modulosCargados_();
  MODULOS.forEach(function (m) { l.push((cargados[m] ? '✔ ' : '✘ FALTA ') + 'módulo ' + m); });
  l.push('Versión del código: ' + VERSION);
  try {
    var errores = leer_('LOG').filter(function (f) { return f.accion === 'ERROR'; }).slice(-3).map(function (f) { return '· ' + texto_(f.detalle).split('\n')[0]; });
    if (errores.length) l.push('Últimos errores:\n' + errores.join('\n'));
  } catch (e) { /* sin LOG */ }
  var faltas = l.filter(function (x) { return x.indexOf('✘') === 0; }).length;
  ui.alert(faltas ? 'Hay ' + faltas + ' cosas por corregir' : 'Todo en orden', l.join('\n') + (faltas ? '\n\nEjecuta «1 · Configurar hojas» y revisa que pegaste todos los archivos.' : ''), ui.ButtonSet.OK);
}
