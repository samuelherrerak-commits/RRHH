"""Arma docs/presentacion/novedades-cac.html: un solo archivo con las capturas, íconos y el QR incrustados.
Uso: python3 docs/presentacion/novedades/construir.py <carpeta-de-capturas>"""
import base64, io, re, sys, pathlib
from PIL import Image

AQUI = pathlib.Path(__file__).parent
CAP = pathlib.Path(sys.argv[1])
ICONOS = {  # mismos trazos que el CAC (web/js/app.js)
  'recibos': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  'vacaciones': '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  'perfil': '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  'fideicomiso': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'equipo': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'apple': '<path d="M12 7c1-2 3-3 4.5-3-.2 1.6-1 3-2.6 3.6"/><path d="M17.5 12.5c0-2 1.6-3.2 2-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8s-1.8-.8-3-.8C7.4 7.4 5 8.9 5 12.6c0 2.3.9 4.7 2 6.2.9 1.3 1.8 2.3 3 2.2 1.1 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.2 2.8-2.3.6-.9 1-1.8 1.2-2.4-1.9-.8-2.5-2.6-2.5-3.8Z"/>',
  'android': '<rect x="5" y="9" width="14" height="10" rx="2"/><path d="M8 9a4 4 0 0 1 8 0"/><path d="M8 5 7 3.5M16 5l1-1.5"/><circle cx="10" cy="7" r=".4"/><circle cx="14" cy="7" r=".4"/><path d="M9 19v2M15 19v2"/>',
}
def icono(n): return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONOS[n]}</svg>'
def imagen(nombre, ancho, alto_max=None, calidad=84):
    im = Image.open(CAP / nombre).convert('RGB')
    if alto_max and im.height * ancho / im.width > alto_max:
        im = im.crop((0, 0, im.width, int(alto_max * im.width / ancho)))
    im = im.resize((ancho, round(im.height * ancho / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=calidad, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
IMAGENES = {  # 2× el tamaño en pantalla
  'recibos': ('recibos.png', 552, 1160), 'plan': ('plan.png', 552, 1160), 'perfil': ('perfil-pregunta.png', 552, 1160),
  'inicio': ('inicio.png', 552, 1160), 'avisos': ('avisos.png', 552, 1160), 'cumple': ('tarjeta-cumple.png', 760, None),
}
qr = re.search(r'<figure class="qr">(<svg.*?</svg>)', (AQUI.parent / 'presentacion-cac.html').read_text(encoding='utf-8'), re.S).group(1)
html = (AQUI / 'plantilla.html').read_text(encoding='utf-8')
html = re.sub(r'\{\{ico:(\w+)\}\}', lambda m: icono(m.group(1)), html)
html = re.sub(r'\{\{img:(\w+)\}\}', lambda m: imagen(*IMAGENES[m.group(1)]), html)
html = html.replace('{{qr}}', qr)
salida = AQUI.parent / 'novedades-cac.html'
salida.write_text(html, encoding='utf-8')
print(salida, round(len(html) / 1024), 'KB')
