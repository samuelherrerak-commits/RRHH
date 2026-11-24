const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../core/recibos.js');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

// Texto de una hoja como lo entrega el lector de PDF (formato de la nómina de Prosein, datos inventados).
const hoja = (cedula, nombre) => `GRUPO PROSEIN Detalle de Nómina Fecha: 26/10/2026 Nómina: Nómina Quincenal - NQ-155 (16/10/2026 - 31/10/2026)
  Nombre y Apellido Departamento ${nombre} Comercialización Cédula F. Ingreso F. Egreso S. Diario S. Mensual Cargo ${cedula} 01/04/2025 1.900,00 57.000,00 Asistente
  Concepto Referencia Asignaciones Deducciones Salario Base Días: 11.00 20.900,00 Total Asignaciones y Deducciones 28.500,00 -403,95
  Total a Pagar ${nombre} 28.096,05 Recibí Conforme (03/11/2026 6:44`;

const filas = [
  { cedula: 'V123456789', nombre: 'Esther Rodríguez', organizacion: 'PROSEIN', puesto: 'Asistente', fechaInicio: '05/03/2025', salarioMensual: 5000 },
  { cedula: 'V987654321', nombre: 'Luis Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
  { cedula: 'V5555555', nombre: 'Ana María Pérez', organizacion: 'PROSEIN', fechaInicio: '01/01/2019' },
];
function escenario() {
  const repo = crearRepo(filas), ctx = crearCtx();
  repo.st.usuarios['11111111'] = { sal: 'x', hash: ctx.hash('clave-rrhh', 'x'), rol: 'RRHH' };
  return { repo, ctx, rrhh: S.iniciarSesionAdmin(repo, ctx, '11111111', 'clave-rrhh').data.token };
}
const entrar = (repo, ctx, c) => S.iniciarSesion(repo, ctx, c).data.token;

test('lee cédula, nombre y concepto de la hoja', () => {
  const t = hoja('V028180545', 'AARON KOENIG');
  assert.equal(R.cedulaDeTexto(t), 'V028180545');
  assert.equal(R.nombreDeTexto(t), 'AARON KOENIG');
  assert.equal(R.conceptoSugerido(t), 'Nómina 2Q octubre 2026');
  assert.equal(R.conceptoSugerido('Nómina: Cesta Ticket (01/12/2026 - 15/12/2026)'), 'Cestaticket 1Q diciembre 2026');
  assert.equal(R.conceptoSugerido('Nómina: Nómina Mensual (01/11/2026 - 30/11/2026)'), 'Nómina noviembre 2026');
  assert.equal(R.cedulaDeTexto('sin datos'), '');
});

test('asigna por cédula (con verificador o sin él), luego por nombre exacto, y marca repetidas', () => {
  const { repo, ctx, rrhh } = escenario();
  const r = S.asignarRecibos(repo, ctx, rrhh, [
    { pagina: 1, cedula: 'V123456789', nombre: 'ESTHER RODRIGUEZ' },
    { pagina: 2, cedula: 'V98765432', nombre: 'LUIS AUSTRAL' },
    { pagina: 3, cedula: 'V77777777', nombre: 'ANA MARIA PEREZ' },     // cédula distinta: por nombre
    { pagina: 4, cedula: 'V88888888', nombre: 'NADIE CONOCIDO' },
    { pagina: 5, cedula: 'V12345678', nombre: 'ESTHER RODRIGUEZ' },     // repetida
  ]).data;
  assert.deepEqual(r.hojas.map((h) => [h.clave, h.como]), [['V12345678', 'cedula'], ['V98765432', 'cedula'], ['V5555555', 'nombre'], ['', ''], ['V12345678', 'cedula']]);
  assert.equal(r.hojas[4].repetida, true);
  assert.equal(r.empleados.length, 3);
  assert.equal(S.asignarRecibos(repo, ctx, entrar(repo, ctx, '12345678'), [{ pagina: 1 }]).code, 'SESION');   // solo RRHH
});

test('flujo del recibo: borrador → publicar (aviso) → el colaborador lo abre (visto) → «Recibí conforme»', () => {
  const { repo, ctx, rrhh } = escenario();
  const lote = S.crearLoteRecibos(repo, ctx, rrhh, { concepto: '  Nómina 2Q   octubre 2026 ', empresa: 'PCA', total: 2 }).data;
  assert.equal(lote.concepto, 'Nómina 2Q octubre 2026');
  assert.equal(S.crearLoteRecibos(repo, ctx, rrhh, { concepto: '' }).code, 'VALIDACION');
  const items = [{ pagina: 1, clave: 'V12345678', pdf: 'UERGLWVzdGhlcg==' }, { pagina: 2, clave: 'V98765432', pdf: 'UERGLWx1aXM=' }];
  assert.equal(S.subirRecibos(repo, ctx, rrhh, { lote: lote.id, items: items.slice(0, 1) }).data.cargados, 1);
  assert.equal(S.subirRecibos(repo, ctx, rrhh, { lote: lote.id, items }).data.guardados, 1);   // reintento: no duplica la hoja 1
  assert.equal(S.subirRecibos(repo, ctx, rrhh, { lote: lote.id, items: [{ pagina: 9, clave: 'V00000001', pdf: 'x' }] }).code, 'VALIDACION');

  const esther = entrar(repo, ctx, '12345678'), luis = entrar(repo, ctx, '98765432');
  assert.deepEqual(S.misRecibos(repo, ctx, esther).data, []);                 // en borrador no se ve
  const pub = S.publicarLote(repo, ctx, rrhh, lote.id).data;
  assert.equal(pub.estado, 'PUBLICADO');
  assert.equal(S.publicarLote(repo, ctx, rrhh, lote.id).code, 'TRANSICION');
  assert.equal(S.subirRecibos(repo, ctx, rrhh, { lote: lote.id, items }).code, 'TRANSICION');

  // aviso en la campanita y al celular (con identificador que no es la cédula)
  const n = S.misNotificaciones(repo, ctx, esther).data;
  assert.equal(n.noLeidas, 1);
  assert.equal(n.items[0].titulo, 'Tienes un recibo de pago nuevo');
  assert.equal(n.items[0].ruta, 'recibos');
  const push = repo.st.pushes.at(-1);
  assert.equal(push.destinos.length, 2);
  assert.ok(push.destinos.every((d) => /^[0-9a-f]{32}$/.test(d) && !d.includes('12345678')));
  assert.equal(push.destinos[0], S.iniciarSesion(repo, ctx, '12345678').data.pushId);

  const mio = S.misRecibos(repo, ctx, esther).data;
  assert.equal(mio.length, 1);
  assert.equal(mio[0].visto, 0);
  assert.equal(S.verRecibo(repo, ctx, luis, mio[0].id).code, 'NO_ENCONTRADO');   // nadie ve el recibo de otro
  const visto = S.verRecibo(repo, ctx, esther, mio[0].id).data;
  assert.equal(visto.pdf, 'UERGLWVzdGhlcg==');
  assert.equal(visto.archivo, 'Recibo Nómina 2Q octubre 2026.pdf');
  ctx.reloj.t += 60000;
  const conf = S.confirmarRecibo(repo, ctx, esther, mio[0].id).data;
  assert.ok(conf.conforme > conf.visto);
  assert.equal(S.confirmarRecibo(repo, ctx, esther, mio[0].id).data.conforme, conf.conforme);   // no cambia la fecha

  // RRHH: resumen y detalle por persona
  const l = S.listarLotes(repo, ctx, rrhh).data[0];
  assert.deepEqual([l.cargados, l.vistos, l.conformes], [2, 1, 1]);
  const det = S.detalleLote(repo, ctx, rrhh, lote.id).data.recibos;
  assert.deepEqual(det.map((r) => [r.nombre, !!r.visto, !!r.conforme]), [['Esther Rodríguez', true, true], ['Luis Austral', false, false]]);
  assert.equal(S.verReciboRRHH(repo, ctx, rrhh, det[1].id).data.pdf, 'UERGLWx1aXM=');
  assert.equal(S.detalleLote(repo, ctx, rrhh, lote.id).data.recibos[1].visto, 0);     // RRHH no lo marca como visto
  assert.equal(S.eliminarLote(repo, ctx, rrhh, lote.id).code, 'VALIDACION');          // ya hay un «Recibí conforme»
});

test('se puede eliminar una carga sin confirmaciones (también sus archivos)', () => {
  const { repo, ctx, rrhh } = escenario();
  const lote = S.crearLoteRecibos(repo, ctx, rrhh, { concepto: 'Prueba', empresa: 'PCA' }).data;
  S.subirRecibos(repo, ctx, rrhh, { lote: lote.id, items: [{ pagina: 1, clave: 'V12345678', pdf: 'eA==' }] });
  assert.equal(S.eliminarLote(repo, ctx, rrhh, lote.id).ok, true);
  assert.equal(Object.keys(repo.st.archivos).length, 0);
  assert.deepEqual(S.listarLotes(repo, ctx, rrhh).data, []);
});

test('campanita: marcar leídas, aviso a todos al abrir anticipos y constancia vencida', () => {
  const { repo, ctx, rrhh } = escenario();
  const esther = entrar(repo, ctx, '12345678');
  S.guardarApertura(repo, ctx, rrhh, { clave: '2023-T4', inicio: '2023-11-14', fin: '2023-11-30' });   // hoy (reloj de prueba) = 14/11/2023
  let n = S.misNotificaciones(repo, ctx, esther).data;
  assert.equal(n.items[0].tipo, 'ANTICIPO_APERTURA');
  assert.equal(n.items[0].titulo, 'Ya puedes solicitar tu anticipo de fideicomiso');
  assert.equal(repo.st.pushes.at(-1).destinos, '*');
  assert.equal(S.misNotificaciones(repo, ctx, rrhh).data.items.length, 1);   // RRHH también lo ve
  S.marcarNotificacionesLeidas(repo, ctx, esther);
  ctx.reloj.t += 1000;
  n = S.misNotificaciones(repo, ctx, esther).data;
  assert.equal(n.noLeidas, 0);
  assert.equal(n.items[0].nueva, false);

  // constancia: al vencer aparece el aviso (sin guardarlo) y la tarea diaria avisa al celular una sola vez
  assert.equal(S.emitirConstancia(repo, ctx, esther).ok, true);
  const antes = ctx.reloj.t;
  ctx.reloj.t += 31 * 86400000;
  n = S.misNotificaciones(repo, ctx, entrar(repo, ctx, '12345678')).data;   // la sesión dura 8 h: entra de nuevo
  assert.equal(n.items[0].tipo, 'CONSTANCIA_VENCIDA');
  assert.equal(n.noLeidas, 1);
  const pushes = repo.st.pushes.length;
  assert.equal(S.avisosDiarios(repo, ctx, antes).data.avisadas, 1);
  assert.equal(repo.st.pushes.length, pushes + 1);
  assert.equal(S.avisosDiarios(repo, ctx, ctx.reloj.t).data.avisadas, 0);
});

test('avisos del anticipo: rechazo del banco y pago', () => {
  const { repo, ctx, rrhh } = escenario();
  repo.st.anticipos.A1 = { id: 'A1', clave: 'V12345678', monto: 10, estado: 'EN_ARCHIVO', creada: 1 };
  repo.st.anticipos.A2 = { id: 'A2', clave: 'V98765432', monto: 10, estado: 'EN_ARCHIVO', creada: 1 };
  S.rechazarAnticipoBanco(repo, ctx, rrhh, 'A1', 'Monto mayor al disponible');
  S.marcarAnticiposPagados(repo, ctx, rrhh, ['A2']);
  assert.equal(S.misNotificaciones(repo, ctx, entrar(repo, ctx, '12345678')).data.items[0].texto, 'Monto mayor al disponible');
  assert.equal(S.misNotificaciones(repo, ctx, entrar(repo, ctx, '98765432')).data.items[0].tipo, 'ANTICIPO_PAGADO');
});
