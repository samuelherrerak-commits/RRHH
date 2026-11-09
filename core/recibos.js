/* ==========================================================
   Recibos de pago: leer cada hoja del PDF de nómina (texto ya extraído),
   proponer el concepto y asignar cada hoja a su colaborador.
   Funciones puras: las usan el navegador, Apps Script y las pruebas.
   ========================================================== */
(function (raiz) {
  'use strict';

  function dependencia(r, n) { return new Proxy({}, { get: function (_, k) { return r[n][k]; } }); }
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var Empleados = isNode ? require('./empleados.js') : dependencia(raiz, 'Empleados');

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /** Cédula impresa en la hoja («Cédula … V028180545» o «V-14.891.031»). Devuelve el texto tal cual o ''. */
  function cedulaDeTexto(texto) {
    var t = String(texto || '');
    var tras = /C[ée]dula[\s\S]{0,200}?\b([VE])\s*-?\s*([\d.]{6,12})\b/i.exec(t);
    var m = tras || /\b([VE])\s*-?\s*(\d{6,10})\b/.exec(t);
    return m ? (m[1].toUpperCase() + m[2].replace(/\./g, '')) : '';
  }

  /** Nombre del colaborador en la hoja: «Total a Pagar NOMBRE 28.096,05» (formato de la nómina) o la línea bajo «Nombre y Apellido». */
  function nombreDeTexto(texto) {
    var t = String(texto || '').replace(/\s+/g, ' ');
    var m = /Total a Pagar\s+(.+?)\s+-?[\d.]+,\d{2}\b/i.exec(t) || /Nombre y Apellido\s+(?:Departamento\s+)?([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ' ]{3,80}?)\s{1,}(?=[A-ZÁÉÍÓÚ][a-záéíóúñ])/.exec(t);
    return m ? m[1].trim() : '';
  }

  /**
   * Concepto propuesto a partir del encabezado «Nómina: Nómina Quincenal - NQ-155 (16/10/2026 - 31/10/2026)».
   * Quincena 1-15 → «1Q», 16-fin → «2Q»; mes completo → solo el mes. Devuelve '' si no lo reconoce.
   */
  function conceptoSugerido(texto) {
    var t = String(texto || '').replace(/\s+/g, ' ');
    var nom = /N[óo]mina:\s*([^()]+?)\s*\((\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\)/i.exec(t);
    if (!nom) return '';
    var nombre = nom[1], d1 = +nom[2], m1 = +nom[3], y1 = +nom[4], d2 = +nom[5], m2 = +nom[6];
    var tipo = /cesta|alimenta/i.test(nombre) ? 'Cestaticket' : /vacaci/i.test(nombre) ? 'Vacaciones' : /utilidad|aguinaldo/i.test(nombre) ? 'Utilidades'
      : /bono/i.test(nombre) ? 'Bono' : 'Nómina';
    if (m1 !== m2) return tipo + ' ' + nom[2] + '/' + nom[3] + ' al ' + nom[5] + '/' + nom[6] + '/' + nom[7];
    var mes = MESES[m1 - 1] + ' ' + y1;
    if (d1 === 1 && d2 <= 15) return tipo + ' 1Q ' + mes;
    if (d1 >= 16) return tipo + ' 2Q ' + mes;
    return tipo + ' ' + mes;
  }

  /**
   * Asigna cada hoja a un empleado: 1) por cédula (con o sin dígito verificador); 2) por nombre exacto
   * (sin tildes ni espacios dobles). hojas: [{ pagina, cedula, nombre }]. Devuelve la misma lista con
   * { clave, nombreEmpleado, como: 'cedula' | 'nombre' | '', inactivo, repetida }.
   */
  function asignarHojas(hojas, empleados) {
    var porNumero = {}, porNombre = {};
    (empleados || []).forEach(function (e) {
      if (!e.cedulaNumero) return;
      var n = String(e.cedulaNumero).replace(/^0+/, '');
      if (!porNumero[n] || porNumero[n].estado === 'Inactivo') porNumero[n] = e;
      var k = Empleados.normalizarNombre(e.nombre);
      porNombre[k] = porNombre[k] === undefined ? e : null;   // nombre repetido: no se usa
    });
    var usadas = {};
    return (hojas || []).map(function (h) {
      var r = { pagina: h.pagina, cedula: h.cedula || '', nombre: h.nombre || '', clave: '', nombreEmpleado: '', como: '', inactivo: false, repetida: false };
      var c = Empleados.parsearCedula(h.cedula || '');
      var e = c.numero ? porNumero[c.numero] : null;
      if (!e && h.cedula) {
        var d = String(h.cedula).replace(/\D/g, '');
        if (d.length === 8) e = porNumero[d.slice(0, 7).replace(/^0+/, '')] || null;   // cédula de 7 dígitos con verificador
      }
      if (e) r.como = 'cedula';
      else if (h.nombre && porNombre[Empleados.normalizarNombre(h.nombre)]) { e = porNombre[Empleados.normalizarNombre(h.nombre)]; r.como = 'nombre'; }
      if (e) {
        r.clave = Empleados.claveCedula(e); r.nombreEmpleado = e.nombre; r.inactivo = e.estado === 'Inactivo';
        if (usadas[r.clave]) r.repetida = true;
        usadas[r.clave] = true;
      }
      return r;
    });
  }

  var api = { cedulaDeTexto: cedulaDeTexto, nombreDeTexto: nombreDeTexto, conceptoSugerido: conceptoSugerido, asignarHojas: asignarHojas, MESES: MESES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Recibos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
