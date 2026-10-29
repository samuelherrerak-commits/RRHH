// Junta los módulos de core/ y apps-script/Code.gs en UN solo archivo para pegar en Apps Script.
// Uso: npm run build:gas   (genera apps-script/RRHH.gs)
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
// Cada módulo de core/ se convierte en una variable GLOBAL declarada con `var` en el archivo (así lo ve todo el código de
// Apps Script). No se usa `globalThis`/`this`, que en Apps Script no garantizan registrar el módulo donde se busca.
const MODULOS = [
  ['core/calculo.js', 'Calculo'], ['core/empleados.js', 'Empleados'], ['core/prestaciones.js', 'Prestaciones'],
  ['core/exportes.js', 'Exportes'], ['core/constancia.js', 'Constancia'], ['core/servicio.js', 'Servicio'],
];
const CODE = 'apps-script/Code.gs';

function envolver(codigo, nombre) {
  const mapa = MODULOS.map(([f, n]) => `'./${f.split('/')[1]}': ${n}`).join(', ');
  return [
    `var ${nombre} = (function () {`,
    '  var module = { exports: {} }, exports = module.exports;',
    `  var require = function (ruta) { return ({ ${mapa} })[ruta]; };`,
    codigo.trimEnd().replace(/^/gm, '  '),
    '  return module.exports;',
    '})();',
  ].join('\n');
}

function construir() {
  const cabecera = [
    '/* ============================================================',
    ' * RRHH Prosein / Austral · API de Apps Script (ARCHIVO GENERADO)',
    ' * No lo edites aquí: cambia los archivos de core/ o apps-script/Code.gs',
    ' * y ejecuta `npm run build:gas`.',
    ' *',
    ' * Cómo usarlo: en Apps Script borra todos los archivos del proyecto,',
    ' * deja uno solo y pega TODO este contenido.',
    ' * ============================================================ */',
    '',
  ].join('\n');
  const partes = MODULOS.map(([f, n]) => `// ===== ${f} =====\n` + envolver(fs.readFileSync(path.join(RAIZ, f), 'utf8'), n) + '\n');
  partes.push(`// ===== ${CODE} =====\n` + fs.readFileSync(path.join(RAIZ, CODE), 'utf8').trimEnd() + '\n');
  return cabecera + partes.join('\n');
}

if (require.main === module) {
  const destino = path.join(RAIZ, 'apps-script', 'RRHH.gs');
  fs.writeFileSync(destino, construir());
  console.log('Generado', path.relative(RAIZ, destino), `(${fs.statSync(destino).size} bytes)`);
}
module.exports = { construir };
