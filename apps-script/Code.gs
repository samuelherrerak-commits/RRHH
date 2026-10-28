/* ==========================================================
   API de RRHH (Google Apps Script). Recibe POST de texto plano
   con JSON { action, ... } y responde JSON { ok, data | code, message }.
   Toda la lógica está en core/servicio.js; aquí solo se leen
   y escriben las hojas.
   ========================================================== */

var HOJAS = {
  PARAMETROS: ['clave', 'valor'],
  EMPRESAS: ['empresa', 'fideicomiso', 'tipoTAporte', 'tipoTAnticipo', 'forma'],
  EMPLEADOS: ['cedulaLetra', 'cedulaNumero', 'nombre', 'organizacion', 'departamento', 'puesto', 'estado', 'fechaIngreso', 'empresaDetalle', 'empresaFideicomiso', 'revisarCedula', 'editados'],
  APORTES: ['clave', 'anio', 'trimestre', 'empresa', 'total', 'monto', 'meses', 'diasAdicionales', 'adicionalesForzados', 'nuevo'],
  CIERRES: ['anio', 'trimestre', 'empresa', 'estado', 'por', 'actualizado'],
  ANTICIPOS: ['id', 'clave', 'monto', 'motivo', 'detalle', 'estado', 'creada', 'actualizada', 'decididaPor', 'motivoRechazo'],
  USUARIOS: ['cedula', 'sal', 'hash', 'rol'],
  LOG: ['cuando', 'accion', 'actor', 'detalle'],
};

var RUTAS_TRABAJADOR = {
  login: function (repo, ctx, d) { return Servicio.iniciarSesion(repo, ctx, d.cedula); },
  estadoDeCuenta: function (repo, ctx, d) { return Servicio.miEstadoDeCuenta(repo, ctx, d.token); },
  solicitarAnticipo: function (repo, ctx, d) { return Servicio.solicitarAnticipo(repo, ctx, d.token, d); },
  cancelarAnticipo: function (repo, ctx, d) { return Servicio.cancelarAnticipo(repo, ctx, d.token, d.id); },
};

var RUTAS_RRHH = {
  loginAdmin: function (repo, ctx, d) { return Servicio.iniciarSesionAdmin(repo, ctx, d.cedula, d.clave); },
  bandejaAnticipos: function (repo, ctx, d) { return Servicio.bandejaAnticipos(repo, ctx, d.token, d.estado); },
  decidirAnticipo: function (repo, ctx, d) { return Servicio.decidirAnticipo(repo, ctx, d.token, d.id, !!d.aprobar, d.motivoRechazo); },
  archivoAnticipos: function (repo, ctx, d) { return Servicio.generarArchivoAnticipos(repo, ctx, d.token, d.empresa); },
  pagarAnticipos: function (repo, ctx, d) { return Servicio.marcarAnticiposPagados(repo, ctx, d.token, d.ids || []); },
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
    return salida_({ ok: false, code: 'SERVER', message: 'Error del servidor. Intenta de nuevo.' });
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
  return {
    cedulaLetra: texto_(f.cedulaLetra), cedulaNumero: texto_(f.cedulaNumero), nombre: texto_(f.nombre),
    estado: texto_(f.estado) || 'Activo', fechaIngreso: Calculo.aFecha(f.fechaIngreso),
    empresaDetalle: texto_(f.empresaDetalle) || 'PCA', empresaFideicomiso: texto_(f.empresaFideicomiso),
    nombreNorm: Empleados.normalizarNombre(f.nombre),
  };
}

function anticipo_(f) {
  return {
    _fila: f._fila, id: texto_(f.id), clave: texto_(f.clave), monto: Number(f.monto), motivo: texto_(f.motivo),
    detalle: texto_(f.detalle), estado: texto_(f.estado), creada: Number(f.creada) || 0, actualizada: Number(f.actualizada) || 0,
    decididaPor: texto_(f.decididaPor), motivoRechazo: texto_(f.motivoRechazo),
  };
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
    if (h.getLastRow() === 0) {
      h.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]).setFontWeight('bold');
      h.setFrozenRows(1);
    }
  });
  var sem = function (nombre, filas) {
    var h = ss.getSheetByName(nombre);
    if (h.getLastRow() <= 1) h.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
  };
  sem('PARAMETROS', [['anioBase', 2025], ['diasMinimosMes', 1], ['diasUtilidades', 120], ['porcentajeAnticipoMax', 0.75]]);
  sem('EMPRESAS', [['PCA', 5847, 1, 5, 'A'], ['AIV', 5847, 1, 5, 'A']]);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRETO')) props.setProperty('SECRETO', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('API_TOKEN')) props.setProperty('API_TOKEN', 'RRHH2026');
  ['EMPLEADOS', 'APORTES', 'USUARIOS'].forEach(function (n) {
    // cédulas y claves como texto, para que Sheets no les quite ceros ni letras
    ss.getSheetByName(n).getRange(2, 1, 1000, n === 'EMPLEADOS' ? 2 : 1).setNumberFormat('@');
  });
}

/** Crea o actualiza un usuario de RRHH. Edita los tres valores y ejecuta la función. */
function crearUsuarioRRHH() {
  var cedula = '00000000';   // cédula sin letra ni verificador
  var clave = 'CAMBIAME';    // clave larga; luego bórrala de aquí
  var rol = 'RRHH';          // RRHH o ADMIN
  if (clave === 'CAMBIAME') throw new Error('Edita la cédula y la clave antes de ejecutar.');
  var sal = Utilities.getUuid();
  var existente = leer_('USUARIOS').filter(function (u) { return texto_(u.cedula) === cedula; })[0];
  escribirFila_('USUARIOS', { _fila: existente ? existente._fila : 0, cedula: cedula, sal: sal, hash: crearCtx_().hash(clave, sal), rol: rol });
}
