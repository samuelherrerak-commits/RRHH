// Tarjetas de cumpleaños y aniversario del Grupo Prosein, dibujadas en un <canvas> de 1080×1350 (se ven en el CAC y se descargan en PNG).
const ROJO = '#E1251B', CARBON = '#16181B', HUESO = '#FBF8F5', GRIS = '#E9E4DF', TEXTO = '#3B3E42';
const PATRON = 'rbgcrdbgerbgbrgcbdgerbcbgrbegcbrdgbrcgbe';
const PIEZAS = [[70, 520, 34, 18, 'r'], [960, 560, 28, -22, 'c'], [34, 770, 22, 35, 'c'], [1010, 880, 36, 12, 'r'], [30, 1010, 30, -15, 'r'], [990, 1040, 24, 40, 'g'], [190, 600, 18, 50, 'g'], [905, 470, 16, -40, 'r']];
let logo = null;

function cargarLogo() {
  if (logo) return logo;
  logo = new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = 'assets/logo-prosein.png'; });
  return logo;
}
function redondeado(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
/** Escribe texto ajustando el tamaño para que no pase de `ancho`. Devuelve el tamaño usado. */
function ajustado(c, texto, x, y, peso, tam, ancho, min = 30) {
  while (tam > min) { c.font = `${peso} ${tam}px Poppins, sans-serif`; if (c.measureText(texto).width <= ancho) break; tam -= 2; }
  c.fillText(texto, x, y); return tam;
}
function parrafo(c, partes, cx, y, ancho, alto) {
  // partes: [[texto, negrita]] → líneas centradas
  const palabras = []; partes.forEach(([t, b]) => t.split(/(\s+)/).filter((p) => p && !/^\s+$/.test(p)).forEach((p) => palabras.push([p, b])));
  const fuente = (b) => `${b ? 600 : 400} 31px Poppins, sans-serif`, lineas = [[]]; let w = 0;
  const medir = (p, b) => { c.font = fuente(b); return c.measureText(p).width; };
  const esp = medir(' ', false);
  palabras.forEach(([p, b]) => { const m = medir(p, b); if (w && w + esp + m > ancho) { lineas.push([]); w = 0; } lineas[lineas.length - 1].push([p, b, m]); w += (w ? esp : 0) + m; });
  lineas.forEach((l, i) => {
    const total = l.reduce((t, [, , m], k) => t + m + (k ? esp : 0), 0); let x = cx - total / 2;
    l.forEach(([p, b, m]) => { c.font = fuente(b); c.fillStyle = b ? CARBON : TEXTO; c.textAlign = 'left'; c.fillText(p, x, y + i * alto); x += m + esp; });
  });
  return y + (lineas.length - 1) * alto;
}

/** datos: { tipo: 'CUMPLEANOS' | 'ANIVERSARIO', nombre, anios } → canvas */
export async function dibujarTarjeta({ tipo, nombre, anios = 1 }) {
  await Promise.all([document.fonts.load('700 100px Poppins'), document.fonts.load('600 30px Poppins'), document.fonts.load('400 30px Poppins'), document.fonts.load('500 30px Poppins')]).catch(() => {});
  const img = await cargarLogo(), cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
  const c = cv.getContext('2d'), cumple = tipo === 'CUMPLEANOS';
  c.fillStyle = HUESO; c.fillRect(0, 0, 1080, 1350);
  // mosaico (con desvanecido hacia abajo)
  const m = document.createElement('canvas'); m.width = 1080; m.height = 470; const mc = m.getContext('2d');
  mc.fillStyle = '#fff'; mc.fillRect(0, 0, 1080, 470);
  const tw = (1080 - 16 - 8 * 8) / 9, th = (470 - 16 - 3 * 8) / 4;
  for (let k = 0; k < 36; k++) {
    const x = 8 + (k % 9) * (tw + 8), y = 8 + Math.floor(k / 9) * (th + 8), t = PATRON[k];
    redondeado(mc, x, y, tw, th, 6); mc.save(); mc.clip();
    if (t === 'd' || t === 'e') {
      mc.fillStyle = t === 'd' ? '#fff' : GRIS; mc.fillRect(x, y, tw, th);
      mc.fillStyle = t === 'd' ? ROJO : CARBON; mc.beginPath(); mc.moveTo(x, y); mc.lineTo(x + tw, y); mc.lineTo(x, y + th); mc.closePath(); mc.fill();
    } else { mc.fillStyle = { r: ROJO, c: CARBON, b: '#fff', g: GRIS }[t]; mc.fillRect(x, y, tw, th); }
    mc.restore();
    if (t === 'b') { redondeado(mc, x + 1, y + 1, tw - 2, th - 2, 6); mc.strokeStyle = GRIS; mc.lineWidth = 2; mc.stroke(); }
  }
  const g = mc.createLinearGradient(0, 0, 0, 470); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  mc.globalCompositeOperation = 'destination-out'; mc.fillStyle = g; mc.fillRect(0, 0, 1080, 470);
  c.drawImage(m, 0, 0);
  // confeti de cerámica
  PIEZAS.forEach(([x, y, t, rot, col]) => { c.save(); c.translate(x + t / 2, y + t / 2); c.rotate((rot * Math.PI) / 180); c.fillStyle = { r: ROJO, c: CARBON, g: '#D9D2CB' }[col]; redondeado(c, -t / 2, -t / 2, t, t, 4); c.fill(); c.restore(); });
  // insignia: torta o años
  c.save(); c.shadowColor = cumple ? 'rgba(22,24,27,.14)' : 'rgba(225,37,27,.35)'; c.shadowBlur = 36; c.shadowOffsetY = 14;
  c.beginPath(); c.arc(540, cumple ? 405 : 390, cumple ? 75 : 110, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.restore();
  c.textAlign = 'center';
  if (cumple) {
    c.save(); c.translate(540 - 46, 405 - 46); c.scale(92 / 24, 92 / 24); c.strokeStyle = ROJO; c.lineWidth = 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
    ['M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8', 'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1', 'M2 21h20', 'M7 8v3', 'M12 8v3', 'M17 8v3', 'M7 4h.01', 'M12 4h.01', 'M17 4h.01'].forEach((d) => c.stroke(new Path2D(d)));
    c.restore();
  } else {
    c.beginPath(); c.arc(540, 390, 100, 0, Math.PI * 2); c.fillStyle = ROJO; c.fill();
    c.fillStyle = '#fff'; ajustado(c, String(anios), 540, 400, 700, 96, 170, 50);
    c.font = '600 24px Poppins, sans-serif'; c.letterSpacing = '5px'; c.fillText(anios === 1 ? 'AÑO' : 'AÑOS', 543, 445); c.letterSpacing = '0px';
  }
  // títulos
  c.fillStyle = ROJO; c.font = '600 28px Poppins, sans-serif'; c.letterSpacing = '9px';
  c.fillText(cumple ? 'HOY CELEBRAMOS CONTIGO' : 'GRACIAS POR TU COMPROMISO', 545, 537); c.letterSpacing = '0px';
  c.fillStyle = CARBON; c.font = '700 104px Poppins, sans-serif'; c.fillText('¡Feliz', 540, 650);
  c.fillStyle = ROJO; ajustado(c, cumple ? 'cumpleaños!' : 'aniversario!', 540, 752, 700, 104, 880, 60);
  // nombre (una línea) subrayado
  c.fillStyle = CARBON; const tn = ajustado(c, nombre, 540, 855, 600, 54, 900, 30);
  c.font = `600 ${tn}px Poppins, sans-serif`; const an = c.measureText(nombre).width;
  c.fillStyle = ROJO; c.fillRect(540 - an / 2, 875, an, 6);
  // mensaje y firma
  const partes = cumple ? [['Gracias por ser parte de nuestra familia y por todo lo que aportas cada día. Te deseamos un año lleno de salud, alegría y nuevos logros.', false]]
    : [['Hoy cumples', false], [anios === 1 ? 'tu primer año' : `${anios} años`, true], ['con nosotros. Gracias por tu dedicación, tu esfuerzo y por crecer junto a nuestra familia. ¡Por muchos años más!', false]];
  const fin = parrafo(c, partes, 540, 950, 820, 47);
  c.textAlign = 'center'; c.fillStyle = TEXTO; c.font = '500 27px Poppins, sans-serif';
  c.fillText(cumple ? 'Con cariño, tu familia del Grupo Prosein' : 'Con orgullo, tu familia del Grupo Prosein', 540, fin + 75);
  // pie
  c.fillStyle = '#fff'; c.fillRect(0, 1180, 1080, 170); c.fillStyle = ROJO; c.fillRect(0, 1180, 1080, 8);
  if (img) c.drawImage(img, 90, 1205, 120 * (img.width / img.height), 120);
  c.textAlign = 'right'; c.fillStyle = CARBON; c.font = '700 30px Poppins, sans-serif'; c.letterSpacing = '1px'; c.fillText('GRUPO PROSEIN', 990, 1262); c.letterSpacing = '0px';
  c.fillStyle = TEXTO; c.font = '400 23px Poppins, sans-serif'; c.fillText('Prosein · Austral · Mil Cerámicas', 990, 1298);
  return cv;
}

export async function descargarTarjeta(datos) {
  const cv = await dibujarTarjeta(datos), a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = `${datos.tipo === 'CUMPLEANOS' ? 'Cumpleanos' : 'Aniversario'}-${String(datos.nombre).normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}
