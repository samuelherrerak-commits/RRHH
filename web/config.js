// Configuración pública del sitio. Todo lo que está aquí lo puede ver cualquiera que abra la página.
// El sitio de pruebas (cac-pruebas.onrender.com, rama «desarrollo») usa su propio Apps Script y su propia hoja,
// para probar cambios sin tocar los datos reales.
const PRUEBAS = /pruebas/.test(location.hostname);
const URL_REAL = 'https://script.google.com/macros/s/AKfycbyToJaIpHkLQVvdmOYg9d0gOb9RsCKRELIRcuzNTd_R6wxopWVOpCg5oTwOP_9n6g76/exec';
const URL_PRUEBAS = '';   // URL /exec del Apps Script de pruebas (copia de la hoja)

export const CONFIG = {
  PRUEBAS,
  API_URL: PRUEBAS ? URL_PRUEBAS : URL_REAL,
  API_TOKEN: 'RRHH2026',
  TIMEOUT_MS: 25000,
};
