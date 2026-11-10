const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core/comisiones.js');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

const EMP = [
  { clave: 'V13727509', nombre: 'FRANCIS VARELA GARCIA', organizacion: 'SUCURSAL LOS NARANJOS', estado: 'Activo' },
  { clave: 'V1', nombre: 'DAYRLIN ADRIANA TOVAR VELASQUEZ', organizacion: 'SUCURSAL BOLEITA', estado: 'Activo' },
  { clave: 'V2', nombre: 'CARMEN MARISOL RODRIGUEZ SANCHEZ', organizacion: 'SUCURSAL EL BOSQUE', estado: 'Activo' },
  { clave: 'V3', nombre: 'ESTHER LILIA RODRIGUEZ HERNANDEZ', organizacion: 'SUCURSAL SAN MARTÍN', estado: 'Activo' },
  { clave: 'V4', nombre: 'MARIA MILAGROS SOCORRO ORTEGA', organizacion: 'SUCURSAL MILAGRO NORTE', estado: 'Activo' },
  { clave: 'V5', nombre: 'MARIA JOSE FONSECA LEON', organizacion: 'SUCURSAL EL BOSQUE', estado: 'Activo' },
  { clave: 'V6', nombre: 'MARIA JOSE PEREZ', organizacion: 'SUCURSAL ACARIGUA', estado: 'Activo' },
];

test('cruza nombres mal escritos o incompletos con los empleados', () => {
  assert.equal(C.cruzarNombre('Francis Valera', 'SUCURSAL LOS NARANJOS', EMP).clave, 'V13727509');   // letras cambiadas
  assert.equal(C.cruzarNombre('Adriana Tovar-POS', '', EMP).clave, 'V1');                           // sufijo -POS y segundo nombre
  assert.equal(C.cruzarNombre('Marisol Rodriguez', '', EMP).clave, 'V2');
  assert.equal(C.cruzarNombre('Maria Socorro (Ventas Propias)', '', EMP).clave, 'V4');
  assert.equal(C.cruzarNombre('Maria Jose', '', EMP).estado, 'ambiguo');                            // dos María José: lo decide Gestión Humana
  assert.equal(C.cruzarNombre('Maria Jose', 'SUCURSAL EL BOSQUE', EMP).clave, 'V5');                // la sucursal desempata
  assert.equal(C.cruzarNombre('Ana Ceuta', '', EMP).estado, 'sin');
  assert.deepEqual(C.cruzarNombre('Ana Ceuta', '', EMP.concat({ clave: 'V9', nombre: 'ANA DOLORES CEUTA', estado: 'Activo' }), { 'ANA CEUTA': 'V9' }), { clave: 'V9', estado: 'alias', candidatos: [] });
});

test('lee el Excel de comisiones de la gerencia (dos hojas, sucursales, notas y total)', () => {
  const hojas = [
    { nombre: 'Gerencia', matriz: [[], [], [null, 'Sucursal', 'Ventas', 'Comision Gerente 1', 'Total a Pagar por Comisión en Bs.'],
      [null, 'SUCURSAL BOLEITA', 49883447.56, 0, 0], [null, 'Leslie Romero', null, 0, 41875.05], [null, ' ', null, 0, 0],
      [null, 'Lorena Pichardo', null, 0, 89500, 'Se Garantiza este valor.'], [], [null, 'Total a Pagar', 1, 2, 131375.05]] },
    { nombre: 'Asesores', matriz: [[], [], [null, 'SUCURSAL', 'VENTAS', 'COMISION A PAGAR EN BS', 'MONTO A PAGAR POR COMISION'],
      [null, 'SUCURSAL ACARIGUA', ' '], [null, 'Raul Aveledo', 1, 23325.97, 0, 'Pagar por Pago Especial'], [null, 'Ricardo Velasquez', 2, 1, -1063.9356]] },
  ];
  assert.deepEqual(C.leerExcelComisiones(hojas), [
    { hoja: 'Gerencia', fila: 5, sucursal: 'SUCURSAL BOLEITA', nombre: 'Leslie Romero', monto: 41875.05, nota: '' },
    { hoja: 'Gerencia', fila: 7, sucursal: 'SUCURSAL BOLEITA', nombre: 'Lorena Pichardo', monto: 89500, nota: 'Se Garantiza este valor.' },
    { hoja: 'Asesores', fila: 5, sucursal: 'SUCURSAL ACARIGUA', nombre: 'Raul Aveledo', monto: 0, nota: 'Pagar por Pago Especial' },
    { hoja: 'Asesores', fila: 6, sucursal: 'SUCURSAL ACARIGUA', nombre: 'Ricardo Velasquez', monto: -1063.94, nota: '' },
  ]);
  assert.equal(C.notaExcluye('Pagar en Liquidacion de Prestaciones'), true);
  assert.equal(C.notaExcluye('Se Garantiza este valor.'), false);
  assert.deepEqual(C.consolidar([{ clave: 'V1', monto: 109667.11, incluir: true }, { clave: 'V1', monto: -1063.94, incluir: true }, { clave: 'V2', monto: 5, incluir: false }]), [{ clave: 'V1', monto: 108603.17, filas: 2 }]);
});

test('verifica contra el Resumen de Pago: otras asignaciones iguales, mayores, menores o ausentes', () => {
  const lineas = ['Salario Base Días: 10.00   9.013,27   0,00   9.013,27', 'Otras Asignaciones   1.000,00   0,00   1.000,00', 'Total FRANCIS VARELA GARCIA   10.013,27   -50,00   9.963,27',
    'Otras Asignaciones   500,00   0,00   500,00', 'Total MARIA MILAGROS SOCORRO ORTEGA   900,00   0,00   900,00', 'Salario Base Días: 10.00   10,00   0,00   10,00', 'Total CARMEN MARISOL RODRIGUEZ SANCHEZ   10,00   0,00   10,00',
    'Total Nómina Quincenal   1,00   0,00   1,00', 'Total General   1,00   0,00   1,00'];
  const p = C.leerResumenPago(lineas);
  assert.deepEqual(p.map((x) => [x.nombre, x.otrasAsignaciones]), [['FRANCIS VARELA GARCIA', 1000], ['MARIA MILAGROS SOCORRO ORTEGA', 500], ['CARMEN MARISOL RODRIGUEZ SANCHEZ', 0]]);
  const v = C.verificar([{ clave: 'a', nombre: 'FRANCIS VARELA GARCIA', monto: 1000 }, { clave: 'b', nombre: 'MARIA MILAGROS SOCORRO ORTEGA', monto: 400 },
    { clave: 'c', nombre: 'CARMEN MARISOL RODRIGUEZ SANCHEZ', monto: 50 }, { clave: 'd', nombre: 'NADIE NUNCA', monto: 9 }], p);
  assert.deepEqual(v.map((x) => x.estado), ['ok', 'mayor', 'no', 'no']);
});

test('la solicitud aprende los nombres del Excel y acepta personas que no están en el CAC', () => {
  const repo = crearRepo([{ cedula: 'V079246270', nombre: 'Zoraya Pérez', organizacion: 'PROSEIN CENTRAL', fechaInicio: '08/10/2009' }]), ctx = crearCtx();
  repo.st.usuarios['30580323'] = { sal: 'x', hash: ctx.hash('yo', 'x'), rol: 'ADMIN', nombre: 'Samuel' };
  const t = S.iniciarSesionAdmin(repo, ctx, '30580323', 'yo').data.token;
  const r = S.solicitarNominaEspecial(repo, ctx, t, { concepto: 'Comisiones 15/11', items: [{ clave: 'V7924627', monto: 10, nombresReporte: ['Zoraya-POS'] }, { cedula: 'V-18.789.601', nombre: 'Abrahan Contreras', monto: 5 }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.items.map((x) => [x.clave, x.nombre, x.monto, !!x.manual]), [['V7924627', 'Zoraya Pérez', 10, false], ['V18789601', 'ABRAHAN CONTRERAS', 5, true]]);
  const d = S.datosCruceNomina(repo, ctx, t).data;
  assert.equal(d.alias.ZORAYA, 'V7924627');
  const v = S.guardarVerificacionNomina(repo, ctx, t, r.data.id, { ok: 1, no: 1, archivo: 'resumen.pdf', detalle: [{ clave: 'V7924627', estado: 'ok', otras: 10 }] });
  assert.equal(v.data.verificacion.ok, 1); assert.equal(v.data.verificacion.archivo, 'resumen.pdf');
});
