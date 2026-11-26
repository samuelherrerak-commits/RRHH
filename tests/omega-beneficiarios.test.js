const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../core/omega.js');

// Archivos generados por la macro «Formato de registro de beneficiarios V10.1» (datos de beneficiarios reemplazados por ficticios con la misma forma).
test('nuevos beneficiarios: el TXT es igual al de la macro de Omega (control, campos, CRLF y sin salto final)', () => {
  const r = O.archivoBeneficiarios({ empresa: 'PROSEIN CA', rif: 'J-00141771-0', correo: 'gestionhumana@prosein.com', servicio: 'TRANSFERENCIA', fecha: { y: 2026, m: 11, d: 11 },
    filas: [
      { tipo: 'V', cedula: '12.345.678', nombre1: 'Ana', apellido1: 'Prueba', nacimiento: '2002-11-28', correo: 'ana.prueba@correo.com', cuenta: '0102-0864-51-0000646875' },
      { cedula: 23456789, nombre1: 'BETO', apellido1: 'GOMEZ', nacimiento: '1992-12-19', correo: 'BETO25@CORREO.COM', cuenta: '01020256670000248008' },
    ] });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.nombre, 'EMPPROSEINCA261111.txt');
  assert.equal(r.contenido,
    '255261111J0014177100000200720261111000000000000000000\tGESTIONHUMANA@PROSEIN.COM\r\n'
    + '1\tV\t12345678\tAna\tPrueba\t\t\t\t28112002\tana.prueba@correo.com\t\t\t\t\t\t01020864510000646875\t\r\n'
    + '2\tV\t23456789\tBETO\tGOMEZ\t\t\t\t19121992\tBETO25@CORREO.COM\t\t\t\t\t\t01020256670000248008\t');
});

test('nuevos beneficiarios: misma estructura que los 3 archivos reales de Gestión Humana', () => {
  const fs = require('fs');
  const dir = process.env.OMEGA_TXT_REALES;                               // carpeta con los TXT reales (no van al repositorio)
  for (const f of dir ? fs.readdirSync(dir).filter((x) => /\.txt$/i.test(x)) : []) {
    const ruta = require('path').join(dir, f);
    if (!fs.existsSync(ruta)) continue;                                   // los archivos reales no van al repositorio
    const real = fs.readFileSync(ruta, 'latin1'), lineas = real.split('\r\n'), ctl = lineas[0];
    const filas = lineas.slice(1).map((l) => { const c = l.split('\t'); return { tipo: c[1], cedula: c[2], nombre1: c[3], apellido1: c[4], nombre2: c[5], apellido2: c[6], sexo: c[7],
      nacimiento: c[8].slice(4) + '-' + c[8].slice(2, 4) + '-' + c[8].slice(0, 2), correo: c[9], cuenta: c[15] }; });
    const r = O.archivoBeneficiarios({ empresa: 'X', rif: ctl.slice(9, 19), correo: ctl.split('\t')[1], fecha: { y: 2000 + Number(ctl.slice(3, 5)), m: Number(ctl.slice(5, 7)), d: Number(ctl.slice(7, 9)) }, filas });
    assert.equal(r.contenido, real, f);
  }
});

test('nuevos beneficiarios: valida como la macro', () => {
  const base = { empresa: 'AUSTRAL', rif: 'J003266191', correo: 'gh@prosein.com', fecha: { y: 2026, m: 10, d: 14 } };
  assert.match(O.archivoBeneficiarios({ ...base, rif: 'J12' }).error, /9 dígitos/);
  assert.match(O.archivoBeneficiarios({ ...base, correo: '' , filas: [{}] }).error, /correo electrónico de la empresa/);
  const r = O.archivoBeneficiarios({ ...base, filas: [{ cedula: '25625463', nombre1: 'ANDREA', apellido1: '', nacimiento: '', correo: 'a@b.com', cuenta: '0102' }] });
  assert.deepEqual(r.errores.map((e) => e.texto), ['primer apellido', 'fecha de nacimiento', 'cuenta de 20 dígitos']);
  const t = O.archivoBeneficiarios({ ...base, servicio: 'TARJETA', correo: '', filas: [{ cedula: '25625463', nombre1: 'ANDREA', apellido1: 'BUENAVER', nacimiento: '1997-04-04', correo: 'a@b.com', celular: '0414-123.4567', sexo: 'femenino' }] });
  assert.equal(t.contenido.split('\r\n')[1], '1\tV\t25625463\tANDREA\tBUENAVER\t\t\tF\t04041997\ta@b.com\t4141234567\t\t\t\t\t\t');
  assert.equal(O.EMPRESAS.AIV.rif, 'J003266191');
});
