---
aliases: [justificacion blob, azure storage decision, por que azure blob, defensa backup]
tags: [vault/justificacion, vault/infrastructure]
---

# Justificación — Sistema de backup de base de datos

← [[HOME]] | Ver también: [[backup-db]] · [[deployment]]

---

## En una línea

Pagamos **$0.38 por mes** para tener una copia de seguridad diaria de todos los datos del sistema. Si algo sale mal, recuperamos todo sin costo adicional.

---

## El problema que resuelve

La base de datos contiene **todos los datos históricos de los sensores de los clientes** — años de mediciones, reportes DGA, registros de consumo. Si ese servidor se cae, se corrompe, o alguien borra algo por error, sin backup ese dato se pierde para siempre.

No hay forma de recuperarlo. No existe "deshacer".

---

## Lo que hace el sistema automáticamente

Cada noche a las 3 AM, sin que nadie tenga que hacer nada:

```
1. Copia completa de toda la base de datos
2. Se comprime (ocupa ~85% menos espacio)
3. Se sube a Azure (mismo proveedor que el servidor)
4. Se guarda por 14 días
5. Las copias de más de 14 días se borran solas
```

No hay intervención manual. No hay que recordar hacerlo. No hay que contratar a nadie para ejecutarlo.

---

## Cuánto cuesta

### Costo mensual real

| Concepto | Cálculo | Costo |
|---|---|---|
| 14 copias diarias × ~1.5 GB cada una | 21 GB × $0.018/GB | **$0.38/mes** |
| Subir las copias cada noche | Ingreso de datos = siempre gratis en Azure | $0 |
| Recuperar la DB si hay desastre | Tráfico interno Azure = gratis | $0 |
| **Total mensual** | | **$0.38** |
| **Total anual** | | **$4.56** |

> Para referencia: un café cuesta más que un año entero de este sistema.

### Por qué no cuesta más de eso

Los datos se comprimen antes de guardarse. Una base de datos de 10 GB se convierte en ~1.5 GB al comprimirse — ocupa 85% menos espacio, y el espacio es lo único que se cobra.

---

## Qué pasa si hay un desastre

Escenario: el servidor se cae, la base de datos se destruye completamente.

| Paso | Tiempo estimado | Costo extra |
|---|---|---|
| Descargar la última copia desde Azure | ~5 minutos | $0 |
| Restaurar toda la base de datos | ~15–30 minutos | $0 |
| **Total** | **~30 minutos** | **$0** |

Sin este sistema: pérdida total de datos, sin posibilidad de recuperación.

---

## Por qué Azure y no otro proveedor

El servidor ya corre en Azure. Guardar las copias en el mismo proveedor significa que los datos **nunca salen de Azure** — no hay costo de transferencia.

Si usáramos otro proveedor (Amazon, Google, otros):

| Opción | Costo mensual estimado | Por qué más caro |
|---|---|---|
| **Azure Blob (decisión actual)** | **$0.38** | Mismo proveedor, sin costo de salida |
| Amazon S3 | ~$2.40 | Azure cobra por cada GB que sale hacia Amazon |
| Google Cloud | ~$2.10 | Mismo problema — datos salen de Azure |
| Backblaze B2 | ~$2.15 | Mismo problema — datos salen de Azure |

Cambiar de proveedor de almacenamiento nos costaría **5–6 veces más** por el solo hecho de que los datos tienen que "viajar" fuera de Azure. Y además habría que gestionar una cuenta y credenciales separadas en otro proveedor.

---

## Por qué 14 días y no más

Cada copia es una **foto completa** de toda la base de datos en ese momento — incluye todos los datos desde el primer día del sistema, no solo los del día.

Esto significa que la copia del día 14 ya contiene todo lo que tenían las copias de los días anteriores. Borrar la copia del día 1 no hace perder ningún dato histórico — esos datos ya están incluidos en la copia más reciente.

14 días de retención = capacidad de volver a cualquier punto de las últimas 2 semanas. Para los tipos de incidentes que pueden ocurrir (error humano, corrupción, falla de hardware), 2 semanas es más que suficiente.

---

## Gestión automática del almacenamiento

Una regla configurada en Azure borra automáticamente las copias con más de 14 días. No se acumula espacio, no hay que hacer limpieza manual, el costo se mantiene estable en $0.38/mes indefinidamente.

---

## Resumen ejecutivo

| Pregunta | Respuesta |
|---|---|
| ¿Cuánto cuesta por mes? | $0.38 |
| ¿Cuánto cuesta recuperar la DB? | $0 |
| ¿Hay que hacer algo manualmente? | No, es automático |
| ¿Cada cuánto se hace la copia? | Todos los días a las 3 AM |
| ¿Cuánto tiempo lleva recuperar la DB? | ~30 minutos |
| ¿Por qué Azure y no otro? | Ya estamos en Azure — salir cuesta 5× más |
| ¿Qué pasa si no tenemos esto? | Pérdida total e irrecuperable de datos |

---

## Glosario

| Término | Qué significa en palabras simples |
|---|---|
| **Base de datos** | Donde vive toda la información del sistema: sensores, clientes, reportes, mediciones. |
| **Backup / Copia de seguridad** | Foto completa de la base de datos guardada en otro lugar. Si la original se destruye, se usa esta para recuperarla. |
| **Azure Blob Storage** | Servicio de Azure para guardar archivos. Como un disco duro externo en la nube, pero administrado por Microsoft. |
| **Compresión** | Proceso que reduce el tamaño del archivo antes de guardarlo. Como cuando se hace un .zip — mismos datos, menos espacio. |
| **Ingress** | Datos que entran a Azure. Microsoft no cobra por esto — meter datos es gratis. |
| **Egress** | Datos que salen de Azure hacia afuera (otro proveedor, internet). Esto sí se cobra. |
| **Retención** | Cuánto tiempo se guardan las copias antes de borrarse automáticamente. |
| **Lifecycle Policy** | Regla automática en Azure que borra copias viejas sin intervención humana. |
| **Hot tier** | Nivel de almacenamiento para archivos que se acceden regularmente. Sin restricciones de cuánto tiempo mínimo hay que guardarlos. |
| **Región Azure** | Ubicación física del datacenter (ej. Este de EE.UU., Brasil). Mover datos dentro de la misma región no tiene costo. |
| **Restauración** | Proceso de reconstruir la base de datos desde una copia de seguridad. |
| **Deallocate** | Apagar una máquina virtual en Azure de forma que deja de cobrar. El equivalente a apagar un servidor — los datos se mantienen, solo se apaga el procesamiento. |
