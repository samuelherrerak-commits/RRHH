/* ==========================================================
   Perfil del trabajador: datos que el propio colaborador mantiene al día
   (contacto, contacto de emergencia, carga familiar, datos personales y otros)
   y las campañas de actualización de datos que abre Gestión Humana.
   Funciones puras: las usan el navegador, Apps Script y las pruebas.
   ========================================================== */
(function (raiz) {
  'use strict';

  var LISTAS = {
    estadoCivil: ['Soltero(a)', 'Casado(a)', 'Concubino(a)', 'Divorciado(a)', 'Viudo(a)'],
    estudios: ['Primaria', 'Bachiller', 'Técnico Medio', 'TSU', 'Universitario', 'Postgrado'],
    tallaCamisa: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    parentesco: ['Hijo(a)', 'Cónyuge', 'Concubino(a)', 'Padre', 'Madre', 'Hermano(a)', 'Otro'],
    parentescoEmergencia: ['Cónyuge', 'Padre', 'Madre', 'Hijo(a)', 'Hermano(a)', 'Otro familiar', 'Amigo(a)'],
    estados: ['Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar', 'Carabobo', 'Cojedes', 'Delta Amacuro', 'Distrito Capital', 'Falcón', 'Guárico',
      'La Guaira', 'Lara', 'Mérida', 'Miranda', 'Monagas', 'Nueva Esparta', 'Portuguesa', 'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia'],
  };

  /** Secciones y campos. tipo: texto | telefono | correo | lista | numero | cuenta | fecha. req: obligatorio para dar la sección por completa. */
  var SECCIONES = [
    { id: 'contacto', nombre: 'Contacto', campos: [
      { id: 'telefono', nombre: 'Teléfono celular', tipo: 'telefono', req: true, pregunta: '¿Cuál es tu número de celular?', ayuda: 'El número donde te podemos ubicar.' },
      { id: 'telefono2', nombre: 'Otro teléfono', tipo: 'telefono', pregunta: '¿Tienes otro número de teléfono?', ayuda: 'De tu casa o un segundo celular.' },
      { id: 'correo', nombre: 'Correo personal', tipo: 'correo', req: true, pregunta: '¿Cuál es tu correo personal?' },
      { id: 'estado', nombre: 'Estado', tipo: 'lista', lista: 'estados', req: true, pregunta: '¿En qué estado vives?' },
      { id: 'ciudad', nombre: 'Ciudad o municipio', tipo: 'texto', req: true, pregunta: '¿En qué ciudad o municipio?' },
      { id: 'direccion', nombre: 'Dirección de habitación', tipo: 'texto', largo: 250, req: true, pregunta: '¿Cuál es tu dirección de habitación?', ayuda: 'Urbanización o sector, calle y número de casa o apartamento.' },
    ] },
    { id: 'emergencia', nombre: 'Contacto de emergencia', campos: [
      { id: 'nombre', nombre: 'Nombre y apellido', tipo: 'texto', req: true, pregunta: 'En caso de emergencia, ¿a quién llamamos?', ayuda: 'Nombre y apellido de esa persona.' },
      { id: 'parentesco', nombre: 'Parentesco', tipo: 'lista', lista: 'parentescoEmergencia', req: true, pregunta: '¿Qué es esa persona para ti?' },
      { id: 'telefono', nombre: 'Teléfono', tipo: 'telefono', req: true, pregunta: '¿A qué número la llamamos?' },
    ] },
    { id: 'familia', nombre: 'Carga familiar', lista: true, campos: [
      { id: 'nombre', nombre: 'Nombre y apellido', tipo: 'texto', req: true },
      { id: 'parentesco', nombre: 'Parentesco', tipo: 'lista', lista: 'parentesco', req: true },
      { id: 'fechaNacimiento', nombre: 'Fecha de nacimiento', tipo: 'fecha', req: true },
      { id: 'cedula', nombre: 'Cédula (si tiene)', tipo: 'numero' },
    ] },
    { id: 'personales', nombre: 'Datos personales y otros', campos: [
      { id: 'estadoCivil', nombre: 'Estado civil', tipo: 'lista', lista: 'estadoCivil', req: true, pregunta: '¿Cuál es tu estado civil?' },
      { id: 'estudios', nombre: 'Nivel de estudios', tipo: 'lista', lista: 'estudios', req: true, pregunta: '¿Cuál es tu nivel de estudios?', ayuda: 'El más alto que hayas terminado.' },
      { id: 'profesion', nombre: 'Profesión u oficio', tipo: 'texto', pregunta: '¿Cuál es tu profesión u oficio?' },
      { id: 'camisa', nombre: 'Talla de camisa', tipo: 'lista', lista: 'tallaCamisa', req: true, pregunta: '¿Qué talla de camisa usas?', ayuda: 'Para la dotación de uniformes.' },
      { id: 'pantalon', nombre: 'Talla de pantalón', tipo: 'numero', req: true, pregunta: '¿Qué talla de pantalón usas?', ayuda: 'Por ejemplo: 30, 32, 34.' },
      { id: 'zapatos', nombre: 'Talla de zapatos', tipo: 'numero', req: true, pregunta: '¿Qué talla de zapatos usas?', ayuda: 'Por ejemplo: 38, 40, 42.' },
      { id: 'banco', nombre: 'Banco de su cuenta nómina', tipo: 'texto', pregunta: '¿En qué banco cobras tu nómina?' },
      { id: 'cuenta', nombre: 'Número de cuenta (20 dígitos)', tipo: 'cuenta', pregunta: '¿Cuál es el número de esa cuenta?', ayuda: 'Los 20 dígitos, sin guiones.' },
    ] },
  ];
  var MAX_FAMILIA = 15;

  /** Plan sugerido: el perfil en 4 campañas cortas (una sección cada una) que Gestión Humana lanza de una en una. */
  var PLAN_CAMPANAS = [
    { titulo: 'Actualización de datos (1 de 4): tu contacto', secciones: ['contacto'],
      mensaje: 'Queremos tener al día tu teléfono, tu correo y tu dirección para poder comunicarnos contigo.' },
    { titulo: 'Actualización de datos (2 de 4): contacto de emergencia', secciones: ['emergencia'],
      mensaje: 'Si te pasa algo en el trabajo, ¿a quién llamamos?' },
    { titulo: 'Actualización de datos (3 de 4): tu carga familiar', secciones: ['familia'],
      mensaje: 'Cuéntanos quiénes dependen de ti para tomarlos en cuenta en los beneficios y actividades para tu familia.' },
    { titulo: 'Actualización de datos (4 de 4): tallas y datos personales', secciones: ['personales'],
      mensaje: 'Tus tallas para la dotación de uniformes, tu estado civil, tus estudios y tu cuenta nómina. Con esta terminas tu perfil.' },
  ];

  function seccion(id) { return SECCIONES.filter(function (s) { return s.id === id; })[0]; }
  function texto(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  /** Limpia y valida un valor. Devuelve { valor, error }. */
  function limpiarCampo(c, v) {
    var t = texto(v);
    if (!t) return { valor: '' };
    if (c.tipo === 'telefono') {
      var d = t.replace(/\D/g, '');
      if (d.length === 12 && d.indexOf('58') === 0) d = '0' + d.slice(2);
      if (d.length === 10 && d[0] !== '0') d = '0' + d;
      if (d.length !== 11) return { valor: t, error: c.nombre + ': escribe 11 dígitos, por ejemplo 04141234567.' };
      return { valor: d.slice(0, 4) + '-' + d.slice(4) };
    }
    if (c.tipo === 'correo') {
      t = t.toLowerCase().replace(/\s/g, '');
      return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(t) ? { valor: t } : { valor: t, error: c.nombre + ': no parece un correo válido.' };
    }
    if (c.tipo === 'lista') return LISTAS[c.lista].indexOf(t) !== -1 ? { valor: t } : { valor: '', error: c.nombre + ': elige una opción de la lista.' };
    if (c.tipo === 'numero') return /^[\d.,\s-]{1,15}$/.test(t) ? { valor: t.replace(/[\s.]/g, '') } : { valor: t, error: c.nombre + ': escribe solo números.' };
    if (c.tipo === 'cuenta') { var n = t.replace(/\D/g, ''); return n.length === 20 ? { valor: n } : { valor: t, error: c.nombre + ': debe tener 20 dígitos.' }; }
    if (c.tipo === 'fecha') return /^\d{4}-\d{2}-\d{2}$/.test(t) ? { valor: t } : { valor: t, error: c.nombre + ': fecha no válida.' };
    return { valor: t.slice(0, c.largo || 120) };
  }

  /** Limpia los datos que envía el trabajador. Devuelve { datos, errores }. Solo se toman las secciones enviadas. */
  function normalizar(entrada) {
    var datos = {}, errores = [];
    SECCIONES.forEach(function (s) {
      if (!entrada || entrada[s.id] === undefined) return;
      if (s.lista) {
        var filas = Array.isArray(entrada[s.id]) ? entrada[s.id] : [];
        if (filas.length > MAX_FAMILIA) errores.push('Puedes registrar hasta ' + MAX_FAMILIA + ' familiares.');
        datos[s.id] = filas.slice(0, MAX_FAMILIA).map(function (f, i) {
          var o = {};
          s.campos.forEach(function (c) { var r = limpiarCampo(c, f && f[c.id]); o[c.id] = r.valor; if (r.error) errores.push('Familiar ' + (i + 1) + ' · ' + r.error); });
          return o;
        }).filter(function (o) { return s.campos.some(function (c) { return o[c.id]; }); });
        datos[s.id].forEach(function (o, i) { s.campos.forEach(function (c) { if (c.req && !o[c.id]) errores.push('Familiar ' + (i + 1) + ': falta ' + c.nombre.toLowerCase() + '.'); }); });
        return;
      }
      var o = {};
      s.campos.forEach(function (c) { var r = limpiarCampo(c, entrada[s.id] && entrada[s.id][c.id]); o[c.id] = r.valor; if (r.error) errores.push(r.error); });
      datos[s.id] = o;
    });
    if (entrada && entrada.sinFamilia !== undefined) datos.sinFamilia = !!entrada.sinFamilia;
    return { datos: datos, errores: errores };
  }

  /** ¿La sección está completa? (la carga familiar cuenta si hay familiares o si marcó «no tengo carga familiar»). */
  function seccionCompleta(datos, id) {
    var s = seccion(id), d = datos && datos[id];
    if (!s) return true;
    if (s.lista) return !!(datos && (datos.sinFamilia || (d && d.length)));
    return !!d && s.campos.every(function (c) { return !c.req || d[c.id]; });
  }
  function faltantes(datos, secciones) { return (secciones || SECCIONES.map(function (s) { return s.id; })).filter(function (id) { return !seccionCompleta(datos, id); }); }

  function aTexto(s, v) {
    if (s.lista) return (v || []).map(function (f) { return [f.nombre, f.parentesco, f.fechaNacimiento].filter(Boolean).join(' · '); }).join(' | ');
    return v || '';
  }
  /** Cambios entre el perfil anterior y el nuevo: [{ seccion, campo, nombre, antes, despues }]. */
  function diferencias(antes, despues) {
    var out = [];
    SECCIONES.forEach(function (s) {
      if (!despues || despues[s.id] === undefined) return;
      if (s.lista) {
        var a = aTexto(s, antes && antes[s.id]), b = aTexto(s, despues[s.id]);
        if (a !== b) out.push({ seccion: s.id, campo: s.id, nombre: s.nombre, antes: a, despues: b });
        return;
      }
      s.campos.forEach(function (c) {
        var a = (antes && antes[s.id] && antes[s.id][c.id]) || '', b = despues[s.id][c.id] || '';
        if (a !== b) out.push({ seccion: s.id, campo: c.id, nombre: s.nombre + ' · ' + c.nombre, antes: a, despues: b });
      });
    });
    return out;
  }

  /** ¿Esta campaña le toca a esta persona? alcance: { tipo: 'todos'|'empresas'|'personas', empresas: [], claves: [] } */
  function enAlcance(campana, persona) {
    var a = campana.alcance || { tipo: 'todos' };
    if (a.tipo === 'empresas') return (a.empresas || []).indexOf(persona.empresa) !== -1;
    if (a.tipo === 'personas') return (a.claves || []).indexOf(persona.clave) !== -1;
    return true;
  }
  /** Una persona completó la campaña si la confirmó y las secciones pedidas están completas. */
  function completo(campana, perfil) {
    return !!(perfil && perfil.confirmadas && perfil.confirmadas[campana.id]) && !faltantes(perfil.datos, campana.secciones).length;
  }

  var api = { LISTAS: LISTAS, SECCIONES: SECCIONES, PLAN_CAMPANAS: PLAN_CAMPANAS, MAX_FAMILIA: MAX_FAMILIA, seccion: seccion, limpiarCampo: limpiarCampo, normalizar: normalizar,
    seccionCompleta: seccionCompleta, faltantes: faltantes, diferencias: diferencias, enAlcance: enAlcance, completo: completo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Perfil = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
