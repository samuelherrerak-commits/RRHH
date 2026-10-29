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

/** Párrafo con partes en negrita y salto de línea automático. Devuelve la y siguiente. */
function parrafo(doc, partes, x, y, ancho, interlineado) {
  const palabras = [];
  partes.forEach(({ t, b }) => t.split(/(\s+)/).filter(Boolean).forEach((w) => palabras.push({ w, b: !!b })));
  let linea = [], usado = 0;
  const volcar = () => {
    let cx = x;
    linea.forEach(({ w, b }) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.text(w, cx, y); cx += doc.getTextWidth(w); });
    y += interlineado; linea = []; usado = 0;
  };
  palabras.forEach((p) => {
    doc.setFont('helvetica', p.b ? 'bold' : 'normal');
    const w = doc.getTextWidth(p.w);
    if (/^\s+$/.test(p.w)) { if (linea.length) { linea.push(p); usado += w; } return; }
    if (usado + w > ancho && linea.length) { while (linea.length && /^\s+$/.test(linea[linea.length - 1].w)) linea.pop(); volcar(); }
    linea.push(p); usado += w;
  });
  if (linea.length) volcar();
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
  y = parrafo(doc, [{ t: `Esta constancia tiene una vigencia de tres (3) meses, hasta el ${K.fechaLarga(vence)}. Su autenticidad puede verificarse escaneando el código QR.` }], X, y + 10, ANCHO, 13);

  doc.setTextColor(...tinta); doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('Atentamente,', X, 508);
  doc.addImage(firma, 'PNG', X - 6, 522, 100, 100);
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
