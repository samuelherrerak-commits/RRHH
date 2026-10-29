/* ==========================================================
   API de RRHH (Google Apps Script). Recibe POST de texto plano
   con JSON { action, ... } y responde JSON { ok, data | code, message }.
   Toda la lógica está en core/servicio.js; aquí solo se leen
   y escriben las hojas.
   ========================================================== */

var HOJAS = {
  PARAMETROS: ['clave', 'valor'],
  EMPRESAS: ['empresa', 'fideicomiso', 'tipoTAporte', 'tipoTAnticipo', 'forma'],
  EMPLEADOS: ['cedulaLetra', 'cedulaNumero', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'empresaFideicomiso', 'revisarCedula', 'editados', 'motivoRevision', 'jefe', 'salarioMensual'],
  APORTES: ['clave', 'anio', 'trimestre', 'empresa', 'total', 'monto', 'meses', 'diasAdicionales', 'adicionalesForzados', 'nuevo'],
  CIERRES: ['anio', 'trimestre', 'empresa', 'estado', 'por', 'actualizado'],
  ANTICIPOS: ['id', 'clave', 'monto', 'motivo', 'detalle', 'estado', 'creada', 'actualizada', 'decididaPor', 'motivoRechazo'],
  CONSTANCIAS: ['id', 'clave', 'nombre', 'cedula', 'empresa', 'cargo', 'organizacion', 'fechaIngreso', 'salario', 'emision', 'vence', 'estado', 'emitidaPor'],
  USUARIOS: ['cedula', 'sal', 'hash', 'rol'],
  LOG: ['cuando', 'accion', 'actor', 'detalle'],
};

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
    var ruta = RUTAS_TRABAJADOR[d.action] || RUTAS_RRHH[d.action];
    if (!ruta) return salida_({ ok: false, code: 'ACCION', message: 'Acción desconocida.' });
    return salida_(ruta(crearRepo_(), crearCtx_(), d));
  } catch (err) {
    console.error(err && err.stack || err);
    // Los errores de puesta en marcha ("Falta la hoja…", "Falta la propiedad…") se muestran tal cual para poder corregirlos.
    var falta = err && /^Falta /.test(String(err.message));
    return salida_({ ok: false, code: 'SERVER', message: falta ? err.message : 'Error del servidor. Intenta de nuevo.' });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* sin bloqueo */ }
  }
}

function doGet() {
  return salida_({ ok: true, data: 'API de RRHH activa' });
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
    .addItem('1 · Configurar hojas (primera vez)', 'configurarInicial')
    .addItem('2 · Crear mi usuario de RRHH', 'crearUsuarioRRHH')
    .addItem('Diagnóstico', 'diagnostico')
    .addToUi();
}

/**
 * Pide cédula, clave y rol en pantalla. Muestra el nombre del empleado para confirmar.
 * La clave no queda escrita en ningún sitio, solo su huella. Cada persona de RRHH se crea con su propia clave.
 */
function crearUsuarioRRHH() {
  var ui = SpreadsheetApp.getUi();
  configurarInicial();
  var c = ui.prompt('Usuario de RRHH', 'Cédula de la persona, solo números (sin V ni dígito verificador):', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  var cedula = Empleados.numeroDeCedulaTexto(c.getResponseText());
  if (!cedula) { ui.alert('La cédula no es válida.'); return; }
  var emp = crearRepo_().empleadoPorClave('V' + cedula) || crearRepo_().empleadoPorClave('E' + cedula);
  var quien = emp ? emp.nombre : '(no está en la hoja EMPLEADOS todavía)';
  if (ui.alert('Confirmar', 'Cédula ' + cedula + '\n' + quien + '\n\n¿Crear o actualizar su usuario de RRHH?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var k = ui.prompt('Clave', 'Clave de ' + quien + ' (mínimo 8 caracteres). Se pedirá cada vez que entre:', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  var clave = k.getResponseText();
  if (clave.length < 8) { ui.alert('La clave debe tener al menos 8 caracteres.'); return; }
  var rol = ui.alert('Rol', '¿Administrador? Sí = ADMIN (todo). No = RRHH.', ui.ButtonSet.YES_NO) === ui.Button.YES ? 'ADMIN' : 'RRHH';
  guardarUsuario_(cedula, clave, rol);
  ui.alert('Listo', 'Usuario ' + rol + ' creado para ' + quien + '.\nAl escribir su cédula en el sitio, el sistema le pedirá la clave.', ui.ButtonSet.OK);
}

function guardarUsuario_(cedula, clave, rol) {
  var sal = Utilities.getUuid();
  var existente = leer_('USUARIOS').filter(function (u) { return texto_(u.cedula) === cedula; })[0];
  escribirFila_('USUARIOS', { _fila: existente ? existente._fila : 0, cedula: cedula, sal: sal, hash: crearCtx_().hash(clave, sal), rol: rol });
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
  ['Calculo', 'Empleados', 'Prestaciones', 'Exportes', 'Constancia', 'Servicio'].forEach(function (m) {
    var ok = false; try { ok = typeof this[m] === 'object'; } catch (e) { /* no definido */ }
    l.push((ok ? '✔ ' : '✘ FALTA ') + 'archivo core/' + m.toLowerCase() + '.js');
  }, this);
  var faltas = l.filter(function (x) { return x.indexOf('✘') === 0; }).length;
  ui.alert(faltas ? 'Hay ' + faltas + ' cosas por corregir' : 'Todo en orden', l.join('\n') + (faltas ? '\n\nEjecuta «1 · Configurar hojas» y revisa que pegaste todos los archivos.' : ''), ui.ButtonSet.OK);
}
