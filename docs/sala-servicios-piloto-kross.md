# Sala de servicios — piloto Kross (S149)

Vista para sitios que miden los **utilities** de una planta: vapor, frío y aire
comprimido. Hoy la usa un solo sitio, **S149 "Piloto"** de Kross, en la planta de
Curacaví.

Es un piloto. Está armado para **poder darse de baja completo**, sin arrastrar
nada del resto de la plataforma. Si el proyecto no sigue, la sección
[Cómo se borra](#cómo-se-borra) tiene el procedimiento exacto.

---

## Qué es S149

Una maleta de instrumentación (Inventia MT-151 + Siemens S7-1200 + HMI) que mide
tres servicios de la cervecería. No es una caldera ni un pozo: el vapor que mide
es el **manifold** de distribución, aguas abajo de la caldera.

| Servicio        | Variables                                                               |
| --------------- | ----------------------------------------------------------------------- |
| Vapor           | presión de manifold, PT100 de manifold, caudal másico (Forbes Marshall) |
| Frío            | entrada/salida de chiller, entrada/salida del Mitsubishi                |
| Aire comprimido | presión de compresor (y el caudal del CS VA500, que todavía no llega)   |

Las escalas salen del informe técnico de **Solumax SpA del 27-08-2026**
(`Informe_Tecnico_Intervencion_Maleta_Kross_Curacavi_2026-08-27.pdf`). Ese
informe es la fuente de verdad de cómo interpretar cada señal.

> **Ojo con el shunt.** El PT100 entra por AV1 con una resistencia shunt que no
> es de precisión: el lazo queda ~1,6 % bajo, así que el cero de proceso es
> **3940**, no 4000. Si se usa 4000, la temperatura del manifold queda corrida.

---

## Qué toca en el código

Todo lo específico del piloto está marcado con el comentario `[sala-servicios]`,
así que `grep -rn "\[sala-servicios\]" frontend-angular/src main-api/src` los
encuentra todos.

| Archivo                                                              | Qué hay                                     |
| -------------------------------------------------------------------- | ------------------------------------------- |
| `frontend-angular/src/app/pages/companies/sala-servicios/`           | La vista completa. Carpeta propia.          |
| `frontend-angular/src/app/app.routes.ts`                             | La ruta `companies/:siteId/sala-servicios`. |
| `frontend-angular/src/app/shared/site-type-ui.ts`                    | Etiqueta, icono, módulo y `routeSegment`.   |
| `frontend-angular/src/app/pages/administration/site-type-catalog.ts` | Catálogo de respaldo del selector.          |
| `main-api/src/config/siteTypeCatalog.js`                             | Tipo `sala_servicios` y sus roles.          |

Los roles llevan el servicio adentro (`vapor_presion`, `frio_temperatura`,
`aire_caudal`, …) porque **es el rol lo que agrupa la vista**, tanto los tiles de
Monitoreo como los gráficos de Tendencias. El alias no sirve para eso: lo escribe
quien instala y no hay dos plantas que lo escriban igual.

### Lo que NO es del piloto

Dos cosas se construyeron acá pero no son de Kross, y **conviene dejarlas** aunque
el piloto se dé de baja:

- **`analogicas` en el histórico y en el export CSV**
  (`main-api/src/services/siteTelemetryService.js`, `companyController.js`,
  `shared/src/site.ts`). Es el espejo de `digitales`: una columna por variable
  analógica del `reg_map`. Sirve para cualquier sitio que no sea de agua. Es
  opt-in (`?analogicas=1`), así que no le cuesta nada a los sitios de agua.
- **El input `dataTypeOptions` del modal de descarga**
  (`water-detail-descarga.ts`). Antes la lista de campos estaba hardcodeada a
  caudal/nivel/totalizador; ahora se puede pasar otra. El default no cambió.

Si igual se quieren sacar, están cubiertas por
`main-api/src/services/__tests__/siteTelemetryService.analogicas.test.ts`, que
hay que borrar junto con ellas.

---

## Cómo se borra

### 1. Código

```bash
rm -rf frontend-angular/src/app/pages/companies/sala-servicios
grep -rn "\[sala-servicios\]" frontend-angular/src main-api/src
```

Cada marca dice qué sacar. Son cinco puntos:

1. `app.routes.ts` — borrar la ruta `sala-servicios` completa.
2. `site-type-ui.ts` — sacar `'sala_servicios'` de `siteTypes` del módulo
   Proceso, borrar la entrada `sala_servicios` de `SITE_TYPE_UI` y las tres
   líneas de `normalizeSiteType`.
3. `site-type-catalog.ts` (administración) — borrar la entrada.
4. `siteTypeCatalog.js` (backend) — borrar la entrada.

Después, `ng build` y `npx vitest run` en `main-api/`.

### 2. Base de datos

**Primero la base, después el código.** Si se despliega el código sin devolver el
tipo de sitio, S149 queda con un `tipo_sitio` que la plataforma ya no conoce y
cae en la página _coming soon_.

```bash
docker exec -i emeltec-db psql -U postgres -d telemetry_platform < docs/sala-servicios-rollback-s149.sql
```

Ese script devuelve S149 a **exactamente** el estado que tenía antes del piloto
(capturado del bloque `ANTES` de la migración del 14-09-2026): `tipo_sitio =
'pozo'`, los nueve mapeos en rol `generico`, sin unidades, y las escalas viejas.

> Las escalas viejas estaban **mal** (las presiones ×1000, el PT100 ×100). El
> rollback las restaura igual, porque su trabajo es dejar la base como estaba, no
> arreglarla. Si lo que se quiere es apagar la vista pero conservar las unidades
> correctas, hay que correr sólo el `UPDATE sitio` del final del script y dejar el
> `reg_map` como está.

### 3. Qué NO se toca al borrar

Los datos crudos de `equipo` no se tocan nunca: son las lecturas del datalogger y
no dependen de nada de esto. El histórico del sitio queda intacto.

---

## Estado al 14-09-2026

- La configuración ya está aplicada en producción (tipo de sitio, roles, unidades
  y escalas).
- **El caudal del compresor no llega.** El informe dice que el CS VA500 (registro
  1100, m³/h) está copiado al `HR3020` del MT-151, pero esa clave no aparece en el
  payload. Hay que preguntarle a Solumax / al programador DMT.
- **Dos lazos caídos.** El TT de entrada del Mitsubishi marca bajo 4 mA todo el
  mes (se ve como −50 °C, fuera del rango del instrumento) y el caudalímetro de
  vapor está en el piso el 75 % del tiempo. No es un problema de la plataforma.
- **Pendiente de terreno del informe**: dos flujómetros no invasivos para los
  circuitos de chiller y Mitsubishi, por Modbus.
