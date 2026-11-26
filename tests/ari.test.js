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

test('AR-I del año: RRHH la abre, el colaborador la entrega con su porcentaje y una subida de salario pide la variación', () => {
  const e = escenario(Date.UTC(2027, 0, 5, 15)), { repo, ctx, cargar } = e;
  cargar([{ ...ANA, salarioMensual: 3000 }, { cedula: 'V234567891', nombre: 'BETO GOMEZ', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2024', salarioMensual: 2000 }]);
  S.guardarOtrasAsignaciones(repo, ctx, e.rrhh, '2026-12-2', [{ clave: 'V12345678', monto: 27000 }], 'resumen.pdf');
  assert.match(S.abrirAri(repo, ctx, e.rrhh, { anio: 2027, ut: 43, hasta: '2026-12-01' }).message, /fecha límite/);
  const ab = S.abrirAri(repo, ctx, e.rrhh, { anio: 2027, ut: '43', hasta: '2027-01-31' });
  assert.equal(ab.ok, true, JSON.stringify(ab)); assert.equal(ab.data.personas, 2);
  assert.equal(repo.st.notificaciones.filter((n) => n.tipo === 'ARI').length, 2);
  assert.equal(S.abrirAri(repo, ctx, e.rrhh, { anio: 2027, ut: 43, hasta: '2027-01-31' }).code, 'DUPLICADO');
  const ana = S.iniciarSesion(repo, ctx, '12345678').data.token;
  const m = S.miAri(repo, ctx, ana).data.pendiente;
  assert.equal(m.tipo, 'INICIAL'); assert.equal(m.salarioMensual, 3000); assert.equal(m.otrasPromedio, 27000);
  assert.equal(m.aniosServicio, 6); assert.equal(m.estimacion.diasBono, 20);
  assert.equal(m.estimacion.total, 36000 + 324000 + 120000 + 20000);           // diario 1.000 × (120 utilidades + 20 bono)
  assert.match(S.enviarAri(repo, ctx, ana, m.id, { remuneraciones: [0], unico: true, cargas: 0 }).message, /cuánto estimas/);
  assert.match(S.enviarAri(repo, ctx, ana, m.id, { remuneraciones: [500000], unico: false, cargas: 0 }).message, /al menos un desgravamen/);
  const env = S.enviarAri(repo, ctx, ana, m.id, { remuneraciones: ['3.000.000,00'], unico: true, cargas: 2 });
  assert.equal(env.ok, true, JSON.stringify(env)); assert.equal(env.data.resultado.J, 32.33);   // igual al Excel
  assert.equal(S.miAri(repo, ctx, ana).data.pendiente, null);
  const panel = S.panelAri(repo, ctx, e.rrhh, 'ARI-2027').data;
  assert.deepEqual(panel.filas.map((f) => [f.nombre, f.porcentaje, !!f.pendiente]), [['ANA PEREZ', 32.33, false], ['BETO GOMEZ', null, true]]);
  assert.equal(S.recordarAri(repo, ctx, e.rrhh, 'ARI-2027').data.avisados, 1);
  // sube el salario de Ana en febrero: se le pide la variación (a Beto no, no la ha entregado)
  ctx.reloj.t = Date.UTC(2027, 1, 3, 15);
  cargar([{ ...ANA, salarioMensual: 4000 }, { cedula: 'V234567891', nombre: 'BETO GOMEZ', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2024', salarioMensual: 2500 }]);
  const v = S.miAri(repo, ctx, S.iniciarSesion(repo, ctx, '12345678').data.token).data.pendiente;
  assert.equal(v.tipo, 'VARIACION'); assert.match(v.motivo, /de Bs\. 3000 a Bs\. 4000/);
  assert.equal(v.percibido, 3000);                                               // enero 2027 ya cobrado
  const ana2 = S.iniciarSesion(repo, ctx, '12345678').data.token;
  const ev = S.enviarAri(repo, ctx, ana2, v.id, { remuneraciones: [3500000], unico: true, cargas: 2, retenido: 80000, percibido: 300000 });
  assert.equal(ev.ok, true, JSON.stringify(ev)); assert.ok(ev.data.resultado.K > 0);
  assert.equal(S.panelAri(repo, ctx, e.rrhh, 'ARI-2027').data.filas[0].porcentaje, ev.data.resultado.K);   // vale la variación
  assert.equal(S.pedirVariacionAri(repo, ctx, e.rrhh, 'ARI-2027', 3).data.pedidas, 1);                   // marzo: solo Ana
  assert.equal(S.pedirVariacionAri(repo, ctx, e.rrhh, 'ARI-2027', 4).code, 'VALIDACION');
});
