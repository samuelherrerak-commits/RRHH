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
