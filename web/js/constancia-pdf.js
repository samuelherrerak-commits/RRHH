// Genera la constancia de trabajo en PDF (hoja carta) en el navegador, con el membrete de la empresa,
// la firma del modelo y un código QR que lleva a la página de verificación.
const URL_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const URL_QR = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const MEMBRETES = { PCA: ['assets/membrete-prosein.jpg', 'JPEG'], AIV: ['assets/membrete-austral.png', 'PNG'] };

const scripts = {};
function cargarScript(url) {
  return (scripts[url] ||= new Promise((ok, no) => {
    document.head.appendChild(Object.assign(document.createElement('script'), { src: url, onload: ok, onerror: () => no(new Error('No se pudo cargar una herramienta del PDF. Revisa tu conexión.')) }));
  }));
}

async function comoDataUrl(ruta) {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error('No se pudo cargar el membrete.');
  const b = await r.blob();
  return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
}

/**
 * Párrafo con partes en negrita, salto de línea automático y texto JUSTIFICADO (como en el Word):
 * cada línea, menos la última, reparte el espacio sobrante entre sus palabras. Devuelve la y siguiente.
 */
function parrafo(doc, partes, x, y, ancho, interlineado) {
  const palabras = [];
  partes.forEach(({ t, b }) => t.split(/(\s+)/).filter(Boolean).forEach((w) => palabras.push({ w, b: !!b, esp: /^\s+$/.test(w) })));
  const medir = (p) => { doc.setFont('helvetica', p.b ? 'bold' : 'normal'); return p.esp ? doc.getTextWidth(' ') : doc.getTextWidth(p.w); };
  const lineas = [];
  let linea = [], usado = 0;
  palabras.forEach((p) => {
    const w = medir(p);
    if (p.esp) { if (linea.length) { linea.push({ ...p, ancho: w }); usado += w; } return; }
    if (usado + w > ancho && linea.length) {
      while (linea.length && linea[linea.length - 1].esp) linea.pop();
      lineas.push(linea); linea = []; usado = 0;
    }
    linea.push({ ...p, ancho: w }); usado += w;
  });
  while (linea.length && linea[linea.length - 1].esp) linea.pop();
  if (linea.length) lineas.push(linea);

  lineas.forEach((ln, i) => {
    const ultima = i === lineas.length - 1;
    const huecos = ln.filter((p) => p.esp).length;
    const total = ln.reduce((s, p) => s + p.ancho, 0);
    const extra = !ultima && huecos ? (ancho - total) / huecos : 0;
    let cx = x;
    ln.forEach((p) => {
      if (p.esp) { cx += p.ancho + extra; return; }
      doc.setFont('helvetica', p.b ? 'bold' : 'normal'); doc.text(p.w, cx, y); cx += p.ancho;
    });
    y += interlineado;
  });
  return y;
}

function dibujarQr(doc, texto, x, y, lado) {
  const qr = window.qrcode(0, 'M'); qr.addData(texto); qr.make();
  const n = qr.getModuleCount(), m = lado / (n + 8);        // 4 módulos de margen blanco por lado
  doc.setFillColor(255, 255, 255); doc.rect(x, y, lado, lado, 'F');
  doc.setFillColor(20, 22, 24);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (qr.isDark(f, c)) doc.rect(x + (c + 4) * m, y + (f + 4) * m, m + 0.2, m + 0.2, 'F');
}

const parteFecha = (txt) => { const [d, m, y] = txt.split('/').map(Number); return { d, m, y }; };

/** c = constancia tal como la devuelve la API. Devuelve { blob, nombreArchivo }. */
export async function construirConstanciaPdf(c, urlBase) {
  await Promise.all([cargarScript(URL_JSPDF), cargarScript(URL_QR)]);
  const K = window.Constancia;
  const [rutaMembrete, tipoMembrete] = MEMBRETES[c.empresa] || MEMBRETES.PCA;
  const [membrete, firma] = await Promise.all([comoDataUrl(rutaMembrete), comoDataUrl('assets/firma.png')]);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: `Constancia de trabajo - ${c.nombre}`, subject: 'Constancia de trabajo', creator: 'Recursos Humanos' });
  doc.addImage(membrete, tipoMembrete, 0, 0, 612, 792);

  const X = 72, ANCHO = 468, tinta = [30, 32, 34];
  doc.setTextColor(...tinta);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(16); doc.text('A quien pueda interesar.', X, 228);
  doc.setFontSize(10); doc.text('Por medio de la presente', X, 282);

  const ingreso = K.fechaLarga(parteFecha(c.fechaIngreso));
  let y = parrafo(doc, [
    { t: 'Hacemos constar que el ciudadano ' }, { t: c.nombre, b: true }, { t: ', portador de la cédula de identidad Nº ' }, { t: c.cedula, b: true },
    { t: ' se desempeña como ' }, { t: `${c.cargo} - ${c.organizacion}`, b: true }, { t: ' de esta empresa desde el ' }, { t: ingreso, b: true },
    { t: '. Devengando una remuneración mensual de ' }, { t: `${K.montoEnLetras(c.salario)} (Bs. ${K.formatoMonto(c.salario)})`, b: true }, { t: '.' },
  ], X, 312, ANCHO, 15);

  const emision = K.fechaCaracas(c.emision), vence = K.fechaCaracas(c.vence), f = c.firmante;
  y = parrafo(doc, [{ t: `Constancia que se expide a solicitud de la parte interesada en la ciudad de ${f.ciudad}, el día ${K.fechaLargaConDia(emision)}.` }], X, y + 22, ANCHO, 15);
  doc.setFontSize(9); doc.setTextColor(90, 93, 97);
  // Se escribe la fecha de vencimiento guardada (no un número de días fijo): así las constancias ya emitidas siguen siendo exactas.
  y = parrafo(doc, [{ t: `Esta constancia es válida hasta el ${K.fechaLarga(vence)}. Su autenticidad puede verificarse escaneando el código QR.` }], X, y + 10, ANCHO, 13);

  doc.setTextColor(...tinta); doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('Atentamente,', X, 508);
  // Firma horizontal (en el Word la imagen está girada 270°; aquí ya viene girada y recortada: 392 × 295 px).
  doc.addImage(firma, 'PNG', X - 12, 530, 130, 98);
  doc.setFont('helvetica', 'bold'); doc.text(f.nombre, X, 630);
  doc.setFont('helvetica', 'normal'); doc.text(f.cargo, X, 645); doc.text(f.telefono, X, 660);

  const enlace = `${urlBase}#v=${c.id}`;
  dibujarQr(doc, enlace, 444, 540, 96);
  doc.setFontSize(7); doc.setTextColor(90, 93, 97);
  doc.text('Verifique esta constancia', 492, 646, { align: 'center' });
  doc.text(`Código ${c.id}`, 492, 655, { align: 'center' });

  const limpio = c.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { blob: doc.output('blob'), nombreArchivo: `Constancia_de_trabajo_${limpio}_${K.fechaCorta(emision).replace(/\//g, '-')}.pdf` };
}

export async function descargarConstanciaPdf(c, urlBase) {
  const { blob, nombreArchivo } = await construirConstanciaPdf(c, urlBase);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombreArchivo });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- Constancia de aprobación de vacaciones (modelo de RRHH) ---------- */

const MEMBRETES_VAC = { PCA: ['assets/membrete-prosein-vacaciones.jpg', 'JPEG'], AIV: ['assets/membrete-austral.png', 'PNG'] };

/** v = solicitud registrada tal como la devuelve la API (con numeroConstancia y pendientesDespues). */
export async function construirConstanciaVacacionesPdf(v) {
  await cargarScript(URL_JSPDF);
  const K = window.Constancia, Vac = window.Vacaciones;
  const [ruta, tipo] = MEMBRETES_VAC[v.empresa] || MEMBRETES_VAC.PCA;
  const membrete = await comoDataUrl(ruta);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: `Constancia de aprobación de vacaciones - ${v.nombre}`, creator: 'Gestión Humana' });
  doc.addImage(membrete, tipo, 0, 0, 612, 792);

  const X = 72, ANCHO = 468, SANGRIA = 108, LH = 15;
  doc.setTextColor(30, 32, 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(17); doc.text('Constancia de Aprobación de Vacaciones', X, 152);
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold'); doc.text(`Constancia N.ª ${v.numeroConstancia}`, X, 218);

  let y = parrafo(doc, [{ t: 'Estimado (a) ' }, { t: v.nombre, b: true }, { t: ' Por medio de la presente te confirmamos que tu solicitud de vacaciones ha sido aprobada.' }], X, 248, ANCHO, LH);
  y = parrafo(doc, [
    { t: 'La empresa, en cumplimiento de la normativa laboral vigente y de conformidad con los lineamientos internos, aprueba la solicitud de vacaciones para el periodo comprendido entre el ' },
    { t: Vac.corta(v.inicio), b: true }, { t: ' y el ' }, { t: Vac.corta(v.culminacion), b: true },
    { t: ' reincorporándose a sus funciones el día ' }, { t: `${Vac.corta(v.reintegro)}.`, b: true },
    { t: ' Siendo un total de ' }, { t: String(v.dias), b: true }, { t: ` día${v.dias === 1 ? '' : 's'} a disfrutar.` },
  ], X, y + 12, ANCHO, LH);

  doc.setFont('helvetica', 'bolditalic'); doc.text(`Condición: ${v.condicion}`, SANGRIA, y + 16);
  y = parrafo(doc, [{ t: 'Se hace de su conocimiento que, una vez aplicado el presente disfrute, quedarán pendientes en los siguientes periodos.' }], X, y + 46, ANCHO, LH);

  const per = (v.pendientesDespues && v.pendientesDespues.porPeriodo) || [];
  const total = v.pendientesDespues ? v.pendientesDespues.total : 0;
  const ultimo = per[per.length - 1];
  doc.setFont('helvetica', 'bolditalic');
  y += 12;
  if (per.length > 1) { doc.text(`Periodos anteriores: ${total - ultimo.pendientes}`, SANGRIA, y); y += LH; }
  if (ultimo) { doc.text(`${ultimo.periodo}: ${ultimo.pendientes}`, SANGRIA, y); y += LH; }

  y = parrafo(doc, [{ t: `Quedando un total de ${total} día${total === 1 ? '' : 's'} pendientes de vacaciones por disfrutar.` }], X, y + 14, ANCHO, LH);
  const emitida = K.fechaCaracas(v.registrada || Date.now());
  y = parrafo(doc, [{ t: 'Se expide la presente constancia a solicitud de la parte interesada, en la ciudad de ' }, { t: 'Caracas', b: true },
    { t: ', el ' }, { t: K.fechaLargaConDia(emitida), b: true }, { t: ', para los fines administrativos.' }], X, y + 12, ANCHO, LH);

  doc.setFont('helvetica', 'normal'); doc.text('Atentamente,', X, 618); doc.text('Gerencia de Gestión Humana.', X, 633);

  const limpio = v.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { blob: doc.output('blob'), nombreArchivo: `Constancia_vacaciones_${limpio}_${v.inicio}.pdf` };
}

export async function descargarConstanciaVacacionesPdf(v) {
  const { blob, nombreArchivo } = await construirConstanciaVacacionesPdf(v);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombreArchivo });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
