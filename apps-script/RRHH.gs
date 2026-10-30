/* ============================================================
 * RRHH Prosein / Austral · API de Apps Script (ARCHIVO GENERADO)
 * No lo edites aquí: cambia los archivos de core/ o src/api.gs
 * y ejecuta `npm run build:gas`.
 *
 * Cómo usarlo: en Apps Script borra todos los archivos del proyecto,
 * deja uno solo y pega TODO este contenido (más de 1.500 líneas).
 * ============================================================ */

// Errores al cargar los módulos (se muestran al abrir la URL /exec).
var ERRORES_CARGA = [];
// ===== core/calculo.js =====
var Calculo = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
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
  } catch (e) { ERRORES_CARGA.push('Calculo: ' + (e && e.message)); return undefined; }
})();

// ===== core/empleados.js =====
var Empleados = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
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
    
      /** Quita espacios dobles y en los extremos («LUIS PAUL  ROJAS » → «LUIS PAUL ROJAS»). */
      function espacios(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
    
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
    
      /**
       * Busca al jefe por su nombre (como viene en la columna «JEFE DIRECTO») entre los empleados activos.
       * 1) nombre exacto (sin tildes ni espacios dobles); 2) si viene abreviado («CARLOS CAMACARO»), el único empleado
       * cuyo nombre contiene todas esas palabras. Devuelve { clave, nombre, tipo: 'exacto'|'palabras'|'ambiguo'|'no_encontrado' }.
       */
      function resolverJefe(nombreJefe, empleados, usuarios) {
        var buscado = normalizarNombre(nombreJefe);
        if (!buscado) return { clave: '', nombre: '', tipo: 'vacio' };
        var r = buscarPorNombre(buscado, empleados.filter(function (e) { return e.estado !== 'Inactivo' && e.cedulaNumero; }));
        if (r.tipo !== 'no_encontrado' || !usuarios || !usuarios.length) return r;
        // usuarios de RRHH que no son empleados (p. ej. la CEO): { clave:'V123', nombre }
        var u = buscarPorNombre(buscado, usuarios.map(function (x) { return { cedulaLetra: x.clave.charAt(0), cedulaNumero: x.clave.slice(1), nombre: x.nombre }; }));
        return u.clave ? { clave: u.clave, nombre: u.nombre, tipo: 'usuario' } : u;
      }
    
      function buscarPorNombre(buscado, activos) {
        var exactos = activos.filter(function (e) { return normalizarNombre(e.nombre) === buscado; });
        if (exactos.length === 1) return { clave: claveCedula(exactos[0]), nombre: exactos[0].nombre, tipo: 'exacto' };
        var palabras = buscado.split(' ');
        var candidatos = (exactos.length ? exactos : activos).filter(function (e) {
          var suyas = normalizarNombre(e.nombre).split(' ');
          return palabras.every(function (p) { return suyas.indexOf(p) !== -1; });
        });
        if (candidatos.length === 1) return { clave: claveCedula(candidatos[0]), nombre: candidatos[0].nombre, tipo: 'palabras' };
        return { clave: '', nombre: '', tipo: candidatos.length ? 'ambiguo' : 'no_encontrado' };
      }
    
      var ORGANIZACION_POR_EMPRESA = { PCA: 'PROSEIN CENTRAL', AIV: 'AUSTRAL IMPORT DE VENEZUELA C.A' };
    
      /**
       * Empleado que no está en la nómina (no viene en el Detalle de Empleado) pero está activo: lo agrega RRHH a mano.
       * datos: { cedula, nombre, empresa:'PCA'|'AIV', departamento, puesto, fechaIngreso, genero, salarioMensual }
       * Devuelve { empleado } o { errores[] }.
       */
      function empleadoFueraDeNomina(datos) {
        var e = [], c = parsearCedula(datos.cedula);
        if (!c.numero || c.numero.length < 5) e.push('Escribe una cédula válida (al menos 5 dígitos).');
        if (!espacios(datos.nombre)) e.push('Escribe el nombre y apellido.');
        if (['PCA', 'AIV'].indexOf(datos.empresa) === -1) e.push('Elige la empresa.');
        var f = Calculo.aFecha(datos.fechaIngreso);
        if (!f) e.push('Escribe la fecha de ingreso.');
        if (e.length) return { errores: e };
        return { empleado: {
          cedulaLetra: c.letra, cedulaNumero: c.numero, revisarCedula: false, motivoRevision: '',
          nombre: espacios(datos.nombre).toUpperCase(), nombreNorm: normalizarNombre(datos.nombre),
          organizacion: ORGANIZACION_POR_EMPRESA[datos.empresa], departamento: espacios(datos.departamento), puesto: espacios(datos.puesto),
          estado: 'Activo', fechaIngreso: f, empresaDetalle: datos.empresa, empresaFideicomiso: datos.empresa,
          salarioMensual: numeroDeMonto(datos.salarioMensual), genero: espacios(datos.genero), jefe: '', editados: [], fueraNomina: true,
        } };
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
          nombre: espacios(fila.nombre),
          nombreNorm: normalizarNombre(fila.nombre),
          organizacion: espacios(fila.organizacion),
          departamento: espacios(fila.departamento),
          puesto: espacios(fila.puesto),
          estado: estadoEnEspanol(fila.estado),
          fechaIngreso: f,
          empresaDetalle: empresaDesdeDetalle(fila.organizacion),
          salarioMensual: numeroDeMonto(fila.salarioMensual),
          genero: espacios(fila.genero),                        // 'Femenino' / 'Masculino' (para el saludo)   // Salario M. del detalle; lo usa la constancia de trabajo
          empresaFideicomiso: '',
          jefe: '',            // clave de cédula del jefe directo (se asigna desde RRHH)
          editados: [],
        };
      }
    
      var CAMPOS_DETALLE = ['genero', 'salarioMensual', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'cedulaLetra', 'cedulaNumero', 'revisarCedula', 'motivoRevision'];
    
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
              if (c === 'genero' && !nuevo.genero) return;
              actual[c] = nuevo[c];
            });
            if (actual.estado === 'Inactivo') actual.estado = nuevo.estado;
            actual.fueraNomina = false;
            resumen.actualizados++;
          } else {
            idx[k] = salida.push(nuevo) - 1;
            resumen.agregados++;
          }
        });
    
        salida.forEach(function (e) {
          if (!vistos[claveCedula(e)] && e.estado !== 'Inactivo' && !e.fueraNomina) { e.estado = 'Inactivo'; resumen.inactivados++; }
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
        jefeNombre: ['JEFE DIRECTO', 'JEFE', 'SUPERVISOR', 'SUPERVISOR DIRECTO'],
        genero: ['GENERO', 'SEXO'],
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
          o.genero = col.genero ? f[col.genero] : '';
          o.jefeNombre = col.jefeNombre ? espacios(f[col.jefeNombre]) : '';
          o.fechaInicio = col.fechaInicio ? fechaDeExcel(f[col.fechaInicio]) : '';
          filas.push(o);
        });
        return { filas: filas, faltantes: faltantes, omitidas: omitidas };
      }
    
      var api = {
        mapearDetalle: mapearDetalle, fechaDeExcel: fechaDeExcel,
        resolverJefe: resolverJefe, empleadoFueraDeNomina: empleadoFueraDeNomina, numeroDeMonto: numeroDeMonto, numeroDeCedulaTexto: numeroDeCedulaTexto, creaCicloDeJefes: creaCicloDeJefes,
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
  } catch (e) { ERRORES_CARGA.push('Empleados: ' + (e && e.message)); return undefined; }
})();

// ===== core/prestaciones.js =====
var Prestaciones = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
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
    
      /* ---------- Ventana trimestral de solicitudes (sin saldo en el sistema: el colaborador lo ve en su banco) ---------- */
    
      var ORDINAL = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º' };
      var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    
      /** '2026-T4' → '4.º trimestre de 2026' */
      function etiquetaVentana(clave) {
        var m = /^(\d{4})-T([1-4])$/.exec(String(clave || ''));
        return m ? ORDINAL[m[2]] + ' trimestre de ' + m[1] : '';
      }
    
      /**
       * Cada trimestre calendario se puede enviar UNA solicitud, y corresponde al trimestre anterior
       * (en enero de 2027 se solicita por el 4.º trimestre de 2026). hoy: 'AAAA-MM-DD'.
       */
      function ventanaAnticipo(hoy) {
        var y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7)), q = Math.ceil(m / 3);
        var vy = q === 1 ? y - 1 : y, vq = q === 1 ? 4 : q - 1;
        var sy = q === 4 ? y + 1 : y, sq = q === 4 ? 1 : q + 1;          // próxima ventana (calendario)
        var mesProx = (sq - 1) * 3;                                      // 0 = enero
        var clave = vy + '-T' + vq, siguiente = (q === 4 ? y : sy) + '-T' + q;
        return {
          clave: clave, etiqueta: etiquetaVentana(clave),
          siguiente: { clave: siguiente, etiqueta: etiquetaVentana(siguiente), abre: sy + '-' + ('0' + (mesProx + 1)).slice(-2) + '-01', mes: MESES[mesProx] + ' de ' + sy },
        };
      }
    
      /**
       * Solicitud sin saldo en el sistema: monto y motivo, aceptación de responsabilidad y una por ventana.
       * c: { empleado, previas (anticipos del colaborador), ventana, parametros }
       */
      function validarSolicitudBanco(sol, c) {
        var p = Object.assign({}, PARAMETROS, c.parametros || {}), e = [];
        if (!c.empleado || c.empleado.estado === 'Inactivo') e.push('El empleado no está activo.');
        var monto = Number(sol.monto);
        if (!isFinite(monto) || monto <= 0) e.push('Escribe el monto que quieres solicitar.');
        if (p.motivos.indexOf(sol.motivo) === -1) e.push('Elige el motivo.');
        if (sol.motivo === 'Otro' && !String(sol.detalle || '').trim()) e.push('Explica el motivo.');
        if (sol.acepta !== true) e.push('Debes confirmar que revisaste tu disponible en el banco y que envías el monto bajo tu responsabilidad.');
        var ya = (c.previas || []).filter(function (a) { return a.ventana === c.ventana.clave && a.estado !== 'CANCELADA'; })[0];
        if (ya) e.unshift('Ya enviaste tu solicitud del ' + c.ventana.etiqueta + '. Podrás hacer otra a partir de ' + c.ventana.siguiente.mes + ' (' + c.ventana.siguiente.etiqueta + ').');
        return { ok: e.length === 0, errores: e };
      }
    
      var api = {
        etiquetaVentana: etiquetaVentana, ventanaAnticipo: ventanaAnticipo, validarSolicitudBanco: validarSolicitudBanco,
        PARAMETROS: PARAMETROS, ESTADOS_CIERRE: ESTADOS_CIERRE,
        SIGUIENTE_CIERRE: SIGUIENTE_CIERRE, SIGUIENTE_SOLICITUD: SIGUIENTE_SOLICITUD,
        puedePasar: puedePasar, resumenTrabajador: resumenTrabajador,
        validarSolicitudAnticipo: validarSolicitudAnticipo,
      };
      if (typeof module !== 'undefined' && module.exports) module.exports = api;
      else raiz.Prestaciones = api;
    })(typeof globalThis !== 'undefined' ? globalThis : this);
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Prestaciones: ' + (e && e.message)); return undefined; }
})();

// ===== core/exportes.js =====
var Exportes = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
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
  } catch (e) { ERRORES_CARGA.push('Exportes: ' + (e && e.message)); return undefined; }
})();

// ===== core/constancia.js =====
var Constancia = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
    /* ==========================================================
       Constancia de trabajo: textos, monto en letras y vigencia (30 días).
       Funciones puras; las usan el servidor, el navegador (PDF) y las pruebas.
       Las fechas de emisión se calculan en hora de Caracas (UTC-4, sin horario de verano).
       ========================================================== */
    (function (raiz) {
      'use strict';
    
      var VIGENCIA_DIAS = 30;
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
    
      /** Suma días a una fecha {y,m,d}. */
      function sumarDias(f, dias) {
        var d = new Date(Date.UTC(f.y, f.m - 1, f.d) + dias * 86400000);
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
      }
    
      /** Vencimiento: 30 días después de la emisión, hasta el final de ese día (hora de Caracas). */
      function vencimiento(emisionMs) {
        return finDelDia(sumarDias(fechaCaracas(emisionMs), VIGENCIA_DIAS));
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
        VIGENCIA_DIAS: VIGENCIA_DIAS, sumarDias: sumarDias, NOMBRES_EMPRESA: NOMBRES_EMPRESA,
        enteroEnLetras: enteroEnLetras, montoEnLetras: montoEnLetras, formatoMonto: formatoMonto,
        fechaCaracas: fechaCaracas, sumarMeses: sumarMeses, vencimiento: vencimiento, estadoConstancia: estadoConstancia,
        fechaLarga: fechaLarga, fechaLargaConDia: fechaLargaConDia, fechaCorta: fechaCorta,
      };
      if (typeof module !== 'undefined' && module.exports) module.exports = api;
      else raiz.Constancia = api;
    })(typeof globalThis !== 'undefined' ? globalThis : this);
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Constancia: ' + (e && e.message)); return undefined; }
})();

// ===== core/vacaciones.js =====
var Vacaciones = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
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
        var iCed = cab.indexOf('CEDULA'), iNom = cab.indexOf('NOMBRE');
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
          var nombre = iNom !== -1 ? String(f[iNom] == null ? '' : f[iNom]).replace(/\s+/g, ' ').trim() : '';
          var cedOk = /^[VE]?-?\d{5,9}$/i.test(ced.replace(/\./g, ''));
          if (!cedOk && !(nombre && !/TOTAL/i.test(nombre))) return;      // sin cédula: se identifica por el nombre al importar
          personas.push({
            cedula: cedOk ? ced : '', nombre: nombre,
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
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Vacaciones: ' + (e && e.message)); return undefined; }
})();

// ===== core/servicio.js =====
var Servicio = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './servicio.js': Servicio })[ruta]; };
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
      var Vacaciones = isNode ? require('./vacaciones.js') : dependencia(raiz, 'Vacaciones');
    
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
        return ok({ token: crearToken(ctx, clave, 'TRABAJADOR'), nombre: emp.nombre, genero: emp.genero || '', empresa: Empleados.empresaFideicomiso(emp) });
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
        var data = { token: crearToken(ctx, digitos, u.rol), rol: u.rol, nombre: emp ? emp.nombre : '', genero: emp ? emp.genero || '' : '' };
        if (emp && emp.estado !== 'Inactivo') data.tokenTrabajador = crearToken(ctx, Empleados.claveCedula(emp), 'TRABAJADOR');
        if (!emp) data.nombre = u.nombre || '';
        var mias = ['V' + digitos, 'E' + digitos];
        data.esJefe = repo.todosEmpleados().some(function (e) { return mias.indexOf(e.jefe) !== -1 && e.estado !== 'Inactivo'; });
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
        var emp = repo.empleadoPorClave(s.clave), p = repo.parametros();
        var sol = { monto: Calculo.redondear2(Number(datos && datos.monto)), motivo: datos && datos.motivo, detalle: datos && datos.detalle, acepta: datos && datos.acepta === true };
        var previas = repo.anticiposDe(s.clave), ventana = Prestaciones.ventanaAnticipo(hoyCaracas(ctx));
        var v;
        if (String(p.anticipoValidarDisponible || '').toUpperCase() === 'SI') {   // cuando el sistema tenga los aportes acreditados
          v = Prestaciones.validarSolicitudAnticipo(sol, Prestaciones.resumenTrabajador(repo.aportesDe(s.clave), previas, parametrosPrestaciones(p)), emp, parametrosPrestaciones(p));
        } else {                                                                  // hoy: el colaborador ve su disponible en el banco
          v = Prestaciones.validarSolicitudBanco(sol, { empleado: emp, previas: previas, ventana: ventana, parametros: parametrosPrestaciones(p) });
        }
        if (!v.ok) return err('VALIDACION', v.errores.join(' '));
        var a = {
          id: repo.nuevoId(), clave: s.clave, monto: sol.monto, motivo: sol.motivo, detalle: String(sol.detalle || '').trim(),
          estado: 'PENDIENTE', creada: ctx.ahora(), decididaPor: '', motivoRechazo: '', ventana: ventana.clave, acepto: ctx.ahora(),
        };
        repo.guardarAnticipo(a);
        repo.log('ANTICIPO_SOLICITADO', s.clave, a.id + ' · ' + a.monto);
        return ok(vistaAnticipo(a));
      }
    
      /** Lo que ve el colaborador en Fideicomiso: la ventana actual, si puede solicitar y sus solicitudes. */
      function datosAnticipo(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var ventana = Prestaciones.ventanaAnticipo(hoyCaracas(ctx)), anticipos = repo.anticiposDe(s.clave);
        var actual = anticipos.filter(function (a) { return a.ventana === ventana.clave && a.estado !== 'CANCELADA'; })[0];
        return ok({
          ventana: ventana, motivos: Prestaciones.PARAMETROS.motivos, puedeSolicitar: !actual, actual: actual ? vistaAnticipo(actual) : null,
          anticipos: anticipos.sort(function (a, b) { return b.creada - a.creada; }).map(vistaAnticipo),
        });
      }
    
      /** RRHH: el banco rechazó el anticipo (por ejemplo, el monto superaba el disponible). */
      function rechazarAnticipoBanco(repo, ctx, token, id, motivo) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var a = repo.anticipoPorId(id);
        if (!a) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        if (a.estado !== 'EN_ARCHIVO') return err('TRANSICION', 'Solo se marca así una solicitud enviada al banco.');
        return cambiarEstado(repo, ctx, a, 'RECHAZADA', s.clave, { motivoRechazo: String(motivo || '').trim() || 'Rechazada por el banco: el monto supera el disponible.' });
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
       * con vigencia de 30 días y un código único para el QR. Sale sola, sin aprobación.
       * Solo una a la vez: mientras tenga una VIGENTE no se genera otra (se vuelve a descargar la misma).
       * Cuando vence, o si RRHH la anula, puede generar una nueva.
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
        var propias = repo.constanciasDe(s.clave);
        var vigente = propias.filter(function (c) { return Constancia.estadoConstancia(c, ahora) === 'VIGENTE'; })[0];
        if (vigente) {
          var hasta = Constancia.fechaCaracas(vigente.vence);
          return err('YA_VIGENTE', 'Ya tienes una constancia vigente hasta el ' + Constancia.fechaCorta(hasta) +
            '. Puedes descargarla de nuevo; podrás generar una nueva a partir del ' + Constancia.fechaCorta(Constancia.sumarDias(hasta, 1)) + '.');
        }
        var recientes = propias.filter(function (c) { return c.emision > ahora - 30 * 86400000; });
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
    
      /* ---------- Vacaciones ---------- */
    
      var ESTADOS_VAC = { PENDIENTE_JEFE: ['APROBADA_JEFE', 'RECHAZADA', 'CANCELADA'], APROBADA_JEFE: ['REGISTRADA', 'RECHAZADA'], REGISTRADA: [], RECHAZADA: [], CANCELADA: [] };
    
      /** Jefe activo: empleado activo o usuario de RRHH. → { nombre } o null */
      function jefeActivo(repo, clave) {
        if (!clave) return null;
        var e = repo.empleadoPorClave(clave);
        if (e && e.estado !== 'Inactivo') return { nombre: e.nombre };
        var u = usuariosNoEmpleados(repo).filter(function (x) { return x.clave === clave; })[0];
        return u ? { nombre: u.nombre } : null;
      }
    
      function hoyCaracas(ctx) { return Vacaciones.deObjeto(Constancia.fechaCaracas(ctx.ahora())); }
    
      function reglasVac(p) {
        var r = {};
        if (Number(p.vacAnticipacionMin) > 0) r.anticipacionMin = Number(p.vacAnticipacionMin);
        if (Number(p.vacAnticipacionMax) > 0) r.anticipacionMax = Number(p.vacAnticipacionMax);
        return Object.assign({}, Vacaciones.REGLAS, r);
      }
    
      /** Períodos, solicitudes y saldo de un empleado. */
      function contextoVac(repo, ctx, emp) {
        var clave = Empleados.claveCedula(emp), hoy = hoyCaracas(ctx);
        var periodos = Vacaciones.periodosDeEmpleado(Vacaciones.deObjeto(emp.fechaIngreso), repo.vacPeriodosDe(clave), hoy);
        var solicitudes = repo.vacSolicitudesDe(clave);
        return { clave: clave, hoy: hoy, periodos: periodos, solicitudes: solicitudes, saldo: Vacaciones.saldo(periodos, solicitudes) };
      }
    
      /** info: clave → { nombre, empresa } (de nombresPorClave). */
      function vistaVac(s, info) {
        var yo = info && info[s.clave] || {}, jefe = info && info[s.jefe] || {};
        return {
          id: s.id, clave: s.clave, nombre: yo.nombre || '', empresa: yo.empresa || 'PCA', inicio: s.inicio, culminacion: s.culminacion, reintegro: s.reintegro,
          dias: s.dias, condicion: s.condicion, imputacion: s.imputacion, estado: s.estado, creada: s.creada,
          jefe: s.jefe, jefeNombre: jefe.nombre || '', motivoRechazo: s.motivoRechazo || '', nomina: s.nomina || '',
          // constancia de aprobación (solo cuando RRHH la registró)
          registrada: s.registrada || 0, numeroConstancia: s.numeroConstancia || '', pendientesDespues: s.pendientesDespues || null,
        };
      }
    
      function nombresPorClave(repo) {
        var m = {};
        repo.todosEmpleados().forEach(function (e) { m[Empleados.claveCedula(e)] = { nombre: e.nombre, empresa: Empleados.empresaFideicomiso(e) }; });
        usuariosNoEmpleados(repo).forEach(function (u) { if (!m[u.clave]) m[u.clave] = { nombre: u.nombre, empresa: '' }; });
        return m;
      }
    
      function cambiarVac(repo, ctx, sol, nuevo, actor, extra) {
        if ((ESTADOS_VAC[sol.estado] || []).indexOf(nuevo) === -1) return err('TRANSICION', 'La solicitud ya no está pendiente de esa acción.');
        Object.assign(sol, extra || {}, { estado: nuevo, actualizada: ctx.ahora() });
        repo.guardarVacSolicitud(sol);
        repo.log('VACACIONES_' + nuevo, actor, sol.id);
        return ok(vistaVac(sol, nombresPorClave(repo)));
      }
    
      /** Lo que ve el trabajador: saldo por período, sus solicitudes, feriados y reglas para el formulario. */
      function datosVacaciones(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var emp = repo.empleadoPorClave(s.clave);
        if (!emp) return err('NO_ENCONTRADO', 'No encontramos tus datos.');
        var c = contextoVac(repo, ctx, emp), nombres = nombresPorClave(repo);
        var jefe = jefeActivo(repo, emp.jefe);
        return ok({
          hoy: c.hoy, reglas: reglasVac(repo.parametros()), feriados: repo.feriados(), saldo: c.saldo,
          jefe: jefe ? { clave: emp.jefe, nombre: jefe.nombre } : null,
          sinFechaIngreso: !emp.fechaIngreso,
          solicitudes: c.solicitudes.sort(function (a, b) { return b.creada - a.creada; }).map(function (x) { return vistaVac(x, nombres); }),
        });
      }
    
      function solicitarVacaciones(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var emp = repo.empleadoPorClave(s.clave);
        if (!emp || emp.estado === 'Inactivo') return err('VALIDACION', 'No encontramos tus datos activos.');
        var jefe = jefeActivo(repo, emp.jefe);
        var c = contextoVac(repo, ctx, emp), feriados = repo.feriados();
        var v = Vacaciones.validarSolicitud({ inicio: datos && datos.inicio, dias: Number(datos && datos.dias) }, {
          hoy: c.hoy, feriados: feriados, saldo: c.saldo, solicitudes: c.solicitudes,
          tieneJefe: !!jefe, reglas: reglasVac(repo.parametros()),
        });
        if (!v.ok) return err('VALIDACION', v.errores.join(' '));
        var sol = {
          id: repo.nuevoIdVac(), clave: c.clave, inicio: datos.inicio, culminacion: v.calculo.culminacion, reintegro: v.calculo.reintegro,
          dias: Number(datos.dias), condicion: v.calculo.condicion, imputacion: v.calculo.imputacion, estado: 'PENDIENTE_JEFE',
          jefe: emp.jefe, creada: ctx.ahora(), actualizada: ctx.ahora(), decididaJefePor: '', registradaPor: '', nomina: '', motivoRechazo: '',
        };
        repo.guardarVacSolicitud(sol);
        repo.log('VACACIONES_SOLICITADA', c.clave, sol.id + ' · ' + sol.dias + ' días desde ' + sol.inicio);
        return ok(vistaVac(sol, nombresPorClave(repo)));
      }
    
      function cancelarVacaciones(repo, ctx, token, id) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var sol = repo.vacSolicitudPorId(id);
        if (!sol || sol.clave !== s.clave) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        if (sol.estado !== 'PENDIENTE_JEFE') return err('TRANSICION', 'Solo puedes cancelar una solicitud que tu jefe aún no ha revisado.');
        return cambiarVac(repo, ctx, sol, 'CANCELADA', s.clave);
      }
    
      /** Bandeja del jefe directo: solicitudes de su equipo. */
      function equipoVacaciones(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var mias = clavesDeJefe(s);
        var equipo = repo.todosEmpleados().filter(function (e) { return mias.indexOf(e.jefe) !== -1 && e.estado !== 'Inactivo'; });
        var nombres = nombresPorClave(repo);
        var sols = [].concat.apply([], mias.map(function (c) { return repo.vacSolicitudesPorJefe(c); })).sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
        return ok({
          esJefe: equipo.length > 0, equipo: equipo.length,
          pendientes: sols.filter(function (x) { return x.estado === 'PENDIENTE_JEFE'; }).map(function (x) { return vistaVac(x, nombres); }),
          recientes: sols.filter(function (x) { return x.estado !== 'PENDIENTE_JEFE'; }).sort(function (a, b) { return b.actualizada - a.actualizada; })
            .slice(0, 20).map(function (x) { return vistaVac(x, nombres); }),
        });
      }
    
      function decidirVacacionesJefe(repo, ctx, token, id, aprobar, motivo) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var sol = repo.vacSolicitudPorId(id);
        if (!sol || clavesDeJefe(s).indexOf(sol.jefe) === -1) return err('NO_ENCONTRADO', 'Esa solicitud no es de tu equipo.');
        if (!aprobar && !String(motivo || '').trim()) return err('VALIDACION', 'Indica el motivo del rechazo.');
        return cambiarVac(repo, ctx, sol, aprobar ? 'APROBADA_JEFE' : 'RECHAZADA', s.clave,
          { decididaJefePor: s.clave, decisionJefe: ctx.ahora(), motivoRechazo: aprobar ? '' : String(motivo).trim() });
      }
    
      /** RRHH: solicitudes por estado (por defecto, las aprobadas por el jefe que faltan por registrar). */
      function bandejaVacaciones(repo, ctx, token, estado) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var nombres = nombresPorClave(repo);
        var activos = repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo'; });
        return ok({
          solicitudes: repo.vacSolicitudesPorEstado(estado || 'APROBADA_JEFE').sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; })
            .map(function (x) { return vistaVac(x, nombres); }),
          sinJefe: activos.filter(function (e) { return !e.jefe; }).length,
          conCierre: repo.vacClavesConPeriodos().length,
        });
      }
    
      /**
       * RRHH registra: queda la constancia de aprobación con su número (formato del Excel) y los días que
       * quedan pendientes por período una vez aplicado este disfrute.
       */
      function registrarVacaciones(repo, ctx, token, id, nomina) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var sol = repo.vacSolicitudPorId(id);
        if (!sol) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        var emp = repo.empleadoPorClave(sol.clave);
        var extra = { registradaPor: s.clave, registrada: ctx.ahora(), nomina: String(nomina || '').trim() };
        if (emp) {
          var c = contextoVac(repo, ctx, emp);
          extra.numeroConstancia = Vacaciones.numeroConstancia(sol, emp.cedulaLetra, emp.cedulaNumero);
          extra.pendientesDespues = Vacaciones.pendientesTras(c.periodos, c.solicitudes, sol);
        }
        return cambiarVac(repo, ctx, sol, 'REGISTRADA', s.clave, extra);
      }
    
      function rechazarVacacionesRRHH(repo, ctx, token, id, motivo) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        if (!String(motivo || '').trim()) return err('VALIDACION', 'Indica el motivo del rechazo.');
        var sol = repo.vacSolicitudPorId(id);
        if (!sol) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        return cambiarVac(repo, ctx, sol, 'RECHAZADA', s.clave, { motivoRechazo: String(motivo).trim(), registradaPor: s.clave });
      }
    
      /**
       * RRHH importa el «CIERRE DE VACACIONES» (ya mapeado con Vacaciones.mapearCierre en el navegador).
       * Reemplaza los saldos iniciales; informa egresos (en el cierre pero no activos) e ingresos (activos sin cierre).
       */
      function importarCierreVacaciones(repo, ctx, token, personas) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        if (!Array.isArray(personas) || !personas.length) return err('VALIDACION', 'El archivo no trae personas.');
        var filas = [], claves = {}, porNombre = [], sinIdentificar = [];
        var empleados = repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo' && e.cedulaNumero; });
        personas.forEach(function (p) {
          var c = Empleados.parsearCedula(p.cedula), clave = c.numero ? c.letra + c.numero : '';
          if (!clave) {     // fila del cierre sin cédula: se busca al empleado por su nombre exacto
            var n = Empleados.normalizarNombre(p.nombre);
            var hit = empleados.filter(function (e) { return Empleados.normalizarNombre(e.nombre) === n; });
            if (hit.length !== 1) { if (p.nombre) sinIdentificar.push(p.nombre); return; }
            clave = Empleados.claveCedula(hit[0]); porNombre.push(p.nombre);
          }
          claves[clave] = true;
          (p.periodos || []).forEach(function (x) {
            if (!/^\d{4}-\d{4}$/.test(x.periodo)) return;
            filas.push({ clave: clave, periodo: x.periodo, correspondientes: Number(x.correspondientes) || 0, disfrutadosPrevios: Number(x.disfrutadosPrevios) || 0 });
          });
        });
        repo.guardarVacPeriodos(filas);
        var activos = repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo'; });
        var activosPorClave = {};
        activos.forEach(function (e) { activosPorClave[Empleados.claveCedula(e)] = true; });
        var resumen = {
          personas: Object.keys(claves).length, periodos: filas.length,
          noActivos: Object.keys(claves).filter(function (k) { return !activosPorClave[k]; }).length,
          activosSinCierre: activos.filter(function (e) { return !claves[Empleados.claveCedula(e)]; }).length,
        };
        if (porNombre.length) resumen.porNombre = porNombre;
        if (sinIdentificar.length) resumen.sinIdentificar = sinIdentificar;
        repo.log('VACACIONES_CIERRE_IMPORTADO', s.clave, JSON.stringify(resumen));
        return ok(resumen);
      }
    
      /** RRHH consulta el saldo de un empleado. */
      function saldoVacacionesEmpleado(repo, ctx, token, clave) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var emp = repo.empleadoPorClave(clave);
        if (!emp) return err('NO_ENCONTRADO', 'No encontramos ese empleado.');
        var c = contextoVac(repo, ctx, emp);
        return ok({ nombre: emp.nombre, saldo: c.saldo });
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
        // Filas sin cédula válida no se importan (no podrían entrar ni ser jefes): se informan.
        var sinCedula = [];
        filas = filas.filter(function (f) {
          var c = Empleados.parsearCedula(f.cedula), valida = c.numero && c.numero.length >= 5;
          if (!valida) sinCedula.push(String(f.nombre || '').trim() || '(sin nombre)');
          return valida;
        });
        if (!filas.length) return err('VALIDACION', 'Ninguna fila trae una cédula válida.');
        var r = Empleados.fusionarDetalle(repo.todosEmpleados(), filas);
        var jefes = asignarJefesDelDetalle(r.empleados, filas, usuariosNoEmpleados(repo, r.empleados));
        repo.guardarEmpleados(r.empleados);
        var revisar = r.empleados.filter(function (e) { return e.revisarCedula && e.estado !== 'Inactivo'; })
          .map(function (e) { return { clave: Empleados.claveCedula(e), nombre: e.nombre, motivo: e.motivoRevision }; });
        var sinFecha = r.empleados.filter(function (e) { return !e.fechaIngreso && e.estado !== 'Inactivo'; }).length;
        repo.log('EMPLEADOS_CARGADOS', s.clave, JSON.stringify(r.resumen));
        return ok({ resumen: r.resumen, total: r.empleados.length, revisar: revisar, sinFecha: sinFecha, jefes: jefes, sinCedula: sinCedula });
      }
    
      /** opciones: { buscar, departamento, sinJefe } */
      /**
       * Columna «JEFE DIRECTO» del detalle (nombre del jefe): se busca entre los empleados y se asigna.
       * Si el archivo no trae la columna, o el jefe de una persona no se encuentra, se conserva el jefe que ya tenía.
       * Devuelve { traeColumna, asignados, sinJefeEnArchivo, noEncontrados: [{ jefe, personas, tipo }] }.
       */
      function asignarJefesDelDetalle(empleados, filas, usuarios) {
        var traeColumna = filas.some(function (f) { return f.jefeNombre; });
        var res = { traeColumna: traeColumna, asignados: 0, sinJefeEnArchivo: 0, noEncontrados: [] };
        if (!traeColumna) return res;
        var porClave = {}, cache = {}, faltan = {};
        empleados.forEach(function (e) { porClave[Empleados.claveCedula(e)] = e; });
        filas.forEach(function (f) {
          var c = Empleados.parsearCedula(f.cedula), e = porClave[c.letra + c.numero];
          if (!e) return;
          if (!f.jefeNombre) { res.sinJefeEnArchivo++; return; }
          var j = cache[f.jefeNombre] || (cache[f.jefeNombre] = Empleados.resolverJefe(f.jefeNombre, empleados, usuarios));
          var clave = Empleados.claveCedula(e);
          if (!j.clave || j.clave === clave || Empleados.creaCicloDeJefes(empleados, clave, j.clave)) {
            var k = Empleados.normalizarNombre(f.jefeNombre);
            (faltan[k] = faltan[k] || { jefe: f.jefeNombre, personas: 0, tipo: j.clave ? 'ciclo' : j.tipo }).personas++;
            return;
          }
          e.jefe = j.clave; res.asignados++;
        });
        res.noEncontrados = Object.keys(faltan).map(function (k) { return faltan[k]; }).sort(function (a, b) { return b.personas - a.personas; });
        return res;
      }
    
      /** Usuarios de RRHH que no son empleados (p. ej. la CEO): pueden ser jefes. → [{ clave:'V123', nombre }] */
      function usuariosNoEmpleados(repo, empleados) {
        var claves = {};
        (empleados || repo.todosEmpleados()).forEach(function (e) { if (e.estado !== 'Inactivo') claves[e.cedulaNumero] = true; });
        return repo.todosUsuarios().filter(function (u) { return !claves[u.cedula] && u.nombre; })
          .map(function (u) { return { clave: 'V' + u.cedula, nombre: u.nombre }; });
      }
    
      /** Claves con las que una sesión puede figurar como jefe (las de RRHH guardan solo los dígitos). */
      function clavesDeJefe(s) { return s.rol === 'TRABAJADOR' ? [s.clave] : ['V' + s.clave, 'E' + s.clave]; }
    
      /** RRHH agrega o corrige un empleado que no está en la nómina. */
      function guardarEmpleadoFueraNomina(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var r = Empleados.empleadoFueraDeNomina(datos || {});
        if (r.errores) return err('VALIDACION', r.errores.join(' '));
        var lista = repo.todosEmpleados(), clave = Empleados.claveCedula(r.empleado);
        var actual = lista.filter(function (e) { return Empleados.claveCedula(e) === clave; })[0];
        if (actual && !actual.fueraNomina && actual.estado !== 'Inactivo') return err('VALIDACION', 'Esa cédula ya está en la nómina (Detalle de Empleado).');
        if (actual) { r.empleado.jefe = actual.jefe || ''; Object.assign(actual, r.empleado); } else lista.push(r.empleado);
        repo.guardarEmpleados(lista);
        repo.log('EMPLEADO_FUERA_NOMINA', s.clave, clave + ' · ' + r.empleado.nombre);
        return ok({ clave: clave, nombre: r.empleado.nombre });
      }
    
      function desactivarEmpleadoFueraNomina(repo, ctx, token, clave) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var lista = repo.todosEmpleados(), e = lista.filter(function (x) { return Empleados.claveCedula(x) === clave; })[0];
        if (!e || !e.fueraNomina) return err('VALIDACION', 'Solo se pueden desactivar aquí los empleados fuera de nómina.');
        e.estado = 'Inactivo';
        repo.guardarEmpleados(lista);
        repo.log('EMPLEADO_FUERA_NOMINA_INACTIVO', s.clave, clave);
        return ok({ clave: clave });
      }
    
      /** Para elegir jefe: usuarios de RRHH que no son empleados. */
      function listarUsuariosJefes(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        return ok(usuariosNoEmpleados(repo));
      }
    
      function listarEmpleados(repo, ctx, token, opciones) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        if (typeof opciones === 'string') opciones = { buscar: opciones };
        opciones = opciones || {};
        var q = Empleados.normalizarNombre(opciones.buscar || '');
        var todos = repo.todosEmpleados(), porClave = {};
        todos.forEach(function (e) { porClave[Empleados.claveCedula(e)] = e; });
        usuariosNoEmpleados(repo, todos).forEach(function (u) { if (!porClave[u.clave]) porClave[u.clave] = { nombre: u.nombre }; });
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
              jefe: e.jefe || '', jefeNombre: j ? j.nombre : '', fueraNomina: !!e.fueraNomina, genero: e.genero || '',
              salarioMensual: e.fueraNomina ? e.salarioMensual : undefined,   // solo para editar a los de fuera de nómina
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
          var esUsuario = usuariosNoEmpleados(repo, lista).some(function (u) { return u.clave === jefeClave; });
          if (!esUsuario && (!j || j.estado === 'Inactivo')) return err('VALIDACION', 'El jefe debe ser un empleado activo o un usuario de RRHH.');
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
        return { id: a.id, monto: a.monto, motivo: a.motivo, detalle: a.detalle, estado: a.estado, creada: a.creada, motivoRechazo: a.motivoRechazo || '',
          ventana: a.ventana || '', ventanaEtiqueta: Prestaciones.etiquetaVentana(a.ventana) };
      }
    
      function parametrosPrestaciones(p) {
        return p && p.porcentajeAnticipoMax != null ? { porcentajeAnticipoMax: Number(p.porcentajeAnticipoMax) } : {};
      }
    
      var api = {
        iniciarSesion: iniciarSesion, iniciarSesionAdmin: iniciarSesionAdmin,
        miEstadoDeCuenta: miEstadoDeCuenta, solicitarAnticipo: solicitarAnticipo, cancelarAnticipo: cancelarAnticipo,
        datosAnticipo: datosAnticipo, rechazarAnticipoBanco: rechazarAnticipoBanco,
        bandejaAnticipos: bandejaAnticipos, decidirAnticipo: decidirAnticipo,
        generarArchivoAnticipos: generarArchivoAnticipos, marcarAnticiposPagados: marcarAnticiposPagados,
        cambiarEstadoCierre: cambiarEstadoCierre, leerToken: leerToken,
        datosVacaciones: datosVacaciones, solicitarVacaciones: solicitarVacaciones, cancelarVacaciones: cancelarVacaciones,
        equipoVacaciones: equipoVacaciones, decidirVacacionesJefe: decidirVacacionesJefe, bandejaVacaciones: bandejaVacaciones,
        registrarVacaciones: registrarVacaciones, rechazarVacacionesRRHH: rechazarVacacionesRRHH,
        importarCierreVacaciones: importarCierreVacaciones, saldoVacacionesEmpleado: saldoVacacionesEmpleado,
        emitirConstancia: emitirConstancia, misConstancias: misConstancias, verificarConstancia: verificarConstancia,
        listarConstancias: listarConstancias, anularConstancia: anularConstancia,
        cargarEmpleados: cargarEmpleados, listarEmpleados: listarEmpleados, guardarEmpleadoFueraNomina: guardarEmpleadoFueraNomina,
        desactivarEmpleadoFueraNomina: desactivarEmpleadoFueraNomina, listarUsuariosJefes: listarUsuariosJefes, asignarJefe: asignarJefe, asignarJefeDepartamento: asignarJefeDepartamento, fijarEmpresaFideicomiso: fijarEmpresaFideicomiso,
      };
      if (typeof module !== 'undefined' && module.exports) module.exports = api;
      else raiz.Servicio = api;
    })(typeof globalThis !== 'undefined' ? globalThis : this);
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Servicio: ' + (e && e.message)); return undefined; }
})();

// ===== src/api.gs =====
/* ==========================================================
   API de RRHH (Google Apps Script). Recibe POST de texto plano
   con JSON { action, ... } y responde JSON { ok, data | code, message }.
   Toda la lógica está en core/servicio.js; aquí solo se leen
   y escriben las hojas.
   ========================================================== */

// Cambia este número cuando publiques una versión nueva; así se comprueba desde el navegador cuál está activa.
var VERSION = '2026-10-30.9';
var AVISO_CODIGO = 'El proyecto de Apps Script no tiene el código completo. Copia el archivo apps-script/RRHH.gs del repositorio (más de 80 KB y 1.500 líneas; no uses src/api.gs), pégalo como único archivo y publica una nueva versión.';
var MODULOS = ['Calculo', 'Empleados', 'Prestaciones', 'Exportes', 'Constancia', 'Vacaciones', 'Servicio'];

/** Qué módulos están cargados (se nombran uno a uno: no se busca por texto en el global). */
function modulosCargados_() {
  return {
    Calculo: typeof Calculo !== 'undefined' && !!Calculo, Empleados: typeof Empleados !== 'undefined' && !!Empleados,
    Prestaciones: typeof Prestaciones !== 'undefined' && !!Prestaciones, Exportes: typeof Exportes !== 'undefined' && !!Exportes,
    Constancia: typeof Constancia !== 'undefined' && !!Constancia, Vacaciones: typeof Vacaciones !== 'undefined' && !!Vacaciones,
    Servicio: typeof Servicio !== 'undefined' && !!Servicio,
  };
}

var HOJAS = {
  PARAMETROS: ['clave', 'valor'],
  EMPRESAS: ['empresa', 'fideicomiso', 'tipoTAporte', 'tipoTAnticipo', 'forma'],
  EMPLEADOS: ['cedulaLetra', 'cedulaNumero', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'empresaFideicomiso', 'revisarCedula', 'editados', 'motivoRevision', 'jefe', 'salarioMensual', 'genero', 'fueraNomina'],
  APORTES: ['clave', 'anio', 'trimestre', 'empresa', 'total', 'monto', 'meses', 'diasAdicionales', 'adicionalesForzados', 'nuevo'],
  CIERRES: ['anio', 'trimestre', 'empresa', 'estado', 'por', 'actualizado'],
  ANTICIPOS: ['id', 'clave', 'monto', 'motivo', 'detalle', 'estado', 'creada', 'actualizada', 'decididaPor', 'motivoRechazo', 'ventana', 'acepto'],
  CONSTANCIAS: ['id', 'clave', 'nombre', 'cedula', 'empresa', 'cargo', 'organizacion', 'fechaIngreso', 'salario', 'emision', 'vence', 'estado', 'emitidaPor'],
  FERIADOS: ['fecha', 'motivo'],
  VAC_PERIODOS: ['clave', 'periodo', 'correspondientes', 'disfrutadosPrevios'],
  VAC_SOLICITUDES: ['id', 'clave', 'inicio', 'culminacion', 'reintegro', 'dias', 'condicion', 'imputacion', 'estado', 'jefe', 'creada', 'actualizada',
    'decididaJefePor', 'decisionJefe', 'registradaPor', 'registrada', 'nomina', 'motivoRechazo', 'numeroConstancia', 'pendientesDespues'],
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
  { cedula: '6291577', nombre: 'JOHANNA RODRIGUEZ', rol: 'ADMIN' },   // CEO: no es empleada; es jefa de varios
];

/**
 * Empleados activos que no están en la nómina (no vienen en el Detalle de Empleado). Se crean al configurar si no existen;
 * después se editan en el sitio (Empleados → «Fuera de nómina»). Datos del cierre de vacaciones.
 */
var EMPLEADOS_FUERA_NOMINA_INICIALES = [
  { cedula: 'V085423904', nombre: 'MARIA TERESA CENCI', empresa: 'AIV', fechaIngreso: '08/10/1987' },
  { cedula: 'E810535060', nombre: 'DANILO KOENIG', empresa: 'PCA', fechaIngreso: '09/09/2008' },
];

// Feriados nacionales 2026 (lista de RRHH, corregida: 12 de octubre en vez de 10/12; se agregan 5 y 24 de julio).
var FERIADOS_INICIALES = [
  ['2026-01-01', 'Año Nuevo'], ['2026-02-16', 'Lunes de Carnaval'], ['2026-02-17', 'Martes de Carnaval'], ['2026-04-02', 'Jueves Santo'],
  ['2026-04-03', 'Viernes Santo'], ['2026-04-19', 'Declaración de la Independencia'], ['2026-05-01', 'Día del Trabajador'],
  ['2026-06-24', 'Batalla de Carabobo'], ['2026-07-05', 'Día de la Independencia'], ['2026-07-24', 'Natalicio del Libertador'],
  ['2026-10-12', 'Día de la Resistencia Indígena'], ['2026-12-24', 'Víspera de Navidad'], ['2026-12-25', 'Navidad'],
  ['2026-12-31', 'Fin de Año'], ['2027-01-01', 'Año Nuevo'],
];

var RUTAS_TRABAJADOR = {
  datosAnticipo: function (repo, ctx, d) { return Servicio.datosAnticipo(repo, ctx, d.token); },
  datosVacaciones: function (repo, ctx, d) { return Servicio.datosVacaciones(repo, ctx, d.token); },
  solicitarVacaciones: function (repo, ctx, d) { return Servicio.solicitarVacaciones(repo, ctx, d.token, d); },
  cancelarVacaciones: function (repo, ctx, d) { return Servicio.cancelarVacaciones(repo, ctx, d.token, d.id); },
  equipoVacaciones: function (repo, ctx, d) { return Servicio.equipoVacaciones(repo, ctx, d.token); },
  decidirVacacionesJefe: function (repo, ctx, d) { return Servicio.decidirVacacionesJefe(repo, ctx, d.token, d.id, !!d.aprobar, d.motivo); },
  emitirConstancia: function (repo, ctx, d) { return Servicio.emitirConstancia(repo, ctx, d.token); },
  misConstancias: function (repo, ctx, d) { return Servicio.misConstancias(repo, ctx, d.token); },
  verificarConstancia: function (repo, ctx, d) { return Servicio.verificarConstancia(repo, ctx, d.id); },   // pública (QR)
  login: function (repo, ctx, d) { return Servicio.iniciarSesion(repo, ctx, d.cedula); },
  estadoDeCuenta: function (repo, ctx, d) { return Servicio.miEstadoDeCuenta(repo, ctx, d.token); },
  solicitarAnticipo: function (repo, ctx, d) { return Servicio.solicitarAnticipo(repo, ctx, d.token, d); },
  cancelarAnticipo: function (repo, ctx, d) { return Servicio.cancelarAnticipo(repo, ctx, d.token, d.id); },
};

var RUTAS_RRHH = {
  guardarEmpleadoFueraNomina: function (repo, ctx, d) { return Servicio.guardarEmpleadoFueraNomina(repo, ctx, d.token, d); },
  desactivarEmpleadoFueraNomina: function (repo, ctx, d) { return Servicio.desactivarEmpleadoFueraNomina(repo, ctx, d.token, d.clave); },
  listarUsuariosJefes: function (repo, ctx, d) { return Servicio.listarUsuariosJefes(repo, ctx, d.token); },
  rechazarAnticipoBanco: function (repo, ctx, d) { return Servicio.rechazarAnticipoBanco(repo, ctx, d.token, d.id, d.motivo); },
  bandejaVacaciones: function (repo, ctx, d) { return Servicio.bandejaVacaciones(repo, ctx, d.token, d.estado); },
  registrarVacaciones: function (repo, ctx, d) { return Servicio.registrarVacaciones(repo, ctx, d.token, d.id, d.nomina); },
  rechazarVacacionesRRHH: function (repo, ctx, d) { return Servicio.rechazarVacacionesRRHH(repo, ctx, d.token, d.id, d.motivo); },
  importarCierreVacaciones: function (repo, ctx, d) { return Servicio.importarCierreVacaciones(repo, ctx, d.token, d.personas); },
  saldoVacacionesEmpleado: function (repo, ctx, d) { return Servicio.saldoVacacionesEmpleado(repo, ctx, d.token, d.clave); },
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

/**
 * Acciones que solo leen: no esperan el bloqueo (varias personas consultan a la vez sin hacer fila).
 * Las que escriben se hacen de una en una para no pisarse.
 */
var LECTURAS = {
  login: 1, loginAdmin: 1, estadoDeCuenta: 1, datosAnticipo: 1, misConstancias: 1, verificarConstancia: 1, datosVacaciones: 1, equipoVacaciones: 1,
  bandejaAnticipos: 1, bandejaVacaciones: 1, listarEmpleados: 1, listarConstancias: 1, listarUsuariosJefes: 1, saldoVacacionesEmpleado: 1,
};

function doPost(e) {
  var lock = LockService.getScriptLock(), bloqueado = false;
  memo_ = {}; constanciasCache = null;   // en Google cada petición empieza de cero; así también en el simulador
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!LECTURAS[d.action]) { lock.waitLock(20000); bloqueado = true; }
    // Filtro básico: el sitio envía este token. No es un secreto (va en config.js), solo frena visitas al azar.
    var esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (esperado && d.api_token !== esperado) return salida_({ ok: false, code: 'TOKEN', message: 'Acceso no autorizado.' });
    var cargados = modulosCargados_(), sinCargar = MODULOS.filter(function (k) { return !cargados[k]; });
    if (sinCargar.length) throw new Error('Falta código en Apps Script (' + sinCargar.join(', ') + '). ' + AVISO_CODIGO);
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
      : sinCodigo ? 'Falta código en Apps Script (' + err.message + '). ' + AVISO_CODIGO
      : 'Error del servidor. Intenta de nuevo.' });
  } finally {
    if (bloqueado) try { lock.releaseLock(); } catch (x) { /* sin bloqueo */ }
  }
}

/** Abrir la URL /exec en el navegador muestra qué versión está publicada y si todos los módulos cargaron. */
function doGet() {
  var m = modulosCargados_(), completo = MODULOS.every(function (k) { return m[k]; });
  var erroresCarga = typeof ERRORES_CARGA !== 'undefined' ? ERRORES_CARGA : ['Este no es el archivo RRHH.gs: falta el código de los módulos'];
  return salida_({ ok: true, data: 'API de RRHH activa', version: VERSION, modulosCompletos: completo, modulos: m, erroresCarga: erroresCarga, aviso: completo ? '' : AVISO_CODIGO });
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

/* ---------- Lecturas rápidas ----------
 * 1) Memoria por petición: cada hoja se lee una sola vez aunque el código la pida varias veces.
 * 2) Caché de Google (CacheService, hasta 6 h) para las hojas que cambian poco. Se borra al escribir en ellas
 *    desde el sistema, al editarlas a mano (onEdit) y con el menú RRHH → «Refrescar datos».
 */
var CACHEABLES = { EMPLEADOS: 1, USUARIOS: 1, PARAMETROS: 1, FERIADOS: 1, EMPRESAS: 1, VAC_PERIODOS: 1 };
var CACHE_SEGUNDOS = 21600, CACHE_TROZO = 90000;
var memo_ = {};

function valores_(nombre) {
  if (memo_[nombre]) return memo_[nombre];
  var vals = CACHEABLES[nombre] ? leerCache_(nombre) : null;
  if (!vals) {
    vals = hoja_(nombre).getDataRange().getValues();
    if (CACHEABLES[nombre]) guardarCache_(nombre, vals);
  }
  return (memo_[nombre] = vals);
}

function leerCache_(nombre) {
  try {
    var c = CacheService.getScriptCache(), partes = Number(c.get('hoja:' + nombre + ':partes'));
    if (!partes) return null;
    var txt = '';
    for (var i = 0; i < partes; i++) { var p = c.get('hoja:' + nombre + ':' + i); if (p == null) return null; txt += p; }
    return JSON.parse(txt);
  } catch (e) { return null; }
}

function guardarCache_(nombre, vals) {
  try {
    var txt = JSON.stringify(vals, function (k, v) {
      var o = this[k];
      return o instanceof Date ? Utilities.formatDate(o, 'America/Caracas', "yyyy-MM-dd'T'HH:mm:ss") : v;
    });
    if (txt.length > CACHE_TROZO * 50) return;   // demasiado grande: se lee siempre de la hoja
    var c = CacheService.getScriptCache(), n = Math.ceil(txt.length / CACHE_TROZO) || 1;
    for (var i = 0; i < n; i++) c.put('hoja:' + nombre + ':' + i, txt.slice(i * CACHE_TROZO, (i + 1) * CACHE_TROZO), CACHE_SEGUNDOS);
    c.put('hoja:' + nombre + ':partes', String(n), CACHE_SEGUNDOS);
  } catch (e) { /* sin caché: no pasa nada, se lee de la hoja */ }
}

function invalidar_(nombre) {
  delete memo_[nombre];
  if (CACHEABLES[nombre]) try { CacheService.getScriptCache().remove('hoja:' + nombre + ':partes'); } catch (e) { /* sin caché */ }
}

function invalidarTodo_() { Object.keys(HOJAS).forEach(invalidar_); memo_ = {}; }

/** Al editar la hoja a mano, el sistema deja de usar la copia guardada de esa pestaña. */
function onEdit(e) {
  try { invalidar_(e.range.getSheet().getName()); } catch (x) { /* sin evento */ }
}

/** Menú RRHH → «Refrescar datos»: por si se cambió la hoja de otra forma (por ejemplo, pegando datos desde otro archivo). */
function refrescarDatos() {
  invalidarTodo_();
  SpreadsheetApp.getUi().alert('Listo', 'El sistema volverá a leer todas las hojas.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function leer_(nombre) {
  var vals = valores_(nombre);
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
  invalidar_(nombre);
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
    salarioMensual: Empleados.numeroDeMonto(f.salarioMensual), genero: texto_(f.genero),
    fueraNomina: f.fueraNomina === true || f.fueraNomina === 'TRUE' || f.fueraNomina === 'true', jefe: texto_(f.jefe), editados: editados, nombreNorm: Empleados.normalizarNombre(f.nombre),
  };
}

function fechaTexto_(f) {
  return f ? ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y : '';
}

function anticipo_(f) {
  return {
    _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), monto: Number(f.monto), motivo: texto_(f.motivo),
    detalle: texto_(f.detalle), estado: texto_(f.estado), creada: Number(f.creada) || 0, actualizada: Number(f.actualizada) || 0,
    decididaPor: texto_(f.decididaPor), motivoRechazo: texto_(f.motivoRechazo), ventana: texto_(f.ventana), acepto: Number(f.acepto) || 0,
  };
}

/** Fecha de la hoja (Date o texto) → 'AAAA-MM-DD' en hora de Caracas. */
function fechaIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Caracas', 'yyyy-MM-dd');
  var t = texto_(v).trim(), m;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return t.slice(0, 10);
}

function vacSolicitud_(f) {
  var imp = [], pend = null;
  try { imp = f.imputacion ? JSON.parse(f.imputacion) : []; } catch (e) { /* vacía */ }
  try { pend = f.pendientesDespues ? JSON.parse(f.pendientesDespues) : null; } catch (e) { /* vacío */ }
  return {
    _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), inicio: fechaIso_(f.inicio), culminacion: fechaIso_(f.culminacion),
    reintegro: fechaIso_(f.reintegro), dias: Number(f.dias) || 0, condicion: texto_(f.condicion), imputacion: imp, estado: texto_(f.estado),
    jefe: texto_(f.jefe), creada: Number(f.creada) || 0, actualizada: Number(f.actualizada) || 0, decididaJefePor: texto_(f.decididaJefePor),
    decisionJefe: Number(f.decisionJefe) || 0, registradaPor: texto_(f.registradaPor), registrada: Number(f.registrada) || 0,
    nomina: texto_(f.nomina), motivoRechazo: texto_(f.motivoRechazo), numeroConstancia: texto_(f.numeroConstancia), pendientesDespues: pend,
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
    feriados: function () { return leer_('FERIADOS').map(function (f) { return fechaIso_(f.fecha); }).filter(function (f) { return /^\d{4}-\d{2}-\d{2}$/.test(f); }); },
    vacPeriodosDe: function (clave) {
      return leer_('VAC_PERIODOS').filter(function (f) { return texto_(f.clave) === clave; }).map(function (f) {
        return { periodo: texto_(f.periodo), correspondientes: Number(f.correspondientes) || 0, disfrutadosPrevios: Number(f.disfrutadosPrevios) || 0 };
      });
    },
    vacClavesConPeriodos: function () {
      var v = {}; leer_('VAC_PERIODOS').forEach(function (f) { v[texto_(f.clave)] = true; }); return Object.keys(v);
    },
    /** Reemplaza toda la hoja VAC_PERIODOS de una vez (importación del cierre). */
    guardarVacPeriodos: function (filas) {
      var h = hoja_('VAC_PERIODOS'), cab = HOJAS.VAC_PERIODOS, ultima = h.getLastRow();
      if (ultima > 1) h.getRange(2, 1, ultima - 1, cab.length).clearContent();
      invalidar_('VAC_PERIODOS');
      if (!filas.length) return;
      var r = h.getRange(2, 1, filas.length, cab.length);
      h.getRange(2, 1, filas.length, 2).setNumberFormat('@');
      r.setValues(filas.map(function (f) { return [f.clave, f.periodo, f.correspondientes, f.disfrutadosPrevios]; }));
      invalidar_('VAC_PERIODOS');
    },
    vacSolicitudesDe: function (clave) { return leer_('VAC_SOLICITUDES').map(vacSolicitud_).filter(function (s) { return s.clave === clave; }); },
    vacSolicitudesPorJefe: function (clave) { return leer_('VAC_SOLICITUDES').map(vacSolicitud_).filter(function (s) { return s.jefe === clave; }); },
    vacSolicitudesPorEstado: function (estado) { return leer_('VAC_SOLICITUDES').map(vacSolicitud_).filter(function (s) { return s.estado === estado; }); },
    vacSolicitudPorId: function (id) { return leer_('VAC_SOLICITUDES').map(vacSolicitud_).filter(function (s) { return s.id === id; })[0] || null; },
    guardarVacSolicitud: function (s) {
      var copia = Object.assign({}, s, { imputacion: JSON.stringify(s.imputacion || []), pendientesDespues: s.pendientesDespues ? JSON.stringify(s.pendientesDespues) : '' });
      if (!copia._fila) {
        var h = hoja_('VAC_SOLICITUDES');
        h.getRange(h.getLastRow() + 1, 1, 1, 6).setNumberFormat('@');   // id, clave y fechas como texto
        h.getRange(h.getLastRow() + 1, HOJAS.VAC_SOLICITUDES.indexOf('numeroConstancia') + 1).setNumberFormat('@');
      }
      escribirFila_('VAC_SOLICITUDES', copia);
      s._fila = copia._fila;
    },
    nuevoIdVac: function () { return 'VAC-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },
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
      invalidar_('EMPLEADOS');
      if (!lista.length) return;
      var filas = lista.map(function (e) {
        return [e.cedulaLetra, String(e.cedulaNumero), e.nombre, e.organizacion, e.departamento, e.puesto, e.estado, fechaTexto_(e.fechaIngreso),
          e.empresaDetalle, e.empresaFideicomiso || '', !!e.revisarCedula, JSON.stringify(e.editados || []), e.motivoRevision || '', e.jefe || '', e.salarioMensual == null ? '' : e.salarioMensual, e.genero || '', !!e.fueraNomina];
      });
      var rango = h.getRange(2, 1, filas.length, cab.length);
      rango.setNumberFormat('@');   // cédulas y fechas como texto: Sheets no les quita ceros ni las convierte
      rango.setValues(filas);
      invalidar_('EMPLEADOS');
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
    todosUsuarios: function () {
      return leer_('USUARIOS').map(function (u) { return { cedula: texto_(u.cedula), nombre: texto_(u.nombre), rol: texto_(u.rol) }; });
    },
    usuario: function (cedula) {
      var f = leer_('USUARIOS').filter(function (u) { return texto_(u.cedula) === cedula; })[0];
      return f ? { sal: texto_(f.sal), hash: texto_(f.hash), rol: texto_(f.rol), nombre: texto_(f.nombre) } : null;
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
  invalidarTodo_();
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
  [['firmaNombre', 'Lic. Luis Paul Rojas'], ['firmaCargo', 'Gerente de Gestión Humana'], ['firmaTelefono', '(0412) 205.11.60.'], ['ciudad', 'Caracas'], ['constanciasMaxPorMes', 5],
   ['vacAnticipacionMin', 15], ['vacAnticipacionMax', 20]]
    .forEach(function (f) { if (!existentes[f[0]]) hp.appendRow(f); });
  sem('EMPRESAS', [['PCA', 5847, 1, 5, 'A'], ['AIV', 5847, 1, 5, 'A']]);
  // Feriados iniciales (solo si la hoja está vacía; después RRHH la edita)
  var hf = ss.getSheetByName('FERIADOS');
  if (hf.getLastRow() <= 1) {
    hf.getRange(2, 1, FERIADOS_INICIALES.length, 1).setNumberFormat('@');
    hf.getRange(2, 1, FERIADOS_INICIALES.length, 2).setValues(FERIADOS_INICIALES);
  }
  // Empleados fuera de nómina iniciales (si los módulos están cargados)
  if (typeof Empleados !== 'undefined' && Empleados) {
    var repo = crearRepo_(), lista = repo.todosEmpleados(), hay = {}, nuevos = 0;
    lista.forEach(function (e) { hay[Empleados.claveCedula(e)] = true; });
    EMPLEADOS_FUERA_NOMINA_INICIALES.forEach(function (d) {
      var r = Empleados.empleadoFueraDeNomina(d);
      if (r.empleado && !hay[Empleados.claveCedula(r.empleado)]) { lista.push(r.empleado); nuevos++; }
    });
    if (nuevos) repo.guardarEmpleados(lista);
  }
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
  invalidarTodo_();
}

/* ---------- Menú «RRHH» dentro de la hoja ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RRHH')
    .addItem('1 · Configurar hojas y usuarios', 'configurarInicial')
    .addItem('2 · Poner o cambiar clave de RRHH', 'ponerClaveRRHH')
    .addItem('Refrescar datos', 'refrescarDatos')
    .addItem('Diagnóstico', 'diagnostico')
    .addToUi();
}

/** Avisa con claridad si falta pegar algún archivo del sistema (en vez de un error técnico). */
function requerirModulos_() {
  var m = modulosCargados_(), faltan = MODULOS.filter(function (k) { return !m[k]; });
  if (faltan.length) {
    SpreadsheetApp.getUi().alert('Falta código en Apps Script',
      'No se encontró: ' + faltan.join(', ') + '.\n\n' + AVISO_CODIGO,
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
    if (!emp) {   // no es empleado (p. ej. la CEO): su nombre sirve para mostrarlo y para encontrarlo como jefe en el detalle
      var nn = ui.prompt('Nombre', 'Nombre y apellido de la persona (como aparece en la columna JEFE DIRECTO):', ui.ButtonSet.OK_CANCEL);
      if (nn.getSelectedButton() !== ui.Button.OK || !nn.getResponseText().trim()) return;
      quien = nn.getResponseText().trim().replace(/\s+/g, ' ').toUpperCase();
    }
  } else if (ui.alert('Confirmar', quien + '\nCédula ' + cedula + ' · ' + rol + '\n\n¿Poner o cambiar su clave?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var k = ui.prompt('Clave', 'Clave de ' + quien + ' (mínimo 8 caracteres). Se pedirá cada vez que entre:', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  var clave = k.getResponseText();
  if (clave.length < 8) { ui.alert('La clave debe tener al menos 8 caracteres.'); return; }
  guardarUsuario_(cedula, clave, rol, (existente && texto_(existente.nombre)) || (emp && emp.nombre) || (/^\(/.test(quien) ? '' : quien));
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
