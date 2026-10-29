// Servidor local de simulación: sirve web/ y responde la API con el mismo servicio, sobre datos de ejemplo en memoria.
// Uso: node dev/server.js   →  http://localhost:8080
// Trabajador: cédula 12345678. RRHH: cédula 98765432 (también empleado) u 11111111, clave demo; el sitio pide la clave solo a esas cédulas.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('../tests/memoria.js');

const repo = crearRepo([
  { cedula: 'V123456789', nombre: 'Esther Lilia Rodríguez Hernández', organizacion: 'PROSEIN CENTRAL', puesto: 'Asistente Administrativo', fechaInicio: '05/03/2025', salarioMensual: 12583.17 },
  { cedula: 'V987654321', nombre: 'Luis Alfonso Pérez', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', puesto: 'Gerente de División de Gestión Humana', fechaInicio: '15/09/2022', salarioMensual: 5500 },
]);
const ctx = crearCtx(Date.now()); ctx.ahora = () => Date.now();
repo.st.aportes.push({ clave: 'V12345678', anio: 2026, trimestre: 1, empresa: 'PCA', total: 2883.64 }, { clave: 'V12345678', anio: 2026, trimestre: 2, empresa: 'PCA', total: 3120.5 },
  { clave: 'V98765432', anio: 2026, trimestre: 2, empresa: 'AIV', total: 129896.7 });
repo.st.cierres['2026-1-PCA'] = { anio: 2026, trimestre: 1, empresa: 'PCA', estado: 'ACREDITADO' };
repo.st.cierres['2026-2-PCA'] = { anio: 2026, trimestre: 2, empresa: 'PCA', estado: 'CERRADO' };
repo.st.cierres['2026-2-AIV'] = { anio: 2026, trimestre: 2, empresa: 'AIV', estado: 'ACREDITADO' };
// Constancia de ejemplo emitida hace 40 días (vencida): http://localhost:8080/#v=DEMOVENCIDA00001
{ const hace40 = Date.now() - 40 * 86400000;
  repo.st.constancias.DEMOVENCIDA00001 = { id: 'DEMOVENCIDA00001', clave: 'V12345678', nombre: 'Esther Lilia Rodríguez Hernández', cedula: 'V-12345678', empresa: 'PCA',
    cargo: 'Asistente Administrativo', organizacion: 'PROSEIN CENTRAL', fechaIngreso: '05/03/2025', salario: 12583.17, emision: hace40,
    vence: require('../core/constancia.js').vencimiento(hace40), estado: 'VIGENTE', emitidaPor: 'V12345678' }; }
repo.st.usuarios['11111111'] = { sal: 's', hash: ctx.hash('demo', 's'), rol: 'RRHH' };   // RRHH que no es empleado
repo.st.usuarios['98765432'] = { sal: 's', hash: ctx.hash('demo', 's'), rol: 'RRHH' };   // RRHH que además es empleado (Luis)

const RUTAS = {
  login: (d) => S.iniciarSesion(repo, ctx, d.cedula), estadoDeCuenta: (d) => S.miEstadoDeCuenta(repo, ctx, d.token),
  solicitarAnticipo: (d) => S.solicitarAnticipo(repo, ctx, d.token, d), cancelarAnticipo: (d) => S.cancelarAnticipo(repo, ctx, d.token, d.id),
  loginAdmin: (d) => S.iniciarSesionAdmin(repo, ctx, d.cedula, d.clave), bandejaAnticipos: (d) => S.bandejaAnticipos(repo, ctx, d.token, d.estado),
  decidirAnticipo: (d) => S.decidirAnticipo(repo, ctx, d.token, d.id, !!d.aprobar, d.motivoRechazo),
  archivoAnticipos: (d) => S.generarArchivoAnticipos(repo, ctx, d.token, d.empresa), pagarAnticipos: (d) => S.marcarAnticiposPagados(repo, ctx, d.token, d.ids || []),
  emitirConstancia: (d) => S.emitirConstancia(repo, ctx, d.token), misConstancias: (d) => S.misConstancias(repo, ctx, d.token), verificarConstancia: (d) => S.verificarConstancia(repo, ctx, d.id),
  listarConstancias: (d) => S.listarConstancias(repo, ctx, d.token), anularConstancia: (d) => S.anularConstancia(repo, ctx, d.token, d.id),
  cargarEmpleados: (d) => S.cargarEmpleados(repo, ctx, d.token, d.filas), listarEmpleados: (d) => S.listarEmpleados(repo, ctx, d.token, { buscar: d.buscar, departamento: d.departamento, sinJefe: !!d.sinJefe }),
  asignarJefe: (d) => S.asignarJefe(repo, ctx, d.token, d.claves, d.jefe), asignarJefeDepartamento: (d) => S.asignarJefeDepartamento(repo, ctx, d.token, d.departamento, d.jefe),
  fijarEmpresa: (d) => S.fijarEmpresaFideicomiso(repo, ctx, d.token, d.clave, d.empresa),
  estadoCierre: (d) => S.cambiarEstadoCierre(repo, ctx, d.token, +d.anio, +d.trimestre, d.empresa, d.estado),
};
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const WEB = path.join(__dirname, '..', 'web');

// Modo --gas: la API es el archivo REAL apps-script/RRHH.gs ejecutándose sobre hojas simuladas (como en Google).
// Samuel (30580323) y Luis Paul (7952013) tienen la clave «clave-demo-123».
const MODO_GAS = process.argv.includes('--gas');
let gas = null;
if (MODO_GAS) {
  const { crearEntorno } = require('./gas-simulado.js');
  gas = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-demo-123', '7952013', 'YES', 'clave-demo-123'] });
  gas.ejecutar('configurarInicial'); gas.ejecutar('ponerClaveRRHH'); gas.ejecutar('ponerClaveRRHH');
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let r; try { const d = JSON.parse(b); r = gas ? gas.llamar(d) : RUTAS[d.action] ? RUTAS[d.action](d) : { ok: false, code: 'ACCION', message: 'Acción desconocida.' }; } catch (e) { r = { ok: false, code: 'SERVER', message: 'Error' }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
    }); return;
  }
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`export const CONFIG={API_URL:'/api',API_TOKEN:'${MODO_GAS ? 'RRHH2026' : 'x'}',TIMEOUT_MS:5000};`); }
  const f = path.join(WEB, path.normalize(p));
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('Content-Type', TIPOS[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 8080, () => console.log('http://localhost:' + (process.env.PORT || 8080) + (MODO_GAS ? '  (API = apps-script/RRHH.gs sobre hojas simuladas)' : '')));
