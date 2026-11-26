// Varias consultas en una sola llamada a Google (acción «varias»).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { crearEntorno } = require('../dev/gas-simulado.js');

function preparar() {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', departamento: 'Ventas', puesto: 'Vendedora', estado: 'Active', fechaInicio: '05/03/2025', salarioMensual: 12583.17 },
  ] });
  const r = e.llamar({ action: 'login', cedula: '11111111' });
  const ana = r.data.token || e.llamar({ action: 'crearPin', cedula: '11111111', pin: '2580', confirmacion: '2580' }).data.token;
  return { e, admin, ana };
}

test('la consulta múltiple responde cada consulta igual que si se pidiera sola', () => {
  const { e, ana } = preparar();
  const acciones = ['datosVacaciones', 'misConstancias', 'datosAnticipo', 'miPerfil', 'misRecibos'];
  const r = e.llamar({ action: 'varias', token: ana, pedidos: acciones.map((action) => ({ action })) });
  assert.equal(r.ok, true);
  assert.equal(r.data.length, acciones.length);
  acciones.forEach((a, i) => assert.deepEqual(r.data[i], e.llamar({ action: a, token: ana }), a));
});

test('la consulta múltiple no acepta acciones que guardan ni el inicio de sesión, y cada error va por su lado', () => {
  const { e, ana } = preparar();
  const r = e.llamar({ action: 'varias', token: ana, pedidos: [{ action: 'emitirConstancia' }, { action: 'login', datos: { cedula: '11111111' } }, { action: 'misConstancias' }, { action: 'misConstancias', datos: { token: 'malo' } }] });
  assert.equal(r.data[0].code, 'ACCION');
  assert.equal(r.data[1].code, 'ACCION');
  assert.equal(r.data[2].ok, true);
  assert.equal(r.data[3].ok, false);
  assert.equal(e.hojas.CONSTANCIAS.getLastRow(), 1, 'no emitió nada');
});

test('el sitio trata como consulta todo lo que el servidor considera consulta (si no, borra su memoria al llamarlo)', () => {
  const s = fs.readFileSync('src/api.gs', 'utf8').match(/var LECTURAS = \{([\s\S]*?)\};/)[1];
  const servidor = [...s.matchAll(/(\w+): 1/g)].map((x) => x[1]).filter((a) => !['login', 'loginAdmin', 'subirRecibos'].includes(a));
  const w = fs.readFileSync('web/js/api.js', 'utf8').match(/const LECTURAS = new Set\(\[([\s\S]*?)\]\)/)[1];
  const sitio = new Set([...w.matchAll(/'(\w+)'/g)].map((x) => x[1]));
  assert.deepEqual(servidor.filter((a) => !sitio.has(a)), []);
});
