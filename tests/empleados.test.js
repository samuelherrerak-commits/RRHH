const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../core/empleados.js');

test('normalizarNombre: mayúsculas, sin tildes ni espacios dobles', () => {
  assert.equal(E.normalizarNombre('  Alirio   Alfonso  Ávila '), 'ALIRIO ALFONSO AVILA');
  assert.equal(E.normalizarNombre('Rodríguez, Esther'), 'RODRIGUEZ ESTHER');
});

test('cédula de 9 dígitos: se quita el verificador', () => {
  assert.deepEqual(E.parsearCedula('V123456789'), { letra: 'V', numero: '12345678', revisar: false, motivo: '' });
});

test('cédula de 8 dígitos: se deja completa y se marca para revisar', () => {
  const c = E.parsearCedula('V12345678');
  assert.equal(c.numero, '12345678');
  assert.equal(c.revisar, true);
});

test('cédula extranjera y formatos con puntos o guiones', () => {
  assert.equal(E.parsearCedula('E-84.123.456-7').letra, 'E');
  assert.equal(E.parsearCedula('E-84.123.456-7').numero, '84123456');
  assert.equal(E.parsearCedula('').revisar, true);
});

test('empresa: Austral Import = AIV, todo lo demás = PCA, y la edición manual manda', () => {
  assert.equal(E.empresaDesdeDetalle('AUSTRAL IMPORT DE VENEZUELA C.A'), 'AIV');
  assert.equal(E.empresaDesdeDetalle('Prosein Central C.A.'), 'PCA');
  const emp = E.empleadoDesdeDetalle({ cedula: 'V123456789', nombre: 'Eleanne Ruiz', organizacion: 'PROSEIN SUCURSAL', fechaInicio: '01/02/2020' });
  assert.equal(E.empresaFideicomiso(emp), 'PCA');
  emp.empresaFideicomiso = 'AIV';
  assert.equal(E.empresaFideicomiso(emp), 'AIV');
});

const fila = (c, n, o = 'PROSEIN', extra = {}) => ({ cedula: c, nombre: n, organizacion: o, fechaInicio: '05/03/2025', ...extra });

test('recargar el detalle: actualiza, agrega y conserva correcciones manuales', () => {
  const base = E.fusionarDetalle([], [fila('V111111111', 'Ana Uno'), fila('V222222222', 'Beto Dos')]).empleados;
  base[0].empresaFideicomiso = 'AIV';
  base[0].puesto = 'Corregido a mano';
  base[0].editados = ['puesto'];
  const r = E.fusionarDetalle(base, [
    fila('V111111111', 'Ana Uno', 'PROSEIN', { puesto: 'Vendedor' }),
    fila('V333333333', 'Carla Tres'),
  ]);
  const porNombre = Object.fromEntries(r.empleados.map((e) => [e.nombre, e]));
  assert.equal(porNombre['Ana Uno'].puesto, 'Corregido a mano');
  assert.equal(E.empresaFideicomiso(porNombre['Ana Uno']), 'AIV');
  assert.equal(porNombre['Carla Tres'].estado, 'Activo');
  assert.equal(porNombre['Beto Dos'].estado, 'Inactivo');
  assert.deepEqual(r.resumen, { agregados: 1, actualizados: 1, inactivados: 1 });
});

test('cruce: exactas, sugeridas y sin empleado', () => {
  const emps = E.fusionarDetalle([], [
    fila('V111111111', 'Esther Lilia Rodríguez Hernández'),
    fila('V222222222', 'Alirio Alfonso Ávila'),
  ]).empleados;
  const r = E.cruzarPorNombre([
    { nombre: 'ESTHER LILIA RODRIGUEZ HERNANDEZ', monto: 1 },
    { nombre: 'Avila Alirio Alfonso', monto: 2 },
    { nombre: 'Zacarías Pérez', monto: 3 },
  ], emps);
  assert.equal(r.exactas.length, 1);
  assert.equal(r.sugeridas.length, 1);
  assert.equal(r.sugeridas[0].candidatos[0].empleado.nombre, 'Alirio Alfonso Ávila');
  assert.equal(r.sinEmpleado.length, 1);
});

test('nuevos y retirados', () => {
  const emps = E.fusionarDetalle([], [
    fila('V111111111', 'Antiguo Uno', 'PROSEIN', { fechaInicio: '01/01/2020' }),
    fila('V222222222', 'Reciente Dos', 'PROSEIN', { fechaInicio: '15/08/2026' }),
    fila('V333333333', 'Sin Previo Tres', 'PROSEIN', { fechaInicio: '01/01/2021' }),
  ]).empleados;
  const r = E.detectarNuevosYRetirados(emps, ['V11111111', 'V22222222', 'V99999999'], 2026, 3, emps);
  assert.deepEqual(r.nuevos.map((e) => e.nombre).sort(), ['Reciente Dos', 'Sin Previo Tres']);
  assert.deepEqual(r.retirados.map((x) => x.clave), ['V99999999']);
});
