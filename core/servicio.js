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
  var Omega = isNode ? require('./omega.js') : dependencia(raiz, 'Omega');

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

  /* ---------- Omega Capital: cestaticket y Omega Transferencia por quincena, en 4 lotes ---------- */

  function configOmega(repo) {
    var c = repo.omegaConfig() || {}, num = function (k, def) { return c[k] != null && c[k] !== '' && isFinite(Number(c[k])) ? Number(c[k]) : def; };
    var empresas = {};
    Object.keys(Omega.EMPRESAS).forEach(function (e) {
      empresas[e] = { razonSocial: c['razonSocial_' + e] || Omega.EMPRESAS[e].razonSocial, rif: c['rif_' + e] || Omega.EMPRESAS[e].rif };
    });
    return { empresas: empresas, parametros: { cestaticket: num('cestaticket', Omega.PARAMETROS.cestaticket), comision: num('comision', Omega.PARAMETROS.comision),
      iva: num('iva', Omega.PARAMETROS.iva), retencion: num('retencion', Omega.PARAMETROS.retencion) } };
  }

  function personasOmega(repo) {
    var sin = repo.omegaSinTarjeta();
    return repo.todosEmpleados().filter(function (e) { return e.estado !== 'Inactivo' && !e.fueraNomina; }).map(function (e) {
      var clave = Empleados.claveCedula(e);
      return { clave: clave, cedula: e.cedulaNumero, nombre: e.nombre, empresa: Empleados.empresaFideicomiso(e), fechaIngreso: e.fechaIngreso, sinTarjeta: !!sin[clave],
        organizacion: e.organizacion || '', puesto: e.puesto || '' };
    });
  }

  function quincenaOmega(repo, id) {
    var q = repo.omegaQuincena(id);
    if (!q) return null;
    q.lotes = q.lotes || {}; q.ajustes = q.ajustes || {};
    return q;
  }

  /** Lo pagado (validado) en la 1Q del mismo mes, por lote y persona. */
  function pagado1Q(repo, mes) {
    var q1 = quincenaOmega(repo, Omega.idQuincena(mes, 1)), r = {};
    if (!q1) return { existe: false, pagado: r, validados: {} };
    Omega.LOTES.forEach(function (l) {
      if (!q1.lotes[l.id] || q1.lotes[l.id].estado !== 'VALIDADO') return;
      r[l.id] = {}; repo.omegaPagos(q1.id, l.id).forEach(function (x) { r[l.id][x.clave] = x.montoBs; });
    });
    var val = {}; Omega.LOTES.forEach(function (l) { val[l.id] = !!(q1.lotes[l.id] && q1.lotes[l.id].estado === 'VALIDADO'); });
    return { existe: true, pagado: r, validados: val };
  }

  /** Líneas de un lote: guardadas si está validado; si no, calculadas con los datos actuales y los ajustes. */
  function lineasLote(repo, q, loteId, cfg, cache) {
    if (q.lotes[loteId] && q.lotes[loteId].estado === 'VALIDADO') {
      return repo.omegaPagos(q.id, loteId).map(function (x) { return Object.assign({}, x, { excluida: false }); });
    }
    if (!cache.calc) {
      var benef = {}; repo.omegaBeneficios().forEach(function (b) { benef[b.clave] = b; });
      var p1 = Number(q.quincena) === 2 ? pagado1Q(repo, q.mes) : { pagado: {} };
      cache.calc = Omega.lineasQuincena(personasOmega(repo), benef, q.mes, q.quincena, q.tasa, p1.pagado, cfg.parametros);
    }
    var aj = q.ajustes[loteId] || {};
    return (cache.calc[loteId] || []).map(function (l) {
      var a = aj[l.clave] || {}, x = Object.assign({}, l, { excluida: !!a.excluir, calculado: l.montoBs });
      if (a.monto != null && a.monto !== '') { x.montoBs = Omega.r2(a.monto); x.ajustado = true; }
      return x;
    });
  }

  function resumenLote(lineas, cfg) {
    var validas = lineas.filter(function (l) { return !l.excluida && l.montoBs > 0; });
    var subtotal = validas.reduce(function (t, l) { return t + l.montoBs; }, 0);
    var avisos = 0, errores = 0;
    lineas.forEach(function (l) { if (l.excluida) return; Omega.revisarLinea(l).forEach(function (a) { if (a.tipo === 'error') errores++; else avisos++; }); });
    return { personas: validas.length, excluidas: lineas.filter(function (l) { return l.excluida; }).length, usd: Omega.r2(validas.reduce(function (t, l) { return t + (Number(l.usd) || 0); }, 0)),
      totales: Omega.totalesOmega(subtotal, cfg.parametros), avisos: avisos, errores: errores };
  }

  function vistaQuincena(repo, q, cfg) {
    var cache = {}, p1 = Number(q.quincena) === 2 ? pagado1Q(repo, q.mes) : null;
    return {
      id: q.id, mes: q.mes, quincena: Number(q.quincena), tasa: q.tasa, creada: q.creada, por: q.por,
      sin1Q: !!(p1 && !p1.existe),
      lotes: Omega.LOTES.map(function (l) {
        var st = q.lotes[l.id] || {};
        return Object.assign({ id: l.id, nombre: l.nombre, tipo: l.tipo, empresa: l.empresa, estado: st.estado || 'PENDIENTE', validado: st.cuando || 0, validadoPor: st.por || '',
          falta1Q: !!(p1 && p1.existe && !p1.validados[l.id]) }, resumenLote(lineasLote(repo, q, l.id, cfg, cache), cfg));
      }),
    };
  }

  function sesionRRHH(ctx, token) { return leerToken(ctx, token, ['RRHH', 'ADMIN']); }

  function omegaInicio(repo, ctx, token) {
    if (!sesionRRHH(ctx, token)) return err('SESION', 'No autorizado.');
    var cfg = configOmega(repo), sin = repo.omegaSinTarjeta();
    var activos = {}; personasOmega(repo).forEach(function (p) { activos[p.clave] = true; });
    return ok({
      config: cfg, lotes: Omega.LOTES,
      quincenas: repo.omegaQuincenas().map(function (q) {
        q.lotes = q.lotes || {};
        var val = Omega.LOTES.filter(function (l) { return q.lotes[l.id] && q.lotes[l.id].estado === 'VALIDADO'; }).length;
        return { id: q.id, mes: q.mes, quincena: Number(q.quincena), tasa: q.tasa, validados: val, creada: q.creada };
      }).sort(function (a, b) { return a.id < b.id ? 1 : -1; }),
      beneficiosCargados: repo.omegaBeneficios().length,
      sinTarjeta: Object.keys(sin).filter(function (k) { return activos[k]; }).length,
    });
  }

  function omegaGuardarConfig(repo, ctx, token, d) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var c = {};
    Object.keys(Omega.EMPRESAS).forEach(function (e) {
      var x = (d.empresas || {})[e]; if (!x) return;
      if (x.rif != null) {
        var rif = String(x.rif).replace(/[-\s]/g, '').toUpperCase();
        if (rif && !/^[JGVE]\d{9}$/.test(rif)) return (c.error = 'El RIF de ' + e + ' debe ser una letra (J, G, V o E) y 9 dígitos. Ejemplo: J001417710.');
        c['rif_' + e] = rif;
      }
      if (x.razonSocial != null) c['razonSocial_' + e] = String(x.razonSocial).trim();
    });
    if (c.error) return err('VALIDACION', c.error);
    ['cestaticket', 'comision', 'iva', 'retencion'].forEach(function (k) {
      var v = (d.parametros || {})[k]; if (v == null || v === '') return;
      var n = Number(String(v).replace(',', '.')); if (isFinite(n) && n >= 0) c[k] = n;
    });
    repo.guardarOmegaConfig(c);
    repo.log('OMEGA_CONFIG', s.clave, Object.keys(c).join(','));
    return omegaInicio(repo, ctx, token);
  }

  /** Personas activas con su marca de tarjeta (para marcar a quién le falta). */
  function omegaTarjetas(repo, ctx, token) {
    if (!sesionRRHH(ctx, token)) return err('SESION', 'No autorizado.');
    var hoy = new Date(ctx.ahora() - 4 * 3600e3), limite = (hoy.getUTCFullYear() * 12 + hoy.getUTCMonth() + 1) - 2;
    return ok(personasOmega(repo).map(function (p) {
      var f = p.fechaIngreso;
      return { clave: p.clave, nombre: p.nombre, empresa: p.empresa, organizacion: p.organizacion, sinTarjeta: p.sinTarjeta,
        ingreso: f ? ('0' + f.d).slice(-2) + '/' + ('0' + f.m).slice(-2) + '/' + f.y : '', reciente: !!(f && f.y * 12 + f.m >= limite) };
    }).sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; }));
  }

  function omegaMarcarTarjeta(repo, ctx, token, claves, sinTarjeta) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var n = 0;
    (claves || []).forEach(function (c) {
      var e = repo.empleadoPorClave(c);
      if (!e) return;
      repo.marcarOmegaSinTarjeta(Empleados.claveCedula(e), e.nombre, !!sinTarjeta, s.clave, ctx.ahora()); n++;
    });
    return ok({ cambiados: n });
  }

  function omegaAbrirQuincena(repo, ctx, token, mes, quincena, tasa) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    quincena = Number(quincena); tasa = Number(String(tasa == null ? '' : tasa).replace(',', '.'));
    if (!Omega.esMes(mes) || (quincena !== 1 && quincena !== 2)) return err('VALIDACION', 'Elige el mes y la quincena.');
    if (!(tasa > 0)) return err('VALIDACION', 'Escribe la tasa estimada (Bs. por $).');
    var id = Omega.idQuincena(mes, quincena);
    if (repo.omegaQuincena(id)) return err('DUPLICADO', 'Esa quincena ya está abierta.');
    var q = { id: id, mes: mes, quincena: quincena, tasa: Omega.r2(tasa), lotes: {}, ajustes: {}, creada: ctx.ahora(), por: s.clave, actualizada: ctx.ahora() };
    repo.guardarOmegaQuincena(q);
    repo.log('OMEGA_QUINCENA', s.clave, id + ' · tasa ' + q.tasa);
    return omegaQuincena(repo, ctx, token, id);
  }

  function omegaQuincena(repo, ctx, token, id) {
    if (!sesionRRHH(ctx, token)) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id);
    if (!q) return err('NO_ENCONTRADO', 'No existe esa quincena.');
    return ok(vistaQuincena(repo, q, configOmega(repo)));
  }

  function omegaCambiarTasa(repo, ctx, token, id, tasa) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id);
    if (!q) return err('NO_ENCONTRADO', 'No existe esa quincena.');
    if (Object.keys(q.lotes).some(function (k) { return q.lotes[k].estado === 'VALIDADO'; })) return err('VALIDADO', 'Ya hay lotes validados con la tasa actual: reábrelos para cambiarla.');
    tasa = Number(String(tasa).replace(',', '.'));
    if (!(tasa > 0)) return err('VALIDACION', 'Escribe la tasa estimada.');
    q.tasa = Omega.r2(tasa); q.actualizada = ctx.ahora();
    repo.guardarOmegaQuincena(q);
    return omegaQuincena(repo, ctx, token, id);
  }

  function omegaEliminarQuincena(repo, ctx, token, id) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id);
    if (!q) return err('NO_ENCONTRADO', 'No existe esa quincena.');
    if (Object.keys(q.lotes).some(function (k) { return q.lotes[k].estado === 'VALIDADO'; })) return err('VALIDADO', 'Tiene lotes validados: reábrelos antes de eliminarla.');
    repo.eliminarOmegaQuincena(id);
    repo.log('OMEGA_ELIMINAR', s.clave, id);
    return ok({ eliminada: id });
  }

  function omegaLote(repo, ctx, token, id, loteId) {
    if (!sesionRRHH(ctx, token)) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id), l = Omega.lote(loteId);
    if (!q || !l) return err('NO_ENCONTRADO', 'No existe ese lote.');
    var cfg = configOmega(repo), lineas = lineasLote(repo, q, loteId, cfg, {});
    var st = q.lotes[loteId] || {};
    return ok({ quincena: { id: q.id, mes: q.mes, quincena: Number(q.quincena), tasa: q.tasa }, lote: l, estado: st.estado || 'PENDIENTE', validado: st.cuando || 0,
      empresa: cfg.empresas[l.empresa], parametros: cfg.parametros, resumen: resumenLote(lineas, cfg),
      lineas: lineas.map(function (x) { return Object.assign({}, x, { avisos: x.excluida ? [] : Omega.revisarLinea(x) }); }) });
  }

  /** Excluye a una persona del lote o cambia su monto en Bs. (cambio: { excluir: bool } o { monto: n | null }). */
  function omegaAjustarLinea(repo, ctx, token, id, loteId, clave, cambio) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id);
    if (!q || !Omega.lote(loteId)) return err('NO_ENCONTRADO', 'No existe ese lote.');
    if (q.lotes[loteId] && q.lotes[loteId].estado === 'VALIDADO') return err('VALIDADO', 'El lote ya está validado: reábrelo para cambiarlo.');
    var aj = q.ajustes[loteId] = q.ajustes[loteId] || {}, a = aj[clave] = aj[clave] || {};
    if (cambio && cambio.excluir != null) { if (cambio.excluir) a.excluir = true; else delete a.excluir; }
    if (cambio && 'monto' in cambio) {
      var m = cambio.monto == null || cambio.monto === '' ? null : Number(String(cambio.monto).replace(/\./g, '').replace(',', '.'));
      if (m == null) delete a.monto; else if (isFinite(m) && m >= 0) a.monto = Omega.r2(m); else return err('VALIDACION', 'Monto no válido.');
    }
    if (!Object.keys(a).length) delete aj[clave];
    q.actualizada = ctx.ahora();
    repo.guardarOmegaQuincena(q);
    return omegaLote(repo, ctx, token, id, loteId);
  }

  /** Valida el lote: congela personas y montos (los de 1Q se descuentan en la 2Q) y permite generar el TXT. */
  function omegaValidarLote(repo, ctx, token, id, loteId) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id), l = Omega.lote(loteId);
    if (!q || !l) return err('NO_ENCONTRADO', 'No existe ese lote.');
    if (q.lotes[loteId] && q.lotes[loteId].estado === 'VALIDADO') return err('VALIDADO', 'Ese lote ya está validado.');
    if (Number(q.quincena) === 2) {
      var p1 = pagado1Q(repo, q.mes);
      if (p1.existe && !p1.validados[loteId]) return err('VALIDACION', 'Primero valida el lote «' + l.nombre + '» de la 1.ª quincena: la 2.ª descuenta lo pagado allí.');
    }
    var cfg = configOmega(repo), lineas = lineasLote(repo, q, loteId, cfg, {}).filter(function (x) { return !x.excluida && x.montoBs > 0; });
    if (!lineas.length) return err('VACIO', 'El lote no tiene montos para pagar.');
    var errores = lineas.filter(function (x) { return Omega.revisarLinea(x).some(function (a) { return a.tipo === 'error'; }); });
    if (errores.length) return err('VALIDACION', 'Hay ' + errores.length + ' persona(s) con cédula no válida: corrígelas en Empleados o exclúyelas.');
    var ahora = ctx.ahora();
    repo.quitarOmegaPagos(id, loteId);
    repo.agregarOmegaPagos(lineas.map(function (x) {
      return { quincena: id, lote: loteId, clave: x.clave, cedula: x.cedula, nombre: x.nombre, usd: x.usd, montoBs: x.montoBs, anticipoBs: x.anticipoBs || 0,
        dias: x.dias, detalle: x.detalle, validado: ahora };
    }));
    var total = Omega.r2(lineas.reduce(function (t, x) { return t + x.montoBs; }, 0));
    q.lotes[loteId] = { estado: 'VALIDADO', cuando: ahora, por: s.clave, personas: lineas.length, total: total };
    q.actualizada = ahora;
    repo.guardarOmegaQuincena(q);
    repo.log('OMEGA_VALIDAR', s.clave, id + ' · ' + loteId + ' · ' + lineas.length + ' · ' + total);
    return omegaLote(repo, ctx, token, id, loteId);
  }

  function omegaReabrirLote(repo, ctx, token, id, loteId) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var q = quincenaOmega(repo, id);
    if (!q || !Omega.lote(loteId)) return err('NO_ENCONTRADO', 'No existe ese lote.');
    if (!q.lotes[loteId] || q.lotes[loteId].estado !== 'VALIDADO') return err('VALIDACION', 'Ese lote no está validado.');
    if (Number(q.quincena) === 1) {
      var q2 = quincenaOmega(repo, Omega.idQuincena(q.mes, 2));
      if (q2 && q2.lotes[loteId] && q2.lotes[loteId].estado === 'VALIDADO') return err('VALIDACION', 'La 2.ª quincena de este lote ya está validada: reábrela primero.');
    }
    repo.quitarOmegaPagos(id, loteId);
    delete q.lotes[loteId]; q.actualizada = ctx.ahora();
    repo.guardarOmegaQuincena(q);
    repo.log('OMEGA_REABRIR', s.clave, id + ' · ' + loteId);
    return omegaLote(repo, ctx, token, id, loteId);
  }

  /** Reemplaza la lista de beneficios en $ de Omega Transferencia con las filas del Excel. */
  function omegaImportarBeneficios(repo, ctx, token, filas) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    if (!filas || !filas.length) return err('VALIDACION', 'El archivo no trae personas.');
    var todos = repo.todosEmpleados(), porNumero = {}, porNombre = {};
    todos.forEach(function (e) {
      var n = String(e.cedulaNumero).replace(/^0+/, '');
      if (!porNumero[n] || porNumero[n].estado === 'Inactivo') porNumero[n] = e;
      porNombre[e.nombreNorm] = porNombre[e.nombreNorm] === undefined ? e : null;
    });
    var lista = [], noEncontrados = [], usados = {}, porNombreN = 0;
    filas.forEach(function (f) {
      var c = Empleados.parsearCedula(f.cedula), e = c.numero ? porNumero[c.numero] : null;
      if (!e) { var d = String(f.cedula).replace(/\D/g, ''); if (d.length === 9) e = porNumero[d.slice(0, 8).replace(/^0+/, '')] || null; }
      if (!e && f.nombre && porNombre[Empleados.normalizarNombre(f.nombre)]) { e = porNombre[Empleados.normalizarNombre(f.nombre)]; porNombreN++; }
      if (!e) { noEncontrados.push({ cedula: String(f.cedula), nombre: f.nombre || '' }); return; }
      var clave = Empleados.claveCedula(e);
      if (usados[clave]) return; usados[clave] = true;
      var b = { clave: clave, nombre: e.nombre, actualizado: ctx.ahora(), por: s.clave };
      Omega.ADICIONALES.forEach(function (k) { b[k] = Omega.r2(Math.max(0, Number(f[k]) || 0)); });
      lista.push(b);
    });
    if (!lista.length) return err('VALIDACION', 'Ninguna cédula del archivo coincide con los empleados cargados.');
    repo.reemplazarOmegaBeneficios(lista);
    repo.log('OMEGA_BENEFICIOS', s.clave, lista.length + ' personas');
    return ok({ cargados: lista.length, porNombre: porNombreN, noEncontrados: noEncontrados });
  }

  function omegaBeneficios(repo, ctx, token) {
    if (!sesionRRHH(ctx, token)) return err('SESION', 'No autorizado.');
    return ok(repo.omegaBeneficios().sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; }));
  }

  /** Cambia los montos en $ de una persona (montos: { complemento, vehiculo, bono, comisiones }). */
  function omegaEditarBeneficio(repo, ctx, token, clave, montos) {
    var s = sesionRRHH(ctx, token);
    if (!s) return err('SESION', 'No autorizado.');
    var e = repo.empleadoPorClave(clave);
    if (!e) return err('NO_ENCONTRADO', 'No encontramos a esa persona.');
    var k0 = Empleados.claveCedula(e);
    var b = repo.omegaBeneficios().filter(function (x) { return x.clave === k0; })[0] || { clave: k0 };
    Omega.ADICIONALES.forEach(function (k) { if (montos && montos[k] != null && montos[k] !== '') b[k] = Omega.r2(Math.max(0, Number(String(montos[k]).replace(',', '.')) || 0)); else if (b[k] == null) b[k] = 0; });
    b.nombre = e.nombre; b.actualizado = ctx.ahora(); b.por = s.clave;
    repo.guardarOmegaBeneficio(b);
    return ok(b);
  }

  /* ---------- Nóminas especiales: el jefe solicita un pago especial y Gestión Humana lo registra en la nómina ---------- */

  var MONEDAS_NOMINA = ['Bs.', '$'];
  function vistaNominaEsp(n) {
    return { id: n.id, concepto: n.concepto, moneda: n.moneda, fechaPago: n.fechaPago, observacion: n.observacion, items: n.items, total: n.total, personas: n.personas,
      estado: n.estado, solicitadaPor: n.solicitadaPor, solicitadaPorNombre: n.solicitadaPorNombre, solicitada: n.solicitada,
      atendidaPor: n.atendidaPor, atendidaPorNombre: n.atendidaPorNombre, atendida: n.atendida, referencia: n.referencia, motivo: n.motivo };
  }
  function nombreUsuario(repo, clave) {
    var d = digitos(clave), e = repo.empleadoPorClave('V' + d) || repo.empleadoPorClave('E' + d);
    if (e) return e.nombre;
    var u = repo.todosUsuarios().filter(function (x) { return digitos(x.cedula) === d; })[0];
    return u ? u.nombre : d;
  }

  /** Solicitud de una nómina de pago especial. datos: { concepto, moneda, fechaPago, observacion, items: [{ clave, monto }] } */
  function solicitarNominaEspecial(repo, ctx, token, datos) {
    var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
    if (!s) return err('SESION', 'No autorizado.');
    datos = datos || {};
    var concepto = String(datos.concepto || '').trim().slice(0, 120);
    if (!concepto) return err('VALIDACION', 'Escribe el concepto del pago (por ejemplo, «Bono por cierre de inventario»).');
    var moneda = MONEDAS_NOMINA.indexOf(datos.moneda) !== -1 ? datos.moneda : 'Bs.';
    var fechaPago = /^\d{4}-\d{2}-\d{2}$/.test(String(datos.fechaPago || '')) ? datos.fechaPago : '';
    var vistos = {}, items = [], errores = [];
    (datos.items || []).forEach(function (it) {
      var e = repo.empleadoPorClave(it.clave), monto = Math.round((Number(it.monto) || 0) * 100) / 100;
      if (!e) { errores.push('No encontramos a ' + (it.clave || 'una persona') + '.'); return; }
      var clave = Empleados.claveCedula(e);
      if (vistos[clave]) { errores.push(e.nombre + ' está repetido.'); return; }
      vistos[clave] = true;
      if (!(monto > 0)) { errores.push('Falta el monto de ' + e.nombre + '.'); return; }
      if (e.estado === 'Inactivo') { errores.push(e.nombre + ' ya no está activo.'); return; }
      items.push({ clave: clave, cedula: e.cedulaNumero, cedulaLetra: e.cedulaLetra, nombre: e.nombre, empresa: Empleados.empresaFideicomiso(e), organizacion: e.organizacion || '', monto: monto });
    });
    if (errores.length) return err('VALIDACION', errores[0]);
    if (!items.length) return err('VALIDACION', 'Agrega al menos una persona con su monto.');
    var n = { id: repo.nuevoIdNominaEsp(), concepto: concepto, moneda: moneda, fechaPago: fechaPago, observacion: String(datos.observacion || '').trim().slice(0, 500),
      items: items, personas: items.length, total: Math.round(items.reduce(function (t, x) { return t + x.monto; }, 0) * 100) / 100,
      estado: 'SOLICITADA', solicitadaPor: s.clave, solicitadaPorNombre: nombreUsuario(repo, s.clave), solicitada: ctx.ahora() };
    repo.guardarNominaEspecial(n);
    repo.log('NOMINA_ESP_SOLICITUD', s.clave, n.id + ' · ' + n.personas + ' · ' + n.total);
    var destinos = repo.todosUsuarios().map(function (u) { return digitos(u.cedula); }).filter(function (d) { return d && d !== digitos(s.clave); }).map(function (d) { return 'V' + d; });
    notificar(repo, ctx, destinos, { tipo: 'NOMINA_ESPECIAL', titulo: 'Nómina especial por registrar', texto: n.solicitadaPorNombre + ' solicitó «' + concepto + '» para ' + n.personas + ' persona' + (n.personas === 1 ? '' : 's') + '.', ruta: 'nominas' });
    return ok(vistaNominaEsp(n));
  }

  function listarNominasEspeciales(repo, ctx, token) {
    var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
    if (!s) return err('SESION', 'No autorizado.');
    var lista = repo.nominasEspeciales().sort(function (a, b) { return b.solicitada - a.solicitada; }).map(vistaNominaEsp);
    return ok({ yo: digitos(s.clave), solicitudes: lista });
  }

  function atenderNominaEspecial(repo, ctx, token, id, estado, extra) {
    var s = leerToken(ctx, token, ['RRHH', 'ADMIN']);
    if (!s) return err('SESION', 'No autorizado.');
    var n = repo.nominaEspecialPorId(id);
    if (!n) return err('NO_ENCONTRADO', 'No existe esa solicitud.');
    if (n.estado !== 'SOLICITADA') return err('TRANSICION', 'Esa solicitud ya fue atendida.');
    if (estado === 'CANCELADA' && digitos(n.solicitadaPor) !== digitos(s.clave)) return err('PERMISO', 'Solo quien la solicitó puede cancelarla.');
    n.estado = estado; n.atendidaPor = s.clave; n.atendidaPorNombre = nombreUsuario(repo, s.clave); n.atendida = ctx.ahora();
    Object.assign(n, extra || {});
    repo.guardarNominaEspecial(n);
    repo.log('NOMINA_ESP_' + estado, s.clave, n.id);
    if (estado !== 'CANCELADA' && digitos(n.solicitadaPor) !== digitos(s.clave)) {
      notificar(repo, ctx, ['V' + digitos(n.solicitadaPor)], estado === 'REGISTRADA'
        ? { tipo: 'NOMINA_ESPECIAL', titulo: 'Nómina especial registrada', texto: '«' + n.concepto + '» quedó registrada en la nómina' + (n.referencia ? ' (' + n.referencia + ')' : '') + '.', ruta: 'nominas' }
        : { tipo: 'NOMINA_ESPECIAL', titulo: 'Nómina especial rechazada', texto: '«' + n.concepto + '»: ' + n.motivo, ruta: 'nominas' });
    }
    return ok(vistaNominaEsp(n));
  }
  function registrarNominaEspecial(repo, ctx, token, id, referencia) {
    return atenderNominaEspecial(repo, ctx, token, id, 'REGISTRADA', { referencia: String(referencia || '').trim().slice(0, 80) });
  }
  function rechazarNominaEspecial(repo, ctx, token, id, motivo) {
    if (!String(motivo || '').trim()) return err('VALIDACION', 'Escribe el motivo.');
    return atenderNominaEspecial(repo, ctx, token, id, 'RECHAZADA', { motivo: String(motivo).trim().slice(0, 300) });
  }
  function cancelarNominaEspecial(repo, ctx, token, id) { return atenderNominaEspecial(repo, ctx, token, id, 'CANCELADA', {}); }

  var api = {
    solicitarNominaEspecial: solicitarNominaEspecial, listarNominasEspeciales: listarNominasEspeciales, registrarNominaEspecial: registrarNominaEspecial,
    rechazarNominaEspecial: rechazarNominaEspecial, cancelarNominaEspecial: cancelarNominaEspecial,
    omegaInicio: omegaInicio, omegaGuardarConfig: omegaGuardarConfig, omegaTarjetas: omegaTarjetas, omegaMarcarTarjeta: omegaMarcarTarjeta,
    omegaAbrirQuincena: omegaAbrirQuincena, omegaQuincena: omegaQuincena, omegaCambiarTasa: omegaCambiarTasa, omegaEliminarQuincena: omegaEliminarQuincena,
    omegaLote: omegaLote, omegaAjustarLinea: omegaAjustarLinea, omegaValidarLote: omegaValidarLote, omegaReabrirLote: omegaReabrirLote,
    omegaImportarBeneficios: omegaImportarBeneficios, omegaBeneficios: omegaBeneficios, omegaEditarBeneficio: omegaEditarBeneficio,
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
