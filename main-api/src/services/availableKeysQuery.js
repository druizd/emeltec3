/**
 * Consulta de "variables disponibles" de un equipo, compartida por las tres
 * capas que la exponen: v1 (controllers/dataController), v2
 * (modules/telemetry/repo) y gRPC (grpc/server). Estaba triplicada y las tres
 * copias tenían que cambiar juntas al agregar el filtro por sitio.
 *
 * Parámetros: $1 = id_serial, $2 = sitio_id (o NULL).
 *
 * Con sitio se acota al reg_map de ESA obra: un datalogger puede alimentar
 * varios sitios de la misma subempresa (ver ensureSerialAvailable en
 * companyController) y cada uno mapea sus propios registros.
 *
 * Las claves crudas del último payload solo entran SIN filtro de sitio: son las
 * del datalogger entero, útiles para descubrir registros que aún no están en
 * reg_map, y justamente lo que el filtro por sitio quiere excluir.
 */
const AVAILABLE_KEYS_SQL = `
  WITH mapped AS (
    SELECT rm.d1 AS nombre_dato
    FROM sitio s
    JOIN reg_map rm ON rm.sitio_id = s.id
    WHERE s.id_serial = $1
      AND ($2::varchar IS NULL OR s.id = $2)
      AND rm.d1 IS NOT NULL
    UNION
    SELECT rm.d2 AS nombre_dato
    FROM sitio s
    JOIN reg_map rm ON rm.sitio_id = s.id
    WHERE s.id_serial = $1
      AND ($2::varchar IS NULL OR s.id = $2)
      AND rm.d2 IS NOT NULL
  ),
  latest AS (
    SELECT data
    FROM equipo
    WHERE id_serial = $1
      AND $2::varchar IS NULL
    ORDER BY time DESC
    LIMIT 1
  ),
  latest_keys AS (
    SELECT jsonb_object_keys(data) AS nombre_dato
    FROM latest
  )
  SELECT nombre_dato
  FROM (
    SELECT nombre_dato FROM mapped
    UNION
    SELECT nombre_dato FROM latest_keys
  ) keys
  ORDER BY nombre_dato ASC
`;

module.exports = { AVAILABLE_KEYS_SQL };
