// Ejecuta el archivo REAL que se pega en Apps Script (apps-script/RRHH.gs) sobre una simulación de Google Sheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { construir } = require('../scripts/build-gas.js');

const { crearEntorno } = require('../dev/gas-simulado.js');

test('el archivo generado está al día con core/ y src/api.gs', () => {
  assert.equal(fs.readFileSync('apps-script/RRHH.gs', 'utf8'), construir(), 'Ejecuta: npm run build:gas');
});

test('configurarInicial crea las hojas y a Samuel y Luis Paul como usuarios de RRHH (sin clave)', () => {
  const e = crearEntorno();
  e.ejecutar('configurarInicial');
  for (const n of ['PARAMETROS', 'EMPRESAS', 'EMPLEADOS', 'APORTES', 'CIERRES', 'ANTICIPOS', 'CONSTANCIAS', 'USUARIOS', 'LOG']) assert.ok(e.hojas[n], 'falta la hoja ' + n);
  const us = e.hojas.USUARIOS.filas.slice(1);
  assert.deepEqual(us.map((f) => [f[0], f[3], f[4]]), [['30580323', 'ADMIN', 'Samuel Herrera'], ['7952013', 'ADMIN', 'Luis Paul Rojas'], ['6291577', 'ADMIN', 'JOHANNA RODRIGUEZ']]);
  assert.ok(us.every((f) => f[2] === ''), 'no deben tener clave todavía');
  e.ejecutar('configurarInicial');                        // repetir no duplica
  assert.equal(e.hojas.USUARIOS.filas.length, 4);
  assert.equal(e.props.API_TOKEN, 'RRHH2026');
  assert.ok(e.props.SECRETO);
});

test('sin clave no se puede entrar; con la clave puesta desde el menú sí, y el trabajador entra solo con cédula', () => {
  // respuestas del menú: cédula, confirmar (YES), clave
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial');
  assert.deepEqual(e.llamar({ action: 'login', cedula: '30580323' }).data, { requiereClave: true });
  assert.equal(e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'lo-que-sea' }).code, 'SIN_CLAVE');

  e.ejecutar('ponerClaveRRHH');
  const hash = e.hojas.USUARIOS.filas[1][2];
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(e.hojas).includes('clave-de-samuel'), 'la clave no debe quedar escrita');
  assert.equal(e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'mala' }).code, 'CREDENCIALES');
  const r = e.llamar({ action: 'loginAdmin', cedula: 'V-305803231', clave: 'clave-de-samuel' });   // incluso escribiendo el RIF
  assert.equal(r.ok, true);
  assert.equal(r.data.rol, 'ADMIN');
});

test('flujo completo sobre las hojas: cargar empleados, jefe, anticipo, constancia y verificación', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;

  const cargado = e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', departamento: 'Recursos Humanos', puesto: 'Asistente', estado: 'Active', fechaInicio: '12/11/2024', salarioMensual: 5500 },
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', departamento: 'Ventas', puesto: 'Vendedora', estado: 'Active', fechaInicio: '05/03/2025', salarioMensual: 12583.17 },
  ] });
  assert.equal(cargado.ok, true, JSON.stringify(cargado));
  assert.equal(cargado.data.resumen.agregados, 2);

  const lista = e.llamar({ action: 'listarEmpleados', token: admin, buscar: 'ana' }).data.empleados;
  assert.equal(lista[0].empresa, 'AIV');
  const j = e.llamar({ action: 'asignarJefe', token: admin, claves: [lista[0].clave], jefe: 'V30580323' });
  assert.equal(j.data.cambiados, 1);
  assert.equal(e.llamar({ action: 'listarEmpleados', token: admin, buscar: 'ana' }).data.empleados[0].jefeNombre, 'SAMUEL HERRERA');

  // aporte acreditado → anticipo
  const ana = e.llamar({ action: 'login', cedula: '11111111' }).data.token;
  e.hojas.APORTES.appendRow(['V11111111', 2026, 1, 'AIV', 4000, 0, 3, 0, false, false]);
  e.hojas.CIERRES.appendRow([2026, 1, 'AIV', 'ACREDITADO', 'x', 0]);
  assert.equal(e.llamar({ action: 'estadoDeCuenta', token: ana }).data.resumen.disponible, 3000);
  const hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), en = (n) => new Date(Date.parse(hoy) + n * 864e5).toISOString().slice(0, 10);
  const ap = e.llamar({ action: 'guardarApertura', token: admin, clave: '2026-T3', inicio: en(-1), fin: en(5) });
  assert.equal(ap.data.estado, 'ABIERTA', JSON.stringify(ap));
  const sol = e.llamar({ action: 'solicitarAnticipo', token: ana, monto: 1000, motivo: 'Salud', acepta: true });
  assert.equal(sol.ok, true, JSON.stringify(sol));
  assert.equal(e.llamar({ action: 'decidirAnticipo', token: admin, id: sol.data.id, aprobar: true }).ok, true);
  const arch = e.llamar({ action: 'archivoAnticipos', token: admin, empresa: 'AIV' });
  assert.match(arch.data.csv, /;V;11111111;5;A;1000\.00;ANA PRUEBA/);

  // constancia + QR público
  const c = e.llamar({ action: 'emitirConstancia', token: ana });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.data.empresa, 'AIV');
  const v = e.llamar({ action: 'verificarConstancia', id: c.data.id });
  assert.equal(v.data.estado, 'VIGENTE');
  assert.equal(e.llamar({ action: 'listarConstancias', token: admin }).data.length, 1);
  assert.equal(e.llamar({ action: 'anularConstancia', token: admin, id: c.data.id }).data.estado, 'ANULADA');
  assert.equal(e.llamar({ action: 'verificarConstancia', id: c.data.id }).data.estado, 'ANULADA');
});

test('el token de la API es obligatorio', () => {
  const e = crearEntorno(); e.ejecutar('configurarInicial');
  const r = JSON.parse(vm.runInContext('doPost', e.ctx)({ postData: { contents: JSON.stringify({ action: 'login', cedula: '1234567' }) } }).contenido);
  assert.equal(r.code, 'TOKEN');
});

test('si falta código en Apps Script, el menú lo explica en vez de dar un error técnico', () => {
  const e = crearEntorno();
  vm.runInContext('Empleados = undefined;', e.ctx);
  assert.throws(() => e.ejecutar('ponerClaveRRHH'), /Faltan módulos: Empleados/);
  assert.match(e.ui.alertas.at(-1)[1], /RRHH\.gs/);
});

test('abrir la URL muestra la versión y que todos los módulos cargaron', () => {
  const e = crearEntorno();
  const r = JSON.parse(vm.runInContext('doGet', e.ctx)().contenido);
  assert.equal(r.modulosCompletos, true);
  assert.match(r.version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.ok(Object.values(r.modulos).every(Boolean));
});

test('si falta el código, el sitio recibe un mensaje claro y el error queda en LOG', () => {
  const e = crearEntorno(); e.ejecutar('configurarInicial');
  vm.runInContext('Servicio = undefined;', e.ctx);
  const doGetFalta = JSON.parse(vm.runInContext('doGet', e.ctx)().contenido);
  assert.equal(doGetFalta.modulosCompletos, false);
  assert.equal(doGetFalta.modulos.Servicio, false);
  const r = e.llamar({ action: 'listarConstancias' });
  assert.equal(r.code, 'SERVER');
  assert.match(r.message, /Falta código en Apps Script.*RRHH\.gs/);
  assert.ok(e.hojas.LOG.filas.some((f) => f && f[1] === 'ERROR'));
});

test('si se pega solo src/api.gs (sin módulos), la URL y el sitio lo dicen con claridad', () => {
  const e = crearEntorno({ codigo: fs.readFileSync('src/api.gs', 'utf8') });
  const g = JSON.parse(vm.runInContext('doGet', e.ctx)().contenido);
  assert.equal(g.modulosCompletos, false);
  assert.match(g.aviso, /apps-script\/RRHH\.gs/);
  assert.deepEqual(g.erroresCarga, ['Este no es el archivo RRHH.gs: falta el código de los módulos']);
  e.ejecutar('configurarInicial');
  assert.match(e.llamar({ action: 'login', cedula: '30580323' }).message, /no uses src\/api\.gs/);
});

test('el archivo para pegar es el único .gs de la carpeta apps-script', () => {
  assert.deepEqual(fs.readdirSync('apps-script').filter((f) => f.endsWith('.gs')), ['RRHH.gs']);
});

test('vacaciones sobre las hojas: feriados iniciales, cierre, solicitud, jefe y RRHH', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel', '7952013', 'YES', 'clave-de-luis'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH'); e.ejecutar('ponerClaveRRHH');
  const fer = e.hojas.FERIADOS.filas.slice(1).map((f) => f[0]);
  assert.ok(fer.includes('2026-10-12') && fer.includes('2026-07-24') && !fer.includes('2026-12-10'));
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', departamento: 'RRHH', fechaInicio: '10/03/2022' },
    { cedula: 'V079520130', nombre: 'LUIS PAUL ROJAS', organizacion: 'PROSEIN CENTRAL', departamento: 'RRHH', fechaInicio: '15/09/2022' },
  ] });
  e.llamar({ action: 'asignarJefe', token: admin, claves: ['V30580323'], jefe: 'V7952013' });
  const imp = e.llamar({ action: 'importarCierreVacaciones', token: admin, personas: [
    { cedula: 'V30580323', periodos: [{ periodo: '2024-2025', correspondientes: 17, disfrutadosPrevios: 10 }, { periodo: '2025-2026', correspondientes: 18, disfrutadosPrevios: 0 }] }] });
  assert.deepEqual(imp.data, { personas: 1, periodos: 2, noActivos: 0, activosSinCierre: 3 });   // Luis Paul + María Teresa y Danilo (fuera de nómina)

  // Samuel (como trabajador) pide: la fecha debe estar entre 15 y 20 días desde hoy
  const tSamuel = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.tokenTrabajador;
  const d = e.llamar({ action: 'datosVacaciones', token: tSamuel }).data;
  assert.equal(d.saldo.total, 25);
  assert.equal(d.jefe.nombre, 'LUIS PAUL ROJAS');
  const V = require('../core/vacaciones.js');
  let inicio = V.sumarDiasTxt(d.hoy, 15);
  while (!V.esHabil(inicio, d.feriados)) inicio = V.sumarDiasTxt(inicio, 1);
  const sol = e.llamar({ action: 'solicitarVacaciones', token: tSamuel, inicio, dias: 10 });
  assert.equal(sol.ok, true, JSON.stringify(sol));
  assert.equal(sol.data.condicion, 'Disfrute de días con pago');

  // Luis Paul es RRHH: su cédula pide clave; como jefe usa su sesión de empleado («Mi cuenta» en el panel)
  assert.equal(e.llamar({ action: 'login', cedula: '7952013' }).data.requiereClave, true);
  const tLuis = e.llamar({ action: 'loginAdmin', cedula: '7952013', clave: 'clave-de-luis' }).data.tokenTrabajador;
  const eq = e.llamar({ action: 'equipoVacaciones', token: tLuis }).data;
  assert.equal(eq.pendientes.length, 1);
  assert.equal(e.llamar({ action: 'decidirVacacionesJefe', token: tLuis, id: sol.data.id, aprobar: true }).data.estado, 'APROBADA_JEFE');
  assert.equal(e.llamar({ action: 'bandejaVacaciones', token: admin }).data.solicitudes.length, 1);
  assert.equal(e.llamar({ action: 'registrarVacaciones', token: admin, id: sol.data.id, nomina: 'NV-80' }).data.estado, 'REGISTRADA');
  const final = e.llamar({ action: 'datosVacaciones', token: tSamuel }).data;
  assert.equal(final.saldo.total, 15);
  assert.equal(final.solicitudes[0].inicio, inicio);
  assert.deepEqual(final.solicitudes[0].imputacion.map((i) => [i.periodo, i.dias]), [['2024-2025', 7], ['2025-2026', 3]]);
});

test('menú: usuaria de RRHH que no es empleada (CEO) con su nombre, y es jefa en el detalle', () => {
  // Johanna ya existe (la crea «Configurar»); solo se le pone la clave. Y una persona nueva que no es empleada pide su nombre.
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel', '6291577', 'YES', 'clave-de-la-ceo', '13131313', 'YES', 'NO', 'Ana  Externa', 'clave-externa'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH'); e.ejecutar('ponerClaveRRHH'); e.ejecutar('ponerClaveRRHH');
  const externa = e.hojas.USUARIOS.filas.find((f) => f && f[0] === '13131313');
  assert.deepEqual([externa[3], externa[4]], ['RRHH', 'ANA EXTERNA']);
  const fila = e.hojas.USUARIOS.filas.find((f) => f && f[0] === '6291577');
  assert.deepEqual([fila[3], fila[4]], ['ADMIN', 'JOHANNA RODRIGUEZ']);
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  const r = e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V222222229', nombre: 'GERENTE GENERAL', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2015', jefeNombre: 'JOHANNA RODRIGUEZ' }] });
  assert.equal(r.data.jefes.asignados, 1);
  const ceo = e.llamar({ action: 'loginAdmin', cedula: '6291577', clave: 'clave-de-la-ceo' }).data;
  assert.equal(ceo.esJefe, true);
  assert.equal(ceo.nombre, 'JOHANNA RODRIGUEZ');
  // fuera de nómina, sobre las hojas
  const f = e.llamar({ action: 'guardarEmpleadoFueraNomina', token: admin, cedula: 'V9876543', nombre: 'Danilo Koenig', empresa: 'PCA', fechaIngreso: '09/09/2008' });
  assert.equal(f.ok, true, JSON.stringify(f));
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [{ cedula: 'V222222229', nombre: 'GERENTE GENERAL', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/01/2015' }] });
  assert.equal(e.llamar({ action: 'login', cedula: '9876543' }).ok, true);
});

test('configurar crea a Johanna (usuaria) y a María Teresa y Danilo (fuera de nómina); repetir no duplica', () => {
  const e = crearEntorno();
  e.ejecutar('configurarInicial'); e.ejecutar('configurarInicial');
  assert.ok(e.hojas.USUARIOS.filas.some((f) => f && f[0] === '6291577' && f[4] === 'JOHANNA RODRIGUEZ' && f[3] === 'ADMIN'));
  const emp = e.hojas.EMPLEADOS.filas.slice(1).filter((f) => f && f[2]);
  assert.deepEqual(emp.map((f) => [f[0] + f[1], f[2], f[9], f[16]]), [['V8542390', 'MARIA TERESA CENCI', 'AIV', true], ['E81053506', 'DANILO KOENIG', 'PCA', true]]);
  assert.equal(e.llamar({ action: 'login', cedula: '8542390' }).ok, true);
  assert.equal(e.llamar({ action: 'login', cedula: 'E-81053506' }).ok, true);
});

test('rendimiento: cada hoja se lee una vez por petición y las que cambian poco salen de la caché', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '10/03/2022' },
    { cedula: 'V111111119', nombre: 'ANA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '10/03/2022', jefeNombre: 'SAMUEL HERRERA' }] });
  let lecturas = {};
  for (const [n, h] of Object.entries(e.hojas)) { const o = h.getDataRange.bind(h); h.getDataRange = function () { lecturas[n] = (lecturas[n] || 0) + 1; return o(); }; }
  const t = e.llamar({ action: 'login', cedula: '11111111' }).data.token;
  lecturas = {};
  e.llamar({ action: 'datosVacaciones', token: t });            // primera vez: llena la caché
  assert.ok(Object.values(lecturas).every((n) => n === 1), 'ninguna hoja se lee dos veces: ' + JSON.stringify(lecturas));
  lecturas = {};
  const d = e.llamar({ action: 'datosVacaciones', token: t });  // segunda vez: solo lo que cambia seguido
  assert.deepEqual(lecturas, { VAC_SOLICITUDES: 1 });
  assert.equal(d.data.jefe.nombre, 'SAMUEL HERRERA');

  // una escritura del sistema borra la caché de esa hoja
  e.llamar({ action: 'asignarJefe', token: admin, claves: ['V11111111'], jefe: '' });
  assert.equal(e.llamar({ action: 'datosVacaciones', token: t }).data.jefe, null);
  // una edición a mano (onEdit) también
  e.hojas.EMPLEADOS.filas.find((f) => f && f[2] === 'ANA')[13] = 'V30580323';
  assert.equal(e.llamar({ action: 'datosVacaciones', token: t }).data.jefe, null);              // todavía de la caché
  vm.runInContext('onEdit', e.ctx)({ range: { getSheet: () => ({ getName: () => 'EMPLEADOS' }) } });
  assert.equal(e.llamar({ action: 'datosVacaciones', token: t }).data.jefe.nombre, 'SAMUEL HERRERA');
});

test('fideicomiso sobre las hojas: cerrar aporte sin duplicar, archivo y cancelación de un retirado', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const t = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: t, filas: [
    { cedula: 'V111111119', nombre: 'ESTHER LILIA RODRIGUEZ HERNANDEZ', organizacion: 'PROSEIN CENTRAL', fechaInicio: '05/03/2025' },
    { cedula: 'V333333339', nombre: 'ALIRIO ALFONSO AVILA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '25/07/2011' }] });
  const per = { anio: 2026, trimestre: 3, empresa: 'PCA' }, filas = [{ nombre: 'Esther Lilia Rodriguez Hernandez', monto: 12583.168 }, { nombre: 'Alirio Alfonso Avila', monto: 192290.08 }];
  assert.equal(e.llamar({ action: 'prepararAporte', token: t, ...per, filas }).data.totales.total, 132780.34);
  assert.equal(e.llamar({ action: 'cerrarAporte', token: t, ...per, filas }).data.estado, 'CERRADO');
  assert.equal(e.llamar({ action: 'cerrarAporte', token: t, ...per, filas, reemplazar: true }).ok, true);
  assert.equal(e.hojas.APORTES.filas.filter((f) => f && f[0]).length - 1, 2);                         // reemplazó, no duplicó
  assert.match(e.llamar({ action: 'archivoAporte', token: t, ...per, tipo: 'NOMINA' }).data.csv, /;V;33333333;1;A;129896\.70;ALIRIO ALFONSO AVILA/);
  // Esther se retira
  e.llamar({ action: 'cargarEmpleados', token: t, filas: [{ cedula: 'V333333339', nombre: 'ALIRIO ALFONSO AVILA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '25/07/2011' }] });
  assert.deepEqual(e.llamar({ action: 'candidatosCancelacion', token: t }).data.map((c) => c.clave), ['V11111111']);
  const c = e.llamar({ action: 'registrarCancelacion', token: t, clave: 'V11111111', fechaEgreso: '2026-10-15', monto: '' });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.match(e.llamar({ action: 'archivoCancelaciones', token: t, empresa: 'PCA' }).data.csv, /V;11111111;ESTHER LILIA RODRIGUEZ HERNANDEZ;05\/03\/2025;15\/10\/2026;/);
  assert.equal(e.llamar({ action: 'listarCancelaciones', token: t }).data[0].estado, 'EN_ARCHIVO');
});

test('una lectura que se cruza con una escritura no deja una copia vieja en la caché', () => {
  const e = crearEntorno();
  e.ejecutar('configurarInicial');
  const correr = (codigo) => vm.runInContext(codigo, e.ctx);
  // Lector: toma la versión y lee la hoja (aún sin el cambio).
  correr("memo_ = {}; var preLector = prefijoCache_('PARAMETROS'); var viejos = hoja_('PARAMETROS').getDataRange().getValues();");
  // Escritor: guarda y marca la hoja como cambiada.
  correr("memo_ = {}; invalidar_('PARAMETROS');");
  // El lector termina y guarda su copia vieja.
  correr('guardarCache_(preLector, viejos);');
  // La siguiente petición no debe usarla.
  assert.equal(correr("memo_ = {}; leerCache_('PARAMETROS')"), null);
});

test('poner clave de RRHH escribiendo el número de la lista en vez de la cédula', () => {
  const e = crearEntorno({ respuestasUi: ['1', 'YES', 'clave-por-lista'] });
  e.ejecutar('configurarInicial');
  e.ejecutar('ponerClaveRRHH');
  assert.equal(e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-por-lista' }).ok, true);   // la 1 de la lista es Samuel
});
