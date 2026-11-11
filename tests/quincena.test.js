const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../core/empleados.js');
const C = require('../core/comisiones.js');
const O = require('../core/omega.js');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

test('detalle agrupado: hereda organización y departamento, e ignora las filas de conteo con números', () => {
  const crudas = [
    { 'Organización': 'PROSEIN CENTRAL', Departamento: 'Ventas', 'Puesto Nómina': 'Asesor Comercial', 'Cédula': 'V079246270', 'Nombre Socio del Negocio': 'ZORAYA PEREZ', Estado: 'Active' },
    { 'Organización': null, Departamento: null, 'Puesto Nómina': 'Asesor Comercial', 'Cédula': 'V123456789', 'Nombre Socio del Negocio': 'ANA PRUEBA', Estado: 'Active' },
    { 'Organización': null, Departamento: null, 'Puesto Nómina': 'Asesor Comercial №', 'Cédula': null, 'Nombre Socio del Negocio': 2, Estado: 2 },
    { 'Organización': 'Conteo', Departamento: null, 'Puesto Nómina': null, 'Cédula': null, 'Nombre Socio del Negocio': 166, Estado: 166 },
  ];
  const m = E.mapearDetalle(crudas);
  assert.equal(m.filas.length, 2); assert.equal(m.omitidas, 2);
  assert.equal(m.filas[1].organizacion, 'PROSEIN CENTRAL'); assert.equal(m.filas[1].departamento, 'Ventas');
});

test('reporte de nómina contra los activos: faltantes, egresados, nombres que no están y otra empresa', () => {
  const emp = [
    { clave: 'V1', nombre: 'ZORAYA PEREZ', estado: 'Activo', empresa: 'PCA' },
    { clave: 'V2', nombre: 'FAVIOLA TERESITA ROSALES MUJICA', estado: 'Activo', empresa: 'PCA' },
    { clave: 'V3', nombre: 'NUEVA INGRESO', estado: 'Activo', empresa: 'PCA', sinTarjeta: true },
    { clave: 'V4', nombre: 'YA EGRESADO', estado: 'Inactivo', empresa: 'PCA' },
    { clave: 'V5', nombre: 'AARON KOENIG ROJAS', estado: 'Activo', empresa: 'AIV' },
    { clave: 'V6', nombre: 'OTRA AUSTRAL', estado: 'Activo', empresa: 'AIV' },
    { clave: 'V7', nombre: 'CARLOS LUIS CAMACARO', estado: 'Activo', empresa: 'PCA' },
    { clave: 'V8', nombre: 'PEDRO PCA', estado: 'Activo', empresa: 'PCA' },
  ];
  const per = ['ZORAYA PEREZ', 'FAVIOLA TERESITA ROSALES MOLLEJAS', 'YA EGRESADO', 'AARON KOENIG', 'CARLOS LUIS CAMACARO DEL VILLAR', 'PEDRO PCA'].map((nombre) => ({ nombre, asignaciones: 18200, otrasAsignaciones: 0 }));
  const r = C.revisarReporte(per, emp, { excluirFaltantes: (e) => (e.sinTarjeta ? 'sin tarjeta' : '') });
  assert.deepEqual(r.empresas, ['PCA']);
  assert.deepEqual(r.ok.map((x) => x.clave).sort(), ['V1', 'V5', 'V7', 'V8']);
  assert.deepEqual(r.egresados.map((x) => x.clave), ['V4']);
  assert.deepEqual(r.noEnCac.map((x) => [x.nombre, x.posible && x.posible.clave]), [['FAVIOLA TERESITA ROSALES MOLLEJAS', 'V2']]);
  assert.deepEqual(r.faltan.map((x) => x.clave), ['V2']);
  assert.deepEqual(r.esperados.map((x) => x.clave), ['V3']);
  assert.deepEqual(r.otraEmpresa.map((x) => x.clave), ['V5']);
  const r2 = C.revisarReporte(per, emp, { alias: { 'FAVIOLA TERESITA ROSALES MOLLEJAS': 'V2' } });
  assert.equal(r2.faltan.length, 1);   // solo el que no tiene tarjeta
});

test('vacaciones con pago: se pagan en la última quincena antes de salir', () => {
  assert.equal(O.quincenaDePagoVacaciones('2026-11-20'), '2026-11-1');
  assert.equal(O.quincenaDePagoVacaciones('2026-11-15'), '2026-11-1');
  assert.equal(O.quincenaDePagoVacaciones('2026-11-03'), '2026-10-2');
  assert.equal(O.quincenaDePagoVacaciones('2027-01-05'), '2026-12-2');
});

function escenario() {
  const repo = crearRepo([
    { cedula: 'V079246270', nombre: 'Zoraya Pérez', organizacion: 'PROSEIN CENTRAL', fechaInicio: '08/10/2009' },
    { cedula: 'V123456789', nombre: 'Ana Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
  ]);
  const ctx = crearCtx();
  repo.st.usuarios['11111111'] = { sal: 'x', hash: ctx.hash('clave', 'x'), rol: 'RRHH' };
  return { repo, ctx, t: S.iniciarSesionAdmin(repo, ctx, '11111111', 'clave').data.token };
}

test('Quincena: abrir, previa del detalle (ingresos y egresos), pasos y montos adicionales en Transferencia', () => {
  const { repo, ctx, t } = escenario();
  const q = S.quincenaAbrir(repo, ctx, t, '2026-11', 1, 910);
  assert.equal(q.ok, true, JSON.stringify(q)); assert.equal(q.data.id, '2026-11-1'); assert.deepEqual(q.data.orden, ['detalle', 'vacaciones', 'comisiones', 'cestaticket', 'complemento']);
  const p = S.previaDetalle(repo, ctx, t, [{ cedula: 'V079246270', nombre: 'ZORAYA PEREZ', organizacion: 'PROSEIN CENTRAL', fechaInicio: '08/10/2009' },
    { cedula: 'V300000002', nombre: 'NUEVO INGRESO', organizacion: 'PROSEIN CENTRAL', fechaInicio: '05/11/2026' }, { cedula: '', nombre: '3' }]);
  assert.deepEqual(p.data.ingresos.map((x) => x.nombre), ['NUEVO INGRESO']);
  assert.deepEqual(p.data.egresos.map((x) => x.nombre), ['Ana Austral']);
  assert.equal(p.data.sinCedula, 1);
  assert.equal(repo.todosEmpleados().length, 2);   // no guardó nada
  const v = S.quincenaPaso(repo, ctx, t, '2026-11-1', 'detalle', { hecho: true, resumen: { ingresos: 1, egresos: 1 } });
  assert.equal(v.data.pasos.detalle.hecho, true); assert.equal(v.data.pasos.detalle.ingresos, 1);
  assert.equal(S.quincenaListar(repo, ctx, t).data[0].hechos, 1);
  // Transferencia: monto adicional a una persona del lote y a una agregada a mano
  S.omegaImportarBeneficios(repo, ctx, t, [{ cedula: '7924627', complemento: 200 }]);
  let l = S.omegaAjustarLinea(repo, ctx, t, '2026-11-1', 'TR-PCA', 'V7924627', { adicional: '5.000,00', nota: 'Bono' });
  const z = l.data.lineas.find((x) => x.clave === 'V7924627');
  assert.equal(z.montoBs, 91000 + 5000); assert.equal(z.adicional, 5000);
  l = S.omegaAjustarLinea(repo, ctx, t, '2026-11-1', 'TR-AIV', 'V12345678', { adicional: 1500, agregar: true, nota: 'Reintegro' });
  assert.equal(l.data.lineas.find((x) => x.clave === 'V12345678').montoBs, 1500);
  S.omegaValidarLote(repo, ctx, t, '2026-11-1', 'TR-PCA');
  S.omegaAbrirQuincena(repo, ctx, t, '2026-11', 2, 920);
  const z2 = S.omegaLote(repo, ctx, t, '2026-11-2', 'TR-PCA').data.lineas.find((x) => x.clave === 'V7924627');
  assert.equal(z2.montoBs, 200 * 920 - 91000);   // la 2Q descuenta solo el anticipo, no el adicional
});

test('Quincena: vacaciones con pago que caen en esta quincena', () => {
  const { repo, ctx, t } = escenario();
  repo.st.vacSolicitudes.VAC1 = { id: 'VAC1', clave: 'V7924627', inicio: '2026-11-20', culminacion: '2026-12-03', reintegro: '2026-12-04', dias: 10, estado: 'APROBADA_JEFE',
    imputacion: [{ periodo: '2025-2026', diasDelPeriodo: 15, pagaPeriodo: true }] };
  repo.st.vacSolicitudes.VAC2 = { id: 'VAC2', clave: 'V12345678', inicio: '2026-11-20', dias: 5, estado: 'APROBADA_JEFE', imputacion: [{ periodo: '2024-2025', pagaPeriodo: false }] };
  repo.st.vacSolicitudes.VAC3 = { id: 'VAC3', clave: 'V12345678', inicio: '2026-12-02', dias: 5, estado: 'REGISTRADA', imputacion: [{ periodo: '2025-2026', diasDelPeriodo: 16, pagaPeriodo: true }] };
  const r = S.vacacionesQuincena(repo, ctx, t, '2026-11-1');
  assert.deepEqual(r.data.map((x) => [x.id, x.nombre, x.periodos[0].dias]), [['VAC1', 'Zoraya Pérez', 15]]);
  assert.deepEqual(S.vacacionesQuincena(repo, ctx, t, '2026-11-2').data.map((x) => x.id), ['VAC3']);
});
