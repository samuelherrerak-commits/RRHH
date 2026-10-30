/* ==========================================================
   API de RRHH (Google Apps Script). Recibe POST de texto plano
   con JSON { action, ... } y responde JSON { ok, data | code, message }.
   Toda la lógica está en core/servicio.js; aquí solo se leen
   y escriben las hojas.
   ========================================================== */

// Cambia este número cuando publiques una versión nueva; así se comprueba desde el navegador cuál está activa.
var VERSION = '2026-11-02.3';
var AVISO_CODIGO = 'El proyecto de Apps Script no tiene el código completo. Copia el archivo apps-script/RRHH.gs del repositorio (más de 80 KB y 1.500 líneas; no uses src/api.gs), pégalo como único archivo y publica una nueva versión.';
var MODULOS = ['Calculo', 'Empleados', 'Prestaciones', 'Exportes', 'Constancia', 'Vacaciones', 'Aportes', 'Servicio'];

/** Qué módulos están cargados (se nombran uno a uno: no se busca por texto en el global). */
function modulosCargados_() {
  return {
    Calculo: typeof Calculo !== 'undefined' && !!Calculo, Empleados: typeof Empleados !== 'undefined' && !!Empleados,
    Prestaciones: typeof Prestaciones !== 'undefined' && !!Prestaciones, Exportes: typeof Exportes !== 'undefined' && !!Exportes,
    Constancia: typeof Constancia !== 'undefined' && !!Constancia, Vacaciones: typeof Vacaciones !== 'undefined' && !!Vacaciones,
    Aportes: typeof Aportes !== 'undefined' && !!Aportes,
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
};

function doPost(e) {
  var lock = LockService.getScriptLock(), bloqueado = false;
  memo_ = {}; constanciasCache = null;   // en Google cada petición empieza de cero; así también en el simulador
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
