# Simulacion Mathei -> Electrico/RILES

Worker backend para generar telemetria ficticia coherente desde el pasteurizador Mathei real hacia dos seriales virtuales: uno electrico y uno RILES.

## Seguridad

- Apagado por defecto: `ENABLE_MATHEI_SIMULATION_WORKER=false`.
- En seco por defecto: `MATHEI_SIM_DRY_RUN=true`.
- No modifica filas reales del serial Mathei.
- Solo escribe en `equipo` con los seriales virtuales configurados.
- Solo puede auto-configurar sitios por ID explicito.
- Rechaza targets con `tipo_sitio` distinto a `electrico` o `riles`.
- Rechaza serial virtual igual al serial real.

## Variables

```env
ENABLE_MATHEI_SIMULATION_WORKER=true
MATHEI_SIM_DRY_RUN=true
MATHEI_SIM_AUTO_CONFIGURE=false

MATHEI_SIM_SOURCE_SERIAL=151.23.33.22
MATHEI_SIM_ELECTRIC_SITE_ID=<ID_SITIO_TEST_ELECTRICO>
MATHEI_SIM_RILES_SITE_ID=<ID_SITIO_TEST_RILES>
MATHEI_SIM_ELECTRIC_SERIAL=MATHEI-ELECTRIC-SIM
MATHEI_SIM_RILES_SERIAL=MATHEI-RILES-SIM

MATHEI_SIM_POLL_MS=30000
MATHEI_SIM_LOOKBACK_MINUTES=180
MATHEI_SIM_ROW_LIMIT=1000
MATHEI_SIM_RILES_MIN_L=1
```

## Activacion recomendada

1. Crear o escoger dos sitios de prueba:
   - Empresa: Emeltec.
   - Subempresa: EmeltecPruebas.
   - Sitio electrico tipo `electrico`.
   - Sitio RILES tipo `riles`.

2. Configurar IDs de esos sitios en env.

3. Primer arranque en seco:

```env
ENABLE_MATHEI_SIMULATION_WORKER=true
MATHEI_SIM_DRY_RUN=true
MATHEI_SIM_AUTO_CONFIGURE=true
```

4. Revisar logs. Debe decir `mathei simulation worker: ciclo completado`.

5. Si todo esta correcto, permitir escritura:

```env
MATHEI_SIM_DRY_RUN=false
```

6. Al terminar la auto-configuracion inicial, volver a dejar:

```env
MATHEI_SIM_AUTO_CONFIGURE=false
```

## Datos generados

Electrico:

- `energia`, `energia_activa_kwh`, `e_reactiva_kvarh`
- `fp_total`, `factor_potencia_l1`, `factor_potencia_l2`, `factor_potencia_l3`
- `voltaje_l1`, `voltaje_l2`, `voltaje_l3`
- `corriente_l1`, `corriente_l2`, `corriente_l3`
- `p_activa_kw`, `p_reactiva_kvar`
- `thd_corriente_l1`, `thd_corriente_l2`, `thd_corriente_l3`
- `cargo_fp`, `cargo_total`, `cumplimiento_fp`, `fp_promedio`, `aumento_factura`
- `estado`, `temperatura`

RILES:

- `caudal`
- `totalizador`
- `nivel`
- `ph`
- `conductividad`
- `temperatura`
- `estado`
- `calidad_sensor_pct`
- `volumen_evento_l`

Los registros incluyen `_simulated=true`, `_source_serial` y `_profile=mathei_v1`.

## Regla RILES

El worker observa `salida_producto_tina` del pasteurizador. Si el ciclo sube sobre `MATHEI_SIM_RILES_MIN_L` y termina antes de `7000 L`, se interpreta como limpieza/descarga RILES. Ciclos sobre `7000 L` se consideran batch productivo y no generan RILES.

## Limpieza

Para borrar solo la simulacion:

```sql
DELETE FROM equipo
WHERE id_serial IN ('MATHEI-ELECTRIC-SIM', 'MATHEI-RILES-SIM');

DELETE FROM reg_map
WHERE sitio_id IN ('<ID_SITIO_TEST_ELECTRICO>', '<ID_SITIO_TEST_RILES>')
  AND id LIKE 'MSIM_%';
```

No borrar sitios, empresas ni subempresas a menos que hayan sido creados solo para prueba.
