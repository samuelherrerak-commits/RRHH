const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../core/vacaciones.js');

// Feriados 2026 del archivo de RRHH
const FER = ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-02', '2026-04-03', '2026-04-19', '2026-05-01', '2026-06-24', '2026-12-10', '2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'];

test('días hábiles como NETWORKDAYS: sin fines de semana ni feriados', () => {
  assert.equal(V.contarHabiles('2026-02-23', '2026-03-13', FER), 15);     // tres semanas completas
  assert.equal(V.contarHabiles('2026-02-09', '2026-02-20', FER), 8);      // Carnaval (16 y 17) no cuenta
  assert.equal(V.contarHabiles('2026-12-21', '2027-01-08', FER), 11);     // 24, 25, 31 y 1 no cuentan (3 + 3 + 5)
});

test('culminación y reintegro saltan fines de semana y feriados', () => {
  assert.equal(V.culminacion('2026-02-23', 15, FER), '2026-03-13');
  assert.equal(V.siguienteHabil('2026-03-13', FER), '2026-03-16');       // viernes → lunes
  assert.equal(V.culminacion('2026-02-12', 2, FER), '2026-02-13');
  assert.equal(V.siguienteHabil('2026-02-13', FER), '2026-02-18');       // salta Carnaval
  assert.equal(V.siguienteHabil('2026-12-23', FER), '2026-12-28');       // salta 24 y 25
});

test('días por años de servicio: 15 + (años − 1), tope 30', () => {
  assert.deepEqual([0, 1, 2, 10, 16, 17, 40].map((a) => V.diasPorAnios(a)), [0, 15, 16, 24, 30, 30, 30]);
});

const cierre = [
  { periodo: '2023-2024', correspondientes: 16, disfrutadosPrevios: 16 },
  { periodo: '2024-2025', correspondientes: 17, disfrutadosPrevios: 10 },
  { periodo: '2025-2026', correspondientes: 18, disfrutadosPrevios: 0 },
];

test('períodos: los del cierre y luego uno por aniversario cumplido (regla de la ley)', () => {
  const p = V.periodosDeEmpleado('2022-03-10', cierre, '2027-03-10');
  assert.deepEqual(p.map((x) => [x.periodo, x.correspondientes, x.origen]),
    [['2023-2024', 16, 'CIERRE'], ['2024-2025', 17, 'CIERRE'], ['2025-2026', 18, 'CIERRE'], ['2026-2027', 19, 'REGLA']]);
  assert.equal(V.periodosDeEmpleado('2022-03-10', cierre, '2027-03-09').length, 3);   // un día antes del aniversario
});

test('ingreso nuevo sin cierre: arranca con 15 al cumplir el primer año', () => {
  assert.deepEqual(V.periodosDeEmpleado('2025-10-15', [], '2026-10-29').map((x) => [x.periodo, x.correspondientes]), [['2025-2026', 15]]);
  assert.equal(V.periodosDeEmpleado('2026-01-05', [], '2026-10-29').length, 0);
});

test('saldo y «con pago»: la primera vez que se toma de un período se paga completo; lo que sobra es solo disfrute', () => {
  const per = V.periodosDeEmpleado('2022-03-10', cierre, '2026-10-29');
  let s = V.saldo(per, []);
  assert.equal(s.total, 7 + 18);
  assert.deepEqual(s.porPeriodo.map((p) => [p.periodo, p.pendientes, p.pagado]), [['2023-2024', 0, true], ['2024-2025', 7, true], ['2025-2026', 18, false]]);

  // 10 días: 7 del período 24-25 (ya pagado) + 3 del 25-26 (primera vez → se paga el período completo)
  const imp = V.imputar(s, 10);
  assert.deepEqual(imp, [
    { periodo: '2024-2025', dias: 7, pagaPeriodo: false, diasDelPeriodo: 17 },
    { periodo: '2025-2026', dias: 3, pagaPeriodo: true, diasDelPeriodo: 18 },
  ]);
  assert.equal(V.condicion(imp), V.CON_PAGO);

  // después de esa solicitud, otra de 5 días es solo disfrute (el 25-26 ya se pagó)
  s = V.saldo(per, [{ estado: 'PENDIENTE_JEFE', imputacion: imp }]);
  assert.equal(s.total, 15);
  assert.equal(V.condicion(V.imputar(s, 5)), V.SIN_PAGO);
  // una rechazada o cancelada no consume ni marca el período como pagado
  assert.equal(V.saldo(per, [{ estado: 'RECHAZADA', imputacion: imp }]).total, 25);
  assert.equal(V.imputar(s, 16), null);   // no alcanza
});

test('validación: anticipación de 15 a 20 días, día hábil, sin adelantar, sin cruces y con jefe', () => {
  const per = V.periodosDeEmpleado('2022-03-10', cierre, '2026-10-29');
  const c = { hoy: '2026-10-29', feriados: FER, saldo: V.saldo(per, []), solicitudes: [], tieneJefe: true };
  const okSol = V.validarSolicitud({ inicio: '2026-11-13', dias: 10 }, c);      // 15 días después, viernes
  assert.equal(okSol.ok, true, okSol.errores.join());
  assert.equal(okSol.calculo.culminacion, '2026-11-26');
  assert.equal(okSol.calculo.reintegro, '2026-11-27');
  assert.equal(okSol.calculo.condicion, V.CON_PAGO);

  assert.match(V.validarSolicitud({ inicio: '2026-11-12', dias: 5 }, c).errores[0], /entre el 13\/11\/2026 y el 18\/11\/2026/);   // 14 días: muy pronto
  assert.match(V.validarSolicitud({ inicio: '2026-11-19', dias: 5 }, c).errores[0], /entre/);                                  // 21 días: muy lejos
  assert.match(V.validarSolicitud({ inicio: '2026-11-14', dias: 5 }, c).errores[0], /día hábil/);                               // sábado
  assert.match(V.validarSolicitud({ inicio: '2026-11-13', dias: 26 }, c).errores[0], /adelantar/);
  assert.match(V.validarSolicitud({ inicio: '2026-11-13', dias: 2.5 }, c).errores[0], /cuántos días/);
  assert.match(V.validarSolicitud({ inicio: '2026-11-13', dias: 5 }, { ...c, tieneJefe: false }).errores[0], /jefe directo/);
  const otra = { estado: 'PENDIENTE_JEFE', inicio: '2026-11-16', culminacion: '2026-11-20', imputacion: [] };
  assert.match(V.validarSolicitud({ inicio: '2026-11-13', dias: 5 }, { ...c, solicitudes: [otra] }).errores[0], /Se cruza/);
  assert.equal(V.validarSolicitud({ inicio: '2026-11-13', dias: 5 }, { ...c, solicitudes: [{ ...otra, estado: 'CANCELADA' }] }).ok, true);
});

test('importar el cierre: toma CORRESPONDIENTE y DISFRUTADOS por período (aunque el título esté vacío)', () => {
  const filas = [
    ['EMPRESA', 'CEDULA', 'NOMBRE', 'CORRESPONDIENTE 23-24', 'DISFRUTADOS 23-24', 'PENDIENTES 23-24 ', 'CORRESPONDIENTE 24-25', 'DISFRUTADOS 24-25', 'PENDIENTES 24-25', '   ', 'DISFRUTADOS 25-26', 'PENDIENTES 25-26'],
    ['Prosein C.A.', 'V22102947', 'X', 16, 16, 0, 17, 10, 7, 18, '', 18],
    ['Austral', 'V10957256', 'Y', '', '', 0, 15, 0, 15, 16, 4, 12],
    ['', '', 'TOTALES', 99, 99, 0, 99, 99, 0, 99, 99, 99],
  ];
  const r = V.mapearCierre(filas);
  assert.deepEqual(r.periodos, ['2023-2024', '2024-2025', '2025-2026']);
  assert.equal(r.personas.length, 2);
  assert.deepEqual(r.personas[0].periodos, [
    { periodo: '2023-2024', correspondientes: 16, disfrutadosPrevios: 16 },
    { periodo: '2024-2025', correspondientes: 17, disfrutadosPrevios: 10 },
    { periodo: '2025-2026', correspondientes: 18, disfrutadosPrevios: 0 },
  ]);
  assert.deepEqual(r.personas[1].periodos.map((p) => p.periodo), ['2024-2025', '2025-2026']);   // sin datos en 23-24
});

test('pago: pagado hasta el último período con días disfrutados, aunque uno anterior figure con 0', () => {
  const per = V.periodosDeEmpleado('2020-05-04', [
    { periodo: '2023-2024', correspondientes: 18, disfrutadosPrevios: 0 },    // 0 disfrutados, pero ya pagado
    { periodo: '2024-2025', correspondientes: 19, disfrutadosPrevios: 5 },    // el último con disfrute
    { periodo: '2025-2026', correspondientes: 20, disfrutadosPrevios: 0 },    // aún no pagado
  ], '2026-10-29');
  const s = V.saldo(per, []);
  assert.deepEqual(s.porPeriodo.map((p) => [p.periodo, p.pagado]), [['2023-2024', true], ['2024-2025', true], ['2025-2026', false]]);
  assert.equal(V.condicion(V.imputar(s, 18)), V.SIN_PAGO);              // los 18 del 23-24: sin pago
  assert.equal(V.condicion(V.imputar(s, 32)), V.SIN_PAGO);              // 18 + 14 del 24-25: sin pago
  assert.equal(V.condicion(V.imputar(s, 33)), V.CON_PAGO);              // el día 33 entra al 25-26 → se paga ese período
});

test('número de constancia igual al del Excel (caso real del modelo)', () => {
  assert.equal(V.serialExcel('2026-09-07'), 46272);
  assert.equal(V.numeroConstancia({ inicio: '2026-09-07', culminacion: '2026-09-18', reintegro: '2026-09-21' }, 'V', '7924627'), '46272V079246274628346286');
});

test('pendientes tras el disfrute: cuenta esta solicitud y las anteriores, no las posteriores', () => {
  const per = V.periodosDeEmpleado('2022-03-10', [{ periodo: '2024-2025', correspondientes: 17, disfrutadosPrevios: 10 }, { periodo: '2025-2026', correspondientes: 18, disfrutadosPrevios: 0 }], '2026-10-29');
  const a = { id: 'A', estado: 'REGISTRADA', creada: 1, imputacion: [{ periodo: '2024-2025', dias: 7 }, { periodo: '2025-2026', dias: 3 }] };
  const b = { id: 'B', estado: 'PENDIENTE_JEFE', creada: 2, imputacion: [{ periodo: '2025-2026', dias: 5 }] };
  assert.deepEqual(V.pendientesTras(per, [a, b], a), { porPeriodo: [{ periodo: '2024-2025', pendientes: 0 }, { periodo: '2025-2026', pendientes: 15 }], total: 15 });
  assert.equal(V.pendientesTras(per, [a, b], b).total, 10);
});
