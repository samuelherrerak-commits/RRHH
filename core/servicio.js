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

  /** Trabajador: solo cédula. Acepta con o sin letra, con o sin verificador. */
  function iniciarSesion(repo, ctx, cedulaTexto) {
    var digitos = String(cedulaTexto || '').replace(/\D/g, '');
    if (digitos.length < 5 || digitos.length > 9) return err('CEDULA', 'Escribe tu cédula, solo números.');
    if (digitos.length === 9) digitos = digitos.slice(0, 8);
    if (repo.fallos('global') >= MAX_FALLOS_GLOBAL || repo.fallos(digitos) >= MAX_FALLOS_CEDULA) {
      return err('BLOQUEADO', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.');
    }
    var emp = repo.empleadoPorClave('V' + digitos) || repo.empleadoPorClave('E' + digitos);
    if (!emp || emp.estado === 'Inactivo') {
      repo.registrarFallo(digitos); repo.registrarFallo('global');
      return err('NO_ENCONTRADO', 'No encontramos esa cédula. Revisa el número o consulta con Recursos Humanos.');
    }
    var clave = Empleados.claveCedula(emp);
    repo.log('LOGIN', clave, 'Entrada de trabajador');
    return ok({ token: crearToken(ctx, clave, 'TRABAJADOR'), nombre: emp.nombre, empresa: Empleados.empresaFideicomiso(emp) });
  }

  /** RRHH / administrador: cédula y clave (hash con sal en USUARIOS). */
  function iniciarSesionAdmin(repo, ctx, cedulaTexto, claveTexto) {
    var digitos = String(cedulaTexto || '').replace(/\D/g, '');
    if (repo.fallos('admin:' + digitos) >= MAX_FALLOS_CEDULA) return err('BLOQUEADO', 'Demasiados intentos. Espera unos minutos.');
    var u = repo.usuario(digitos);
    if (!u || ctx.hash(String(claveTexto || ''), u.sal) !== u.hash) {
      repo.registrarFallo('admin:' + digitos);
      return err('CREDENCIALES', 'Cédula o clave incorrecta.');
    }
    repo.log('LOGIN_ADMIN', digitos, 'Entrada ' + u.rol);
    return ok({ token: crearToken(ctx, digitos, u.rol), rol: u.rol });
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
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Servicio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
