// Notificaciones al celular con OneSignal. Solo se activa si config.js trae el App ID del sitio.
// El dispositivo se suscribe con la clave pública de la app de OneSignal y el servidor (Apps Script) lo registra en
// OneSignal con su clave secreta: así no depende de la librería de OneSignal en el teléfono (falla en Safari del iPhone).
// Los avisos los muestra el service worker de OneSignal, que va dentro de sw.js.
// La persona se identifica con un código (pushId) que entrega el servidor: no es su cédula.
import { CONFIG } from '../config.js';

// Misma dirección con la que OneSignal registra su service worker (lee el appId de ella).
const SDK_VERSION = '160700';
const urlSw = () => `sw.js?appId=${CONFIG.ONESIGNAL_APP_ID}&sdkVersion=${SDK_VERSION}`;
// { endpoint, pushId } del último registro hecho en este dispositivo («v2»: desde que se guarda el número de suscripción)
const REGISTRO = 'cac:push-v2';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export const pushDisponible = () => !!CONFIG.ONESIGNAL_APP_ID && 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
export const esIphone = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esFirefox = () => /firefox|fxios/i.test(navigator.userAgent);

function leerRegistro() { try { return JSON.parse(localStorage.getItem(REGISTRO) || 'null'); } catch { return null; } }
function guardarRegistro(r) { try { r ? localStorage.setItem(REGISTRO, JSON.stringify(r)) : localStorage.removeItem(REGISTRO); } catch { /* sin almacenamiento */ } }

/** Registra el service worker del sitio (sw.js trae también lo de OneSignal para mostrar los avisos). */
export async function registrarServiceWorker() {
  if (!pushDisponible()) {
    const ya = await navigator.serviceWorker.getRegistration('/');
    return ya || navigator.serviceWorker.register('sw.js');
  }
  return navigator.serviceWorker.register(urlSw(), { scope: '/' });
}

/** Espera a que el service worker esté activo (hasta 15 s). */
async function swActivo() {
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg || !(reg.active && reg.active.scriptURL.includes('appId='))) reg = await navigator.serviceWorker.register(urlSw(), { scope: '/' });
  for (let i = 0; i < 30 && !reg.active; i++) await espera(500);
  if (!reg.active) throw new Error('el servicio de avisos del CAC no terminó de instalarse; cierra el CAC y ábrelo de nuevo');
  return reg;
}

/** Clave pública de la app en OneSignal (la misma que usa su librería: Firefox usa la compartida de OneSignal). */
async function claveVapid() {
  const r = await fetch(`https://api.onesignal.com/sync/${CONFIG.ONESIGNAL_APP_ID}/web`);
  if (!r.ok) throw new Error('no se pudo consultar OneSignal (' + r.status + ')');
  const c = (await r.json()).config || {};
  const k = esFirefox() ? c.onesignal_vapid_public_key : c.vapid_public_key;
  if (!k) throw new Error('la app de OneSignal no tiene activadas las notificaciones web');
  const b = atob((k + '='.repeat((4 - (k.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (x) => x.charCodeAt(0));
}

/** Suscribe este dispositivo (si hace falta) y lo registra en OneSignal a nombre de la persona. */
async function suscribirYRegistrar(pushId, registrar) {
  const reg = await swActivo();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: await claveVapid() });
  const j = sub.toJSON();
  const previo = leerRegistro();
  if (previo && previo.endpoint === j.endpoint && previo.pushId === pushId) return;   // ya registrado
  const r = await registrar({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (!r.ok) throw new Error(r.message || 'OneSignal no registró el dispositivo');
  guardarRegistro({ endpoint: j.endpoint, pushId });
}

/** Al entrar: si este dispositivo ya tiene el permiso, lo deja registrado a nombre de la persona (sin preguntar). */
export async function vincular(pushId, registrar) {
  if (!pushDisponible() || !pushId || Notification.permission !== 'granted') return;
  try { await suscribirYRegistrar(pushId, registrar); } catch { /* se ofrecerá «Terminar de activar avisos» */ }
}

/** Al salir: este dispositivo deja de recibir los avisos de esa persona. */
export async function desvincular() {
  guardarRegistro(null);
  if (!pushDisponible()) return;
  try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch { /* nada */ }
}

/** 'activo' | 'bloqueado' | 'pendiente' | 'instalar' (iPhone sin instalar) | 'ios-viejo' | 'no' (no disponible). */
export function estadoPush() {
  if (!CONFIG.ONESIGNAL_APP_ID) return 'no';
  if (esIphone() && !instalada()) return 'instalar';
  if (esIphone() && !('PushManager' in window)) return 'ios-viejo';   // los avisos llegaron con iOS 16.4
  if (!pushDisponible()) return 'no';
  if (Notification.permission === 'granted') return 'activo';
  if (Notification.permission === 'denied') return 'bloqueado';
  return 'pendiente';
}

/**
 * Pide el permiso y registra el dispositivo. Debe llamarse directo desde el toque del botón: el iPhone solo
 * muestra la ventana de «Permitir» si se pide en ese mismo instante, sin esperar antes a que cargue nada.
 */
export function activarPush(pushId, registrar) {
  const pedido = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
  return pedido.then(async () => {
    if (Notification.permission !== 'granted') return estadoPush();
    guardarRegistro(null);   // registrar de nuevo aunque ya estuviera
    await suscribirYRegistrar(pushId, registrar);
    return estadoPush();
  });
}

/** ¿Este dispositivo quedó registrado en OneSignal a nombre de la persona? */
export async function suscritoEnOneSignal(pushId) {
  try {
    const r = leerRegistro(), reg = await navigator.serviceWorker.getRegistration('/'), sub = reg && await reg.pushManager.getSubscription();
    return !!(r && sub && r.endpoint === sub.endpoint && (!pushId || r.pushId === pushId));
  } catch { return false; }
}
