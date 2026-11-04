// Ejecuta el archivo REAL que se pega en Apps Script (apps-script/RRHH.gs) sobre una simulación de Google Sheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { construir } = require('../scripts/build-gas.js');

const { crearEntorno } = require('../dev/gas-simulado.js');

/** Entra como colaborador: la primera vez crea su PIN (4 números) y luego entra con él. */
function entrarTrabajador(e, cedula, pin = '2580') {
  const r = e.llamar({ action: 'login', cedula });
  if (!r.ok || r.data.token) return r.data || r;
  if (r.data.crearPin) return e.llamar({ action: 'crearPin', cedula, pin, confirmacion: pin }).data;
  return e.llamar({ action: 'login', cedula, pin }).data;
}

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
  const ana = entrarTrabajador(e, '11111111').token;
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
  assert.ok(entrarTrabajador(e, '9876543').token);
});

test('configurar crea a Johanna (usuaria) y a María Teresa y Danilo (fuera de nómina); repetir no duplica', () => {
  const e = crearEntorno();
  e.ejecutar('configurarInicial'); e.ejecutar('configurarInicial');
  assert.ok(e.hojas.USUARIOS.filas.some((f) => f && f[0] === '6291577' && f[4] === 'JOHANNA RODRIGUEZ' && f[3] === 'ADMIN'));
  const emp = e.hojas.EMPLEADOS.filas.slice(1).filter((f) => f && f[2]);
  assert.deepEqual(emp.map((f) => [f[0] + f[1], f[2], f[9], f[16]]), [['V8542390', 'MARIA TERESA CENCI', 'AIV', true], ['E81053506', 'DANILO KOENIG', 'PCA', true]]);
  assert.ok(entrarTrabajador(e, '8542390').token);
  assert.ok(entrarTrabajador(e, 'E-81053506').token);
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
  const t = entrarTrabajador(e, '11111111').token;
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

test('recibos de pago y avisos sobre las hojas: Drive, campanita y OneSignal', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  assert.equal(e.tareas.length, 1);                                   // tarea diaria de avisos instalada
  e.props.ONESIGNAL_APP_ID = '00000000-0000-4000-8000-000000000001'; e.props.ONESIGNAL_API_KEY = 'os_v2_app_clavedepruebaclavedeprueba'; e.props.CAC_URL = 'https://cac-pruebas.onrender.com';
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', puesto: 'Vendedora', estado: 'Active', fechaInicio: '05/03/2025', salarioMensual: 100 },
  ] });
  const asig = e.llamar({ action: 'asignarRecibos', token: admin, hojas: [{ pagina: 1, cedula: 'V111111119', nombre: 'ANA PRUEBA' }] }).data;
  assert.equal(asig.hojas[0].clave, 'V11111111');
  const lote = e.llamar({ action: 'crearLoteRecibos', token: admin, concepto: 'Nómina 1Q noviembre 2026', empresa: 'PCA', total: 1 }).data;
  const pdf = Buffer.from('%PDF-1.4 recibo de Ana').toString('base64');
  assert.equal(e.llamar({ action: 'subirRecibos', token: admin, lote: lote.id, items: [{ pagina: 1, clave: 'V11111111', pdf }] }).data.guardados, 1);
  const archivo = Object.values(e.drive.archivos)[0];
  const ana0 = entrarTrabajador(e, '11111111');
  const disp = { endpoint: 'https://fcm.googleapis.com/fcm/send/abcdefghijk', p256dh: 'BOr8sXlAXVQnzF4e3NQ1oUPg2Jr7ZQ9xL3z8M2tY5kM', auth: 'k8JV6sjdbhAi-n7Y' };
  assert.equal(e.llamar({ action: 'registrarDispositivo', token: ana0.token, ...disp }).ok, true);
  assert.equal(e.hojas.PUSH_DISPOSITIVOS.getLastRow(), 2);   // quedó guardado el número de suscripción
  assert.match(archivo.nombre, /^Nómina 1Q noviembre 2026 - V11111111/);
  assert.equal(e.llamar({ action: 'publicarLote', token: admin, id: lote.id }).data.estado, 'PUBLICADO');

  // OneSignal: directo al número de suscripción del dispositivo de la persona, con enlace a su sección
  const envio = e.pedidos.at(-1);
  assert.equal(envio.url, 'https://api.onesignal.com/notifications?c=push');
  assert.equal(envio.headers.Authorization, 'Key os_v2_app_clavedepruebaclavedeprueba');
  assert.deepEqual(envio.cuerpo.include_subscription_ids, ['sub-1']);
  assert.ok(!JSON.stringify(envio.cuerpo).includes('11111111'));
  assert.equal(envio.cuerpo.url, 'https://cac-pruebas.onrender.com/#/recibos');
  assert.equal(e.pedidos.find((x) => /\/users$/.test(x.url)).cuerpo.identity.external_id, ana0.pushId);   // el dispositivo, a nombre de Ana

  const ana = entrarTrabajador(e, '11111111');
  const n = e.llamar({ action: 'misNotificaciones', token: ana.token }).data;
  assert.equal(n.noLeidas, 1);
  assert.equal(e.llamar({ action: 'marcarNotificacionesLeidas', token: ana.token }).ok, true);
  assert.equal(e.llamar({ action: 'misNotificaciones', token: ana.token }).data.noLeidas, 0);

  const mio = e.llamar({ action: 'misRecibos', token: ana.token }).data;
  const visto = e.llamar({ action: 'verRecibo', token: ana.token, id: mio[0].id }).data;
  assert.equal(visto.pdf, pdf);
  assert.ok(e.llamar({ action: 'confirmarRecibo', token: ana.token, id: mio[0].id }).data.conforme > 0);
  const det = e.llamar({ action: 'detalleLote', token: admin, id: lote.id }).data;
  assert.equal(det.lote.conformes, 1);
  assert.equal(e.llamar({ action: 'eliminarLote', token: admin, id: lote.id }).code, 'VALIDACION');

  // una carga sin confirmaciones se elimina con sus archivos (a la papelera)
  const l2 = e.llamar({ action: 'crearLoteRecibos', token: admin, concepto: 'Prueba', empresa: 'PCA' }).data;
  e.llamar({ action: 'subirRecibos', token: admin, lote: l2.id, items: [{ pagina: 1, clave: 'V11111111', pdf }] });
  assert.equal(e.llamar({ action: 'eliminarLote', token: admin, id: l2.id }).ok, true);
  assert.equal(Object.values(e.drive.archivos).filter((a) => a.papelera).length, 1);
  assert.equal(e.llamar({ action: 'listarLotes', token: admin }).data.length, 1);
});

test('constancia: la fecha de ingreso sale bien aunque Sheets la haya convertido en fecha', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', puesto: 'Aprendiz', estado: 'Active', fechaInicio: '05/03/2025', salarioMensual: 130 },
  ] });
  const ana = entrarTrabajador(e, '11111111').token;
  assert.equal(e.llamar({ action: 'emitirConstancia', token: ana }).data.fechaIngreso, '05/03/2025');
  // Lo que hacía Google Sheets: la celda «05/03/2025» pasaba a ser una fecha (y en configuración inglesa, ¡3 de mayo!)
  const h = e.hojas.CONSTANCIAS, col = h.filas[0].indexOf('fechaIngreso');
  h.filas[1][col] = new Date(2025, 4, 3);
  assert.equal(e.llamar({ action: 'misConstancias', token: ana }).data[0].fechaIngreso, '05/03/2025');
});

test('aviso de prueba: dice si falta configurar OneSignal, si el dispositivo no está suscrito o si se envió', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  assert.equal(e.llamar({ action: 'avisoDePrueba', token: admin }).data.push.estado, 'SIN_CONFIGURAR');
  e.props.ONESIGNAL_APP_ID = '00000000-0000-4000-8000-000000000001'; e.props.ONESIGNAL_API_KEY = 'os_v2_app_clavedepruebaclavedeprueba';
  assert.equal(e.llamar({ action: 'avisoDePrueba', token: admin }).data.push.estado, 'SIN_DESTINATARIOS');   // aún sin dispositivo
  const disp = { endpoint: 'https://web.push.apple.com/QGx1Zm9vYmFyYmF6cXV4', p256dh: 'BOr8sXlAXVQnzF4e3NQ1oUPg2Jr7ZQ9xL3z8M2tY5kM', auth: 'k8JV6sjdbhAi-n7Y' };
  assert.equal(e.llamar({ action: 'registrarDispositivo', token: admin, ...disp }).ok, true);
  assert.equal(e.llamar({ action: 'avisoDePrueba', token: admin }).data.push.estado, 'ENVIADO');
  assert.deepEqual(e.pedidos.at(-1).cuerpo.include_subscription_ids, ['sub-1']);
  // OneSignal dice que ese dispositivo ya no es válido (quitaron el permiso): se olvida y se informa
  e.onesignalResponde(() => ({ codigo: 200, json: { id: 'x', errors: { invalid_player_ids: ['sub-1'] } } }));
  assert.equal(e.llamar({ action: 'avisoDePrueba', token: admin }).data.push.estado, 'SIN_DESTINATARIOS');
  assert.equal(e.hojas.PUSH_DISPOSITIVOS.getLastRow(), 1);
});

test('registrar el dispositivo en OneSignal desde el servidor (iPhone = SafariPush) y App ID mal escrito', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const ses = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data;
  const disp = { endpoint: 'https://web.push.apple.com/QGx1Zm9vYmFyYmF6cXV4', p256dh: 'BOr8sXlAXVQnzF4e3NQ1oUPg2Jr7ZQ9xL3z8M2tY5kM', auth: 'k8JV6sjdbhAi-n7Y' };
  assert.equal(e.llamar({ action: 'registrarDispositivo', token: ses.token, ...disp }).code, 'SIN_CONFIGURAR');
  e.props.ONESIGNAL_APP_ID = 'cac pruebas'; e.props.ONESIGNAL_API_KEY = 'os_v2_app_clavedepruebaclavedeprueba';
  assert.match(e.llamar({ action: 'registrarDispositivo', token: ses.token, ...disp }).message, /App ID de OneSignal .* no es válido/);
  assert.match(e.llamar({ action: 'avisoDePrueba', token: ses.token }).data.push.detalle, /no es válido/);
  e.props.ONESIGNAL_APP_ID = ' "97b880ba-f53c-4cb8-88f3-9c4cf9fc186f" ';   // con espacios y comillas: se limpia
  const r = e.llamar({ action: 'registrarDispositivo', token: ses.token, ...disp });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.tipo, 'SafariPush');
  const pedido = e.pedidos.at(-1);
  assert.equal(pedido.url, 'https://api.onesignal.com/apps/97b880ba-f53c-4cb8-88f3-9c4cf9fc186f/users');
  assert.equal(pedido.cuerpo.identity.external_id, ses.pushId);
  // llaves en base64 estándar con relleno (como las guarda OneSignal): base64url sin «=» deja la suscripción sin poder recibir
  assert.deepEqual(pedido.cuerpo.subscriptions[0], { type: 'SafariPush', token: disp.endpoint, enabled: true, notification_types: 1,
    web_auth: 'k8JV6sjdbhAi+n7Y', web_p256: 'BOr8sXlAXVQnzF4e3NQ1oUPg2Jr7ZQ9xL3z8M2tY5kM=', sdk: '160700' });
  // si la persona ya existe en OneSignal (409), se agrega la suscripción a esa persona
  e.onesignalResponde((url) => (/\/users$/.test(url) ? { codigo: 409, json: { errors: ['exists'] } } : { codigo: 201, json: { subscription: { id: 's1' } } }));
  assert.equal(e.llamar({ action: 'registrarDispositivo', token: ses.token, ...disp }).ok, true);
  assert.match(e.pedidos.at(-1).url, /\/users\/by\/external_id\/[0-9a-f]{32}\/subscriptions$/);
  assert.equal(e.llamar({ action: 'registrarDispositivo', token: ses.token, endpoint: 'http://x', p256dh: 'a', auth: 'b' }).code, 'VALIDACION');
});

test('la hoja PUSH_DISPOSITIVOS se crea sola si la hoja de cálculo es de una versión anterior', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  delete e.hojas.PUSH_DISPOSITIVOS;
  e.props.ONESIGNAL_APP_ID = '00000000-0000-4000-8000-000000000001'; e.props.ONESIGNAL_API_KEY = 'os_v2_app_clavedepruebaclavedeprueba';
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  assert.equal(e.llamar({ action: 'avisoDePrueba', token: admin }).data.push.estado, 'SIN_DESTINATARIOS');
  assert.ok(e.hojas.PUSH_DISPOSITIVOS);
});

test('OneSignal: REST API Key con formato equivocado o rechazada (401) se explica', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  const disp = { endpoint: 'https://web.push.apple.com/QGx1Zm9vYmFyYmF6cXV4', p256dh: 'BOr8sXlAXVQnzF4e3NQ1oUPg2Jr7ZQ9xL3z8M2tY5kM', auth: 'k8JV6sjdbhAi-n7Y' };
  e.props.ONESIGNAL_APP_ID = '00000000-0000-4000-8000-000000000001'; e.props.ONESIGNAL_API_KEY = 'qbwu7rtmxubvvjtcy623yei6y';   // el Key ID, no la clave
  assert.match(e.llamar({ action: 'registrarDispositivo', token: admin, ...disp }).message, /os_v2_app_/);
  e.props.ONESIGNAL_API_KEY = 'os_v2_app_clavedepruebaclavedeprueba';
  e.onesignalResponde(() => ({ codigo: 401, json: { errors: ['Access denied.'] } }));
  assert.match(e.llamar({ action: 'registrarDispositivo', token: admin, ...disp }).message, /no aceptó la REST API Key/);
});

test('feriados de Venezuela 2026-2030: se agregan los que falten sin duplicar ni borrar los de RRHH', () => {
  const e = crearEntorno();
  e.ejecutar('configurarInicial');
  const fechas = () => e.hojas.FERIADOS.filas.slice(1).map((f) => f[0]).filter(Boolean);
  assert.equal(fechas().length, 14 * 4 + 13);                    // 2030: Viernes Santo cae el 19 de abril
  for (const f of ['2027-02-08', '2027-03-26', '2028-02-29', '2029-03-29', '2030-04-19', '2030-12-31']) assert.ok(fechas().includes(f), f);
  e.hojas.FERIADOS.appendRow(['2027-06-15', 'Día puente de la empresa']);
  e.ejecutar('configurarInicial');                               // repetir no duplica y respeta lo agregado
  assert.equal(fechas().length, 14 * 4 + 13 + 1);
});

test('planificación sobre las hojas: abrir, cargar, aprobar y panel de RRHH (las hojas se crean solas)', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  delete e.hojas.VAC_CICLOS; delete e.hojas.VAC_PLANES;          // hoja de una versión anterior
  // Ana entró hace 400 días: tiene 15 pendientes y cumple su 2.º año (16 días) dentro del período
  const hoy = new Date(), iso = (d) => d.toISOString().slice(0, 10), mas = (n) => iso(new Date(hoy.getTime() + n * 864e5));
  const ingreso = new Date(hoy.getTime() - 400 * 864e5), ingresoAna = iso(ingreso).split('-').reverse().join('/');
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V305803231', nombre: 'SAMUEL HERRERA', organizacion: 'PROSEIN CENTRAL', departamento: 'Recursos Humanos', puesto: 'Asistente', estado: 'Active', fechaInicio: '12/11/2020', salarioMensual: 1 },
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'SUCURSAL EL BOSQUE', departamento: 'Ventas', puesto: 'Vendedora', estado: 'Active', fechaInicio: ingresoAna, salarioMensual: 1 },
  ] });
  e.llamar({ action: 'asignarJefe', token: admin, claves: ['V11111111'], jefe: 'V30580323' });
  const c = e.llamar({ action: 'guardarPlanificacionVac', token: admin, nombre: 'Vacaciones de prueba', desde: mas(-5), hasta: mas(430), abre: mas(-1), cierra: mas(20) });
  assert.equal(c.ok, true, c.message);
  const ana = entrarTrabajador(e, '11111111').token;
  const mia = e.llamar({ action: 'miPlanificacion', token: ana }).data;
  assert.equal(mia.editable, true);
  assert.ok(mia.requeridos > 0);
  const sem = (d) => { const x = new Date(d); while ([0, 6].includes(x.getUTCDay()) || e.hojas.FERIADOS.filas.some((f) => f[0] === iso(x))) x.setUTCDate(x.getUTCDate() + 1); return iso(x); };
  assert.equal(mia.requeridos, 31);
  // todo en un bloque cuando ya tenga todos los días (después de su aniversario)
  const bloques = [{ inicio: sem(new Date(hoy.getTime() + 340 * 864e5)), dias: 31 }];
  const env = e.llamar({ action: 'guardarMiPlanificacion', token: ana, bloques, enviar: true });
  assert.equal(env.ok, true, env.message);
  const samuel = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data;
  const eq = e.llamar({ action: 'equipoPlanificacion', token: samuel.token }).data;
  assert.equal(eq.pendientes.length, 1);
  assert.equal(e.llamar({ action: 'decidirPlanificacion', token: samuel.token, id: env.data.id, aprobar: true }).data.estado, 'APROBADA');
  const plan = e.llamar({ action: 'miPlanificacion', token: ana }).data.plan;
  assert.equal(plan.bloques[0].dias, mia.requeridos);              // los bloques se guardan y se leen como lista
  const panel = e.llamar({ action: 'panelPlanificacionVac', token: admin, ciclo: c.data.id }).data;
  assert.equal(panel.filas.find((f) => f.nombre === 'ANA PRUEBA').estado, 'APROBADA');
  assert.equal(panel.filas.find((f) => f.nombre === 'SAMUEL HERRERA').estado, 'SIN_CARGAR');
  const saldos = e.llamar({ action: 'panelSaldosVacaciones', token: admin }).data;
  assert.equal(saldos.filas.find((f) => f.nombre === 'ANA PRUEBA').localidad, 'SUCURSAL EL BOSQUE');
});

test('PIN de 4 números: crear la primera vez, entrar, bloqueo tras 5 fallos y RRHH lo restablece', () => {
  const e = crearEntorno({ respuestasUi: ['30580323', 'YES', 'clave-de-samuel'] });
  e.ejecutar('configurarInicial'); e.ejecutar('ponerClaveRRHH');
  delete e.hojas.PINES;                                           // hoja de una versión anterior: se crea sola
  const admin = e.llamar({ action: 'loginAdmin', cedula: '30580323', clave: 'clave-de-samuel' }).data.token;
  e.llamar({ action: 'cargarEmpleados', token: admin, filas: [
    { cedula: 'V111111119', nombre: 'ANA PRUEBA', organizacion: 'PROSEIN CENTRAL', departamento: 'Ventas', puesto: 'Vendedora', estado: 'Active', fechaInicio: '05/03/2025', salarioMensual: 1 },
  ] });
  // solo con la cédula ya no entra: pide crear el PIN
  assert.deepEqual(e.llamar({ action: 'login', cedula: '11111111' }).data, { requierePin: true, crearPin: true });
  assert.match(e.llamar({ action: 'crearPin', cedula: '11111111', pin: '1234', confirmacion: '1234' }).message, /muy fácil/);
  assert.match(e.llamar({ action: 'crearPin', cedula: '11111111', pin: '7777', confirmacion: '7777' }).message, /muy fácil/);
  assert.match(e.llamar({ action: 'crearPin', cedula: '11111111', pin: '12a4', confirmacion: '12a4' }).message, /4 números/);
  assert.match(e.llamar({ action: 'crearPin', cedula: '11111111', pin: '2580', confirmacion: '2581' }).message, /no coinciden/);
  const creado = e.llamar({ action: 'crearPin', cedula: '11111111', pin: '2580', confirmacion: '2580' });
  assert.ok(creado.data.token);
  assert.ok(!JSON.stringify(e.hojas.PINES.filas).includes('2580'));   // en la hoja solo queda la huella
  assert.equal(e.llamar({ action: 'crearPin', cedula: '11111111', pin: '9753', confirmacion: '9753' }).code, 'YA_TIENE');   // nadie lo cambia sin RRHH
  assert.deepEqual(e.llamar({ action: 'login', cedula: '11111111' }).data, { requierePin: true, crearPin: false });
  assert.ok(e.llamar({ action: 'login', cedula: '11111111', pin: '2580' }).data.token);
  assert.match(e.llamar({ action: 'login', cedula: '11111111', pin: '0000' }).message, /Te quedan 4 intentos/);
  for (let i = 0; i < 4; i++) e.llamar({ action: 'login', cedula: '11111111', pin: '0000' });
  assert.equal(e.llamar({ action: 'login', cedula: '11111111', pin: '2580' }).code, 'BLOQUEADO');   // bloqueado aunque ahora acierte
  // RRHH lo restablece: al entrar crea uno nuevo
  assert.equal(e.llamar({ action: 'restablecerPin', token: admin, clave: 'V11111111' }).ok, true);
  assert.equal(e.llamar({ action: 'restablecerPin', token: creado.data.token, clave: 'V11111111' }).code, 'SESION');   // solo RRHH
});
