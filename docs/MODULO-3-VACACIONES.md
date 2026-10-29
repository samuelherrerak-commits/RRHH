# Módulo 3 · Vacaciones (propuesta, pendiente de aprobación)

Basado en «Solicitud Digital de Disfrute de Vacaciones - PROSEIN / AUSTRAL.xlsx»:
- **CIERRE DE VACACIONES**: saldo por persona y período (22-23, 23-24, 24-25, 25-26): correspondientes, disfrutados, pendientes.
- **Sheet1 (2)**: 126 solicitudes del formulario (feb–oct 2026) con inicio, culminación, reintegro, días, condición y número de constancia; lista de feriados 2026.

## Cómo se cuentan los días (igual que el Excel)
- **Días hábiles**: lunes a viernes, sin feriados (`NETWORKDAYS`). Verificado: coincide en 125 de 125 solicitudes.
- **Reintegro**: siguiente día hábil después de la culminación.
- **Días por período**: 15 + (años de servicio − 1), tope 30 (la ley). Coincide con el cierre en 143 de 150 personas; los 7 distintos se importan tal cual.

## Hojas nuevas
| Hoja | Contenido |
|---|---|
| `FERIADOS` | fecha · motivo. Se carga la lista 2026 del archivo; RRHH agrega los de cada año. |
| `VAC_PERIODOS` | clave · período (2024-2025) · días correspondientes · días disfrutados antes del sistema · origen (CIERRE / REGLA). |
| `VAC_SOLICITUDES` | id · clave · inicio · culminación · reintegro · días hábiles · condición · nómina · estado · jefe · aprobación del jefe (quién/cuándo) · registro RRHH (quién/cuándo) · motivo de rechazo · imputación por período · número de constancia. |

**Saldo pendiente** = correspondientes − disfrutados antes del sistema − días de solicitudes aprobadas, descontando primero del período más antiguo.
Al cumplir aniversario se abre el período nuevo con la regla de la ley.

## Flujo
1. El trabajador elige fecha de inicio y cuántos días (o inicio y culminación); el sistema calcula culminación y reintegro y muestra su saldo.
2. La solicitud llega a su **jefe directo**, que la ve al entrar con su cédula («Solicitudes de mi equipo») y aprueba o rechaza.
3. Aprobada por el jefe, llega al panel de **RRHH**, que la registra (y anota la nómina si es «con pago»).
4. Estados: PENDIENTE_JEFE → APROBADA_JEFE → REGISTRADA · RECHAZADA · CANCELADA (por el trabajador mientras esté pendiente).

## Importación inicial (una vez)
- Cierre → `VAC_PERIODOS` (151 personas × 4 períodos).
- Solicitudes del formulario → `VAC_SOLICITUDES` como **historial** (ver pregunta 1).
- 34 personas del Detalle de Empleado no están en el cierre (ingresos recientes): su saldo arranca con la regla.

## Hallazgos en el archivo
- 28 cédulas del cierre no están en el Detalle de Empleado actual (¿egresos?).
- 11 solicitudes con cédula que no se encuentra en el cierre (`#N/A`).
- 1 solicitud con 32.940 días (fecha mal escrita).
- 13 personas acumulan más de 45 días pendientes.
