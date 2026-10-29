# Módulo 3 · Vacaciones

Basado en «Solicitud Digital de Disfrute de Vacaciones - PROSEIN / AUSTRAL.xlsx». El **cierre** (hoja CIERRE DE VACACIONES) está actualizado e incluye todas las solicitudes hechas por formulario: se importa como saldo inicial y no se descuenta nada dos veces.

## Reglas
- **Días hábiles**: lunes a viernes sin feriados (como `NETWORKDAYS`; verificado en 125 de 125 solicitudes). Reintegro = siguiente día hábil.
- **Días por período**: los del cierre; los períodos nuevos (y los ingresos sin cierre) usan la ley: 15 + (años de servicio − 1), tope 30, al cumplir cada aniversario.
- **Anticipación**: la fecha de inicio debe estar entre 15 y 20 días después de hoy (parámetros `vacAnticipacionMin` / `vacAnticipacionMax`), y ser día hábil.
- **Sin adelantar días**: no se puede pedir más de lo pendiente.
- **Pago**: nómina paga el período completo cuando se empieza a disfrutar. Están pagados todos los períodos **hasta el último con días disfrutados** en el cierre (aunque uno anterior figure con 0). Si la solicitud toma días de un período posterior → «Disfrute de días con pago» (RRHH anota el código de nómina); si solo toma de períodos pagados → «Disfrute». Los días salen primero del período más antiguo.
- **Jefe directo obligatorio**: sin jefe no se puede solicitar; RRHH ve cuántos faltan.

## Flujo
1. El trabajador elige fecha de inicio y días hábiles; ve al instante último día, reintegro y si lleva pago. Los días quedan reservados.
2. Su jefe directo la ve en «Mi equipo» (al entrar con su cédula, o en «Mi cuenta» si es de RRHH) y aprueba o rechaza con motivo.
3. Aprobada, llega a RRHH (pestaña Vacaciones, «Por registrar»), que la registra con el código de nómina o la rechaza.
4. Estados: PENDIENTE_JEFE → APROBADA_JEFE → REGISTRADA · RECHAZADA · CANCELADA (el trabajador cancela mientras está con el jefe). Rechazadas y canceladas devuelven los días.

## Hojas
| Hoja | Contenido |
|---|---|
| `FERIADOS` | fecha (AAAA-MM-DD) · motivo. Lista 2026 de RRHH **corregida**: 12/10 en vez de 10/12 y se agregan 5 y 24 de julio. RRHH agrega los de cada año. |
| `VAC_PERIODOS` | clave · período · correspondientes · disfrutados antes del sistema. Se reemplaza al importar el cierre. |
| `VAC_SOLICITUDES` | id · clave · inicio · culminación · reintegro · días · condición · imputación por período · estado · jefe · fechas y responsables de cada paso · nómina · motivo de rechazo. |

## Importación (pestaña Vacaciones de RRHH)
Sube el Excel; se lee la hoja CIERRE DE VACACIONES (por cada «DISFRUTADOS AA-AA» su «CORRESPONDIENTE AA-AA» o, si no tiene título, la columna anterior). Con el archivo real: 151 personas, 28 egresos (se ignoran) y 34 ingresos sin cierre (usan la regla).

## Constancia de aprobación (PDF)
Al registrar, RRHH deja fijos el **número de constancia** (formato del Excel: serial de inicio + cédula de 8 dígitos + serial de culminación + serial de reintegro; verificado con el modelo: 46272V079246274628346286) y los **pendientes por período** una vez aplicado ese disfrute. El trabajador y RRHH la descargan en PDF con el modelo «Constancia de Aprobación de Vacaciones» (membrete Prosein nuevo o Austral según la empresa).
