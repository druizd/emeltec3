-- 2026-08-18 — Baja documentada del backlog histórico de slots 'no_data_stale'.
--
-- Contexto: el fill libera a `requires_review` con `no_data_stale` los slots
-- vacíos que pasan DGA_STALE_SLOT_HOURS sin bucket en equipo_1min. Hasta ahora
-- nadie los recogía de vuelta — el fill solo recorre `estatus='vacio'` — así
-- que la cola solo crecía. Al 2026-08-18 había 77 slots acumulados desde el
-- 23-may en 9 sitios, y como `evaluarAlertaReviewQueue` (alerts/worker.ts)
-- cuenta `requires_review` sin filtro de antigüedad, esos sitios quedaban
-- permanentemente sobre el umbral: la alerta dejó de distinguir un problema
-- nuevo del backlog viejo.
--
-- Los checks G y H del reconciler resuelven el flujo hacia adelante (rescatan
-- el dato que llega tarde, dan de baja el que ya no va a llegar). Esta
-- migración limpia el backlog PREEXISTENTE, y tiene que correr antes de que el
-- reconciler arranque: si no, el check G rescataría los 16 slots que sí tienen
-- crudo y los declararía a SNIA con dos y tres meses de atraso, que es
-- justamente lo que se decidió NO hacer. `scripts/deploy-production.sh` aplica
-- estas migraciones antes del `compose up`, así que el orden queda garantizado.
--
-- Es una baja DOCUMENTADA, no un borrado: el slot queda consultable en el
-- detalle del sitio y el warning explica por qué nunca se reportó a la DGA.
-- El motivo se escribe por caso porque los tres son distintos y anotarlos a
-- todos como "el equipo no emitió" sería falso para 16 de ellos.
--
-- Idempotente por partida doble: el WHERE exige `estatus='requires_review'`
-- (tras el UPDATE ya no matchea) y acota a `ts < '2026-08-18'` (los slots
-- posteriores son responsabilidad de los checks G/H, no de esta limpieza).
-- El deploy re-corre todos los .sql en cada despliegue.

BEGIN;

-- Quedan fuera SOLO los slots con envío realmente acreditado: audit '00' CON
-- folio. Un audit '00' sin `api_n_comprobante` no prueba nada — el importador
-- del CSV escribe la fila igual cuando el legacy no traía folio
-- (import-dga-historico.js:300), y es la razón de que el check B nunca los
-- tocara (repo.ts exige api_n_comprobante IS NOT NULL, con buen criterio).
-- Los 4 slots de S142 son exactamente ese caso: entran a la baja.
UPDATE dato_dga d
   SET estatus             = 'fallido',
       fail_reason         = 'no_data_definitivo',
       next_retry_at       = NULL,
       validation_warnings = COALESCE(d.validation_warnings, '[]'::jsonb)
                             || jsonb_build_array(jsonb_build_object(
                                  'code', 'no_data_backlog_historico',
                                  'reason',
                                    'Backlog previo al 2026-08-18, dado de baja al incorporarse los '
                                    || 'checks G/H del reconciler. '
                                    || CASE
                                         WHEN EXISTS (SELECT 1
                                                        FROM sitio s
                                                        JOIN equipo_1min e
                                                          ON e.id_serial = s.id_serial
                                                         AND e.bucket    = d.ts
                                                       WHERE s.id = d.site_id)
                                           THEN 'El dato crudo SI existe, pero se decidio no declararlo '
                                                || 'a SNIA por su antiguedad (2-3 meses).'
                                         WHEN EXISTS (SELECT 1
                                                        FROM dga_send_audit a
                                                       WHERE a.site_id         = d.site_id
                                                         AND a.ts              = d.ts
                                                         AND a.dga_status_code = '00')
                                           THEN 'Hay audit legacy-import sin folio: el CSV historico traia '
                                                || 'la fila pero sin numero de comprobante, asi que NO acredita '
                                                || 'declaracion ante SNIA. Verificar en MIA-DGA si se requiere '
                                                || 'certeza.'
                                         ELSE 'El equipo no emitio en esa ventana y el dato ya no puede '
                                              || 'recuperarse.'
                                       END
                                    || ' El slot NO se reporto a la DGA.',
                                  'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                                ))
 WHERE d.estatus     = 'requires_review'
   AND d.fail_reason = 'no_data_stale'
   AND d.ts          < TIMESTAMPTZ '2026-08-18 00:00:00-04'
   AND NOT EXISTS (SELECT 1
                     FROM dga_send_audit a
                    WHERE a.site_id           = d.site_id
                      AND a.ts                = d.ts
                      AND a.dga_status_code   = '00'
                      AND a.api_n_comprobante IS NOT NULL);

COMMIT;
