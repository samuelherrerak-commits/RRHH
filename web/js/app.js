import { llamar, sesion, obtener, precargar, olvidar } from './api.js';
import { bs, esc, chip, fechaHora, leerMonto, fechaCaracas, chipConstancia } from './formato.js';
import { descargarConstanciaPdf, descargarConstanciaVacacionesPdf } from './constancia-pdf.js';
import { iniciarInstalacion, sugerirInstalacion } from './instalar.js';

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
  document.body.classList.toggle('en-entrada', !s);
  document.getElementById('usuario').textContent = s && s.nombre ? primerNombre(s.nombre) + (s.rol !== 'TRABAJADOR' ? ' · Gestión Humana' : '') : '';
  if (s) setTimeout(sugerirInstalacion, 1200);   // después de entrar, sin tapar lo primero que se ve
  if (s && s.rol !== 'TRABAJADOR') return vistaRRHH();
  if (s) { precargarTrabajador(); return vistaCuenta(app, '', seccionDesdeHash()); }
  return vistaLogin();
}
btnSalir.addEventListener('click', () => { sesion.borrar(); olvidar(); history.replaceState(null, '', location.pathname); arrancar(); });
window.addEventListener('hashchange', () => arrancar());

/* ---------- Trabajador: entrada ---------- */

function vistaLogin() {
  app.innerHTML = `
    <div class="entrada">
      <section class="entrada-marca">
        <div>
          <div class="sigla">SADS</div>
          <p class="nombre">Sistema de Atención de Solicitudes</p>
        </div>
        <div class="acrostico" role="img" aria-label="SADS: Sistema de Atención de Solicitudes">
          <p><b>S</b>istema<span class="de">de</span></p><p><b>A</b>tención</p><p><b>D</b>e</p><p><b>S</b>olicitudes</p>
        </div>
        <p class="empresas">Prosein · Austral · Mil Cerámicas — Gestión Humana</p>
      </section>
      <div class="entrada-form">
    <form class="tarjeta login" id="f" novalidate>
      <div><h2>Bienvenido</h2><p class="suave">Escribe tu cédula para hacer tus solicitudes: constancia de trabajo, vacaciones y más.</p></div>
      <label>Cédula <input name="cedula" inputmode="numeric" autocomplete="username" placeholder="Solo números" maxlength="14" required></label>
      <label id="lbl-clave" hidden>Clave <input name="clave" type="password" autocomplete="current-password"></label>
      <div class="error-msg" id="err" hidden></div>
      <button class="btn" type="submit">Entrar</button>
      <button class="btn btn-sec" type="button" id="otra" hidden>Usar otra cédula</button>
    </form>
      </div>
    </div>`;
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
        sesion.guardar({ token: r.data.token, rol: r.data.rol, nombre: r.data.nombre, genero: r.data.genero || '', tokenTrabajador: r.data.tokenTrabajador || '', esJefe: !!r.data.esJefe });
        precargar('bandejaVacaciones', { estado: estadoVacRRHH });
        if (r.data.tokenTrabajador) precargarTrabajador({ token: r.data.tokenTrabajador });
        if (r.data.esJefe && !r.data.tokenTrabajador) precargar('equipoVacaciones');   // si es empleado, su equipo va en «Mi cuenta» (ya precargado)
        return arrancar();
      }
      const r = await llamar('login', { cedula: f.cedula.value, token: '' });
      if (!r.ok) return errorEn(err, r.message);
      if (r.data.requiereClave) {            // la cédula es de Recursos Humanos: pide la clave
        pideClave = true; f.cedula.readOnly = true; lblClave.hidden = false; otra.hidden = false; f.clave.required = true; f.clave.focus();
        return;
      }
      sesion.guardar({ token: r.data.token, rol: 'TRABAJADOR', nombre: r.data.nombre, genero: r.data.genero || '' });
      precargarTrabajador();
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
const FIDEICOMISO_ACTIVO = true;
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
  inicio: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
  volver: '<path d="m15 18-6-6 6-6"/>',
  ir: '<path d="m9 18 6-6-6-6"/>',
};
const icono = (n, clase = 'icono') => `<svg class="${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n]}</svg>`;
const volver = () => `<button class="volver" type="button" data-ir="inicio">${icono('volver')} Volver al inicio</button>`;

const MENU_TRABAJADOR = [['inicio', 'Inicio', 'inicio'], ['constancia', 'Constancia de trabajo', 'constancia'], ['vacaciones', 'Vacaciones', 'vacaciones'], ['fideicomiso', 'Fideicomiso', 'fideicomiso']];

/** Sitio del trabajador: en computadora, menú lateral fijo; en el celular, el inicio con tarjetas y «Volver». */
function marcoTrabajador() {
  let destino = app.querySelector('#contenido');
  if (!destino) {
    app.innerHTML = `<div class="layout"><nav class="lateral" aria-label="Secciones">
        <p class="lateral-titulo">Mis solicitudes</p>
        ${MENU_TRABAJADOR.map(([id, t, ic]) => `<button type="button" data-ir="${id}">${icono(ic)} ${t}</button>`).join('')}
      </nav><div class="contenido" id="contenido"></div></div>`;
    app.querySelectorAll('.lateral [data-ir]').forEach((b) => b.addEventListener('click', () => navegar(b.dataset.ir)));
    destino = app.querySelector('#contenido');
    obtener('equipoVacaciones').then((r) => {      // los jefes ven además «Mi equipo»
      const nav = app.querySelector('.lateral');
      if (!r.ok || !r.data.esJefe || !nav || nav.querySelector('[data-ir=equipo]')) return;
      const n = r.data.pendientes.length;
      nav.insertAdjacentHTML('beforeend', `<button type="button" data-ir="equipo">${icono('equipo')} Mi equipo${n ? ` <span class="chip chip-espera">${n}</span>` : ''}</button>`);
      nav.querySelector('[data-ir=equipo]').addEventListener('click', () => navegar('equipo'));
      marcarMenu(cuenta.seccion);
    });
  }
  return destino;
}

function marcarMenu(seccion) {
  app.querySelectorAll('.lateral [data-ir]').forEach((b) => (b.dataset.ir === seccion ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

async function vistaCuenta(cont = app, token = '', seccion = 'inicio') {
  cuenta = { cont, token, seccion };
  btnSalir.hidden = false;
  window.scrollTo(0, 0);
  const destino = cont === app ? marcoTrabajador() : cont;
  if (cont === app) marcarMenu(seccion);
  if (seccion === 'constancia') await seccionConstancia(destino);
  else if (seccion === 'vacaciones') await seccionVacaciones(destino);
  else if (seccion === 'equipo') await seccionEquipo(destino);
  else if (seccion === 'fideicomiso') await seccionFideicomiso(destino);
  else seccionInicio(destino);
  if (cont !== app && !token) destino.querySelectorAll('.volver').forEach((b) => b.remove());   // «Mi equipo» del panel de RRHH
  destino.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => navegar(b.dataset.ir)));
}

/** Mientras la persona ve su inicio, se piden en segundo plano los datos de cada tarjeta. */
async function precargarTrabajador(tk = {}) {
  // De una en una: así cada persona ocupa un solo cupo de Google a la vez (el límite es 30 simultáneas).
  for (const accion of ['datosVacaciones', 'misConstancias', 'datosAnticipo', 'equipoVacaciones']) {
    await obtener(accion, tk).catch(() => {});
  }
}

/** Bloques grises animados mientras llega la respuesta (se nota menos la espera que con un texto). */
const esqueleto = (n = 2) => `<div class="esqueleto" aria-busy="true" aria-label="Cargando">${'<div class="esq-tarjeta"><span></span><span></span><span></span></div>'.repeat(n)}</div>`;

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
      ${tarjeta('fideicomiso', 'Fideicomiso', 'Solicita un anticipo de tus prestaciones sociales.', 'carbon', FIDEICOMISO_ACTIVO ? '' : '<span class="chip chip-neutro">Próximamente</span>')}
    </nav>`;
  // Si es jefe de alguien, aparece «Mi equipo» con las solicitudes por aprobar
  obtener('equipoVacaciones', conToken()).then((r) => {
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
  cont.innerHTML = `${volver()}${esqueleto(2)}`;
  const rc = await obtener('misConstancias', conToken());
  if (!rc.ok && rc.code === 'SESION') { toast(rc.message); return arrancar(); }
  const constancias = rc.ok ? rc.data : [];
  const vigente = constancias.find((c) => c.estado === 'VIGENTE');
  cont.innerHTML = `${volver()}<div class="dos-col"><div class="col">
    <section class="tarjeta">
      <h2>Constancia de trabajo</h2>
      <p class="suave">Se genera al instante en PDF, con el membrete de tu empresa, tu sueldo mensual y un código QR para verificarla. Tiene una vigencia de 30 días.</p>
      ${vigente ? `<p class="aviso">Tienes una constancia vigente hasta el <b>${fechaCaracas(vigente.vence)}</b>. Puedes descargarla las veces que necesites; podrás generar una nueva cuando venza.</p>
        <div><button class="btn" id="btn-vigente">Descargar mi constancia vigente</button></div>`
        : '<div><button class="btn" id="btn-constancia">Generar constancia de trabajo</button></div>'}
      <div class="error-msg" id="err-const" hidden></div>
    </section>
    </div><div class="col">
    ${constancias.length ? `<section class="tarjeta"><h2>Mis constancias</h2><div class="lista">${constancias.map((c) => `
      <div class="item"><div class="item-cab"><div><b>Emitida el ${fechaCaracas(c.emision)}</b><p class="suave">Vence el ${fechaCaracas(c.vence)}</p></div>${chipConstancia(c.estado)}</div>
      </div>`).join('')}</div></section>` : ''}</div></div>`;

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
  cont.innerHTML = `${volver()}${esqueleto(3)}`;
  const r = await obtener('datosVacaciones', conToken());
  if (!r.ok) { if (r.code === 'SESION') { toast(r.message); return arrancar(); } cont.innerHTML = `${volver()}<p class="error-msg">${esc(r.message)}</p>`; return; }
  const d = r.data, s = d.saldo;
  const desde = V().sumarDiasTxt(d.hoy, d.reglas.anticipacionMin), hasta = V().sumarDiasTxt(d.hoy, d.reglas.anticipacionMax);

  cont.innerHTML = `${volver()}<div class="dos-col"><div class="col">
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
    </div><div class="col">
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
          ${['APROBADA_JEFE', 'REGISTRADA'].includes(x.estado) && x.numeroConstancia ? `<div><button class="btn btn-azul btn-chico" data-pdf-vac="${esc(x.id)}">Descargar constancia de aprobación</button></div>` : ''}
        </div>`).join('')}</div>` : '<p class="vacio">Todavía no has hecho solicitudes en el sistema.</p>'}
    </section></div></div>`;

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
  cont.innerHTML = `${volver()}${esqueleto(2)}`;
  const r = await obtener('equipoVacaciones', conToken());
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { pendientes, recientes, equipo } = r.data;
  const item = (x, acciones = '') => `<div class="item">
      <div class="item-cab"><div><b>${esc(x.nombre)}</b><p class="suave">${esc(resumenFechas(x))}</p></div>${chipVac(x.estado, ESTADOS_VAC_JEFE)}</div>
      ${x.estado === 'RECHAZADA' && x.motivoRechazo ? `<p class="suave">Motivo: ${esc(x.motivoRechazo)}</p>` : ''}${acciones}</div>`;
  cont.innerHTML = `${volver()}<div class="dos-col"><div class="col">
    <section class="tarjeta"><h2>Vacaciones por aprobar (${pendientes.length})</h2>
      <p class="suave">Tu equipo: ${equipo} persona${equipo === 1 ? '' : 's'}. Al aprobar, la solicitud pasa a Gestión Humana para registrarla.</p>
      ${pendientes.length ? `<div class="lista">${pendientes.map((x) => item(x, `<div class="fila"><button class="btn btn-chico" data-ap-vac="${esc(x.id)}">Aprobar</button><button class="btn btn-sec btn-chico" data-re-vac="${esc(x.id)}">Rechazar</button></div>`)).join('')}</div>`
        : '<p class="vacio">No hay solicitudes pendientes.</p>'}
    </section>
    </div><div class="col">
    ${recientes.length ? `<section class="tarjeta"><h2>Revisadas recientemente</h2><div class="lista">${recientes.map((x) => item(x)).join('')}</div></section>` : ''}</div></div>`;
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
  cont.innerHTML = `${volver()}${esqueleto(2)}`;
  const r = await obtener('datosAnticipo', conToken());
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { activa, proxima: prox, motivos, puedeSolicitar, actual, anticipos } = r.data;
  const rango = (a) => `del <b>${V().corta(a.inicio)}</b> al <b>${V().corta(a.fin)}</b>`;
  const luego = prox ? `La próxima apertura es ${rango(prox)} (${esc(prox.etiqueta)}).` : 'Gestión Humana anunciará la próxima apertura.';
  const historial = anticipos.length ? `<div class="lista">${anticipos.map((a) => `
      <div class="item">
        <div class="item-cab"><b>${bs(a.monto)}</b>${chip(a.estado)}</div>
        <p class="suave">${esc(a.motivo)}${a.ventanaEtiqueta ? ` · ${esc(a.ventanaEtiqueta)}` : ''} · ${fechaHora(a.creada)}</p>
        ${a.estado === 'RECHAZADA' && a.motivoRechazo ? `<p class="error-msg">Motivo: ${esc(a.motivoRechazo)}</p>` : ''}
        ${a.estado === 'PENDIENTE' ? `<div><button class="btn btn-sec btn-chico" data-cancelar="${esc(a.id)}">Cancelar solicitud</button></div>` : ''}
      </div>`).join('')}</div>` : '<p class="vacio">Todavía no has hecho solicitudes.</p>';

  cont.innerHTML = `${volver()}<div class="dos-col"><div class="col">
    <section class="tarjeta">
      <div><h2>Anticipo de prestaciones sociales</h2>${activa ? `<p class="suave">Solicitud del ${esc(activa.etiqueta)} · abierta ${rango(activa)}</p>` : ''}</div>
      ${!activa ? `<p class="aviso">La solicitud de anticipos <b>no está abierta</b> en este momento. ${luego}</p>` : puedeSolicitar ? `
      <ol class="pasos">
        <li>Ingresa a la página de <b>tu banco</b> y revisa tu <b>monto disponible</b> del fideicomiso.</li>
        <li>Escribe aquí el monto que quieres anticipar y el motivo.</li>
      </ol>
      <p class="advertencia">Envías el monto <b>bajo tu responsabilidad</b>. Si es <b>mayor a tu disponible</b>, el banco rechazará la solicitud y podrás hacer una nueva en la próxima apertura${prox ? ` (${rango(prox)})` : ''}. Solo se acepta una solicitud por apertura.</p>
      <form id="fant" class="form-vac" novalidate>
        <label>Monto a solicitar (Bs.) <input name="monto" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>
        <label>Motivo <select name="motivo"><option value="">Elige el motivo</option>${motivos.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
        <label id="lbl-det" hidden>Explica el motivo <textarea name="detalle" maxlength="300"></textarea></label>
        <label class="acepto"><input type="checkbox" name="acepta"> <span>Revisé mi disponible en el banco y envío este monto bajo mi responsabilidad. Si supera mi disponible, el banco rechazará la solicitud.</span></label>
        <div class="error-msg" id="err-ant" hidden></div>
        <div><button class="btn" type="submit">Enviar solicitud</button></div>
      </form>` : `
      <div class="item">
        <div class="item-cab"><b>${bs(actual.monto)}</b>${chip(actual.estado)}</div>
        <p class="suave">${esc(actual.motivo)} · enviada el ${fechaHora(actual.creada)}</p>
        ${actual.estado === 'RECHAZADA' && actual.motivoRechazo ? `<p class="error-msg">Motivo: ${esc(actual.motivoRechazo)}</p>` : ''}
      </div>
      <p class="aviso">Ya enviaste tu solicitud del ${esc(activa.etiqueta)}. ${luego}</p>`}
    </section>
    </div><div class="col">
    <section class="tarjeta"><h2>Mis solicitudes</h2>${historial}</section>
    </div></div>`;

  const f = cont.querySelector('#fant');
  if (f) {
    const err = cont.querySelector('#err-ant');
    f.motivo.addEventListener('change', () => { cont.querySelector('#lbl-det').hidden = f.motivo.value !== 'Otro'; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); errorEn(err, '');
      const monto = leerMonto(f.monto.value);
      if (!(monto > 0)) return errorEn(err, 'Escribe el monto que quieres solicitar.');
      if (!f.motivo.value) return errorEn(err, 'Elige el motivo.');
      if (f.motivo.value === 'Otro' && !f.detalle.value.trim()) return errorEn(err, 'Explica el motivo.');
      if (!f.acepta.checked) return errorEn(err, 'Marca la casilla para confirmar que revisaste tu disponible en el banco.');
      if (!confirm(`¿Enviar la solicitud de anticipo por ${bs(monto)}? Solo puedes enviar una por apertura.`)) return;
      await conBoton(f.querySelector('button[type=submit]'), async () => {
        const x = await llamar('solicitarAnticipo', { monto, motivo: f.motivo.value, detalle: f.detalle.value, acepta: true, ...conToken() });
        if (!x.ok) return errorEn(err, x.message);
        toast('Solicitud enviada. Gestión Humana la enviará al banco.'); vistaCuenta(cuenta.cont, cuenta.token, 'fideicomiso');
      });
    });
  }
  cont.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    if (!confirm('¿Cancelar esta solicitud? Podrás enviar otra mientras la solicitud siga abierta.')) return;
    const x = await llamar('cancelarAnticipo', { id: b.dataset.cancelar, ...conToken() });
    toast(x.ok ? 'Solicitud cancelada.' : x.message);
    vistaCuenta(cuenta.cont, cuenta.token, 'fideicomiso');
  })));
}

/* ---------- RRHH: panel ---------- */

let pestana = 'vacaciones';
let abrirSinJefe = false;   // al venir desde Vacaciones → Empleados con el filtro «solo sin jefe»

async function vistaRRHH() {
  btnSalir.hidden = false;
  const miCuenta = !!(sesion.leer() || {}).tokenTrabajador;
  const miEquipo = !!(sesion.leer() || {}).esJefe && !miCuenta;   // si es empleado, su equipo está en «Mi cuenta»
  if (['solicitudes', 'banco', 'anticipos', 'cierres'].includes(pestana)) { subFide = pestana === 'cierres' ? 'aportes' : 'anticipos'; pestana = 'fideicomiso'; }
  if ((pestana === 'micuenta' && !miCuenta) || (pestana === 'miequipo' && !miEquipo)) pestana = 'vacaciones';
  app.innerHTML = `<div class="layout">
    <div class="pestanas" role="tablist" aria-orientation="vertical"><p class="lateral-titulo">Gestión Humana</p>
      ${[['vacaciones', 'Vacaciones'], ['empleados', 'Empleados'], ['constancias', 'Constancias'], ['fideicomiso', 'Fideicomiso'], ...(miCuenta ? [['micuenta', 'Mi cuenta']] : []), ...(miEquipo ? [['miequipo', 'Mi equipo']] : [])].map(([k, t]) =>
        `<button class="pestana" role="tab" data-p="${k}" aria-selected="${k === pestana}">${t}</button>`).join('')}
    </div>
    <div id="panel" class="contenido"></div></div>`;
  app.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => { pestana = b.dataset.p; vistaRRHH(); }));
  const panel = app.querySelector('#panel');
  if (pestana === 'fideicomiso') return panelFideicomiso(panel);
  if (pestana === 'empleados') return panelEmpleados(panel);
  if (pestana === 'constancias') return panelConstancias(panel);
  if (pestana === 'vacaciones') return panelVacaciones(panel);
  if (pestana === 'miequipo') return vistaCuenta(panel, '', 'equipo');
  if (pestana === 'micuenta') return vistaCuenta(panel, sesion.leer().tokenTrabajador);
  return panelVacaciones(panel);
}

const tarjetaAnticipo = (a, acciones = '') => `
  <div class="item">
    <div class="item-cab"><div><b>${esc(a.nombre)}</b><p class="suave">${esc(a.clave)} · ${esc(a.empresa)}</p></div>${chip(a.estado)}</div>
    <div class="fila"><b>${bs(a.monto)}</b><span class="suave">${esc(a.motivo)}${a.ventanaEtiqueta ? ` · ${esc(a.ventanaEtiqueta)}` : ''} · ${fechaHora(a.creada)}</span></div>
    ${a.detalle ? `<p class="suave">“${esc(a.detalle)}”</p>` : ''}${acciones}
  </div>`;

function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- RRHH: Fideicomiso (Aportes · Anticipos · Cancelaciones) ---------- */

let subFide = 'aportes';
const SUBMODULOS = [['aportes', 'Aportes'], ['anticipos', 'Anticipos'], ['cancelaciones', 'Cancelaciones']];

function panelFideicomiso(panel) {
  panel.innerHTML = `<div class="submodulos" role="tablist">${SUBMODULOS.map(([k, t]) => `<button class="submodulo" role="tab" data-sub="${k}" aria-selected="${k === subFide}">${t}</button>`).join('')}</div><div id="sub"></div>`;
  panel.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => { subFide = b.dataset.sub; panelFideicomiso(panel); }));
  const sub = panel.querySelector('#sub');
  if (subFide === 'anticipos') return panelAnticipos(sub);
  if (subFide === 'cancelaciones') return panelCancelaciones(sub);
  return panelAportes(sub);
}

/* ---- Aportes trimestrales ---- */

const ESTADO_APORTE = { '': ['Sin aporte', 'neutro'], ABIERTO: ['Reabierto', 'espera'], CERRADO: ['Cerrado', 'austral'], ACREDITADO: ['Acreditado por el banco', 'ok'] };
// Por defecto, el trimestre que acaba de terminar (en enero: el 4.º del año anterior)
const periodoAporte = (() => { const h = new Date(), q = Math.ceil((h.getMonth() + 1) / 3); return q === 1 ? { anio: h.getFullYear() - 1, trimestre: 4, empresa: 'PCA' } : { anio: h.getFullYear(), trimestre: q - 1, empresa: 'PCA' }; })();
let borradorAporte = null;   // { filas, forzados, vista } mientras se revisa la vista previa

/** Lee el Excel del aporte: columnas «nombre» y «monto» (por título o, si no hay, las dos primeras). */
async function leerExcelAporte(archivo) {
  const XLSX = await cargarXlsx();
  const libro = await leerLibro(archivo);
  const m = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const norm = (x) => window.Empleados.normalizarNombre(x);
  let fila0 = m.findIndex((r) => r.some((c) => /NOMBRE|EMPLEADO|TRABAJADOR/.test(norm(c))) && r.some((c) => /MONTO|TOTAL|DEVENGADO|GANADO|SALARIO/.test(norm(c))));
  let iN = 0, iM = 1;
  if (fila0 !== -1) { iN = m[fila0].findIndex((c) => /NOMBRE|EMPLEADO|TRABAJADOR/.test(norm(c))); iM = m[fila0].findIndex((c) => /MONTO|TOTAL|DEVENGADO|GANADO|SALARIO/.test(norm(c))); }
  return m.slice(fila0 + 1).map((r) => ({ nombre: String(r[iN] ?? '').trim(), monto: typeof r[iM] === 'number' ? r[iM] : leerMonto(r[iM]) }))
    .filter((f) => f.nombre && !/^TOTAL/i.test(f.nombre) && Number.isFinite(f.monto));
}

async function panelAportes(panel) {
  const P = periodoAporte;
  panel.innerHTML = `<section class="tarjeta">
      <div class="fila">
        <label class="grow">Año <input id="ap-anio" type="number" min="2020" max="2100" value="${P.anio}"></label>
        <label class="grow">Trimestre <select id="ap-trim">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === P.trimestre ? 'selected' : ''}>${['', '1.er', '2.º', '3.er', '4.º'][q]} trimestre</option>`).join('')}</select></label>
        <label class="grow">Empresa <select id="ap-emp"><option value="PCA">Prosein (PCA)</option><option value="AIV" ${P.empresa === 'AIV' ? 'selected' : ''}>Austral (AIV)</option></select></label>
      </div></section><div id="ap-cuerpo">${esqueleto(2)}</div>`;
  const cambiar = () => { P.anio = Number(panel.querySelector('#ap-anio').value); P.trimestre = Number(panel.querySelector('#ap-trim').value); P.empresa = panel.querySelector('#ap-emp').value; borradorAporte = null; panelAportes(panel); };
  ['#ap-anio', '#ap-trim', '#ap-emp'].forEach((q) => panel.querySelector(q).addEventListener('change', cambiar));
  const cuerpo = panel.querySelector('#ap-cuerpo');
  if (borradorAporte && borradorAporte.clavePeriodo === JSON.stringify(P)) return pintarVistaAporte(cuerpo, panel);
  const r = await obtener('estadoAporte', { ...P });
  if (!r.ok) { cuerpo.innerHTML = `<p class="error-msg">${esc(r.message)}</p>`; return; }
  const d = r.data, [et, tono] = ESTADO_APORTE[d.estado] || ESTADO_APORTE[''];
  const etiqueta = `${['', '1.er', '2.º', '3.er', '4.º'][P.trimestre]} trimestre de ${P.anio} · ${P.empresa}`;
  const cerrado = d.estado === 'CERRADO' || d.estado === 'ACREDITADO';
  cuerpo.innerHTML = `<div class="dos-col der-angosta"><div class="col">
    <section class="tarjeta">
      <div class="item-cab"><div><h2>Aporte del ${etiqueta}</h2>${d.actualizado ? `<p class="suave">Actualizado el ${fechaHora(d.actualizado)}</p>` : ''}</div><span class="chip chip-${tono}">${et}</span></div>
      ${cerrado ? `<div class="cifras"><div class="cifra"><b>${d.totales.personas}</b><span>Personas</span></div><div class="cifra"><b>${bs(d.totales.total)}</b><span>Total del aporte</span></div><div class="cifra"><b>${d.totales.nuevos}</b><span>Nuevos ingresos</span></div></div>
        <div class="fila"><button class="btn" data-arch="NOMINA">Descargar NOMINA APORTES</button><button class="btn btn-sec" data-arch="NUEVOS" ${d.totales.nuevos ? '' : 'disabled'}>Descargar nuevos ingresos</button></div>
        ${d.estado === 'CERRADO' ? `<p class="suave">Cuando el banco procese el aporte, márcalo como acreditado: desde ese momento cada colaborador lo verá en su estado de cuenta.</p>
        <div class="fila"><button class="btn btn-sec" id="ap-acreditar">Marcar acreditado por el banco</button><button class="btn btn-sec" id="ap-reabrir">Reabrir y reemplazar</button></div>` : ''}`
      : `<p class="suave">Sube el Excel del trimestre con dos columnas: <b>nombre</b> del empleado y <b>monto</b> ganado en el trimestre. Verás el cálculo de cada persona antes de cerrarlo.${d.primeraCarga ? ' Es el primer aporte de esta empresa en el sistema: solo se marcarán como nuevos quienes ingresaron en el trimestre.' : ''}</p>
        <label>Excel del trimestre <input type="file" id="ap-arch" accept=".xlsx,.xls,.csv"></label><div class="error-msg" id="ap-err" hidden></div>`}
    </section>
    </div><div class="col">
    <section class="tarjeta"><h2>Cómo se calcula</h2>
      <p class="suave">Salario diario = monto ÷ (30 × meses) · Alícuota de utilidades = diario × 120 ÷ 360 · Alícuota de vacaciones = diario × días de vacaciones ÷ 360 · Días = 5 por mes + adicionales (en el trimestre del aniversario: 2 × (años − 1), hasta 30).</p>
      <p class="suave">Total = (diario + alícuotas) × (días de antigüedad + adicionales). Los parámetros (año base, días mínimos del mes, días de utilidades) están en la hoja PARAMETROS.</p>
    </section></div></div>
    ${cerrado && d.lineas.length ? `<section class="tarjeta"><h2>Detalle por empleado (${d.lineas.length})</h2>${tablaAporte(d.lineas.slice().sort((a, b) => (a.nombre < b.nombre ? -1 : 1)), false)}<p class="suave">* Días adicionales forzados a mano.</p></section>` : ''}`;

  cuerpo.querySelectorAll('[data-arch]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const x = await llamar('archivoAporte', { ...P, tipo: b.dataset.arch });
    if (!x.ok) return toast(x.message);
    descargar(`${b.dataset.arch === 'NUEVOS' ? 'NUEVOS_INGRESOS' : 'NOMINA_APORTES'}_${P.empresa}_${P.anio}_T${P.trimestre}.csv`, x.data.csv);
  })));
  cuerpo.querySelector('#ap-acreditar')?.addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    if (!confirm('¿El banco ya procesó este aporte? Los colaboradores lo verán en su estado de cuenta y ya no se podrá cambiar.')) return;
    const x = await llamar('estadoCierre', { ...P, estado: 'ACREDITADO' });
    toast(x.ok ? 'Aporte acreditado.' : x.message); panelAportes(panel);
  }));
  cuerpo.querySelector('#ap-reabrir')?.addEventListener('click', () => {
    if (!confirm('¿Reabrir este aporte? Subirás un Excel nuevo y su cálculo reemplazará al actual.')) return;
    borradorAporte = { clavePeriodo: JSON.stringify(P), reemplazar: true, filas: null };
    pintarVistaAporte(cuerpo, panel);
  });
  cuerpo.querySelector('#ap-arch')?.addEventListener('change', (e) => cargarExcelAporte(e.target.files[0], cuerpo, panel, false));
}

async function cargarExcelAporte(archivo, cuerpo, panel, reemplazar) {
  if (!archivo) return;
  const err = cuerpo.querySelector('#ap-err');
  try {
    const filas = await leerExcelAporte(archivo);
    if (!filas.length) return errorEn(err, 'No encontré filas con nombre y monto en el Excel.');
    borradorAporte = { clavePeriodo: JSON.stringify(periodoAporte), reemplazar, filas, forzados: {} };
    await recalcularAporte(cuerpo, panel);
  } catch (x) { errorEn(err, x.message || 'No se pudo leer el Excel.'); }
}

async function recalcularAporte(cuerpo, panel) {
  cuerpo.innerHTML = esqueleto(2);
  const r = await llamar('prepararAporte', { ...periodoAporte, filas: borradorAporte.filas, forzados: borradorAporte.forzados });
  if (!r.ok) { borradorAporte = null; toast(r.message); return panelAportes(panel); }
  borradorAporte.vista = r.data;
  pintarVistaAporte(cuerpo, panel);
}

function tablaAporte(lineas, editable) {
  return `<div class="tabla-caja"><table class="tabla-aporte"><thead><tr><th>Empleado</th><th>Ingreso</th><th class="num">Meses</th><th class="num">Monto</th><th class="num">Diario</th><th class="num">Días</th><th class="num">Adic.</th><th class="num">Total</th></tr></thead><tbody>
    ${lineas.map((l) => `<tr><td>${esc(l.nombre)} ${l.nuevo ? '<span class="chip chip-austral">Nuevo</span>' : ''}</td><td>${esc(l.fechaIngreso || '—')}</td><td class="num">${l.meses}</td><td class="num">${bs(l.monto)}</td>
      <td class="num">${bs(l.salarioDiario)}</td><td class="num">${l.diasAntiguedad}</td>
      <td class="num">${editable ? `<input class="adic" type="number" min="0" max="30" step="1" data-forzar="${esc(l.clave)}" value="${l.diasAdicionales}" title="Días adicionales (cámbialo para forzarlo)">` : `${l.diasAdicionales}${l.adicionalesForzados ? '*' : ''}`}</td>
      <td class="num"><b>${bs(l.total)}</b></td></tr>`).join('')}</tbody></table></div>`;
}

const GRUPOS_ALERTA = [['EXCEL_SIN_EMPLEADO', 'Nombres del Excel sin empleado (no se incluyen)'], ['SIN_MONTO', 'Activos de la empresa sin monto en el Excel'],
  ['MONTO_NO_POSITIVO', 'Montos en cero o negativos'], ['SIN_FECHA_INGRESO', 'Sin fecha de ingreso'], ['SIN_MESES', 'Ingresaron después del trimestre'], ['DUPLICADA', 'Filas repetidas']];
function alertasAgrupadas(alertas) {
  return GRUPOS_ALERTA.map(([tipo, titulo]) => {
    const g = alertas.filter((a) => a.tipo === tipo);
    return g.length ? `<details class="grupo-alerta" ${g.length <= 5 ? 'open' : ''}><summary><b>${g.length}</b> ${titulo}</summary><ul class="lista-simple">${g.map((a) => `<li>${esc(a.texto)}</li>`).join('')}</ul></details>` : '';
  }).join('');
}

function pintarVistaAporte(cuerpo, panel) {
  const B = borradorAporte, P = periodoAporte;
  if (!B.filas) {          // reabriendo: falta el Excel nuevo
    cuerpo.innerHTML = `<section class="tarjeta"><h2>Reemplazar el aporte</h2><p class="suave">Sube el Excel corregido del trimestre. El cálculo nuevo reemplazará al actual (no se duplica).</p>
      <label>Excel del trimestre <input type="file" id="ap-arch" accept=".xlsx,.xls,.csv"></label><div class="error-msg" id="ap-err" hidden></div>
      <div><button class="btn btn-sec" id="ap-volver">Cancelar</button></div></section>`;
    cuerpo.querySelector('#ap-arch').addEventListener('change', (e) => cargarExcelAporte(e.target.files[0], cuerpo, panel, true));
    cuerpo.querySelector('#ap-volver').addEventListener('click', () => { borradorAporte = null; panelAportes(panel); });
    return;
  }
  const v = B.vista, t = v.totales;
  cuerpo.innerHTML = `<div class="dos-col der-angosta"><div class="col">
    <section class="tarjeta"><div class="item-cab"><h2>Vista previa · ${['', '1.er', '2.º', '3.er', '4.º'][P.trimestre]} trimestre de ${P.anio} · ${P.empresa}</h2><span class="chip chip-espera">Sin guardar</span></div>
      <div class="cifras"><div class="cifra"><b>${t.personas}</b><span>Personas</span></div><div class="cifra"><b>${bs(t.total)}</b><span>Total del aporte</span></div>
        <div class="cifra"><b>${t.nuevos}</b><span>Nuevos · ${bs(t.totalNuevos)}</span></div><div class="cifra"><b>${t.retirados}</b><span>Retirados</span></div></div>
      ${v.primeraCarga ? '<p class="aviso">Primer aporte de esta empresa en el sistema: no hay trimestre anterior para comparar. Solo son «nuevos» quienes ingresaron en el trimestre y no se detectan retirados.</p>' : ''}
      ${v.sugeridas.length ? `<div class="advertencia"><b>Confirma ${v.sugeridas.length} nombre${v.sugeridas.length === 1 ? '' : 's'} del Excel</b> que no coinciden exacto:
        <div class="lista" style="margin-top:8px">${v.sugeridas.map((x) => `<label>«${esc(x.nombre)}» (${bs(x.monto)}) <select data-resolver="${x.fila}"><option value="">Elige al empleado…</option>${x.candidatos.map((c) => `<option value="${esc(c.clave)}">${esc(c.nombre)} (${c.puntaje} %)</option>`).join('')}<option value="-">No es ninguno: no incluir</option></select></label>`).join('')}</div></div>` : ''}
      <div class="fila"><button class="btn btn-sec" id="ap-recalcular">Recalcular</button><button class="btn" id="ap-cerrar" ${v.listo ? '' : 'disabled'}>${B.reemplazar ? 'Reemplazar aporte' : 'Cerrar aporte'}</button><button class="btn btn-sec" id="ap-descartar">Descartar</button></div>
      <div class="error-msg" id="ap-err" hidden></div>
    </section>
    </div><div class="col">
    ${v.alertas.length ? `<section class="tarjeta"><h2>Alertas</h2>${alertasAgrupadas(v.alertas)}</section>` : '<section class="tarjeta"><h2>Alertas</h2><p class="vacio">Sin alertas.</p></section>'}
    ${v.retirados.length ? `<section class="tarjeta"><h2>Retirados (${v.retirados.length})</h2><p class="suave">Estaban en el aporte anterior y ya no están activos. Registra su cancelación en «Cancelaciones».</p>
      <ul class="lista-simple">${v.retirados.map((x) => `<li>${esc(x.nombre || x.clave)}${x.fechaIngreso ? ` · ingreso ${esc(x.fechaIngreso)}` : ''}</li>`).join('')}</ul></section>` : ''}
    </div></div>
    <section class="tarjeta"><h2>Detalle por empleado (${v.lineas.length})</h2><p class="suave">Puedes forzar los días adicionales de una persona; luego toca «Recalcular».</p>${tablaAporte(v.lineas, true)}</section>`;
  const leer = () => {
    cuerpo.querySelectorAll('[data-resolver]').forEach((s) => { if (s.value) { const f = B.filas[Number(s.dataset.resolver)]; if (s.value === '-') f.excluir = true; else f.clave = s.value; } });
    B.filas = B.filas.filter((f) => !f.excluir);
    cuerpo.querySelectorAll('[data-forzar]').forEach((i) => { const l = v.lineas.find((x) => x.clave === i.dataset.forzar); if (Number(i.value) !== l.diasAdicionales || l.adicionalesForzados) B.forzados[i.dataset.forzar] = Number(i.value); });
  };
  cuerpo.querySelector('#ap-recalcular').addEventListener('click', () => { leer(); recalcularAporte(cuerpo, panel); });
  cuerpo.querySelector('#ap-descartar').addEventListener('click', () => { borradorAporte = null; panelAportes(panel); });
  cuerpo.querySelectorAll('[data-resolver]').forEach((s) => s.addEventListener('change', () => { leer(); recalcularAporte(cuerpo, panel); }));
  cuerpo.querySelector('#ap-cerrar').addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    leer();
    if (!confirm(`¿${B.reemplazar ? 'Reemplazar' : 'Cerrar'} el aporte de ${P.empresa} por ${bs(t.total)} (${t.personas} personas)?`)) return;
    const x = await llamar('cerrarAporte', { ...P, filas: B.filas, forzados: B.forzados, reemplazar: !!B.reemplazar });
    if (!x.ok) return errorEn(cuerpo.querySelector('#ap-err'), x.message);
    borradorAporte = null; toast('Aporte cerrado. Ya puedes descargar los archivos del banco.'); panelAportes(panel);
  }));
}

/* ---- Cancelaciones (empleados retirados) ---- */

const ESTADO_CANC = { PENDIENTE: ['Por enviar', 'espera'], EN_ARCHIVO: ['En el banco', 'austral'], PROCESADA: ['Procesada', 'ok'], ANULADA: ['Anulada', 'neutro'] };

async function panelCancelaciones(panel) {
  panel.innerHTML = esqueleto(2);
  const [rc, rl] = await Promise.all([obtener('candidatosCancelacion'), obtener('listarCancelaciones')]);
  if (!rc.ok || !rl.ok) { toast((rc.ok ? rl : rc).message); return; }
  const cand = rc.data, lista = rl.data;
  const por = (e) => lista.filter((c) => c.estado === e);
  const pend = por('PENDIENTE'), enBanco = por('EN_ARCHIVO');
  const item = (c, acciones = '') => `<div class="item"><div class="item-cab"><div><b>${esc(c.nombre)}</b><p class="suave">${esc(c.clave)} · ${esc(c.empresa)} · ingreso ${esc(c.fechaIngreso || '—')}${c.fechaEgreso ? ` · egreso ${esc(c.fechaEgreso)}` : ''}</p></div>${c.estado ? `<span class="chip chip-${ESTADO_CANC[c.estado][1]}">${ESTADO_CANC[c.estado][0]}</span>` : ''}</div>
    ${c.monto !== undefined && c.monto !== '' ? `<p class="suave">Monto a cancelar: <b>${bs(c.monto)}</b></p>` : c.totalAportado != null ? `<p class="suave">Total aportado en el sistema: ${bs(c.totalAportado)}</p>` : ''}${acciones}</div>`;
  panel.innerHTML = `<div class="dos-col"><div class="col">
    <section class="tarjeta"><h2>Retirados por cancelar (${cand.length})</h2>
      <p class="suave">Empleados inactivos que tienen aportes en el sistema. Registra su fecha de egreso y, si lo defines, el monto a cancelar.</p>
      ${cand.length ? `<div class="lista">${cand.map((c) => item(c, `<div><button class="btn btn-chico" data-registrar-canc="${esc(c.clave)}">Registrar cancelación</button></div>`)).join('')}</div>` : '<p class="vacio">No hay retirados pendientes.</p>'}
    </section></div><div class="col">
    <section class="tarjeta"><h2>1 · Por enviar al banco (${pend.length})</h2>
      <div class="fila">${['PCA', 'AIV'].map((e) => { const n = pend.filter((c) => c.empresa === e).length; return `<button class="btn" data-arch-canc="${e}" ${n ? '' : 'disabled'}>Descargar archivo ${e} (${n})</button>`; }).join('')}</div>
      <p class="suave">Columnas: cédula, nombre, fecha de ingreso, fecha de egreso y monto a cancelar.</p>
      ${pend.length ? `<div class="lista">${pend.map((c) => item(c, `<div><button class="btn btn-sec btn-chico" data-anular-canc="${esc(c.id)}">Anular</button></div>`)).join('')}</div>` : ''}
    </section>
    <section class="tarjeta"><h2>2 · En el banco (${enBanco.length})</h2>
      ${enBanco.length ? `<div class="lista">${enBanco.map((c) => item(c)).join('')}</div><div><button class="btn" id="canc-procesadas">Marcar como procesadas</button></div>` : '<p class="vacio">Nada en el banco.</p>'}
    </section>
    ${por('PROCESADA').length ? `<section class="tarjeta"><h2>Procesadas (${por('PROCESADA').length})</h2><div class="lista">${por('PROCESADA').slice(0, 20).map((c) => item(c)).join('')}</div></section>` : ''}
    </div></div>`;
  panel.querySelectorAll('[data-registrar-canc]').forEach((b) => b.addEventListener('click', () => {
    const c = cand.find((x) => x.clave === b.dataset.registrarCanc);
    dlg.innerHTML = `<form id="fcan" novalidate><h2>Cancelación de ${esc(c.nombre)}</h2>
      <p class="suave">${esc(c.empresa)} · ingreso ${esc(c.fechaIngreso || '—')} · aportado en el sistema ${bs(c.totalAportado)}</p>
      <label>Fecha de egreso <input type="date" name="egreso" required></label>
      <label>Monto a cancelar (opcional) <input name="monto" inputmode="decimal" placeholder="0,00"></label>
      <div class="error-msg" id="err" hidden></div>
      <div class="fila"><button class="btn grow" type="submit">Registrar</button><button class="btn btn-sec" type="button" id="no">Cerrar</button></div></form>`;
    const f = dlg.querySelector('#fcan');
    dlg.querySelector('#no').addEventListener('click', () => dlg.close());
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      await conBoton(f.querySelector('button[type=submit]'), async () => {
        const monto = f.monto.value.trim() ? leerMonto(f.monto.value) : '';
        const x = await llamar('registrarCancelacion', { clave: c.clave, fechaEgreso: f.egreso.value, monto });
        if (!x.ok) return errorEn(dlg.querySelector('#err'), x.message);
        dlg.close(); toast('Cancelación registrada.'); panelCancelaciones(panel);
      });
    });
    dlg.showModal();
  }));
  panel.querySelectorAll('[data-arch-canc]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const x = await llamar('archivoCancelaciones', { empresa: b.dataset.archCanc });
    if (!x.ok) return toast(x.message);
    descargar(`CANCELACIONES_${b.dataset.archCanc}_${new Date().toISOString().slice(0, 10)}.csv`, x.data.csv);
    toast(`Archivo con ${x.data.cantidad} cancelaciones.`); panelCancelaciones(panel);
  })));
  panel.querySelectorAll('[data-anular-canc]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    if (!confirm('¿Anular esta cancelación?')) return;
    const x = await llamar('marcarCancelaciones', { ids: [b.dataset.anularCanc], estado: 'ANULADA' });
    toast(x.ok ? 'Anulada.' : x.message); panelCancelaciones(panel);
  })));
  panel.querySelector('#canc-procesadas')?.addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    const x = await llamar('marcarCancelaciones', { ids: enBanco.map((c) => c.id), estado: 'PROCESADA' });
    toast(x.ok ? `${x.data.cambiados} procesadas.` : x.message); panelCancelaciones(panel);
  }));
}

const TRIMESTRES = [['T1', '1.er trimestre'], ['T2', '2.º trimestre'], ['T3', '3.er trimestre'], ['T4', '4.º trimestre']];
const ESTADO_APERTURA = { ABIERTA: ['Abierta', 'ok'], PROXIMA: ['Programada', 'austral'], CERRADA: ['Cerrada', 'neutro'] };
const csvCampo = (v) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** Anticipos: RRHH abre la solicitud (fechas), descarga el archivo del banco y reporta los rechazos; el resto, pagadas. */
async function panelAnticipos(panel) {
  panel.innerHTML = esqueleto(3);
  const [ra, rp, rap, ren, rre] = await Promise.all([obtener('listarAperturas'), obtener('bandejaAnticipos', { estado: 'PENDIENTE' }),
    obtener('bandejaAnticipos', { estado: 'APROBADA' }), obtener('bandejaAnticipos', { estado: 'EN_ARCHIVO' }), obtener('bandejaAnticipos', { estado: 'RECHAZADA' })]);
  const falla = [ra, rp, rap, ren, rre].find((x) => !x.ok);
  if (falla) { toast(falla.message); return arrancar(); }
  const aperturas = ra.data, recibidas = rp.data.concat(rap.data), enBanco = ren.data;
  const rechazadas = rre.data.sort((a, b) => b.creada - a.creada);
  const cuenta = (e) => recibidas.filter((a) => a.empresa === e).length;
  const anio = new Date().getFullYear();

  panel.innerHTML = `<div class="dos-col der-angosta"><div class="col">
    <section class="tarjeta">
      <h2>Abrir la solicitud de anticipos</h2>
      <p class="suave">Los colaboradores solo pueden solicitar entre la fecha de inicio y la fecha final, una vez por apertura.</p>
      <form id="fap" class="form-vac" novalidate><input type="hidden" name="id">
        <div class="fila"><label class="grow">Trimestre <select name="trim">${TRIMESTRES.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
          <label class="grow">Año <input name="anio" type="number" min="2020" max="2100" value="${anio}"></label></div>
        <div class="fila"><label class="grow">Fecha de inicio <input name="inicio" type="date"></label><label class="grow">Fecha final <input name="fin" type="date"></label></div>
        <div class="error-msg" id="err-ap" hidden></div>
        <div class="fila"><button class="btn" type="submit" id="btn-ap">Abrir solicitudes</button><button class="btn btn-sec" type="button" id="ap-cancelar" hidden>Cancelar cambio</button></div>
      </form>
      ${aperturas.length ? `<div class="lista">${aperturas.map((c) => { const [t, tono] = ESTADO_APERTURA[c.estado]; return `<div class="item">
        <div class="item-cab"><div><b>${esc(c.etiqueta)}</b><p class="suave">Del ${V().corta(c.inicio)} al ${V().corta(c.fin)} · ${c.solicitudes} solicitud${c.solicitudes === 1 ? '' : 'es'}</p></div><span class="chip chip-${tono}">${t}</span></div>
        <div class="fila"><button class="btn btn-sec btn-chico" data-ap-editar="${esc(c.id)}">Cambiar fechas</button>${c.solicitudes ? '' : `<button class="btn btn-sec btn-chico" data-ap-borrar="${esc(c.id)}">Eliminar</button>`}</div></div>`; }).join('')}</div>` : '<p class="vacio">Todavía no has abierto ninguna solicitud.</p>'}
    </section>
    <section class="tarjeta"><h2>1 · Solicitudes recibidas (${recibidas.length})</h2>
      <p class="suave">Descarga el archivo del banco de cada empresa (TIPO T = 5). Al descargarlo, sus solicitudes pasan a «Enviada al banco».</p>
      <div class="fila">${['PCA', 'AIV'].map((e) => `<button class="btn" data-gen="${e}" ${cuenta(e) ? '' : 'disabled'}>Descargar archivo ${e} (${cuenta(e)})</button>`).join('')}</div>
      ${recibidas.length ? `<div class="lista">${recibidas.map((a) => tarjetaAnticipo(a)).join('')}</div>` : '<p class="vacio">No hay solicitudes por enviar al banco.</p>'}
    </section>
    <section class="tarjeta"><h2>2 · Respuesta del banco (${enBanco.length})</h2>
      <p class="suave">Reporta las que el banco <b>rechazó</b> (por ejemplo, el monto superaba el disponible) y luego marca <b>las demás como pagadas</b>.</p>
      ${enBanco.length ? `<div class="lista">${enBanco.map((a) => tarjetaAnticipo(a, `<div><button class="btn btn-sec btn-chico" data-rech-banco="${esc(a.id)}">Rechazada por el banco</button></div>`)).join('')}</div>
      <div><button class="btn" id="pagar">Marcar las ${enBanco.length} como pagadas</button></div>` : '<p class="vacio">No hay anticipos esperando respuesta del banco.</p>'}
    </section>
    </div><div class="col">
    <section class="tarjeta"><h2>Rechazadas por el banco (${rechazadas.length})</h2>
      <p class="suave">El colaborador ve el motivo y puede volver a solicitar en la próxima apertura.</p>
      ${rechazadas.length ? `<div><button class="btn btn-sec btn-chico" id="reporte-rech">Descargar reporte (CSV)</button></div>
      <div class="lista">${rechazadas.slice(0, 30).map((a) => tarjetaAnticipo(a, a.motivoRechazo ? `<p class="suave">Motivo: ${esc(a.motivoRechazo)}</p>` : '')).join('')}</div>` : '<p class="vacio">Sin rechazos.</p>'}
    </section></div></div>`;

  // aperturas: abrir, cambiar fechas, eliminar
  const f = panel.querySelector('#fap'), errAp = panel.querySelector('#err-ap');
  const limpiar = () => { f.reset(); f.id.value = ''; f.anio.value = anio; panel.querySelector('#btn-ap').textContent = 'Abrir solicitudes'; panel.querySelector('#ap-cancelar').hidden = true; };
  panel.querySelector('#ap-cancelar').addEventListener('click', limpiar);
  panel.querySelectorAll('[data-ap-editar]').forEach((b) => b.addEventListener('click', () => {
    const c = aperturas.find((x) => x.id === b.dataset.apEditar);
    f.id.value = c.id; f.trim.value = c.clave.slice(5); f.anio.value = c.clave.slice(0, 4); f.inicio.value = c.inicio; f.fin.value = c.fin;
    panel.querySelector('#btn-ap').textContent = 'Guardar fechas'; panel.querySelector('#ap-cancelar').hidden = false; f.inicio.focus();
  }));
  panel.querySelectorAll('[data-ap-borrar]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    if (!confirm('¿Eliminar esta apertura?')) return;
    const x = await llamar('eliminarApertura', { id: b.dataset.apBorrar });
    toast(x.ok ? 'Apertura eliminada.' : x.message); panelAnticipos(panel);
  })));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); errorEn(errAp, '');
    await conBoton(panel.querySelector('#btn-ap'), async () => {
      const x = await llamar('guardarApertura', { id: f.id.value, clave: `${f.anio.value}-${f.trim.value}`, inicio: f.inicio.value, fin: f.fin.value });
      if (!x.ok) return errorEn(errAp, x.message);
      toast(`${x.data.etiqueta}: solicitudes del ${V().corta(x.data.inicio)} al ${V().corta(x.data.fin)}.`); panelAnticipos(panel);
    });
  });

  // archivo del banco, rechazos y pagadas
  panel.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
    const r = await llamar('archivoAnticipos', { empresa: b.dataset.gen });
    if (!r.ok) return toast(r.message);
    descargar(`ANTICIPOS_${b.dataset.gen}_${new Date().toISOString().slice(0, 10)}.csv`, r.data.csv);
    toast(`Archivo con ${r.data.cantidad} anticipos. Pasan a «Enviada al banco».`); panelAnticipos(panel);
  })));
  panel.querySelectorAll('[data-rech-banco]').forEach((b) => b.addEventListener('click', () => pedirMotivo('Rechazada por el banco', async (motivo) => {
    const r = await llamar('rechazarAnticipoBanco', { id: b.dataset.rechBanco, motivo });
    if (r.ok) { toast('Rechazo reportado.'); panelAnticipos(panel); }
    return r;
  })));
  panel.querySelector('#pagar')?.addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    if (!confirm(`¿Marcar ${enBanco.length} anticipos como pagados? Hazlo después de reportar los rechazos del banco.`)) return;
    const r = await llamar('pagarAnticipos', { ids: enBanco.map((a) => a.id) });
    toast(r.ok ? `${r.data.cambiados} anticipos pagados.` : r.message); panelAnticipos(panel);
  }));
  panel.querySelector('#reporte-rech')?.addEventListener('click', () => {
    const filas = [['Cédula', 'Nombre', 'Empresa', 'Trimestre', 'Monto', 'Motivo del rechazo', 'Fecha de la solicitud']]
      .concat(rechazadas.map((a) => [a.clave, a.nombre, a.empresa, a.ventanaEtiqueta, a.monto.toFixed(2), a.motivoRechazo, fechaHora(a.creada)]));
    descargar(`RECHAZOS_ANTICIPOS_${new Date().toISOString().slice(0, 10)}.csv`, filas.map((f) => f.map(csvCampo).join(';')).join('\r\n'));
  });
}

/* ---------- RRHH: vacaciones ---------- */

const ESTADOS_VAC_RRHH = { PENDIENTE_JEFE: ['Con el jefe', 'espera'], APROBADA_JEFE: ['Por registrar', 'austral'], REGISTRADA: ['Registrada', 'ok'], RECHAZADA: ['Rechazada', 'error'], CANCELADA: ['Cancelada', 'neutro'] };
let estadoVacRRHH = 'APROBADA_JEFE';

async function panelVacaciones(panel) {
  panel.innerHTML = esqueleto(2);
  const r = await obtener('bandejaVacaciones', { estado: estadoVacRRHH });
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { solicitudes, sinJefe, conCierre } = r.data;
  panel.innerHTML = `<div class="dos-col der-angosta"><div class="col">
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
          ${['APROBADA_JEFE', 'REGISTRADA'].includes(x.estado) && x.numeroConstancia ? `<div><button class="btn btn-azul btn-chico" data-pdf-vac="${esc(x.id)}">Constancia de aprobación</button></div>` : ''}
          ${x.estado === 'APROBADA_JEFE' ? `
            ${pago ? `<label>Código de nómina del pago <input placeholder="Ej. NV-80" data-nomina="${esc(x.id)}" autocomplete="off"></label>` : ''}
            <div class="fila"><button class="btn btn-chico" data-registrar="${esc(x.id)}">Registrar</button><button class="btn btn-sec btn-chico" data-rechazar-vac="${esc(x.id)}">Rechazar</button></div>` : ''}
        </div>`; }).join('')}</div>` : '<p class="vacio">No hay solicitudes en este estado.</p>'}
    </section>
    </div><div class="col">
    <section class="tarjeta">
      <h2>Importar el cierre de vacaciones</h2>
      <p class="suave">Sube tu Excel «Solicitud Digital de Disfrute de Vacaciones» (hoja CIERRE DE VACACIONES). Reemplaza los saldos por período de cada persona; los ingresos nuevos sin cierre usan la regla de la ley (15 + 1 por año, hasta 30). ${conCierre ? `Hoy hay saldos de <b>${conCierre}</b> personas.` : '<b>Todavía no se ha importado.</b>'}</p>
      <label>Archivo <input type="file" id="arch-vac" accept=".xlsx,.xls"></label>
      <div class="error-msg" id="err-vac" hidden></div>
      <div id="previa-cierre"></div>
    </section></div></div>`;

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
        previa.innerHTML = `<div class="aviso">Importadas <b>${y.personas}</b> personas (${y.periodos} períodos). ${y.noActivos} no están activas (egresos: se ignoran). ${y.activosSinCierre} empleados activos sin cierre usarán la regla de la ley.${y.porNombre ? ` Sin cédula en el cierre, reconocidas por su nombre: ${y.porNombre.map(esc).join(', ')}.` : ''}</div>
          ${y.sinIdentificar ? `<div class="error-msg">Filas sin cédula que no se pudieron identificar: ${y.sinIdentificar.map(esc).join(', ')}. Agrégales la cédula en el Excel o crea al empleado (fuera de nómina) con el mismo nombre.</div>` : ''}`;
        toast('Cierre de vacaciones importado.');
      }));
    } catch (x) { errorEn(err, x.message || 'No se pudo leer el archivo.'); }
  });
}

/* ---------- RRHH: constancias emitidas ---------- */

async function panelConstancias(panel) {
  panel.innerHTML = esqueleto(2);
  const r = await obtener('listarConstancias');
  if (!r.ok) { toast(r.message); return arrancar(); }
  panel.innerHTML = `<section class="tarjeta"><h2>Constancias emitidas (${r.data.length})</h2>
    <p class="suave">Si anulas una, al escanear su código aparecerá como anulada.</p>
    ${r.data.length ? `<div class="lista lista-grid">${r.data.map((c) => `<div class="item">
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
/** Abre un .xlsx/.xls o .csv. Los CSV se leen como texto (UTF-8, o Windows-1252 si trae caracteres rotos) y sin adivinar fechas. */
async function leerLibro(archivo) {
  const XLSX = await cargarXlsx();
  const bytes = await archivo.arrayBuffer();
  if (/\.csv$/i.test(archivo.name)) {
    let texto = new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '');
    if (texto.includes('\ufffd')) texto = new TextDecoder('windows-1252').decode(bytes);
    return XLSX.read(texto, { type: 'string', raw: true });
  }
  return XLSX.read(bytes, { type: 'array' });
}

async function leerArchivoExcel(archivo) {
  const XLSX = await cargarXlsx();
  const libro = await leerLibro(archivo);
  const hoja = libro.Sheets[libro.SheetNames[0]];
  // raw: las fechas de Excel llegan como número de serie y se convierten exactamente en core/empleados.js (fechaDeExcel)
  return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: true });
}

const COL_NOMBRES = { cedula: 'Cédula', nombre: 'Nombre', organizacion: 'Organización', departamento: 'Departamento', puesto: 'Puesto', estado: 'Estado', fechaInicio: 'Fecha Inicio', jefeNombre: 'Jefe directo', genero: 'Género', salarioMensual: 'Salario M.' };

async function panelEmpleados(panel) {
  panel.innerHTML = `<div class="dos-col izq-angosta"><div class="col">
    <section class="tarjeta">
      <h2>Cargar «Detalle de Empleado»</h2>
      <p class="suave">Sube el Excel (.xlsx o .csv) con las columnas Organización, Departamento, Puesto, Cédula, Nombre, Estado y Fecha Inicio. Actualiza a los que ya existen, agrega los nuevos y respeta tus correcciones manuales.</p>
      <label>Archivo <input type="file" id="arch" accept=".xlsx,.xls,.csv"></label>
      <div class="error-msg" id="err" hidden></div>
      <div id="previa"></div>
    </section>
    <section class="tarjeta">
      <h2>Empleados fuera de nómina</h2>
      <p class="suave">Personas activas que no vienen en el Detalle de Empleado (por ejemplo, directivos). No se desactivan al recargar el detalle y pueden solicitar vacaciones con su saldo del cierre.</p>
      <div><button class="btn btn-sec" id="agregar-fn">Agregar empleado fuera de nómina</button></div>
    </section>
    <section class="tarjeta">
      <h2>Jefe directo por departamento</h2>
      <p class="suave">Asigna de una vez el mismo jefe a todo un departamento. Después puedes ajustar casos individuales en la lista.</p>
      <label>Departamento <select id="dep"><option value="">Elige un departamento</option></select></label>
      <div><button class="btn btn-sec" id="dep-jefe" disabled>Elegir jefe del departamento</button></div>
    </section>
    </div><div class="col">
    <section class="tarjeta">
      <h2>Empleados</h2>
      <label>Buscar por nombre o cédula <input id="q" placeholder="Escribe para buscar" autocomplete="off"></label>
      <div class="fila"><label class="grow">Departamento <select id="f-dep"><option value="">Todos</option></select></label>
        <label style="grid-auto-flow:column;align-items:center;gap:8px"><input type="checkbox" id="f-sinjefe" style="width:20px;min-height:20px" ${abrirSinJefe ? 'checked' : ''}> Solo sin jefe</label></div>
      <div id="lista">${esqueleto(1)}</div>
    </section></div></div>`;
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
      const conJefe = m.filas.filter((f) => f.jefeNombre).length;
      previa.innerHTML = `<div class="aviso">Listo para cargar <b>${m.filas.length}</b> empleados${m.omitidas ? ` (${m.omitidas} filas vacías omitidas)` : ''}.${conJefe ? ` Trae <b>jefe directo</b> para ${conJefe}.` : ''}${m.faltantes.length ? ` Columnas no encontradas: ${m.faltantes.map((c) => COL_NOMBRES[c]).join(', ')}.` : ''}</div>
        <div><button class="btn" id="subir">Cargar empleados</button></div>`;
      previa.querySelector('#subir').addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
        const r = await llamar('cargarEmpleados', { filas: m.filas });
        if (!r.ok) return errorEn(err, r.message);
        const { resumen: x, revisar, sinFecha, total, jefes, sinCedula = [] } = r.data;
        const nf = (jefes && jefes.noEncontrados) || [];
        previa.innerHTML = `<div class="aviso"><b>${x.agregados}</b> agregados · <b>${x.actualizados}</b> actualizados · <b>${x.inactivados}</b> pasaron a inactivos · ${total} en total.</div>
          ${sinCedula.length ? `<div class="error-msg"><b>${sinCedula.length} fila${sinCedula.length === 1 ? '' : 's'} sin cédula válida no se importaron:</b> ${sinCedula.map(esc).join(', ')}. Si es un directivo que no es empleado (como la CEO), no hace falta que esté en el detalle: créale su usuario de RRHH en la hoja.</div>` : ''}
          ${jefes && jefes.traeColumna ? `<div class="aviso">Jefe directo asignado a <b>${jefes.asignados}</b> empleados.${jefes.sinJefeEnArchivo ? ` ${jefes.sinJefeEnArchivo} vienen sin jefe en el archivo.` : ''}</div>` : ''}
          ${nf.length ? `<div class="error-msg"><b>Jefes que no se encontraron entre los empleados</b> (esas personas conservan el jefe que tenían; asígnalo abajo):
            <ul class="lista-simple">${nf.map((j) => `<li>«${esc(j.jefe)}» — ${j.personas} persona${j.personas === 1 ? '' : 's'}${j.tipo === 'ambiguo' ? ' (hay varios empleados con ese nombre)' : j.tipo === 'ciclo' ? ' (sería su propio jefe)' : ' (no está en el detalle)'}</li>`).join('')}</ul></div>` : ''}
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
  panel.querySelector('#agregar-fn').addEventListener('click', () => formularioFueraNomina(null, refrescar));
  depJefe.addEventListener('click', () => elegirJefe(`Jefe de ${dep.value}`, async (jefe) => {
    const r = await llamar('asignarJefeDepartamento', { departamento: dep.value, jefe });
    if (!r.ok) return r;
    toast(`${r.data.cambiados} empleados actualizados.`); refrescar(); return r;
  }));
  let departamentosCargados = false;
  abrirSinJefe = false;

  async function listar(texto) {
    const caja = panel.querySelector('#lista');
    const r = await obtener('listarEmpleados', { buscar: texto, departamento: fDep.value, sinJefe: fSin.checked });
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
          ${e.estado === 'Inactivo' ? '<span class="chip chip-neutro">Inactivo</span>' : e.fueraNomina ? '<span class="chip chip-austral">Fuera de nómina</span>' : e.revisarCedula ? '<span class="chip chip-espera">Revisar cédula</span>' : ''}</div>
        <div class="fila"><button class="btn btn-sec btn-chico" data-jefe="${esc(e.clave)}" data-nombre="${esc(e.nombre)}">${e.jefe ? 'Cambiar jefe' : 'Asignar jefe'}</button>
          ${e.fueraNomina && e.estado !== 'Inactivo' ? `<button class="btn btn-sec btn-chico" data-editar-fn="${esc(e.clave)}">Editar</button><button class="btn btn-sec btn-chico" data-desactivar-fn="${esc(e.clave)}">Desactivar</button>` : ''}</div>
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
    caja.querySelectorAll('[data-editar-fn]').forEach((b) => b.addEventListener('click', () => formularioFueraNomina(empleados.find((x) => x.clave === b.dataset.editarFn), refrescar)));
    caja.querySelectorAll('[data-desactivar-fn]').forEach((b) => b.addEventListener('click', () => conBoton(b, async () => {
      if (!confirm('¿Desactivar a esta persona? Ya no podrá entrar al sistema.')) return;
      const x = await llamar('desactivarEmpleadoFueraNomina', { clave: b.dataset.desactivarFn });
      toast(x.ok ? 'Desactivado.' : x.message); refrescar();
    })));
    caja.querySelectorAll('[data-emp]').forEach((sel) => sel.addEventListener('change', async () => {
      const x = await llamar('fijarEmpresa', { clave: sel.dataset.emp, empresa: sel.value });
      toast(x.ok ? `Empresa del fideicomiso: ${x.data.empresa}` : x.message);
    }));
  }
  listar('');
}

let cacheUsuariosJefes = null;
async function usuariosJefes() {
  if (!cacheUsuariosJefes) { const r = await llamar('listarUsuariosJefes'); cacheUsuariosJefes = r.ok ? r.data : []; }
  return cacheUsuariosJefes;
}

/** Alta o edición de un empleado fuera de nómina. `e` = empleado de la lista (para editar) o null. */
function formularioFueraNomina(e, despues) {
  const fecha = e && e.fechaIngreso ? e.fechaIngreso.split('/').reverse().map((x) => x.padStart(2, '0')).join('-') : '';
  dlg.innerHTML = `<form id="ffn" novalidate><h2>${e ? 'Editar' : 'Agregar'} empleado fuera de nómina</h2>
    <label>Cédula <input name="cedula" inputmode="numeric" value="${esc(e ? e.clave : '')}" ${e ? 'readonly' : ''} placeholder="V12345678"></label>
    <label>Nombre y apellido <input name="nombre" value="${esc(e ? e.nombre : '')}"></label>
    <div class="fila"><label class="grow">Empresa <select name="empresa"><option value="PCA">Prosein (PCA)</option><option value="AIV" ${e && e.empresa === 'AIV' ? 'selected' : ''}>Austral (AIV)</option></select></label>
      <label class="grow">Género <select name="genero"><option value="">—</option><option ${e && e.genero === 'Femenino' ? 'selected' : ''}>Femenino</option><option ${e && e.genero === 'Masculino' ? 'selected' : ''}>Masculino</option></select></label></div>
    <label>Fecha de ingreso <input type="date" name="fechaIngreso" value="${fecha}"></label>
    <div class="fila"><label class="grow">Departamento <input name="departamento" value="${esc(e ? e.departamento : '')}"></label><label class="grow">Cargo <input name="puesto" value="${esc(e ? e.puesto : '')}"></label></div>
    <label>Salario mensual (opcional, para la constancia de trabajo) <input name="salarioMensual" inputmode="decimal" value="${e && e.salarioMensual != null ? esc(e.salarioMensual) : ''}"></label>
    <div class="error-msg" id="err" hidden></div>
    <div class="fila"><button class="btn grow" type="submit">Guardar</button><button class="btn btn-sec" type="button" id="no">Cerrar</button></div></form>`;
  const f = dlg.querySelector('#ffn'), err = dlg.querySelector('#err');
  dlg.querySelector('#no').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await conBoton(f.querySelector('button[type=submit]'), async () => {
      const datos = Object.fromEntries(new FormData(f).entries());
      const x = await llamar('guardarEmpleadoFueraNomina', datos);
      if (!x.ok) return errorEn(err, x.message);
      dlg.close(); toast(`${x.data.nombre}: guardado.`); despues();
    });
  });
  dlg.showModal(); f[e ? 'nombre' : 'cedula'].focus();
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
      const [r, u] = await Promise.all([llamar('listarEmpleados', { buscar: texto }), usuariosJefes()]);
      if (!r.ok) return errorEn(err, r.message);
      const q = window.Empleados.normalizarNombre(texto);
      const usuarios = u.filter((x) => window.Empleados.normalizarNombre(x.nombre).includes(q)).map((x) => ({ ...x, puesto: 'Usuario de Gestión Humana', departamento: 'no es empleado' }));
      const activos = usuarios.concat(r.data.empleados.filter((x) => x.estado !== 'Inactivo')).slice(0, 8);
      res.innerHTML = activos.length ? activos.map((x) => `<button type="button" class="item" data-j="${esc(x.clave)}" style="text-align:left;cursor:pointer"><b>${esc(x.nombre)}</b><span class="suave">${esc(x.puesto)} · ${esc(x.departamento)}</span></button>`).join('') : '<p class="vacio">Sin resultados.</p>';
      res.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => conBoton(b, () => aplicarYCerrar(b.dataset.j))));
    }, 250);
  });
  dlg.showModal(); dlg.querySelector('#qj').focus();
}


iniciarInstalacion();
arrancar();
