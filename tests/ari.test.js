const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../core/ari.js');

// Resultados de la «Planilla de ARI» de Gestión Humana (Excel recalculado) para los mismos datos.
test('AR-I: igual al Excel con desgravamen único y cargas familiares', () => {
  const r = A.calcular({ ut: 43, remuneraciones: [3000000], cargas: 2 });
  assert.equal(r.A, 3000000); assert.equal(r.B, 69767.44); assert.equal(r.E, 774); assert.equal(r.F, 68993.44);
  assert.equal(r.G, 22582.77); assert.equal(r.H, 30); assert.equal(r.I, 22552.77); assert.equal(r.J, 32.33);
});

test('AR-I: igual al Excel con desgravámenes detallados, dos empresas y retenido de más', () => {
  const r = A.calcular({ ut: 43, remuneraciones: [1200000, 300000], desgravamenes: { educacion: 20000, hcm: 10000 }, retenidoDeMas: 5000,
    variacion: { retenido: 0, percibido: 0 } });
  assert.equal(r.A, 1500000); assert.equal(r.C, 30000); assert.equal(r.D, 697.67); assert.equal(r.E, 0); assert.equal(r.unico, false);
  assert.equal(r.F, 34186.05); assert.equal(r.G, 10748.26); assert.equal(r.H, 126.28); assert.equal(r.I, 10621.98); assert.equal(r.J, 30.45);
  assert.equal(r.K, 38.06);                                          // el Excel divide solo entre lo de esta empresa (casilla a)
});

test('AR-I: porcentaje por variación (casilla K) igual al Excel', () => {
  const r = A.calcular({ ut: 43, remuneraciones: [8000000, 0, 500000], desgravamenes: { vivienda: 150000 }, cargas: 1,
    variacion: { retenido: 600000, percibido: 1500000 } });
  assert.equal(r.I, 65128.26); assert.equal(r.J, 32.95); assert.equal(r.K, 33.85);
});

test('AR-I: por debajo del umbral no hay retención', () => {
  const r = A.calcular({ ut: 43, remuneraciones: [30000] });
  assert.equal(r.F, -76.33); assert.equal(r.I, 0); assert.equal(r.J, 0); assert.equal(r.sobreUmbral, false);
});

test('estimación de la casilla a): salario y otras asignaciones × 12, utilidades y bono vacacional', () => {
  const e = A.estimarRemuneracion({ salarioMensual: 3000, otrasPromedio: 27000, diasUtilidades: 120, aniosServicio: 4 });
  assert.deepEqual(e.partes, { salario: 36000, otras: 324000, utilidades: 120000, bonoVacacional: 18000 });   // diario 1.000; bono 15 + 3 días
  assert.equal(e.total, 498000);
  assert.equal(A.estimarRemuneracion({ salarioMensual: 3000, aniosServicio: 40 }).diasBono, 30);
});

const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

function escenario(t = Date.UTC(2026, 10, 26, 15)) {
  const repo = crearRepo([]);
  const ctx = crearCtx(t);
  repo.st.usuarios['30580323'] = { sal: 'x', hash: ctx.hash('yo', 'x'), rol: 'RRHH', nombre: 'Samuel Herrera' };
  const sesion = () => S.iniciarSesionAdmin(repo, ctx, '30580323', 'yo').data.token;
  const cargar = (filas) => S.cargarEmpleados(repo, ctx, sesion(), filas);
  return { repo, ctx, get rrhh() { return sesion(); }, cargar };
}
const ANA = { cedula: 'V123456789', nombre: 'ANA PEREZ', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/08/2020' };

test('salarios mes a mes: el Detalle guarda el salario del mes y detecta aumentos', () => {
  const e = escenario(), { repo, ctx, cargar } = e;
  const r1 = cargar([{ ...ANA, salarioMensual: 130 }]);
  assert.deepEqual(r1.data.salarios, { mes: '2026-11', guardados: 1, aumentos: [] });
  assert.equal(cargar([{ ...ANA, salarioMensual: 130 }]).data.salarios.guardados, 0);       // mismo salario: no repite
  ctx.reloj.t = Date.UTC(2026, 11, 3, 15);                                                // diciembre: aumento
  const r2 = cargar([{ ...ANA, salarioMensual: 200 }]);
  assert.deepEqual(r2.data.salarios.aumentos, [{ clave: 'V12345678', nombre: 'ANA PEREZ', antes: 130, ahora: 200 }]);
  const h = S.historialSalarios(repo, ctx, e.rrhh, 'V12345678').data;
  assert.equal(h.meses[0].mes, '2020-08'); assert.equal(h.meses[0].salario, 0.01); assert.equal(h.meses[0].fuente, 'RECONVERSION');
  assert.equal(h.meses.find((m) => m.mes === '2021-09').salario, 0.01);
  assert.equal(h.meses.find((m) => m.mes === '2021-10').salario, null);                    // desde la reconversión hay que cargarlo
  assert.deepEqual(h.meses.slice(-2).map((m) => [m.mes, m.salario]), [['2026-11', 130], ['2026-12', 200]]);
});

test('salarios por tramos (como la macro de la 14-100) y otras asignaciones del Resumen de Pago', () => {
  const { repo, ctx, rrhh, cargar } = escenario();
  cargar([{ ...ANA, salarioMensual: 130 }]);
  assert.match(S.guardarTramoSalario(repo, ctx, rrhh, 'V12345678', '2021-10', '2021-09', 5).message, /meses del tramo/);
  const h = S.guardarTramoSalario(repo, ctx, rrhh, 'V12345678', '2021-10', '2026-10', '21,60').data;
  assert.equal(h.faltan, 0);
  assert.equal(h.meses.find((m) => m.mes === '2024-05').salario, 21.6);
  cargar([{ ...ANA, salarioMensual: 999 }]);                                              // no pisa lo cargado a mano en otros meses
  assert.equal(S.historialSalarios(repo, ctx, rrhh, 'V12345678').data.meses.find((m) => m.mes === '2026-10').salario, 21.6);
  S.guardarOtrasAsignaciones(repo, ctx, rrhh, '2026-11-1', [{ clave: 'V12345678', monto: 1000 }], 'resumen 1Q.pdf');
  S.guardarOtrasAsignaciones(repo, ctx, rrhh, '2026-11-2', [{ clave: 'V12345678', monto: 1500 }], 'resumen 2Q.pdf');
  S.guardarOtrasAsignaciones(repo, ctx, rrhh, '2026-11-2', [{ clave: 'V12345678', monto: 2000 }], 'resumen 2Q bis.pdf');   // reemplaza
  assert.equal(S.historialSalarios(repo, ctx, rrhh, 'V12345678').data.meses.find((m) => m.mes === '2026-11').otras, 3000);
});
