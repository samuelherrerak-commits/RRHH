// Servidor local de simulación: sirve web/ y responde la API con el mismo servicio, sobre datos de ejemplo en memoria.
// Uso: node dev/server.js   →  http://localhost:8080  (RRHH: #rrhh · cédula 11111111 · clave demo)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('../tests/memoria.js');

const repo = crearRepo([
  { cedula: 'V123456789', nombre: 'Esther Lilia Rodríguez Hernández', organizacion: 'PROSEIN', fechaInicio: '05/03/2025' },
  { cedula: 'V987654321', nombre: 'Luis Alfonso Pérez', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
]);
const ctx = crearCtx(Date.now()); ctx.ahora = () => Date.now();
repo.st.aportes.push({ clave: 'V12345678', anio: 2026, trimestre: 1, empresa: 'PCA', total: 2883.64 }, { clave: 'V12345678', anio: 2026, trimestre: 2, empresa: 'PCA', total: 3120.5 },
  { clave: 'V98765432', anio: 2026, trimestre: 2, empresa: 'AIV', total: 129896.7 });
repo.st.cierres['2026-1-PCA'] = { anio: 2026, trimestre: 1, empresa: 'PCA', estado: 'ACREDITADO' };
repo.st.cierres['2026-2-PCA'] = { anio: 2026, trimestre: 2, empresa: 'PCA', estado: 'CERRADO' };
repo.st.cierres['2026-2-AIV'] = { anio: 2026, trimestre: 2, empresa: 'AIV', estado: 'ACREDITADO' };
repo.st.usuarios['11111111'] = { sal: 's', hash: ctx.hash('demo', 's'), rol: 'RRHH' };

const RUTAS = {
  login: (d) => S.iniciarSesion(repo, ctx, d.cedula), estadoDeCuenta: (d) => S.miEstadoDeCuenta(repo, ctx, d.token),
  solicitarAnticipo: (d) => S.solicitarAnticipo(repo, ctx, d.token, d), cancelarAnticipo: (d) => S.cancelarAnticipo(repo, ctx, d.token, d.id),
  loginAdmin: (d) => S.iniciarSesionAdmin(repo, ctx, d.cedula, d.clave), bandejaAnticipos: (d) => S.bandejaAnticipos(repo, ctx, d.token, d.estado),
  decidirAnticipo: (d) => S.decidirAnticipo(repo, ctx, d.token, d.id, !!d.aprobar, d.motivoRechazo),
  archivoAnticipos: (d) => S.generarArchivoAnticipos(repo, ctx, d.token, d.empresa), pagarAnticipos: (d) => S.marcarAnticiposPagados(repo, ctx, d.token, d.ids || []),
  cargarEmpleados: (d) => S.cargarEmpleados(repo, ctx, d.token, d.filas), listarEmpleados: (d) => S.listarEmpleados(repo, ctx, d.token, d.buscar),
  fijarEmpresa: (d) => S.fijarEmpresaFideicomiso(repo, ctx, d.token, d.clave, d.empresa),
  estadoCierre: (d) => S.cambiarEstadoCierre(repo, ctx, d.token, +d.anio, +d.trimestre, d.empresa, d.estado),
};
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const WEB = path.join(__dirname, '..', 'web');

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let r; try { const d = JSON.parse(b); r = RUTAS[d.action] ? RUTAS[d.action](d) : { ok: false, code: 'ACCION', message: 'Acción desconocida.' }; } catch (e) { r = { ok: false, code: 'SERVER', message: 'Error' }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
    }); return;
  }
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end("export const CONFIG={API_URL:'/api',API_TOKEN:'x',TIMEOUT_MS:5000};"); }
  const f = path.join(WEB, path.normalize(p));
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('Content-Type', TIPOS[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 8080, () => console.log('http://localhost:' + (process.env.PORT || 8080)));
