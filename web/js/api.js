import { CONFIG } from '../config.js';

const CLAVE = 'rrhh:sesion';

export const sesion = {
  leer() { try { return JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); } catch { return null; } },
  guardar(s) { try { sessionStorage.setItem(CLAVE, JSON.stringify(s)); } catch { /* modo privado */ } },
  borrar() { try { sessionStorage.removeItem(CLAVE); } catch { /* modo privado */ } },
};

const MENSAJES = {
  NETWORK: 'No hay conexión. Revisa tu internet e intenta de nuevo.',
  TIMEOUT: 'El servidor tardó demasiado. Intenta de nuevo.',
  SERVER: 'El servidor respondió algo inesperado. Intenta de nuevo en unos segundos.',
  OCUPADO: 'El sistema está atendiendo a muchas personas en este momento. Intenta de nuevo en unos segundos.',
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Google atiende hasta 30 peticiones a la vez; si se pasa responde una página de error (no JSON).
 * Las consultas se reintentan solas con una pausa; las que guardan no, para no enviar nada dos veces.
 */
export async function llamar(action, datos = {}) {
  const reintentos = LECTURAS_SET().has(action) || action === 'login' ? 2 : 0;
  for (let i = 0; ; i++) {
    const r = await llamarUnaVez(action, datos);
    if (r.code !== 'OCUPADO' || i >= reintentos) return r;
    await espera(1500 * (i + 1) + Math.random() * 1500);
  }
}

/** POST de texto plano al Web App (evita el preflight CORS). Siempre resuelve { ok, data } o { ok:false, code, message }. */
async function llamarUnaVez(action, datos) {
  if (!LECTURAS_SET().has(action)) memoria.clear();
  const s = sesion.leer();
  const cuerpo = { action, api_token: CONFIG.API_TOKEN, ...(s && !('token' in datos) ? { token: s.token } : {}), ...datos };
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), CONFIG.TIMEOUT_MS);
  try {
    const r = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), signal: control.signal });
    let j;
    try { j = await r.json(); } catch { return { ok: false, code: 'OCUPADO', message: MENSAJES.OCUPADO }; }   // página de error de Google (saturado)
    if (!j || typeof j.ok !== 'boolean') return { ok: false, code: 'SERVER', message: MENSAJES.SERVER };
    if (!j.ok && j.code === 'SESION') sesion.borrar();
    return j;
  } catch (e) {
    return e.name === 'AbortError' ? { ok: false, code: 'TIMEOUT', message: MENSAJES.TIMEOUT } : { ok: false, code: 'NETWORK', message: MENSAJES.NETWORK };
  } finally {
    clearTimeout(reloj);
  }
}

/* ---------- Respuestas recientes en memoria ----------
 * Las consultas se guardan 1 minuto: al volver a una pantalla o al precargar no se espera otra vez al servidor.
 * Cualquier acción que cambia algo (solicitar, aprobar, cargar…) borra esta memoria.
 */
const LECTURAS = new Set(['estadoDeCuenta', 'datosAnticipo', 'listarAperturas', 'estadoAporte', 'prepararAporte', 'archivoAporte', 'candidatosCancelacion', 'listarCancelaciones', 'misConstancias', 'verificarConstancia', 'datosVacaciones', 'equipoVacaciones', 'bandejaAnticipos',
  'bandejaVacaciones', 'listarEmpleados', 'listarConstancias', 'listarUsuariosJefes', 'saldoVacacionesEmpleado']);
const memoria = new Map();
const VIGENCIA_MS = 60000;

export function olvidar() { memoria.clear(); }

/** Como `llamar`, pero reutiliza la respuesta (o la petición en curso) de los últimos 60 s. */
export function obtener(action, datos = {}) {
  const k = action + '|' + JSON.stringify(datos);
  const m = memoria.get(k);
  if (m && Date.now() - m.t < VIGENCIA_MS) return m.promesa;
  const promesa = llamar(action, datos).then((r) => { if (!r.ok) memoria.delete(k); return r; });
  memoria.set(k, { t: Date.now(), promesa });
  return promesa;
}

/** Pide algo en segundo plano para tenerlo listo cuando la persona lo abra. */
export function precargar(action, datos = {}) { obtener(action, datos).catch(() => {}); }

export { LECTURAS };
function LECTURAS_SET() { return LECTURAS; }
