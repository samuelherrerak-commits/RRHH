const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core/calculo.js');

const P = { anioBase: 2025, diasMinimosMes: 1 };
const t3 = (e) => C.calcularAporte({ anio: 2026, trimestre: 3, ...e }, P);

test('Esther Lilia Rodríguez Hernández → 2883.64', () => {
  const r = t3({ ingreso: '05/03/2025', monto: 12583.168 });
  assert.equal(r.meses, 3);
  assert.equal(r.diasVacaciones, 15);
  assert.equal(r.diasAntiguedad, 15);
  assert.equal(r.diasAdicionales, 0);
  assert.equal(r.total, 2883.64);
});

test('Alirio Alfonso Ávila → 129896.70 (29 vacaciones, 28 adicionales)', () => {
  const r = t3({ ingreso: '25/07/2011', monto: 192290.08 });
  assert.equal(r.diasVacaciones, 29);
  assert.equal(r.diasAdicionales, 28);
  assert.equal(r.total, 129896.7);
});

test('Ana Francy Bermejo González → 252322.03 con 30 días adicionales forzados', () => {
  const r = t3({ ingreso: '16/04/2007', monto: 356219.34, diasAdicionalesForzados: 30 });
  assert.equal(r.diasVacaciones, 30);
  assert.equal(r.diasAdicionales, 30);
  assert.equal(r.adicionalesForzados, true);
  assert.equal(r.total, 252322.03);
});

test('Ana Francy sin forzar: la regla da 0 (el aniversario de abril cae en T2, no en T3)', () => {
  const r = t3({ ingreso: '16/04/2007', monto: 356219.34 });
  assert.equal(r.diasAdicionales, 0);
  assert.equal(r.adicionalesForzados, false);
});

test('aniversario en el trimestre: MIN(30, 2×(años−1)); con 1 año da 0', () => {
  assert.equal(C.diasAdicionales('10/08/2025', 2026, 3, C.PARAMETROS_POR_DEFECTO), 0);
  assert.equal(C.diasAdicionales('10/08/2024', 2026, 3, C.PARAMETROS_POR_DEFECTO), 2);
  assert.equal(C.diasAdicionales('10/08/1990', 2026, 3, C.PARAMETROS_POR_DEFECTO), 30);
  assert.equal(C.diasAdicionales('10/05/1990', 2026, 3, C.PARAMETROS_POR_DEFECTO), 0);
});

test('meses trabajados: 0 a 3 según la fecha de ingreso', () => {
  assert.equal(C.mesesTrabajados('01/01/2020', 2026, 3, 1), 3);
  assert.equal(C.mesesTrabajados('31/07/2026', 2026, 3, 1), 3); // 1 día en julio ya cuenta
  assert.equal(C.mesesTrabajados('15/08/2026', 2026, 3, 1), 2);
  assert.equal(C.mesesTrabajados('30/09/2026', 2026, 3, 1), 1);
  assert.equal(C.mesesTrabajados('01/10/2026', 2026, 3, 1), 0);
});

test('días mínimos configurables: con 15, un mes con menos días no cuenta', () => {
  assert.equal(C.mesesTrabajados('20/07/2026', 2026, 3, 15), 2); // julio: 12 días
  assert.equal(C.mesesTrabajados('15/07/2026', 2026, 3, 15), 3); // julio: 17 días
});

test('sin meses trabajados o sin fecha, el total es 0', () => {
  assert.equal(t3({ ingreso: '01/10/2026', monto: 1000 }).total, 0);
  assert.equal(t3({ ingreso: '', monto: 1000 }).total, 0);
});

test('vacaciones: tope de 30 días y año base editable', () => {
  const p = { ...C.PARAMETROS_POR_DEFECTO, anioBase: 2025 };
  assert.equal(C.diasVacaciones('01/01/2025', p), 15);
  assert.equal(C.diasVacaciones('01/01/2030', p), 15);
  assert.equal(C.diasVacaciones('01/01/2005', p), 30);
  assert.equal(C.diasVacaciones('01/01/2020', { ...p, anioBase: 2026 }), 21);
});

test('fechas inválidas se rechazan', () => {
  assert.equal(C.aFecha('31/02/2026'), null);
  assert.deepEqual(C.aFecha('2026-09-30'), { y: 2026, m: 9, d: 30 });
});
