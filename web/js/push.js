// Notificaciones al celular con OneSignal. Solo se activa si config.js trae el App ID del sitio.
// La persona se identifica con un código (pushId) que entrega el servidor: no es su cédula.
import { CONFIG } from '../config.js';

const URL_SDK = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
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
 * Registra el service worker del sitio. Con avisos al celular lo registra OneSignal (sw.js?appId=…): si lo hiciera
 * también el sitio con otra dirección, se reemplazarían en cada visita. Si OneSignal no carga, lo registra el sitio.
 */
export function registrarServiceWorker() {
  if (!pushDisponible()) return navigator.serviceWorker.register('sw.js');
  return cargar().catch(() => navigator.serviceWorker.register('sw.js'));
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

/** 'activo' | 'bloqueado' | 'pendiente' | 'instalar' (iPhone sin instalar) | 'no' (no disponible). */
export function estadoPush() {
  if (!CONFIG.ONESIGNAL_APP_ID) return 'no';
  if (esIphone() && !instalada()) return 'instalar';
  if (!pushDisponible()) return 'no';
  if (Notification.permission === 'granted') return 'activo';
  if (Notification.permission === 'denied') return 'bloqueado';
  return 'pendiente';
}

/**
 * Pide el permiso. Debe llamarse directo desde el toque del botón: el iPhone solo muestra la ventana de
 * «Permitir» si se pide en ese mismo instante, sin esperar antes a que cargue nada.
 */
export function activarPush(pushId) {
  const pedido = Notification.requestPermission();
  return pedido.then(async () => {
    if (Notification.permission !== 'granted') return estadoPush();
    const OS = await cargar();
    if (pushId) await OS.login(pushId);
    try { await OS.User.PushSubscription.optIn(); } catch { /* ya estaba */ }
    return estadoPush();
  });
}
