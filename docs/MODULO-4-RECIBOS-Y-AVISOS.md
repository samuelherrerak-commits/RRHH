# Módulo 4 · Recibos de pago y notificaciones

## Recibos de pago

### RRHH (pestaña «Recibos de pago»)
1. Sube el **PDF de la nómina** de una empresa (el que se descarga del sistema de nómina: una hoja por colaborador).
2. El navegador lee cada hoja (el PDF no se envía entero) y:
   - propone el **concepto** a partir del encabezado: «Nómina: Nómina Quincenal - NQ-155 (16/10/2026 - 31/10/2026)» → **Nómina 2Q octubre 2026** (1-15 = 1Q, 16-fin = 2Q; reconoce Cestaticket, Vacaciones, Utilidades y Bono). Se puede corregir;
   - detecta la **empresa** (Prosein, Austral o Mil Cerámicas);
   - **asigna cada hoja** por la cédula impresa (con o sin dígito verificador) y, si no coincide, por el **nombre exacto**. Las que no identifique (o repetidas / inactivos) se muestran para asignarlas a mano o dejarlas en «No subir esta hoja».
3. **Subir**: cada hoja se separa en su propio PDF y se guarda en Google Drive (carpeta privada «CAC · Recibos de pago» de la cuenta dueña del Apps Script). Si se corta la conexión, «Subir» continúa donde quedó (no duplica).
4. La carga queda en **Borrador** (nadie la ve). Al tocar **Publicar**, cada colaborador recibe el aviso.
5. Por cada carga: avance de **vistos** y **«Recibí conforme»**, detalle por persona con fecha y hora, filtro (sin abrir / sin confirmar), descarga en CSV y el PDF de cada uno.
6. **Eliminar** una carga solo si nadie ha confirmado «Recibí conforme» (los archivos van a la papelera de Drive).

Probado con el PDF real de Prosein (98 hojas): 98 de 98 con cédula y nombre, separación en 0,3 s, ~3 KB por recibo.

### Colaborador (tarjeta «Recibos de pago»)
- Lista de sus recibos publicados: **Nuevo** → **Visto** → **Recibido conforme**.
- **Ver recibo** descarga su PDF (queda la fecha en que lo vio). Después puede tocar **«Recibí conforme»**: queda la fecha y hora (el sello de entrega). Solo ve **sus** recibos.

### Hojas
| Hoja | Contenido |
|---|---|
| `RECIBOS_LOTES` | id · concepto · empresa · total · estado (BORRADOR/PUBLICADO) · creado · por · publicado |
| `RECIBOS` | id · lote · clave · nombre · hoja · archivo (Drive) · creado · visto · conforme |

## Notificaciones

### Campanita (dentro del CAC)
Arriba a la derecha, con el número de avisos sin leer (se revisa cada 3 minutos). Avisos:
- **Recibo de pago nuevo** (al publicar).
- **Vacaciones**: al jefe le llega cada solicitud por aprobar; al colaborador, aprobada (con su constancia), rechazada (con motivo) y registrada por RRHH.
- **Anticipos**: apertura de la solicitud (a todos), rechazo del banco (con motivo) y pago.
- **Constancia de trabajo vencida** (ya puede generar una nueva).

Hojas `NOTIFICACIONES` (un aviso por fila; «*» = para todos) y `NOTIF_LECTURAS` (hasta cuándo leyó cada persona).

### Al celular (OneSignal)
Apps Script no puede firmar ni cifrar las notificaciones push de los navegadores; por eso se usa **OneSignal** (gratis para notificaciones web): Apps Script le pide el envío y OneSignal lo entrega. A OneSignal no se le envía la cédula: cada persona tiene un código (pushId) que no la revela, y el texto del aviso no lleva montos.

- **Android**: funciona desde Chrome.
- **iPhone**: solo si el CAC está **instalado en la pantalla de inicio** (iOS 16.4 o superior). El sitio lo explica.
- Cada colaborador lo activa una vez por dispositivo con **«Activar avisos en este dispositivo»** (en su inicio o en la campanita).

#### Configuración (una vez por sitio: pruebas y real)
1. Crear cuenta en **onesignal.com** → *New App* → plataforma **Web**.
2. *Site URL*: `https://cac-pruebas.onrender.com` (pruebas) o `https://cac.onrender.com` (real). Integración **Custom Code**.
3. En *Advanced* → *Service worker*: ruta **`/push/`** y archivo **`OneSignalSDKWorker.js`** (el sitio ya lo trae en `web/push/`).
4. Copiar el **App ID** en `web/config.js` (`ONESIGNAL_PRUEBAS` o `ONESIGNAL_REAL`).
5. En la hoja: menú **RRHH → «3 · Notificaciones al celular»**: App ID, **REST API Key** (*Settings → Keys & IDs*) y la dirección del sitio.

Una tarea diaria (7 a. m., la instala «Configurar hojas») avisa al celular las constancias vencidas.

## Permisos nuevos de Google
Al pegar esta versión, Google pedirá autorizar de nuevo: **Drive** (guardar los recibos), **conexión a servicios externos** (OneSignal) y **tareas programadas** (aviso diario).
