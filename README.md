# RRHH · Prosein / Austral

Sistema de recursos humanos: aporte trimestral al fideicomiso y portal del trabajador.

- `core/`: lógica pura (cálculo, empleados, prestaciones, archivos del banco, servicio). La usan Apps Script, las pruebas y el simulador.
- `apps-script/`: API en Google Apps Script sobre Google Sheets.
- `web/`: sitio estático (se publica en Render). Edita `web/config.js` con la URL `/exec` de tu Apps Script.
- `docs/`: diseño de cada módulo.

## Probar en local

```bash
npm test
node dev/server.js
```

Abre http://localhost:8080. Trabajador: cédula `12345678`. RRHH: http://localhost:8080/#rrhh, cédula `11111111`, clave `demo`.

## Publicar

1. Apps Script: copia `core/*.js` y `apps-script/Code.gs`, ejecuta `configurarInicial()` y `crearUsuarioRRHH()`, e implementa como aplicación web (ejecutar como tú, acceso a cualquier persona). Cada cambio de código requiere una **nueva versión** de la implementación para conservar la misma URL.
2. Render: New → Static Site, conecta este repositorio, Publish Directory `web`, sin comando de build (o usa `render.yaml`).
