// Base falsa en memoria con la misma interfaz que usa el servicio.
const crypto = require('node:crypto');
const E = require('../core/empleados.js');

function crearRepo(empleadosFilas) {
  let empleados = E.fusionarDetalle([], empleadosFilas).empleados;
  const st = { aportes: [], anticipos: {}, aperturas: {}, constancias: {}, vacPeriodos: [], vacSolicitudes: {}, cierres: {},
    feriados: ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-02', '2026-04-03', '2026-04-19', '2026-05-01', '2026-06-24', '2026-07-05', '2026-07-24', '2026-10-12', '2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'], usuarios: {}, fallos: {}, logs: [], seq: 0,
    parametros: { porcentajeAnticipoMax: 0.75 },
    empresas: { PCA: { fideicomiso: 5847, tipoTAporte: 1, tipoTAnticipo: 5, forma: 'A' }, AIV: { fideicomiso: 6000, tipoTAporte: 1, tipoTAnticipo: 5, forma: 'A' } } };
  const clave = (c) => c;
  return {
    st,
    parametros: () => st.parametros,
    feriados: () => st.feriados.slice(),
    vacPeriodosDe: (c) => st.vacPeriodos.filter((p) => p.clave === c).map((p) => ({ ...p })),
    vacClavesConPeriodos: () => [...new Set(st.vacPeriodos.map((p) => p.clave))],
    guardarVacPeriodos: (filas) => { st.vacPeriodos = filas.map((f) => ({ ...f })); },
    vacSolicitudesDe: (c) => Object.values(st.vacSolicitudes).filter((x) => x.clave === c).map((x) => ({ ...x })),
    vacSolicitudesPorJefe: (c) => Object.values(st.vacSolicitudes).filter((x) => x.jefe === c).map((x) => ({ ...x })),
    vacSolicitudesPorEstado: (e) => Object.values(st.vacSolicitudes).filter((x) => x.estado === e).map((x) => ({ ...x })),
    vacSolicitudPorId: (id) => (st.vacSolicitudes[id] ? { ...st.vacSolicitudes[id] } : null),
    guardarVacSolicitud: (x) => { st.vacSolicitudes[x.id] = { ...x }; },
    nuevoIdVac: () => 'VAC' + (++st.seq),
    constanciasDe: (c) => Object.values(st.constancias).filter((x) => x.clave === c).map((x) => ({ ...x })),
    constanciaPorId: (id) => st.constancias[id] || null,
    todasConstancias: () => Object.values(st.constancias).map((x) => ({ ...x })),
    guardarConstancia: (c) => { st.constancias[c.id] = c; },
    nuevoIdConstancia: () => ('CT' + (++st.seq) + 'ABCDEFGHJK').slice(0, 14),
    todosEmpleados: () => empleados.map((e) => ({ ...e })),
    guardarEmpleados: (lista) => { empleados = lista.map((e) => ({ ...e })); },
    empleadoPorClave: (c) => empleados.find((e) => E.claveCedula(e) === clave(c)) || null,
    aportesDe: (c) => st.aportes.filter((a) => a.clave === c).map((a) => {
      const ci = st.cierres[`${a.anio}-${a.trimestre}-${a.empresa}`];
      return { ...a, estadoCierre: ci ? ci.estado : 'ABIERTO' };
    }),
    anticiposDe: (c) => Object.values(st.anticipos).filter((a) => a.clave === c),
    anticipoPorId: (id) => st.anticipos[id] || null,
    todosAnticipos: () => Object.values(st.anticipos),
    aperturasAnticipo: () => Object.values(st.aperturas).map((c) => ({ ...c })),
    guardarAperturaAnticipo: (c) => { st.aperturas[c.id] = { ...c }; },
    eliminarAperturaAnticipo: (id) => { delete st.aperturas[id]; },
    nuevoIdApertura: () => 'AP' + (++st.seq),
    anticiposPorEstado: (estado) => Object.values(st.anticipos).filter((a) => a.estado === estado),
    guardarAnticipo: (a) => { st.anticipos[a.id] = a; },
    cierre: (y, t, e) => st.cierres[`${y}-${t}-${e}`] || null,
    guardarCierre: (c) => { st.cierres[`${c.anio}-${c.trimestre}-${c.empresa}`] = c; },
    empresaConfig: (e) => st.empresas[e] || null,
    usuario: (c) => st.usuarios[c] || null,
    todosUsuarios: () => Object.entries(st.usuarios).map(([cedula, u]) => ({ cedula, nombre: u.nombre || '', rol: u.rol })),
    fallos: (k) => st.fallos[k] || 0,
    registrarFallo: (k) => { st.fallos[k] = (st.fallos[k] || 0) + 1; },
    nuevoId: () => 'A' + (++st.seq),
    log: (accion, actor, detalle) => st.logs.push({ accion, actor, detalle }),
  };
}

function crearCtx(t0 = 1_700_000_000_000) {
  const reloj = { t: t0 };
  const sec = 'secreto-de-prueba';
  return {
    reloj,
    ahora: () => reloj.t,
    firmar: (s) => crypto.createHmac('sha256', sec).update(s).digest('hex'),
    base64: (s) => Buffer.from(s, 'utf8').toString('base64url'),
    desbase64: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    hash: (clave, sal) => crypto.createHash('sha256').update(sal + clave).digest('hex'),
  };
}

module.exports = { crearRepo, crearCtx };
