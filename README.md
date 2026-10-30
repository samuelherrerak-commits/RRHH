# SADS · Sistema de Atención de Solicitudes (Gestión Humana · Prosein, Austral y Mil Cerámicas)

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

Con `npm run dev:gas` el sitio usa como API el archivo real `apps-script/RRHH.gs` sobre hojas simuladas (Samuel 30580323 y Luis Paul 7952013, clave `clave-demo-123`).

Abre http://localhost:8080. Trabajador: cédula `12345678`. RRHH: cédula `98765432` o `11111111`, clave `demo` (el sitio pide la clave solo a las cédulas de RRHH).

## Publicar

**Apps Script (un solo archivo)**

1. Abre tu hoja de Google → Extensiones → Apps Script.
2. Borra todos los archivos del proyecto salvo uno, y pega **todo** el contenido de `apps-script/RRHH.gs` (es un archivo generado que ya junta el cálculo, las reglas y la API).
3. En Configuración del proyecto activa «Mostrar el archivo appsscript.json» y pega `apps-script/appsscript.json`.
4. Recarga la hoja. Aparece el menú **RRHH**: «1 · Configurar hojas y usuarios» y luego «2 · Poner o cambiar clave de RRHH» (una vez por persona).
5. Implementar → Administrar implementaciones → editar → **Nueva versión** (la URL `/exec` se conserva).

Tras cambiar código del repositorio: `npm run build:gas` regenera `apps-script/RRHH.gs`, y `npm test` avisa si quedó desactualizado.

**Render**: New → Static Site, conecta este repositorio, Publish Directory `web`, sin comando de build (o usa `render.yaml`).
