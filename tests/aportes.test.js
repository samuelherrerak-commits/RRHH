const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../core/aportes.js');
const E = require('../core/empleados.js');

// Los tres casos de RRHH (T3 2026, año base 2025)
const emps = E.fusionarDetalle([], [
  { cedula: 'V111111119', nombre: 'Esther Lilia Rodríguez Hernández', organizacion: 'PROSEIN CENTRAL', fechaInicio: '05/03/2025' },
  { cedula: 'V222222229', nombre: 'Ana Francy Bermejo González', organizacion: 'PROSEIN CENTRAL', fechaInicio: '16/04/2007' },
  { cedula: 'V333333339', nombre: 'Alirio Alfonso Ávila', organizacion: 'PROSEIN CENTRAL', fechaInicio: '25/07/2011' },
  { cedula: 'V444444449', nombre: 'Nueva Ingreso Julio', organizacion: 'PROSEIN CENTRAL', fechaInicio: '15/08/2026' },
  { cedula: 'V555555559', nombre: 'De Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
]).empleados;
const P = { anioBase: 2025, diasMinimosMes: 1 };
const base = { anio: 2026, trimestre: 3, empresa: 'PCA', empleados: emps, parametros: P };
const filas = [
  { nombre: 'ESTHER LILIA RODRIGUEZ HERNANDEZ', monto: 12583.168 },
  { nombre: 'Ana Francy Bermejo Gonzalez', monto: 356219.34 },
  { nombre: 'alirio alfonso  avila', monto: 192290.08 },
  { nombre: 'Nueva Ingreso Julio', monto: 5000 },
];

test('aporte: los tres casos de RRHH dan exacto (Ana Francy con 30 días forzados)', () => {
  const r = A.prepararAporte({ ...base, filas, forzados: { V22222222: 30 }, anterior: ['V11111111', 'V22222222', 'V33333333'] });
  const t = Object.fromEntries(r.lineas.map((l) => [l.clave, l.total]));
  assert.equal(t.V11111111, 2883.64);
  assert.equal(t.V22222222, 252322.03);
  assert.equal(t.V33333333, 129896.7);
  assert.equal(r.listo, true);
  assert.equal(r.totales.personas, 4);
});

test('aporte: nuevos y retirados frente al trimestre anterior', () => {
  const r = A.prepararAporte({ ...base, filas, anterior: ['V11111111', 'V22222222', 'V33333333', 'V99999999'] });
  assert.deepEqual(r.lineas.filter((l) => l.nuevo).map((l) => l.clave), ['V44444444']);
  assert.deepEqual(r.retirados.map((x) => x.clave), ['V99999999']);
  assert.equal(r.totales.nuevos, 1);
  assert.equal(r.primeraCarga, false);
});

test('aporte: primer aporte en el sistema → nuevos solo los que ingresaron en el trimestre; sin retirados', () => {
  const r = A.prepararAporte({ ...base, filas, anterior: null });
  assert.equal(r.primeraCarga, true);
  assert.deepEqual(r.lineas.filter((l) => l.nuevo).map((l) => l.clave), ['V44444444']);
  assert.deepEqual(r.retirados, []);
});

test('aporte: sugerencias para nombres parecidos y resolución con la cédula', () => {
  const f = [{ nombre: 'Esther Rodriguez Hernandez', monto: 100 }, { nombre: 'Persona Desconocida', monto: 50 }];
  let r = A.prepararAporte({ ...base, filas: f, anterior: null });
  assert.equal(r.sugeridas.length, 1);
  assert.equal(r.sugeridas[0].candidatos[0].clave, 'V11111111');
  assert.equal(r.sinEmpleado[0].nombre, 'Persona Desconocida');
  assert.equal(r.listo, false);
  r = A.prepararAporte({ ...base, filas: [{ ...f[0], clave: 'V11111111' }, f[1]], anterior: null });
  assert.equal(r.listo, true);
  assert.ok(r.alertas.some((a) => a.tipo === 'EXCEL_SIN_EMPLEADO'));
  assert.ok(r.alertas.some((a) => a.tipo === 'SIN_MONTO'));          // Ana Francy, Alirio y la nueva no vienen
});

test('aporte: solo empleados de la empresa elegida; montos en cero y filas repetidas avisan', () => {
  const r = A.prepararAporte({ ...base, filas: [{ nombre: 'De Austral', monto: 10 }, { nombre: 'Alirio Alfonso Avila', monto: 0 }, { nombre: 'Alirio Alfonso Avila', monto: 5 }], anterior: null });
  assert.ok(r.alertas.some((a) => /De Austral/.test(a.texto)));        // es de AIV: no se incluye en PCA
  assert.ok(r.alertas.some((a) => a.tipo === 'MONTO_NO_POSITIVO'));
  assert.ok(r.alertas.some((a) => a.tipo === 'DUPLICADA'));
  assert.equal(r.lineas.length, 1);
});
