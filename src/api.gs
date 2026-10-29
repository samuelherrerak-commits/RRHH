/* ==========================================================
   API de RRHH (Google Apps Script). Recibe POST de texto plano
   con JSON { action, ... } y responde JSON { ok, data | code, message }.
   Toda la lógica está en core/servicio.js; aquí solo se leen
   y escriben las hojas.
   ========================================================== */

// Cambia este número cuando publiques una versión nueva; así se comprueba desde el navegador cuál está activa.
var VERSION = '2026-10-30.2';
var AVISO_CODIGO = 'El proyecto de Apps Script no tiene el código completo. Copia el archivo apps-script/RRHH.gs del repositorio (más de 80 KB y 1.500 líneas; no uses src/api.gs), pégalo como único archivo y publica una nueva versión.';
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
  EMPLEADOS: ['cedulaLetra', 'cedulaNumero', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'empresaFideicomiso', 'revisarCedula', 'editados', 'motivoRevision', 'jefe', 'salarioMensual', 'genero'],
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
    try { lock.releaseLock(); } catch (x) { /* sin bloqueo */ }
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
    salarioMensual: Empleados.numeroDeMonto(f.salarioMensual), genero: texto_(f.genero), jefe: texto_(f.jefe), editados: editados, nombreNorm: Empleados.normalizarNombre(f.nombre),
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
          e.empresaDetalle, e.empresaFideicomiso || '', !!e.revisarCedula, JSON.stringify(e.editados || []), e.motivoRevision || '', e.jefe || '', e.salarioMensual == null ? '' : e.salarioMensual, e.genero || ''];
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
