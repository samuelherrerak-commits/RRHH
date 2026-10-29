const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core/constancia.js');

test('monto en letras (como el modelo: Cinco mil quinientos bolívares con 00/100 Céntimos)', () => {
  assert.equal(C.montoEnLetras(5500), 'Cinco mil quinientos bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(130), 'Ciento treinta bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(100), 'Cien bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(1), 'Un bolívar con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(0.5), 'Cero bolívares con 50/100 Céntimos');
});

test('monto en letras: miles, millones, apócopes y céntimos', () => {
  assert.equal(C.montoEnLetras(21000), 'Veintiún mil bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(1000), 'Mil bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(31000.07), 'Treinta y un mil bolívares con 07/100 Céntimos');
  assert.equal(C.montoEnLetras(356219.34), 'Trescientos cincuenta y seis mil doscientos diecinueve bolívares con 34/100 Céntimos');
  assert.equal(C.montoEnLetras(1000000), 'Un millón de bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(2500000), 'Dos millones quinientos mil bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(1234567.89), 'Un millón doscientos treinta y cuatro mil quinientos sesenta y siete bolívares con 89/100 Céntimos');
  assert.equal(C.montoEnLetras(2000000), 'Dos millones de bolívares con 00/100 Céntimos');
  assert.equal(C.montoEnLetras(129896.7), 'Ciento veintinueve mil ochocientos noventa y seis bolívares con 70/100 Céntimos');
});

test('monto en letras: rechaza negativos y redondea los céntimos', () => {
  assert.throws(() => C.montoEnLetras(-1));
  assert.equal(C.montoEnLetras(10.999), 'Once bolívares con 00/100 Céntimos');
});

test('formato de monto', () => {
  assert.equal(C.formatoMonto(5500), '5.500,00');
  assert.equal(C.formatoMonto(130.5), '130,50');
  assert.equal(C.formatoMonto(1234567.8), '1.234.567,80');
});

test('fecha en hora de Caracas: a las 00:30 UTC todavía es el día anterior', () => {
  const f = C.fechaCaracas(Date.UTC(2026, 9, 30, 0, 30));
  assert.deepEqual([f.y, f.m, f.d], [2026, 10, 29]);
  assert.equal(C.fechaLargaConDia(f), 'jueves, 29 de octubre de 2026');
});

test('vigencia de 30 días, hasta el final del día de vencimiento', () => {
  const emision = Date.UTC(2026, 9, 29, 15, 0);                       // 29/10/2026 11:00 Caracas
  const vence = C.vencimiento(emision);
  const f = C.fechaCaracas(vence);
  assert.equal(C.fechaCorta(f), '28/11/2026');
  assert.equal(C.estadoConstancia({ estado: 'VIGENTE', vence }, vence), 'VIGENTE');
  assert.equal(C.estadoConstancia({ estado: 'VIGENTE', vence }, vence + 1000), 'VENCIDA');
  assert.equal(C.estadoConstancia({ estado: 'ANULADA', vence }, emision), 'ANULADA');
});

test('vigencia: fin de mes se ajusta (30/11 + 3 meses → 28/02)', () => {
  assert.deepEqual(C.sumarMeses({ y: 2026, m: 11, d: 30 }, 3), { y: 2027, m: 2, d: 28 });
  assert.deepEqual(C.sumarMeses({ y: 2026, m: 12, d: 15 }, 3), { y: 2027, m: 3, d: 15 });
});

test('vigencia de 30 días cruzando fin de año y febrero', () => {
  assert.equal(C.fechaCorta(C.fechaCaracas(C.vencimiento(Date.UTC(2026, 11, 15, 15)))), '14/01/2027');
  assert.equal(C.fechaCorta(C.fechaCaracas(C.vencimiento(Date.UTC(2027, 1, 10, 15)))), '12/03/2027');
  // emitida a las 23:30 de Caracas (03:30 UTC del día siguiente) cuenta desde el día de Caracas
  assert.equal(C.fechaCorta(C.fechaCaracas(C.vencimiento(Date.UTC(2026, 9, 30, 3, 30)))), '28/11/2026');
});
