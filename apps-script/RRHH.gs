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
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
        motivos: ['Vivienda', 'Salud', 'Educación'],
      };
    
      /** Ciclo de vida de un cierre trimestral por empresa. */
      var ESTADOS_CIERRE = ['ABIERTO', 'CERRADO', 'ACREDITADO'];
      var SIGUIENTE_CIERRE = { ABIERTO: ['CERRADO'], CERRADO: ['ACREDITADO', 'ABIERTO'], ACREDITADO: [] };
    
      /** Ciclo de vida de una solicitud de anticipo. */
      var SIGUIENTE_SOLICITUD = {
        PENDIENTE: ['EN_ARCHIVO', 'APROBADA', 'RECHAZADA', 'CANCELADA'],   // sin aprobación: RRHH la incluye directo en el archivo del banco
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
        return { ok: e.length === 0, errores: e };
      }
    
      /* ---------- Aperturas de solicitudes (las abre RRHH con fecha de inicio y final) ----------
       * El colaborador no ve su saldo en el sistema: lo revisa en su banco. Cada apertura corresponde a un trimestre
       * (por ejemplo, del 05/01/2027 al 16/01/2027 por el 4.º trimestre de 2026) y admite UNA solicitud por persona.
       * Fechas como texto 'AAAA-MM-DD'. Una apertura: { id, clave:'2026-T4', inicio, fin }.
       */
    
      var ORDINAL = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º' };
    
      /** '2026-T4' → '4.º trimestre de 2026' */
      function etiquetaVentana(clave) {
        var m = /^(\d{4})-T([1-4])$/.exec(String(clave || ''));
        return m ? ORDINAL[m[2]] + ' trimestre de ' + m[1] : '';
      }
    
      function estadoApertura(c, hoy) { return hoy < c.inicio ? 'PROXIMA' : hoy > c.fin ? 'CERRADA' : 'ABIERTA'; }
    
      /** La apertura vigente hoy (o null) y la próxima programada (o null). */
      function aperturas(lista, hoy) {
        var orden = (lista || []).slice().sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
        return {
          activa: orden.filter(function (c) { return estadoApertura(c, hoy) === 'ABIERTA'; }).pop() || null,
          proxima: orden.filter(function (c) { return estadoApertura(c, hoy) === 'PROXIMA'; })[0] || null,
        };
      }
    
      /** Valida una apertura nueva o editada contra las existentes: fechas, trimestre único y sin cruces. */
      function validarApertura(c, lista) {
        var e = [], re = /^\d{4}-\d{2}-\d{2}$/;
        if (!etiquetaVentana(c.clave)) e.push('Elige el trimestre.');
        if (!re.test(c.inicio || '') || !re.test(c.fin || '')) e.push('Indica la fecha de inicio y la fecha final.');
        else if (c.fin < c.inicio) e.push('La fecha final no puede ser anterior a la de inicio.');
        if (e.length) return { ok: false, errores: e };
        (lista || []).forEach(function (o) {
          if (o.id === c.id) return;
          if (o.clave === c.clave) e.push('Ya hay una apertura para el ' + etiquetaVentana(c.clave) + '.');
          else if (!(c.fin < o.inicio || c.inicio > o.fin)) e.push('Se cruza con la apertura del ' + etiquetaVentana(o.clave) + '.');
        });
        return { ok: e.length === 0, errores: e };
      }
    
      /**
       * Solicitud sin saldo en el sistema: monto y motivo, aceptación de responsabilidad, apertura vigente y una por apertura.
       * c: { empleado, previas (anticipos del colaborador), activa, proxima, parametros }
       */
      function validarSolicitudBanco(sol, c) {
        var p = Object.assign({}, PARAMETROS, c.parametros || {}), e = [];
        var luego = c.proxima ? 'La próxima apertura es del ' + corta(c.proxima.inicio) + ' al ' + corta(c.proxima.fin) + '.' : 'Gestión Humana anunciará la próxima apertura.';
        if (!c.activa) return { ok: false, errores: ['La solicitud de anticipos no está abierta en este momento. ' + luego] };
        if (!c.empleado || c.empleado.estado === 'Inactivo') e.push('El empleado no está activo.');
        var monto = Number(sol.monto);
        if (!isFinite(monto) || monto <= 0) e.push('Escribe el monto que quieres solicitar.');
        if (p.motivos.indexOf(sol.motivo) === -1) e.push('Elige el motivo.');
        if (sol.acepta !== true) e.push('Debes confirmar que revisaste tu disponible en el banco y que envías el monto bajo tu responsabilidad.');
        var ya = (c.previas || []).filter(function (a) { return a.ventana === c.activa.clave && a.estado !== 'CANCELADA'; })[0];
        if (ya) e.unshift('Ya enviaste tu solicitud del ' + etiquetaVentana(c.activa.clave) + '. ' + luego);
        return { ok: e.length === 0, errores: e };
      }
    
      function corta(txt) { var x = String(txt).split('-'); return x[2] + '/' + x[1] + '/' + x[0]; }
    
      var api = {
        etiquetaVentana: etiquetaVentana, estadoApertura: estadoApertura, aperturas: aperturas, validarApertura: validarApertura,
        validarSolicitudBanco: validarSolicitudBanco,
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
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    
      /* ---------- Feriados nacionales de Venezuela ---------- */
    
      function dosDigitos(n) { return ('0' + n).slice(-2); }
    
      /** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
      function pascua(y) {
        var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
        var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
        return y + '-' + dosDigitos(Math.floor((h + l - 7 * m + 114) / 31)) + '-' + dosDigitos(((h + l - 7 * m + 114) % 31) + 1);
      }
    
      /**
       * Feriados nacionales de Venezuela de un año (los que usa la empresa: incluye 24 y 31 de diciembre).
       * Fijos más Carnaval (lunes y martes, 48 y 47 días antes de Pascua) y Jueves y Viernes Santo.
       * Si dos caen el mismo día, quedan en una sola fecha con los dos motivos. Devuelve [[fecha, motivo]] en orden.
       */
      function feriadosVenezuela(y) {
        var p = pascua(y), mov = function (n) { return sumarDiasTxt(p, n); };
        var lista = [
          [y + '-01-01', 'Año Nuevo'], [mov(-48), 'Lunes de Carnaval'], [mov(-47), 'Martes de Carnaval'], [mov(-3), 'Jueves Santo'],
          [mov(-2), 'Viernes Santo'], [y + '-04-19', 'Declaración de la Independencia'], [y + '-05-01', 'Día del Trabajador'],
          [y + '-06-24', 'Batalla de Carabobo'], [y + '-07-05', 'Día de la Independencia'], [y + '-07-24', 'Natalicio del Libertador'],
          [y + '-10-12', 'Día de la Resistencia Indígena'], [y + '-12-24', 'Víspera de Navidad'], [y + '-12-25', 'Navidad'], [y + '-12-31', 'Fin de Año'],
        ];
        var porFecha = {};
        lista.forEach(function (f) { porFecha[f[0]] = porFecha[f[0]] ? porFecha[f[0]] + ' y ' + f[1] : f[1]; });
        return Object.keys(porFecha).sort().map(function (k) { return [k, porFecha[k]]; });
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
        serialExcel: serialExcel, numeroConstancia: numeroConstancia, pendientesTras: pendientesTras, pascua: pascua, feriadosVenezuela: feriadosVenezuela,
      };
      if (typeof module !== 'undefined' && module.exports) module.exports = api;
      else raiz.Vacaciones = api;
    })(typeof globalThis !== 'undefined' ? globalThis : this);
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Vacaciones: ' + (e && e.message)); return undefined; }
})();

// ===== core/aportes.js =====
var Aportes = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Aportes: ' + (e && e.message)); return undefined; }
})();

// ===== core/recibos.js =====
var Recibos = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
    /* ==========================================================
       Recibos de pago: leer cada hoja del PDF de nómina (texto ya extraído),
       proponer el concepto y asignar cada hoja a su colaborador.
       Funciones puras: las usan el navegador, Apps Script y las pruebas.
       ========================================================== */
    (function (raiz) {
      'use strict';
    
      function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }
      var isNode = typeof require === 'function' && typeof module !== 'undefined';
      var Empleados = isNode ? require('./empleados.js') : dependencia(raiz, 'Empleados');
    
      var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    
      /** Cédula impresa en la hoja («Cédula … V028180545» o «V-14.891.031»). Devuelve el texto tal cual o ''. */
      function cedulaDeTexto(texto) {
        var t = String(texto || '');
        var tras = /C[ée]dula[\s\S]{0,200}?\b([VE])\s*-?\s*([\d.]{6,12})\b/i.exec(t);
        var m = tras || /\b([VE])\s*-?\s*(\d{6,10})\b/.exec(t);
        return m ? (m[1].toUpperCase() + m[2].replace(/\./g, '')) : '';
      }
    
      /** Nombre del colaborador en la hoja: «Total a Pagar NOMBRE 28.096,05» (formato de la nómina) o la línea bajo «Nombre y Apellido». */
      function nombreDeTexto(texto) {
        var t = String(texto || '').replace(/\s+/g, ' ');
        var m = /Total a Pagar\s+(.+?)\s+-?[\d.]+,\d{2}\b/i.exec(t) || /Nombre y Apellido\s+(?:Departamento\s+)?([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ' ]{3,80}?)\s{1,}(?=[A-ZÁÉÍÓÚ][a-záéíóúñ])/.exec(t);
        return m ? m[1].trim() : '';
      }
    
      /**
       * Concepto propuesto a partir del encabezado «Nómina: Nómina Quincenal - NQ-155 (16/10/2026 - 31/10/2026)».
       * Quincena 1-15 → «1Q», 16-fin → «2Q»; mes completo → solo el mes. Devuelve '' si no lo reconoce.
       */
      function conceptoSugerido(texto) {
        var t = String(texto || '').replace(/\s+/g, ' ');
        var nom = /N[óo]mina:\s*([^()]+?)\s*\((\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\)/i.exec(t);
        if (!nom) return '';
        var nombre = nom[1], d1 = +nom[2], m1 = +nom[3], y1 = +nom[4], d2 = +nom[5], m2 = +nom[6];
        var tipo = /cesta|alimenta/i.test(nombre) ? 'Cestaticket' : /vacaci/i.test(nombre) ? 'Vacaciones' : /utilidad|aguinaldo/i.test(nombre) ? 'Utilidades'
          : /bono/i.test(nombre) ? 'Bono' : 'Nómina';
        if (m1 !== m2) return tipo + ' ' + nom[2] + '/' + nom[3] + ' al ' + nom[5] + '/' + nom[6] + '/' + nom[7];
        var mes = MESES[m1 - 1] + ' ' + y1;
        if (d1 === 1 && d2 <= 15) return tipo + ' 1Q ' + mes;
        if (d1 >= 16) return tipo + ' 2Q ' + mes;
        return tipo + ' ' + mes;
      }
    
      /**
       * Asigna cada hoja a un empleado: 1) por cédula (con o sin dígito verificador); 2) por nombre exacto
       * (sin tildes ni espacios dobles). hojas: [{ pagina, cedula, nombre }]. Devuelve la misma lista con
       * { clave, nombreEmpleado, como: 'cedula' | 'nombre' | '', inactivo, repetida }.
       */
      function asignarHojas(hojas, empleados) {
        var porNumero = {}, porNombre = {};
        (empleados || []).forEach(function (e) {
          if (!e.cedulaNumero) return;
          var n = String(e.cedulaNumero).replace(/^0+/, '');
          if (!porNumero[n] || porNumero[n].estado === 'Inactivo') porNumero[n] = e;
          var k = Empleados.normalizarNombre(e.nombre);
          porNombre[k] = porNombre[k] === undefined ? e : null;   // nombre repetido: no se usa
        });
        var usadas = {};
        return (hojas || []).map(function (h) {
          var r = { pagina: h.pagina, cedula: h.cedula || '', nombre: h.nombre || '', clave: '', nombreEmpleado: '', como: '', inactivo: false, repetida: false };
          var c = Empleados.parsearCedula(h.cedula || '');
          var e = c.numero ? porNumero[c.numero] : null;
          if (!e && h.cedula) {
            var d = String(h.cedula).replace(/\D/g, '');
            if (d.length === 8) e = porNumero[d.slice(0, 7).replace(/^0+/, '')] || null;   // cédula de 7 dígitos con verificador
          }
          if (e) r.como = 'cedula';
          else if (h.nombre && porNombre[Empleados.normalizarNombre(h.nombre)]) { e = porNombre[Empleados.normalizarNombre(h.nombre)]; r.como = 'nombre'; }
          if (e) {
            r.clave = Empleados.claveCedula(e); r.nombreEmpleado = e.nombre; r.inactivo = e.estado === 'Inactivo';
            if (usadas[r.clave]) r.repetida = true;
            usadas[r.clave] = true;
          }
          return r;
        });
      }
    
      var api = { cedulaDeTexto: cedulaDeTexto, nombreDeTexto: nombreDeTexto, conceptoSugerido: conceptoSugerido, asignarHojas: asignarHojas, MESES: MESES };
      if (typeof module !== 'undefined' && module.exports) module.exports = api;
      else raiz.Recibos = api;
    })(typeof globalThis !== 'undefined' ? globalThis : this);
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Recibos: ' + (e && e.message)); return undefined; }
})();

// ===== core/planificacion.js =====
var Planificacion = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
    return module.exports;
  } catch (e) { ERRORES_CARGA.push('Planificacion: ' + (e && e.message)); return undefined; }
})();

// ===== core/servicio.js =====
var Servicio = (function () {
  try {
    var module = { exports: {} }, exports = module.exports;
    var require = function (ruta) { return ({ './calculo.js': Calculo, './empleados.js': Empleados, './prestaciones.js': Prestaciones, './exportes.js': Exportes, './constancia.js': Constancia, './vacaciones.js': Vacaciones, './aportes.js': Aportes, './recibos.js': Recibos, './planificacion.js': Planificacion, './servicio.js': Servicio })[ruta]; };
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
      var Aportes = isNode ? require('./aportes.js') : dependencia(raiz, 'Aportes');
      var Recibos = isNode ? require('./recibos.js') : dependencia(raiz, 'Recibos');
      var Planificacion = isNode ? require('./planificacion.js') : dependencia(raiz, 'Planificacion');
    
      var HORAS_SESION = 8;
      var MAX_FALLOS_CEDULA = 5;
      var MAX_FALLOS_GLOBAL = 400;   // freno a quien prueba cédulas al azar; alto para que los errores de tipeo de 150 personas no bloqueen a todos
    
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
      /** PIN de 4 números, que no sea de los fáciles (todos iguales o seguidos, como 1234 o 4321). */
      function revisarPin(pin) {
        pin = String(pin == null ? '' : pin);
        if (!/^\d{4}$/.test(pin)) return 'El PIN debe tener exactamente 4 números.';
        var d = pin.split('').map(Number), sube = true, baja = true;
        for (var i = 1; i < 4; i++) { if (d[i] !== d[i - 1] + 1) sube = false; if (d[i] !== d[i - 1] - 1) baja = false; }
        if (/^(\d)\1{3}$/.test(pin) || sube || baja) return 'Ese PIN es muy fácil de adivinar. Elige otro (no uses números iguales ni seguidos).';
        return '';
      }
    
      function sesionTrabajador(repo, ctx, emp) {
        var clave = Empleados.claveCedula(emp);
        repo.log('LOGIN', clave, 'Entrada de trabajador');
        return ok({ token: crearToken(ctx, clave, 'TRABAJADOR'), nombre: emp.nombre, genero: emp.genero || '', empresa: Empleados.empresaFideicomiso(emp), pushId: idPush(ctx, clave) });
      }
    
      /**
       * Entrada del colaborador: cédula y PIN de 4 números. Sin PIN en la petición responde qué falta
       * ({ requierePin, crearPin }). La primera vez crea su PIN (crearPin); si lo olvida, RRHH lo restablece.
       */
      function iniciarSesion(repo, ctx, cedulaTexto, pinTexto) {
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
        if (repo.pinDe) {
          var reg = repo.pinDe(Empleados.claveCedula(emp));
          if (!reg) return ok({ requierePin: true, crearPin: true });
          if (pinTexto == null || pinTexto === '') return ok({ requierePin: true, crearPin: false });
          if (ctx.hash(String(pinTexto), reg.sal) !== reg.hash) {
            repo.registrarFallo(digitos); repo.registrarFallo('global');
            var quedan = MAX_FALLOS_CEDULA - repo.fallos(digitos);
            return err('PIN', quedan > 0 ? 'PIN incorrecto. Te queda' + (quedan === 1 ? '' : 'n') + ' ' + quedan + ' intento' + (quedan === 1 ? '' : 's') + '.'
              : 'PIN incorrecto. Por seguridad, espera unos minutos para intentarlo de nuevo.');
          }
        }
        return sesionTrabajador(repo, ctx, emp);
      }
    
      /** Primera entrada: el colaborador crea su PIN (dos veces) y entra. Si ya tiene uno, debe usarlo o pedir que lo restablezcan. */
      function crearPin(repo, ctx, cedulaTexto, pin, confirmacion) {
        var digitos = Empleados.numeroDeCedulaTexto(cedulaTexto);
        if (!digitos) return err('CEDULA', 'Escribe tu cédula, solo números.');
        if (repo.fallos('global') >= MAX_FALLOS_GLOBAL || repo.fallos(digitos) >= MAX_FALLOS_CEDULA) {
          return err('BLOQUEADO', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.');
        }
        var emp = repo.empleadoPorClave('V' + digitos) || repo.empleadoPorClave('E' + digitos);
        if (!emp || emp.estado === 'Inactivo' || repo.usuario(digitos)) return err('NO_ENCONTRADO', 'No encontramos esa cédula. Revisa el número o consulta con Recursos Humanos.');
        var clave = Empleados.claveCedula(emp);
        if (repo.pinDe(clave)) return err('YA_TIENE', 'Ya creaste tu PIN: escríbelo para entrar. Si lo olvidaste, Gestión Humana lo restablece el primer día hábil de cada mes, sin excepción.');
        var problema = revisarPin(pin);
        if (problema) return err('VALIDACION', problema);
        if (String(pin) !== String(confirmacion)) return err('VALIDACION', 'Los dos PIN no coinciden. Escríbelos de nuevo.');
        var sal = ctx.firmar('pin:' + clave + ':' + ctx.ahora()).slice(0, 16);
        repo.guardarPin(clave, { sal: sal, hash: ctx.hash(String(pin), sal), creado: ctx.ahora() });
        repo.log('PIN_CREADO', clave, '');
        return sesionTrabajador(repo, ctx, emp);
      }
    
      /** RRHH borra el PIN de un colaborador (lo olvidó): al entrar de nuevo creará uno nuevo. */
      function restablecerPin(repo, ctx, token, clave) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var emp = repo.empleadoPorClave(String(clave || ''));
        if (!emp) return err('NO_ENCONTRADO', 'No encontramos ese empleado.');
        repo.borrarPin(Empleados.claveCedula(emp));
        repo.log('PIN_RESTABLECIDO', s.clave, Empleados.claveCedula(emp));
        return ok({ clave: Empleados.claveCedula(emp) });
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
        var data = { token: crearToken(ctx, digitos, u.rol), rol: u.rol, nombre: emp ? emp.nombre : '', genero: emp ? emp.genero || '' : '', pushId: idPush(ctx, digitos) };
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
        var previas = repo.anticiposDe(s.clave), ap = Prestaciones.aperturas(repo.aperturasAnticipo(), hoyCaracas(ctx));
        var v;
        if (String(p.anticipoValidarDisponible || '').toUpperCase() === 'SI') {   // cuando el sistema tenga los aportes acreditados
          v = Prestaciones.validarSolicitudAnticipo(sol, Prestaciones.resumenTrabajador(repo.aportesDe(s.clave), previas, parametrosPrestaciones(p)), emp, parametrosPrestaciones(p));
        } else {                                                                  // hoy: el colaborador ve su disponible en el banco
          v = Prestaciones.validarSolicitudBanco(sol, { empleado: emp, previas: previas, activa: ap.activa, proxima: ap.proxima, parametros: parametrosPrestaciones(p) });
        }
        if (!v.ok) return err('VALIDACION', v.errores.join(' '));
        var a = {
          id: repo.nuevoId(), clave: s.clave, monto: sol.monto, motivo: sol.motivo, detalle: String(sol.detalle || '').trim(),
          estado: 'PENDIENTE', creada: ctx.ahora(), decididaPor: '', motivoRechazo: '', ventana: ap.activa ? ap.activa.clave : '', acepto: ctx.ahora(),
        };
        repo.guardarAnticipo(a);
        repo.log('ANTICIPO_SOLICITADO', s.clave, a.id + ' · ' + a.monto);
        return ok(vistaAnticipo(a));
      }
    
      function vistaApertura(c, hoy) {
        return c ? { id: c.id, clave: c.clave, etiqueta: Prestaciones.etiquetaVentana(c.clave), inicio: c.inicio, fin: c.fin, estado: Prestaciones.estadoApertura(c, hoy) } : null;
      }
    
      /** Lo que ve el colaborador en Fideicomiso: la apertura vigente o la próxima, si puede solicitar y sus solicitudes. */
      function datosAnticipo(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var hoy = hoyCaracas(ctx), ap = Prestaciones.aperturas(repo.aperturasAnticipo(), hoy), anticipos = repo.anticiposDe(s.clave);
        var actual = ap.activa ? anticipos.filter(function (a) { return a.ventana === ap.activa.clave && a.estado !== 'CANCELADA'; })[0] : null;
        return ok({
          activa: vistaApertura(ap.activa, hoy), proxima: vistaApertura(ap.proxima, hoy), motivos: Prestaciones.PARAMETROS.motivos,
          puedeSolicitar: !!ap.activa && !actual, actual: actual ? vistaAnticipo(actual) : null,
          anticipos: anticipos.sort(function (a, b) { return b.creada - a.creada; }).map(vistaAnticipo),
        });
      }
    
      /** RRHH: aperturas de solicitudes con cuántas solicitudes recibió cada una. */
      function listarAperturas(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var hoy = hoyCaracas(ctx), conteo = {};
        repo.todosAnticipos().forEach(function (a) { if (a.estado !== 'CANCELADA') conteo[a.ventana] = (conteo[a.ventana] || 0) + 1; });
        return ok(repo.aperturasAnticipo().sort(function (a, b) { return a.inicio < b.inicio ? 1 : -1; })
          .map(function (c) { return Object.assign(vistaApertura(c, hoy), { solicitudes: conteo[c.clave] || 0 }); }));
      }
    
      /** RRHH abre (o corrige) una apertura: trimestre, fecha de inicio y fecha final. */
      function guardarApertura(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var lista = repo.aperturasAnticipo();
        var c = { id: datos && datos.id || repo.nuevoIdApertura(), clave: String(datos && datos.clave || ''), inicio: String(datos && datos.inicio || ''), fin: String(datos && datos.fin || '') };
        var previa = lista.filter(function (x) { return x.id === c.id; })[0];
        if (previa && previa.clave !== c.clave && repo.todosAnticipos().some(function (a) { return a.ventana === previa.clave && a.estado !== 'CANCELADA'; })) {
          return err('VALIDACION', 'Esta apertura ya tiene solicitudes: puedes cambiar sus fechas, pero no el trimestre.');
        }
        var v = Prestaciones.validarApertura(c, lista);
        if (!v.ok) return err('VALIDACION', v.errores.join(' '));
        repo.guardarAperturaAnticipo(Object.assign(previa || {}, c, { por: s.clave, actualizada: ctx.ahora() }));
        repo.log('ANTICIPO_APERTURA', s.clave, c.clave + ' · ' + c.inicio + ' a ' + c.fin);
        if (!previa) {
          var yaAbierta = c.inicio <= hoyCaracas(ctx);
          notificar(repo, ctx, '*', { tipo: 'ANTICIPO_APERTURA', ruta: 'fideicomiso',
            titulo: yaAbierta ? 'Ya puedes solicitar tu anticipo de fideicomiso' : 'Se abrirá la solicitud de anticipos de fideicomiso',
            texto: 'Del ' + fechaCorta(c.inicio) + ' al ' + fechaCorta(c.fin) + ' (' + Prestaciones.etiquetaVentana(c.clave) + ').' });
        }
        return ok(vistaApertura(c, hoyCaracas(ctx)));
      }
    
      function eliminarApertura(repo, ctx, token, id) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var c = repo.aperturasAnticipo().filter(function (x) { return x.id === id; })[0];
        if (!c) return err('NO_ENCONTRADO', 'No encontramos esa apertura.');
        if (repo.todosAnticipos().some(function (a) { return a.ventana === c.clave && a.estado !== 'CANCELADA'; })) {
          return err('VALIDACION', 'No se puede eliminar: ya tiene solicitudes. Si quieres cerrarla antes, cambia su fecha final.');
        }
        repo.eliminarAperturaAnticipo(id);
        repo.log('ANTICIPO_APERTURA_ELIMINADA', s.clave, c.clave);
        return ok({ id: id });
      }
    
      /** RRHH: el banco rechazó el anticipo (por ejemplo, el monto superaba el disponible). */
      function rechazarAnticipoBanco(repo, ctx, token, id, motivo) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var a = repo.anticipoPorId(id);
        if (!a) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        if (a.estado !== 'EN_ARCHIVO') return err('TRANSICION', 'Solo se marca así una solicitud enviada al banco.');
        var r = cambiarEstado(repo, ctx, a, 'RECHAZADA', s.clave, { motivoRechazo: String(motivo || '').trim() || 'Rechazada por el banco: el monto supera el disponible.' });
        if (r.ok) notificar(repo, ctx, [a.clave], { tipo: 'ANTICIPO_RECHAZADO', ruta: 'fideicomiso', titulo: 'El banco rechazó tu solicitud de anticipo', texto: a.motivoRechazo });
        return r;
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
       * Genera el archivo de anticipos de una empresa con las solicitudes RECIBIDAS (PENDIENTE; también las
       * APROBADAS de antes) y las pasa a EN_ARCHIVO. RRHH no aprueba: el banco es quien acepta o rechaza.
       * Mismo diseño que NOMINA APORTES con TIPO T = 5.
       */
      function generarArchivoAnticipos(repo, ctx, token, empresa) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var cfg = repo.empresaConfig(empresa);
        if (!cfg) return err('VALIDACION', 'Empresa desconocida.');
        var pendientes = repo.anticiposPorEstado('PENDIENTE').concat(repo.anticiposPorEstado('APROBADA')).filter(function (a) {
          var e = repo.empleadoPorClave(a.clave);
          return e && Empleados.empresaFideicomiso(e) === empresa;
        });
        if (!pendientes.length) return err('VACIO', 'No hay solicitudes de anticipo recibidas para ' + empresa + '.');
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
            notificar(repo, ctx, [a.clave], { tipo: 'ANTICIPO_PAGADO', ruta: 'fideicomiso', titulo: 'Tu anticipo de fideicomiso fue pagado', texto: 'Revisa tu cuenta del fideicomiso en el banco.' });
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
    
      /* ---------- Fideicomiso · Aportes trimestrales ---------- */
    
      function periodoValido(d) {
        var anio = Number(d && d.anio), trimestre = Number(d && d.trimestre), empresa = d && d.empresa;
        if (!(anio >= 2000 && anio <= 2100) || [1, 2, 3, 4].indexOf(trimestre) === -1 || ['PCA', 'AIV'].indexOf(empresa) === -1) return null;
        return { anio: anio, trimestre: trimestre, empresa: empresa };
      }
    
      function parametrosCalculo(p) {
        var r = {};
        if (Number(p.anioBase) > 0) r.anioBase = Number(p.anioBase);
        if (Number(p.diasMinimosMes) > 0) r.diasMinimosMes = Number(p.diasMinimosMes);
        if (Number(p.diasUtilidades) > 0) r.diasUtilidades = Number(p.diasUtilidades);
        return r;
      }
    
      /** Claves del aporte cerrado del trimestre anterior (o null si no hay: primer aporte en el sistema). */
      function anteriorDe(repo, per) {
        var ant = Aportes.trimestreAnterior(per.anio, per.trimestre);
        var c = repo.cierre(ant.anio, ant.trimestre, per.empresa);
        if (!c || ['CERRADO', 'ACREDITADO'].indexOf(c.estado) === -1) return null;
        return repo.aportesPeriodo(ant.anio, ant.trimestre, per.empresa).map(function (a) { return a.clave; });
      }
    
      function calcularVistaAporte(repo, per, datos) {
        var filas = (datos.filas || []).map(function (f) { return { nombre: String(f.nombre || '').trim(), monto: Number(f.monto), clave: f.clave || '' }; })
          .filter(function (f) { return f.nombre || f.clave; });
        return Aportes.prepararAporte({
          anio: per.anio, trimestre: per.trimestre, empresa: per.empresa, filas: filas, forzados: datos.forzados || {},
          empleados: repo.todosEmpleados(), anterior: anteriorDe(repo, per), parametros: parametrosCalculo(repo.parametros()),
        });
      }
    
      /** Estado del aporte de un período: cerrado o no, y sus líneas guardadas. */
      function estadoAporte(repo, ctx, token, datos) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var per = periodoValido(datos);
        if (!per) return err('VALIDACION', 'Elige año, trimestre y empresa.');
        var c = repo.cierre(per.anio, per.trimestre, per.empresa), lineas = repo.aportesPeriodo(per.anio, per.trimestre, per.empresa);
        var total = Calculo.redondear2(lineas.reduce(function (t, l) { return t + Number(l.total); }, 0));
        return ok({ estado: c ? c.estado : '', actualizado: c ? c.actualizado || 0 : 0, lineas: lineas, totales: { personas: lineas.length, total: total,
          nuevos: lineas.filter(function (l) { return l.nuevo; }).length }, primeraCarga: !anteriorDe(repo, per) });
      }
    
      /** Vista previa con el Excel (no guarda nada). */
      function prepararAporte(repo, ctx, token, datos) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var per = periodoValido(datos);
        if (!per) return err('VALIDACION', 'Elige año, trimestre y empresa.');
        if (!Array.isArray(datos.filas) || !datos.filas.length) return err('VALIDACION', 'El Excel no trae filas con nombre y monto.');
        return ok(calcularVistaAporte(repo, per, datos));
      }
    
      /**
       * Guarda el aporte y lo marca CERRADO. Se recalcula aquí (no se confía en el navegador).
       * No duplica: si el período ya está CERRADO solo se reemplaza con `reemplazar: true` (reapertura explícita);
       * si está ACREDITADO (el banco ya lo procesó) no se toca.
       */
      function cerrarAporte(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var per = periodoValido(datos);
        if (!per) return err('VALIDACION', 'Elige año, trimestre y empresa.');
        var c = repo.cierre(per.anio, per.trimestre, per.empresa);
        if (c && c.estado === 'ACREDITADO') return err('ACREDITADO', 'Este aporte ya fue acreditado por el banco: no se puede cambiar.');
        if (c && c.estado === 'CERRADO' && datos.reemplazar !== true) return err('YA_CERRADO', 'Este aporte ya está cerrado. Para cambiarlo, reábrelo.');
        var v = calcularVistaAporte(repo, per, datos);
        if (!v.listo) return err('VALIDACION', v.sugeridas.length ? 'Resuelve primero los nombres por confirmar.' : 'No hay líneas para guardar.');
        repo.reemplazarAportes(per.anio, per.trimestre, per.empresa, v.lineas.map(function (l) {
          return { clave: l.clave, nombre: l.nombre, anio: per.anio, trimestre: per.trimestre, empresa: per.empresa, total: l.total, monto: l.monto, meses: l.meses,
            diasAdicionales: l.diasAdicionales, adicionalesForzados: l.adicionalesForzados, nuevo: l.nuevo, salarioDiario: l.salarioDiario,
            alicUtilidades: l.alicUtilidades, alicVacaciones: l.alicVacaciones, diasVacaciones: l.diasVacaciones, diasAntiguedad: l.diasAntiguedad };
        }));
        var cierre = Object.assign(c || {}, { anio: per.anio, trimestre: per.trimestre, empresa: per.empresa, estado: 'CERRADO', por: s.clave, actualizado: ctx.ahora() });
        repo.guardarCierre(cierre);
        repo.log(c ? 'APORTE_REEMPLAZADO' : 'APORTE_CERRADO', s.clave, per.anio + ' T' + per.trimestre + ' ' + per.empresa + ' · ' + v.totales.personas + ' personas · ' + v.totales.total);
        return ok({ estado: 'CERRADO', totales: v.totales, retirados: v.retirados });
      }
    
      /** Archivos para el banco de un aporte cerrado: NOMINA APORTES (todos) o NUEVOS (solo nuevos ingresos). TIPO T = 1. */
      function archivoAporte(repo, ctx, token, datos) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var per = periodoValido(datos);
        if (!per) return err('VALIDACION', 'Elige año, trimestre y empresa.');
        var c = repo.cierre(per.anio, per.trimestre, per.empresa);
        if (!c || ['CERRADO', 'ACREDITADO'].indexOf(c.estado) === -1) return err('VALIDACION', 'Primero cierra el aporte.');
        var cfg = repo.empresaConfig(per.empresa);
        var lineas = repo.aportesPeriodo(per.anio, per.trimestre, per.empresa).filter(function (l) { return datos.tipo !== 'NUEVOS' || l.nuevo; });
        if (!lineas.length) return err('VACIO', datos.tipo === 'NUEVOS' ? 'Este aporte no tiene nuevos ingresos.' : 'El aporte está vacío.');
        var items = lineas.map(function (l) {
          var e = repo.empleadoPorClave(l.clave) || { cedulaLetra: l.clave.charAt(0), cedulaNumero: l.clave.slice(1), nombre: l.nombre };
          return { cedulaLetra: e.cedulaLetra, cedulaNumero: e.cedulaNumero, nombre: e.nombre || l.nombre, monto: Number(l.total) };
        });
        var filas = Exportes.filasNomina(items, { fideicomiso: cfg.fideicomiso, tipoT: cfg.tipoTAporte, forma: cfg.forma });
        return ok({ filas: filas, csv: Exportes.aCsv(filas, { decimales: { 5: 2 } }), cantidad: items.length });
      }
    
      /* ---------- Fideicomiso · Cancelaciones (empleados retirados) ---------- */
    
      function fechaTxt(f) { return f ? ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y : ''; }
    
      /** Retirados con aportes en el sistema que aún no tienen cancelación registrada. */
      function candidatosCancelacion(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var conCancelacion = {}, aportado = {};
        repo.cancelaciones().forEach(function (c) { if (c.estado !== 'ANULADA') conCancelacion[c.clave] = true; });
        repo.todosAportes().forEach(function (a) { aportado[a.clave] = Calculo.redondear2((aportado[a.clave] || 0) + Number(a.total)); });
        return ok(repo.todosEmpleados().filter(function (e) { var k = Empleados.claveCedula(e); return e.estado === 'Inactivo' && aportado[k] != null && !conCancelacion[k]; })
          .map(function (e) { var k = Empleados.claveCedula(e); return { clave: k, nombre: e.nombre, empresa: Empleados.empresaFideicomiso(e), fechaIngreso: fechaTxt(e.fechaIngreso), totalAportado: aportado[k] }; }));
      }
    
      function listarCancelaciones(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        return ok(repo.cancelaciones().sort(function (a, b) { return b.creada - a.creada; }));
      }
    
      /** RRHH registra la cancelación de un retirado: fecha de egreso y, si lo define, el monto a cancelar. */
      function registrarCancelacion(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var e = repo.empleadoPorClave(datos && datos.clave);
        if (!e) return err('NO_ENCONTRADO', 'No encontramos ese empleado.');
        if (e.estado !== 'Inactivo') return err('VALIDACION', 'Solo se cancela el fideicomiso de empleados retirados (inactivos).');
        if (!Vacaciones.esFecha(datos.fechaEgreso)) return err('VALIDACION', 'Indica la fecha de egreso.');
        var monto = datos.monto === '' || datos.monto == null ? '' : Number(datos.monto);
        if (monto !== '' && !(monto >= 0)) return err('VALIDACION', 'El monto a cancelar no es válido.');
        var k = Empleados.claveCedula(e);
        if (repo.cancelaciones().some(function (c) { return c.clave === k && c.estado !== 'ANULADA'; })) return err('VALIDACION', 'Ese empleado ya tiene una cancelación registrada.');
        var c = { id: repo.nuevoIdCancelacion(), clave: k, nombre: e.nombre, empresa: Empleados.empresaFideicomiso(e), fechaIngreso: fechaTxt(e.fechaIngreso),
          fechaEgreso: Vacaciones.corta(datos.fechaEgreso), monto: monto === '' ? '' : Calculo.redondear2(monto), estado: 'PENDIENTE', creada: ctx.ahora(), por: s.clave, actualizada: ctx.ahora() };
        repo.guardarCancelacion(c);
        repo.log('CANCELACION_REGISTRADA', s.clave, k + ' · egreso ' + c.fechaEgreso);
        return ok(c);
      }
    
      /** Archivo de cancelaciones de una empresa con las PENDIENTES; pasan a EN_ARCHIVO. */
      function archivoCancelaciones(repo, ctx, token, empresa) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var lista = repo.cancelaciones().filter(function (c) { return c.empresa === empresa && c.estado === 'PENDIENTE'; });
        if (!lista.length) return err('VACIO', 'No hay cancelaciones pendientes de ' + empresa + '.');
        var filas = [['Cédula (letra)', 'Cédula (número)', 'Nombre', 'Fecha de ingreso', 'Fecha de egreso', 'Monto a cancelar']].concat(lista.map(function (c) {
          return [c.clave.charAt(0), c.clave.slice(1), c.nombre, c.fechaIngreso, c.fechaEgreso, c.monto === '' ? '' : Number(c.monto)];
        }));
        lista.forEach(function (c) { c.estado = 'EN_ARCHIVO'; c.actualizada = ctx.ahora(); repo.guardarCancelacion(c); });
        repo.log('ARCHIVO_CANCELACIONES', s.clave, empresa + ' · ' + lista.length);
        return ok({ filas: filas, csv: Exportes.aCsv(filas, { decimales: { 5: 2 } }), cantidad: lista.length });
      }
    
      /** Cambia el estado de cancelaciones: PROCESADA (el banco la ejecutó) o ANULADA (si se registró por error). */
      function marcarCancelaciones(repo, ctx, token, ids, estado) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var validas = { PROCESADA: ['EN_ARCHIVO'], ANULADA: ['PENDIENTE'] };
        if (!validas[estado]) return err('VALIDACION', 'Estado no válido.');
        var n = 0;
        repo.cancelaciones().forEach(function (c) {
          if ((ids || []).indexOf(c.id) !== -1 && validas[estado].indexOf(c.estado) !== -1) { c.estado = estado; c.actualizada = ctx.ahora(); repo.guardarCancelacion(c); n++; }
        });
        repo.log('CANCELACION_' + estado, s.clave, n + '');
        return ok({ cambiados: n });
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
          planificada: s.planificada || '',   // 'SI' / 'NO' frente a la planificación aprobada ('' si no tenía)
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
        var planVigente = planAprobadoDe(repo, c.clave, datos.inicio);
        var sol = {
          planificada: planVigente ? (Planificacion.enPlan({ inicio: datos.inicio, culminacion: v.calculo.culminacion }, planVigente.bloques, feriados) ? 'SI' : 'NO') : '',
          id: repo.nuevoIdVac(), clave: c.clave, inicio: datos.inicio, culminacion: v.calculo.culminacion, reintegro: v.calculo.reintegro,
          dias: Number(datos.dias), condicion: v.calculo.condicion, imputacion: v.calculo.imputacion, estado: 'PENDIENTE_JEFE',
          jefe: emp.jefe, creada: ctx.ahora(), actualizada: ctx.ahora(), decididaJefePor: '', registradaPor: '', nomina: '', motivoRechazo: '',
        };
        repo.guardarVacSolicitud(sol);
        repo.log('VACACIONES_SOLICITADA', c.clave, sol.id + ' · ' + sol.dias + ' días desde ' + sol.inicio);
        notificar(repo, ctx, [emp.jefe], { tipo: 'VACACIONES_POR_APROBAR', ruta: 'equipo', titulo: 'Nueva solicitud de vacaciones por aprobar',
          texto: emp.nombre + ' pide ' + sol.dias + ' día' + (sol.dias === 1 ? '' : 's') + ' desde el ' + fechaCorta(sol.inicio) + '.' });
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
        var extra = { decididaJefePor: s.clave, decisionJefe: ctx.ahora(), motivoRechazo: aprobar ? '' : String(motivo).trim() };
        if (aprobar) Object.assign(extra, datosConstanciaVac(repo, ctx, sol));   // la constancia de aprobación sale con el visto bueno del jefe
        var r = cambiarVac(repo, ctx, sol, aprobar ? 'APROBADA_JEFE' : 'RECHAZADA', s.clave, extra);
        if (r.ok) notificar(repo, ctx, [sol.clave], aprobar
          ? { tipo: 'VACACIONES_APROBADAS', ruta: 'vacaciones', titulo: '¡Tu jefe aprobó tus vacaciones!', texto: 'Del ' + fechaCorta(sol.inicio) + ' al ' + fechaCorta(sol.culminacion) + '. Ya puedes descargar tu constancia de aprobación.' }
          : { tipo: 'VACACIONES_RECHAZADAS', ruta: 'vacaciones', titulo: 'Tu solicitud de vacaciones fue rechazada', texto: 'Motivo: ' + extra.motivoRechazo });
        return r;
      }
    
      /** Número de la constancia de aprobación (formato del Excel) y días que quedan por período una vez aplicado este disfrute. */
      function datosConstanciaVac(repo, ctx, sol) {
        var emp = repo.empleadoPorClave(sol.clave);
        if (!emp) return {};
        var c = contextoVac(repo, ctx, emp);
        return {
          numeroConstancia: Vacaciones.numeroConstancia(sol, emp.cedulaLetra, emp.cedulaNumero),
          pendientesDespues: Vacaciones.pendientesTras(c.periodos, c.solicitudes, sol),
        };
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
    
      /** RRHH registra con el código de nómina. La constancia ya salió al aprobar el jefe (se completa aquí si faltara). */
      function registrarVacaciones(repo, ctx, token, id, nomina) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var sol = repo.vacSolicitudPorId(id);
        if (!sol) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        var extra = { registradaPor: s.clave, registrada: ctx.ahora(), nomina: String(nomina || '').trim() };
        if (!sol.numeroConstancia) Object.assign(extra, datosConstanciaVac(repo, ctx, sol));
        var r = cambiarVac(repo, ctx, sol, 'REGISTRADA', s.clave, extra);
        if (r.ok) notificar(repo, ctx, [sol.clave], { tipo: 'VACACIONES_REGISTRADAS', ruta: 'vacaciones', titulo: 'Gestión Humana registró tus vacaciones', texto: 'Del ' + fechaCorta(sol.inicio) + ' al ' + fechaCorta(sol.culminacion) + '. Te reintegras el ' + fechaCorta(sol.reintegro) + '.' });
        return r;
      }
    
      function rechazarVacacionesRRHH(repo, ctx, token, id, motivo) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        if (!String(motivo || '').trim()) return err('VALIDACION', 'Indica el motivo del rechazo.');
        var sol = repo.vacSolicitudPorId(id);
        if (!sol) return err('NO_ENCONTRADO', 'No encontramos esa solicitud.');
        var r = cambiarVac(repo, ctx, sol, 'RECHAZADA', s.clave, { motivoRechazo: String(motivo).trim(), registradaPor: s.clave });
        if (r.ok) notificar(repo, ctx, [sol.clave], { tipo: 'VACACIONES_RECHAZADAS', ruta: 'vacaciones', titulo: 'Gestión Humana rechazó tu solicitud de vacaciones', texto: 'Motivo: ' + String(motivo).trim() });
        return r;
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
    
    
      /* ---------- Notificaciones (campanita y celular) ---------- */
    
      var DIA_MS = 86400000;
      function digitos(clave) { return String(clave || '').replace(/\D/g, ''); }
      function fechaCorta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || ''); }
      /** Identificador para el servicio de notificaciones al celular: no revela la cédula. */
      function idPush(ctx, clave) { return ctx.firmar('push:' + digitos(clave)).slice(0, 32); }
    
      /**
       * Guarda el aviso (campanita) y lo envía al celular de quienes lo activaron. destinos: claves (V12345678) o '*' (todos).
       * El envío al celular es «mejor esfuerzo»: si falla, el aviso sigue en la campanita.
       */
      function notificar(repo, ctx, destinos, n) {
        var lista = destinos === '*' ? ['*'] : (destinos || []).filter(Boolean);
        if (!lista.length || !repo.agregarNotificaciones) return;
        var ahora = ctx.ahora();
        repo.agregarNotificaciones(lista.map(function (c) {
          return { id: repo.nuevoIdNotificacion(), clave: c, tipo: n.tipo, titulo: n.titulo, texto: n.texto || '', ruta: n.ruta || '', creada: ahora };
        }));
        try { if (repo.enviarPush) return repo.enviarPush(destinos === '*' ? '*' : lista.map(function (c) { return idPush(ctx, c); }), n.titulo, n.texto || '', n.ruta || ''); }
        catch (e) { return { estado: 'ERROR', detalle: String(e && e.message || e) }; }
        return { estado: 'SIN_CONFIGURAR' };
      }
    
      /**
       * Registra en OneSignal la suscripción de avisos de este dispositivo (endpoint y llaves que entrega el navegador).
       * Se hace desde el servidor con la clave de OneSignal: no depende de la librería de OneSignal en el teléfono.
       */
      function registrarDispositivo(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var d = { endpoint: String(datos && datos.endpoint || ''), p256dh: String(datos && datos.p256dh || ''), auth: String(datos && datos.auth || '') };
        if (!/^https:\/\/[^\s]{10,1000}$/.test(d.endpoint) || !/^[\w-]{20,200}$/.test(d.p256dh) || !/^[\w-]{8,100}$/.test(d.auth)) {
          return err('VALIDACION', 'El dispositivo no entregó una suscripción de avisos válida.');
        }
        if (!repo.registrarSuscripcionPush) return err('SIN_CONFIGURAR', 'Los avisos al celular no están disponibles.');
        var r = repo.registrarSuscripcionPush(idPush(ctx, s.clave), d) || {};
        if (r.estado !== 'REGISTRADO') return err(r.estado || 'ERROR', r.detalle || 'OneSignal no registró el dispositivo.');
        repo.log('AVISOS_DISPOSITIVO', s.clave, r.tipo || '');
        return ok({ estado: 'REGISTRADO', tipo: r.tipo || '' });
      }
    
      /** Cualquier persona se envía a sí misma un aviso de prueba: dice si el celular lo recibirá y, si no, por qué. */
      function avisoDePrueba(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var clave = s.rol === 'TRABAJADOR' ? s.clave : 'V' + digitos(s.clave);
        var r = notificar(repo, ctx, [clave], { tipo: 'PRUEBA', ruta: '', titulo: 'Aviso de prueba del CAC', texto: 'Si ves esto en tu celular, los avisos funcionan.' });
        return ok({ push: r || { estado: 'SIN_CONFIGURAR' } });
      }
    
      /** La última constancia de una persona, si venció (y no fue anulada ni reemplazada). */
      function constanciaVencida(repo, clave, ahora) {
        var ult = repo.constanciasDe(clave).sort(function (a, b) { return b.emision - a.emision; })[0];
        return ult && ult.estado !== 'ANULADA' && ult.vence < ahora ? ult : null;
      }
    
      function misNotificaciones(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var d = digitos(s.clave), ahora = ctx.ahora(), desde = ahora - 60 * DIA_MS;
        var hasta = repo.notificacionesLeidasHasta(d) || 0;
        var items = repo.notificacionesRecientes().filter(function (n) {
          return n.creada >= desde && (n.clave === '*' || digitos(n.clave) === d);
        }).map(function (n) { return { id: n.id, tipo: n.tipo, titulo: n.titulo, texto: n.texto, ruta: n.ruta, creada: n.creada }; });
        (s.rol === 'TRABAJADOR' ? [s.clave] : ['V' + d, 'E' + d]).forEach(function (c) {
          var v = constanciaVencida(repo, c, ahora);
          if (v && v.vence >= desde) items.push({ id: 'VENCE-' + v.id, tipo: 'CONSTANCIA_VENCIDA', titulo: 'Tu constancia de trabajo venció', texto: 'Ya puedes generar una nueva.', ruta: 'constancia', creada: v.vence });
        });
        items.sort(function (a, b) { return b.creada - a.creada; });
        items = items.slice(0, 30);
        return ok({ items: items.map(function (n) { return Object.assign(n, { nueva: n.creada > hasta }); }), noLeidas: items.filter(function (n) { return n.creada > hasta; }).length });
      }
    
      function marcarNotificacionesLeidas(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        repo.marcarNotificacionesLeidas(digitos(s.clave), ctx.ahora());
        return ok({ noLeidas: 0 });
      }
    
      /** Tarea diaria: avisa al celular a quienes se les venció la constancia desde la última revisión. */
      function avisosDiarios(repo, ctx, desde) {
        var ahora = ctx.ahora(), avisadas = {};
        repo.todasConstancias().forEach(function (c) {
          if (c.vence > desde && c.vence <= ahora && !avisadas[c.clave] && constanciaVencida(repo, c.clave, ahora) && constanciaVencida(repo, c.clave, ahora).id === c.id) avisadas[c.clave] = true;
        });
        var claves = Object.keys(avisadas);
        try { if (claves.length && repo.enviarPush) repo.enviarPush(claves.map(function (c) { return idPush(ctx, c); }), 'Tu constancia de trabajo venció', 'Ya puedes generar una nueva en el CAC.', 'constancia'); }
        catch (e) { /* sin celular */ }
        return ok({ avisadas: claves.length });
      }
    
      /* ---------- Vacaciones: panel de días pendientes (RRHH) ---------- */
    
      /** Datos de ubicación de un empleado para filtrar: empresa, departamento y localidad (la «Organización» del Detalle). */
      function ubicacion(e) {
        return { empresa: Empleados.empresaFideicomiso(e), departamento: e.departamento || 'Sin departamento', localidad: e.organizacion || 'Sin localidad' };
      }
    
      /** Días pendientes por período de todos los empleados activos (el filtro por empresa, departamento o localidad se hace en la pantalla). */
      function panelSaldosVacaciones(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var periodos = {};
        var filas = repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo' && e.cedulaNumero; }).map(function (e) {
          var c = contextoVac(repo, ctx, e);
          var pp = c.saldo.porPeriodo.filter(function (p) { return p.pendientes > 0; });
          pp.forEach(function (p) { periodos[p.periodo] = true; });
          return Object.assign({ clave: c.clave, nombre: e.nombre, sinFechaIngreso: !e.fechaIngreso,
            porPeriodo: pp.map(function (p) { return { periodo: p.periodo, pendientes: p.pendientes }; }), total: c.saldo.total }, ubicacion(e));
        }).sort(function (a, b) { return b.total - a.total || (a.nombre < b.nombre ? -1 : 1); });
        return ok({ filas: filas, periodos: Object.keys(periodos).sort(), hoy: hoyCaracas(ctx) });
      }
    
      /* ---------- Planificación anual de vacaciones ---------- */
    
      function vistaCiclo(c, hoy) {
        return { id: c.id, nombre: c.nombre, desde: c.desde, hasta: c.hasta, abre: c.abre, cierra: c.cierra,
          abierta: c.abre <= hoy && hoy <= c.cierra, vigente: c.desde <= hoy && hoy <= c.hasta };
      }
    
      /** La planificación en curso para el colaborador: la abierta para cargar o, si no, la vigente (la más reciente). */
      function cicloActual(repo, hoy) {
        var lista = repo.vacCiclos().sort(function (a, b) { return a.abre < b.abre ? 1 : -1; });
        return lista.filter(function (c) { return c.abre <= hoy && hoy <= c.cierra; })[0]
          || lista.filter(function (c) { return c.abre <= hoy && hoy <= c.hasta; })[0] || null;
      }
    
      /** Plan aprobado que cubre esa fecha (para marcar si una solicitud está dentro de lo planificado). */
      function planAprobadoDe(repo, clave, fecha) {
        if (!repo.vacCiclos) return null;
        var ciclo = repo.vacCiclos().filter(function (c) { return c.desde <= fecha && fecha <= c.hasta; })[0];
        var plan = ciclo && repo.vacPlan(ciclo.id, clave);
        return plan && plan.estado === 'APROBADA' ? plan : null;
      }
    
      function requeridosDe(repo, ctx, emp, ciclo) {
        var c = contextoVac(repo, ctx, emp);
        return Planificacion.requeridos(c.saldo.total, Vacaciones.deObjeto(emp.fechaIngreso), repo.vacPeriodosDe(c.clave), c.hoy, ciclo.desde, ciclo.hasta);
      }
    
      function vistaPlan(p) {
        return p ? { id: p.id, estado: p.estado, bloques: p.bloques, requeridos: p.requeridos, planificados: p.planificados,
          enviada: p.enviada || 0, decidida: p.decidida || 0, motivo: p.motivo || '', jefe: p.jefe || '' } : null;
      }
    
      /** RRHH abre (o corrige) una planificación: nombre, período a planificar y fechas de apertura y cierre. */
      function guardarPlanificacionVac(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var c = { id: datos && datos.id || '', nombre: String(datos && datos.nombre || '').trim(), desde: String(datos && datos.desde || ''), hasta: String(datos && datos.hasta || ''),
          abre: String(datos && datos.abre || ''), cierra: String(datos && datos.cierra || '') };
        var v = Planificacion.validarCiclo(c);
        if (!v.ok) return err('VALIDACION', v.errores.join(' '));
        var previa = c.id ? repo.vacCiclos().filter(function (x) { return x.id === c.id; })[0] : null;
        if (c.id && !previa) return err('NO_ENCONTRADO', 'No encontramos esa planificación.');
        if (!previa) c.id = repo.nuevoIdCiclo();
        var cruzada = repo.vacCiclos().filter(function (x) { return x.id !== c.id && !(c.hasta < x.desde || c.desde > x.hasta); })[0];
        if (cruzada) return err('VALIDACION', 'Ese período se cruza con «' + cruzada.nombre + '».');
        repo.guardarVacCiclo(Object.assign(previa || {}, c, { por: s.clave, actualizada: ctx.ahora(), creada: previa ? previa.creada : ctx.ahora() }));
        repo.log('PLAN_VAC_CICLO', s.clave, c.id + ' · ' + c.nombre);
        if (!previa) notificar(repo, ctx, '*', { tipo: 'PLAN_VAC_ABIERTA', ruta: 'vacaciones', titulo: 'Carga tu planificación de vacaciones',
          texto: c.nombre + ': del ' + fechaCorta(c.desde) + ' al ' + fechaCorta(c.hasta) + '. Tienes hasta el ' + fechaCorta(c.cierra) + ' para enviarla a tu jefe.' });
        return ok(vistaCiclo(c, hoyCaracas(ctx)));
      }
    
      function listarPlanificacionesVac(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var hoy = hoyCaracas(ctx);
        return ok(repo.vacCiclos().sort(function (a, b) { return a.desde < b.desde ? 1 : -1; }).map(function (c) { return vistaCiclo(c, hoy); }));
      }
    
      /** Lo que ve el colaborador: la planificación en curso, cuántos días debe planificar y su plan. */
      function miPlanificacion(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var hoy = hoyCaracas(ctx), ciclo = cicloActual(repo, hoy);
        if (!ciclo) return ok({ ciclo: null });
        var emp = repo.empleadoPorClave(s.clave);
        if (!emp || emp.estado === 'Inactivo') return err('VALIDACION', 'No encontramos tus datos activos.');
        var plan = repo.vacPlan(ciclo.id, s.clave), vc = vistaCiclo(ciclo, hoy);
        var req = plan && (plan.estado === 'APROBADA' || plan.estado === 'ENVIADA') ? { total: plan.requeridos } : requeridosDe(repo, ctx, emp, ciclo);
        var editable = (!plan || plan.estado === 'BORRADOR' || plan.estado === 'RECHAZADA') && (vc.abierta || (plan && plan.estado === 'RECHAZADA'));
        var cump = plan && plan.estado === 'APROBADA' ? Planificacion.cumplimiento(plan.bloques, repo.vacSolicitudesDe(s.clave), ciclo, repo.feriados(), hoy) : null;
        return ok({ ciclo: vc, requeridos: req.total, pendientes: req.pendientes, nuevos: req.nuevos || [], plan: vistaPlan(plan), editable: editable,
          tieneJefe: !!jefeActivo(repo, emp.jefe), feriados: repo.feriados(), cumplimiento: cump });
      }
    
      /** El colaborador guarda su plan (borrador) o lo envía a su jefe. */
      function guardarMiPlanificacion(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var hoy = hoyCaracas(ctx), ciclo = cicloActual(repo, hoy);
        if (!ciclo) return err('VALIDACION', 'No hay una planificación de vacaciones abierta.');
        var emp = repo.empleadoPorClave(s.clave);
        if (!emp || emp.estado === 'Inactivo') return err('VALIDACION', 'No encontramos tus datos activos.');
        var plan = repo.vacPlan(ciclo.id, s.clave), vc = vistaCiclo(ciclo, hoy);
        if (plan && (plan.estado === 'ENVIADA' || plan.estado === 'APROBADA')) return err('TRANSICION', plan.estado === 'ENVIADA' ? 'Tu planificación ya está con tu jefe.' : 'Tu planificación ya fue aprobada.');
        if (!vc.abierta && !(plan && plan.estado === 'RECHAZADA')) return err('VALIDACION', 'La carga de la planificación cerró el ' + fechaCorta(ciclo.cierra) + '.');
        var enviar = !!(datos && datos.enviar), jefe = jefeActivo(repo, emp.jefe);
        if (enviar && !jefe) return err('VALIDACION', 'No tienes jefe directo asignado. Comunícate con Gestión Humana.');
        var req = requeridosDe(repo, ctx, emp, ciclo), feriados = repo.feriados();
        var v = Planificacion.validarPlan((datos && datos.bloques) || [], ciclo, req, feriados, enviar);
        if (!v.ok) return err('VALIDACION', v.errores.join(' '));
        plan = Object.assign(plan || { id: repo.nuevoIdPlan(), ciclo: ciclo.id, clave: s.clave }, {
          bloques: v.bloques, requeridos: req.total, planificados: v.total, estado: enviar ? 'ENVIADA' : 'BORRADOR',
          enviada: enviar ? ctx.ahora() : 0, motivo: enviar ? '' : (plan && plan.motivo) || '', jefe: emp.jefe || '', actualizada: ctx.ahora(),
        });
        repo.guardarVacPlan(plan);
        repo.log(enviar ? 'PLAN_VAC_ENVIADO' : 'PLAN_VAC_BORRADOR', s.clave, plan.id + ' · ' + v.total + ' días');
        if (enviar) notificar(repo, ctx, [emp.jefe], { tipo: 'PLAN_VAC_POR_APROBAR', ruta: 'equipo', titulo: 'Planificación de vacaciones por aprobar',
          texto: emp.nombre + ' envió su planificación (' + v.total + ' días).' });
        return ok(vistaPlan(plan));
      }
    
      /** Bandeja del jefe: planificaciones de su equipo (por aprobar y el estado de cada persona). */
      function equipoPlanificacion(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var hoy = hoyCaracas(ctx), ciclo = cicloActual(repo, hoy);
        if (!ciclo) return ok({ ciclo: null, pendientes: [], equipo: [] });
        var mias = clavesDeJefe(s);
        var equipo = repo.todosEmpleados().filter(function (e) { return mias.indexOf(e.jefe) !== -1 && e.estado !== 'Inactivo'; });
        var planes = {}; repo.vacPlanes(ciclo.id).forEach(function (p) { planes[p.clave] = p; });
        var filas = equipo.map(function (e) {
          var k = Empleados.claveCedula(e), p = planes[k];
          return { clave: k, nombre: e.nombre, estado: p ? p.estado : 'SIN_CARGAR', plan: vistaPlan(p) };
        }).sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; });
        return ok({ ciclo: vistaCiclo(ciclo, hoy), pendientes: filas.filter(function (f) { return f.estado === 'ENVIADA'; }), equipo: filas });
      }
    
      function decidirPlanificacion(repo, ctx, token, id, aprobar, motivo) {
        var s = leerToken(ctx, token, ['TRABAJADOR', 'RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var plan = repo.vacPlanPorId(id);
        if (!plan || clavesDeJefe(s).indexOf(plan.jefe) === -1) return err('NO_ENCONTRADO', 'Esa planificación no es de tu equipo.');
        if (plan.estado !== 'ENVIADA') return err('TRANSICION', 'Esa planificación ya no está pendiente.');
        if (!aprobar && !String(motivo || '').trim()) return err('VALIDACION', 'Indica el motivo para que la corrija.');
        Object.assign(plan, { estado: aprobar ? 'APROBADA' : 'RECHAZADA', decidida: ctx.ahora(), decididaPor: s.clave, motivo: aprobar ? '' : String(motivo).trim(), actualizada: ctx.ahora() });
        repo.guardarVacPlan(plan);
        repo.log(aprobar ? 'PLAN_VAC_APROBADO' : 'PLAN_VAC_RECHAZADO', s.clave, plan.id);
        notificar(repo, ctx, [plan.clave], aprobar
          ? { tipo: 'PLAN_VAC_APROBADA', ruta: 'vacaciones', titulo: 'Tu jefe aprobó tu planificación de vacaciones', texto: plan.planificados + ' días planificados.' }
          : { tipo: 'PLAN_VAC_RECHAZADA', ruta: 'vacaciones', titulo: 'Tu jefe pidió corregir tu planificación', texto: 'Motivo: ' + plan.motivo });
        return ok(vistaPlan(plan));
      }
    
      /** RRHH: cada empleado activo con el estado de su plan y su cumplimiento (planificado contra disfrutado). */
      function panelPlanificacionVac(repo, ctx, token, cicloId) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var hoy = hoyCaracas(ctx), ciclos = repo.vacCiclos();
        var ciclo = ciclos.filter(function (c) { return c.id === cicloId; })[0] || cicloActual(repo, hoy) || ciclos[0];
        if (!ciclo) return ok({ ciclo: null, filas: [], meses: [] });
        var planes = {}; repo.vacPlanes(ciclo.id).forEach(function (p) { planes[p.clave] = p; });
        var feriados = repo.feriados(), nombres = nombresPorClave(repo);
        var filas = repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo' && e.cedulaNumero; }).map(function (e) {
          var k = Empleados.claveCedula(e), p = planes[k];
          var cump = Planificacion.cumplimiento(p && p.estado === 'APROBADA' ? p.bloques : [], repo.vacSolicitudesDe(k), ciclo, feriados, hoy);
          return Object.assign({ clave: k, nombre: e.nombre, jefeNombre: e.jefe && nombres[e.jefe] ? nombres[e.jefe].nombre : '',
            estado: p ? p.estado : 'SIN_CARGAR', requeridos: p ? p.requeridos : null, cumplimiento: cump }, ubicacion(e));
        }).sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; });
        return ok({ ciclo: vistaCiclo(ciclo, hoy), filas: filas, meses: Planificacion.meses(ciclo.desde, ciclo.hasta), hoy: hoy });
      }
    
      /** RRHH: aviso a quienes aún no han enviado su planificación. */
      function recordarPlanificacionVac(repo, ctx, token, cicloId) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var ciclo = repo.vacCiclos().filter(function (c) { return c.id === cicloId; })[0];
        if (!ciclo) return err('NO_ENCONTRADO', 'No encontramos esa planificación.');
        var listos = {}; repo.vacPlanes(ciclo.id).forEach(function (p) { if (p.estado === 'ENVIADA' || p.estado === 'APROBADA') listos[p.clave] = true; });
        var faltan = repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo' && e.cedulaNumero && !listos[Empleados.claveCedula(e)]; })
          .map(function (e) { return Empleados.claveCedula(e); });
        if (faltan.length) notificar(repo, ctx, faltan, { tipo: 'PLAN_VAC_RECORDATORIO', ruta: 'vacaciones', titulo: 'Falta tu planificación de vacaciones',
          texto: ciclo.nombre + ': envíala a tu jefe antes del ' + fechaCorta(ciclo.cierra) + '.' });
        repo.log('PLAN_VAC_RECORDATORIO', s.clave, ciclo.id + ' · ' + faltan.length);
        return ok({ avisados: faltan.length });
      }
    
      /* ---------- Recibos de pago ---------- */
    
      var MAX_PDF_RECIBO = 3 * 1024 * 1024;   // base64 de una hoja: sobra con 3 MB
    
      function vistaLote(l, recibos) {
        var v = { id: l.id, concepto: l.concepto, empresa: l.empresa, estado: l.estado, creado: l.creado, publicado: l.publicado || 0, total: Number(l.total) || 0 };
        if (recibos) {
          v.cargados = recibos.length;
          v.vistos = recibos.filter(function (r) { return r.visto; }).length;
          v.conformes = recibos.filter(function (r) { return r.conforme; }).length;
        }
        return v;
      }
    
      /** RRHH: asigna las hojas leídas del PDF (cédula y nombre impresos) a los empleados. */
      function asignarRecibos(repo, ctx, token, hojas) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        if (!Array.isArray(hojas) || !hojas.length) return err('VALIDACION', 'El PDF no trae hojas.');
        var emps = repo.todosEmpleados();
        return ok({
          hojas: Recibos.asignarHojas(hojas, emps),
          empleados: emps.filter(function (e) { return e.cedulaNumero; }).map(function (e) {
            return { clave: Empleados.claveCedula(e), nombre: e.nombre, inactivo: e.estado === 'Inactivo' };
          }).sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; }),
        });
      }
    
      function crearLoteRecibos(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var concepto = String(datos && datos.concepto || '').replace(/\s+/g, ' ').trim();
        if (!concepto) return err('VALIDACION', 'Escribe el concepto (por ejemplo, «Nómina 1Q noviembre 2026»).');
        if (concepto.length > 80) return err('VALIDACION', 'El concepto es muy largo (máximo 80 caracteres).');
        var lote = { id: repo.nuevoIdLote(), concepto: concepto, empresa: String(datos.empresa || ''), total: Number(datos.total) || 0,
          estado: 'BORRADOR', creado: ctx.ahora(), por: s.clave, publicado: 0 };
        repo.guardarLote(lote);
        repo.log('RECIBOS_LOTE', s.clave, lote.id + ' · ' + concepto);
        return ok(vistaLote(lote, []));
      }
    
      /** Sube un grupo de hojas (PDF de una página en base64) a un lote en borrador. Repetir el envío no duplica. */
      function subirRecibos(repo, ctx, token, datos) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var lote = repo.lotePorId(datos && datos.lote);
        if (!lote) return err('NO_ENCONTRADO', 'No encontramos esa carga de recibos.');
        if (lote.estado !== 'BORRADOR') return err('TRANSICION', 'Esa carga ya fue publicada.');
        var previos = repo.recibosDeLote(lote.id), hechas = {};
        previos.forEach(function (r) { hechas[r.pagina] = true; });
        var nuevos = [], items = (datos && datos.items) || [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i], pdf = String(it.pdf || '');
          if (hechas[it.pagina]) continue;
          var emp = repo.empleadoPorClave(String(it.clave || ''));
          if (!emp) return err('VALIDACION', 'La hoja ' + it.pagina + ' no tiene un colaborador válido asignado.');
          if (!pdf || pdf.length > MAX_PDF_RECIBO) return err('VALIDACION', 'La hoja ' + it.pagina + ' está vacía o es demasiado grande.');
          var archivo = repo.guardarArchivoRecibo(lote.concepto + ' - ' + Empleados.claveCedula(emp) + ' - hoja ' + it.pagina + '.pdf', pdf);
          nuevos.push({ id: repo.nuevoIdRecibo(), lote: lote.id, clave: Empleados.claveCedula(emp), nombre: emp.nombre, pagina: Number(it.pagina), archivo: archivo, creado: ctx.ahora(), visto: 0, conforme: 0 });
          hechas[it.pagina] = true;
        }
        if (nuevos.length) repo.agregarRecibos(nuevos);
        return ok({ guardados: nuevos.length, cargados: previos.length + nuevos.length });
      }
    
      function publicarLote(repo, ctx, token, id) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var lote = repo.lotePorId(id);
        if (!lote) return err('NO_ENCONTRADO', 'No encontramos esa carga de recibos.');
        if (lote.estado !== 'BORRADOR') return err('TRANSICION', 'Esa carga ya fue publicada.');
        var recibos = repo.recibosDeLote(id);
        if (!recibos.length) return err('VACIO', 'Esta carga no tiene recibos.');
        lote.estado = 'PUBLICADO'; lote.publicado = ctx.ahora();
        repo.guardarLote(lote);
        var claves = {}; recibos.forEach(function (r) { claves[r.clave] = true; });
        notificar(repo, ctx, Object.keys(claves), { tipo: 'RECIBO', ruta: 'recibos', titulo: 'Tienes un recibo de pago nuevo', texto: lote.concepto });
        repo.log('RECIBOS_PUBLICADOS', s.clave, id + ' · ' + recibos.length + ' recibos');
        return ok(vistaLote(lote, recibos));
      }
    
      function eliminarLote(repo, ctx, token, id) {
        var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
        if (!s) return err('SESION', 'No autorizado.');
        var lote = repo.lotePorId(id);
        if (!lote) return err('NO_ENCONTRADO', 'No encontramos esa carga de recibos.');
        var recibos = repo.recibosDeLote(id);
        if (recibos.some(function (r) { return r.conforme; })) return err('VALIDACION', 'No se puede eliminar: hay colaboradores que ya confirmaron «Recibí conforme».');
        repo.eliminarLote(lote, recibos);
        repo.log('RECIBOS_ELIMINADOS', s.clave, id + ' · ' + lote.concepto);
        return ok({ id: id });
      }
    
      function listarLotes(repo, ctx, token) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var porLote = {};
        repo.todosRecibos().forEach(function (r) { (porLote[r.lote] = porLote[r.lote] || []).push(r); });
        return ok(repo.lotes().sort(function (a, b) { return b.creado - a.creado; }).map(function (l) { return vistaLote(l, porLote[l.id] || []); }));
      }
    
      function detalleLote(repo, ctx, token, id) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var lote = repo.lotePorId(id);
        if (!lote) return err('NO_ENCONTRADO', 'No encontramos esa carga de recibos.');
        var recibos = repo.recibosDeLote(id);
        return ok({ lote: vistaLote(lote, recibos), recibos: recibos.sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; }).map(function (r) {
          return { id: r.id, clave: r.clave, nombre: r.nombre, pagina: r.pagina, visto: r.visto || 0, conforme: r.conforme || 0 };
        }) });
      }
    
      /** RRHH abre el recibo de cualquier persona (no cuenta como visto por el colaborador). */
      function verReciboRRHH(repo, ctx, token, id) {
        if (!leerToken(ctx, token, ['RRHH', 'ADMIN'])) return err('SESION', 'No autorizado.');
        var r = repo.reciboPorId(id), lote = r && repo.lotePorId(r.lote);
        if (!r || !lote) return err('NO_ENCONTRADO', 'No encontramos ese recibo.');
        return ok({ pdf: repo.leerArchivoRecibo(r.archivo), archivo: 'Recibo ' + lote.concepto + ' - ' + r.nombre + '.pdf' });
      }
    
      function misRecibos(repo, ctx, token) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var lotes = {};
        repo.lotes().forEach(function (l) { if (l.estado === 'PUBLICADO') lotes[l.id] = l; });
        return ok(repo.recibosDe(s.clave).filter(function (r) { return lotes[r.lote]; }).map(function (r) {
          var l = lotes[r.lote];
          return { id: r.id, concepto: l.concepto, empresa: l.empresa, publicado: l.publicado, visto: r.visto || 0, conforme: r.conforme || 0 };
        }).sort(function (a, b) { return b.publicado - a.publicado; }));
      }
    
      function reciboPropio(repo, s, id) {
        var r = repo.reciboPorId(id), lote = r && repo.lotePorId(r.lote);
        return r && lote && r.clave === s.clave && lote.estado === 'PUBLICADO' ? { r: r, lote: lote } : null;
      }
    
      /** El colaborador abre su recibo: la primera vez queda la fecha en que lo vio. */
      function verRecibo(repo, ctx, token, id) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var x = reciboPropio(repo, s, id);
        if (!x) return err('NO_ENCONTRADO', 'No encontramos ese recibo.');
        if (!x.r.visto) { x.r.visto = ctx.ahora(); repo.guardarRecibo(x.r); }
        return ok({ pdf: repo.leerArchivoRecibo(x.r.archivo), archivo: 'Recibo ' + x.lote.concepto + '.pdf', visto: x.r.visto, conforme: x.r.conforme || 0 });
      }
    
      /** «Recibí conforme»: el sello de entrega, con fecha y hora. */
      function confirmarRecibo(repo, ctx, token, id) {
        var s = leerToken(ctx, token, ['TRABAJADOR']);
        if (!s) return err('SESION', 'Tu sesión venció. Entra de nuevo.');
        var x = reciboPropio(repo, s, id);
        if (!x) return err('NO_ENCONTRADO', 'No encontramos ese recibo.');
        if (!x.r.conforme) {
          x.r.visto = x.r.visto || ctx.ahora(); x.r.conforme = ctx.ahora();
          repo.guardarRecibo(x.r);
          repo.log('RECIBO_CONFORME', s.clave, x.r.id + ' · ' + x.lote.concepto);
        }
        return ok({ id: x.r.id, visto: x.r.visto, conforme: x.r.conforme });
      }
    
      var api = {
        iniciarSesion: iniciarSesion, iniciarSesionAdmin: iniciarSesionAdmin,
        panelSaldosVacaciones: panelSaldosVacaciones, guardarPlanificacionVac: guardarPlanificacionVac, listarPlanificacionesVac: listarPlanificacionesVac,
        miPlanificacion: miPlanificacion, guardarMiPlanificacion: guardarMiPlanificacion, equipoPlanificacion: equipoPlanificacion,
        decidirPlanificacion: decidirPlanificacion, panelPlanificacionVac: panelPlanificacionVac, recordarPlanificacionVac: recordarPlanificacionVac,
        misNotificaciones: misNotificaciones, marcarNotificacionesLeidas: marcarNotificacionesLeidas, avisoDePrueba: avisoDePrueba, registrarDispositivo: registrarDispositivo, avisosDiarios: avisosDiarios, idPush: idPush,
        asignarRecibos: asignarRecibos, crearLoteRecibos: crearLoteRecibos, subirRecibos: subirRecibos, publicarLote: publicarLote, eliminarLote: eliminarLote,
        listarLotes: listarLotes, detalleLote: detalleLote, verReciboRRHH: verReciboRRHH, misRecibos: misRecibos, verRecibo: verRecibo, confirmarRecibo: confirmarRecibo,
        crearPin: crearPin, restablecerPin: restablecerPin, revisarPin: revisarPin,
        miEstadoDeCuenta: miEstadoDeCuenta, solicitarAnticipo: solicitarAnticipo, cancelarAnticipo: cancelarAnticipo,
        estadoAporte: estadoAporte, prepararAporte: prepararAporte, cerrarAporte: cerrarAporte, archivoAporte: archivoAporte,
        candidatosCancelacion: candidatosCancelacion, listarCancelaciones: listarCancelaciones, registrarCancelacion: registrarCancelacion,
        archivoCancelaciones: archivoCancelaciones, marcarCancelaciones: marcarCancelaciones,
        datosAnticipo: datosAnticipo, rechazarAnticipoBanco: rechazarAnticipoBanco,
        listarAperturas: listarAperturas, guardarApertura: guardarApertura, eliminarApertura: eliminarApertura,
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
var VERSION = '2026-11-06.5';
var AVISO_CODIGO = 'El proyecto de Apps Script no tiene el código completo. Copia el archivo apps-script/RRHH.gs del repositorio (más de 80 KB y 1.500 líneas; no uses src/api.gs), pégalo como único archivo y publica una nueva versión.';
var MODULOS = ['Calculo', 'Empleados', 'Prestaciones', 'Exportes', 'Constancia', 'Vacaciones', 'Aportes', 'Recibos', 'Planificacion', 'Servicio'];

/** Qué módulos están cargados (se nombran uno a uno: no se busca por texto en el global). */
function modulosCargados_() {
  return {
    Calculo: typeof Calculo !== 'undefined' && !!Calculo, Empleados: typeof Empleados !== 'undefined' && !!Empleados,
    Prestaciones: typeof Prestaciones !== 'undefined' && !!Prestaciones, Exportes: typeof Exportes !== 'undefined' && !!Exportes,
    Constancia: typeof Constancia !== 'undefined' && !!Constancia, Vacaciones: typeof Vacaciones !== 'undefined' && !!Vacaciones,
    Aportes: typeof Aportes !== 'undefined' && !!Aportes, Recibos: typeof Recibos !== 'undefined' && !!Recibos,
    Planificacion: typeof Planificacion !== 'undefined' && !!Planificacion,
    Servicio: typeof Servicio !== 'undefined' && !!Servicio,
  };
}

var HOJAS = {
  PARAMETROS: ['clave', 'valor'],
  EMPRESAS: ['empresa', 'fideicomiso', 'tipoTAporte', 'tipoTAnticipo', 'forma'],
  EMPLEADOS: ['cedulaLetra', 'cedulaNumero', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'empresaFideicomiso', 'revisarCedula', 'editados', 'motivoRevision', 'jefe', 'salarioMensual', 'genero', 'fueraNomina'],
  APORTES: ['clave', 'anio', 'trimestre', 'empresa', 'total', 'monto', 'meses', 'diasAdicionales', 'adicionalesForzados', 'nuevo',
    'nombre', 'salarioDiario', 'alicUtilidades', 'alicVacaciones', 'diasVacaciones', 'diasAntiguedad'],
  CANCELACIONES: ['id', 'clave', 'nombre', 'empresa', 'fechaIngreso', 'fechaEgreso', 'monto', 'estado', 'creada', 'por', 'actualizada'],
  CIERRES: ['anio', 'trimestre', 'empresa', 'estado', 'por', 'actualizado'],
  ANTICIPOS: ['id', 'clave', 'monto', 'motivo', 'detalle', 'estado', 'creada', 'actualizada', 'decididaPor', 'motivoRechazo', 'ventana', 'acepto'],
  CONSTANCIAS: ['id', 'clave', 'nombre', 'cedula', 'empresa', 'cargo', 'organizacion', 'fechaIngreso', 'salario', 'emision', 'vence', 'estado', 'emitidaPor'],
  APERTURAS_ANTICIPO: ['id', 'clave', 'inicio', 'fin', 'por', 'actualizada'],
  FERIADOS: ['fecha', 'motivo'],
  VAC_PERIODOS: ['clave', 'periodo', 'correspondientes', 'disfrutadosPrevios'],
  VAC_SOLICITUDES: ['id', 'clave', 'inicio', 'culminacion', 'reintegro', 'dias', 'condicion', 'imputacion', 'estado', 'jefe', 'creada', 'actualizada',
    'decididaJefePor', 'decisionJefe', 'registradaPor', 'registrada', 'nomina', 'motivoRechazo', 'numeroConstancia', 'pendientesDespues', 'planificada'],
  VAC_CICLOS: ['id', 'nombre', 'desde', 'hasta', 'abre', 'cierra', 'creada', 'por', 'actualizada'],
  VAC_PLANES: ['id', 'ciclo', 'clave', 'estado', 'bloques', 'requeridos', 'planificados', 'jefe', 'enviada', 'decidida', 'decididaPor', 'motivo', 'actualizada'],
  USUARIOS: ['cedula', 'sal', 'hash', 'rol', 'nombre'],
  NOTIFICACIONES: ['id', 'clave', 'tipo', 'titulo', 'texto', 'ruta', 'creada'],
  NOTIF_LECTURAS: ['clave', 'hasta'],
  RECIBOS_LOTES: ['id', 'concepto', 'empresa', 'total', 'estado', 'creado', 'por', 'publicado'],
  PUSH_DISPOSITIVOS: ['pushId', 'suscripcion', 'tipo', 'creado'],
  RECIBOS: ['id', 'lote', 'clave', 'nombre', 'pagina', 'archivo', 'creado', 'visto', 'conforme'],
  PINES: ['clave', 'sal', 'hash', 'creado'],
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

// Feriados nacionales de Venezuela de 2026 a 2030 (Carnaval y Semana Santa se calculan con la fecha de Pascua).
// La lista 2026 de RRHH quedó igual: 12 de octubre (no 10/12) y con 5 y 24 de julio.
var FERIADOS_DESDE = 2026, FERIADOS_HASTA = 2030;
function feriadosIniciales_() {
  var l = [];
  for (var y = FERIADOS_DESDE; y <= FERIADOS_HASTA; y++) l = l.concat(Vacaciones.feriadosVenezuela(y));
  return l;
}

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
  login: function (repo, ctx, d) { return Servicio.iniciarSesion(repo, ctx, d.cedula, d.pin); },
  crearPin: function (repo, ctx, d) { return Servicio.crearPin(repo, ctx, d.cedula, d.pin, d.confirmacion); },
  estadoDeCuenta: function (repo, ctx, d) { return Servicio.miEstadoDeCuenta(repo, ctx, d.token); },
  solicitarAnticipo: function (repo, ctx, d) { return Servicio.solicitarAnticipo(repo, ctx, d.token, d); },
  cancelarAnticipo: function (repo, ctx, d) { return Servicio.cancelarAnticipo(repo, ctx, d.token, d.id); },
  misNotificaciones: function (repo, ctx, d) { return Servicio.misNotificaciones(repo, ctx, d.token); },
  miPlanificacion: function (repo, ctx, d) { return Servicio.miPlanificacion(repo, ctx, d.token); },
  guardarMiPlanificacion: function (repo, ctx, d) { return Servicio.guardarMiPlanificacion(repo, ctx, d.token, d); },
  equipoPlanificacion: function (repo, ctx, d) { return Servicio.equipoPlanificacion(repo, ctx, d.token); },
  decidirPlanificacion: function (repo, ctx, d) { return Servicio.decidirPlanificacion(repo, ctx, d.token, d.id, !!d.aprobar, d.motivo); },
  avisoDePrueba: function (repo, ctx, d) { return Servicio.avisoDePrueba(repo, ctx, d.token); },
  registrarDispositivo: function (repo, ctx, d) { return Servicio.registrarDispositivo(repo, ctx, d.token, d); },
  marcarNotificacionesLeidas: function (repo, ctx, d) { return Servicio.marcarNotificacionesLeidas(repo, ctx, d.token); },
  misRecibos: function (repo, ctx, d) { return Servicio.misRecibos(repo, ctx, d.token); },
  verRecibo: function (repo, ctx, d) { return Servicio.verRecibo(repo, ctx, d.token, d.id); },
  confirmarRecibo: function (repo, ctx, d) { return Servicio.confirmarRecibo(repo, ctx, d.token, d.id); },
};

var RUTAS_RRHH = {
  asignarRecibos: function (repo, ctx, d) { return Servicio.asignarRecibos(repo, ctx, d.token, d.hojas); },
  crearLoteRecibos: function (repo, ctx, d) { return Servicio.crearLoteRecibos(repo, ctx, d.token, d); },
  subirRecibos: function (repo, ctx, d) { return Servicio.subirRecibos(repo, ctx, d.token, d); },
  publicarLote: function (repo, ctx, d) { return Servicio.publicarLote(repo, ctx, d.token, d.id); },
  eliminarLote: function (repo, ctx, d) { return Servicio.eliminarLote(repo, ctx, d.token, d.id); },
  listarLotes: function (repo, ctx, d) { return Servicio.listarLotes(repo, ctx, d.token); },
  detalleLote: function (repo, ctx, d) { return Servicio.detalleLote(repo, ctx, d.token, d.id); },
  verReciboRRHH: function (repo, ctx, d) { return Servicio.verReciboRRHH(repo, ctx, d.token, d.id); },
  restablecerPin: function (repo, ctx, d) { return Servicio.restablecerPin(repo, ctx, d.token, d.clave); },
  guardarEmpleadoFueraNomina: function (repo, ctx, d) { return Servicio.guardarEmpleadoFueraNomina(repo, ctx, d.token, d); },
  desactivarEmpleadoFueraNomina: function (repo, ctx, d) { return Servicio.desactivarEmpleadoFueraNomina(repo, ctx, d.token, d.clave); },
  listarUsuariosJefes: function (repo, ctx, d) { return Servicio.listarUsuariosJefes(repo, ctx, d.token); },
  estadoAporte: function (repo, ctx, d) { return Servicio.estadoAporte(repo, ctx, d.token, d); },
  prepararAporte: function (repo, ctx, d) { return Servicio.prepararAporte(repo, ctx, d.token, d); },
  cerrarAporte: function (repo, ctx, d) { return Servicio.cerrarAporte(repo, ctx, d.token, d); },
  archivoAporte: function (repo, ctx, d) { return Servicio.archivoAporte(repo, ctx, d.token, d); },
  candidatosCancelacion: function (repo, ctx, d) { return Servicio.candidatosCancelacion(repo, ctx, d.token); },
  listarCancelaciones: function (repo, ctx, d) { return Servicio.listarCancelaciones(repo, ctx, d.token); },
  registrarCancelacion: function (repo, ctx, d) { return Servicio.registrarCancelacion(repo, ctx, d.token, d); },
  archivoCancelaciones: function (repo, ctx, d) { return Servicio.archivoCancelaciones(repo, ctx, d.token, d.empresa); },
  marcarCancelaciones: function (repo, ctx, d) { return Servicio.marcarCancelaciones(repo, ctx, d.token, d.ids || [], d.estado); },
  listarAperturas: function (repo, ctx, d) { return Servicio.listarAperturas(repo, ctx, d.token); },
  guardarApertura: function (repo, ctx, d) { return Servicio.guardarApertura(repo, ctx, d.token, d); },
  eliminarApertura: function (repo, ctx, d) { return Servicio.eliminarApertura(repo, ctx, d.token, d.id); },
  rechazarAnticipoBanco: function (repo, ctx, d) { return Servicio.rechazarAnticipoBanco(repo, ctx, d.token, d.id, d.motivo); },
  bandejaVacaciones: function (repo, ctx, d) { return Servicio.bandejaVacaciones(repo, ctx, d.token, d.estado); },
  registrarVacaciones: function (repo, ctx, d) { return Servicio.registrarVacaciones(repo, ctx, d.token, d.id, d.nomina); },
  rechazarVacacionesRRHH: function (repo, ctx, d) { return Servicio.rechazarVacacionesRRHH(repo, ctx, d.token, d.id, d.motivo); },
  importarCierreVacaciones: function (repo, ctx, d) { return Servicio.importarCierreVacaciones(repo, ctx, d.token, d.personas); },
  panelSaldosVacaciones: function (repo, ctx, d) { return Servicio.panelSaldosVacaciones(repo, ctx, d.token); },
  guardarPlanificacionVac: function (repo, ctx, d) { return Servicio.guardarPlanificacionVac(repo, ctx, d.token, d); },
  listarPlanificacionesVac: function (repo, ctx, d) { return Servicio.listarPlanificacionesVac(repo, ctx, d.token); },
  panelPlanificacionVac: function (repo, ctx, d) { return Servicio.panelPlanificacionVac(repo, ctx, d.token, d.ciclo); },
  recordarPlanificacionVac: function (repo, ctx, d) { return Servicio.recordarPlanificacionVac(repo, ctx, d.token, d.ciclo); },
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
  login: 1, loginAdmin: 1, estadoDeCuenta: 1, datosAnticipo: 1, listarAperturas: 1,
  estadoAporte: 1, prepararAporte: 1, archivoAporte: 1, candidatosCancelacion: 1, listarCancelaciones: 1, misConstancias: 1, verificarConstancia: 1, datosVacaciones: 1, equipoVacaciones: 1,
  bandejaAnticipos: 1, bandejaVacaciones: 1, listarEmpleados: 1, listarConstancias: 1, listarUsuariosJefes: 1, saldoVacacionesEmpleado: 1,
  misNotificaciones: 1, misRecibos: 1, panelSaldosVacaciones: 1, listarPlanificacionesVac: 1, panelPlanificacionVac: 1, miPlanificacion: 1, equipoPlanificacion: 1, asignarRecibos: 1, listarLotes: 1, detalleLote: 1, verReciboRRHH: 1,
  // Guarda los PDF en Drive (lento) sin hacer esperar a los demás; solo bloquea un instante al anotar las filas.
  subirRecibos: 1,
};

function doPost(e) {
  var lock = LockService.getScriptLock(), bloqueado = false;
  memo_ = {}; constanciasCache = null; ingresosEmpleados_ = null;   // en Google cada petición empieza de cero; así también en el simulador
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!LECTURAS[d.action]) {
      if (!lock.tryLock(15000)) return salida_({ ok: false, code: 'OCUPADO', message: 'Hay muchas solicitudes guardándose en este momento. Intenta de nuevo en unos segundos.' });
      bloqueado = true;
    }
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
var CACHEABLES = { EMPLEADOS: 1, USUARIOS: 1, PARAMETROS: 1, FERIADOS: 1, EMPRESAS: 1, VAC_PERIODOS: 1, APERTURAS_ANTICIPO: 1 };
var CACHE_SEGUNDOS = 21600, CACHE_TROZO = 90000;
var memo_ = {};

function valores_(nombre) {
  if (memo_[nombre]) return memo_[nombre];
  var vals = CACHEABLES[nombre] ? leerCache_(nombre) : null;
  if (!vals) {
    var pre = CACHEABLES[nombre] ? prefijoCache_(nombre) : '';   // versión ANTES de leer: si alguien escribe mientras, esta copia queda en una versión vieja que nadie usa
    vals = hoja_(nombre).getDataRange().getValues();
    if (CACHEABLES[nombre]) guardarCache_(pre, vals);
  }
  return (memo_[nombre] = vals);
}

function leerCache_(nombre) {
  try {
    var c = CacheService.getScriptCache(), pre = prefijoCache_(nombre), partes = Number(c.get(pre + 'partes'));
    if (!partes) return null;
    var txt = '';
    for (var i = 0; i < partes; i++) { var p = c.get(pre + i); if (p == null) return null; txt += p; }
    return JSON.parse(txt);
  } catch (e) { return null; }
}

/** Cada hoja tiene un número de versión en la caché; escribir en ella lo cambia y así nunca se usa una copia vieja. */
function prefijoCache_(nombre) {
  if (!memo_['v:' + nombre]) {
    var v = null;
    try { v = CacheService.getScriptCache().get('ver:' + nombre); } catch (e) { /* sin caché */ }
    memo_['v:' + nombre] = v || '0';
  }
  return 'hoja:' + nombre + ':' + memo_['v:' + nombre] + ':';
}

function guardarCache_(pre, vals) {
  try {
    var txt = JSON.stringify(vals, function (k, v) {
      var o = this[k];
      return o instanceof Date ? Utilities.formatDate(o, 'America/Caracas', "yyyy-MM-dd'T'HH:mm:ss") : v;
    });
    if (txt.length > CACHE_TROZO * 50) return;   // demasiado grande: se lee siempre de la hoja
    var c = CacheService.getScriptCache(), n = Math.ceil(txt.length / CACHE_TROZO) || 1;
    for (var i = 0; i < n; i++) c.put(pre + i, txt.slice(i * CACHE_TROZO, (i + 1) * CACHE_TROZO), CACHE_SEGUNDOS);
    c.put(pre + 'partes', String(n), CACHE_SEGUNDOS);
  } catch (e) { /* sin caché: no pasa nada, se lee de la hoja */ }
}

function invalidar_(nombre) {
  delete memo_[nombre]; delete memo_['v:' + nombre];
  if (CACHEABLES[nombre]) try { CacheService.getScriptCache().put('ver:' + nombre, String(Date.now()) + Math.floor(Math.random() * 1000), CACHE_SEGUNDOS); } catch (e) { /* sin caché */ }
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

function aporte_(f) {
  return {
    clave: texto_(f.clave), nombre: texto_(f.nombre), anio: Number(f.anio), trimestre: Number(f.trimestre), empresa: texto_(f.empresa), total: Number(f.total) || 0,
    monto: Number(f.monto) || 0, meses: Number(f.meses) || 0, diasAdicionales: Number(f.diasAdicionales) || 0,
    adicionalesForzados: f.adicionalesForzados === true || f.adicionalesForzados === 'TRUE' || f.adicionalesForzados === 'true',
    nuevo: f.nuevo === true || f.nuevo === 'TRUE' || f.nuevo === 'true', salarioDiario: Number(f.salarioDiario) || 0, alicUtilidades: Number(f.alicUtilidades) || 0,
    alicVacaciones: Number(f.alicVacaciones) || 0, diasVacaciones: Number(f.diasVacaciones) || 0, diasAntiguedad: Number(f.diasAntiguedad) || 0,
  };
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
    nomina: texto_(f.nomina), motivoRechazo: texto_(f.motivoRechazo), numeroConstancia: texto_(f.numeroConstancia), pendientesDespues: pend, planificada: texto_(f.planificada),
  };
}

/**
 * Fecha de ingreso guardada en la constancia, siempre como «dd/mm/aaaa». Si Sheets la convirtió en fecha (filas
 * guardadas antes de dejar la columna como texto), se toma la del empleado: así no se cuela un cambio de día y mes.
 */
var ingresosEmpleados_ = null;
function fechaIngresoConstancia_(f) {
  var t = texto_(f.fechaIngreso).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  if (!ingresosEmpleados_) {
    ingresosEmpleados_ = {};
    leer_('EMPLEADOS').forEach(function (e) { var x = empleado_(e); if (x.fechaIngreso) ingresosEmpleados_[x.cedulaLetra + x.cedulaNumero] = fechaTexto_(x.fechaIngreso); });
  }
  if (ingresosEmpleados_[texto_(f.clave)]) return ingresosEmpleados_[texto_(f.clave)];
  return f.fechaIngreso instanceof Date ? Utilities.formatDate(f.fechaIngreso, 'America/Caracas', 'dd/MM/yyyy') : t;
}

var constanciasCache = null;
function constancias_() {
  return constanciasCache || (constanciasCache = leer_('CONSTANCIAS').map(function (f) {
    return {
      _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), nombre: texto_(f.nombre), cedula: texto_(f.cedula), empresa: texto_(f.empresa),
      cargo: texto_(f.cargo), organizacion: texto_(f.organizacion), fechaIngreso: fechaIngresoConstancia_(f), salario: Number(f.salario),
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
    guardarConstancia: function (c) {
      // la fecha de ingreso como texto: si no, Sheets la convierte en fecha (y puede cambiar día por mes)
      var h = hoja_('CONSTANCIAS'), col = HOJAS.CONSTANCIAS.indexOf('fechaIngreso') + 1;
      h.getRange(c._fila || h.getLastRow() + 1, col).setNumberFormat('@');
      escribirFila_('CONSTANCIAS', c); constanciasCache = null;
    },
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
    todosAnticipos: function () { return anticiposTodos(); },
    todosAportes: function () { return leer_('APORTES').map(aporte_); },
    aportesPeriodo: function (anio, trimestre, empresa) {
      return leer_('APORTES').map(aporte_).filter(function (a) { return a.anio === anio && a.trimestre === trimestre && a.empresa === empresa; });
    },
    /** Reemplaza las líneas de un período (no duplica): reescribe la hoja sin las del período y agrega las nuevas. */
    reemplazarAportes: function (anio, trimestre, empresa, filas) {
      var h = hoja_('APORTES'), cab = HOJAS.APORTES;
      var resto = leer_('APORTES').filter(function (a) { return !(Number(a.anio) === anio && Number(a.trimestre) === trimestre && a.empresa === empresa); });
      var todas = resto.map(function (a) { return cab.map(function (c) { return a[c] == null ? '' : a[c]; }); })
        .concat(filas.map(function (f) { return cab.map(function (c) { return f[c] == null ? '' : f[c]; }); }));
      var ultima = h.getLastRow();
      if (ultima > 1) h.getRange(2, 1, ultima - 1, cab.length).clearContent();
      if (todas.length) { h.getRange(2, 1, todas.length, 1).setNumberFormat('@'); h.getRange(2, 1, todas.length, cab.length).setValues(todas); }
      invalidar_('APORTES');
    },
    cancelaciones: function () {
      return leer_('CANCELACIONES').map(function (f) {
        return { _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), nombre: texto_(f.nombre), empresa: texto_(f.empresa), fechaIngreso: texto_(f.fechaIngreso),
          fechaEgreso: texto_(f.fechaEgreso), monto: f.monto === '' ? '' : Number(f.monto), estado: texto_(f.estado), creada: Number(f.creada) || 0, por: texto_(f.por), actualizada: Number(f.actualizada) || 0 };
      }).filter(function (c) { return c.id; });
    },
    guardarCancelacion: function (c) {
      if (!c._fila) { var h = hoja_('CANCELACIONES'); h.getRange(h.getLastRow() + 1, 1, 1, 6).setNumberFormat('@'); }
      escribirFila_('CANCELACIONES', c);
    },
    nuevoIdCancelacion: function () { return 'CAN-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },
    aperturasAnticipo: function () {
      return leer_('APERTURAS_ANTICIPO').map(function (f) {
        return { _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), inicio: fechaIso_(f.inicio), fin: fechaIso_(f.fin), por: texto_(f.por), actualizada: Number(f.actualizada) || 0 };
      }).filter(function (c) { return c.id; });
    },
    guardarAperturaAnticipo: function (c) {
      if (!c._fila) { var h = hoja_('APERTURAS_ANTICIPO'); h.getRange(h.getLastRow() + 1, 1, 1, 4).setNumberFormat('@'); }
      escribirFila_('APERTURAS_ANTICIPO', c);
    },
    /* ---- PIN de los colaboradores (hoja PINES: solo la huella con sal, nunca el PIN) ---- */
    pinDe: function (clave) {
      asegurarHojaPines_();
      var f = leer_('PINES').filter(function (x) { return texto_(x.clave) === clave; })[0];
      return f && texto_(f.hash) ? { sal: texto_(f.sal), hash: texto_(f.hash) } : null;
    },
    guardarPin: function (clave, d) {
      asegurarHojaPines_();
      var f = leer_('PINES').filter(function (x) { return texto_(x.clave) === clave; })[0];
      if (!f) { var h = hoja_('PINES'); h.getRange(h.getLastRow() + 1, 1, 1, 3).setNumberFormat('@'); }
      escribirFila_('PINES', { _fila: f ? f._fila : 0, clave: clave, sal: d.sal, hash: d.hash, creado: d.creado });
    },
    borrarPin: function (clave) {
      asegurarHojaPines_();
      var f = leer_('PINES').filter(function (x) { return texto_(x.clave) === clave; })[0];
      if (f) { hoja_('PINES').deleteRow(f._fila); invalidar_('PINES'); }
    },
    eliminarAperturaAnticipo: function (id) {
      var f = leer_('APERTURAS_ANTICIPO').filter(function (x) { return texto_(x.id) === id; })[0];
      if (f) { hoja_('APERTURAS_ANTICIPO').deleteRow(f._fila); invalidar_('APERTURAS_ANTICIPO'); }
    },
    nuevoIdApertura: function () { return 'AP-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },
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

    /* ---- Notificaciones ---- */
    agregarNotificaciones: function (lista) { agregarFilas_('NOTIFICACIONES', lista); },
    nuevoIdNotificacion: function () { return 'N-' + Utilities.getUuid().slice(0, 13).toUpperCase(); },
    /** Solo las últimas 3.000 filas: la campanita muestra los avisos de los últimos 60 días. */
    notificacionesRecientes: function () {
      var h = hoja_('NOTIFICACIONES'), ultima = h.getLastRow(), cab = HOJAS.NOTIFICACIONES;
      if (ultima < 2) return [];
      var desde = Math.max(2, ultima - 2999);
      return h.getRange(desde, 1, ultima - desde + 1, cab.length).getValues().map(function (f) {
        return { id: texto_(f[0]), clave: texto_(f[1]), tipo: texto_(f[2]), titulo: texto_(f[3]), texto: texto_(f[4]), ruta: texto_(f[5]), creada: Number(f[6]) || 0 };
      });
    },
    notificacionesLeidasHasta: function (d) {
      var f = leer_('NOTIF_LECTURAS').filter(function (x) { return texto_(x.clave) === d; })[0];
      return f ? Number(f.hasta) || 0 : 0;
    },
    marcarNotificacionesLeidas: function (d, t) {
      var f = leer_('NOTIF_LECTURAS').filter(function (x) { return texto_(x.clave) === d; })[0];
      if (!f) { var h = hoja_('NOTIF_LECTURAS'); h.getRange(h.getLastRow() + 1, 1).setNumberFormat('@'); }
      escribirFila_('NOTIF_LECTURAS', { _fila: f ? f._fila : 0, clave: d, hasta: t });
    },
    enviarPush: enviarPush_,
    registrarSuscripcionPush: registrarSuscripcionPush_,

    /* ---- Planificación de vacaciones ---- */
    vacCiclos: function () {
      asegurarHoja_('VAC_CICLOS'); asegurarHoja_('VAC_PLANES');   // por si aún no se corrió «Configurar hojas»
      return leer_('VAC_CICLOS').filter(function (f) { return texto_(f.id); }).map(function (f) {
        return { _fila: f._fila, id: texto_(f.id), nombre: texto_(f.nombre), desde: fechaIso_(f.desde), hasta: fechaIso_(f.hasta), abre: fechaIso_(f.abre),
          cierra: fechaIso_(f.cierra), creada: Number(f.creada) || 0, por: texto_(f.por), actualizada: Number(f.actualizada) || 0 };
      });
    },
    guardarVacCiclo: function (c) {
      if (!c._fila) { var h = hoja_('VAC_CICLOS'); h.getRange(h.getLastRow() + 1, 1, 1, 6).setNumberFormat('@'); }
      else hoja_('VAC_CICLOS').getRange(c._fila, 1, 1, 6).setNumberFormat('@');
      escribirFila_('VAC_CICLOS', c);
    },
    nuevoIdCiclo: function () { return 'PVC-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },
    vacPlanes: function (ciclo) { return leer_('VAC_PLANES').map(plan_).filter(function (p) { return p.ciclo === ciclo; }); },
    vacPlan: function (ciclo, clave) { return leer_('VAC_PLANES').map(plan_).filter(function (p) { return p.ciclo === ciclo && p.clave === clave; })[0] || null; },
    vacPlanPorId: function (id) { return leer_('VAC_PLANES').map(plan_).filter(function (p) { return p.id === id; })[0] || null; },
    guardarVacPlan: function (p) {
      var copia = Object.assign({}, p, { bloques: JSON.stringify(p.bloques || []) });
      if (!copia._fila) { var h = hoja_('VAC_PLANES'); h.getRange(h.getLastRow() + 1, 1, 1, 3).setNumberFormat('@'); }
      escribirFila_('VAC_PLANES', copia);
      p._fila = copia._fila;
    },
    nuevoIdPlan: function () { return 'PLN-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },

    /* ---- Recibos de pago ---- */
    nuevoIdLote: function () { return 'LOT-' + Utilities.getUuid().slice(0, 8).toUpperCase(); },
    nuevoIdRecibo: function () { return 'REC-' + Utilities.getUuid().slice(0, 13).toUpperCase(); },
    lotes: function () { return leer_('RECIBOS_LOTES').map(lote_).filter(function (l) { return l.id; }); },
    lotePorId: function (id) { return leer_('RECIBOS_LOTES').map(lote_).filter(function (l) { return l.id === id; })[0] || null; },
    guardarLote: function (l) { escribirFila_('RECIBOS_LOTES', l); },
    todosRecibos: function () { return leer_('RECIBOS').map(recibo_).filter(function (r) { return r.id; }); },
    recibosDeLote: function (id) { return leer_('RECIBOS').map(recibo_).filter(function (r) { return r.lote === id; }); },
    recibosDe: function (clave) { return leer_('RECIBOS').map(recibo_).filter(function (r) { return r.clave === clave; }); },
    reciboPorId: function (id) { return leer_('RECIBOS').map(recibo_).filter(function (r) { return r.id === id; })[0] || null; },
    agregarRecibos: function (lista) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { agregarFilas_('RECIBOS', lista); } finally { lock.releaseLock(); }
    },
    guardarRecibo: function (r) { escribirFila_('RECIBOS', r); },
    guardarArchivoRecibo: function (nombre, b64) {
      var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', nombre);
      return carpetaRecibos_().createFile(blob).getId();
    },
    leerArchivoRecibo: function (id) { return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); },
    eliminarLote: function (lote, recibos) {
      recibos.forEach(function (r) { try { DriveApp.getFileById(r.archivo).setTrashed(true); } catch (e) { /* ya no estaba */ } });
      var ids = {}; recibos.forEach(function (r) { ids[r.id] = true; });
      quitarFilas_('RECIBOS', function (f) { return ids[texto_(f.id)]; });
      quitarFilas_('RECIBOS_LOTES', function (f) { return texto_(f.id) === lote.id; });
    },
  };
}

function plan_(f) {
  var b = [];
  try { b = f.bloques ? JSON.parse(f.bloques) : []; } catch (e) { /* vacío */ }
  return { _fila: f._fila, id: texto_(f.id), ciclo: texto_(f.ciclo), clave: texto_(f.clave), estado: texto_(f.estado), bloques: b,
    requeridos: Number(f.requeridos) || 0, planificados: Number(f.planificados) || 0, jefe: texto_(f.jefe), enviada: Number(f.enviada) || 0,
    decidida: Number(f.decidida) || 0, decididaPor: texto_(f.decididaPor), motivo: texto_(f.motivo), actualizada: Number(f.actualizada) || 0 };
}

function lote_(f) {
  return { _fila: f._fila, id: texto_(f.id), concepto: texto_(f.concepto), empresa: texto_(f.empresa), total: Number(f.total) || 0, estado: texto_(f.estado),
    creado: Number(f.creado) || 0, por: texto_(f.por), publicado: Number(f.publicado) || 0 };
}

function recibo_(f) {
  return { _fila: f._fila, id: texto_(f.id), lote: texto_(f.lote), clave: texto_(f.clave), nombre: texto_(f.nombre), pagina: Number(f.pagina) || 0,
    archivo: texto_(f.archivo), creado: Number(f.creado) || 0, visto: Number(f.visto) || 0, conforme: Number(f.conforme) || 0 };
}

/** Agrega varias filas de una vez (mucho más rápido que appendRow una por una). */
function agregarFilas_(nombre, lista) {
  if (!lista.length) return;
  var h = hoja_(nombre), cab = HOJAS[nombre], desde = h.getLastRow() + 1;
  var r = h.getRange(desde, 1, lista.length, cab.length);
  r.setNumberFormat('@');
  r.setValues(lista.map(function (o) { return cab.map(function (c) { return o[c] == null ? '' : String(o[c]); }); }));
  invalidar_(nombre);
}

/** Reescribe la hoja sin las filas que cumplen la condición. */
function quitarFilas_(nombre, condicion) {
  var h = hoja_(nombre), cab = HOJAS[nombre];
  var quedan = leer_(nombre).filter(function (f) { return !condicion(f); }).map(function (f) { return cab.map(function (c) { return f[c] == null ? '' : f[c]; }); });
  var ultima = h.getLastRow();
  if (ultima > 1) h.getRange(2, 1, ultima - 1, cab.length).clearContent();
  if (quedan.length) { var r = h.getRange(2, 1, quedan.length, cab.length); r.setNumberFormat('@'); r.setValues(quedan); }
  invalidar_(nombre);
}

/** Carpeta de Drive donde se guardan los recibos (privada: solo la ve la cuenta dueña del Apps Script). */
function carpetaRecibos_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('RECIBOS_CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* la borraron: se crea otra */ } }
  var c = DriveApp.createFolder('CAC · Recibos de pago');
  props.setProperty('RECIBOS_CARPETA', c.getId());
  return c;
}

/**
 * Notificación al celular con OneSignal (si está configurado en el menú RRHH). destinos: identificadores de
 * notificación (no cédulas) o '*' para todos los que activaron los avisos. Si falla, no interrumpe nada.
 */
/** Datos de OneSignal guardados en la hoja, limpios (sin espacios ni comillas). Sin ellos o mal escritos: { error }. */
function configOneSignal_() {
  var props = PropertiesService.getScriptProperties();
  var appId = String(props.getProperty('ONESIGNAL_APP_ID') || '').replace(/[\s'"]/g, '');
  var clave = String(props.getProperty('ONESIGNAL_API_KEY') || '').replace(/[\s'"]/g, '');
  if (!appId || !clave) return { error: 'Falta configurar OneSignal en la hoja (menú RRHH → «3 · Notificaciones al celular»).' };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
    return { error: 'El App ID de OneSignal guardado en la hoja no es válido (debe verse como 97b880ba-f53c-4cb8-…). Vuelve a ponerlo en el menú RRHH → «3».' };
  }
  if (!/^os_v2_[a-z0-9_]{20,}$/i.test(clave)) {
    return { error: 'La REST API Key de OneSignal guardada en la hoja no es válida: debe empezar con «os_v2_app_» (no uses el «Key ID»). Vuelve a ponerla en el menú RRHH → «3».' };
  }
  return { appId: appId, clave: clave, sitio: props.getProperty('CAC_URL') || '' };
}

function pedirOneSignal_(cfg, ruta, cuerpo) {
  var r = UrlFetchApp.fetch('https://api.onesignal.com' + ruta, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Key ' + cfg.clave }, payload: JSON.stringify(cuerpo),
  });
  var texto = r.getContentText(), j = {};
  try { j = JSON.parse(texto); } catch (x) { /* no es JSON */ }
  return { codigo: r.getResponseCode(), json: j, texto: texto };
}
function errorOneSignal_(r) {
  var e = r.json && r.json.errors;
  var txt = e && e.join ? e.map(function (x) { return typeof x === 'string' ? x : (x.title || JSON.stringify(x)); }).join(' ') : r.texto;
  if (r.codigo === 401 || r.codigo === 403) return 'OneSignal no aceptó la REST API Key guardada en la hoja (HTTP ' + r.codigo + '). Crea una nueva en OneSignal (Settings → Keys & IDs → Add key) y ponla en el menú RRHH → «3».';
  return 'HTTP ' + r.codigo + ' · ' + String(txt).slice(0, 200);
}

/**
 * Registra en OneSignal la suscripción de avisos de un dispositivo (la crea el navegador con la clave pública de la app).
 * externalId: identificador de la persona (no es su cédula). El tipo sale del servicio de avisos del dispositivo.
 */
function registrarSuscripcionPush_(externalId, d) {
  var cfg = configOneSignal_();
  if (cfg.error) return { estado: 'SIN_CONFIGURAR', detalle: cfg.error };
  var host = String(d.endpoint).replace(/^https:\/\/([^/]+).*$/, '$1');
  var tipo = /push\.apple\.com$/.test(host) ? 'SafariPush' : /mozilla\.com$/.test(host) ? 'FirefoxPush' : 'ChromePush';
  // OneSignal guarda las llaves en base64 estándar (con + / =); el navegador las entrega en base64url. Si no se
  // convierten, la suscripción queda creada pero OneSignal no le puede enviar (0 destinatarios).
  var b64 = function (x) { x = String(x || '').replace(/-/g, '+').replace(/_/g, '/'); return x + '===='.slice(0, (4 - x.length % 4) % 4); };
  var sub = { type: tipo, token: d.endpoint, enabled: true, notification_types: 1, web_auth: b64(d.auth), web_p256: b64(d.p256dh), sdk: '160700' };
  try {
    var r = pedirOneSignal_(cfg, '/apps/' + cfg.appId + '/users', { identity: { external_id: externalId }, subscriptions: [sub] });
    if (r.codigo === 409) r = pedirOneSignal_(cfg, '/apps/' + cfg.appId + '/users/by/external_id/' + encodeURIComponent(externalId) + '/subscriptions', { subscription: sub });
    if (r.codigo >= 300) { registrarError_(new Error('OneSignal suscripción ' + errorOneSignal_(r))); return { estado: 'ERROR', detalle: errorOneSignal_(r) }; }
    // número de suscripción del dispositivo: los avisos se envían directo a él (más seguro que por usuario)
    var subs = (r.json && r.json.subscriptions) || (r.json && r.json.subscription ? [r.json.subscription] : []);
    var hecha = subs.filter(function (x) { return x && x.token === d.endpoint; })[0] || subs[0];
    if (hecha && hecha.id) guardarDispositivo_(externalId, hecha.id, tipo);
    return { estado: 'REGISTRADO', tipo: tipo };
  } catch (e) { registrarError_(e); return { estado: 'ERROR', detalle: String(e && e.message || e).slice(0, 200) }; }
}

/** Crea la hoja si aún no existe (para no exigir «Configurar hojas» al actualizar). */
function asegurarHoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(nombre)) return;
  var h = ss.insertSheet(nombre);
  h.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]).setFontWeight('bold');
  h.setFrozenRows(1);
}

/** Guarda (o mueve a esta persona) el número de suscripción de un dispositivo. */
function guardarDispositivo_(pushId, suscripcion, tipo) {
  asegurarHoja_('PUSH_DISPOSITIVOS');
  quitarFilas_('PUSH_DISPOSITIVOS', function (f) { return texto_(f.suscripcion) === suscripcion; });
  agregarFilas_('PUSH_DISPOSITIVOS', [{ pushId: pushId, suscripcion: suscripcion, tipo: tipo, creado: Date.now() }]);
}

/** Números de suscripción de los dispositivos de esas personas. */
function suscripcionesDe_(pushIds) {
  asegurarHoja_('PUSH_DISPOSITIVOS');
  var quien = {}; pushIds.forEach(function (p) { quien[p] = true; });
  return leer_('PUSH_DISPOSITIVOS').filter(function (f) { return quien[texto_(f.pushId)]; }).map(function (f) { return texto_(f.suscripcion); });
}

function enviarPush_(destinos, titulo, texto, ruta) {
  var cfg = configOneSignal_();
  if (cfg.error) return { estado: 'SIN_CONFIGURAR', detalle: cfg.error };
  var appId = cfg.appId, clave = cfg.clave;
  if (!destinos || !destinos.length) return { estado: 'SIN_DESTINATARIOS' };
  var sitio = cfg.sitio;
  var cuerpo = { app_id: appId, target_channel: 'push', headings: { en: titulo, es: titulo }, contents: { en: texto || titulo, es: texto || titulo } };
  if (sitio) cuerpo.url = sitio.replace(/\/?$/, '/') + (ruta ? '#/' + ruta : '');
  var subs = [];
  if (destinos === '*') cuerpo.included_segments = ['Total Subscriptions'];
  else {
    subs = suscripcionesDe_(destinos);
    if (!subs.length) return { estado: 'SIN_DESTINATARIOS', detalle: 'Ninguna de esas personas tiene los avisos activos en un dispositivo.' };
    delete cuerpo.target_channel;
    cuerpo.include_subscription_ids = subs;
  }
  try {
    var r = UrlFetchApp.fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Key ' + clave }, payload: JSON.stringify(cuerpo),
    });
    var texto = r.getContentText(), j = {};
    try { j = JSON.parse(texto); } catch (x) { /* no es JSON */ }
    if (r.getResponseCode() >= 300) {
      registrarError_(new Error('OneSignal ' + r.getResponseCode() + ': ' + texto.slice(0, 300)));
      return { estado: 'ERROR', detalle: errorOneSignal_({ codigo: r.getResponseCode(), json: j, texto: texto }) };
    }
    // dispositivos que OneSignal ya no acepta (la persona quitó el permiso o borró el CAC): se olvidan
    var invalidos = (j.errors && (j.errors.invalid_player_ids || j.errors.invalid_subscription_ids)) || [];
    if (invalidos.length) {
      var malos = {}; invalidos.forEach(function (x) { malos[x] = true; });
      quitarFilas_('PUSH_DISPOSITIVOS', function (f) { return malos[texto_(f.suscripcion)]; });
    }
    // sin id, o todos inválidos: nadie de los destinatarios puede recibirlo
    if (!j.id || (subs.length && invalidos.length >= subs.length)) {
      return { estado: 'SIN_DESTINATARIOS', detalle: 'OneSignal no tiene un dispositivo válido para recibirlo. Vuelve a activar los avisos.' };
    }
    return { estado: 'ENVIADO', id: j.id };
  } catch (e) { registrarError_(e); return { estado: 'ERROR', detalle: String(e && e.message || e).slice(0, 200) }; }
}

/** Tarea diaria (la instala «Configurar hojas»): avisa al celular las constancias que vencieron desde la última vez. */
function avisosDiarios() {
  var props = PropertiesService.getScriptProperties(), ahora = Date.now();
  var desde = Number(props.getProperty('AVISOS_DESDE')) || ahora - 86400000;
  memo_ = {}; constanciasCache = null;
  Servicio.avisosDiarios(crearRepo_(), crearCtx_(), desde);
  props.setProperty('AVISOS_DESDE', String(ahora));
}

function instalarTareaDiaria_() {
  try {
    var ya = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'avisosDiarios'; });
    if (!ya) ScriptApp.newTrigger('avisosDiarios').timeBased().everyDays(1).atHour(7).create();
  } catch (e) { /* sin permiso para tareas: los avisos siguen en la campanita */ }
}

/** Menú RRHH → «3 · Notificaciones al celular»: datos de la app de OneSignal. */
function configurarNotificaciones() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var pedir = function (titulo, texto, prop) {
    var r = ui.prompt(titulo, texto + (props.getProperty(prop) ? '\n\n(Ya hay uno guardado. Deja en blanco para no cambiarlo.)' : ''), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return false;
    var v = String(r.getResponseText() || '').trim();
    if (v) props.setProperty(prop, v);
    return true;
  };
  if (!pedir('OneSignal · App ID', 'App ID de OneSignal (Settings → Keys & IDs):', 'ONESIGNAL_APP_ID')) return;
  if (!pedir('OneSignal · REST API Key', 'REST API Key de OneSignal (Settings → Keys & IDs):', 'ONESIGNAL_API_KEY')) return;
  if (!pedir('Dirección del CAC', 'Dirección del sitio, por ejemplo https://cac.onrender.com', 'CAC_URL')) return;
  instalarTareaDiaria_();
  ui.alert('Listo', 'Las notificaciones al celular quedaron configuradas.', ui.ButtonSet.OK);
}

/** La hoja PINES se crea sola (para no exigir «Configurar hojas» al actualizar). */
function asegurarHojaPines_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('PINES')) return;
  var h = ss.insertSheet('PINES');
  h.getRange(1, 1, 1, HOJAS.PINES.length).setValues([HOJAS.PINES]).setFontWeight('bold');
  h.setFrozenRows(1);
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
  // Feriados nacionales 2026-2030: se agregan los que falten (no se tocan los que RRHH ya tenga o haya agregado)
  if (typeof Vacaciones !== 'undefined' && Vacaciones) {
    var hf = ss.getSheetByName('FERIADOS'), hay = {};
    leer_('FERIADOS').forEach(function (f) { hay[fechaIso_(f.fecha)] = true; });
    var faltan = feriadosIniciales_().filter(function (f) { return !hay[f[0]]; });
    if (faltan.length) {
      var desde = hf.getLastRow() + 1;
      hf.getRange(desde, 1, faltan.length, 1).setNumberFormat('@');
      hf.getRange(desde, 1, faltan.length, 2).setValues(faltan);
      invalidar_('FERIADOS');
    }
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
  instalarTareaDiaria_();
  invalidarTodo_();
}

/* ---------- Menú «RRHH» dentro de la hoja ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RRHH')
    .addItem('1 · Configurar hojas y usuarios', 'configurarInicial')
    .addItem('2 · Poner o cambiar clave de RRHH', 'ponerClaveRRHH')
    .addItem('3 · Notificaciones al celular (OneSignal)', 'configurarNotificaciones')
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
  var usuarios = leer_('USUARIOS');
  var lista = usuarios.map(function (u, i) {
    return (i + 1) + ') ' + texto_(u.cedula) + ' · ' + (texto_(u.nombre) || '—') + (texto_(u.hash) ? '' : '  (sin clave)');
  }).join('\n');
  var c = ui.prompt('Clave de RRHH', 'Escribe el número de la lista (por ejemplo 1) o la cédula de la persona.\nPara crear un usuario nuevo, escribe su cédula.\n\n' + lista, ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  var resp = String(c.getResponseText() || '').trim();
  var pos = /^\d{1,3}$/.test(resp) ? Number(resp) : 0;   // número de la lista
  var cedula = pos >= 1 && pos <= usuarios.length ? texto_(usuarios[pos - 1].cedula) : Empleados.numeroDeCedulaTexto(resp);
  if (!cedula) { ui.alert('No entendí «' + resp + '». Escribe el número de la lista (1, 2, 3…) o la cédula completa, solo números.'); return; }
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
  l.push((pr.getProperty('ONESIGNAL_APP_ID') && pr.getProperty('ONESIGNAL_API_KEY') ? '✔ ' : '· (opcional) sin ') + 'notificaciones al celular (OneSignal)');
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
