const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../core/omega.js');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

test('cestaticket: $40 completo, proporcional al ingresar en el mes y nada si ingresa después', () => {
  assert.equal(O.diasCestaticket({ y: 2025, m: 3, d: 10 }, '2026-11'), 30);
  assert.equal(O.diasCestaticket({ y: 2026, m: 11, d: 1 }, '2026-11'), 30);
  assert.equal(O.diasCestaticket({ y: 2026, m: 11, d: 16 }, '2026-11'), 15);
  assert.equal(O.diasCestaticket({ y: 2026, m: 10, d: 31 }, '2026-10'), 1);
  assert.equal(O.diasCestaticket({ y: 2026, m: 12, d: 1 }, '2026-11'), 0);
  assert.equal(O.montosDelMes({ y: 2026, m: 11, d: 16 }, '2026-11', null).cestaticket, 20);
  assert.equal(O.montosDelMes({ y: 2020, m: 1, d: 1 }, '2026-11', null, { dias: 10 }).cestaticket, 13.33);   // egreso ajustado a mano
});

test('regla de las quincenas: 50 % a la tasa de la 1Q y en la 2Q el 100 % a su tasa menos lo anticipado (como el Excel de Gestión Humana)', () => {
  const m = O.montosDelMes({ y: 2020, m: 1, d: 1 }, '2026-11', { complemento: 220, vehiculo: 0, bono: 0, comisiones: 0 });
  assert.equal(m.totalUSD, 260);                                    // 40 cestaticket + 220 complemento
  const q1 = O.primeraQuincena(m.totalUSD, 905);
  assert.equal(q1, 117650);                                         // 130 × 905
  assert.equal(O.segundaQuincena(m.totalUSD, 920, q1), 121550);     // 260 × 920 − 117.650
  assert.equal(O.primeraQuincena(260, 905, true), 0);               // ingresó después del 15: sin anticipo
  // Excel de octubre: complemento 40 con tasas 880 / 895 → 17.600 y 18.200
  assert.equal(O.primeraQuincena(40, 880), 17600);
  assert.equal(O.segundaQuincena(40, 895, 17600), 18200);
});

test('totales para Omega: comisión 1,3 %, IVA 16 % de la comisión y retención del 75 % del IVA', () => {
  const t = O.totalesOmega(1000000);
  assert.deepEqual(t, { subtotal: 1000000, comision: 13000, iva: 2080, retencion: 1560, totalPagar: 1013520 });
});

test('lee el Excel de beneficios de Gestión Humana (encabezados en la fila 1, montos y vacíos)', () => {
  const m = [
    [null, 'Cargo', 'Nivel del Cargo', 'Cédula', 'Nombre Socio del Negocio', 'Fecha de Ingreso', 'Monto de complemento de alimentación aprobado', 'Ayuda de vehiculo', 'Bono Especial', 'Comisiones Garantizadas', 'Monto a pagar 1Q (50% monto aprobado) a tasa estimada a fecha de pago'],
    [null, null, null, null, null, 'Tasa estimada 1q', null, null, null, null, 905],
    ['PCA', 'Chofer', '1.0', 7924627, 'ZORAYA PEREZ', null, 200, 0, null, null, 90500],
    ['AIV', 'Gerente', '3.0', '12.345.678', 'ANA', null, 300, 150, 600, 300, 0],
    [null, null, null, null, 'Totales', null, null, null, null, null, 123],
  ];
  const r = O.leerExcelBeneficios(m);
  assert.deepEqual(r.faltan, []);
  assert.deepEqual(r.filas, [
    { cedula: '7924627', nombre: 'ZORAYA PEREZ', complemento: 200, vehiculo: 0, bono: 0, comisiones: 0 },
    { cedula: '12345678', nombre: 'ANA', complemento: 300, vehiculo: 150, bono: 600, comisiones: 300 },
  ]);
  assert.ok(O.leerExcelBeneficios([['a', 'b']]).error);
});

function escenario() {
  const repo = crearRepo([
    { cedula: 'V079246270', nombre: 'Zoraya Pérez', organizacion: 'PROSEIN CENTRAL', fechaInicio: '08/10/2009' },
    { cedula: 'V123456789', nombre: 'Ana Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
    { cedula: 'V200000006', nombre: 'Nuevo Ingreso', organizacion: 'PROSEIN CENTRAL', fechaInicio: '20/11/2026' },
  ]);
  const ctx = crearCtx();
  repo.st.usuarios['11111111'] = { sal: 'x', hash: ctx.hash('clave', 'x'), rol: 'RRHH' };
  return { repo, ctx, t: S.iniciarSesionAdmin(repo, ctx, '11111111', 'clave').data.token };
}

test('Omega Capital de punta a punta: cargar beneficios, tasas, cerrar la 1Q y la 2Q', () => {
  const { repo, ctx, t } = escenario();
  const imp = S.omegaImportarBeneficios(repo, ctx, t, [{ cedula: '7924627', nombre: 'ZORAYA PEREZ', complemento: 200 }, { cedula: '12345678', complemento: 300, vehiculo: 150 }, { cedula: '99999999', nombre: 'NADIE', complemento: 50 }]);
  assert.equal(imp.data.cargados, 2);
  assert.deepEqual(imp.data.noEncontrados, [{ cedula: '99999999', nombre: 'NADIE' }]);

  let r = S.omegaGuardarPeriodo(repo, ctx, t, { mes: '2026-11', tasa1: 905, tasa2: 920 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const linea = (n) => r.data.lineas.find((l) => l.nombre.toUpperCase().startsWith(n));
  assert.equal(linea('ZORAYA').totalUSD, 240);                       // 40 + 200
  assert.equal(linea('ZORAYA').q1, 108600);                          // 120 × 905
  assert.equal(linea('ZORAYA').q2, 240 * 920 - 108600);
  assert.equal(linea('ANA').empresa, 'AIV');
  assert.equal(linea('ANA').totalUSD, 490);
  assert.equal(linea('NUEVO').cestaticket, 14.67);                   // 11 de 30 días
  assert.equal(linea('NUEVO').q1, 0);                                // ingresó el 20: sin anticipo
  assert.equal(r.data.totales.q1.PCA.personas, 2);
  assert.equal(r.data.totales.q1.TODAS.subtotal, 108600 + 245 * 905);

  assert.equal(S.omegaCerrarQuincena(repo, ctx, t, '2026-11', 2).code, 'VALIDACION');   // primero la 1Q
  r = S.omegaCerrarQuincena(repo, ctx, t, '2026-11', 1);
  assert.equal(r.data.estado1, 'CERRADA');
  assert.equal(S.omegaGuardarPeriodo(repo, ctx, t, { mes: '2026-11', tasa1: 999 }).code, 'CERRADA');
  // la tasa de la 2Q cambia después de cerrar la 1Q: se descuenta lo que se pagó de verdad en la 1Q
  r = S.omegaGuardarPeriodo(repo, ctx, t, { mes: '2026-11', tasa2: 950 });
  assert.equal(linea('ZORAYA').q1, 108600);
  assert.equal(linea('ZORAYA').q2, 240 * 950 - 108600);
  r = S.omegaCerrarQuincena(repo, ctx, t, '2026-11', 2);
  assert.equal(r.data.estado2, 'CERRADA');
  assert.equal(repo.omegaPagos('2026-11', 2).length, 3);
  // con el mes cerrado, un cambio de beneficio ya no altera lo pagado
  S.omegaEditarBeneficio(repo, ctx, t, 'V7924627', { complemento: 999 });
  assert.equal(S.omegaMes(repo, ctx, t, '2026-11').data.lineas.find((l) => l.nombre.toUpperCase().startsWith('ZORAYA')).q2, 240 * 950 - 108600);
  assert.equal(S.omegaReabrirQuincena(repo, ctx, t, '2026-11', 1).code, 'VALIDACION');   // primero la 2Q
  assert.equal(S.omegaReabrirQuincena(repo, ctx, t, '2026-11', 2).data.estado2, 'ABIERTA');
  assert.equal(repo.omegaPagos('2026-11', 2).length, 0);
});

test('Omega Capital: días de cestaticket ajustados a mano y solo para Gestión Humana', () => {
  const { repo, ctx, t } = escenario();
  const r = S.omegaGuardarPeriodo(repo, ctx, t, { mes: '2026-11', tasa1: 900, tasa2: 900, ajustes: { V12345678: 15 } });
  const ana = r.data.lineas.find((l) => l.nombre.toUpperCase().startsWith('ANA'));
  assert.equal(ana.dias, 15); assert.equal(ana.cestaticket, 20); assert.equal(ana.ajustado, true);
  const sin = S.omegaGuardarPeriodo(repo, ctx, t, { mes: '2026-11', ajustes: { V12345678: '' } }).data.lineas.find((l) => l.nombre.toUpperCase().startsWith('ANA'));
  assert.equal(sin.dias, 30);
  const trabajador = S.iniciarSesion(repo, ctx, '12345678').data;
  assert.equal(S.omegaMes(repo, ctx, trabajador.token || 'x', '2026-11').code, 'SESION');
});
