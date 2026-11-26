// Planilla AR-I en PDF (hoja carta) con el mismo orden de casillas que el formato del SENIAT que usa Gestión Humana.
import { cargarScript, comoDataUrl, URL_JSPDF } from './constancia-pdf.js';

const bs = (v) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EMPRESAS = { PCA: 'PROSEIN PROVEEDURIA Y SERVICIO INDUSTRIAL C.A.', AIV: 'AUSTRAL IMPORT DE VENEZUELA C.A.' };

/** d: { persona: { nombre, letra, cedula, empresa }, ari: { tipo, mes, entregada, anio, datos, resultado } } */
export async function construirAriPdf(d) {
  await cargarScript(URL_JSPDF);
  const logo = await comoDataUrl('assets/logo-seniat.png').catch(() => null);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const { persona: p, ari: a } = d, r = a.resultado, dat = a.datos, X = 40, W = 532;
  doc.setProperties({ title: `AR-I ${a.anio} - ${p.nombre}`, subject: 'Planilla AR-I' });
  const t = (s, x, y, o = {}) => { doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.t || 7); doc.text(String(s), x, y, { align: o.a || 'left' }); };
  const caja = (x, y, w, h, gris) => { doc.setLineWidth(0.5); doc.setDrawColor(40); if (gris) { doc.setFillColor(235, 235, 235); doc.rect(x, y, w, h, 'FD'); } else doc.rect(x, y, w, h); };
  const seccion = (letra, titulo, y) => { caja(X, y, W, 12, true); t(`${letra}   ${titulo}`, X + 4, y + 8.5, { b: true, t: 7 }); return y + 12; };
  const fila = (texto, valor, y, o = {}) => { caja(X, y, W, 13); t(texto, X + 6, y + 9, { t: 6.8 }); if (o.letra) { t(o.letra, X + W - 150, y + 9, { b: true, t: 8 }); } t(valor, X + W - 6, y + 9.2, { a: 'right', t: 7.5, b: !!o.b }); return y + 13; };

  if (logo) doc.addImage(logo, 'PNG', X, 30, 120, 39);
  caja(X + W / 2 - 40, 34, 80, 24); t('AR-I', X + W / 2, 52, { a: 'center', b: true, t: 18 });
  t('IMPUESTO SOBRE LA RENTA', X + W / 2, 74, { a: 'center', b: true, t: 9 });
  t('APLICABLE SOBRE SUELDOS, SALARIOS Y DEMÁS REMUNERACIONES, CUANDO EL ENRIQUECIMIENTO ANUAL EXCEDA DE', X + W / 2, 84, { a: 'center', t: 6.5 });
  t('1.000 UNIDADES TRIBUTARIAS A PERCIBIR POR LAS PERSONAS NATURALES RESIDENCIADAS EN EL PAÍS', X + W / 2, 92, { a: 'center', t: 6.5 });
  let y = 102;
  // datos del contribuyente
  caja(X, y, 270, 24); caja(X + 270, y, 130, 24); caja(X + 400, y, 132, 24);
  t('1. APELLIDOS Y NOMBRES', X + 3, y + 7, { t: 5.5 }); t(p.nombre, X + 6, y + 19, { t: 8.5, b: true });
  t('2. CÉDULA DE IDENTIDAD', X + 273, y + 7, { t: 5.5 }); t(`${p.letra || 'V'}-${Number(p.cedula).toLocaleString('es-VE')}`, X + 335, y + 19, { a: 'center', t: 8.5, b: true });
  t('3. N.º DE RIF DEL CONTRIBUYENTE', X + 403, y + 7, { t: 5.5 });
  y += 24;
  caja(X, y, 330, 30); caja(X + 330, y, 130, 30); caja(X + 460, y, 72, 30);
  t('4. NOMBRE DE LAS EMPRESAS U ORGANISMOS DONDE TRABAJA', X + 3, y + 7, { t: 5.5 }); t('a. ' + (EMPRESAS[p.empresa] || p.empresa), X + 6, y + 17, { t: 7 });
  if (dat.remuneraciones.slice(1).some((v) => v > 0)) t('b./c./d. Otras empresas u organismos (ver casilla A)', X + 6, y + 26, { t: 6 });
  t('5. SI ES VARIACIÓN MARQUE X EN EL MES', X + 333, y + 7, { t: 5.5 });
  [['MAR', 3], ['JUN', 6], ['SEP', 9], ['DIC', 12]].forEach(([m, n], i) => { t(m, X + 345 + i * 28, y + 16, { t: 6 }); caja(X + 341 + i * 28, y + 19, 18, 9); if (a.tipo === 'VARIACION' && Number(a.mes) === n) t('X', X + 350 + i * 28, y + 26.5, { a: 'center', b: true, t: 7 }); });
  if (a.tipo === 'VARIACION' && ![3, 6, 9, 12].includes(Number(a.mes))) t(`Variación: ${a.motivo || ''}`.slice(0, 40), X + 333, y + 33 + 4, { t: 5 });
  t('6. AÑO GRAVABLE', X + 463, y + 7, { t: 5.5 }); t(a.anio, X + 496, y + 22, { a: 'center', b: true, t: 10 });
  y += 36;
  y = seccion('A', 'ESTIMACIÓN DE LAS REMUNERACIONES POR RECIBIR EN EL AÑO GRAVABLE', y);
  ['a) Cantidad por percibir de la empresa u organismo', 'b) Cantidad por percibir de la empresa u organismo', 'c) Cantidad por percibir de la empresa u organismo', 'd) Cantidad por percibir de la empresa u organismo']
    .forEach((s, i) => { y = fila(s, 'Bs. ' + bs(dat.remuneraciones[i]), y); });
  y = fila('TOTAL QUE ESTIMA PERCIBIR  (a + b + c + d)', 'Bs. ' + bs(r.A), y, { letra: 'A', b: true });
  y = seccion('B', 'CONVERSIÓN DE LAS REMUNERACIONES ESTIMADAS EN A A UNIDADES TRIBUTARIAS (U.T.)', y);
  y = fila(`Bs. ${bs(r.A)}  ÷  valor U.T. del año gravable Bs. ${bs(r.ut)}`, bs(r.B) + ' U.T.', y, { letra: 'B', b: true });
  y = seccion('C', 'DESGRAVÁMENES QUE ESTIMA PAGARÁ EN EL AÑO GRAVABLE (no llene C ni D si opta por el desgravamen único)', y);
  ['Institutos docentes (contribuyente y descendientes no mayores de 25 años)', 'Primas de seguros de hospitalización, cirugía y maternidad', 'Servicios médicos, odontológicos y de hospitalización (incluye carga familiar)', 'Intereses por adquisición de vivienda principal o alquiler de la vivienda']
    .forEach((s, i) => { y = fila(`${i + 1}. ${s}`, r.unico ? '—' : 'Bs. ' + bs(r.desgravamenes[['educacion', 'hcm', 'medicos', 'vivienda'][i]]), y); });
  y = fila('TOTAL DESGRAVÁMENES  (1 + 2 + 3 + 4)', 'Bs. ' + bs(r.C), y, { letra: 'C', b: true });
  y = seccion('D', 'CONVERSIÓN DE LOS DESGRAVÁMENES ESTIMADOS EN C A UNIDADES TRIBUTARIAS', y);
  y = fila(`Bs. ${bs(r.C)}  ÷  Bs. ${bs(r.ut)}`, bs(r.D) + ' U.T.', y, { letra: 'D' });
  y = seccion('E', 'DESGRAVAMEN ÚNICO (no considere otro desgravamen)', y);
  y = fila('1. Monto fijo del desgravamen (art. 61 de la Ley)', r.E ? bs(r.E) + ' U.T.' : '—', y, { letra: 'E' });
  y = fila(`Remuneraciones en B (${bs(r.B)} U.T.)  -  desgravámenes en D o en E (${bs(r.unico ? r.E : r.D)} U.T.)`, bs(r.F) + ' U.T.', y, { letra: 'F', b: true });
  y = seccion('G', 'CÁLCULO DEL IMPUESTO ESTIMADO PARA EL AÑO GRAVABLE (tarifa N.º 1)', y);
  y = fila('Total de impuesto del año gravable', bs(r.G) + ' U.T.', y, { letra: 'G' });
  y = seccion('H', 'REBAJAS AL IMPUESTO DETERMINADO EN G (U.T.)', y);
  y = fila('1. Rebaja persona natural (art. 63 de la Ley)', bs(r.rebajas.personal) + ' U.T.', y);
  y = fila(`2. Carga familiar:  ${r.cargas}  ×  10`, bs(r.rebajas.cargas) + ' U.T.', y);
  y = fila(`3. Impuestos retenidos de más en años anteriores (Bs. ${bs(dat.retenidoDeMas)})`, bs(r.rebajas.retenido) + ' U.T.', y);
  y = fila('TOTAL REBAJAS  (1 + 2 + 3)', bs(r.H) + ' U.T.', y, { letra: 'H', b: true });
  y = seccion('I', 'IMPUESTO ESTIMADO A RETENER EN EL AÑO GRAVABLE  (G - H)', y);
  y = fila('Impuesto estimado', bs(r.I) + ' U.T.', y, { letra: 'I', b: true });
  y = seccion('J', 'PORCENTAJE DE RETENCIÓN INICIAL  (total casilla I ÷ total casilla B × 100)', y);
  caja(X, y, W, 18); t('Porcentaje de retención aplicable sobre cada pago o abono en cuenta', X + 6, y + 12, { t: 7 }); t('J', X + W - 150, y + 12, { b: true, t: 9 }); t(bs(r.J) + ' %', X + W - 6, y + 13, { a: 'right', b: true, t: 11 }); y += 18;
  y = seccion('K', 'PORCENTAJE POR VARIACIÓN DE LOS DATOS, PARA EL RESTO DEL AÑO GRAVABLE', y);
  if (r.K != null) {
    y = fila('1. Total de impuesto que le han retenido hasta la fecha', 'Bs. ' + bs(dat.variacion.retenido), y);
    y = fila('2. Total de remuneraciones percibidas hasta la fecha', 'Bs. ' + bs(dat.variacion.percibido), y);
    caja(X, y, W, 18); t('(I × valor U.T. - total 1) ÷ (a - total 2) × 100', X + 6, y + 12, { t: 7 }); t('K', X + W - 150, y + 12, { b: true, t: 9 }); t(bs(r.K) + ' %', X + W - 6, y + 13, { a: 'right', b: true, t: 11 }); y += 18;
  } else y = fila('No aplica (estimación inicial)', '—', y);
  y += 10;
  const fecha = new Date(a.entregada || Date.now()).toLocaleDateString('es-VE', { timeZone: 'America/Caracas' });
  caja(X, y, 262, 62); caja(X + 270, y, 262, 62);
  t('L   CONTRIBUYENTE: constancia de entrega de la determinación del porcentaje', X + 4, y + 8, { t: 5.8 }); t('     de retención al agente de retención', X + 4, y + 15, { t: 5.8 });
  t(`Lugar: CARACAS     Fecha: ${fecha}`, X + 6, y + 30, { t: 7 }); doc.line(X + 20, y + 50, X + 240, y + 50); t('FIRMA DEL CONTRIBUYENTE', X + 130, y + 58, { a: 'center', t: 6 });
  t('M   AGENTE DE RETENCIÓN: constancia de recepción y verificación de la información', X + 274, y + 8, { t: 5.8 });
  t('Lugar: ____________   Fecha: ____________', X + 276, y + 30, { t: 7 }); doc.line(X + 290, y + 50, X + 510, y + 50); t('FIRMA', X + 400, y + 58, { a: 'center', t: 6 });
  t(`Entregada en el CAC el ${new Date(a.entregada || Date.now()).toLocaleString('es-VE', { timeZone: 'America/Caracas' })} · ${a.tipo === 'VARIACION' ? 'Variación' : 'Estimación inicial'}`, X, 770, { t: 6 });
  const limpio = p.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { blob: doc.output('blob'), nombreArchivo: `AR-I_${a.anio}_${limpio}${a.tipo === 'VARIACION' ? '_variacion' : ''}.pdf` };
}

export async function descargarAriPdf(d) {
  const { blob, nombreArchivo } = await construirAriPdf(d);
  const url = URL.createObjectURL(blob), el = Object.assign(document.createElement('a'), { href: url, download: nombreArchivo });
  document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
