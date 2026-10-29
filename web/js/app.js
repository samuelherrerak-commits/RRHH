import { llamar, sesion } from './api.js';
import { bs, esc, chip, fechaHora, leerMonto } from './formato.js';

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
  const s = sesion.leer();
  btnSalir.hidden = !s;
  if (s && s.rol !== 'TRABAJADOR') return vistaRRHH();
  if (s) return vistaCuenta();
  return vistaLogin();
}
btnSalir.addEventListener('click', () => { sesion.borrar(); arrancar(); });

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
        sesion.guardar({ token: r.data.token, rol: r.data.rol, nombre: r.data.nombre, tokenTrabajador: r.data.tokenTrabajador || '' });
        return arrancar();
      }
      const r = await llamar('login', { cedula: f.cedula.value, token: '' });
      if (!r.ok) return errorEn(err, r.message);
      if (r.data.requiereClave) {            // la cédula es de Recursos Humanos: pide la clave
        pideClave = true; f.cedula.readOnly = true; lblClave.hidden = false; otra.hidden = false; f.clave.required = true; f.clave.focus();
        return;
      }
      sesion.guardar({ token: r.data.token, rol: 'TRABAJADOR', nombre: r.data.nombre });
      arrancar();
    });
  });
}

/* ---------- Trabajador: estado de cuenta ---------- */

// `cont` y `token` permiten mostrarla dentro del panel de RRHH con la sesión de empleado de esa persona.
let cuenta = { cont: app, token: '' };
const conToken = () => (cuenta.token ? { token: cuenta.token } : {});

async function vistaCuenta(cont = app, token = '') {
  cuenta = { cont, token };
  btnSalir.hidden = false;
  cont.innerHTML = '<p class="vacio">Cargando tu estado de cuenta…</p>';
  const r = await llamar('estadoDeCuenta', conToken());
  if (!r.ok) { toast(r.message); return arrancar(); }
  const { resumen: u, anticipos } = r.data;
  const nombre = (sesion.leer() || {}).nombre || '';
  const pct = Math.round(u.porcentajeMax * 100);

  cont.innerHTML = `
    <section class="tarjeta heroe">
      <h2>Hola, ${esc(nombre.split(' ')[0] || '')}. Disponible para anticipo</h2>
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
    vistaCuenta(cuenta.cont, cuenta.token);
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
      dlg.close(); toast('Solicitud enviada. Recursos Humanos la revisará.'); vistaCuenta(cuenta.cont, cuenta.token);
    });
  });
  dlg.showModal();
}

/* ---------- RRHH: panel ---------- */

let pestana = 'solicitudes';

async function vistaRRHH() {
  btnSalir.hidden = false;
  const miCuenta = !!(sesion.leer() || {}).tokenTrabajador;
  if (pestana === 'micuenta' && !miCuenta) pestana = 'solicitudes';
  app.innerHTML = `
    <div class="pestanas" role="tablist">
      ${[['solicitudes', 'Solicitudes'], ['banco', 'Archivo al banco'], ['empleados', 'Empleados'], ['cierres', 'Cierres'], ...(miCuenta ? [['micuenta', 'Mi cuenta']] : [])].map(([k, t]) =>
        `<button class="pestana" role="tab" data-p="${k}" aria-selected="${k === pestana}">${t}</button>`).join('')}
    </div>
    <div id="panel"></div>`;
  app.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => { pestana = b.dataset.p; vistaRRHH(); }));
  const panel = app.querySelector('#panel');
  if (pestana === 'solicitudes') return panelSolicitudes(panel);
  if (pestana === 'banco') return panelBanco(panel);
  if (pestana === 'empleados') return panelEmpleados(panel);
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
        <label style="grid-auto-flow:column;align-items:center;gap:8px"><input type="checkbox" id="f-sinjefe" style="width:20px;min-height:20px"> Solo sin jefe</label></div>
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
