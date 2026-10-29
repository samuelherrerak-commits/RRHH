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

test('constancia: tope de 5 al mes por trabajador', () => {
  const { repo, ctx } = conSueldo();
  const t = S.iniciarSesion(repo, ctx, '30580323').data.token;
  for (let i = 0; i < 5; i++) assert.equal(S.emitirConstancia(repo, ctx, t).ok, true);
  assert.equal(S.emitirConstancia(repo, ctx, t).code, 'LIMITE');
  ctx.reloj.t += 31 * 86400000; // pasado un mes vuelve a poder (con otra sesión)
  const t2 = S.iniciarSesion(repo, ctx, '30580323').data.token;
  assert.equal(S.emitirConstancia(repo, ctx, t2).ok, true);
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
