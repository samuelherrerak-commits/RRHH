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
};

/** POST de texto plano al Web App (evita el preflight CORS). Siempre resuelve { ok, data } o { ok:false, code, message }. */
export async function llamar(action, datos = {}) {
  const s = sesion.leer();
  const cuerpo = { action, api_token: CONFIG.API_TOKEN, ...(s && !('token' in datos) ? { token: s.token } : {}), ...datos };
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), CONFIG.TIMEOUT_MS);
  try {
    const r = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), signal: control.signal });
    const j = await r.json();
    if (!j || typeof j.ok !== 'boolean') return { ok: false, code: 'SERVER', message: MENSAJES.SERVER };
    if (!j.ok && j.code === 'SESION') sesion.borrar();
    return j;
  } catch (e) {
    return e.name === 'AbortError' ? { ok: false, code: 'TIMEOUT', message: MENSAJES.TIMEOUT } : { ok: false, code: 'NETWORK', message: MENSAJES.NETWORK };
  } finally {
    clearTimeout(reloj);
  }
}
