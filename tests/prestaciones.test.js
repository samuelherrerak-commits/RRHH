const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../core/prestaciones.js');

const ap = (anio, trimestre, total, estadoCierre) => ({ anio, trimestre, empresa: 'PCA', total, estadoCierre });

test('el trabajador solo ve aportes que el banco ya acreditó', () => {
  const r = P.resumenTrabajador([
    ap(2026, 1, 1000, 'ACREDITADO'), ap(2026, 2, 2000, 'ACREDITADO'), ap(2026, 3, 5000, 'CERRADO'),
  ], []);
  assert.equal(r.totalAportado, 3000);
  assert.equal(r.detalle.length, 2);
  assert.equal(r.detalle[1].acumulado, 3000);
  assert.equal(r.disponible, 2250); // 75 %
});

test('disponible descuenta anticipos pagados y en trámite, no los rechazados', () => {
  const r = P.resumenTrabajador([ap(2026, 1, 4000, 'ACREDITADO')], [
    { monto: 1000, estado: 'PAGADA' }, { monto: 500, estado: 'PENDIENTE' }, { monto: 900, estado: 'RECHAZADA' },
  ]);
  assert.equal(r.disponible, 1500); // 3000 − 1000 − 500
});

test('sin aportes acreditados no hay nada disponible', () => {
  assert.equal(P.resumenTrabajador([ap(2026, 3, 100, 'CERRADO')], []).disponible, 0);
});

test('validación de la solicitud', () => {
  const resumen = { disponible: 1000 };
  const emp = { estado: 'Activo' };
  assert.equal(P.validarSolicitudAnticipo({ monto: 800, motivo: 'Salud' }, resumen, emp).ok, true);
  assert.equal(P.validarSolicitudAnticipo({ monto: 1200, motivo: 'Salud' }, resumen, emp).ok, false);
  assert.equal(P.validarSolicitudAnticipo({ monto: -5, motivo: 'Salud' }, resumen, emp).ok, false);
  assert.equal(P.validarSolicitudAnticipo({ monto: 10, motivo: 'Viaje' }, resumen, emp).ok, false);
  assert.equal(P.validarSolicitudAnticipo({ monto: 10, motivo: 'Otro' }, resumen, emp).ok, false);
  assert.equal(P.validarSolicitudAnticipo({ monto: 10, motivo: 'Salud' }, resumen, { estado: 'Inactivo' }).ok, false);
});

test('transiciones permitidas', () => {
  assert.equal(P.puedePasar(P.SIGUIENTE_CIERRE, 'CERRADO', 'ACREDITADO'), true);
  assert.equal(P.puedePasar(P.SIGUIENTE_CIERRE, 'ACREDITADO', 'ABIERTO'), false);
  assert.equal(P.puedePasar(P.SIGUIENTE_SOLICITUD, 'PENDIENTE', 'PAGADA'), false);
  assert.equal(P.puedePasar(P.SIGUIENTE_SOLICITUD, 'EN_ARCHIVO', 'PAGADA'), true);
});
