const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../core/servicio.js');
const E = require('../core/empleados.js');
const { crearRepo, crearCtx } = require('./memoria.js');

function escenario(fecha) {
  const repo = crearRepo([
    { cedula: 'V123456789', nombre: 'ANA MARIA PRUEBA LOPEZ', organizacion: 'PROSEIN CENTRAL', fechaInicio: '18/11/2021', fechaNacimiento: '18/11/1990', puesto: 'Vendedora' },
    { cedula: 'V234567891', nombre: 'BETO AUSTRAL', organizacion: 'AUSTRAL IMPORT DE VENEZUELA C.A', fechaInicio: '18/11/2025', fechaNacimiento: '18/11/1985' },
    { cedula: 'V345678901', nombre: 'CARLA NUEVA', organizacion: 'PROSEIN CENTRAL', fechaInicio: '18/11/2026', fechaNacimiento: '29/02/2000' },
    { cedula: 'V456789012', nombre: 'DANIEL EGRESADO', organizacion: 'PROSEIN CENTRAL', fechaInicio: '18/11/2020', fechaNacimiento: '18/11/1980', estado: 'Inactive' },
  ]);
  const ctx = crearCtx(fecha);
  repo.st.usuarios['30580323'] = { sal: 'x', hash: ctx.hash('yo', 'x'), rol: 'RRHH', nombre: 'Samuel Herrera' };
  return { repo, ctx, rrhh: S.iniciarSesionAdmin(repo, ctx, '30580323', 'yo').data.token, entrar: (c) => S.iniciarSesion(repo, ctx, c).data.token };
}

test('el Detalle trae la fecha de nacimiento en la columna «Cumpleaños» (serial de Excel)', () => {
  const m = E.mapearDetalle([{ 'Cédula': 'V123456789', 'Nombre Socio del Negocio': 'ANA', 'Fecha Inicio': 45923, 'Cumpleaños': 39482 }]);
  assert.equal(m.filas[0].fechaNacimiento, '04/02/2008');
  assert.deepEqual(E.empleadoDesdeDetalle(m.filas[0]).fechaNacimiento, { y: 2008, m: 2, d: 4 });
  // recargar un Detalle sin la columna no borra la fecha
  const r = E.fusionarDetalle(E.fusionarDetalle([], m.filas).empleados, [{ cedula: 'V123456789', nombre: 'ANA' }]);
  assert.deepEqual(r.empleados[0].fechaNacimiento, { y: 2008, m: 2, d: 4 });
});

test('cumpleaños: felicitación a la persona y aviso a todos; aniversario: solo a la persona; no se repite', () => {
  const { repo, ctx } = escenario(Date.UTC(2026, 10, 18, 11));   // 18/11/2026, 7 a. m. en Caracas
  const r = S.avisosDiarios(repo, ctx, ctx.ahora() - 86400000).data;
  assert.equal(r.cumpleanos, 2); assert.equal(r.aniversarios, 2);   // Carla entró hoy: no es aniversario; Daniel está inactivo
  const n = repo.st.notificaciones;
  assert.deepEqual(n.filter((x) => x.tipo === 'CUMPLEANOS').map((x) => [x.clave, x.titulo]), [['V12345678', '🎂 ¡Feliz cumpleaños, Ana!'], ['V23456789', '🎂 ¡Feliz cumpleaños, Beto!']]);
  const todos = n.filter((x) => x.tipo === 'CUMPLEANOS_TODOS');
  assert.equal(todos.length, 1); assert.equal(todos[0].clave, '*');
  assert.equal(todos[0].titulo, '🎉 Hoy están de cumpleaños Ana Prueba y Beto Austral');
  const aniv = n.filter((x) => x.tipo === 'ANIVERSARIO');
  assert.deepEqual(aniv.map((x) => [x.clave, x.texto]), [['V12345678', 'Hoy cumples 5 años en el Grupo Prosein. ¡Gracias por tu compromiso!'], ['V23456789', 'Hoy cumples tu primer año en el Grupo Prosein. ¡Gracias por tu compromiso!']]);
  assert.ok(aniv.every((x) => x.clave !== '*'));                   // el aniversario no le llega a nadie más
  ctx.reloj.t += 3600000;
  assert.deepEqual(S.avisosDiarios(repo, ctx, ctx.ahora() - 3600000).data, { avisadas: 0, cumpleanos: 0, aniversarios: 0 });
  assert.equal(repo.st.notificaciones.length, n.length);
});

test('29 de febrero se celebra el 28 en años no bisiestos; el colaborador ve su tarjeta y RRHH el mes', () => {
  const { repo, ctx, rrhh, entrar } = escenario(Date.UTC(2027, 1, 28, 15));
  assert.equal(S.avisosDiarios(repo, ctx, ctx.ahora() - 86400000).data.cumpleanos, 1);
  assert.deepEqual(S.miCelebracion(repo, ctx, entrar('34567890')).data, { nombre: 'Carla Nueva', cumpleanos: true, aniversario: 0 });
  ctx.reloj.t = Date.UTC(2026, 10, 18, 15);
  assert.deepEqual(S.miCelebracion(repo, ctx, entrar('12345678')).data, { nombre: 'Ana Maria Prueba Lopez', cumpleanos: true, aniversario: 5 });
  const mes = S.celebracionesDelMes(repo, ctx, rrhh, '2026-11').data;
  assert.deepEqual(mes.filas.map((f) => [f.tipo, f.nombre, f.dia, f.anios]), [['CUMPLEANOS', 'Ana Maria Prueba Lopez', 18, undefined], ['ANIVERSARIO', 'Ana Maria Prueba Lopez', 18, 5],
    ['CUMPLEANOS', 'Beto Austral', 18, undefined], ['ANIVERSARIO', 'Beto Austral', 18, 1]]);
  assert.equal(S.celebracionesDelMes(repo, ctx, entrar('12345678'), '2026-11').ok, false);
});

test('RRHH reenvía la felicitación de hoy solo a la persona', () => {
  const { repo, ctx, rrhh } = escenario(Date.UTC(2026, 10, 18, 15));
  const antes = repo.st.notificaciones.length;
  const r = S.reenviarCelebracion(repo, ctx, rrhh, 'V12345678', 'CUMPLEANOS');
  assert.equal(r.ok, true, JSON.stringify(r));
  const n = repo.st.notificaciones.slice(antes);
  assert.deepEqual(n.map((x) => [x.tipo, x.clave]), [['CUMPLEANOS', 'V12345678']]);          // no repite el aviso a todos
  assert.equal(S.reenviarCelebracion(repo, ctx, rrhh, 'V23456789', 'ANIVERSARIO').ok, true);
  assert.match(S.reenviarCelebracion(repo, ctx, rrhh, 'V34567890', 'ANIVERSARIO').message, /no es el aniversario/);   // entró hoy
  assert.match(S.reenviarCelebracion(repo, ctx, rrhh, 'V34567890', 'CUMPLEANOS').message, /no es el cumpleaños/);
  assert.equal(S.reenviarCelebracion(repo, ctx, S.iniciarSesion(repo, ctx, '12345678').data.token, 'V12345678', 'CUMPLEANOS').ok, false);
});
