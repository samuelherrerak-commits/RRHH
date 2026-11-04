// Notificaciones al celular con OneSignal. Solo se activa si config.js trae el App ID del sitio.
// La persona se identifica con un código (pushId) que entrega el servidor: no es su cédula.
import { CONFIG } from '../config.js';

const URL_SDK = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
// OneSignal registra el service worker como «sw.js?appId=…&sdkVersion=…». El CAC lo registra igual desde que se abre:
// así, al tocar «Activar», ya está activo (Safari en iPhone falla si se cambia justo al suscribirse).
const SDK_VERSION = '160700';
const urlSw = () => `sw.js?appId=${CONFIG.ONESIGNAL_APP_ID}&sdkVersion=${SDK_VERSION}`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let listo = null;

export const pushDisponible = () => !!CONFIG.ONESIGNAL_APP_ID && 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
export const esIphone = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function cargar() {
  if (listo) return listo;
  listo = new Promise((ok, no) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId: CONFIG.ONESIGNAL_APP_ID, serviceWorkerPath: 'sw.js', serviceWorkerParam: { scope: '/' },   // el mismo sw.js del sitio
          allowLocalhostAsSecureOrigin: true, notifyButton: { enable: false },
        });
        ok(OneSignal);
      } catch (e) { no(e); }
    });
    const sc = Object.assign(document.createElement('script'), { src: URL_SDK, defer: true, onerror: () => no(new Error('No se pudo cargar el servicio de notificaciones.')) });
    document.head.appendChild(sc);
  });
  listo.catch(() => { listo = null; });
  return listo;
}

/**
 * Registra el service worker del sitio (sw.js trae también lo de OneSignal). Con avisos al celular usa la misma
 * dirección que OneSignal; si no, la normal y solo si aún no hay uno. También deja OneSignal cargado para el botón.
 */
export async function registrarServiceWorker() {
  if (!pushDisponible()) {
    const ya = await navigator.serviceWorker.getRegistration('/');
    return ya || navigator.serviceWorker.register('sw.js');
  }
  const reg = await navigator.serviceWorker.register(urlSw(), { scope: '/' });
  cargar().catch(() => { /* sin avisos al celular */ });
  return reg;
}

/** Espera a que el service worker de OneSignal esté activo (hasta 15 s). */
async function swActivo() {
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg || !(reg.active && reg.active.scriptURL.includes('appId='))) reg = await navigator.serviceWorker.register(urlSw(), { scope: '/' });
  for (let i = 0; i < 30 && !(reg.active && reg.active.scriptURL.includes('appId=')); i++) await espera(500);
  if (!reg.active) throw new Error('el servicio de avisos del CAC no terminó de instalarse; cierra el CAC y ábrelo de nuevo');
  return reg;
}

/** Al entrar: asocia este dispositivo a la persona (si ya había activado los avisos aquí, los sigue recibiendo). */
export async function vincular(pushId) {
  if (!pushDisponible() || !pushId) return;
  try { const OS = await cargar(); await OS.login(pushId); } catch { /* sin avisos en este dispositivo */ }
}

/** Al salir: este dispositivo deja de recibir los avisos de esa persona. */
export async function desvincular() {
  if (!listo) return;
  try { const OS = await listo; await OS.logout(); } catch { /* nada */ }
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
 * Pide el permiso. Debe llamarse directo desde el toque del botón: el iPhone solo muestra la ventana de
 * «Permitir» si se pide en ese mismo instante, sin esperar antes a que cargue nada.
 * Después registra el dispositivo en OneSignal y espera a que OneSignal lo confirme.
 */
export function activarPush(pushId) {
  const pedido = Notification.requestPermission();
  return pedido.then(async () => {
    if (Notification.permission !== 'granted') return estadoPush();
    await swActivo();
    const OS = await cargar();
    if (pushId) await OS.login(pushId);
    if (!OS.User.PushSubscription.optedIn || !OS.User.PushSubscription.id) await OS.User.PushSubscription.optIn();
    for (let i = 0; i < 30 && !OS.User.PushSubscription.id; i++) await espera(500);
    if (!OS.User.PushSubscription.id) {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
      throw new Error(sub ? 'OneSignal no confirmó el registro de este dispositivo' : 'el teléfono no entregó la suscripción de avisos');
    }
    return estadoPush();
  });
}

/** ¿Este dispositivo quedó registrado en OneSignal? (el permiso puede estar dado y la suscripción no). */
export async function suscritoEnOneSignal() {
  try { const OS = await cargar(); return !!(OS.User.PushSubscription.optedIn && OS.User.PushSubscription.id); } catch { return false; }
}
