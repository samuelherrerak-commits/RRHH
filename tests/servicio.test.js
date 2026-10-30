const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

const filas = [
  { cedula: 'V123456789', nombre: 'Esther Rodríguez', organizacion: 'PROSEIN', fechaInicio: '05/03/2025' },
  { cedula: 'V987654321', nombre: 'Luis Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
];

function escenario() {
  const repo = crearRepo(filas), ctx = crearCtx();
  repo.st.parametros.anticipoValidarDisponible = 'SI';   // estas pruebas cubren el modo con saldo en el sistema (75 %)
  // Esther: 4000 aportados y acreditados en T1 → disponible 3000
  repo.st.aportes.push({ clave: 'V12345678', anio: 2026, trimestre: 1, empresa: 'PCA', total: 4000 });
  repo.st.cierres['2026-1-PCA'] = { anio: 2026, trimestre: 1, empresa: 'PCA', estado: 'ACREDITADO' };
  const sal = 'x';
  repo.st.usuarios['11111111'] = { sal, hash: ctx.hash('clave-rrhh', sal), rol: 'RRHH' };
  return { repo, ctx };
}
const entrar = (repo, ctx, c = '12345678') => S.iniciarSesion(repo, ctx, c).data.token;
const admin = (repo, ctx) => S.iniciarSesionAdmin(repo, ctx, '11111111', 'clave-rrhh').data.token;

test('entra con la cédula (con o sin verificador) y rechaza una desconocida', () => {
  const { repo, ctx } = escenario();
  assert.equal(S.iniciarSesion(repo, ctx, '12345678').ok, true);
  assert.equal(S.iniciarSesion(repo, ctx, 'V-123456789').ok, true);
  assert.equal(S.iniciarSesion(repo, ctx, '99999999').code, 'NO_ENCONTRADO');
});

test('se bloquea tras 5 intentos fallidos con la misma cédula', () => {
  const { repo, ctx } = escenario();
  for (let i = 0; i < 5; i++) S.iniciarSesion(repo, ctx, '55555555');
  assert.equal(S.iniciarSesion(repo, ctx, '55555555').code, 'BLOQUEADO');
});

test('el token vence, no se puede falsificar y no sirve en rutas de RRHH', () => {
  const { repo, ctx } = escenario();
  const t = entrar(repo, ctx);
  assert.equal(S.miEstadoDeCuenta(repo, ctx, t).ok, true);
  assert.equal(S.miEstadoDeCuenta(repo, ctx, t + 'x').code, 'SESION');
  assert.equal(S.bandejaAnticipos(repo, ctx, t).code, 'SESION');
  ctx.reloj.t += 9 * 3600 * 1000;
  assert.equal(S.miEstadoDeCuenta(repo, ctx, t).code, 'SESION');
});

test('estado de cuenta: solo lo acreditado, 75 % disponible', () => {
  const { repo, ctx } = escenario();
  repo.st.aportes.push({ clave: 'V12345678', anio: 2026, trimestre: 2, empresa: 'PCA', total: 9999 }); // sin cierre → no se ve
  const r = S.miEstadoDeCuenta(repo, ctx, entrar(repo, ctx)).data.resumen;
  assert.equal(r.totalAportado, 4000);
  assert.equal(r.disponible, 3000);
});

test('un trabajador no ve datos de otro', () => {
  const { repo, ctx } = escenario();
  const r = S.miEstadoDeCuenta(repo, ctx, entrar(repo, ctx, '98765432')).data.resumen;
  assert.equal(r.totalAportado, 0);
});

test('flujo completo del anticipo: solicitar → aprobar → archivo TIPO T 5 → pagar', () => {
  const { repo, ctx } = escenario();
  const t = entrar(repo, ctx), a = admin(repo, ctx);

  assert.equal(S.solicitarAnticipo(repo, ctx, t, { monto: 5000, motivo: 'Salud' }).code, 'VALIDACION');
  const sol = S.solicitarAnticipo(repo, ctx, t, { monto: 2000, motivo: 'Vivienda' });
  assert.equal(sol.ok, true);
  // en trámite ya baja el disponible
  assert.equal(S.miEstadoDeCuenta(repo, ctx, t).data.resumen.disponible, 1000);
  assert.equal(S.solicitarAnticipo(repo, ctx, t, { monto: 1500, motivo: 'Salud' }).ok, false);

  assert.equal(S.bandejaAnticipos(repo, ctx, a).data.length, 1);
  assert.equal(S.decidirAnticipo(repo, ctx, a, sol.data.id, true).ok, true);

  assert.equal(S.generarArchivoAnticipos(repo, ctx, a, 'AIV').code, 'VACIO');
  const arch = S.generarArchivoAnticipos(repo, ctx, a, 'PCA').data;
  assert.deepEqual(arch.filas[1], [5847, 'V', '12345678', 5, 'A', 2000, 'Esther Rodríguez']);
  assert.match(arch.csv, /^FIDEICOMISO;Cedula;;TIPO T;FORMA;MONTO;NS/);
  assert.match(arch.csv, /5847;V;12345678;5;A;2000\.00;Esther Rodríguez/);
  assert.equal(repo.anticipoPorId(sol.data.id).estado, 'EN_ARCHIVO');

  assert.equal(S.marcarAnticiposPagados(repo, ctx, a, [sol.data.id]).data.cambiados, 1);
  const r = S.miEstadoDeCuenta(repo, ctx, t).data.resumen;
  assert.equal(r.anticiposPagados, 2000);
  assert.equal(r.disponible, 1000);
  assert.ok(repo.st.logs.some((l) => l.accion === 'ANTICIPO_PAGADA'));
});

test('rechazo exige motivo y libera el disponible; el trabajador puede cancelar lo pendiente', () => {
  const { repo, ctx } = escenario();
  const t = entrar(repo, ctx), a = admin(repo, ctx);
  const s1 = S.solicitarAnticipo(repo, ctx, t, { monto: 1000, motivo: 'Salud' }).data;
  assert.equal(S.decidirAnticipo(repo, ctx, a, s1.id, false, '').code, 'VALIDACION');
  S.decidirAnticipo(repo, ctx, a, s1.id, false, 'Falta soporte');
  assert.equal(S.miEstadoDeCuenta(repo, ctx, t).data.resumen.disponible, 3000);
  const s2 = S.solicitarAnticipo(repo, ctx, t, { monto: 500, motivo: 'Salud' }).data;
  assert.equal(S.cancelarAnticipo(repo, ctx, t, s2.id).ok, true);
  assert.equal(S.cancelarAnticipo(repo, ctx, t, s2.id).code, 'TRANSICION');
});

test('el archivo separa por empresa (AIV usa su propio fideicomiso)', () => {
  const { repo, ctx } = escenario();
  repo.st.aportes.push({ clave: 'V98765432', anio: 2026, trimestre: 1, empresa: 'AIV', total: 1000 });
  repo.st.cierres['2026-1-AIV'] = { anio: 2026, trimestre: 1, empresa: 'AIV', estado: 'ACREDITADO' };
  const a = admin(repo, ctx), t = entrar(repo, ctx, '98765432');
  const s = S.solicitarAnticipo(repo, ctx, t, { monto: 400, motivo: 'Educación' }).data;
  S.decidirAnticipo(repo, ctx, a, s.id, true);
  assert.equal(S.generarArchivoAnticipos(repo, ctx, a, 'PCA').code, 'VACIO');
  assert.equal(S.generarArchivoAnticipos(repo, ctx, a, 'AIV').data.filas[1][0], 6000);
});

test('RRHH acredita un cierre y solo desde CERRADO', () => {
  const { repo, ctx } = escenario();
  const a = admin(repo, ctx);
  repo.st.cierres['2026-2-PCA'] = { anio: 2026, trimestre: 2, empresa: 'PCA', estado: 'ABIERTO' };
  assert.equal(S.cambiarEstadoCierre(repo, ctx, a, 2026, 2, 'PCA', 'ACREDITADO').code, 'TRANSICION');
  repo.st.cierres['2026-2-PCA'].estado = 'CERRADO';
  assert.equal(S.cambiarEstadoCierre(repo, ctx, a, 2026, 2, 'PCA', 'ACREDITADO').data.estado, 'ACREDITADO');
});

test('clave de RRHH incorrecta', () => {
  const { repo, ctx } = escenario();
  assert.equal(S.iniciarSesionAdmin(repo, ctx, '11111111', 'mala').code, 'CREDENCIALES');
});

test('RRHH carga el detalle de empleados y el trabajador ya puede entrar', () => {
  const repo = crearRepo([]), ctx = crearCtx();
  const sal = 's'; repo.st.usuarios['11111111'] = { sal, hash: ctx.hash('k', sal), rol: 'RRHH' };
  const a = S.iniciarSesionAdmin(repo, ctx, '11111111', 'k').data.token;
  assert.equal(S.iniciarSesion(repo, ctx, '30580323').code, 'NO_ENCONTRADO');
  const r = S.cargarEmpleados(repo, ctx, a, [
    { cedula: 'V305803231', nombre: 'Ana Uno', organizacion: 'PROSEIN', fechaInicio: '01/02/2020' },
    { cedula: 'V123456789', nombre: 'Verificador Malo', organizacion: 'PROSEIN', fechaInicio: '' },
  ]);
  assert.deepEqual(r.data.resumen, { agregados: 2, actualizados: 0, inactivados: 0 });
  assert.equal(r.data.revisar.length, 1);
  assert.equal(r.data.sinFecha, 1);
  assert.equal(S.iniciarSesion(repo, ctx, '30580323').ok, true);
  // un trabajador no puede cargar empleados
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  assert.equal(S.cargarEmpleados(repo, ctx, t, [{ cedula: 'V1', nombre: 'x' }]).code, 'SESION');
});

test('RRHH cambia la empresa del fideicomiso y la recarga del detalle la respeta', () => {
  const repo = crearRepo([]), ctx = crearCtx();
  const sal = 's'; repo.st.usuarios['11111111'] = { sal, hash: ctx.hash('k', sal), rol: 'RRHH' };
  const a = S.iniciarSesionAdmin(repo, ctx, '11111111', 'k').data.token;
  const fila = { cedula: 'V111111111', nombre: 'Eleanne Ruiz', organizacion: 'PROSEIN', fechaInicio: '01/02/2020' };
  S.cargarEmpleados(repo, ctx, a, [fila]);
  assert.equal(S.fijarEmpresaFideicomiso(repo, ctx, a, 'V11111111', 'AIV').data.empresa, 'AIV');
  S.cargarEmpleados(repo, ctx, a, [fila]);
  assert.equal(S.listarEmpleados(repo, ctx, a, 'ruiz').data.empleados[0].empresa, 'AIV');
  assert.equal(S.fijarEmpresaFideicomiso(repo, ctx, a, 'V11111111', 'XXX').code, 'VALIDACION');
});

test('login con la cédula real, con el RIF completo y con cédula de 7 dígitos', () => {
  const E = require('../core/empleados.js');
  const rif7 = 'V' + '09123456' + E.verificadorRif('V', '09123456');
  const repo = crearRepo([
    { cedula: 'V305803231', nombre: 'Ana Real', organizacion: 'PROSEIN', fechaInicio: '01/02/2020' },
    { cedula: rif7, nombre: 'Siete Digitos', organizacion: 'PROSEIN', fechaInicio: '01/02/2020' },
  ]);
  const ctx = crearCtx();
  assert.equal(S.iniciarSesion(repo, ctx, '30580323').data.nombre, 'Ana Real');   // cédula
  assert.equal(S.iniciarSesion(repo, ctx, 'V-305803231').data.nombre, 'Ana Real'); // RIF
  assert.equal(S.iniciarSesion(repo, ctx, '9123456').data.nombre, 'Siete Digitos'); // sin el cero
  assert.equal(S.iniciarSesion(repo, ctx, '09123456').data.nombre, 'Siete Digitos');
});

/* ---------- RRHH con clave desde la misma entrada, y jefes ---------- */

function conRRHH() {
  const E = require('../core/empleados.js');
  const repo = crearRepo([
    { cedula: 'V305803231', nombre: 'Samuel Herrera', organizacion: 'PROSEIN CENTRAL', departamento: 'Recursos Humanos', fechaInicio: '01/02/2020' },
    { cedula: 'V' + '09123456' + E.verificadorRif('V', '09123456'), nombre: 'Luis Paul Rojas', organizacion: 'PROSEIN CENTRAL', departamento: 'Recursos Humanos', fechaInicio: '01/02/2020' },
    { cedula: 'V111111111', nombre: 'Ana Vendedora', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', fechaInicio: '01/02/2021' },
    { cedula: 'V222222222', nombre: 'Beto Vendedor', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', fechaInicio: '01/02/2021' },
    { cedula: 'V333333333', nombre: 'Carla Jefa', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', fechaInicio: '01/02/2019' },
  ]);
  const ctx = crearCtx();
  for (const ced of ['30580323', '9123456']) {
    const sal = 'x' + ced; repo.st.usuarios[ced] = { sal, hash: ctx.hash('clave-segura', sal), rol: 'RRHH' };
  }
  return { repo, ctx };
}

test('si la cédula es de RRHH, la entrada pide clave y no entrega sesión', () => {
  const { repo, ctx } = conRRHH();
  const r = S.iniciarSesion(repo, ctx, '30580323');
  assert.deepEqual(r, { ok: true, data: { requiereClave: true } });
  assert.equal(S.iniciarSesion(repo, ctx, 'V-305803231').data.requiereClave, true); // también con el RIF
  assert.equal(S.iniciarSesion(repo, ctx, '09123456').data.requiereClave, true);     // y con cero inicial
  assert.equal(S.iniciarSesion(repo, ctx, '111111111'.slice(0, 8)).data.token !== undefined, true); // un trabajador normal entra directo
});

test('RRHH entra con su clave y además recibe su sesión de empleado', () => {
  const { repo, ctx } = conRRHH();
  assert.equal(S.iniciarSesionAdmin(repo, ctx, '30580323', 'mala').code, 'CREDENCIALES');
  const r = S.iniciarSesionAdmin(repo, ctx, '30580323', 'clave-segura');
  assert.equal(r.ok, true);
  assert.equal(r.data.nombre, 'Samuel Herrera');
  assert.equal(S.leerToken(ctx, r.data.token, ['RRHH']).clave, '30580323');
  assert.equal(S.miEstadoDeCuenta(repo, ctx, r.data.tokenTrabajador).ok, true);
  assert.equal(S.miEstadoDeCuenta(repo, ctx, r.data.token).code, 'SESION'); // el token de RRHH no es de trabajador
});

test('la clave de RRHH se bloquea tras 5 intentos', () => {
  const { repo, ctx } = conRRHH();
  for (let i = 0; i < 5; i++) S.iniciarSesionAdmin(repo, ctx, '30580323', 'x');
  assert.equal(S.iniciarSesionAdmin(repo, ctx, '30580323', 'clave-segura').code, 'BLOQUEADO');
});

test('jefe directo: asignar, quitar y validar', () => {
  const { repo, ctx } = conRRHH();
  const a = S.iniciarSesionAdmin(repo, ctx, '30580323', 'clave-segura').data.token;
  assert.equal(S.asignarJefe(repo, ctx, a, ['V11111111'], 'V33333333').data.cambiados, 1);
  const ana = S.listarEmpleados(repo, ctx, a, { buscar: 'ana' }).data.empleados[0];
  assert.equal(ana.jefe, 'V33333333');
  assert.equal(ana.jefeNombre, 'Carla Jefa');
  assert.equal(S.asignarJefe(repo, ctx, a, ['V11111111'], 'V99999999').code, 'VALIDACION'); // jefe inexistente
  assert.equal(S.asignarJefe(repo, ctx, a, ['V11111111'], '').data.cambiados, 1);            // quitar
});

test('jefe directo: nadie es su propio jefe ni se crean ciclos', () => {
  const { repo, ctx } = conRRHH();
  const a = S.iniciarSesionAdmin(repo, ctx, '30580323', 'clave-segura').data.token;
  assert.equal(S.asignarJefe(repo, ctx, a, ['V11111111'], 'V11111111').data.cambiados, 0);
  S.asignarJefe(repo, ctx, a, ['V11111111'], 'V22222222');                 // Beto es jefe de Ana
  const r = S.asignarJefe(repo, ctx, a, ['V22222222'], 'V11111111');       // Ana jefa de Beto → ciclo
  assert.equal(r.data.cambiados, 0);
  assert.equal(r.data.omitidos.length, 1);
});

test('jefe por departamento: todos los activos menos el propio jefe', () => {
  const { repo, ctx } = conRRHH();
  const a = S.iniciarSesionAdmin(repo, ctx, '30580323', 'clave-segura').data.token;
  const r = S.asignarJefeDepartamento(repo, ctx, a, 'Ventas', 'V33333333');
  assert.equal(r.data.cambiados, 2);   // Ana y Beto; Carla (la jefa) no se toca
  const lista = S.listarEmpleados(repo, ctx, a, { departamento: 'Ventas', sinJefe: true }).data;
  assert.deepEqual(lista.empleados.map((e) => e.nombre), ['Carla Jefa']);
  assert.ok(lista.departamentos.includes('Ventas'));
  assert.equal(S.asignarJefeDepartamento(repo, ctx, a, 'Inventado', 'V33333333').code, 'VALIDACION');
});

test('recargar el detalle conserva los jefes asignados', () => {
  const { repo, ctx } = conRRHH();
  const a = S.iniciarSesionAdmin(repo, ctx, '30580323', 'clave-segura').data.token;
  S.asignarJefe(repo, ctx, a, ['V11111111'], 'V33333333');
  S.cargarEmpleados(repo, ctx, a, [
    { cedula: 'V111111111', nombre: 'Ana Vendedora', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', fechaInicio: '01/02/2021' },
    { cedula: 'V333333333', nombre: 'Carla Jefa', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', fechaInicio: '01/02/2019' },
  ]);
  assert.equal(S.listarEmpleados(repo, ctx, a, { buscar: 'ana' }).data.empleados[0].jefe, 'V33333333');
});

test('un trabajador no puede asignar jefes', () => {
  const { repo, ctx } = conRRHH();
  const t = S.iniciarSesion(repo, ctx, '11111111').data.token;
  assert.equal(S.asignarJefe(repo, ctx, t, ['V11111111'], 'V33333333').code, 'SESION');
});

/* ---------- Constancia de trabajo ---------- */

function conSueldo(extra = {}) {
  const repo = crearRepo([{ cedula: 'V305803231', nombre: 'Samuel Herrera', organizacion: 'PROSEIN CENTRAL', puesto: 'Asistente', fechaInicio: '12/11/2024', salarioMensual: 5500, ...extra }]);
  return { repo, ctx: crearCtx(Date.UTC(2026, 9, 29, 15, 0)) };
}

test('constancia: sale sola con los datos de hoy, vigencia de 30 días y código único', () => {
  const { repo, ctx } = conSueldo();
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  const r = S.emitirConstancia(repo, ctx, t);
  assert.equal(r.ok, true);
  const c = r.data;
  assert.equal(c.nombre, 'Samuel Herrera');
  assert.equal(c.cedula, 'V-30580323');
  assert.equal(c.fechaIngreso, '12/11/2024');
  assert.equal(c.salario, 5500);
  assert.equal(c.empresa, 'PCA');
  assert.equal(c.estado, 'VIGENTE');
  assert.equal(require('../core/constancia.js').fechaCorta(require('../core/constancia.js').fechaCaracas(c.vence)), '28/11/2026');
  assert.match(c.id, /^[A-Z0-9]{10,}$/);
  assert.equal(c.firmante.cargo, 'Gerente de Gestión Humana');
  assert.ok(repo.st.logs.some((l) => l.accion === 'CONSTANCIA_EMITIDA'));
});

test('constancia: faltan datos → mensaje claro; no se emite', () => {
  const sinSueldo = conSueldo({ salarioMensual: '' });
  const t = S.iniciarSesion(sinSueldo.repo, sinSueldo.ctx, '30580323').data.token;
  assert.match(S.emitirConstancia(sinSueldo.repo, sinSueldo.ctx, t).message, /salario/);
  const sinFecha = conSueldo({ fechaInicio: '' });
  const t2 = S.iniciarSesion(sinFecha.repo, sinFecha.ctx, '30580323').data.token;
  assert.match(S.emitirConstancia(sinFecha.repo, sinFecha.ctx, t2).message, /fecha de ingreso/);
});

test('constancia: solo una vigente a la vez; al vencer (o si RRHH la anula) se puede generar otra', () => {
  const { repo, ctx } = conSueldo();
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  const c1 = S.emitirConstancia(repo, ctx, t);
  assert.equal(c1.ok, true);
  const otra = S.emitirConstancia(repo, ctx, t);
  assert.equal(otra.code, 'YA_VIGENTE');
  assert.match(otra.message, /vigente hasta el 28\/11\/2026.*a partir del 29\/11\/2026/);
  assert.equal(S.misConstancias(repo, ctx, t).data.length, 1);          // no se creó otra

  ctx.reloj.t += 30 * 86400000;                                           // día 30: sigue vigente
  const t2 = S.iniciarSesion(repo, ctx, '30580323').data.token;
  assert.equal(S.emitirConstancia(repo, ctx, t2).code, 'YA_VIGENTE');
  ctx.reloj.t += 1 * 86400000;                                            // día 31: vencida → puede
  const t3 = S.iniciarSesion(repo, ctx, '30580323').data.token;
  const c2 = S.emitirConstancia(repo, ctx, t3);
  assert.equal(c2.ok, true);
  assert.notEqual(c2.data.id, c1.data.id);

  repo.st.usuarios['11111111'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const rr = S.iniciarSesionAdmin(repo, ctx, '11111111', 'k').data.token;
  assert.equal(S.emitirConstancia(repo, ctx, t3).code, 'YA_VIGENTE');
  S.anularConstancia(repo, ctx, rr, c2.data.id);                          // RRHH anula → puede generar otra
  assert.equal(S.emitirConstancia(repo, ctx, t3).ok, true);
});

test('constancia: aun anulando, el tope de 5 en 30 días se mantiene', () => {
  const { repo, ctx } = conSueldo();
  repo.st.usuarios['11111111'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const rr = S.iniciarSesionAdmin(repo, ctx, '11111111', 'k').data.token;
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  for (let i = 0; i < 5; i++) { const c = S.emitirConstancia(repo, ctx, t); assert.equal(c.ok, true); S.anularConstancia(repo, ctx, rr, c.data.id); }
  assert.equal(S.emitirConstancia(repo, ctx, t).code, 'LIMITE');
});

test('verificación pública por código: vigente, vencida y anulada', () => {
  const { repo, ctx } = conSueldo();
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  const c = S.emitirConstancia(repo, ctx, t).data;
  const v = S.verificarConstancia(repo, ctx, c.id.toLowerCase());     // sin sesión
  assert.equal(v.data.estado, 'VIGENTE');
  assert.equal(v.data.salario, 5500);
  assert.equal(v.data.firmante, undefined);
  ctx.reloj.t += 30 * 86400000;                                         // día 30: todavía vigente
  assert.equal(S.verificarConstancia(repo, ctx, c.id).data.estado, 'VIGENTE');
  ctx.reloj.t += 1 * 86400000;                                          // día 31: vencida
  const venc = S.verificarConstancia(repo, ctx, c.id);
  assert.equal(venc.data.estado, 'VENCIDA');
  assert.equal(venc.data.nombre, 'Samuel Herrera');                     // sigue mostrando los datos
  ctx.reloj.t -= 31 * 86400000;
  const a = S.iniciarSesion(repo, ctx, '30580323');                       // el mismo trabajador no puede anular
  assert.equal(S.anularConstancia(repo, ctx, a.data.token, c.id).code, 'SESION');
  repo.st.usuarios['11111111'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const rr = S.iniciarSesionAdmin(repo, ctx, '11111111', 'k').data.token;
  assert.equal(S.anularConstancia(repo, ctx, rr, c.id).data.estado, 'ANULADA');
  assert.equal(S.verificarConstancia(repo, ctx, c.id).data.estado, 'ANULADA');
  assert.equal(S.listarConstancias(repo, ctx, rr).data.length, 1);
});

test('verificación: códigos inventados se rechazan y se limitan', () => {
  const { repo, ctx } = conSueldo();
  assert.equal(S.verificarConstancia(repo, ctx, 'x').code, 'NO_ENCONTRADO');
  for (let i = 0; i < 40; i++) S.verificarConstancia(repo, ctx, 'ABCDEFGHIJ' + i);
  assert.equal(S.verificarConstancia(repo, ctx, 'ABCDEFGHIJKL').code, 'BLOQUEADO');
});

test('mis constancias: solo las propias', () => {
  const { repo, ctx } = conSueldo();
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  S.emitirConstancia(repo, ctx, t);
  repo.st.constancias.OTRA = { id: 'OTRA', clave: 'V99999999', emision: 1, vence: 2, estado: 'VIGENTE' };
  assert.equal(S.misConstancias(repo, ctx, t).data.length, 1);
});

test('el sueldo del detalle llega al empleado y se conserva si el archivo nuevo no lo trae', () => {
  const E = require('../core/empleados.js');
  const a = E.fusionarDetalle([], [{ cedula: 'V305803231', nombre: 'Ana', organizacion: 'X', fechaInicio: '01/01/2020', salarioMensual: '1.234,56' }]).empleados;
  assert.equal(a[0].salarioMensual, 1234.56);
  const b = E.fusionarDetalle(a, [{ cedula: 'V305803231', nombre: 'Ana', organizacion: 'X', fechaInicio: '01/01/2020' }]).empleados;
  assert.equal(b[0].salarioMensual, 1234.56);
  const c = E.fusionarDetalle(b, [{ cedula: 'V305803231', nombre: 'Ana', organizacion: 'X', fechaInicio: '01/01/2020', salarioMensual: 6000 }]).empleados;
  assert.equal(c[0].salarioMensual, 6000);
});

test('la entrada devuelve el género para el saludo (trabajador y RRHH)', () => {
  const repo = crearRepo([{ cedula: 'V305803231', nombre: 'Samuel Herrera', organizacion: 'X', fechaInicio: '01/01/2020', genero: 'Masculino' },
    { cedula: 'V111111119', nombre: 'Ana', organizacion: 'X', fechaInicio: '01/01/2020', genero: 'Femenino' }]);
  const ctx = crearCtx();
  assert.equal(S.iniciarSesion(repo, ctx, '11111111').data.genero, 'Femenino');
  repo.st.usuarios['30580323'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'ADMIN' };
  assert.equal(S.iniciarSesionAdmin(repo, ctx, '30580323', 'k').data.genero, 'Masculino');
});

/* ---------- Vacaciones ---------- */

function conVacaciones() {
  const repo = crearRepo([
    { cedula: 'V305803231', nombre: 'Samuel Herrera', organizacion: 'PROSEIN CENTRAL', departamento: 'RRHH', fechaInicio: '10/03/2022' },
    { cedula: 'V111111119', nombre: 'Carla Jefa', organizacion: 'PROSEIN CENTRAL', departamento: 'RRHH', fechaInicio: '01/01/2015' },
    { cedula: 'V222222229', nombre: 'Nuevo Ingreso', organizacion: 'PROSEIN CENTRAL', departamento: 'RRHH', fechaInicio: '15/10/2025' },
  ]);
  const ctx = crearCtx(Date.UTC(2026, 9, 29, 15, 0));            // 29/10/2026 en Caracas
  repo.st.usuarios['99999999'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const rrhh = S.iniciarSesionAdmin(repo, ctx, '99999999', 'k').data.token;
  S.asignarJefe(repo, ctx, rrhh, ['V30580323', 'V22222222'], 'V11111111');
  // cierre importado: Samuel 7 días del 24-25 (ya pagado) + 18 del 25-26 (sin tocar)
  S.importarCierreVacaciones(repo, ctx, rrhh, [{ cedula: 'V30580323', periodos: [
    { periodo: '2023-2024', correspondientes: 16, disfrutadosPrevios: 16 },
    { periodo: '2024-2025', correspondientes: 17, disfrutadosPrevios: 10 },
    { periodo: '2025-2026', correspondientes: 18, disfrutadosPrevios: 0 }] }, { cedula: 'V99999999', periodos: [{ periodo: '2025-2026', correspondientes: 15, disfrutadosPrevios: 0 }] }]);
  const yo = S.iniciarSesion(repo, ctx, '30580323').data.token;
  const jefa = S.iniciarSesion(repo, ctx, '11111111').data.token;
  return { repo, ctx, rrhh, yo, jefa };
}

test('vacaciones: el trabajador ve su saldo por período, su jefe y las reglas', () => {
  const { repo, ctx, yo } = conVacaciones();
  const d = S.datosVacaciones(repo, ctx, yo).data;
  assert.equal(d.hoy, '2026-10-29');
  assert.equal(d.saldo.total, 25);
  assert.equal(d.jefe.nombre, 'Carla Jefa');
  assert.deepEqual([d.reglas.anticipacionMin, d.reglas.anticipacionMax], [15, 20]);
  assert.ok(d.feriados.includes('2026-10-12'));
});

test('vacaciones: ingreso nuevo sin cierre arranca con 15 días al cumplir el año', () => {
  const { repo, ctx } = conVacaciones();
  const t = S.iniciarSesion(repo, ctx, '22222222').data.token;
  assert.equal(S.datosVacaciones(repo, ctx, t).data.saldo.total, 15);
});

test('vacaciones: flujo completo trabajador → jefe → RRHH, con pago del período la primera vez', () => {
  const { repo, ctx, rrhh, yo, jefa } = conVacaciones();
  const r = S.solicitarVacaciones(repo, ctx, yo, { inicio: '2026-11-13', dias: 10 });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.culminacion, '2026-11-26');
  assert.equal(r.data.reintegro, '2026-11-27');
  assert.equal(r.data.condicion, 'Disfrute de días con pago');        // 3 días salen del 25-26: se paga completo
  assert.equal(r.data.estado, 'PENDIENTE_JEFE');
  assert.equal(S.datosVacaciones(repo, ctx, yo).data.saldo.total, 15);  // reservados mientras está en trámite

  // la jefa la ve y la aprueba; otro trabajador no puede
  const eq = S.equipoVacaciones(repo, ctx, jefa).data;
  assert.equal(eq.esJefe, true);
  assert.equal(eq.pendientes.length, 1);
  assert.equal(eq.pendientes[0].nombre, 'Samuel Herrera');
  assert.equal(S.decidirVacacionesJefe(repo, ctx, yo, r.data.id, true).code, 'NO_ENCONTRADO');
  assert.equal(S.decidirVacacionesJefe(repo, ctx, jefa, r.data.id, true).data.estado, 'APROBADA_JEFE');
  assert.equal(S.cancelarVacaciones(repo, ctx, yo, r.data.id).code, 'TRANSICION');   // ya no se puede cancelar

  // llega a RRHH, que la registra con la nómina
  const b = S.bandejaVacaciones(repo, ctx, rrhh).data;
  assert.equal(b.solicitudes.length, 1);
  assert.equal(b.solicitudes[0].jefeNombre, 'Carla Jefa');
  const reg = S.registrarVacaciones(repo, ctx, rrhh, r.data.id, 'NV-80').data;
  assert.equal(reg.estado, 'REGISTRADA');
  assert.equal(reg.numeroConstancia, '46339V305803234635246353');   // 13/11 + cédula + 26/11 + 27/11 (seriales de Excel)
  assert.deepEqual(reg.pendientesDespues, { porPeriodo: [{ periodo: '2023-2024', pendientes: 0 }, { periodo: '2024-2025', pendientes: 0 }, { periodo: '2025-2026', pendientes: 15 }], total: 15 });
  assert.equal(reg.empresa, 'PCA');
  assert.equal(S.datosVacaciones(repo, ctx, yo).data.solicitudes[0].numeroConstancia, reg.numeroConstancia);
  assert.equal(S.datosVacaciones(repo, ctx, yo).data.saldo.total, 15);

  // 20 días después pide otra (dentro de su nueva ventana): ya es solo disfrute (el 25-26 ya se pagó)
  ctx.reloj.t += 20 * 86400000;                                         // hoy = 18/11 → ventana 03/12 a 08/12
  const yo2 = S.iniciarSesion(repo, ctx, '30580323').data.token;
  const r2 = S.solicitarVacaciones(repo, ctx, yo2, { inicio: '2026-12-03', dias: 5 });
  assert.equal(r2.ok, true, r2.message);
  assert.equal(r2.data.condicion, 'Disfrute');
});

test('vacaciones: rechazo del jefe exige motivo y libera los días; cancelar mientras está con el jefe', () => {
  const { repo, ctx, yo, jefa } = conVacaciones();
  const r = S.solicitarVacaciones(repo, ctx, yo, { inicio: '2026-11-13', dias: 5 }).data;
  assert.equal(S.decidirVacacionesJefe(repo, ctx, jefa, r.id, false, '').code, 'VALIDACION');
  assert.equal(S.decidirVacacionesJefe(repo, ctx, jefa, r.id, false, 'Cierre de mes').data.estado, 'RECHAZADA');
  assert.equal(S.datosVacaciones(repo, ctx, yo).data.saldo.total, 25);
  const r2 = S.solicitarVacaciones(repo, ctx, yo, { inicio: '2026-11-16', dias: 3 }).data;
  assert.equal(S.cancelarVacaciones(repo, ctx, yo, r2.id).data.estado, 'CANCELADA');
});

test('vacaciones: sin jefe asignado no se puede solicitar; RRHH ve cuántos faltan', () => {
  const { repo, ctx, rrhh } = conVacaciones();
  const t = S.iniciarSesion(repo, ctx, '11111111').data.token;          // la jefa no tiene jefe
  assert.match(S.solicitarVacaciones(repo, ctx, t, { inicio: '2026-11-13', dias: 1 }).message, /jefe directo/);
  assert.equal(S.bandejaVacaciones(repo, ctx, rrhh).data.sinJefe, 1);
});

test('vacaciones: importar el cierre informa egresos e ingresos y reemplaza los saldos', () => {
  const { repo, ctx, rrhh } = conVacaciones();
  const r = S.importarCierreVacaciones(repo, ctx, rrhh, [
    { cedula: 'V305803231', periodos: [{ periodo: '2025-2026', correspondientes: 18, disfrutadosPrevios: 2 }] },   // con RIF también
    { cedula: 'V88888888', periodos: [{ periodo: '2025-2026', correspondientes: 15, disfrutadosPrevios: 0 }] },
  ]).data;
  assert.deepEqual(r, { personas: 2, periodos: 2, noActivos: 1, activosSinCierre: 2 });
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  assert.equal(S.datosVacaciones(repo, ctx, t).data.saldo.total, 16);
  assert.equal(S.importarCierreVacaciones(repo, ctx, t, []).code, 'SESION');
});

test('cargar el detalle con «JEFE DIRECTO»: asigna los que encuentra y reporta los que no', () => {
  const repo = crearRepo([]), ctx = crearCtx();
  repo.st.usuarios['99999999'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const a = S.iniciarSesionAdmin(repo, ctx, '99999999', 'k').data.token;
  const fila = (ced, nombre, jefe) => ({ cedula: ced, nombre, organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2020', jefeNombre: jefe });
  const r = S.cargarEmpleados(repo, ctx, a, [
    fila('V111111119', 'LUIS PAUL ROJAS LISARDO', ''),                 // gerente: sin jefe en el archivo
    fila('V222222229', 'SAMUEL HERRERA KEY', 'LUIS PAUL ROJAS LISARDO'),
    fila('V333333339', 'ANA VENDEDORA', 'SAMUEL HERRERA'),             // abreviado
    fila('V444444449', 'BETO VENDEDOR', 'BETSY RODRIGUEZ'),            // no está en el detalle
    fila('V555555559', 'CARLA VENDEDORA', 'BETSY RODRIGUEZ'),
  ]).data;
  assert.equal(r.jefes.asignados, 2);
  assert.equal(r.jefes.sinJefeEnArchivo, 1);
  assert.deepEqual(r.jefes.noEncontrados, [{ jefe: 'BETSY RODRIGUEZ', personas: 2, tipo: 'no_encontrado' }]);
  const l = S.listarEmpleados(repo, ctx, a, {}).data.empleados;
  const jefeDe = (n) => l.find((e) => e.nombre === n).jefeNombre;
  assert.equal(jefeDe('SAMUEL HERRERA KEY'), 'LUIS PAUL ROJAS LISARDO');
  assert.equal(jefeDe('ANA VENDEDORA'), 'SAMUEL HERRERA KEY');
  assert.equal(jefeDe('BETO VENDEDOR'), '');
  // si RRHH le asigna jefe a mano y luego recarga el mismo archivo, no se borra
  S.asignarJefe(repo, ctx, a, ['V44444444'], 'V22222222');
  S.cargarEmpleados(repo, ctx, a, [fila('V444444449', 'BETO VENDEDOR', 'BETSY RODRIGUEZ'), fila('V222222229', 'SAMUEL HERRERA KEY', 'LUIS PAUL ROJAS LISARDO')]);
  assert.equal(S.listarEmpleados(repo, ctx, a, { buscar: 'beto' }).data.empleados[0].jefeNombre, 'SAMUEL HERRERA KEY');
});

/* ---------- Fuera de nómina y jefes que son usuarios de RRHH ---------- */

function conDirectivos() {
  const repo = crearRepo([
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '10/03/2022' },
    { cedula: 'V222222229', nombre: 'GERENTE GENERAL', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2015' },
  ]);
  const ctx = crearCtx(Date.UTC(2026, 9, 29, 15, 0));
  repo.st.usuarios['30580323'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'ADMIN', nombre: 'Samuel Herrera' };
  repo.st.usuarios['12121212'] = { sal: 's', hash: ctx.hash('ceo', 's'), rol: 'ADMIN', nombre: 'JOHANNA RODRIGUEZ' };   // CEO: no es empleada
  const rrhh = S.iniciarSesionAdmin(repo, ctx, '30580323', 'k').data.token;
  return { repo, ctx, rrhh };
}

test('fuera de nómina: RRHH lo agrega, no se desactiva al recargar el detalle y tiene vacaciones del cierre', () => {
  const { repo, ctx, rrhh } = conDirectivos();
  const r = S.guardarEmpleadoFueraNomina(repo, ctx, rrhh, { cedula: 'V-12.345.678', nombre: 'María Teresa Cenci', empresa: 'AIV', fechaIngreso: '08/10/1987', genero: 'Femenino', puesto: 'Directora' });
  assert.equal(r.ok, true, r.message);
  assert.equal(S.guardarEmpleadoFueraNomina(repo, ctx, rrhh, { cedula: '123', nombre: 'X', empresa: 'AIV', fechaIngreso: '01/01/2020' }).code, 'VALIDACION');
  assert.match(S.guardarEmpleadoFueraNomina(repo, ctx, rrhh, { cedula: 'V305803231', nombre: 'X', empresa: 'PCA', fechaIngreso: '01/01/2020' }).message, /ya está en la nómina/);
  // recargar el detalle (sin ella) no la desactiva
  S.cargarEmpleados(repo, ctx, rrhh, [{ cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '10/03/2022' }]);
  const ella = S.listarEmpleados(repo, ctx, rrhh, { buscar: 'cenci' }).data.empleados[0];
  assert.equal(ella.estado, 'Activo');
  assert.equal(ella.fueraNomina, true);
  assert.equal(ella.empresa, 'AIV');
  // entra con su cédula y ve su saldo del cierre
  S.importarCierreVacaciones(repo, ctx, rrhh, [{ cedula: 'V12345678', periodos: [{ periodo: '2025-2026', correspondientes: 30, disfrutadosPrevios: 0 }] }]);
  const t = S.iniciarSesion(repo, ctx, '12345678').data.token;
  assert.equal(S.datosVacaciones(repo, ctx, t).data.saldo.total, 30);
  // RRHH la desactiva
  assert.equal(S.desactivarEmpleadoFueraNomina(repo, ctx, rrhh, 'V12345678').ok, true);
  assert.equal(S.iniciarSesion(repo, ctx, '12345678').code, 'NO_ENCONTRADO');
  assert.equal(S.desactivarEmpleadoFueraNomina(repo, ctx, rrhh, 'V30580323').code, 'VALIDACION');   // uno de nómina no
});

test('la CEO (usuaria de RRHH, no empleada) puede ser jefa: se asigna, aprueba desde su sesión de RRHH', () => {
  const { repo, ctx, rrhh } = conDirectivos();
  assert.equal(S.asignarJefe(repo, ctx, rrhh, ['V22222222'], 'V12121212').data.cambiados, 1);
  assert.equal(S.listarEmpleados(repo, ctx, rrhh, { buscar: 'gerente' }).data.empleados[0].jefeNombre, 'JOHANNA RODRIGUEZ');
  assert.deepEqual(S.listarUsuariosJefes(repo, ctx, rrhh).data, [{ clave: 'V12121212', nombre: 'JOHANNA RODRIGUEZ' }]);

  const t = S.iniciarSesion(repo, ctx, '22222222').data.token;
  S.importarCierreVacaciones(repo, ctx, rrhh, [{ cedula: 'V22222222', periodos: [{ periodo: '2025-2026', correspondientes: 25, disfrutadosPrevios: 0 }] }]);
  assert.equal(S.datosVacaciones(repo, ctx, t).data.jefe.nombre, 'JOHANNA RODRIGUEZ');
  const sol = S.solicitarVacaciones(repo, ctx, t, { inicio: '2026-11-13', dias: 5 });
  assert.equal(sol.ok, true, sol.message);

  const ceo = S.iniciarSesionAdmin(repo, ctx, '12121212', 'ceo').data;
  assert.equal(ceo.esJefe, true);
  assert.equal(ceo.nombre, 'JOHANNA RODRIGUEZ');
  assert.equal(ceo.tokenTrabajador, undefined);
  const eq = S.equipoVacaciones(repo, ctx, ceo.token).data;
  assert.equal(eq.pendientes.length, 1);
  assert.equal(S.decidirVacacionesJefe(repo, ctx, ceo.token, sol.data.id, true).data.estado, 'APROBADA_JEFE');
  // otro RRHH que no es su jefe no puede decidir como jefe
  assert.equal(S.decidirVacacionesJefe(repo, ctx, rrhh, sol.data.id, true).code, 'NO_ENCONTRADO');
});

test('el detalle con «JEFE DIRECTO» encuentra también a una usuaria de RRHH que no es empleada', () => {
  const { repo, ctx, rrhh } = conDirectivos();
  const r = S.cargarEmpleados(repo, ctx, rrhh, [
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '10/03/2022', jefeNombre: '' },
    { cedula: 'V222222229', nombre: 'GERENTE GENERAL', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2015', jefeNombre: 'JOHANNA RODRIGUEZ' },
  ]).data;
  assert.equal(r.jefes.asignados, 1);
  assert.deepEqual(r.jefes.noEncontrados, []);
});

test('filas sin cédula no se importan (p. ej. la CEO agregada al detalle sin cédula) y no tapan a la usuaria de RRHH', () => {
  const { repo, ctx, rrhh } = conDirectivos();
  const r = S.cargarEmpleados(repo, ctx, rrhh, [
    { cedula: 'V222222229', nombre: 'GERENTE GENERAL', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2015', jefeNombre: 'JOHANNA RODRIGUEZ' },
    { cedula: '', nombre: 'JOHANNA RODRIGUEZ', organizacion: 'PROSEIN CENTRAL', departamento: 'Gerencia General' },
  ]).data;
  assert.deepEqual(r.sinCedula, ['JOHANNA RODRIGUEZ']);
  assert.equal(r.total, 2);                                 // Samuel y el Gerente General: la fila sin cédula no entra
  assert.equal(r.jefes.asignados, 1);                       // el jefe es la usuaria de RRHH
  assert.deepEqual(r.jefes.noEncontrados, []);
});

test('importar el cierre: la fila sin cédula se asigna por nombre exacto; si no se encuentra, se informa', () => {
  const { repo, ctx, rrhh } = conDirectivos();
  S.guardarEmpleadoFueraNomina(repo, ctx, rrhh, { cedula: 'V085423904', nombre: 'Maria Teresa Cenci', empresa: 'AIV', fechaIngreso: '08/10/1987' });
  const r = S.importarCierreVacaciones(repo, ctx, rrhh, [
    { cedula: '', nombre: 'MARIA TERESA CENCI', periodos: [{ periodo: '2025-2026', correspondientes: 22, disfrutadosPrevios: 0 }] },
    { cedula: '', nombre: 'NADIE CONOCIDO', periodos: [{ periodo: '2025-2026', correspondientes: 15, disfrutadosPrevios: 0 }] },
  ]).data;
  assert.deepEqual(r.porNombre, ['MARIA TERESA CENCI']);
  assert.deepEqual(r.sinIdentificar, ['NADIE CONOCIDO']);
  const t = S.iniciarSesion(repo, ctx, '8542390').data.token;          // entra con su cédula real
  assert.equal(S.datosVacaciones(repo, ctx, t).data.saldo.total, 22);
});

test('anticipos: RRHH abre la solicitud con fechas; sin aprobación, archivo al banco, rechazo y pagadas', () => {
  const repo = crearRepo(filas), ctx = crearCtx(Date.UTC(2026, 9, 30, 15));            // 30/10/2026
  repo.st.usuarios['99999999'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const rrhh = S.iniciarSesionAdmin(repo, ctx, '99999999', 'k').data.token;
  let t = S.iniciarSesion(repo, ctx, '12345678').data.token;
  // sin apertura no se puede
  assert.equal(S.datosAnticipo(repo, ctx, t).data.puedeSolicitar, false);
  assert.match(S.solicitarAnticipo(repo, ctx, t, { monto: 5, motivo: 'Salud', acepta: true }).message, /no está abierta/);
  // RRHH abre el 3.er trimestre (26/10 al 06/11) y programa el 4.º (05/01 al 16/01)
  assert.equal(S.guardarApertura(repo, ctx, t, { clave: '2026-T3', inicio: '2026-10-26', fin: '2026-11-06' }).code, 'SESION');
  const a3 = S.guardarApertura(repo, ctx, rrhh, { clave: '2026-T3', inicio: '2026-10-26', fin: '2026-11-06' }).data;
  assert.equal(a3.estado, 'ABIERTA');
  S.guardarApertura(repo, ctx, rrhh, { clave: '2026-T4', inicio: '2027-01-05', fin: '2027-01-16' });
  let d = S.datosAnticipo(repo, ctx, t).data;
  assert.equal(d.puedeSolicitar, true);
  assert.equal(d.activa.etiqueta, '3.er trimestre de 2026');
  assert.equal(d.proxima.inicio, '2027-01-05');
  const sol1 = S.solicitarAnticipo(repo, ctx, t, { monto: 50000, motivo: 'Vivienda', acepta: true }).data;
  const t2 = S.iniciarSesion(repo, ctx, '98765432').data.token;
  const sol2 = S.solicitarAnticipo(repo, ctx, t2, { monto: 3000, motivo: 'Salud', acepta: true }).data;
  assert.match(S.solicitarAnticipo(repo, ctx, t, { monto: 10, motivo: 'Salud', acepta: true }).message, /Ya enviaste.*05\/01\/2027/);
  assert.equal(S.listarAperturas(repo, ctx, rrhh).data.find((x) => x.clave === '2026-T3').solicitudes, 2);
  assert.match(S.eliminarApertura(repo, ctx, rrhh, a3.id).message, /ya tiene solicitudes/);
  // RRHH no aprueba: descarga el archivo directo con las recibidas
  assert.equal(S.generarArchivoAnticipos(repo, ctx, rrhh, 'PCA').data.cantidad, 1);
  assert.equal(S.generarArchivoAnticipos(repo, ctx, rrhh, 'AIV').data.cantidad, 1);
  assert.equal(S.cancelarAnticipo(repo, ctx, t, sol1.id).code, 'TRANSICION');      // ya está en el banco
  // el banco rechaza una; las demás, pagadas
  S.rechazarAnticipoBanco(repo, ctx, rrhh, sol1.id, 'El monto supera el disponible');
  const resto = S.bandejaAnticipos(repo, ctx, rrhh, 'EN_ARCHIVO').data.map((x) => x.id);
  assert.deepEqual(resto, [sol2.id]);
  assert.equal(S.marcarAnticiposPagados(repo, ctx, rrhh, resto).data.cambiados, 1);
  // en enero (4.º trimestre) puede volver a pedir
  ctx.reloj.t = Date.UTC(2027, 0, 6, 15);
  t = S.iniciarSesion(repo, ctx, '12345678').data.token;
  d = S.datosAnticipo(repo, ctx, t).data;
  assert.equal(d.activa.etiqueta, '4.º trimestre de 2026');
  assert.equal(d.puedeSolicitar, true);
  assert.equal(S.solicitarAnticipo(repo, ctx, t, { monto: 20000, motivo: 'Salud', acepta: true }).data.ventanaEtiqueta, '4.º trimestre de 2026');
});

test('aperturas: no se cambia el trimestre si ya tiene solicitudes; se puede cerrar antes cambiando la fecha final', () => {
  const repo = crearRepo(filas), ctx = crearCtx(Date.UTC(2026, 9, 30, 15));
  repo.st.usuarios['99999999'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  const rrhh = S.iniciarSesionAdmin(repo, ctx, '99999999', 'k').data.token;
  const a = S.guardarApertura(repo, ctx, rrhh, { clave: '2026-T3', inicio: '2026-10-26', fin: '2026-11-06' }).data;
  const t = S.iniciarSesion(repo, ctx, '12345678').data.token;
  S.solicitarAnticipo(repo, ctx, t, { monto: 100, motivo: 'Salud', acepta: true });
  assert.match(S.guardarApertura(repo, ctx, rrhh, { id: a.id, clave: '2026-T4', inicio: '2026-10-26', fin: '2026-11-06' }).message, /no el trimestre/);
  assert.equal(S.guardarApertura(repo, ctx, rrhh, { id: a.id, clave: '2026-T3', inicio: '2026-10-26', fin: '2026-10-29' }).data.estado, 'CERRADA');
  const vacia = S.guardarApertura(repo, ctx, rrhh, { clave: '2027-T1', inicio: '2027-04-05', fin: '2027-04-16' }).data;
  assert.equal(S.eliminarApertura(repo, ctx, rrhh, vacia.id).ok, true);
});


/* ---------- Fideicomiso: aportes y cancelaciones ---------- */

function conAportes() {
  const repo = crearRepo([
    { cedula: 'V111111119', nombre: 'Esther Lilia Rodríguez Hernández', organizacion: 'PROSEIN CENTRAL', fechaInicio: '05/03/2025' },
    { cedula: 'V333333339', nombre: 'Alirio Alfonso Ávila', organizacion: 'PROSEIN CENTRAL', fechaInicio: '25/07/2011' },
  ]);
  const ctx = crearCtx(Date.UTC(2026, 9, 30, 15));
  repo.st.parametros = { ...repo.st.parametros, anioBase: 2025, diasMinimosMes: 1, diasUtilidades: 120 };
  repo.st.usuarios['99999999'] = { sal: 's', hash: ctx.hash('k', 's'), rol: 'RRHH' };
  return { repo, ctx, rrhh: S.iniciarSesionAdmin(repo, ctx, '99999999', 'k').data.token };
}
const PER = { anio: 2026, trimestre: 3, empresa: 'PCA' };
const FILAS = [{ nombre: 'Esther Lilia Rodriguez Hernandez', monto: 12583.168 }, { nombre: 'ALIRIO ALFONSO AVILA', monto: 192290.08 }];

test('aportes: vista previa, cierre sin duplicados, reapertura explícita y acreditado intocable', () => {
  const { repo, ctx, rrhh } = conAportes();
  const pre = S.prepararAporte(repo, ctx, rrhh, { ...PER, filas: FILAS }).data;
  assert.equal(pre.totales.total, 2883.64 + 129896.7);
  assert.equal(pre.primeraCarga, true);
  assert.equal(repo.st.aportes.length, 0);                                        // la vista previa no guarda
  assert.equal(S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS }).data.estado, 'CERRADO');
  assert.equal(S.estadoAporte(repo, ctx, rrhh, PER).data.lineas.length, 2);
  assert.equal(S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS }).code, 'YA_CERRADO');
  assert.equal(S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS.slice(0, 1), reemplazar: true }).data.estado, 'CERRADO');
  assert.equal(S.estadoAporte(repo, ctx, rrhh, PER).data.lineas.length, 1);       // reemplazó, no duplicó
  S.cambiarEstadoCierre(repo, ctx, rrhh, 2026, 3, 'PCA', 'ACREDITADO');
  assert.equal(S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS, reemplazar: true }).code, 'ACREDITADO');
  // el trabajador ve lo acreditado
  const t = S.iniciarSesion(repo, ctx, '11111111').data.token;
  assert.equal(S.miEstadoDeCuenta(repo, ctx, t).data.resumen.totalAportado, 2883.64);
});

test('aportes: archivo NOMINA APORTES (TIPO T 1) y de nuevos ingresos', () => {
  const { repo, ctx, rrhh } = conAportes();
  assert.equal(S.archivoAporte(repo, ctx, rrhh, { ...PER, tipo: 'NOMINA' }).code, 'VALIDACION');   // sin cerrar
  S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS });
  const n = S.archivoAporte(repo, ctx, rrhh, { ...PER, tipo: 'NOMINA' }).data;
  assert.equal(n.cantidad, 2);
  assert.match(n.csv, /5847;V;11111111;1;A;2883\.64;Esther Lilia Rodríguez Hernández/);
  assert.equal(S.archivoAporte(repo, ctx, rrhh, { ...PER, tipo: 'NUEVOS' }).code, 'VACIO');      // primer aporte: nadie ingresó en el trimestre
});

test('aportes: el trimestre siguiente detecta retirados y nuevos frente al anterior', () => {
  const { repo, ctx, rrhh } = conAportes();
  S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS });
  // Esther se retira; entra alguien nuevo
  S.cargarEmpleados(repo, ctx, rrhh, [
    { cedula: 'V333333339', nombre: 'Alirio Alfonso Ávila', organizacion: 'PROSEIN CENTRAL', fechaInicio: '25/07/2011' },
    { cedula: 'V444444449', nombre: 'Nuevo Octubre', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/10/2026' },
  ]);
  const pre = S.prepararAporte(repo, ctx, rrhh, { anio: 2026, trimestre: 4, empresa: 'PCA', filas: [{ nombre: 'Alirio Alfonso Avila', monto: 1000 }, { nombre: 'Nuevo Octubre', monto: 500 }] }).data;
  assert.equal(pre.primeraCarga, false);
  assert.deepEqual(pre.retirados.map((x) => x.clave), ['V11111111']);
  assert.deepEqual(pre.lineas.filter((l) => l.nuevo).map((l) => l.nombre), ['Nuevo Octubre']);
});

test('cancelaciones: retirados con aportes, registro, archivo y procesadas', () => {
  const { repo, ctx, rrhh } = conAportes();
  S.cerrarAporte(repo, ctx, rrhh, { ...PER, filas: FILAS });
  S.cargarEmpleados(repo, ctx, rrhh, [{ cedula: 'V333333339', nombre: 'Alirio Alfonso Ávila', organizacion: 'PROSEIN CENTRAL', fechaInicio: '25/07/2011' }]);  // Esther pasa a inactiva
  const cand = S.candidatosCancelacion(repo, ctx, rrhh).data;
  assert.deepEqual(cand.map((c) => [c.clave, c.totalAportado]), [['V11111111', 2883.64]]);
  assert.equal(S.registrarCancelacion(repo, ctx, rrhh, { clave: 'V33333333', fechaEgreso: '2026-10-15' }).code, 'VALIDACION');   // activo
  assert.equal(S.registrarCancelacion(repo, ctx, rrhh, { clave: 'V11111111' }).code, 'VALIDACION');                               // sin fecha
  const c = S.registrarCancelacion(repo, ctx, rrhh, { clave: 'V11111111', fechaEgreso: '2026-10-15', monto: 2883.64 }).data;
  assert.equal(c.fechaEgreso, '15/10/2026');
  assert.equal(S.candidatosCancelacion(repo, ctx, rrhh).data.length, 0);
  assert.match(S.registrarCancelacion(repo, ctx, rrhh, { clave: 'V11111111', fechaEgreso: '2026-10-15' }).message, /ya tiene/);
  const a = S.archivoCancelaciones(repo, ctx, rrhh, 'PCA').data;
  assert.match(a.csv, /V;11111111;Esther Lilia Rodríguez Hernández;05\/03\/2025;15\/10\/2026;2883\.64/);
  assert.equal(S.archivoCancelaciones(repo, ctx, rrhh, 'PCA').code, 'VACIO');
  assert.equal(S.marcarCancelaciones(repo, ctx, rrhh, [c.id], 'PROCESADA').data.cambiados, 1);
});
