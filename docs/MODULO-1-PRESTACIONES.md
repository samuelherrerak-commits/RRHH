# Módulo 1 · Prestaciones sociales

## Hoy: solo solicitudes de anticipo (sin saldo en el sistema)
- El colaborador **revisa su disponible en su banco** y escribe monto y motivo. Debe marcar que lo envía **bajo su responsabilidad**.
- **Una solicitud por trimestre**: cada trimestre calendario se solicita por el anterior (en enero de 2027, por el 4.º trimestre de 2026). Si la cancela mientras está «En revisión», puede enviar otra en el mismo trimestre.
- RRHH aprueba o rechaza → genera el archivo para el banco (TIPO T = 5) → marca cada una como **Pagada** o **Rechazada por el banco** (por ejemplo, si el monto superaba el disponible). Rechazada por el banco: la próxima oportunidad es el trimestre siguiente.
- El tope del 75 % sobre lo aportado queda listo para cuando se carguen los aportes: se activa con el parámetro `anticipoValidarDisponible = SI`.

## Diseño completo (cuando el sistema tenga los aportes)

## Flujo completo

1. **RRHH calcula el aporte** del trimestre por empresa (AIV / PCA) con lo pagado. Estado del cierre: `ABIERTO` → `CERRADO`.
2. **RRHH descarga** NOMINA APORTES (todos), nuevos ingresos y cancelación de retirados, y los lleva al banco.
3. **El banco procesa.** RRHH marca el cierre como `ACREDITADO`. Solo desde ese momento el trabajador ve ese aporte.
4. **El trabajador** entra y ve su **estado de cuenta**: aportes por trimestre, total acumulado, anticipos pagados, en trámite y **disponible para anticipar**. Sin intereses.
5. **El trabajador solicita un anticipo** (monto + motivo). Estado `PENDIENTE`.
6. **RRHH revisa** en su bandeja: `APROBADA` o `RECHAZADA` (con motivo).
7. **RRHH genera el archivo** de anticipos para el banco con las aprobadas → pasan a `EN_ARCHIVO`. Mismo diseño que NOMINA APORTES, pero **TIPO T = 5** (en los aportes es 1).
8. **Cuando el banco paga**, RRHH marca `PAGADA`. El disponible del trabajador baja.

## Estados

| Cierre | Anticipo |
|---|---|
| ABIERTO → CERRADO → ACREDITADO | PENDIENTE → APROBADA → EN_ARCHIVO → PAGADA |
| CERRADO puede reabrirse; ACREDITADO no | PENDIENTE/APROBADA → RECHAZADA; PENDIENTE → CANCELADA (por el trabajador) |

## Reglas (parámetros editables en la hoja PARAMETROS)

- **Disponible** = (total acreditado × `porcentajeAnticipoMax`) − anticipos pagados − anticipos en trámite.
- `porcentajeAnticipoMax` por defecto 75 %. **Por confirmar.**
- Los intereses del fideicomiso **no se toman en cuenta** (decisión de RRHH): el saldo es lo aportado.
- Motivos: Vivienda, Salud, Educación, Otro (con explicación).
- Se descuentan los anticipos en trámite para que no se pida dos veces lo mismo.

## Hojas nuevas

- `ANTICIPOS`: id, cédula, monto, motivo, detalle, estado, fechas de cada paso, quién decidió, motivo de rechazo.
- `APORTES` gana la columna de estado del cierre (viene de `CIERRES`).
- `FORMATOS_EXPORT` gana el formato del archivo de anticipos.

## Seguridad

- Sitio **estático** (sin servidor propio) y acceso **solo con cédula**, sin clave. La cédula no es secreta, por eso: el anticipo se paga siempre al fideicomiso/cuenta del propio trabajador, RRHH aprueba cada solicitud, hay límite de intentos y cada consulta queda en el LOG.

- El trabajador solo recibe **sus** datos; la API nunca devuelve otras cédulas.
- Se registra en LOG cada cambio de estado (quién y cuándo).

## Código

`core/prestaciones.js` (reglas) y `core/calculo.js` (aporte), con pruebas en `tests/`.
