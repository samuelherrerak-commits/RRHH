const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

function escenario() {
  const repo = crearRepo([
    { cedula: 'V079246270', nombre: 'Zoraya Pérez', organizacion: 'PROSEIN CENTRAL', fechaInicio: '08/10/2009' },
    { cedula: 'V123456789', nombre: 'Ana Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
    { cedula: 'V400000009', nombre: 'Ya Egresado', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/02/2024', estado: 'Inactive' },
  ]);
  const ctx = crearCtx();
  repo.st.usuarios['7952013'] = { sal: 'x', hash: ctx.hash('jefe', 'x'), rol: 'ADMIN', nombre: 'Luis Paul Rojas' };
  repo.st.usuarios['30580323'] = { sal: 'x', hash: ctx.hash('yo', 'x'), rol: 'ADMIN', nombre: 'Samuel Herrera' };
  return { repo, ctx, jefe: S.iniciarSesionAdmin(repo, ctx, '7952013', 'jefe').data.token, yo: S.iniciarSesionAdmin(repo, ctx, '30580323', 'yo').data.token };
}

test('el jefe solicita una nómina especial de varias personas y a Gestión Humana le llega el aviso', () => {
  const { repo, ctx, jefe, yo } = escenario();
  assert.match(S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: '', items: [] }).message, /concepto/);
  assert.match(S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono', items: [] }).message, /al menos una persona/);
  assert.match(S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono', items: [{ clave: 'V7924627', monto: 0 }] }).message, /Falta el monto/);
  assert.match(S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono', items: [{ clave: 'V40000000', monto: 10 }] }).message, /ya no está activo/);
  const r = S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono por cierre de inventario', moneda: 'Bs.', fechaPago: '2026-11-15',
    items: [{ clave: 'V7924627', monto: '1500.5' }, { clave: 'V12345678', monto: 2000 }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.total, 3500.5); assert.equal(r.data.personas, 2);
  assert.deepEqual(r.data.items.map((x) => [x.cedula, x.nombre, x.empresa, x.monto]), [['7924627', 'Zoraya Pérez', 'PCA', 1500.5], ['12345678', 'Ana Austral', 'AIV', 2000]]);
  assert.equal(r.data.solicitadaPorNombre, 'Luis Paul Rojas');
  const aviso = repo.st.notificaciones.find((n) => n.tipo === 'NOMINA_ESPECIAL');
  assert.equal(aviso.clave, 'V30580323');                        // a Gestión Humana, no a quien la pidió
  assert.equal(S.misNotificaciones(repo, ctx, yo).data.items[0].ruta, 'nominas');
  assert.equal(S.listarNominasEspeciales(repo, ctx, yo).data.solicitudes[0].estado, 'SOLICITADA');
});

test('Gestión Humana la registra (o la rechaza con motivo) y el jefe recibe el aviso; solo quien la pidió puede cancelarla', () => {
  const { repo, ctx, jefe, yo } = escenario();
  const a = S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono A', items: [{ clave: 'V7924627', monto: 100 }] }).data;
  const b = S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono B', items: [{ clave: 'V7924627', monto: 100 }] }).data;
  const c = S.solicitarNominaEspecial(repo, ctx, jefe, { concepto: 'Bono C', items: [{ clave: 'V7924627', monto: 100 }] }).data;
  const reg = S.registrarNominaEspecial(repo, ctx, yo, a.id, 'NE-015');
  assert.equal(reg.data.estado, 'REGISTRADA'); assert.equal(reg.data.referencia, 'NE-015'); assert.equal(reg.data.atendidaPorNombre, 'Samuel Herrera');
  assert.equal(S.registrarNominaEspecial(repo, ctx, yo, a.id).code, 'TRANSICION');
  assert.match(S.misNotificaciones(repo, ctx, jefe).data.items.map((n) => n.titulo).join(), /registrada/);
  assert.equal(S.rechazarNominaEspecial(repo, ctx, yo, b.id, '').code, 'VALIDACION');
  assert.equal(S.rechazarNominaEspecial(repo, ctx, yo, b.id, 'Montos por confirmar').data.estado, 'RECHAZADA');
  assert.equal(S.cancelarNominaEspecial(repo, ctx, yo, c.id).code, 'PERMISO');
  assert.equal(S.cancelarNominaEspecial(repo, ctx, jefe, c.id).data.estado, 'CANCELADA');
  const t = S.iniciarSesion(repo, ctx, '12345678').data;
  assert.equal(S.listarNominasEspeciales(repo, ctx, t.token || 'x').code, 'SESION');
});
