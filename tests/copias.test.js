// web/core/ son copias de core/ (Render publica solo web/). Esta prueba falla si se desincronizan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
for (const f of ['calculo.js', 'empleados.js']) {
  test(`web/core/${f} es igual a core/${f}`, () => {
    assert.equal(fs.readFileSync(`web/core/${f}`, 'utf8'), fs.readFileSync(`core/${f}`, 'utf8'), 'Ejecuta: npm run sync');
  });
}
