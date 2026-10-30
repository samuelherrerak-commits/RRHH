// Sugerencia «Instalar SADS»: Chrome/Edge (Android y computadora) muestran su instalador; en iPhone/iPad
// se explican los pasos de Safari (Apple no permite el botón). Si la persona dice «Ahora no», vuelve en 30 días.
const CLAVE = 'sads:instalar-pospuesto';
const DIAS = 30;
let evento = null;            // beforeinstallprompt guardado para usarlo cuando la persona toque «Instalar»
let alAparecer = null;

const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esSafari = () => /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|chrome|android/i.test(navigator.userAgent);
function pospuesta() { try { return Number(localStorage.getItem(CLAVE) || 0) > Date.now(); } catch { return false; } }
function posponer() { try { localStorage.setItem(CLAVE, String(Date.now() + DIAS * 86400000)); } catch { /* sin almacenamiento */ } }

export function iniciarInstalacion() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evento = e; if (alAparecer) alAparecer(); });
  window.addEventListener('appinstalled', () => { evento = null; quitar(); });
}

function quitar() { document.getElementById('sugerir-instalar')?.remove(); }

const LOGO = '<img src="assets/favicon.svg" alt="" width="44" height="44">';
const COMPARTIR = '<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Compartir"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5"/></svg>';

/** Muestra la sugerencia si corresponde (después de entrar). Se puede llamar varias veces. */
export function sugerirInstalacion() {
  if (instalada() || pospuesta() || document.getElementById('sugerir-instalar')) return;
  const pintar = (html, alInstalar) => {
    quitar();
    const caja = document.createElement('aside');
    caja.id = 'sugerir-instalar'; caja.className = 'sugerir-instalar'; caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-label', 'Instalar SADS');
    caja.innerHTML = `${LOGO}<div class="si-texto">${html}</div>
      <div class="si-botones">${alInstalar ? '<button class="btn btn-chico" id="si-instalar">Instalar</button>' : ''}<button class="btn btn-sec btn-chico" id="si-no">${alInstalar ? 'Ahora no' : 'Entendido'}</button></div>`;
    document.body.appendChild(caja);
    caja.querySelector('#si-no').addEventListener('click', () => { posponer(); quitar(); });
    caja.querySelector('#si-instalar')?.addEventListener('click', alInstalar);
  };
  if (evento) {
    const movil = matchMedia('(pointer: coarse)').matches;
    pintar(`<b>Instala SADS</b><span>${movil ? 'Tenlo en tu pantalla de inicio y ábrelo con un toque, como una app.' : 'Ábrelo desde tu escritorio o barra de tareas, como un programa.'}</span>`, async () => {
      const e = evento; evento = null;
      e.prompt();
      const r = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
      if (r.outcome !== 'accepted') posponer();
      quitar();
    });
  } else if (esIOS() && esSafari()) {
    pintar(`<b>Agrega SADS a tu pantalla de inicio</b><span>Toca ${COMPARTIR} <b>Compartir</b> abajo y luego <b>«Agregar a pantalla de inicio»</b>.</span>`, null);
  } else {
    alAparecer = () => { alAparecer = null; sugerirInstalacion(); };   // Chrome avisa un poco después de cargar
  }
}
