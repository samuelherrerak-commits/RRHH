const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../core/empleados.js');

test('normalizarNombre: mayúsculas, sin tildes ni espacios dobles', () => {
  assert.equal(E.normalizarNombre('  Alirio   Alfonso  Ávila '), 'ALIRIO ALFONSO AVILA');
  assert.equal(E.normalizarNombre('Rodríguez, Esther'), 'RODRIGUEZ ESTHER');
});

const conVerificador = (letra, ocho) => letra + ocho + E.verificadorRif(letra, ocho);

test('RIF de 9 dígitos: se quita el verificador y queda la cédula (caso real V305803231 → 30580323)', () => {
  assert.deepEqual(E.parsearCedula('V305803231'), { letra: 'V', numero: '30580323', revisar: false, motivo: '' });
});

test('cédula de 7 dígitos: el RIF trae un cero al inicio y se quita', () => {
  const c = E.parsearCedula(conVerificador('V', '09123456'));
  assert.equal(c.numero, '9123456');
  assert.equal(c.revisar, false);
});

test('RIF con verificador que no coincide: se quita igual pero se marca para revisar', () => {
  const mal = 'V30580323' + ((E.verificadorRif('V', '30580323') + 1) % 10);
  const c = E.parsearCedula(mal);
  assert.equal(c.numero, '30580323');
  assert.equal(c.revisar, true);
});

test('cédula de 8 dígitos sin verificador: se deja completa', () => {
  // elige un número de 8 dígitos cuyo último dígito NO sea verificador válido de una cédula de 7
  let n = 20000000;
  while (E.verificadorRif('V', '0' + String(n).slice(0, 7)) === Number(String(n)[7])) n++;
  const c = E.parsearCedula('V' + n);
  assert.equal(c.numero, String(n));
  assert.equal(c.revisar, false);
});

test('cédula extranjera y formatos con puntos o guiones', () => {
  assert.equal(E.parsearCedula('E-84.123.456').letra, 'E');
  assert.equal(E.parsearCedula(conVerificador('E', '84123456')).numero, '84123456');
  assert.equal(E.parsearCedula('').revisar, true);
});

test("estado: 'Active' del export es 'Activo'", () => {
  assert.equal(E.estadoEnEspanol('Active'), 'Activo');
  assert.equal(E.estadoEnEspanol('Inactive'), 'Inactivo');
  assert.equal(E.estadoEnEspanol(''), 'Activo');
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

test('mapearDetalle: reconoce encabezados con tildes, serial de Excel y filas vacías', () => {
  const r = E.mapearDetalle([
    { 'Organización': 'PROSEIN', Departamento: 'Ventas', Puesto: 'Vendedor', 'Cédula': 'V123456789', Nombre: 'Ana Uno', Estado: 'Activo', 'Fecha Inicio': 45356 },
    { 'Organización': '', Departamento: '', Puesto: '', 'Cédula': '', Nombre: '', Estado: '', 'Fecha Inicio': '' },
  ]);
  assert.equal(r.filas.length, 1);
  assert.equal(r.omitidas, 1);
  assert.deepEqual(r.faltantes, ['jefeNombre', 'genero', 'salarioMensual']);   // este archivo de prueba no trae jefe, género ni sueldo
  assert.equal(r.filas[0].fechaInicio, '05/03/2024');
  assert.equal(E.mapearDetalle([{ Nombre: 'X' }]).faltantes.includes('cedula'), true);
});

test('fechaDeExcel: serial entero, con hora y texto sin tocar', () => {
  assert.equal(E.fechaDeExcel(45356), '05/03/2024');
  assert.equal(E.fechaDeExcel(45721.5), '05/03/2025');
  assert.equal(E.fechaDeExcel('25/07/2011'), '25/07/2011');
  assert.equal(E.fechaDeExcel(''), '');
});

test('nombres, cargos y departamentos sin espacios dobles (vienen así en el export real)', () => {
  const e = E.empleadoDesdeDetalle({ cedula: 'V305803231', nombre: ' LUIS PAUL  ROJAS LISARDO ', puesto: 'Gerente  de RRHH', departamento: 'Recursos  Humanos', organizacion: 'PROSEIN  CENTRAL' });
  assert.equal(e.nombre, 'LUIS PAUL ROJAS LISARDO');
  assert.equal(e.puesto, 'Gerente de RRHH');
  assert.equal(e.departamento, 'Recursos Humanos');
  assert.equal(e.organizacion, 'PROSEIN CENTRAL');
});

test('género del detalle (para el saludo) y se conserva si el archivo nuevo no lo trae', () => {
  const r = E.mapearDetalle([{ 'Cédula': 'V305803231', 'Nombre Socio del Negocio': 'Ana', Genero: 'Femenino' }]);
  assert.equal(r.filas[0].genero, 'Femenino');
  const a = E.fusionarDetalle([], r.filas).empleados;
  assert.equal(a[0].genero, 'Femenino');
  assert.equal(E.fusionarDetalle(a, [{ cedula: 'V305803231', nombre: 'Ana' }]).empleados[0].genero, 'Femenino');
});

test('jefe por nombre: exacto, abreviado (palabras), ambiguo o no encontrado', () => {
  const emps = E.fusionarDetalle([], [
    { cedula: 'V111111119', nombre: 'CARLOS LUIS CAMACARO', organizacion: 'X' },
    { cedula: 'V222222229', nombre: 'CATHERINE YANEYRE PONTE PIMENTEL', organizacion: 'X' },
    { cedula: 'V333333339', nombre: 'MARIA PEREZ LOPEZ', organizacion: 'X' },
    { cedula: 'V444444449', nombre: 'MARIA PEREZ GOMEZ', organizacion: 'X' },
  ]).empleados;
  assert.deepEqual(E.resolverJefe('Carlos Luis  Camacaro', emps), { clave: 'V11111111', nombre: 'CARLOS LUIS CAMACARO', tipo: 'exacto' });
  assert.equal(E.resolverJefe('CATHERINE PONTE', emps).tipo, 'palabras');
  assert.equal(E.resolverJefe('CATHERINE PONTE', emps).clave, 'V22222222');
  assert.equal(E.resolverJefe('MARIA PEREZ', emps).tipo, 'ambiguo');
  assert.equal(E.resolverJefe('BETSY RODRIGUEZ', emps).tipo, 'no_encontrado');
  assert.equal(E.mapearDetalle([{ 'Cédula': 'V1', 'Nombre Socio del Negocio': 'A', 'JEFE DIRECTO': ' BETSY  RODRIGUEZ ' }]).filas[0].jefeNombre, 'BETSY RODRIGUEZ');
});
