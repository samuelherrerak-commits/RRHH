const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../core/planificacion.js');

const FER = ['2027-01-01', '2027-12-24', '2027-12-25', '2027-12-31', '2028-01-01'];
const CICLO = { nombre: 'Vacaciones 2027', desde: '2027-01-01', hasta: '2028-01-31', abre: '2027-01-04', cierra: '2027-01-29' };

test('ciclo: fechas válidas y período de máximo 15 meses', () => {
  assert.equal(P.validarCiclo(CICLO).ok, true);
  assert.equal(P.validarCiclo({ ...CICLO, hasta: '2026-12-01' }).ok, false);
  assert.equal(P.validarCiclo({ ...CICLO, hasta: '2028-06-30' }).ok, false);
  assert.equal(P.validarCiclo({ ...CICLO, cierra: '2027-01-01' }).ok, false);
});

test('días requeridos: pendientes de hoy + el período que cumple dentro del año (desde su aniversario)', () => {
  // ingresó el 05/03/2020; hoy 10/01/2027 tiene 10 pendientes; el 05/03/2027 cumple 7 años → 21 días
  const r = P.requeridos(10, '2020-03-05', [], '2027-01-10', CICLO.desde, CICLO.hasta);
  assert.equal(r.total, 31);
  assert.deepEqual(r.nuevos, [{ periodo: '2026-2027', dias: 21, desde: '2027-03-05' }]);
  // ingresó en diciembre: su aniversario 2027 cae dentro y el de enero 2028 no (ingreso 15/02)
  assert.equal(P.requeridos(0, '2025-02-15', [], '2027-01-10', CICLO.desde, CICLO.hasta).total, 16);   // 2.º año: 16 días
});

test('plan: suma exacta, sin cruces, en días hábiles, dentro del período y sin adelantar días', () => {
  const req = P.requeridos(10, '2020-03-05', [], '2027-01-10', CICLO.desde, CICLO.hasta);   // 10 ya + 21 desde el 05/03
  const ok = P.validarPlan([{ inicio: '2027-08-02', dias: 21 }, { inicio: '2027-02-08', dias: 10 }], CICLO, req, FER, true);
  assert.equal(ok.ok, true, ok.errores.join(' '));
  assert.deepEqual(ok.bloques.map((b) => b.inicio), ['2027-02-08', '2027-08-02']);   // ordenados
  assert.equal(ok.bloques[0].culminacion, '2027-02-19');
  assert.equal(ok.bloques[0].reintegro, '2027-02-22');
  const corto = P.validarPlan([{ inicio: '2027-02-08', dias: 10 }], CICLO, req, FER, true);
  assert.match(corto.errores.join(' '), /Te faltan 21 días/);
  assert.equal(P.validarPlan([{ inicio: '2027-02-08', dias: 10 }], CICLO, req, FER, false).ok, true);   // borrador: se puede guardar incompleto
  assert.match(P.validarPlan([{ inicio: '2027-02-08', dias: 31 }], CICLO, req, FER, true).errores.join(' '), /solo tendrías 10 días/);   // adelanta días
  assert.match(P.validarPlan([{ inicio: '2027-02-06', dias: 10 }, { inicio: '2027-08-02', dias: 21 }], CICLO, req, FER, true).errores.join(' '), /día hábil/);
  assert.match(P.validarPlan([{ inicio: '2027-02-08', dias: 10 }, { inicio: '2027-02-15', dias: 21 }], CICLO, req, FER, true).errores.join(' '), /se cruza/);
  assert.match(P.validarPlan([{ inicio: '2028-01-24', dias: 31 }], CICLO, req, FER, true).errores.join(' '), /debe quedar entre/);
});

test('cumplimiento: planificado contra disfrutado, por mes y lo que quedó fuera del plan', () => {
  const plan = P.calcularBloques([{ inicio: '2027-02-08', dias: 10 }, { inicio: '2027-08-02', dias: 21 }], FER);
  const sols = [
    { estado: 'REGISTRADA', inicio: '2027-02-08', culminacion: '2027-02-12', dias: 5 },        // dentro del plan
    { estado: 'APROBADA_JEFE', inicio: '2027-04-05', culminacion: '2027-04-09', dias: 5 },     // fuera del plan
    { estado: 'RECHAZADA', inicio: '2027-02-15', culminacion: '2027-02-19', dias: 5 },         // no cuenta
  ];
  const c = P.cumplimiento(plan, sols, CICLO, FER, '2027-05-01');
  assert.equal(c.planificados, 31);
  assert.equal(c.aLaFecha, 10);          // a mayo solo debían haberse disfrutado los 10 de febrero
  assert.equal(c.disfrutados, 10);
  assert.equal(c.coinciden, 5);
  assert.equal(c.fueraDePlan, 5);
  assert.equal(c.porcentaje, 50);
  assert.deepEqual(c.porMes['2027-02'], { planificados: 10, disfrutados: 5 });
  assert.deepEqual(c.porMes['2027-04'], { planificados: 0, disfrutados: 5 });
  assert.equal(Object.keys(c.porMes).length, 13);
  assert.equal(P.enPlan(sols[0], plan, FER), true);
  assert.equal(P.enPlan(sols[1], plan, FER), false);
  assert.equal(P.cumplimiento(plan, [], CICLO, FER, '2027-01-15').porcentaje, null);   // aún no toca nada
});

const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

function escenario() {
  const repo = crearRepo([
    { cedula: 'V123456789', nombre: 'Ana Prosein', organizacion: 'SUCURSAL EL BOSQUE', departamento: 'Ventas', fechaInicio: '05/03/2020' },
    { cedula: 'V987654321', nombre: 'Luis Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', departamento: 'Logística', fechaInicio: '10/06/2018' },
    { cedula: 'V333333333', nombre: 'Carla Jefa', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', fechaInicio: '01/02/2015' },
  ]);
  const ctx = crearCtx(Date.UTC(2027, 0, 10, 16));   // hoy: 10/01/2027 en Caracas
  repo.st.feriados = ['2027-01-01'];
  repo.st.usuarios['11111111'] = { sal: 'x', hash: ctx.hash('clave', 'x'), rol: 'RRHH' };
  const rrhh = S.iniciarSesionAdmin(repo, ctx, '11111111', 'clave').data.token;
  S.asignarJefe(repo, ctx, rrhh, ['V12345678', 'V98765432'], 'V33333333');
  repo.st.vacPeriodos.push({ clave: 'V12345678', periodo: '2025-2026', correspondientes: 20, disfrutadosPrevios: 10 });   // Ana: 10 pendientes
  return { repo, ctx, rrhh, entrar: (c) => S.iniciarSesion(repo, ctx, c).data.token };
}

test('planificación: RRHH abre, el colaborador carga y envía, el jefe pide corregir y luego aprueba', () => {
  const { repo, ctx, rrhh, entrar } = escenario();
  const ana = entrar('12345678'), carla = entrar('33333333');
  assert.equal(S.miPlanificacion(repo, ctx, ana).data.ciclo, null);   // aún no hay
  const c = S.guardarPlanificacionVac(repo, ctx, rrhh, { nombre: 'Vacaciones 2027', desde: '2027-01-01', hasta: '2028-01-31', abre: '2027-01-04', cierra: '2027-01-29' });
  assert.equal(c.ok, true, c.message);
  assert.equal(c.data.abierta, true);
  assert.ok(S.misNotificaciones(repo, ctx, ana).data.items.some((n) => n.tipo === 'PLAN_VAC_ABIERTA'));   // aviso a todos
  assert.equal(S.guardarPlanificacionVac(repo, ctx, rrhh, { nombre: 'Otra', desde: '2027-06-01', hasta: '2027-12-31', abre: '2027-01-04', cierra: '2027-01-29' }).code, 'VALIDACION');   // se cruza

  const mia = S.miPlanificacion(repo, ctx, ana).data;
  assert.equal(mia.requeridos, 31);            // 10 pendientes + 21 del período que cumple el 05/03/2027
  assert.equal(mia.editable, true);
  // borrador incompleto: se guarda; enviarlo incompleto no
  assert.equal(S.guardarMiPlanificacion(repo, ctx, ana, { bloques: [{ inicio: '2027-01-25', dias: 10 }] }).data.estado, 'BORRADOR');
  assert.match(S.guardarMiPlanificacion(repo, ctx, ana, { bloques: [{ inicio: '2027-01-25', dias: 10 }], enviar: true }).message, /Te faltan 21/);
  const env = S.guardarMiPlanificacion(repo, ctx, ana, { bloques: [{ inicio: '2027-01-25', dias: 10 }, { inicio: '2027-08-02', dias: 21 }], enviar: true });
  assert.equal(env.data.estado, 'ENVIADA', env.message);
  assert.equal(S.guardarMiPlanificacion(repo, ctx, ana, { bloques: [] }).code, 'TRANSICION');   // ya está con el jefe
  assert.ok(S.misNotificaciones(repo, ctx, carla).data.items.some((n) => n.tipo === 'PLAN_VAC_POR_APROBAR'));

  // el jefe la ve y pide corregir; la colaboradora corrige y reenvía; el jefe aprueba
  const eq = S.equipoPlanificacion(repo, ctx, carla).data;
  assert.deepEqual(eq.equipo.map((x) => [x.nombre, x.estado]), [['Ana Prosein', 'ENVIADA'], ['Luis Austral', 'SIN_CARGAR']]);
  assert.equal(S.decidirPlanificacion(repo, ctx, carla, env.data.id, false, '').code, 'VALIDACION');
  assert.equal(S.decidirPlanificacion(repo, ctx, ana, env.data.id, true).code, 'NO_ENCONTRADO');   // no es su jefa
  assert.equal(S.decidirPlanificacion(repo, ctx, carla, env.data.id, false, 'Agosto es temporada alta').data.estado, 'RECHAZADA');
  assert.equal(S.miPlanificacion(repo, ctx, ana).data.plan.motivo, 'Agosto es temporada alta');
  assert.equal(S.guardarMiPlanificacion(repo, ctx, ana, { bloques: [{ inicio: '2027-01-25', dias: 10 }, { inicio: '2027-10-04', dias: 21 }], enviar: true }).data.estado, 'ENVIADA');
  assert.equal(S.decidirPlanificacion(repo, ctx, carla, env.data.id, true).data.estado, 'APROBADA');
  assert.ok(S.misNotificaciones(repo, ctx, ana).data.items.some((n) => n.tipo === 'PLAN_VAC_APROBADA'));
  assert.equal(S.miPlanificacion(repo, ctx, ana).data.editable, false);

  // solicitud dentro del plan (25/01) y RRHH: recordatorio a quien falta
  const sol = S.solicitarVacaciones(repo, ctx, ana, { inicio: '2027-01-25', dias: 5 });
  assert.equal(sol.ok, true, sol.message);
  assert.equal(sol.data.planificada, 'SI');
  assert.equal(S.recordarPlanificacionVac(repo, ctx, rrhh, c.data.id).data.avisados, 2);   // Luis y Carla
});

test('solicitud fuera de lo planificado y panel de cumplimiento de RRHH', () => {
  const { repo, ctx, rrhh, entrar } = escenario();
  const ana = entrar('12345678'), carla = entrar('33333333');
  const c = S.guardarPlanificacionVac(repo, ctx, rrhh, { nombre: 'Vacaciones 2027', desde: '2027-01-01', hasta: '2028-01-31', abre: '2027-01-04', cierra: '2027-01-29' }).data;
  const p = S.guardarMiPlanificacion(repo, ctx, ana, { bloques: [{ inicio: '2027-02-08', dias: 10 }, { inicio: '2027-08-02', dias: 21 }], enviar: true }).data;
  S.decidirPlanificacion(repo, ctx, carla, p.id, true);
  const sol = S.solicitarVacaciones(repo, ctx, ana, { inicio: '2027-01-25', dias: 5 }).data;   // no estaba planificado
  assert.equal(sol.planificada, 'NO');
  S.decidirVacacionesJefe(repo, ctx, carla, sol.id, true);
  const panel = S.panelPlanificacionVac(repo, ctx, rrhh, c.id).data;
  const fila = panel.filas.find((f) => f.nombre === 'Ana Prosein');
  assert.equal(fila.estado, 'APROBADA');
  assert.deepEqual([fila.empresa, fila.departamento, fila.localidad], ['PCA', 'Ventas', 'SUCURSAL EL BOSQUE']);
  assert.equal(fila.cumplimiento.planificados, 31);
  assert.equal(fila.cumplimiento.fueraDePlan, 5);
  assert.equal(panel.meses.length, 13);
  assert.equal(panel.filas.find((f) => f.nombre === 'Luis Austral').estado, 'SIN_CARGAR');
  assert.equal(S.panelPlanificacionVac(repo, ctx, ana, c.id).code, 'SESION');
});

test('panel de días pendientes: por período y con empresa, departamento y localidad', () => {
  const { repo, ctx, rrhh, entrar } = escenario();
  const r = S.panelSaldosVacaciones(repo, ctx, rrhh).data;
  const ana = r.filas.find((f) => f.nombre === 'Ana Prosein');
  assert.equal(ana.porPeriodo[0].periodo, '2025-2026');
  assert.equal(ana.porPeriodo[0].pendientes, 10);
  assert.equal(ana.localidad, 'SUCURSAL EL BOSQUE');
  const luis = r.filas.find((f) => f.nombre === 'Luis Austral');
  assert.equal(luis.empresa, 'AIV');
  assert.ok(r.periodos.includes('2025-2026'));
  assert.equal(S.panelSaldosVacaciones(repo, ctx, entrar('12345678')).code, 'SESION');
});
