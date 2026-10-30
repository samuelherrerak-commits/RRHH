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

test('ventana trimestral: en enero se solicita por el 4.º trimestre del año anterior', () => {
  const v = P.ventanaAnticipo('2026-10-30');
  assert.equal(v.clave, '2026-T3');
  assert.equal(v.etiqueta, '3.er trimestre de 2026');
  assert.deepEqual(v.siguiente, { clave: '2026-T4', etiqueta: '4.º trimestre de 2026', abre: '2027-01-01', mes: 'enero de 2027' });
  assert.equal(P.ventanaAnticipo('2027-01-15').clave, '2026-T4');
  assert.equal(P.ventanaAnticipo('2027-01-15').siguiente.mes, 'abril de 2027');
  assert.equal(P.ventanaAnticipo('2027-05-02').clave, '2027-T1');
});

test('solicitud sin saldo en el sistema: monto, motivo, aceptación y una por ventana', () => {
  const v = P.ventanaAnticipo('2026-10-30'), emp = { estado: 'Activo' };
  const base = { monto: 1500, motivo: 'Vivienda', acepta: true };
  assert.equal(P.validarSolicitudBanco(base, { empleado: emp, previas: [], ventana: v }).ok, true);
  assert.match(P.validarSolicitudBanco({ ...base, acepta: false }, { empleado: emp, previas: [], ventana: v }).errores[0], /bajo tu responsabilidad/);
  assert.equal(P.validarSolicitudBanco({ ...base, monto: 0 }, { empleado: emp, previas: [], ventana: v }).ok, false);
  const ya = [{ ventana: '2026-T3', estado: 'RECHAZADA' }];
  assert.match(P.validarSolicitudBanco(base, { empleado: emp, previas: ya, ventana: v }).errores[0], /Podrás hacer otra a partir de enero de 2027 \(4\.º trimestre de 2026\)/);
  assert.equal(P.validarSolicitudBanco(base, { empleado: emp, previas: [{ ventana: '2026-T3', estado: 'CANCELADA' }], ventana: v }).ok, true);   // cancelada no cuenta
});
