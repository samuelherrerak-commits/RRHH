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

const AP4 = { id: 'A', clave: '2026-T4', inicio: '2027-01-05', fin: '2027-01-16' };
const AP3 = { id: 'B', clave: '2026-T3', inicio: '2026-10-26', fin: '2026-11-06' };

test('aperturas: la vigente según las fechas y la próxima programada', () => {
  assert.equal(P.etiquetaVentana('2026-T4'), '4.º trimestre de 2026');
  assert.deepEqual(P.aperturas([AP4, AP3], '2026-10-30'), { activa: AP3, proxima: AP4 });
  assert.deepEqual(P.aperturas([AP4, AP3], '2026-11-07'), { activa: null, proxima: AP4 });       // AP3 ya cerró
  assert.deepEqual(P.aperturas([AP4, AP3], '2027-01-16'), { activa: AP4, proxima: null });      // último día, incluido
  assert.equal(P.estadoApertura(AP4, '2027-01-17'), 'CERRADA');
});

test('aperturas: fechas válidas, un trimestre una vez y sin cruces', () => {
  assert.equal(P.validarApertura({ id: 'N', clave: '2027-T1', inicio: '2027-04-05', fin: '2027-04-16' }, [AP3, AP4]).ok, true);
  assert.match(P.validarApertura({ id: 'N', clave: '2027-T1', inicio: '2027-04-16', fin: '2027-04-05' }, []).errores[0], /anterior/);
  assert.match(P.validarApertura({ id: 'N', clave: '2026-T4', inicio: '2027-04-05', fin: '2027-04-16' }, [AP4]).errores[0], /Ya hay una apertura/);
  assert.match(P.validarApertura({ id: 'N', clave: '2027-T1', inicio: '2027-01-10', fin: '2027-01-20' }, [AP4]).errores[0], /Se cruza/);
  assert.equal(P.validarApertura({ ...AP4, fin: '2027-01-12' }, [AP4]).ok, true);                // editar la misma
  assert.match(P.validarApertura({ id: 'N', clave: '', inicio: '', fin: '' }, []).errores[0], /trimestre/);
});

test('solicitud: solo con apertura vigente, con aceptación y una por apertura', () => {
  const emp = { estado: 'Activo' }, base = { monto: 1500, motivo: 'Vivienda', acepta: true };
  assert.match(P.validarSolicitudBanco(base, { empleado: emp, previas: [], activa: null, proxima: AP4 }).errores[0], /no está abierta.*del 05\/01\/2027 al 16\/01\/2027/);
  assert.match(P.validarSolicitudBanco(base, { empleado: emp, previas: [], activa: null, proxima: null }).errores[0], /anunciará la próxima apertura/);
  assert.equal(P.validarSolicitudBanco(base, { empleado: emp, previas: [], activa: AP3, proxima: AP4 }).ok, true);
  assert.match(P.validarSolicitudBanco({ ...base, acepta: false }, { empleado: emp, previas: [], activa: AP3 }).errores[0], /bajo tu responsabilidad/);
  assert.match(P.validarSolicitudBanco(base, { empleado: emp, previas: [{ ventana: '2026-T3', estado: 'RECHAZADA' }], activa: AP3, proxima: AP4 }).errores[0], /Ya enviaste tu solicitud del 3\.er trimestre de 2026\. La próxima apertura es del 05\/01\/2027/);
  assert.equal(P.validarSolicitudBanco(base, { empleado: emp, previas: [{ ventana: '2026-T3', estado: 'CANCELADA' }], activa: AP3 }).ok, true);
});
