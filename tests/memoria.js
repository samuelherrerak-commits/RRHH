// Base falsa en memoria con la misma interfaz que usa el servicio.
const crypto = require('node:crypto');
const E = require('../core/empleados.js');

function crearRepo(empleadosFilas) {
  const empleados = E.fusionarDetalle([], empleadosFilas).empleados;
  const st = { aportes: [], anticipos: {}, cierres: {}, usuarios: {}, fallos: {}, logs: [], seq: 0,
    parametros: { porcentajeAnticipoMax: 0.75 },
    empresas: { PCA: { fideicomiso: 5847, tipoTAporte: 1, tipoTAnticipo: 5, forma: 'A' }, AIV: { fideicomiso: 6000, tipoTAporte: 1, tipoTAnticipo: 5, forma: 'A' } } };
  const clave = (c) => c;
  return {
    st,
    parametros: () => st.parametros,
    empleadoPorClave: (c) => empleados.find((e) => E.claveCedula(e) === clave(c)) || null,
    aportesDe: (c) => st.aportes.filter((a) => a.clave === c).map((a) => {
      const ci = st.cierres[`${a.anio}-${a.trimestre}-${a.empresa}`];
      return { ...a, estadoCierre: ci ? ci.estado : 'ABIERTO' };
    }),
    anticiposDe: (c) => Object.values(st.anticipos).filter((a) => a.clave === c),
    anticipoPorId: (id) => st.anticipos[id] || null,
    anticiposPorEstado: (estado) => Object.values(st.anticipos).filter((a) => a.estado === estado),
    guardarAnticipo: (a) => { st.anticipos[a.id] = a; },
    cierre: (y, t, e) => st.cierres[`${y}-${t}-${e}`] || null,
    guardarCierre: (c) => { st.cierres[`${c.anio}-${c.trimestre}-${c.empresa}`] = c; },
    empresaConfig: (e) => st.empresas[e] || null,
    usuario: (c) => st.usuarios[c] || null,
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
