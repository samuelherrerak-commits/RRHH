// Simulación mínima de Google Sheets / Apps Script para ejecutar el archivo REAL apps-script/RRHH.gs fuera de Google.
// La usan las pruebas (tests/gas.test.js) y el servidor local en modo --gas.
const vm = require('node:vm');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ARCHIVO = path.join(__dirname, '..', 'apps-script', 'RRHH.gs');

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
    deleteRow(n) { filas.splice(n - 1, 1); },
  };
}

/** codigo: texto del proyecto de Apps Script (por defecto, el archivo real apps-script/RRHH.gs). */
function crearEntorno({ respuestasUi = [], codigo = fs.readFileSync(ARCHIVO, 'utf8') } = {}) {
  const hojas = {}, props = {}, cache = {}, ui = { alertas: [], respuestas: respuestasUi.slice() };
  const drive = { carpetas: {}, archivos: {} }, pedidos = [], tareas = [];
  let respuestaOneSignal = { id: 'envio-1' };
  let nId = 0;
  const carpeta = (nombre) => {
    const id = 'CARP' + (++nId);
    return (drive.carpetas[id] = { getId: () => id, nombre, createFile: (blob) => {
      const fid = 'ARCH' + (++nId), datos = blob.getBytes();
      drive.archivos[fid] = { getId: () => fid, nombre: blob.getName(), papelera: false, getBlob: () => ({ getBytes: () => datos }), setTrashed(v) { this.papelera = v; } };
      return drive.archivos[fid];
    } });
  };
  const bytes = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null, insertSheet: (n) => (hojas[n] = crearHoja(n)) }),
      getUi: () => ({
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' }, Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' },
        // solo las preguntas Sí/No consumen una respuesta; los avisos informativos no
        alert(t, m, b) { ui.alertas.push([t, m]); if (b !== 'YES_NO') return 'OK'; const r = ui.respuestas.shift(); return r === undefined ? 'OK' : r; },
        prompt(t, m) { ui.alertas.push([t, m]); const r = ui.respuestas.shift(); return { getSelectedButton: () => 'OK', getResponseText: () => r }; },
        createMenu: () => ({ addItem() { return this; }, addToUi() {} }),
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ contenido: t, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, txt) => bytes(crypto.createHash('sha256').update(txt, 'utf8').digest()),
      computeHmacSha256Signature: (txt, clave) => bytes(crypto.createHmac('sha256', clave).update(txt, 'utf8').digest()),
      base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64url'),
      base64DecodeWebSafe: (s) => bytes(Buffer.from(s, 'base64url')),
      newBlob: (arr, tipo, nombre) => ({ getDataAsString: () => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b))).toString('utf8'), getBytes: () => arr, getName: () => nombre }),
      base64Decode: (s) => bytes(Buffer.from(s, 'base64')),
      base64Encode: (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
    },
    // Drive en memoria (recibos de pago)
    DriveApp: {
      createFolder: (n) => carpeta(n), getFolderById: (id) => { if (!drive.carpetas[id]) throw new Error('no existe'); return drive.carpetas[id]; },
      getFileById: (id) => { const f = drive.archivos[id]; if (!f) throw new Error('no existe'); return f; },
    },
    UrlFetchApp: { fetch: (url, op) => { pedidos.push({ url, ...op, cuerpo: JSON.parse(op.payload) }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(respuestaOneSignal) }; } },
    ScriptApp: { getProjectTriggers: () => tareas.slice(), newTrigger: (fn) => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => tareas.push({ getHandlerFunction: () => fn }) }) }) }) }) },
  };
  // Apps Script real: asignar a `globalThis`/`this` desde dentro de un módulo no basta para crear los globales.
  // Este señuelo reproduce ese fallo: solo los `var` de nivel superior del archivo cuentan.
  sandbox.globalThis = {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(codigo, ctx, { filename: 'RRHH.gs' });
  const llamar = (cuerpo) => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify({ api_token: 'RRHH2026', ...cuerpo }) } }).contenido);
  const ejecutar = (fn) => vm.runInContext(fn + '()', ctx);
  return { ctx, hojas, props, ui, llamar, ejecutar, drive, pedidos, tareas, onesignalResponde: (r) => { respuestaOneSignal = r; } };
}

module.exports = { crearEntorno, crearHoja };
