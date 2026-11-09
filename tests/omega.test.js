const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../core/omega.js');
const S = require('../core/servicio.js');
const { crearRepo, crearCtx } = require('./memoria.js');

test('cestaticket: días del mes (mes comercial de 30) y por dónde se paga', () => {
  assert.equal(O.diasCestaticket({ y: 2025, m: 3, d: 10 }, '2026-11'), 30);
  assert.equal(O.diasCestaticket({ y: 2026, m: 11, d: 16 }, '2026-11'), 15);
  assert.equal(O.diasCestaticket({ y: 2026, m: 12, d: 1 }, '2026-11'), 0);
  const viejo = O.montosDelMes({ fechaIngreso: { y: 2020, m: 1, d: 1 } }, '2026-11', { complemento: 200 });
  assert.deepEqual([viejo.CESTATICKET, viejo.TRANSFERENCIA, viejo.cestaticketPor], [40, 200, 'CESTATICKET']);
  const sinTarjeta = O.montosDelMes({ fechaIngreso: { y: 2020, m: 1, d: 1 }, sinTarjeta: true }, '2026-11', { complemento: 200 });
  assert.deepEqual([sinTarjeta.CESTATICKET, sinTarjeta.TRANSFERENCIA], [0, 240]);
  const nuevo = O.montosDelMes({ fechaIngreso: { y: 2026, m: 11, d: 16 } }, '2026-11', null);   // ingreso a mitad de mes: proporcional por transferencia
  assert.deepEqual([nuevo.CESTATICKET, nuevo.TRANSFERENCIA], [0, 20]);
});

test('quincenas: 1Q = 50 % a su tasa (nada si ingresó tras el 15) y 2Q = 100 % a su tasa − lo pagado en la 1Q', () => {
  assert.equal(O.montoQuincena(40, 1, 905), 18100);
  assert.equal(O.montoQuincena(40, 2, 910, 18100), 18300);
  assert.equal(O.montoQuincena(40, 1, 905, 0, true), 0);
  assert.equal(O.montoQuincena(20, 2, 910, 0), 18200);
});

test('totales para Omega: comisión 1,3 %, IVA 16 % de la comisión y retención del 75 % del IVA', () => {
  assert.deepEqual(O.totalesOmega(1000000), { subtotal: 1000000, comision: 13000, iva: 2080, retencion: 1560, totalPagar: 1013520 });
});

test('TXT de solicitud de depósito igual a la macro de Omega (V7.0)', () => {
  const r = O.archivoDeposito({ razonSocial: 'Prosein Proveeduría y Servicio Industrial, C.A.', rif: 'J-00141771-0', fecha: { y: 2026, m: 10, d: 28 },
    lineas: [{ cedula: '28180545', montoBs: 18200 }, { cedula: 'V-7924627', montoBs: 91000.5 }, { cedula: '1234567', montoBs: 0 }] });
  assert.equal(r.nombre, 'DEPPROSEINPROVEEDURÍAYSERVICIOINDUSTRIALCA261028.txt');
  assert.equal(r.contenido, '255261028J0014177100000200520261028000000000010920050\r\n1\t28180545\t1820000\t\r\n2\t7924627\t9100050\t');
  assert.equal(r.beneficiarios, 2); assert.equal(r.total, 109200.5);
  assert.match(O.archivoDeposito({ razonSocial: 'X', rif: 'J123', fecha: { y: 2026, m: 1, d: 1 }, lineas: [{ cedula: '1', montoBs: 1 }] }).error, /RIF/);
  assert.equal(O.revisarLinea({ cedula: '32695048', montoBs: 1 })[0].tipo, 'aviso');   // rango 30–80 millones: aviso de la macro
});

test('lee el Excel de beneficios de Gestión Humana', () => {
  const m = [
    [null, 'Cargo', 'Nivel del Cargo', 'Cédula', 'Nombre Socio del Negocio', 'Fecha de Ingreso', 'Monto de complemento de alimentación aprobado', 'Ayuda de vehiculo', 'Bono Especial', 'Comisiones Garantizadas', 'Monto a pagar 1Q'],
    [null, null, null, null, null, 'Tasa estimada 1q', null, null, null, null, 905],
    ['PCA', 'Chofer', '1.0', 7924627, 'ZORAYA PEREZ', null, 200, 0, null, null, 90500],
    ['AIV', 'Gerente', '3.0', '12.345.678', 'ANA', null, 300, 150, 600, 300, 0],
  ];
  assert.deepEqual(O.leerExcelBeneficios(m).filas, [
    { cedula: '7924627', nombre: 'ZORAYA PEREZ', complemento: 200, vehiculo: 0, bono: 0, comisiones: 0 },
    { cedula: '12345678', nombre: 'ANA', complemento: 300, vehiculo: 150, bono: 600, comisiones: 300 },
  ]);
});

function escenario() {
  const repo = crearRepo([
    { cedula: 'V079246270', nombre: 'Zoraya Pérez', organizacion: 'PROSEIN CENTRAL', fechaInicio: '08/10/2009' },
    { cedula: 'V123456789', nombre: 'Ana Austral', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '01/01/2020' },
    { cedula: 'V200000006', nombre: 'Nuevo Ingreso', organizacion: 'PROSEIN CENTRAL', fechaInicio: '20/11/2026' },
    { cedula: 'V300000002', nombre: 'Sin Tarjeta', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/02/2024' },
    { cedula: 'V400000009', nombre: 'Ya Egresado', organizacion: 'PROSEIN CENTRAL', fechaInicio: '01/02/2024', estado: 'Inactive' },
  ]);
  const ctx = crearCtx();
  repo.st.usuarios['11111111'] = { sal: 'x', hash: ctx.hash('clave', 'x'), rol: 'RRHH' };
  return { repo, ctx, t: S.iniciarSesionAdmin(repo, ctx, '11111111', 'clave').data.token };
}
const linea = (r, nombre) => r.data.lineas.find((l) => l.nombre.toUpperCase().startsWith(nombre));

test('Omega Capital: quincena con 4 lotes, tarjetas, validar y la 2Q descuenta lo pagado en la 1Q', () => {
  const { repo, ctx, t } = escenario();
  S.omegaImportarBeneficios(repo, ctx, t, [{ cedula: '7924627', complemento: 200 }, { cedula: '12345678', complemento: 300, vehiculo: 150 }]);
  S.omegaMarcarTarjeta(repo, ctx, t, ['V30000000'], true);
  const q = S.omegaAbrirQuincena(repo, ctx, t, '2026-11', 1, 905);
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.deepEqual(q.data.lotes.map((l) => [l.id, l.personas]), [['CT-PCA', 1], ['CT-AIV', 1], ['TR-PCA', 2], ['TR-AIV', 1]]);
  assert.equal(S.omegaAbrirQuincena(repo, ctx, t, '2026-11', 1, 905).code, 'DUPLICADO');

  let ct = S.omegaLote(repo, ctx, t, '2026-11-1', 'CT-PCA');
  assert.equal(ct.data.lineas.length, 1);                                   // solo Zoraya: el egresado no cobra, «sin tarjeta» y el nuevo van por transferencia
  assert.equal(linea(ct, 'ZORAYA').montoBs, 18100);
  let tr = S.omegaLote(repo, ctx, t, '2026-11-1', 'TR-PCA');
  assert.equal(linea(tr, 'ZORAYA').montoBs, 90500);                         // 200/2 × 905
  assert.equal(linea(tr, 'SIN TARJETA').montoBs, 18100);                    // su cestaticket por transferencia
  assert.equal(linea(tr, 'NUEVO').montoBs, 0);                              // ingresó el 20: sin anticipo
  assert.equal(linea(tr, 'NUEVO').usd, 14.67);

  // ajustar: excluir y cambiar monto
  tr = S.omegaAjustarLinea(repo, ctx, t, '2026-11-1', 'TR-PCA', 'V30000000', { monto: '20.000,00' });
  assert.equal(linea(tr, 'SIN TARJETA').montoBs, 20000);
  tr = S.omegaAjustarLinea(repo, ctx, t, '2026-11-1', 'TR-PCA', 'V30000000', { monto: null, excluir: true });
  assert.equal(tr.data.resumen.personas, 1); assert.equal(tr.data.resumen.excluidas, 1);
  tr = S.omegaAjustarLinea(repo, ctx, t, '2026-11-1', 'TR-PCA', 'V30000000', { excluir: false });
  assert.equal(tr.data.resumen.personas, 2);

  // 2Q: no se valida un lote si su 1Q no está validada
  S.omegaAbrirQuincena(repo, ctx, t, '2026-11', 2, 910);
  assert.equal(S.omegaValidarLote(repo, ctx, t, '2026-11-2', 'CT-PCA').code, 'VALIDACION');
  assert.equal(S.omegaValidarLote(repo, ctx, t, '2026-11-1', 'CT-PCA').data.estado, 'VALIDADO');
  assert.equal(S.omegaCambiarTasa(repo, ctx, t, '2026-11-1', 999).code, 'VALIDADO');
  ct = S.omegaLote(repo, ctx, t, '2026-11-2', 'CT-PCA');
  assert.equal(linea(ct, 'ZORAYA').montoBs, 40 * 910 - 18100);
  assert.equal(linea(ct, 'ZORAYA').anticipoBs, 18100);
  S.omegaValidarLote(repo, ctx, t, '2026-11-1', 'TR-PCA');
  tr = S.omegaLote(repo, ctx, t, '2026-11-2', 'TR-PCA');
  assert.equal(linea(tr, 'NUEVO').montoBs, Math.round(14.67 * 910 * 100) / 100);   // sin anticipo: todo en la 2Q
  assert.equal(S.omegaValidarLote(repo, ctx, t, '2026-11-2', 'CT-PCA').data.estado, 'VALIDADO');
  // un cambio de beneficios ya no altera lo validado
  S.omegaEditarBeneficio(repo, ctx, t, 'V7924627', { complemento: 999 });
  assert.equal(linea(S.omegaLote(repo, ctx, t, '2026-11-1', 'TR-PCA'), 'ZORAYA').montoBs, 90500);
  assert.equal(S.omegaReabrirLote(repo, ctx, t, '2026-11-1', 'CT-PCA').code, 'VALIDACION');   // primero la 2Q
  assert.equal(S.omegaReabrirLote(repo, ctx, t, '2026-11-2', 'CT-PCA').data.estado, 'PENDIENTE');
  assert.equal(S.omegaEliminarQuincena(repo, ctx, t, '2026-11-1').code, 'VALIDADO');
});

test('Omega Capital: datos de las empresas y solo Gestión Humana', () => {
  const { repo, ctx, t } = escenario();
  assert.equal(S.omegaInicio(repo, ctx, t).data.config.empresas.PCA.rif, 'J001417710');
  assert.equal(S.omegaGuardarConfig(repo, ctx, t, { empresas: { AIV: { rif: 'J-12345' } } }).code, 'VALIDACION');
  const r = S.omegaGuardarConfig(repo, ctx, t, { empresas: { AIV: { rif: 'J-31234567-8', razonSocial: 'Austral Import de Venezuela, C.A.' } }, parametros: { comision: '0,015' } });
  assert.equal(r.data.config.empresas.AIV.rif, 'J312345678');
  assert.equal(r.data.config.parametros.comision, 0.015);
  assert.equal(S.omegaInicio(repo, ctx, 'x').code, 'SESION');
  assert.equal(S.omegaTarjetas(repo, ctx, t).data.length, 4);   // sin el egresado
});
