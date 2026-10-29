// Ejecuta el archivo REAL que se pega en Apps Script (apps-script/RRHH.gs) sobre una simulación de Google Sheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { construir } = require('../scripts/build-gas.js');

/* ---------- Simulación mínima de los servicios de Google ---------- */
function crearHoja(nombre) {
  const filas = [];
  const rango = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (filas[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues(v) { v.forEach((fila, i) => fila.forEach((x, j) => { (filas[r - 1 + i] ||= [])[c - 1 + j] = x; })); return this; },
    clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (filas[r - 1 + i]) filas[r - 1 + i][c - 1 + j] = ''; return this; },
    setNumberFormat() { return this; }, setFontWeight() { return this; },
  });
  return {
    nombre, filas,
    getLastRow: () => { let n = filas.length; while (n > 0 && (!filas[n - 1] || filas[n - 1].every((x) => x === '' || x == null))) n--; return n; },
    getRange: rango, setFrozenRows() {},
    getDataRange() { const n = this.getLastRow(), m = Math.max(0, ...filas.map((f) => (f || []).length)); return rango(1, 1, n, m); },
    appendRow(f) { filas[this.getLastRow()] = f.slice(); },
  };
}

function crearEntorno({ respuestasUi = [] } = {}) {
  const hojas = {}, props = {}, cache = {}, ui = { alertas: [], respuestas: respuestasUi.slice() };
  const bytes = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null, insertSheet: (n) => (hojas[n] = crearHoja(n)) }),
      getUi: () => ({
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' }, Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' },
        alert(t, m, b) { ui.alertas.push([t, m]); const r = ui.respuestas.shift(); return r === undefined ? 'OK' : r; },
        prompt(t, m) { ui.alertas.push([t, m]); const r = ui.respuestas.shift(); return { getSelectedButton: () => 'OK', getResponseText: () => r }; },
        createMenu: () => ({ addItem() { return this; }, addToUi() {} }),
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ contenido: t, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, txt) => bytes(crypto.createHash('sha256').update(txt, 'utf8').digest()),
      computeHmacSha256Signature: (txt, clave) => bytes(crypto.createHmac('sha256', clave).update(txt, 'utf8').digest()),
      base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64url'),
      base64DecodeWebSafe: (s) => bytes(Buffer.from(s, 'base64url')),
      newBlob: (arr) => ({ getDataAsString: () => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b))).toString('utf8') }),
    },
  };
  // Apps Script real: asignar a `globalThis`/`this` desde dentro de un módulo no basta para crear los globales.
  // Este señuelo reproduce ese fallo: solo los `var` de nivel superior del archivo cuentan.
  sandbox.globalThis = {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(construir(), ctx, { filename: 'RRHH.gs' });
  const llamar = (cuerpo) => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify({ api_token: 'RRHH2026', ...cuerpo }) } }).contenido);
  const ejecutar = (fn) => vm.runInContext(fn + '()', ctx);
  return { ctx, hojas, props, ui, llamar, ejecutar };
}

test('el archivo generado está al día con core/ y Code.gs', () => {
  assert.equal(fs.readFileSync('apps-script/RRHH.gs', 'utf8'), construir(), 'Ejecuta: npm run build:gas');
});

test('configurarInicial crea las hojas y a Samuel y Luis Paul como usuarios de RRHH (sin clave)', () => {
  const e = crearEntorno();
  e.ejecutar('configurarInicial');
  for (const n of ['PARAMETROS', 'EMPRESAS', 'EMPLEADOS', 'APORTES', 'CIERRES', 'ANTICIPOS', 'CONSTANCIAS', 'USUARIOS', 'LOG']) assert.ok(e.hojas[n], 'falta la hoja ' + n);
  const us = e.hojas.USUARIOS.filas.slice(1);
  assert.deepEqual(us.map((f) => [f[0], f[3], f[4]]), [['30580323', 'ADMIN', 'Samuel Herrera'], ['7952013', 'ADMIN', 'Luis Paul Rojas']]);
  assert.ok(us.every((f) => f[2] === ''), 'no deben tener clave todavía');
  e.ejecutar('configurarInicial');                        // repetir no duplica
  assert.equal(e.hojas.USUARIOS.filas.length, 3);
  assert.equal(e.props.API_TOKEN, 'RRHH2026');
  assert.ok(e.props.SECRETO);
});

test('sin clave no se puede entrar; con la clave puesta desde el menú sí, y el trabajador entra solo con cédula', () => {
  // respuestas del menú: cédula, confirmar (YES), clave
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial');
  assert.deepEqual(e.llamar({ action: 'login', cedula: '30580323' }).data, { requiereClave: true });
  assert.equal(e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'lo-que-sea' }).code, 'SIN_CLAVE');

  e.ejecutar('ponerClaveRRHH');
  const hash = e.hojas.USUARIOS.filas[1][2];
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(e.hojas).includes('clave-de-samuel'), 'la clave no debe quedar escrita');
  assert.equal(e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'mala' }).code, 'CREDENCIALES');
  const r = e.llamar({ action: 'loginAdmin', cedula: 'V-305803231', clave: 'clave-de-samuel' });   // incluso escribiendo el RIF
  assert.equal(r.ok, true);
  assert.equal(r.data.rol, 'ADMIN');
});

test('flujo completo sobre las hojas: cargar empleados, jefe, anticipo, constancia y verificación', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;

  const cargado = e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', departamento: 'Recursos Humanos', puesto: 'Asistente', estado: 'Active', fechaInicio: '12/11/2024', salarioMensual: 5500 },
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', departamento: 'Ventas', puesto: 'Vendedora', estado: 'Active', fechaInicio: '05/03/2025', salarioMensual: 12583.17 },
  ] });
  assert.equal(cargado.ok, true, JSON.stringify(cargado));
  assert.equal(cargado.data.resumen.agregados, 2);

  const lista = e.llamar({ action: 'listarEmpleados', token: admin, buscar: 'ana' }).data.empleados;
  assert.equal(lista[0].empresa, 'AIV');
  const j = e.llamar({ action: 'asignarJefe', token: admin, claves: [lista[0].clave], jefe: 'V30580323' });
  assert.equal(j.data.cambiados, 1);
  assert.equal(e.llamar({ action: 'listarEmpleados', token: admin, buscar: 'ana' }).data.empleados[0].jefeNombre, 'SAMUEL HERRERA');

  // aporte acreditado → anticipo
  const ana = e.llamar({ action: 'login', cedula: '11111111' }).data.token;
  e.hojas.APORTES.appendRow(['V11111111', 2026, 1, 'AIV', 4000, 0, 3, 0, false, false]);
  e.hojas.CIERRES.appendRow([2026, 1, 'AIV', 'ACREDITADO', 'x', 0]);
  assert.equal(e.llamar({ action: 'estadoDeCuenta', token: ana }).data.resumen.disponible, 3000);
  const sol = e.llamar({ action: 'solicitarAnticipo', token: ana, monto: 1000, motivo: 'Salud' });
  assert.equal(sol.ok, true, JSON.stringify(sol));
  assert.equal(e.llamar({ action: 'decidirAnticipo', token: admin, id: sol.data.id, aprobar: true }).ok, true);
  const arch = e.llamar({ action: 'archivoAnticipos', token: admin, empresa: 'AIV' });
  assert.match(arch.data.csv, /;V;11111111;5;A;1000\.00;ANA PRUEBA/);

  // constancia + QR público
  const c = e.llamar({ action: 'emitirConstancia', token: ana });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.data.empresa, 'AIV');
  const v = e.llamar({ action: 'verificarConstancia', id: c.data.id });
  assert.equal(v.data.estado, 'VIGENTE');
  assert.equal(e.llamar({ action: 'listarConstancias', token: admin }).data.length, 1);
  assert.equal(e.llamar({ action: 'anularConstancia', token: admin, id: c.data.id }).data.estado, 'ANULADA');
  assert.equal(e.llamar({ action: 'verificarConstancia', id: c.data.id }).data.estado, 'ANULADA');
});

test('el token de la API es obligatorio', () => {
  const e = crearEntorno(); e.ejecutar('configurarInicial');
  const r = JSON.parse(vm.runInContext('doPost', e.ctx)({ postData: { contents: JSON.stringify({ action: 'login', cedula: '1234567' }) } }).contenido);
  assert.equal(r.code, 'TOKEN');
});

test('si falta código en Apps Script, el menú lo explica en vez de dar un error técnico', () => {
  const e = crearEntorno();
  vm.runInContext('Empleados = undefined;', e.ctx);
  assert.throws(() => e.ejecutar('ponerClaveRRHH'), /Faltan módulos: Empleados/);
  assert.match(e.ui.alertas.at(-1)[1], /RRHH\.gs/);
});

test('abrir la URL muestra la versión y que todos los módulos cargaron', () => {
  const e = crearEntorno();
  const r = JSON.parse(vm.runInContext('doGet', e.ctx)().contenido);
  assert.equal(r.modulosCompletos, true);
  assert.match(r.version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.ok(Object.values(r.modulos).every(Boolean));
});

test('si falta el código, el sitio recibe un mensaje claro y el error queda en LOG', () => {
  const e = crearEntorno(); e.ejecutar('configurarInicial');
  vm.runInContext('Servicio = undefined;', e.ctx);
  const doGetFalta = JSON.parse(vm.runInContext('doGet', e.ctx)().contenido);
  assert.equal(doGetFalta.modulosCompletos, false);
  assert.equal(doGetFalta.modulos.Servicio, false);
  const r = e.llamar({ action: 'listarConstancias' });
  assert.equal(r.code, 'SERVER');
  assert.match(r.message, /Falta código en Apps Script.*RRHH\.gs/);
  assert.ok(e.hojas.LOG.filas.some((f) => f && f[1] === 'ERROR'));
});
