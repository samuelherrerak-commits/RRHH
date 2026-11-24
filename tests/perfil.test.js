const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../core/perfil.js');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

const COMPLETO = {
  contacto: { telefono: '+58 414 123 4567', correo: ' Ana@Correo.COM ', estado: 'Lara', ciudad: 'Barquisimeto', direccion: 'Av. Lara, casa 3' },
  emergencia: { nombre: 'Pedro Pérez', parentesco: 'Padre', telefono: '0251-2345678' },
  familia: [{ nombre: 'Luis Pérez', parentesco: 'Hijo(a)', fechaNacimiento: '2015-03-02', cedula: '' }],
  personales: { estadoCivil: 'Casado(a)', estudios: 'TSU', camisa: 'M', pantalon: '32', zapatos: '40' },
};

test('limpia y valida los campos: teléfono, correo, listas y cuenta', () => {
  const r = P.normalizar(COMPLETO);
  assert.deepEqual(r.errores, []);
  assert.equal(r.datos.contacto.telefono, '0414-1234567');
  assert.equal(r.datos.contacto.correo, 'ana@correo.com');
  assert.equal(r.datos.emergencia.telefono, '0251-2345678');
  const mal = P.normalizar({ contacto: { telefono: '123', correo: 'x@', estado: 'Narnia' }, personales: { cuenta: '0102' }, familia: [{ nombre: 'Sin datos' }] });
  assert.equal(mal.errores.length, 6, mal.errores.join('\n'));
  assert.ok(mal.errores.some((e) => /11 dígitos/.test(e)));
  assert.ok(mal.errores.some((e) => /20 dígitos/.test(e)));
  assert.ok(mal.errores.some((e) => /Familiar 1: falta parentesco/.test(e)));
  // las filas de familia vacías se descartan
  assert.deepEqual(P.normalizar({ familia: [{ nombre: '', parentesco: '' }] }).datos.familia, []);
});

test('secciones completas, faltantes y diferencias', () => {
  const d = P.normalizar(COMPLETO).datos;
  assert.deepEqual(P.faltantes(d), []);
  assert.deepEqual(P.faltantes({ contacto: d.contacto }), ['emergencia', 'familia', 'personales']);
  assert.deepEqual(P.faltantes({ sinFamilia: true }, ['familia']), []);
  const cambios = P.diferencias(d, { contacto: { ...d.contacto, ciudad: 'Cabudare' }, familia: [] });
  assert.deepEqual(cambios.map((c) => [c.nombre, c.antes, c.despues]), [['Contacto · Ciudad o municipio', 'Barquisimeto', 'Cabudare'], ['Carga familiar', 'Luis Pérez · Hijo(a) · 2015-03-02', '']]);
});

function escenario() {
  const repo = crearRepo([
    { cedula: 'V123456789', nombre: 'Ana Prosein', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2020', puesto: 'Asesor Comercial' },
    { cedula: 'V234567891', nombre: 'Beto Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2021' },
    { cedula: 'V345678901', nombre: 'Ya Egresado', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/02/2024', estado: 'Inactive' },
  ]);
  const ctx = crearCtx(Date.UTC(2026, 11, 1, 15));
  repo.st.usuarios['30580323'] = { sal: 'x', hash: ctx.hash('yo', 'x'), rol: 'RRHH', nombre: 'Samuel Herrera' };
  return { repo, ctx, rrhh: S.iniciarSesionAdmin(repo, ctx, '30580323', 'yo').data.token, entrar: (c) => S.iniciarSesion(repo, ctx, c).data.token };
}

test('el colaborador ve y guarda su perfil directo; queda el registro de lo que cambió', () => {
  const { repo, ctx, rrhh, entrar } = escenario();
  const ana = entrar('12345678');
  // sin campaña abierta no se puede editar
  assert.equal(S.guardarMiPerfil(repo, ctx, ana, { contacto: COMPLETO.contacto }).code, 'CERRADA');
  S.crearCampanaDatos(repo, ctx, rrhh, { titulo: 'Todo', secciones: ['contacto', 'emergencia', 'familia', 'personales'], hasta: '2026-12-20' });
  const v = S.miPerfil(repo, ctx, ana).data;
  assert.equal(v.nomina.nombre, 'Ana Prosein'); assert.equal(v.nomina.cargo, 'Asesor Comercial'); assert.equal(v.nomina.fechaIngreso, '2020-01-01');
  assert.deepEqual(v.faltan, ['contacto', 'emergencia', 'familia', 'personales']);
  assert.match(S.guardarMiPerfil(repo, ctx, ana, { contacto: { telefono: '12' } }).message, /11 dígitos/);
  const g = S.guardarMiPerfil(repo, ctx, ana, { contacto: COMPLETO.contacto });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.deepEqual(g.data.faltan, ['emergencia', 'familia', 'personales']);
  // guardar otra sección no borra la anterior
  S.guardarMiPerfil(repo, ctx, ana, { emergencia: COMPLETO.emergencia, sinFamilia: true });
  const v2 = S.miPerfil(repo, ctx, ana).data;
  assert.equal(v2.datos.contacto.ciudad, 'Barquisimeto');
  assert.deepEqual(v2.faltan, ['personales']);
  ctx.reloj.t += 60000;
  S.guardarMiPerfil(repo, ctx, ana, { contacto: { ...COMPLETO.contacto, ciudad: 'Cabudare' } });
  const p = S.datosPersonal(repo, ctx, rrhh).data;
  assert.equal(p.filas.length, 2);                                     // solo activos
  assert.equal(p.cambios[0].campo, 'Contacto · Ciudad o municipio');
  assert.equal(p.cambios[0].antes, 'Barquisimeto'); assert.equal(p.cambios[0].despues, 'Cabudare');
  assert.equal(S.datosPersonal(repo, ctx, ana).ok, false);              // un trabajador no ve los datos de todos
});

test('campaña de actualización: avisa a quienes les toca, se completa al guardar y RRHH recuerda a los pendientes', () => {
  const { repo, ctx, rrhh, entrar } = escenario();
  assert.match(S.crearCampanaDatos(repo, ctx, rrhh, { titulo: 'X', secciones: [], hasta: '2026-12-15' }).message, /sección/);
  assert.match(S.crearCampanaDatos(repo, ctx, rrhh, { titulo: 'X', secciones: ['contacto'], hasta: '2026-11-01' }).message, /fecha límite/);
  const c = S.crearCampanaDatos(repo, ctx, rrhh, { titulo: 'Actualización de diciembre', mensaje: 'Ayúdanos a tener tus datos al día.', secciones: ['contacto', 'familia'],
    alcance: { tipo: 'empresas', empresas: ['PCA'] }, hasta: '2026-12-15' });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.data.personas, 1);
  const aviso = repo.st.notificaciones.filter((n) => n.tipo === 'PERFIL_CAMPANA');
  assert.deepEqual(aviso.map((n) => [n.clave, n.ruta]), [['V12345678', 'perfil']]);
  const ana = entrar('12345678'), beto = entrar('23456789');
  assert.equal(S.miPerfil(repo, ctx, ana).data.campanas[0].titulo, 'Actualización de diciembre');
  assert.equal(S.miPerfil(repo, ctx, beto).data.campanas.length, 0);   // Austral no está en el alcance
  // una sección que no está en la campaña no se puede guardar
  assert.match(S.guardarMiPerfil(repo, ctx, ana, { personales: COMPLETO.personales }).message, /no está abierta/);
  // guarda solo contacto: sigue pendiente (falta la carga familiar)
  assert.deepEqual(S.guardarMiPerfil(repo, ctx, ana, { contacto: COMPLETO.contacto }).data.confirmadas, []);
  assert.equal(S.listarCampanasDatos(repo, ctx, rrhh).data[0].completos, 0);
  assert.equal(S.recordarCampanaDatos(repo, ctx, rrhh, c.data.id).data.avisados, 1);
  const g = S.guardarMiPerfil(repo, ctx, ana, { familia: COMPLETO.familia });
  assert.deepEqual(g.data.confirmadas, [c.data.id]);
  assert.equal(g.data.campanas.length, 0);
  const l = S.listarCampanasDatos(repo, ctx, rrhh).data[0];
  assert.equal(l.personas, 1); assert.equal(l.completos, 1);
  const panel = S.panelCampanaDatos(repo, ctx, rrhh, c.data.id).data;
  assert.equal(panel.filas[0].completo, true);
  assert.equal(S.recordarCampanaDatos(repo, ctx, rrhh, c.data.id).data.avisados, 0);
  assert.equal(S.cerrarCampanaDatos(repo, ctx, rrhh, c.data.id).data.estado, 'CERRADA');
  assert.match(S.recordarCampanaDatos(repo, ctx, rrhh, c.data.id).message, /cerrada/);
});

test('plan de 4 campañas: se cargan planificadas (sin aviso), se editan y se lanzan de una en una', () => {
  const { repo, ctx, rrhh, entrar } = escenario();
  assert.equal(S.cargarPlanCampanas(repo, ctx, rrhh).data.creadas, 4);
  assert.equal(S.cargarPlanCampanas(repo, ctx, rrhh).data.creadas, 0);              // no se duplican
  assert.equal(repo.st.notificaciones.length, 0);
  const lista = S.listarCampanasDatos(repo, ctx, rrhh).data;
  assert.deepEqual(lista.map((c) => [c.estado, c.secciones.join()]), [['PLANIFICADA', 'contacto'], ['PLANIFICADA', 'emergencia'], ['PLANIFICADA', 'familia'], ['PLANIFICADA', 'personales']]);
  const ana = entrar('12345678');
  assert.equal(S.miPerfil(repo, ctx, ana).data.campanas.length, 0);                // planificada: el colaborador no la ve
  assert.equal(S.editarCampanaDatos(repo, ctx, rrhh, lista[0].id, { ...lista[0], titulo: 'Tu contacto' }).data.titulo, 'Tu contacto');
  assert.match(S.lanzarCampanaDatos(repo, ctx, rrhh, lista[0].id, '').message, /fecha límite/);
  const l = S.lanzarCampanaDatos(repo, ctx, rrhh, lista[0].id, '2026-12-10');
  assert.equal(l.data.estado, 'ABIERTA'); assert.equal(l.data.personas, 2);
  assert.equal(repo.st.notificaciones.filter((n) => n.tipo === 'PERFIL_CAMPANA').length, 1);
  assert.deepEqual(S.miPerfil(repo, ctx, ana).data.campanas.map((c) => c.titulo), ['Tu contacto']);
  assert.match(S.editarCampanaDatos(repo, ctx, rrhh, lista[0].id, lista[0]).message, /ya fue lanzada/);
  assert.match(S.eliminarCampanaDatos(repo, ctx, rrhh, lista[0].id).message, /no se han lanzado/);
  assert.equal(S.eliminarCampanaDatos(repo, ctx, rrhh, lista[3].id).ok, true);
  assert.deepEqual(S.listarCampanasDatos(repo, ctx, rrhh).data.map((c) => c.estado), ['PLANIFICADA', 'PLANIFICADA', 'ABIERTA']);
  assert.equal(S.crearCampanaDatos(repo, ctx, rrhh, { titulo: 'Para después', secciones: ['contacto'], planificada: true }).data.estado, 'PLANIFICADA');
});
