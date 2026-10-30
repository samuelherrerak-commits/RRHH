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
