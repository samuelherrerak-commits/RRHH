// Forma 14-100 «Constancia de trabajo para el I.V.S.S.» en PDF (hoja carta), igual a la planilla con macros de Gestión Humana:
// una planilla por cada 6 años, desde el año de ingreso hasta el retiro (o hasta hoy), con el salario de cada mes.
import { cargarScript, comoDataUrl, URL_JSPDF } from './constancia-pdf.js';

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const monto = (v) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const miles = (v) => (String(v).replace(/\D/g, '') ? Number(String(v).replace(/\D/g, '')).toLocaleString('es-VE', { maximumFractionDigits: 0 }) : '');

/**
 * d: { empresa: { razonSocial, numeroIvss, direccion, representante, ciRepresentante, telefono, correo, rif, firmante, cargoFirmante, ciFirmante, lugar },
 *      trabajador: { nombre, nacionalidad, cedula }, ingreso: 'aaaa-mm-dd', retiro: 'aaaa-mm-dd' | '', emision: 'aaaa-mm-dd', observaciones,
 *      salarios: { 'aaaa-mm': Bs. } }
 */
export async function construirForma14100(d) {
  await cargarScript(URL_JSPDF);
  const logo = await comoDataUrl('assets/logo-ivss.jpg').catch(() => null);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: `Forma 14-100 - ${d.trabajador.nombre}`, subject: 'Constancia de trabajo para el IVSS' });
  const ini = Number(d.ingreso.slice(0, 4)), finTxt = d.retiro || d.emision, fin = Number(finTxt.slice(0, 4));
  const mesIni = d.ingreso.slice(0, 7), mesFin = finTxt.slice(0, 7);
  const planillas = Math.max(1, Math.ceil((fin - ini + 1) / 6));
  const e = d.empresa;
  const X = 54, W = 504, negro = [20, 20, 20];

  const caja = (x, y, w, h) => { doc.setDrawColor(...negro); doc.setLineWidth(0.6); doc.rect(x, y, w, h); };
  const txt = (t, x, y, o = {}) => { doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.t || 7.5); doc.text(String(t), x, y, { align: o.a || 'left' }); };
  const casillas = (texto, x, y, w, h) => {   // texto en casillas (N.º de empresa, RIF, fechas)
    const c = String(texto).split(''), cw = w / Math.max(c.length, 1);
    c.forEach((ch, i) => { caja(x + i * cw, y, cw, h); txt(ch, x + i * cw + cw / 2, y + h - 4, { a: 'center', t: 8 }); });
  };
  const fechaCas = (iso) => (iso ? iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(2, 4) : '');

  for (let p = 0; p < planillas; p++) {
    if (p) doc.addPage();
    doc.setTextColor(...negro);
    // encabezado
    if (logo) doc.addImage(logo, 'JPEG', X, 40, 44, 44);
    txt('MINISTERIO DEL TRABAJO', 200, 50, { a: 'center', t: 6 }); txt('INSTITUTO VENEZOLANO DE LOS SEGUROS SOCIALES', 200, 60, { a: 'center', t: 6 });
    txt('DIRECCION GENERAL DE AFILIACION Y PRESTACIONES EN DINERO', 200, 70, { a: 'center', t: 6 }); txt('DIRECCION DE PRESTACIONES EN DINERO', 200, 80, { a: 'center', t: 6 });
    txt('Forma 14-100', X + W, 58, { a: 'right', t: 8 });
    txt('CONSTANCIA  DE  TRABAJO  PARA  EL  I.V.S.S.', X + W / 2, 112, { a: 'center', b: true, t: 15 });
    // datos de la empresa
    let y = 124;
    caja(X, y, W, 12); txt('D A T O S    D E    L A    E M P R E S A', X + W / 2, y + 9, { a: 'center', b: true, t: 8 }); y += 12;
    caja(X, y, 380, 10); caja(X + 380, y, 124, 10); txt('NOMBRE  DEL  PATRONO  O  RAZON  SOCIAL', X + 190, y + 7.5, { a: 'center', t: 6 }); txt('NUMERO  DE  LA  EMPRESA', X + 442, y + 7.5, { a: 'center', t: 6 }); y += 10;
    caja(X, y, 380, 12); txt(e.razonSocial, X + 190, y + 9, { a: 'center', t: 8 }); casillas(String(e.numeroIvss || '').replace(/[\s-]/g, '').toUpperCase(), X + 380, y, 124, 12); y += 22;
    caja(X, y, W, 10); txt('DIRECCION  DE  LA  EMPRESA', X + W / 2, y + 7.5, { a: 'center', t: 6 }); y += 10;
    caja(X, y, W, 12); txt(e.direccion, X + W / 2, y + 9, { a: 'center', t: 7.5 }); y += 22;
    caja(X, y, 260, 10); caja(X + 260, y, 120, 10); caja(X + 380, y, 124, 10);
    txt('APELLIDOS Y NOMBRES DEL PATRONO O REPRESENTANTE LEGAL', X + 130, y + 7.5, { a: 'center', t: 5.5 }); txt('CEDULA DE IDENTIDAD', X + 320, y + 7.5, { a: 'center', t: 6 }); txt('TELEFONO', X + 442, y + 7.5, { a: 'center', t: 6 }); y += 10;
    caja(X, y, 260, 12); caja(X + 260, y, 120, 12); caja(X + 380, y, 124, 12);
    txt(e.representante, X + 130, y + 9, { a: 'center', t: 8 }); txt(e.ciRepresentante ? miles(e.ciRepresentante) : '', X + 320, y + 9, { a: 'center', t: 8 }); txt(e.telefono, X + 442, y + 9, { a: 'center', t: 8 }); y += 22;
    caja(X, y, 330, 10); caja(X + 330, y, 174, 10); txt('DIRECCIÓN DE CORREO ELECTRÓNICO DEL EMPLEADOR O EMPLEADORA', X + 165, y + 7.5, { a: 'center', t: 5.5 }); txt('REGISTRO DE INFORMACIÓN FISCAL (RIF)', X + 417, y + 7.5, { a: 'center', t: 5.5 }); y += 10;
    caja(X, y, 330, 12); txt(e.correo, X + 165, y + 9, { a: 'center', t: 7 }); casillas(String(e.rif || '').replace(/\s/g, '').toUpperCase(), X + 330, y, 174, 12); y += 20;
    // datos del trabajador
    caja(X, y, W, 12); txt('DATOS DEL TRABAJADOR O TRABAJADORA', X + W / 2, y + 9, { a: 'center', b: true, t: 8.5 }); y += 12;
    caja(X, y, 310, 10); txt('APELLIDOS Y NOMBRES', X + 155, y + 7.5, { a: 'center', t: 6 });
    ['V', 'E', 'A', 'R'].forEach((l, i) => { caja(X + 310 + i * 13, y, 13, 10); txt(l, X + 316.5 + i * 13, y + 7.5, { a: 'center', t: 6 }); });
    caja(X + 362, y, 142, 10); txt('CEDULA DE IDENTIDAD', X + 433, y + 7.5, { a: 'center', t: 6 }); y += 10;
    caja(X, y, 310, 12); txt(d.trabajador.nombre, X + 155, y + 9, { a: 'center', t: 8 });
    ['V', 'E', 'A', 'R'].forEach((l, i) => { caja(X + 310 + i * 13, y, 13, 12); if (l === (d.trabajador.nacionalidad || 'V')) txt('X', X + 316.5 + i * 13, y + 9, { a: 'center', t: 8 }); });
    caja(X + 362, y, 142, 12); txt(miles(d.trabajador.cedula), X + 433, y + 9, { a: 'center', t: 8 }); y += 22;
    // fechas de ingreso y retiro
    caja(X + 40, y, 76, 10); txt('FECHA DE INGRESO', X + 78, y + 7.5, { a: 'center', t: 6 }); casillas(fechaCas(d.ingreso), X + 40, y + 10, 76, 14);
    caja(X + 290, y, 76, 10); txt('FECHA DE RETIRO', X + 328, y + 7.5, { a: 'center', t: 6 });
    if (d.retiro) casillas(fechaCas(d.retiro), X + 290, y + 10, 76, 14); else caja(X + 290, y + 10, 76, 14);
    y += 36;
    // salarios de los 6 años de esta planilla
    const anios = Array.from({ length: 6 }, (_, k) => ini + p * 6 + k);
    caja(X, y, W, 13); txt('SALARIOS   DEVENGADOS   EN   LOS   ULTIMOS   6   AÑOS', X + W / 2, y + 10, { a: 'center', b: true, t: 9 }); y += 13;
    const c0 = 78, cw = (W - c0) / 6, fila = 11.2;
    caja(X, y, c0, 16); txt('AÑOS', X + c0 / 2, y + 7, { a: 'center', t: 6.5 }); txt('M E S E S', X + c0 / 2, y + 14, { a: 'center', t: 6.5 });
    anios.forEach((a, k) => { caja(X + c0 + k * cw, y, cw, 16); if (a <= fin) txt(a, X + c0 + k * cw + cw / 2, y + 11, { a: 'center', t: 8 }); });
    y += 16;
    const totales = anios.map(() => 0);
    MESES.forEach((m, i) => {
      caja(X, y, c0, fila); txt(m, X + 3, y + 8.2, { t: 6.5 });
      anios.forEach((a, k) => {
        caja(X + c0 + k * cw, y, cw, fila);
        const mes = `${a}-${String(i + 1).padStart(2, '0')}`;
        if (a > fin || mes < mesIni || mes > mesFin) return;
        const v = Number(d.salarios[mes] || 0); totales[k] += v;
        txt(monto(v), X + c0 + (k + 1) * cw - 3, y + 8.2, { a: 'right', t: 7 });
      });
      y += fila;
    });
    caja(X, y, c0, fila); txt('T O T A L E S', X + 3, y + 8.2, { t: 6.5, b: true });
    anios.forEach((a, k) => { caja(X + c0 + k * cw, y, cw, fila); if (a <= fin) txt(monto(totales[k]), X + c0 + (k + 1) * cw - 3, y + 8.2, { a: 'right', t: 7, b: true }); });
    y += fila + 12;
    // observaciones
    caja(X, y, W, 36); txt('OBSERVACIONES:', X + 3, y + 8, { t: 6 }); doc.setDrawColor(150); doc.line(X + 60, y + 9, X + W - 4, y + 9); doc.line(X + 3, y + 20, X + W - 4, y + 20); doc.line(X + 3, y + 31, X + W - 4, y + 31);
    if (p === 0 && d.observaciones) doc.splitTextToSize(d.observaciones, W - 70).slice(0, 3).forEach((l, i) => txt(l, i ? X + 5 : X + 64, y + 7.5 + i * 11, { t: 7.5 }));
    y += 50;
    // declaración jurada y firma
    txt('DECLARACIÓN JURADA', X + 165, y, { a: 'center', b: true, t: 7.5 }); txt('CERTIFICO BAJO FE DE JURAMENTO, QUE LA INFORMACIÓN QUE ANTECEDE ES CIERTA EN TODAS SUS PARTES', X + 165, y + 9, { a: 'center', b: true, t: 6.5 });
    y += 13;
    caja(X, y, 320, 10); txt('APELLIDOS  Y  NOMBRES  DEL  FIRMANTE', X + 160, y + 7.5, { a: 'center', t: 6 }); caja(X, y + 10, 320, 12); txt(e.firmante, X + 160, y + 19, { a: 'center', t: 8 });
    caja(X + 334, y, 170, 90); txt('FIRMA   Y   SELLO', X + 419, y + 9, { a: 'center', t: 6.5 });
    doc.line(X + 344, y + 76, X + 494, y + 76); txt('C.I. Nº:', X + 346, y + 86, { t: 6 }); txt(e.ciFirmante ? miles(e.ciFirmante) : '', X + 420, y + 85, { a: 'center', t: 8 });
    const y2 = y + 32;
    caja(X, y2, 140, 10); caja(X + 140, y2, 90, 10); caja(X + 230, y2, 90, 10);
    txt('CARGO QUE OCUPA', X + 70, y2 + 7.5, { a: 'center', t: 6 }); txt('LUGAR', X + 185, y2 + 7.5, { a: 'center', t: 6 }); txt('FECHA', X + 275, y2 + 7.5, { a: 'center', t: 6 });
    caja(X, y2 + 10, 140, 22); caja(X + 140, y2 + 10, 90, 22);
    doc.splitTextToSize(e.cargoFirmante || '', 132).slice(0, 2).forEach((l, i) => txt(l, X + 70, y2 + 19 + i * 8, { a: 'center', t: 6.5 }));
    txt(e.lugar || '', X + 185, y2 + 24, { a: 'center', t: 7.5 });
    casillas(fechaCas(d.emision), X + 230, y2 + 10, 90, 22);
    txt('VER INSTRUCCIONES AL RESPALDO', X + 160, y2 + 44, { a: 'center', t: 6 });
    txt(`Planilla ${p + 1} de ${planillas}`, X + W, 770, { a: 'right', t: 6 });
  }
  const limpio = d.trabajador.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { blob: doc.output('blob'), nombreArchivo: `Forma_14-100_${limpio}.pdf`, planillas };
}

export async function descargarForma14100(d) {
  const { blob, nombreArchivo, planillas } = await construirForma14100(d);
  const url = URL.createObjectURL(blob), a = Object.assign(document.createElement('a'), { href: url, download: nombreArchivo });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  return planillas;
}
