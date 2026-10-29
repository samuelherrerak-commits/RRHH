# Módulo 2 · Constancia de trabajo

## Flujo
1. El trabajador entra con su cédula y pulsa **Descargar constancia de trabajo**.
2. El sistema guarda una **copia fija** de sus datos de hoy (nombre, cédula, cargo, organización, fecha de ingreso, sueldo mensual) con un **código único** y vigencia de **30 días**. No requiere aprobación.
3. El navegador arma el PDF (hoja carta) con el membrete de la empresa (PCA = Prosein, AIV = Austral), el texto del modelo, la firma y un **QR**.
4. Quien escanea el QR abre `…/#v=CÓDIGO`: página pública que confirma que el trabajador trabaja o trabajó en la empresa y muestra nombre, cédula, empresa, cargo, ingreso, **salario mensual**, emisión y vencimiento, con estado **Vigente / Vencida / Anulada**. Una constancia **vencida** sigue mostrando sus datos con un aviso ámbar «Constancia auténtica, pero vencida»: confirma que el documento lo emitió la empresa, pero ya no sirve como constancia vigente.
5. RRHH ve todas las constancias en la pestaña **Constancias** y puede **anular** una.

## Variables del modelo de Word
| Modelo | Origen |
|---|---|
| NOMBRE_Y_APELLUDO | Detalle de Empleado → Nombre Socio del Negocio |
| Cédula | Cédula real (sin verificador del RIF), con letra: V-12345678 |
| CARGO | Puesto Nómina |
| LOCALIDAD | Organización (Prosein Central, Sucursal X, Austral Import…) |
| FECHA_INGRESO | Fecha Inicio (se escribe «5 de marzo de 2025») |
| SALARIO_MENSUAL | Salario M. (en letras y en cifras) |
| Fecha de la constancia | Día de emisión, hora de Caracas |

El membrete depende de la **empresa del fideicomiso** del empleado (editable en Empleados), no solo de la organización.

## Parámetros (hoja PARAMETROS)
`firmaNombre`, `firmaCargo`, `firmaTelefono`, `ciudad`, `constanciasMaxPorMes` (por defecto 5 por trabajador en 30 días).

## Seguridad
- El código del QR es largo y aleatorio (no se puede adivinar) y las consultas con códigos inexistentes se limitan.
- La página pública muestra el sueldo a quien tenga el PDF: es lo que se pidió. Si una constancia se filtra, RRHH la anula.
- Cada emisión y anulación queda en LOG.
