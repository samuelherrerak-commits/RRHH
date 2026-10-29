import { llamar, sesion } from './api.js';
import { bs, esc, chip, fechaHora, leerMonto, fechaCaracas, chipConstancia } from './formato.js';
import { descargarConstanciaPdf, descargarConstanciaVacacionesPdf } from './constancia-pdf.js';

const URL_BASE = location.origin + location.pathname;

const app = document.getElementById('app');
const btnSalir = document.getElementById('btn-salir');
const dlg = document.getElementById('dlg');
const toastEl = document.getElementById('toast');
let toastReloj;

function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastReloj); toastReloj = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

/** Deshabilita el botón mientras corre la llamada; evita doble envío. */
async function conBoton(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

function errorEn(caja, msg) { caja.textContent = msg; caja.hidden = !msg; }

/* ---------- Arranque y rutas ---------- */

async function arrancar() {
  const verificar = /^#v=([A-Za-z0-9]+)/.exec(location.hash);   // enlace del QR: página pública, sin entrar
  if (verificar) return vistaVerificar(verificar[1]);
  const s = sesion.leer();
  btnSalir.hidden = !s;
  if (s && s.rol !== 'TRABAJADOR') return vistaRRHH();
  if (s) return vistaCuenta(app, '', seccionDesdeHash());
  return vistaLogin();
}
btnSalir.addEventListener('click', () => { sesion.borrar(); history.replaceState(null, '', location.pathname); arrancar(); });
window.addEventListener('hashchange', () => arrancar());

/* ---------- Trabajador: entrada ---------- */

function vistaLogin() {
  app.innerHTML = `
    <form class="tarjeta login" id="f" novalidate>
      <div><h2>Bienvenido</h2><p class="suave">Escribe tu cédula para ver tu estado de cuenta de prestaciones y hacer solicitudes.</p></div>
      <label>Cédula <input name="cedula" inputmode="numeric" autocomplete="username" placeholder="Solo números" maxlength="14" required></label>
      <label id="lbl-clave" hidden>Clave <input name="clave" type="password" autocomplete="current-password"></label>
      <div class="error-msg" id="err" hidden></div>
      <button class="btn" type="submit">Entrar</button>
      <button class="btn btn-sec" type="button" id="otra" hidden>Usar otra cédula</button>
    </form>`;
  const f = app.querySelector('#f'), err = app.querySelector('#err'), lblClave = app.querySelector('#lbl-clave'), otra = app.querySelector('#otra');
  let pideClave = false;
  f.cedula.focus();
  otra.addEventListener('click', () => vistaLogin());
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); errorEn(err, '');
    await conBoton(f.querySelector('button[type=submit]'), async () => {
      if (pideClave) {
        const r = await llamar('loginAdmin', { cedula: f.cedula.value, clave: f.clave.value, token: '' });
        if (!r.ok) return errorEn(err, r.message);
        sesion.guardar({ token: r.data.token, rol: r.data.rol, nombre: r.data.nombre, genero: r.data.genero || '', tokenTrabajador: r.data.tokenTrabajador || '' });
        return arrancar();
      }
      const r = await llamar('login', { cedula: f.cedula.value, token: '' });
      if (!r.ok) return errorEn(err, r.message);
      if (r.data.requiereClave) {            // la cédula es de Recursos Humanos: pide la clave
        pideClave = true; f.cedula.readOnly = true; lblClave.hidden = false; otra.hidden = false; f.clave.required = true; f.clave.focus();
        return;
      }
      sesion.guardar({ token: r.data.token, rol: 'TRABAJADOR', nombre: r.data.nombre, genero: r.data.genero || '' });
      arrancar();
    });
  });
}

/* ---------- Trabajador: estado de cuenta ---------- */

// `cont` y `token` permiten mostrarla dentro del panel de RRHH con la sesión de empleado de esa persona.
// En el sitio del trabajador cada sección tiene su dirección (#/constancia, #/vacaciones, #/fideicomiso),
// así funcionan los botones Atrás/Adelante del navegador y del celular.
let cuenta = { cont: app, token: '', seccion: 'inicio' };
const conToken = () => (cuenta.token ? { token: cuenta.token } : {});
const SECCIONES = ['inicio', 'constancia', 'vacaciones', 'fideicomiso', 'equipo'];
// Fideicomiso queda en «Próximamente» para los trabajadores hasta que esté la pantalla de aportes (cambiar a true para abrirlo).
const FIDEICOMISO_ACTIVO = false;
const seccionDesdeHash = () => { const m = /^#\/(\w+)$/.exec(location.hash); return m && SECCIONES.includes(m[1]) ? m[1] : 'inicio'; };

function navegar(seccion) {
  if (cuenta.cont === app) {
    const destino = seccion === 'inicio' ? '#/' : `#/${seccion}`;
    if (location.hash !== destino) { location.hash = destino; return; }   // el cambio de dirección vuelve a dibujar
  }
  vistaCuenta(cuenta.cont, cuenta.token, seccion);
}

const capitalizar = (t) => t.toLocaleLowerCase('es').replace(/(^|\s)\p{L}/gu, (l) => l.toLocaleUpperCase('es'));
const primerNombre = (nombre) => capitalizar(String(nombre || '').trim().split(/\s+/)[0] || '');
function saludo(genero) {
  const g = String(genero || '').trim().toUpperCase();
  return g.startsWith('F') ? 'Bienvenida' : g.startsWith('M') ? 'Bienvenido' : 'Bienvenido(a)';
}

const ICONOS = {
  constancia: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  vacaciones: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  fideicomiso: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  equipo: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  volver: '<path d="m15 18-6-6 6-6"/>',
  ir: '<path d="m9 18 6-6-6-6"/>',
};
const icono = (n, clase = 'icono') => `<svg class="${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n]}</svg>`;
const volver = () => `<button class="volver" type="button" data-ir="inicio">${icono('volver')} Volver al inicio</button>`;

async function vistaCuenta(cont = app, token = '', seccion = 'inicio') {
  cuenta = { cont, token, seccion };
  btnSalir.hidden = false;
  window.scrollTo(0, 0);
  if (seccion === 'constancia') await seccionConstancia(cont);
  else if (seccion === 'vacaciones') await seccionVacaciones(cont);
  else if (seccion === 'equipo') await seccionEquipo(cont);
  else if (seccion === 'fideicomiso') await seccionFideicomiso(cont);
  else seccionInicio(cont);
  cont.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => navegar(b.dataset.ir)));
}

/* ---------- Inicio: saludo y tres tarjetas ---------- */

function seccionInicio(cont) {
  const s = sesion.leer() || {};
  const tarjeta = (id, titulo, texto, tono, extra = '') => `
    <button class="acceso acceso-${tono}" type="button" data-ir="${id}">
      <span class="acceso-icono">${icono(id)}</span>
      <span class="acceso-texto"><b>${titulo}</b><span>${texto}</span>${extra}</span>
      ${icono('ir', 'icono acceso-ir')}
    </button>`;
  cont.innerHTML = `
    <section class="bienvenida">
      <h1>${saludo(s.genero)}, ${esc(primerNombre(s.nombre))}</h1>
      <p>al sistema de atención de solicitudes de Gestión Humana.</p>
    </section>
    <nav class="accesos" aria-label="Solicitudes">
      ${tarjeta('constancia', 'Constancia de trabajo', 'Descárgala al instante en PDF, con código QR de verificación.', 'rojo')}
      ${tarjeta('vacaciones', 'Vacaciones', 'Consulta tus días pendientes y solicita tus vacaciones; tu jefe directo las aprueba.', 'azul')}
      ${tarjeta('fideicomiso', 'Fideicomiso', 'Consulta tus aportes de prestaciones y solicita anticipos.', 'carbon', FIDEICOMISO_ACTIVO ? '' : '<span class="chip chip-neutro">Próximamente</span>')}
    </nav>`;
  // Si es jefe de alguien, aparece «Mi equipo» con las solicitudes por aprobar
  llamar('equipoVacaciones', conToken()).then((r) => {
    if (!r.ok || !r.data.esJefe || !cont.querySelector('.accesos')) return;
    const n = r.data.pendientes.length;
    cont.querySelector('.accesos').insertAdjacentHTML('afterbegin', tarjeta('equipo', 'Mi equipo',
      n ? `Tienes ${n} solicitud${n === 1 ? '' : 'es'} de vacaciones por aprobar.` : 'Revisa las solicitudes de vacaciones de tu equipo.', 'oro',
      n ? `<span class="chip chip-espera">${n} por aprobar</span>` : ''));
    cont.querySelector('[data-ir=equipo]').addEventListener('click', () => navegar('equipo'));
  });
}

/* ---------- Constancia de trabajo ---------- */

async function seccionConstancia(cont) {
  cont.innerHTML = `${volver()}<p class="vacio">Cargando…</p>`;
  const rc = await llamar('misConstancias', conToken());
  if (!rc.ok && rc.code === 'SESION') { toast(rc.message); return arrancar(); }
  const constancias = rc.ok ? rc.data : [];
  const vigente = constancias.find((c) => c.estado === 'VIGENTE');
  cont.innerHTML = `${volver()}
    <section class="tarjeta">
      <h2>Constancia de trabajo</h2>
      <p class="suave">Se genera al instante en PDF, con el membrete de tu empresa, tu sueldo mensual y un código QR para verificarla. Tiene una vigencia de 30 días.</p>
      ${vigente ? `<p class="aviso">Tienes una constancia vigente hasta el <b>${fechaCaracas(vigente.vence)}</b>. Puedes descargarla las veces que necesites; podrás generar una nueva cuando venza.</p>
        <div><button class="btn" id="btn-vigente">Descargar mi constancia vigente</button></div>`
        : '<div><button class="btn" id="btn-constancia">Generar constancia de trabajo</button></div>'}
      <div class="error-msg" id="err-const" hidden></div>
    </section>
    ${constancias.length ? `<section class="tarjeta"><h2>Mis constancias</h2><div class="lista">${constancias.map((c) => `
      <div class="item"><div class="item-cab"><div><b>Emitida el ${fechaCaracas(c.emision)}</b><p class="suave">Vence el ${fechaCaracas(c.vence)}</p></div>${chipConstancia(c.estado)}</div>
      </div>`).join('')}</div></section>` : ''}`;

  const errConst = cont.querySelector('#err-const');
  const bajarPdf = async (c) => { try { await descargarConstanciaPdf(c, URL_BASE); } catch (e) { errorEn(errConst, e.message || 'No se pudo generar el PDF.'); } };
  cont.querySelector('#btn-vigente')?.addEventListener('click', (e) => conBoton(e.currentTarget, () => bajarPdf(vigente)));
  cont.querySelector('#btn-constancia')?.addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    errorEn(errConst, '');
    const x = await llamar('emitirConstancia', conToken());
    if (!x.ok) return errorEn(errConst, x.message);
    await bajarPdf(x.data); toast('Constancia generada.'); vistaCuenta(cuenta.cont, cuenta.token, 'constancia');
  }));
}

/* ---------- Vacaciones ---------- */

const V = () => window.Vacaciones;
const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const fechaVac = (txt) => (txt ? `${DIAS_SEMANA[new Date(txt + 'T12:00:00Z').getUTCDay()]} ${V().corta(txt)}` : '');
const ESTADOS_VAC = {
  PENDIENTE_JEFE: ['Con tu jefe', 'espera'], APROBADA_JEFE: ['Aprobada · en Gestión Humana', 'austral'], REGISTRADA: ['Registrada', 'ok'],
  RECHAZADA: ['Rechazada', 'error'], CANCELADA: ['Cancelada', 'neutro'],
};
const chipVac = (e, textos = ESTADOS_VAC) => { const [t, tono] = textos[e] || [e, 'neutro']; return `<span class="chip chip-${tono}">${esc(t)}</span>`; };
const detallePago = (s) => s.imputacion.filter((i) => i.pagaPeriodo).map((i) => `se paga el período ${i.periodo} completo (${i.diasDelPeriodo} días)`).join(' y ');
const resumenFechas = (s) => `${s.dias} día${s.dias === 1 ? '' : 's'} hábil${s.dias === 1 ? '' : 'es'} · del ${fechaVac(s.inicio)} al ${fechaVac(s.culminacion)} · reintegro ${fechaVac(s.reintegro)}`;

async function seccionVacaciones(cont) {
  cont.innerHTML = `${volver()}<p class="vacio">Cargando tus vacaciones…</p>`;
  const r = await llamar('datosVacaciones', conToken());
  if (!r.ok) { if (r.code === 'SESION') { toast(r.message); return arrancar(); } cont.innerHTML = `${volver()}<p class="error-msg">${esc(r.message)}</p>`; return; }
  const d = r.data, s = d.saldo;
  const desde = V().sumarDiasTxt(d.hoy, d.reglas.anticipacionMin), hasta = V().sumarDiasTxt(d.hoy, d.reglas.anticipacionMax);

  cont.innerHTML = `${volver()}
    <section class="tarjeta heroe">
      <h2>Días de vacaciones pendientes</h2>
      <div class="gran">${s.total} día${s.total === 1 ? '' : 's'}</div>
      <p class="suave" style="color:#cfd1d4">Días hábiles por disfrutar, sin contar las solicitudes en trámite.</p>
    </section>
    <section class="tarjeta">
      <h2>Solicitar vacaciones</h2>
      ${!d.jefe ? '<p class="error-msg">No tienes jefe directo asignado. Comunícate con Gestión Humana para que lo registren y puedas solicitar.</p>'
        : s.total < 1 ? '<p class="aviso">No tienes días pendientes por disfrutar en este momento.</p>' : `
      <p class="suave">Debes pedirlas con ${d.reglas.anticipacionMin} a ${d.reglas.anticipacionMax} días de anticipación: la fecha de inicio puede ser entre el <b>${V().corta(desde)}</b> y el <b>${V().corta(hasta)}</b>. Se cuentan días hábiles (sin fines de semana ni feriados).</p>
      <form id="fv" class="form-vac" novalidate>
        <div class="fila">
          <label class="grow">Fecha de inicio <input type="date" name="inicio" min="${desde}" max="${hasta}" required></label>
          <label class="grow">Días hábiles <input type="number" name="dias" min="1" max="${s.total}" step="1" inputmode="numeric" placeholder="1 a ${s.total}" required></label>
        </div>
        <div id="previa-vac" class="previa-vac" hidden></div>
        <div class="error-msg" id="err-vac" hidden></div>
        <div><button class="btn" type="submit">Enviar a mi jefe: ${esc(primerNombre(d.jefe.nombre))}</button></div>
      </form>`}
    </section>
    <section class="tarjeta">
      <h2>Mis días por período</h2>
      ${s.porPeriodo.length ? `<div class="tabla-caja tabla-compacta"><table>
        <thead><tr><th>Período</th><th class="num">Corresp.</th><th class="num">Disfrut.</th><th class="num">Pend.</th></tr></thead>
        <tbody>${s.porPeriodo.slice().reverse().map((p) => `<tr><td>${esc(p.periodo)}</td><td class="num">${p.correspondientes}</td><td class="num">${p.disfrutadosPrevios + p.enSistema}</td><td class="num"><b>${p.pendientes}</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="vacio">Todavía no tienes períodos de vacaciones cumplidos.</p>'}
    </section>
    <section class="tarjeta">
      <h2>Mis solicitudes</h2>
      ${d.solicitudes.length ? `<div class="lista">${d.solicitudes.map((x) => `
        <div class="item">
          <div class="item-cab"><b>${esc(resumenFechas(x).split(' · ')[0])}</b>${chipVac(x.estado)}</div>
          <p class="suave">${esc(resumenFechas(x).split(' · ').slice(1).join(' · '))}</p>
          <p class="suave">${esc(x.condicion)}${x.estado === 'PENDIENTE_JEFE' && x.jefeNombre ? ` · esperando a ${esc(primerNombre(x.jefeNombre))}` : ''}</p>
          ${x.estado === 'RECHAZADA' && x.motivoRechazo ? `<p class="error-msg">Motivo: ${esc(x.motivoRechazo)}</p>` : ''}
          ${x.estado === 'PENDIENTE_JEFE' ? `<div><button class="btn btn-sec btn-chico" data-cancelar-vac="${esc(x.id)}">Cancelar solicitud</button></div>` : ''}
          ${x.estado === 'REGISTRADA' && x.numeroConstancia ? `<div><button class="btn btn-azul btn-chico" data-pdf-vac="${esc(x.id)}">Descargar constancia de aprobación</button></div>` : ''}
        </div>`).join('')}</div>` : '<p class="vacio">Todavía no has hecho solicitudes en el sistema.</p>'}
    </section>`;

  const f = cont.querySelector('#fv');
  if (f) {
    const previa = cont.querySelector('#previa-vac'), err = cont.querySelector('#err-vac');
    const calcular = () => {
      errorEn(err, '');
      const v = V().validarSolicitud({ inicio: f.inicio.value, dias: Number(f.dias.value) },
        { hoy: d.hoy, feriados: d.feriados, saldo: s, solicitudes: d.solicitudes, tieneJefe: !!d.jefe, reglas: d.reglas });
      if (!f.inicio.value || !f.dias.value) { previa.hidden = true; return v; }
      if (!v.ok) { previa.hidden = true; errorEn(err, v.errores[0]); return v; }
      const c = v.calculo, pago = detallePago({ imputacion: c.imputacion });
      previa.innerHTML = `<div><span>Sales</span><b>${fechaVac(f.inicio.value)}</b></div><div><span>Último día</span><b>${fechaVac(c.culminacion)}</b></div>
        <div><span>Te reintegras</span><b>${fechaVac(c.reintegro)}</b></div>
        <p>${esc(c.condicion)}${pago ? `: ${esc(pago)}.` : ' (sin pago: ese período ya se pagó).'}</p>`;
      previa.hidden = false;
      return v;
    };
    f.inicio.addEventListener('change', calcular); f.dias.addEventListener('input', calcular);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = calcular();
      if (!f.inicio.value || !f.dias.value) return errorEn(err, 'Elige la fecha de inicio y cuántos días.');
      if (!v.ok) return;
      await conBoton(f.querySelector('button[type=submit]'), async () => {
        const x = await llamar('solicitarVacaciones', { inicio: f.inicio.value, dias: Number(f.dias.value), ...conToken() });
        if (!x.ok) return errorEn(err, x.message);
        toast(`Solicitud enviada a ${primerNombre(d.jefe.nombre)}.`); vistaCuenta(cuenta.cont, cuenta.token, 'vacaciones');
      });
    });
  }
  activarPdfVac(cont, d.solicitudes);
  cont.querySelectorAll('[data-cancelar-vac]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    if (!confirm('¿Cancelar esta solicitud de vacaciones?')) return;
    const x = await llamar('cancelarVacaciones', { id: b.dataset.cancelarVac, ...conToken() });
    toast(x.ok ? 'Solicitud cancelada.' : x.message); vistaCuenta(cuenta.cont, cuenta.token, 'vacaciones');
  })));
}

/** Botones «Descargar constancia de aprobación» de una lista de solicitudes. */
function activarPdfVac(cont, lista) {
  cont.querySelectorAll('[data-pdf-vac]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    try { await descargarConstanciaVacacionesPdf(lista.find((x) => x.id === b.dataset.pdfVac)); }
    catch (e) { toast(e.message || 'No se pudo generar el PDF.'); }
  })));
}

/* ---------- Mi equipo: el jefe aprueba o rechaza ---------- */

const ESTADOS_VAC_JEFE = { ...ESTADOS_VAC, PENDIENTE_JEFE: ['Por aprobar', 'espera'], APROBADA_JEFE: ['Aprobada · en Gestión Humana', 'austral'] };

async function seccionEquipo(cont) {
  cont.innerHTML = `${volver()}<p class="vacio">Cargando…</p>`;
  const r = await llamar('equipoVacaciones', conToken());
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { pendientes, recientes, equipo } = r.data;
  const item = (x, acciones = '') => `<div class="item">
      <div class="item-cab"><div><b>${esc(x.nombre)}</b><p class="suave">${esc(resumenFechas(x))}</p></div>${chipVac(x.estado, ESTADOS_VAC_JEFE)}</div>
      ${x.estado === 'RECHAZADA' && x.motivoRechazo ? `<p class="suave">Motivo: ${esc(x.motivoRechazo)}</p>` : ''}${acciones}</div>`;
  cont.innerHTML = `${volver()}
    <section class="tarjeta"><h2>Vacaciones por aprobar (${pendientes.length})</h2>
      <p class="suave">Tu equipo: ${equipo} persona${equipo === 1 ? '' : 's'}. Al aprobar, la solicitud pasa a Gestión Humana para registrarla.</p>
      ${pendientes.length ? `<div class="lista">${pendientes.map((x) => item(x, `<div class="fila"><button class="btn btn-chico" data-ap-vac="${esc(x.id)}">Aprobar</button><button class="btn btn-sec btn-chico" data-re-vac="${esc(x.id)}">Rechazar</button></div>`)).join('')}</div>`
        : '<p class="vacio">No hay solicitudes pendientes.</p>'}
    </section>
    ${recientes.length ? `<section class="tarjeta"><h2>Revisadas recientemente</h2><div class="lista">${recientes.map((x) => item(x)).join('')}</div></section>` : ''}`;
  cont.querySelectorAll('[data-ap-vac]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const x = await llamar('decidirVacacionesJefe', { id: b.dataset.apVac, aprobar: true, ...conToken() });
    toast(x.ok ? 'Aprobada. Pasa a Gestión Humana.' : x.message); vistaCuenta(cuenta.cont, cuenta.token, 'equipo');
  })));
  cont.querySelectorAll('[data-re-vac]').forEach((b) => b.addEventListener('click', () => pedirMotivo('Rechazar vacaciones', async (motivo) => {
    const x = await llamar('decidirVacacionesJefe', { id: b.dataset.reVac, aprobar: false, motivo, ...conToken() });
    if (x.ok) { toast('Rechazada.'); vistaCuenta(cuenta.cont, cuenta.token, 'equipo'); }
    return x;
  })));
}

/** Diálogo genérico para pedir un motivo. `enviar(motivo)` devuelve la respuesta de la API. */
function pedirMotivo(titulo, enviar) {
  dlg.innerHTML = `<form id="fm" novalidate><h2>${esc(titulo)}</h2>
    <label>Motivo (lo verá el trabajador) <textarea name="motivo" maxlength="200" required></textarea></label>
    <div class="error-msg" id="err" hidden></div>
    <div class="fila"><button class="btn grow" type="submit">Rechazar</button><button class="btn btn-sec" type="button" id="no">Cerrar</button></div></form>`;
  const f = dlg.querySelector('#fm'), err = dlg.querySelector('#err');
  dlg.querySelector('#no').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.motivo.value.trim()) return errorEn(err, 'Escribe el motivo.');
    await conBoton(f.querySelector('button[type=submit]'), async () => {
      const x = await enviar(f.motivo.value.trim());
      if (!x.ok) return errorEn(err, x.message);
      dlg.close();
    });
  });
  dlg.showModal(); f.motivo.focus();
}

/* ---------- Fideicomiso: estado de cuenta y anticipos ---------- */

async function seccionFideicomiso(cont) {
  if (!FIDEICOMISO_ACTIVO) {
    cont.innerHTML = `${volver()}
      <section class="tarjeta">
        <h2>Fideicomiso</h2>
        <p class="aviso">Muy pronto podrás consultar aquí tus aportes de prestaciones sociales, cuánto tienes disponible y solicitar anticipos.</p>
      </section>`;
    return;
  }
  cont.innerHTML = `${volver()}<p class="vacio">Cargando tu estado de cuenta…</p>`;
  const r = await llamar('estadoDeCuenta', conToken());
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { resumen: u, anticipos } = r.data;
  const pct = Math.round(u.porcentajeMax * 100);

  cont.innerHTML = `${volver()}
    <section class="tarjeta heroe">
      <h2>Disponible para anticipo</h2>
      <div class="gran">${bs(u.disponible)}</div>
      <p class="suave" style="color:#cfd1d4">Hasta el ${pct} % de lo aportado, menos los anticipos pagados o en trámite.</p>
      <div class="fila"><button class="btn" id="btn-pedir" ${u.disponible > 0 ? '' : 'disabled'}>Solicitar anticipo</button></div>
    </section>
    <section class="tarjeta">
      <h2>Mi fideicomiso</h2>
      <div class="cifras">
        <div class="cifra"><b>${bs(u.totalAportado)}</b><span>Total aportado</span></div>
        <div class="cifra"><b>${bs(u.anticiposPagados)}</b><span>Anticipos pagados</span></div>
        <div class="cifra"><b>${bs(u.anticiposEnTramite)}</b><span>En trámite</span></div>
      </div>
      <p class="suave">Solo se muestran los aportes que el banco ya procesó. No incluye intereses.</p>
      ${u.detalle.length ? `<div class="tabla-caja"><table>
        <thead><tr><th>Trimestre</th><th>Empresa</th><th class="num">Aporte</th><th class="num">Acumulado</th></tr></thead>
        <tbody>${u.detalle.slice().reverse().map((d) => `<tr><td>${d.anio} · T${d.trimestre}</td><td>${esc(d.empresa)}</td><td class="num">${bs(d.aporte)}</td><td class="num">${bs(d.acumulado)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="vacio">Aún no tienes aportes acreditados.</p>'}
    </section>
    <section class="tarjeta">
      <h2>Mis solicitudes de anticipo</h2>
      ${anticipos.length ? `<div class="lista">${anticipos.slice().sort((a, b) => b.creada - a.creada).map((a) => `
        <div class="item">
          <div class="item-cab"><b>${bs(a.monto)}</b>${chip(a.estado)}</div>
          <p class="suave">${esc(a.motivo)} · ${fechaHora(a.creada)}</p>
          ${a.estado === 'RECHAZADA' && a.motivoRechazo ? `<p class="error-msg">Motivo: ${esc(a.motivoRechazo)}</p>` : ''}
          ${a.estado === 'PENDIENTE' ? `<div><button class="btn btn-sec btn-chico" data-cancelar="${esc(a.id)}">Cancelar solicitud</button></div>` : ''}
        </div>`).join('')}</div>` : '<p class="vacio">Todavía no has hecho solicitudes.</p>'}
    </section>`;

  cont.querySelector('#btn-pedir')?.addEventListener('click', () => formularioAnticipo(u));
  cont.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const x = await llamar('cancelarAnticipo', { id: b.dataset.cancelar, ...conToken() });
    toast(x.ok ? 'Solicitud cancelada.' : x.message);
    vistaCuenta(cuenta.cont, cuenta.token, 'fideicomiso');
  })));
}

function formularioAnticipo(u) {
  dlg.innerHTML = `
    <form id="fa" novalidate>
      <h2>Solicitar anticipo</h2>
      <p class="suave">Disponible: <b>${bs(u.disponible)}</b></p>
      <label>Monto (Bs.) <input name="monto" inputmode="decimal" placeholder="0,00" required></label>
      <div><button class="btn btn-sec btn-chico" type="button" id="todo">Pedir todo lo disponible</button></div>
      <label>Motivo <select name="motivo"><option>Vivienda</option><option>Salud</option><option>Educación</option><option>Otro</option></select></label>
      <label id="lbl-det" hidden>Explica el motivo <textarea name="detalle" maxlength="300"></textarea></label>
      <div class="error-msg" id="err" hidden></div>
      <div class="fila"><button class="btn grow" type="submit">Enviar solicitud</button><button class="btn btn-sec" type="button" id="no">Cerrar</button></div>
    </form>`;
  const f = dlg.querySelector('#fa'), err = dlg.querySelector('#err');
  f.motivo.addEventListener('change', () => { dlg.querySelector('#lbl-det').hidden = f.motivo.value !== 'Otro'; });
  dlg.querySelector('#todo').addEventListener('click', () => { f.monto.value = u.disponible.toFixed(2).replace('.', ','); });
  dlg.querySelector('#no').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); errorEn(err, '');
    const monto = leerMonto(f.monto.value);
    if (!(monto > 0)) return errorEn(err, 'Escribe un monto mayor a cero.');
    if (monto > u.disponible) return errorEn(err, `El monto supera lo disponible (${bs(u.disponible)}).`);
    await conBoton(f.querySelector('button[type=submit]'), async () => {
      const r = await llamar('solicitarAnticipo', { monto, motivo: f.motivo.value, detalle: f.detalle.value, ...conToken() });
      if (!r.ok) return errorEn(err, r.message);
      dlg.close(); toast('Solicitud enviada. Recursos Humanos la revisará.'); vistaCuenta(cuenta.cont, cuenta.token, 'fideicomiso');
    });
  });
  dlg.showModal();
}

/* ---------- RRHH: panel ---------- */

let pestana = 'vacaciones';
let abrirSinJefe = false;   // al venir desde Vacaciones → Empleados con el filtro «solo sin jefe»

async function vistaRRHH() {
  btnSalir.hidden = false;
  const miCuenta = !!(sesion.leer() || {}).tokenTrabajador;
  if (pestana === 'micuenta' && !miCuenta) pestana = 'vacaciones';
  app.innerHTML = `
    <div class="pestanas" role="tablist">
      ${[['vacaciones', 'Vacaciones'], ['empleados', 'Empleados'], ['constancias', 'Constancias'], ['solicitudes', 'Anticipos'], ['banco', 'Archivo al banco'], ['cierres', 'Cierres'], ...(miCuenta ? [['micuenta', 'Mi cuenta']] : [])].map(([k, t]) =>
        `<button class="pestana" role="tab" data-p="${k}" aria-selected="${k === pestana}">${t}</button>`).join('')}
    </div>
    <div id="panel"></div>`;
  app.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => { pestana = b.dataset.p; vistaRRHH(); }));
  const panel = app.querySelector('#panel');
  if (pestana === 'solicitudes') return panelSolicitudes(panel);
  if (pestana === 'banco') return panelBanco(panel);
  if (pestana === 'empleados') return panelEmpleados(panel);
  if (pestana === 'constancias') return panelConstancias(panel);
  if (pestana === 'vacaciones') return panelVacaciones(panel);
  if (pestana === 'micuenta') return vistaCuenta(panel, sesion.leer().tokenTrabajador);
  return panelCierres(panel);
}

const tarjetaAnticipo = (a, acciones = '') => `
  <div class="item">
    <div class="item-cab"><div><b>${esc(a.nombre)}</b><p class="suave">${esc(a.clave)} · ${esc(a.empresa)}</p></div>${chip(a.estado)}</div>
    <div class="fila"><b>${bs(a.monto)}</b><span class="suave">${esc(a.motivo)} · ${fechaHora(a.creada)}</span></div>
    ${a.detalle ? `<p class="suave">“${esc(a.detalle)}”</p>` : ''}${acciones}
  </div>`;

async function panelSolicitudes(panel) {
  panel.innerHTML = '<p class="vacio">Cargando…</p>';
  const r = await llamar('bandejaAnticipos', { estado: 'PENDIENTE' });
  if (!r.ok) { toast(r.message); return arrancar(); }
  panel.innerHTML = `<section class="tarjeta"><h2>Anticipos por revisar (${r.data.length})</h2>
    ${r.data.length ? `<div class="lista">${r.data.map((a) => tarjetaAnticipo(a,
      `<div class="fila"><button class="btn btn-chico" data-ap="${esc(a.id)}">Aprobar</button><button class="btn btn-sec btn-chico" data-re="${esc(a.id)}">Rechazar</button></div>`)).join('')}</div>`
      : '<p class="vacio">No hay solicitudes pendientes.</p>'}</section>`;
  panel.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const x = await llamar('decidirAnticipo', { id: b.dataset.ap, aprobar: true });
    toast(x.ok ? 'Aprobada.' : x.message); panelSolicitudes(panel);
  })));
  panel.querySelectorAll('[data-re]').forEach((b) => b.addEventListener('click', () => pedirMotivoRechazo(b.dataset.re, () => panelSolicitudes(panel))));
}

function pedirMotivoRechazo(id, despues) {
  dlg.innerHTML = `<form id="fr" novalidate><h2>Rechazar solicitud</h2>
    <label>Motivo (lo verá el trabajador) <textarea name="motivo" maxlength="200" required></textarea></label>
    <div class="error-msg" id="err" hidden></div>
    <div class="fila"><button class="btn grow" type="submit">Rechazar</button><button class="btn btn-sec" type="button" id="no">Cerrar</button></div></form>`;
  const f = dlg.querySelector('#fr'), err = dlg.querySelector('#err');
  dlg.querySelector('#no').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    await conBoton(f.querySelector('button[type=submit]'), async () => {
      const x = await llamar('decidirAnticipo', { id, aprobar: false, motivoRechazo: f.motivo.value });
      if (!x.ok) return errorEn(err, x.message);
      dlg.close(); toast('Rechazada.'); despues();
    });
  });
  dlg.showModal();
}

function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function panelBanco(panel) {
  panel.innerHTML = '<p class="vacio">Cargando…</p>';
  const [ap, ar] = await Promise.all([llamar('bandejaAnticipos', { estado: 'APROBADA' }), llamar('bandejaAnticipos', { estado: 'EN_ARCHIVO' })]);
  if (!ap.ok || !ar.ok) { toast((ap.ok ? ar : ap).message); return arrancar(); }
  const cuenta = (e) => ap.data.filter((a) => a.empresa === e).length;
  panel.innerHTML = `
    <section class="tarjeta"><h2>1 · Generar archivo para el banco</h2>
      <p class="suave">Incluye los anticipos aprobados de la empresa (TIPO T = 5). Al generarlo pasan a «Enviada al banco».</p>
      <div class="fila">${['PCA', 'AIV'].map((e) => `<button class="btn ${e === 'AIV' ? 'btn-azul' : ''}" data-gen="${e}" ${cuenta(e) ? '' : 'disabled'}>Generar ${e} (${cuenta(e)})</button>`).join('')}</div>
    </section>
    <section class="tarjeta"><h2>2 · Marcar como pagadas (${ar.data.length})</h2>
      <p class="suave">Cuando el banco confirme el pago, márcalas. El disponible del trabajador baja.</p>
      ${ar.data.length ? `<div class="lista">${ar.data.map((a) => tarjetaAnticipo(a)).join('')}</div>
      <div><button class="btn" id="pagar">Marcar todas como pagadas</button></div>` : '<p class="vacio">No hay anticipos enviados al banco.</p>'}
    </section>`;
  panel.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const r = await llamar('archivoAnticipos', { empresa: b.dataset.gen });
    if (!r.ok) return toast(r.message);
    const hoy = new Date().toISOString().slice(0, 10);
    descargar(`ANTICIPOS_${b.dataset.gen}_${hoy}.csv`, r.data.csv);
    toast(`Archivo generado con ${r.data.cantidad} anticipos.`); panelBanco(panel);
  })));
  panel.querySelector('#pagar')?.addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    if (!confirm(`¿Marcar ${ar.data.length} anticipos como pagados?`)) return;
    const r = await llamar('pagarAnticipos', { ids: ar.data.map((a) => a.id) });
    toast(r.ok ? `${r.data.cambiados} anticipos pagados.` : r.message); panelBanco(panel);
  }));
}

/* ---------- RRHH: vacaciones ---------- */

const ESTADOS_VAC_RRHH = { PENDIENTE_JEFE: ['Con el jefe', 'espera'], APROBADA_JEFE: ['Por registrar', 'austral'], REGISTRADA: ['Registrada', 'ok'], RECHAZADA: ['Rechazada', 'error'], CANCELADA: ['Cancelada', 'neutro'] };
let estadoVacRRHH = 'APROBADA_JEFE';

async function panelVacaciones(panel) {
  panel.innerHTML = '<p class="vacio">Cargando…</p>';
  const r = await llamar('bandejaVacaciones', { estado: estadoVacRRHH });
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { solicitudes, sinJefe, conCierre } = r.data;
  panel.innerHTML = `
    ${sinJefe ? `<section class="tarjeta"><p class="error-msg"><b>${sinJefe} empleado${sinJefe === 1 ? '' : 's'} activo${sinJefe === 1 ? '' : 's'} sin jefe directo.</b> No pueden solicitar vacaciones hasta que se lo asignes.</p>
      <div><button class="btn btn-sec btn-chico" id="ver-sin-jefe">Asignar jefes</button></div></section>` : ''}
    <section class="tarjeta">
      <div class="item-cab"><h2>Solicitudes de vacaciones</h2>
        <label>Mostrar <select id="estado-vac">${Object.entries(ESTADOS_VAC_RRHH).map(([k, [t]]) => `<option value="${k}" ${k === estadoVacRRHH ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      ${solicitudes.length ? `<div class="lista">${solicitudes.map((x) => {
        const pago = detallePago(x);
        return `<div class="item">
          <div class="item-cab"><div><b>${esc(x.nombre || x.clave)}</b><p class="suave">${esc(x.clave)} · jefe: ${esc(x.jefeNombre || '—')}</p></div>${chipVac(x.estado, ESTADOS_VAC_RRHH)}</div>
          <p>${esc(resumenFechas(x))}</p>
          <p class="suave"><b>${esc(x.condicion)}</b>${pago ? ` — ${esc(pago)}` : ''} · ${x.imputacion.map((i) => `${i.dias} del ${i.periodo}`).join(', ')}</p>
          ${x.nomina ? `<p class="suave">Nómina: ${esc(x.nomina)}</p>` : ''}${x.motivoRechazo ? `<p class="suave">Motivo: ${esc(x.motivoRechazo)}</p>` : ''}
          ${x.estado === 'REGISTRADA' && x.numeroConstancia ? `<div><button class="btn btn-azul btn-chico" data-pdf-vac="${esc(x.id)}">Constancia de aprobación</button></div>` : ''}
          ${x.estado === 'APROBADA_JEFE' ? `
            ${pago ? `<label>Código de nómina del pago <input placeholder="Ej. NV-80" data-nomina="${esc(x.id)}" autocomplete="off"></label>` : ''}
            <div class="fila"><button class="btn btn-chico" data-registrar="${esc(x.id)}">Registrar</button><button class="btn btn-sec btn-chico" data-rechazar-vac="${esc(x.id)}">Rechazar</button></div>` : ''}
        </div>`; }).join('')}</div>` : '<p class="vacio">No hay solicitudes en este estado.</p>'}
    </section>
    <section class="tarjeta">
      <h2>Importar el cierre de vacaciones</h2>
      <p class="suave">Sube tu Excel «Solicitud Digital de Disfrute de Vacaciones» (hoja CIERRE DE VACACIONES). Reemplaza los saldos por período de cada persona; los ingresos nuevos sin cierre usan la regla de la ley (15 + 1 por año, hasta 30). ${conCierre ? `Hoy hay saldos de <b>${conCierre}</b> personas.` : '<b>Todavía no se ha importado.</b>'}</p>
      <label>Archivo <input type="file" id="arch-vac" accept=".xlsx,.xls"></label>
      <div class="error-msg" id="err-vac" hidden></div>
      <div id="previa-cierre"></div>
    </section>`;

  panel.querySelector('#estado-vac').addEventListener('change', (e) => { estadoVacRRHH = e.target.value; panelVacaciones(panel); });
  activarPdfVac(panel, solicitudes);
  panel.querySelector('#ver-sin-jefe')?.addEventListener('click', () => { abrirSinJefe = true; pestana = 'empleados'; vistaRRHH(); });
  panel.querySelectorAll('[data-registrar]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const nomina = panel.querySelector(`[data-nomina="${b.dataset.registrar}"]`)?.value || '';
    const x = await llamar('registrarVacaciones', { id: b.dataset.registrar, nomina });
    toast(x.ok ? 'Registrada.' : x.message); panelVacaciones(panel);
  })));
  panel.querySelectorAll('[data-rechazar-vac]').forEach((b) => b.addEventListener('click', () => pedirMotivo('Rechazar vacaciones', async (motivo) => {
    const x = await llamar('rechazarVacacionesRRHH', { id: b.dataset.rechazarVac, motivo });
    if (x.ok) { toast('Rechazada.'); panelVacaciones(panel); }
    return x;
  })));

  const err = panel.querySelector('#err-vac'), previa = panel.querySelector('#previa-cierre');
  panel.querySelector('#arch-vac').addEventListener('change', async (e) => {
    errorEn(err, ''); previa.innerHTML = '';
    const archivo = e.target.files[0]; if (!archivo) return;
    try {
      const XLSX = await cargarXlsx();
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
      const nombre = libro.SheetNames.find((n) => /CIERRE/i.test(n)) || libro.SheetNames[0];
      const matriz = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: '' });
      const m = window.Vacaciones.mapearCierre(matriz);
      previa.innerHTML = `<div class="aviso">Hoja «${esc(nombre)}»: <b>${m.personas.length}</b> personas, períodos ${m.periodos.map(esc).join(', ')}.</div>
        <div><button class="btn" id="importar-cierre">Importar saldos</button></div>`;
      previa.querySelector('#importar-cierre').addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
        const x = await llamar('importarCierreVacaciones', { personas: m.personas });
        if (!x.ok) return errorEn(err, x.message);
        const y = x.data;
        previa.innerHTML = `<div class="aviso">Importadas <b>${y.personas}</b> personas (${y.periodos} períodos). ${y.noActivos} no están activas (egresos: se ignoran). ${y.activosSinCierre} empleados activos sin cierre usarán la regla de la ley.</div>`;
        toast('Cierre de vacaciones importado.');
      }));
    } catch (x) { errorEn(err, x.message || 'No se pudo leer el archivo.'); }
  });
}

/* ---------- RRHH: constancias emitidas ---------- */

async function panelConstancias(panel) {
  panel.innerHTML = '<p class="vacio">Cargando…</p>';
  const r = await llamar('listarConstancias');
  if (!r.ok) { toast(r.message); return arrancar(); }
  panel.innerHTML = `<section class="tarjeta"><h2>Constancias emitidas (${r.data.length})</h2>
    <p class="suave">Si anulas una, al escanear su código aparecerá como anulada.</p>
    ${r.data.length ? `<div class="lista">${r.data.map((c) => `<div class="item">
      <div class="item-cab"><div><b>${esc(c.nombre)}</b><p class="suave">${esc(c.cedula)} · ${esc(c.empresa)} · ${bs(c.salario)}</p></div>${chipConstancia(c.estado)}</div>
      <p class="suave">Emitida el ${fechaCaracas(c.emision)} · vence el ${fechaCaracas(c.vence)} · código ${esc(c.id)}</p>
      ${c.estado !== 'ANULADA' ? `<div><button class="btn btn-sec btn-chico" data-anular="${esc(c.id)}">Anular</button></div>` : ''}</div>`).join('')}</div>` : '<p class="vacio">Todavía no se han emitido constancias.</p>'}</section>`;
  panel.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    if (!confirm('¿Anular esta constancia? Dejará de ser válida al escanear su código.')) return;
    const x = await llamar('anularConstancia', { id: b.dataset.anular });
    toast(x.ok ? 'Constancia anulada.' : x.message); panelConstancias(panel);
  })));
}

/* ---------- Verificación pública (abre el QR) ---------- */

async function vistaVerificar(id) {
  btnSalir.hidden = true;
  app.innerHTML = '<p class="vacio">Verificando la constancia…</p>';
  const r = await llamar('verificarConstancia', { id, token: '' });
  if (!r.ok) {
    app.innerHTML = `<section class="tarjeta login"><div class="banner banner-error"><b>No se pudo verificar</b><span>${esc(r.message)}</span></div>
      <p class="suave">Si recibiste este documento de un tercero, no lo des por válido.</p></section>`;
    return;
  }
  const c = r.data, vigente = c.estado === 'VIGENTE';
  const titulo = vigente ? 'Constancia válida y vigente' : c.estado === 'VENCIDA' ? 'Constancia auténtica, pero vencida' : 'Constancia anulada';
  const tono = vigente ? 'ok' : c.estado === 'VENCIDA' ? 'espera' : 'error';
  app.innerHTML = `<section class="tarjeta login">
    <div class="banner banner-${tono}"><b>${titulo}</b>
      <span>${c.estado === 'ANULADA' ? 'Recursos Humanos anuló este documento. No tiene validez.' : `Se confirma que <b>${esc(c.nombre)}</b> trabaja o trabajó en <b>${esc(c.empresaNombre)}</b>.`}</span></div>
    <div class="tabla-caja tabla-datos"><table><tbody>
      <tr><th>Nombre y apellido</th><td>${esc(c.nombre)}</td></tr>
      <tr><th>Cédula</th><td>${esc(c.cedula)}</td></tr>
      <tr><th>Empresa</th><td>${esc(c.empresaNombre)}</td></tr>
      <tr><th>Cargo</th><td>${esc(c.cargo)}</td></tr>
      <tr><th>Fecha de ingreso</th><td>${esc(c.fechaIngreso)}</td></tr>
      <tr><th>Salario mensual</th><td>${bs(c.salario)}</td></tr>
      <tr><th>Fecha de emisión</th><td>${fechaCaracas(c.emision)}</td></tr>
      <tr><th>Fecha de vencimiento</th><td>${fechaCaracas(c.vence)}</td></tr>
      <tr><th>Código</th><td>${esc(c.id)}</td></tr>
    </tbody></table></div>
    <p class="suave">Datos tomados de los registros de Recursos Humanos al momento de emitir la constancia (vigencia de 30 días).</p></section>`;
}

/* ---------- RRHH: empleados ---------- */

const URL_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
function cargarXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, no) => {
    const sc = Object.assign(document.createElement('script'), { src: URL_XLSX, onload: () => ok(window.XLSX), onerror: () => no(new Error('No se pudo cargar el lector de Excel.')) });
    document.head.appendChild(sc);
  });
}

/** Lee el primer libro/hoja del archivo y devuelve las filas como objetos con los encabezados del Excel. */
async function leerArchivoExcel(archivo) {
  const XLSX = await cargarXlsx();
  const bytes = await archivo.arrayBuffer();
  let libro;
  if (/\.csv$/i.test(archivo.name)) {
    // Los CSV se leen como texto: UTF-8 y, si trae caracteres rotos, Windows-1252 (Excel en español).
    let texto = new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '');
    if (texto.includes('\ufffd')) texto = new TextDecoder('windows-1252').decode(bytes);
    libro = XLSX.read(texto, { type: 'string', raw: true });   // raw: no adivinar fechas (evita confundir día y mes)
  } else {
    libro = XLSX.read(bytes, { type: 'array' });
  }
  const hoja = libro.Sheets[libro.SheetNames[0]];
  // raw: las fechas de Excel llegan como número de serie y se convierten exactamente en core/empleados.js (fechaDeExcel)
  return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: true });
}

const COL_NOMBRES = { cedula: 'Cédula', nombre: 'Nombre', organizacion: 'Organización', departamento: 'Departamento', puesto: 'Puesto', estado: 'Estado', fechaInicio: 'Fecha Inicio' };

async function panelEmpleados(panel) {
  panel.innerHTML = `
    <section class="tarjeta">
      <h2>Cargar «Detalle de Empleado»</h2>
      <p class="suave">Sube el Excel (.xlsx o .csv) con las columnas Organización, Departamento, Puesto, Cédula, Nombre, Estado y Fecha Inicio. Actualiza a los que ya existen, agrega los nuevos y respeta tus correcciones manuales.</p>
      <label>Archivo <input type="file" id="arch" accept=".xlsx,.xls,.csv"></label>
      <div class="error-msg" id="err" hidden></div>
      <div id="previa"></div>
    </section>
    <section class="tarjeta">
      <h2>Jefe directo por departamento</h2>
      <p class="suave">Asigna de una vez el mismo jefe a todo un departamento. Después puedes ajustar casos individuales en la lista.</p>
      <label>Departamento <select id="dep"><option value="">Elige un departamento</option></select></label>
      <div><button class="btn btn-sec" id="dep-jefe" disabled>Elegir jefe del departamento</button></div>
    </section>
    <section class="tarjeta">
      <h2>Empleados</h2>
      <label>Buscar por nombre o cédula <input id="q" placeholder="Escribe para buscar" autocomplete="off"></label>
      <div class="fila"><label class="grow">Departamento <select id="f-dep"><option value="">Todos</option></select></label>
        <label style="grid-auto-flow:column;align-items:center;gap:8px"><input type="checkbox" id="f-sinjefe" style="width:20px;min-height:20px" ${abrirSinJefe ? 'checked' : ''}> Solo sin jefe</label></div>
      <div id="lista"><p class="vacio">Cargando…</p></div>
    </section>`;
  const err = panel.querySelector('#err'), previa = panel.querySelector('#previa');

  panel.querySelector('#arch').addEventListener('change', async (e) => {
    errorEn(err, ''); previa.innerHTML = '';
    const archivo = e.target.files[0]; if (!archivo) return;
    try {
      const crudas = await leerArchivoExcel(archivo);
      const m = window.Empleados.mapearDetalle(crudas);
      if (!m.filas.length) return errorEn(err, 'No encontré empleados en el archivo.');
      if (m.faltantes.includes('cedula') || m.faltantes.includes('nombre')) {
        return errorEn(err, `Faltan columnas obligatorias: ${m.faltantes.filter((c) => ['cedula', 'nombre'].includes(c)).map((c) => COL_NOMBRES[c]).join(', ')}.`);
      }
      previa.innerHTML = `<div class="aviso">Listo para cargar <b>${m.filas.length}</b> empleados${m.omitidas ? ` (${m.omitidas} filas vacías omitidas)` : ''}.${m.faltantes.length ? ` Columnas no encontradas: ${m.faltantes.map((c) => COL_NOMBRES[c]).join(', ')}.` : ''}</div>
        <div><button class="btn" id="subir">Cargar empleados</button></div>`;
      previa.querySelector('#subir').addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
        const r = await llamar('cargarEmpleados', { filas: m.filas });
        if (!r.ok) return errorEn(err, r.message);
        const { resumen: x, revisar, sinFecha, total } = r.data;
        previa.innerHTML = `<div class="aviso"><b>${x.agregados}</b> agregados · <b>${x.actualizados}</b> actualizados · <b>${x.inactivados}</b> pasaron a inactivos · ${total} en total.</div>
          ${sinFecha ? `<div class="error-msg">${sinFecha} empleados activos sin fecha de ingreso.</div>` : ''}
          ${revisar.length ? `<div><h3>Cédulas por revisar (${revisar.length})</h3><p class="suave">Revisa que la cédula esté bien en el sistema de nómina.</p>
            <div class="lista">${revisar.slice(0, 30).map((v) => `<div class="item"><b>${esc(v.nombre)}</b><span class="suave">${esc(v.clave)} · ${esc(v.motivo)}</span></div>`).join('')}</div></div>` : ''}`;
        toast('Empleados cargados.'); listar('');
      }));
    } catch (x) { errorEn(err, x.message || 'No se pudo leer el archivo.'); }
  });

  let temporizador;
  const q = panel.querySelector('#q'), fDep = panel.querySelector('#f-dep'), fSin = panel.querySelector('#f-sinjefe'), dep = panel.querySelector('#dep'), depJefe = panel.querySelector('#dep-jefe');
  const refrescar = () => listar(q.value);
  q.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(refrescar, 300); });
  fDep.addEventListener('change', refrescar); fSin.addEventListener('change', refrescar);
  dep.addEventListener('change', () => { depJefe.disabled = !dep.value; });
  depJefe.addEventListener('click', () => elegirJefe(`Jefe de ${dep.value}`, async (jefe) => {
    const r = await llamar('asignarJefeDepartamento', { departamento: dep.value, jefe });
    if (!r.ok) return r;
    toast(`${r.data.cambiados} empleados actualizados.`); refrescar(); return r;
  }));
  let departamentosCargados = false;
  abrirSinJefe = false;

  async function listar(texto) {
    const caja = panel.querySelector('#lista');
    const r = await llamar('listarEmpleados', { buscar: texto, departamento: fDep.value, sinJefe: fSin.checked });
    if (!r.ok) { caja.innerHTML = `<div class="error-msg">${esc(r.message)}</div>`; return; }
    if (!departamentosCargados && r.data.departamentos.length) {
      departamentosCargados = true;
      const opciones = r.data.departamentos.map((d) => `<option>${esc(d)}</option>`).join('');
      dep.insertAdjacentHTML('beforeend', opciones); fDep.insertAdjacentHTML('beforeend', opciones);
    }
    const { empleados, total } = r.data;
    if (!empleados.length) { caja.innerHTML = '<p class="vacio">No hay empleados. Sube el Detalle de Empleado arriba.</p>'; return; }
    caja.innerHTML = `<p class="suave">${total} empleados${total > empleados.length ? ` · mostrando ${empleados.length}` : ''}</p>
      <div class="lista">${empleados.map((e) => `<div class="item">
        <div class="item-cab"><div><b>${esc(e.nombre)}</b><p class="suave">${esc(e.clave)} · ${esc(e.puesto)} · ingreso ${esc(e.fechaIngreso || 'sin fecha')}</p>
          <p class="suave">Jefe directo: <b>${e.jefeNombre ? esc(e.jefeNombre) : 'sin asignar'}</b></p></div>
          ${e.estado === 'Inactivo' ? '<span class="chip chip-neutro">Inactivo</span>' : e.revisarCedula ? '<span class="chip chip-espera">Revisar cédula</span>' : ''}</div>
        <div><button class="btn btn-sec btn-chico" data-jefe="${esc(e.clave)}" data-nombre="${esc(e.nombre)}">${e.jefe ? 'Cambiar jefe' : 'Asignar jefe'}</button></div>
        <label>Empresa del fideicomiso
          <select data-emp="${esc(e.clave)}"><option value="" ${e.empresaFideicomiso ? '' : 'selected'}>Automática (${esc(e.empresaDetalle)})</option>
            <option value="PCA" ${e.empresaFideicomiso === 'PCA' ? 'selected' : ''}>PCA</option><option value="AIV" ${e.empresaFideicomiso === 'AIV' ? 'selected' : ''}>AIV</option></select></label>
      </div>`).join('')}</div>`;
    caja.querySelectorAll('[data-jefe]').forEach((b) => b.addEventListener('click', () => elegirJefe(`Jefe de ${b.dataset.nombre}`, async (jefe) => {
      const r = await llamar('asignarJefe', { claves: [b.dataset.jefe], jefe });
      if (!r.ok) return r;
      if (r.data.omitidos.length) return { ok: false, message: 'Esa persona no puede ser jefe de este empleado (sería su propio jefe).' };
      toast(jefe ? 'Jefe asignado.' : 'Jefe quitado.'); refrescar(); return r;
    })));
    caja.querySelectorAll('[data-emp]').forEach((sel) => sel.addEventListener('change', async () => {
      const x = await llamar('fijarEmpresa', { clave: sel.dataset.emp, empresa: sel.value });
      toast(x.ok ? `Empresa del fideicomiso: ${x.data.empresa}` : x.message);
    }));
  }
  listar('');
}

/** Diálogo para buscar y elegir un jefe. `aplicar(claveJefe | '')` devuelve la respuesta de la API. */
function elegirJefe(titulo, aplicar) {
  dlg.innerHTML = `<form id="fj" novalidate onsubmit="return false"><h2>${esc(titulo)}</h2>
    <label>Buscar a la persona <input id="qj" placeholder="Nombre o cédula" autocomplete="off"></label>
    <div id="res" class="lista"><p class="vacio">Escribe al menos 2 letras.</p></div>
    <div class="error-msg" id="err" hidden></div>
    <div class="fila"><button class="btn btn-sec grow" type="button" id="quitar">Quitar jefe</button><button class="btn btn-sec" type="button" id="no">Cerrar</button></div></form>`;
  const res = dlg.querySelector('#res'), err = dlg.querySelector('#err'); let t;
  const aplicarYCerrar = async (jefe) => {
    errorEn(err, '');
    const r = await aplicar(jefe);
    if (r && !r.ok) return errorEn(err, r.message);
    dlg.close();
  };
  dlg.querySelector('#no').addEventListener('click', () => dlg.close());
  dlg.querySelector('#quitar').addEventListener('click', (e) => conBoton(e.currentTarget, () => aplicarYCerrar('')));
  dlg.querySelector('#qj').addEventListener('input', (e) => {
    clearTimeout(t); const texto = e.target.value.trim();
    if (texto.length < 2) { res.innerHTML = '<p class="vacio">Escribe al menos 2 letras.</p>'; return; }
    t = setTimeout(async () => {
      const r = await llamar('listarEmpleados', { buscar: texto });
      if (!r.ok) return errorEn(err, r.message);
      const activos = r.data.empleados.filter((x) => x.estado !== 'Inactivo').slice(0, 8);
      res.innerHTML = activos.length ? activos.map((x) => `<button type="button" class="item" data-j="${esc(x.clave)}" style="text-align:left;cursor:pointer"><b>${esc(x.nombre)}</b><span class="suave">${esc(x.puesto)} · ${esc(x.departamento)}</span></button>`).join('') : '<p class="vacio">Sin resultados.</p>';
      res.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => conBoton(b, () => aplicarYCerrar(b.dataset.j))));
    }, 250);
  });
  dlg.showModal(); dlg.querySelector('#qj').focus();
}

function panelCierres(panel) {
  const anio = new Date().getFullYear();
  panel.innerHTML = `<form class="tarjeta" id="fc" novalidate>
    <h2>Acreditar un trimestre</h2>
    <p class="aviso">Cuando el banco procese el aporte, acredítalo aquí. Desde ese momento los trabajadores lo ven en su estado de cuenta. El aporte debe estar en estado «Cerrado».</p>
    <div class="fila">
      <label class="grow">Año <input name="anio" type="number" value="${anio}" min="2020" max="2100"></label>
      <label class="grow">Trimestre <select name="trimestre"><option value="1">T1 · ene-mar</option><option value="2">T2 · abr-jun</option><option value="3">T3 · jul-sep</option><option value="4">T4 · oct-dic</option></select></label>
      <label class="grow">Empresa <select name="empresa"><option>PCA</option><option>AIV</option></select></label>
    </div>
    <div class="error-msg" id="err" hidden></div>
    <div><button class="btn" type="submit">Marcar como acreditado</button></div>
  </form>`;
  const f = panel.querySelector('#fc'), err = panel.querySelector('#err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); errorEn(err, '');
    await conBoton(f.querySelector('button'), async () => {
      const r = await llamar('estadoCierre', { anio: f.anio.value, trimestre: f.trimestre.value, empresa: f.empresa.value, estado: 'ACREDITADO' });
      if (!r.ok) return errorEn(err, r.message);
      toast(`${f.anio.value} T${f.trimestre.value} ${f.empresa.value} acreditado.`);
    });
  });
}

arrancar();
