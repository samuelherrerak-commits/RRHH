// Junta los módulos de core/ y apps-script/Code.gs en UN solo archivo para pegar en Apps Script.
// Uso: npm run build:gas   (genera apps-script/RRHH.gs)
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ORDEN = ['core/calculo.js', 'core/empleados.js', 'core/prestaciones.js', 'core/exportes.js', 'core/constancia.js', 'core/servicio.js', 'apps-script/Code.gs'];

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
  const partes = ORDEN.map((f) => `// ===== ${f} =====\n` + fs.readFileSync(path.join(RAIZ, f), 'utf8').trimEnd() + '\n');
  return cabecera + partes.join('\n');
}

if (require.main === module) {
  const destino = path.join(RAIZ, 'apps-script', 'RRHH.gs');
  fs.writeFileSync(destino, construir());
  console.log('Generado', path.relative(RAIZ, destino), `(${fs.statSync(destino).size} bytes)`);
}
module.exports = { construir };
