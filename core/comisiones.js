/* ==========================================================
   Comisiones: leer el Excel de comisiones que envía la gerencia (nombres escritos a mano, sin cédula),
   cruzar cada nombre con los empleados del CAC, y verificar contra el «Resumen de Pago» de la nómina
   que las comisiones quedaron registradas en «Otras Asignaciones».
   Funciones puras: las usan el navegador, Apps Script y las pruebas.
   ========================================================== */
(function (raiz) {
  'use strict';

  var VACIAS = { DE: 1, DEL: 1, LA: 1, LAS: 1, LOS: 1, Y: 1, POS: 1, VENTAS: 1, PROPIAS: 1 };

  function sinTildes(s) { return String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  /** Palabras significativas de un nombre: sin tildes, sin lo que va entre paréntesis ni sufijos como «-POS». */
  function palabras(nombre) {
    return sinTildes(nombre).replace(/\([^)]*\)/g, ' ').replace(/-\s*POS\b/g, ' ').replace(/[^A-ZÑ ]/g, ' ').split(/\s+/).filter(function (p) { return p && !VACIAS[p]; });
  }
  function clave(nombre) { return palabras(nombre).join(' '); }

  /** Distancia de edición con trasposición (Varela/Valera = 1). */
  function distancia(a, b) {
    var m = a.length, n = b.length, d = [];
    for (var i = 0; i <= m; i++) { d[i] = [i]; }
    for (var j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      var c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  /** ¿La palabra del reporte coincide con la del empleado? igual, abreviada (≥4 letras) o con un error de tipeo (≥5 letras). */
  function parecida(p, q) {
    if (p === q) return 2;
    if (p.length >= 4 && q.indexOf(p) === 0) return 1.5;
    if (p.length >= 5 && q.length >= 5 && distancia(p, q) <= 1) return 1;
    if (p.length >= 6 && q.length >= 6 && distancia(p, q) <= 2) return 0.5;
    return 0;
  }
  /** Puntaje de un nombre del reporte contra un empleado: todas sus palabras deben aparecer (en cualquier orden). */
  function puntaje(rep, emp) {
    if (!rep.length) return 0;
    var usadas = {}, total = 0;
    for (var i = 0; i < rep.length; i++) {
      var mejor = 0, cual = -1;
      for (var j = 0; j < emp.length; j++) { if (usadas[j]) continue; var s = parecida(rep[i], emp[j]); if (s > mejor) { mejor = s; cual = j; } }
      if (!mejor) return 0;
      usadas[cual] = true; total += mejor;
    }
    return total + (rep.length >= 2 ? 1 : 0);
  }
  function mismaSucursal(sucursal, emp) {
    var s = palabras(String(sucursal || '').replace(/sucursal/i, '')), o = palabras(emp.organizacion);
    return s.length > 0 && s.every(function (p) { return o.some(function (q) { return parecida(p, q) >= 1; }); });
  }

  /**
   * Cruza un nombre del reporte con los empleados. empleados: [{ clave, nombre, organizacion, estado }]; alias: { 'CLAVE DEL NOMBRE': claveEmpleado }.
   * Devuelve { clave, estado: 'alias'|'exacto'|'sugerido'|'ambiguo'|'sin', candidatos: [{ clave, nombre, organizacion }] }.
   */
  function cruzarNombre(nombre, sucursal, empleados, alias) {
    var k = clave(nombre), rep = palabras(nombre);
    var activos = empleados.filter(function (e) { return e.estado !== 'Inactivo'; });
    if (alias && alias[k] && empleados.some(function (e) { return e.clave === alias[k]; })) return { clave: alias[k], estado: 'alias', candidatos: [] };
    var exactos = activos.filter(function (e) { return clave(e.nombre) === k; });
    if (exactos.length === 1) return { clave: exactos[0].clave, estado: 'exacto', candidatos: [] };
    var c = activos.map(function (e) { return { e: e, s: puntaje(rep, palabras(e.nombre)) + (mismaSucursal(sucursal, e) ? 0.5 : 0) }; })
      .filter(function (x) { return x.s >= 2; }).sort(function (a, b) { return b.s - a.s; });
    var cand = c.slice(0, 5).map(function (x) { return { clave: x.e.clave, nombre: x.e.nombre, organizacion: x.e.organizacion || '' }; });
    if (!c.length) return { clave: '', estado: 'sin', candidatos: [] };
    if (c.length === 1 || c[0].s > c[1].s) return { clave: c[0].e.clave, estado: 'sugerido', candidatos: cand };
    return { clave: '', estado: 'ambiguo', candidatos: cand };
  }

  function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  function texto(v) { return v == null ? '' : String(v).trim(); }

  /**
   * Lee las hojas del Excel de comisiones. hojas: [{ nombre, matriz }] (matriz = filas de celdas).
   * En cada hoja busca la fila de encabezados con una columna «Total/Monto a pagar…»; la columna de nombres es la de «Sucursal».
   * Las filas «SUCURSAL …» marcan la sucursal; las de «TOTAL» se ignoran. Un texto a la derecha del nombre es una nota
   * (p. ej. «Pagar por Pago Especial»). Devuelve [{ hoja, fila, sucursal, nombre, monto, nota }].
   */
  function leerExcelComisiones(hojas) {
    var out = [];
    (hojas || []).forEach(function (h) {
      var m = h.matriz || [], cab = -1, colNom = -1, colMonto = -1;
      for (var f = 0; f < Math.min(15, m.length) && cab < 0; f++) {
        var fila = (m[f] || []).map(function (v) { return sinTildes(v).trim(); });
        var mon = -1, nom = -1;
        fila.forEach(function (v, j) {
          if (/PAGAR/.test(v) && /^(TOTAL|MONTO)/.test(v)) mon = j;
          if (nom < 0 && /^SUCURSAL$|^NOMBRE|^COLABORADOR|^TRABAJADOR/.test(v)) nom = j;
        });
        if (mon >= 0 && nom >= 0) { cab = f; colMonto = mon; colNom = nom; }
      }
      if (cab < 0) return;
      var sucursal = '';
      for (var i = cab + 1; i < m.length; i++) {
        var row = m[i] || [], nombre = texto(row[colNom]);
        if (!nombre) continue;
        var N = sinTildes(nombre);
        if (/^SUCURSAL\b/.test(N)) { sucursal = nombre; continue; }
        if (/^TOTAL\b/.test(N)) continue;
        if (!palabras(nombre).length) continue;
        var v = row[colMonto], monto = typeof v === 'number' ? r2(v) : (isFinite(Number(texto(v).replace(',', '.'))) && texto(v) ? r2(Number(texto(v).replace(',', '.'))) : 0);
        var notas = [];
        if (typeof v === 'string' && texto(v) && !isFinite(Number(texto(v).replace(',', '.')))) notas.push(texto(v));
        for (var j = colMonto + 1; j < row.length; j++) if (typeof row[j] === 'string' && texto(row[j])) notas.push(texto(row[j]));
        out.push({ hoja: h.nombre, fila: i + 1, sucursal: sucursal, nombre: nombre, monto: monto, nota: notas.join(' · ') });
      }
    });
    return out;
  }

  /** Suma por persona las filas cruzadas e incluidas. filas: [{ clave, monto, incluir }] → [{ clave, monto, filas }]. */
  function consolidar(filas) {
    var por = {}, orden = [];
    filas.forEach(function (f) {
      if (!f.incluir || !f.clave) return;
      if (!por[f.clave]) { por[f.clave] = { clave: f.clave, monto: 0, filas: 0 }; orden.push(f.clave); }
      por[f.clave].monto = r2(por[f.clave].monto + f.monto); por[f.clave].filas++;
    });
    return orden.map(function (k) { return por[k]; });
  }

  /**
   * Lee el «Resumen de Pago» (Detalle de Nómina) a partir de sus líneas de texto, en orden.
   * Cada persona termina en «Total NOMBRE asignaciones deducciones total»; antes vienen sus conceptos.
   * Devuelve [{ nombre, otrasAsignaciones, asignaciones }].
   */
  function leerResumenPago(lineas) {
    var montoRe = /(-?\d{1,3}(?:\.\d{3})*,\d{2})/g, num = function (s) { return Number(s.replace(/\./g, '').replace(',', '.')); };
    var out = [], otras = 0;
    (lineas || []).forEach(function (l) {
      var t = String(l).replace(/\s+/g, ' ').trim(), montos = t.match(montoRe) || [];
      var tot = /\bTotal (.+?) -?\d{1,3}(?:\.\d{3})*,\d{2}/.exec(t);
      if (tot && !/^(Total )?(N[oó]mina|Contrato|General)\b/i.test(tot[1]) && !/Total General/i.test(t)) {
        out.push({ nombre: tot[1].trim(), otrasAsignaciones: r2(otras), asignaciones: montos.length ? r2(num(montos[0])) : 0 });
        otras = 0; return;
      }
      if (/Otras Asignaciones/i.test(t) && montos.length) otras += num(montos[0]);
    });
    return out;
  }

  /**
   * Compara lo solicitado con el reporte. items: [{ clave, nombre, monto }]; personas: leerResumenPago(...).
   * Estado: 'ok' (otras asignaciones = monto), 'mayor' (otras asignaciones > monto: puede incluir otros pagos),
   * 'menor' (falta), 'no' (no aparece o sin otras asignaciones).
   */
  function verificar(items, personas) {
    var usados = {};
    return items.map(function (it) {
      var rep = palabras(it.nombre), mejor = null, ms = 0;
      personas.forEach(function (p, i) {
        if (usados[i]) return;
        var k1 = clave(p.nombre) === clave(it.nombre) ? 100 : 0;
        var s = k1 || Math.max(puntaje(palabras(p.nombre), rep), puntaje(rep, palabras(p.nombre)));
        if (s > ms) { ms = s; mejor = i; }
      });
      if (mejor == null || ms < 3) return { clave: it.clave, nombre: it.nombre, monto: it.monto, enReporte: '', otras: 0, estado: 'no', diferencia: -it.monto };
      usados[mejor] = true;
      var p = personas[mejor], dif = r2(p.otrasAsignaciones - it.monto);
      var estado = !(p.otrasAsignaciones > 0) ? 'no' : Math.abs(dif) < 0.01 ? 'ok' : dif > 0 ? 'mayor' : 'menor';
      return { clave: it.clave, nombre: it.nombre, monto: it.monto, enReporte: p.nombre, otras: p.otrasAsignaciones, estado: estado, diferencia: dif };
    });
  }

  var api = { palabras: palabras, clave: clave, distancia: distancia, cruzarNombre: cruzarNombre, leerExcelComisiones: leerExcelComisiones,
    notaExcluye: function (n) { return /pago especial|liquidaci|no pagar|no se paga/i.test(String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')); },
    consolidar: consolidar, leerResumenPago: leerResumenPago, verificar: verificar, r2: r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Comisiones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
