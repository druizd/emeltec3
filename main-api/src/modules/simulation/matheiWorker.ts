/**
 * Mathei simulation worker.
 *
 * Reads the real pasteurizer stream and writes derived telemetry into virtual
 * electric/RILES serials. Disabled by default. It never mutates source rows.
 */
import type { QueryResultRow } from 'pg';
import { query, transaction } from '../../config/dbHelpers';
import { logger } from '../../config/logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const siteTelemetryService = require('../../services/siteTelemetryService.js') as {
  buildSiteDashboardData: (opts: {
    site: SiteRow;
    pozoConfig: null;
    mappings: RegMapRow[];
    latest: EquipoRow;
  }) => {
    resumen?: Record<string, { valor?: unknown; ok?: boolean } | undefined>;
  };
};

const PROFILE = 'mathei_v1';
const DEFAULT_SOURCE_SERIAL = '151.23.33.22';
const DEFAULT_ELECTRIC_SERIAL = 'MATHEI-ELECTRIC-SIM';
const DEFAULT_RILES_SERIAL = 'MATHEI-RILES-SIM';
const ELECTRIC_SITE_TYPE = 'electrico';
const RILES_SITE_TYPE = 'riles';
const PASTEUR_SITE_TYPE = 'pasteurizador';

const PASTEUR_BATCH_MIN_L = 7000;
const PRODUCT_ACTIVE_EPSILON_L = 1;
const PRODUCT_RESET_DROP_L = 500;
const RESET_CONFIRM_POINTS = 2;
const MAX_LOOKBACK_MINUTES = 60 * 24 * 45;
const MAX_ROW_LIMIT = 100_000;

interface SiteRow extends QueryResultRow {
  id: string;
  descripcion: string;
  empresa_id: string;
  sub_empresa_id: string;
  id_serial: string;
  ubicacion: string | null;
  coord_norte: string | number | null;
  coord_este: string | number | null;
  huso: number | null;
  tipo_sitio: string;
  activo: boolean;
  es_maleta_piloto?: boolean;
}

interface RegMapRow extends QueryResultRow {
  id: string;
  alias: string;
  d1: string;
  d2: string | null;
  tipo_dato: string;
  unidad: string | null;
  rol_dashboard: string | null;
  transformacion: string | null;
  parametros: Record<string, unknown> | null;
  sitio_id: string | null;
  created_at?: string;
  updated_at?: string;
}

interface EquipoRow extends QueryResultRow {
  time: Date | string;
  received_at: Date | string | null;
  id_serial: string;
  data: Record<string, unknown>;
}

interface SimMapping {
  id: string;
  alias: string;
  d1: string;
  unit: string | null;
  role: string;
}

interface TargetSite {
  site: SiteRow;
  serial: string;
  mappings: SimMapping[];
}

type ProcessMode = 'standby' | 'precalentamiento' | 'produccion' | 'lavado';

interface SourcePoint {
  row: EquipoRow;
  time: Date;
  seed: string;
  productLiters: number | null;
  pasteurTempC: number | null;
  inputTempC: number | null;
  steamPressureBar: number | null;
}

interface ProductCycle {
  start: SourcePoint;
  end: SourcePoint;
  reset: SourcePoint | null;
  maxLiters: number;
  lastLiters: number;
  zeroCount: number;
  tempSum: number;
  tempCount: number;
}

interface ElectricAccumulator {
  lastTime: Date | null;
  activeKwh: number;
  reactiveKvarh: number;
  sourceProductLiters: number | null;
  sourceTime: Date | null;
}

interface ElectricActivity {
  mode: ProcessMode;
  productDeltaLiters: number | null;
  flowLpm: number;
  batchProgress: number;
  loadEnvelope: number;
}

interface RilesAccumulator {
  totalizerM3: number;
}

const ELECTRIC_MAPPINGS: SimMapping[] = [
  { id: 'MSIM_E_EN', alias: 'Energia', d1: 'energia', unit: 'kWh', role: 'energia' },
  {
    id: 'MSIM_E_ENA',
    alias: 'Energia activa',
    d1: 'energia_activa_kwh',
    unit: 'kWh',
    role: 'energia_activa_kwh',
  },
  {
    id: 'MSIM_E_KVARH',
    alias: 'Energia reactiva',
    d1: 'e_reactiva_kvarh',
    unit: 'kVArh',
    role: 'e_reactiva_kvarh',
  },
  {
    id: 'MSIM_E_FP_T',
    alias: 'Factor potencia total',
    d1: 'fp_total',
    unit: null,
    role: 'fp_total',
  },
  {
    id: 'MSIM_E_FP1',
    alias: 'Factor potencia L1',
    d1: 'factor_potencia_l1',
    unit: null,
    role: 'factor_potencia_l1',
  },
  {
    id: 'MSIM_E_FP2',
    alias: 'Factor potencia L2',
    d1: 'factor_potencia_l2',
    unit: null,
    role: 'factor_potencia_l2',
  },
  {
    id: 'MSIM_E_FP3',
    alias: 'Factor potencia L3',
    d1: 'factor_potencia_l3',
    unit: null,
    role: 'factor_potencia_l3',
  },
  { id: 'MSIM_E_V1', alias: 'Voltaje L1', d1: 'voltaje_l1', unit: 'V', role: 'voltaje_l1' },
  { id: 'MSIM_E_V2', alias: 'Voltaje L2', d1: 'voltaje_l2', unit: 'V', role: 'voltaje_l2' },
  { id: 'MSIM_E_V3', alias: 'Voltaje L3', d1: 'voltaje_l3', unit: 'V', role: 'voltaje_l3' },
  {
    id: 'MSIM_E_I1',
    alias: 'Corriente L1',
    d1: 'corriente_l1',
    unit: 'A',
    role: 'corriente_l1',
  },
  {
    id: 'MSIM_E_I2',
    alias: 'Corriente L2',
    d1: 'corriente_l2',
    unit: 'A',
    role: 'corriente_l2',
  },
  {
    id: 'MSIM_E_I3',
    alias: 'Corriente L3',
    d1: 'corriente_l3',
    unit: 'A',
    role: 'corriente_l3',
  },
  {
    id: 'MSIM_E_KW',
    alias: 'Potencia activa total',
    d1: 'p_activa_kw',
    unit: 'kW',
    role: 'p_activa_kw',
  },
  {
    id: 'MSIM_E_KW1',
    alias: 'Potencia activa L1',
    d1: 'p_activa_l1',
    unit: 'kW',
    role: 'p_activa_l1',
  },
  {
    id: 'MSIM_E_KW2',
    alias: 'Potencia activa L2',
    d1: 'p_activa_l2',
    unit: 'kW',
    role: 'p_activa_l2',
  },
  {
    id: 'MSIM_E_KW3',
    alias: 'Potencia activa L3',
    d1: 'p_activa_l3',
    unit: 'kW',
    role: 'p_activa_l3',
  },
  {
    id: 'MSIM_E_KVAR',
    alias: 'Potencia reactiva total',
    d1: 'p_reactiva_kvar',
    unit: 'kVAr',
    role: 'p_reactiva_kvar',
  },
  {
    id: 'MSIM_E_KVAR1',
    alias: 'Potencia reactiva L1',
    d1: 'p_reactiva_l1',
    unit: 'kVAr',
    role: 'p_reactiva_l1',
  },
  {
    id: 'MSIM_E_KVAR2',
    alias: 'Potencia reactiva L2',
    d1: 'p_reactiva_l2',
    unit: 'kVAr',
    role: 'p_reactiva_l2',
  },
  {
    id: 'MSIM_E_KVAR3',
    alias: 'Potencia reactiva L3',
    d1: 'p_reactiva_l3',
    unit: 'kVAr',
    role: 'p_reactiva_l3',
  },
  {
    id: 'MSIM_E_THD1',
    alias: 'THD corriente L1',
    d1: 'thd_corriente_l1',
    unit: '%',
    role: 'thd_corriente_l1',
  },
  {
    id: 'MSIM_E_THD2',
    alias: 'THD corriente L2',
    d1: 'thd_corriente_l2',
    unit: '%',
    role: 'thd_corriente_l2',
  },
  {
    id: 'MSIM_E_THD3',
    alias: 'THD corriente L3',
    d1: 'thd_corriente_l3',
    unit: '%',
    role: 'thd_corriente_l3',
  },
  {
    id: 'MSIM_E_THDU1',
    alias: 'THD tension L1',
    d1: 'thd_tension_l1',
    unit: '%',
    role: 'thd_tension_l1',
  },
  {
    id: 'MSIM_E_THDU2',
    alias: 'THD tension L2',
    d1: 'thd_tension_l2',
    unit: '%',
    role: 'thd_tension_l2',
  },
  {
    id: 'MSIM_E_THDU3',
    alias: 'THD tension L3',
    d1: 'thd_tension_l3',
    unit: '%',
    role: 'thd_tension_l3',
  },
  { id: 'MSIM_E_EST', alias: 'Estado', d1: 'estado', unit: null, role: 'estado' },
  {
    id: 'MSIM_E_TEMP',
    alias: 'Temperatura tablero',
    d1: 'temperatura',
    unit: 'C',
    role: 'temperatura',
  },
  {
    id: 'MSIM_E_CFP',
    alias: 'Cargo factor potencia',
    d1: 'cargo_fp',
    unit: 'CLP',
    role: 'cargo_fp',
  },
  { id: 'MSIM_E_CTOT', alias: 'Cargo total', d1: 'cargo_total', unit: 'CLP', role: 'cargo_total' },
  {
    id: 'MSIM_E_CUMP',
    alias: 'Cumplimiento FP',
    d1: 'cumplimiento_fp',
    unit: '%',
    role: 'cumplimiento_fp',
  },
  {
    id: 'MSIM_E_FPP',
    alias: 'Promedio FP',
    d1: 'fp_promedio',
    unit: null,
    role: 'fp_promedio',
  },
  {
    id: 'MSIM_E_AUM',
    alias: 'Aumento factura',
    d1: 'aumento_factura',
    unit: '%',
    role: 'aumento_factura',
  },
];

const RILES_MAPPINGS: SimMapping[] = [
  { id: 'MSIM_R_Q', alias: 'Caudal descarga', d1: 'caudal', unit: 'L/s', role: 'caudal' },
  { id: 'MSIM_R_TOT', alias: 'Totalizador', d1: 'totalizador', unit: 'm3', role: 'totalizador' },
  { id: 'MSIM_R_NIV', alias: 'Nivel camara', d1: 'nivel', unit: 'm', role: 'nivel' },
  { id: 'MSIM_R_PH', alias: 'pH', d1: 'ph', unit: 'pH', role: 'ph' },
  {
    id: 'MSIM_R_COND',
    alias: 'Conductividad',
    d1: 'conductividad',
    unit: 'uS/cm',
    role: 'conductividad',
  },
  {
    id: 'MSIM_R_TEMP',
    alias: 'Temperatura efluente',
    d1: 'temperatura',
    unit: 'C',
    role: 'temperatura',
  },
  { id: 'MSIM_R_EST', alias: 'Estado', d1: 'estado', unit: null, role: 'estado' },
  {
    id: 'MSIM_R_CAL',
    alias: 'Calidad sensor',
    d1: 'calidad_sensor_pct',
    unit: '%',
    role: 'calidad_sensor_pct',
  },
];

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;
let warnedDisabled = false;

function cleanEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') return fallback;
  return value.trim();
}

function boolEnv(name: string, fallback = false): boolean {
  const value = cleanEnv(name);
  if (!value) return fallback;
  return ['1', 'true', 'si', 'yes', 'on'].includes(value.toLowerCase());
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(cleanEnv(name));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function workerConfig() {
  return {
    enabled: boolEnv('ENABLE_MATHEI_SIMULATION_WORKER', false),
    dryRun: boolEnv('MATHEI_SIM_DRY_RUN', true),
    autoConfigure: boolEnv('MATHEI_SIM_AUTO_CONFIGURE', false),
    sourceSerial: cleanEnv('MATHEI_SIM_SOURCE_SERIAL', DEFAULT_SOURCE_SERIAL),
    electricSiteId: cleanEnv('MATHEI_SIM_ELECTRIC_SITE_ID'),
    rilesSiteId: cleanEnv('MATHEI_SIM_RILES_SITE_ID'),
    electricSerial: cleanEnv('MATHEI_SIM_ELECTRIC_SERIAL', DEFAULT_ELECTRIC_SERIAL),
    rilesSerial: cleanEnv('MATHEI_SIM_RILES_SERIAL', DEFAULT_RILES_SERIAL),
    pollMs: numberEnv('MATHEI_SIM_POLL_MS', 30_000, 5_000, 3_600_000),
    lookbackMinutes: numberEnv('MATHEI_SIM_LOOKBACK_MINUTES', 180, 5, MAX_LOOKBACK_MINUTES),
    rowLimit: numberEnv('MATHEI_SIM_ROW_LIMIT', 1000, 10, MAX_ROW_LIMIT),
    rilesMinLiters: numberEnv('MATHEI_SIM_RILES_MIN_L', 1, 0.1, 1000),
  };
}

function round(value: number, fractionDigits = 2): number {
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unit(seed: string, salt: string): number {
  return fnv1a(`${seed}:${salt}`) / 0xffffffff;
}

function range(seed: string, salt: string, min: number, max: number): number {
  return min + unit(seed, salt) * (max - min);
}

function jitter(seed: string, salt: string, amount: number): number {
  return (unit(seed, salt) * 2 - 1) * amount;
}

async function loadSiteById(siteId: string): Promise<SiteRow | null> {
  const result = await query<SiteRow>(
    `
    SELECT id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion,
           coord_norte, coord_este, huso, tipo_sitio, activo, es_maleta_piloto
    FROM sitio
    WHERE id = $1
    LIMIT 1
    `,
    [siteId],
    { name: 'mathei_sim__site_by_id' },
  );
  return result.rows[0] ?? null;
}

async function loadSourceSite(sourceSerial: string): Promise<SiteRow | null> {
  const result = await query<SiteRow>(
    `
    SELECT id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion,
           coord_norte, coord_este, huso, tipo_sitio, activo, es_maleta_piloto
    FROM sitio
    WHERE id_serial = $1
      AND tipo_sitio = $2
    ORDER BY activo DESC, updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [sourceSerial, PASTEUR_SITE_TYPE],
    { name: 'mathei_sim__source_site' },
  );
  return result.rows[0] ?? null;
}

async function loadMappings(siteId: string): Promise<RegMapRow[]> {
  const result = await query<RegMapRow>(
    `
    SELECT id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion,
           parametros, sitio_id, created_at, updated_at
    FROM reg_map
    WHERE sitio_id = $1
    ORDER BY alias ASC
    `,
    [siteId],
    { name: 'mathei_sim__mappings' },
  );
  return result.rows;
}

async function loadSourceRowsFromAggregate(
  config: ReturnType<typeof workerConfig>,
): Promise<EquipoRow[]> {
  const result = await query<EquipoRow>(
    `
    SELECT bucket AS time, received_at, id_serial, data
    FROM (
      SELECT bucket, received_at, id_serial, data
      FROM equipo_1min
      WHERE id_serial = $1
        AND bucket >= NOW() - ($2::int || ' minutes')::interval
      ORDER BY bucket DESC
      LIMIT $3
    ) recent_source_rows
    ORDER BY bucket ASC
    LIMIT $3
    `,
    [config.sourceSerial, config.lookbackMinutes, config.rowLimit],
    { label: 'mathei_sim__source_rows_1min' },
  );
  return result.rows;
}

async function loadSourceRowsFromRaw(
  config: ReturnType<typeof workerConfig>,
): Promise<EquipoRow[]> {
  const result = await query<EquipoRow>(
    `
    SELECT time, received_at, id_serial, data
    FROM (
      SELECT time, received_at, id_serial, data
      FROM equipo
      WHERE id_serial = $1
        AND time >= NOW() - ($2::int || ' minutes')::interval
      ORDER BY time DESC
      LIMIT $3
    ) recent_source_rows
    ORDER BY time ASC
    LIMIT $3
    `,
    [config.sourceSerial, config.lookbackMinutes, config.rowLimit],
    { label: 'mathei_sim__source_rows_raw' },
  );
  return result.rows;
}

async function loadSourceRows(config: ReturnType<typeof workerConfig>): Promise<EquipoRow[]> {
  try {
    return await loadSourceRowsFromAggregate(config);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'mathei simulation: equipo_1min no disponible, usando equipo raw',
    );
    return loadSourceRowsFromRaw(config);
  }
}

async function loadPreviousVirtualRow(serial: string, before: Date): Promise<EquipoRow | null> {
  const result = await query<EquipoRow>(
    `
    SELECT time, received_at, id_serial, data
    FROM equipo
    WHERE id_serial = $1
      AND time < $2::timestamptz
    ORDER BY time DESC
    LIMIT 1
    `,
    [serial, before.toISOString()],
    { label: 'mathei_sim__previous_virtual' },
  );
  return result.rows[0] ?? null;
}

async function upsertMappings(siteId: string, mappings: SimMapping[]): Promise<void> {
  for (const mapping of mappings) {
    await query(
      `
      INSERT INTO reg_map
        (id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id)
      VALUES
        ($1, $2, $3, NULL, 'numerico', $4, $5, 'directo', '{}'::jsonb, $6)
      ON CONFLICT (id) DO UPDATE SET
        alias = EXCLUDED.alias,
        d1 = EXCLUDED.d1,
        d2 = EXCLUDED.d2,
        tipo_dato = EXCLUDED.tipo_dato,
        unidad = EXCLUDED.unidad,
        rol_dashboard = EXCLUDED.rol_dashboard,
        transformacion = EXCLUDED.transformacion,
        parametros = EXCLUDED.parametros,
        sitio_id = EXCLUDED.sitio_id,
        updated_at = NOW()
      `,
      [mapping.id, mapping.alias, mapping.d1, mapping.unit, mapping.role, siteId],
      { label: 'mathei_sim__upsert_mapping' },
    );
  }
}

async function prepareTargetSite(opts: {
  siteId: string;
  expectedType: string;
  serial: string;
  sourceSerial: string;
  autoConfigure: boolean;
  mappings: SimMapping[];
}): Promise<TargetSite | null> {
  const { siteId, expectedType, serial, sourceSerial, autoConfigure, mappings } = opts;
  if (!siteId) {
    logger.warn({ expectedType }, 'mathei simulation: target site id no configurado');
    return null;
  }
  if (serial === sourceSerial) {
    logger.error({ serial }, 'mathei simulation: serial virtual no puede igualar serial real');
    return null;
  }

  const site = await loadSiteById(siteId);
  if (!site) {
    logger.error({ siteId }, 'mathei simulation: sitio target no existe');
    return null;
  }
  if (site.tipo_sitio !== expectedType) {
    logger.error(
      { siteId, expectedType, actualType: site.tipo_sitio },
      'mathei simulation: tipo_sitio target invalido',
    );
    return null;
  }
  if (!site.activo) {
    logger.warn({ siteId }, 'mathei simulation: sitio target inactivo');
    return null;
  }

  if (autoConfigure) {
    await transaction(async (client) => {
      await client.query(
        `
        UPDATE sitio
        SET id_serial = $2, updated_at = NOW()
        WHERE id = $1
          AND tipo_sitio = $3
          AND id_serial <> $2
        `,
        [siteId, serial, expectedType],
      );
    });
    await upsertMappings(siteId, mappings);
    return { site: { ...site, id_serial: serial }, serial, mappings };
  }

  if (site.id_serial !== serial) {
    logger.warn(
      { siteId, siteSerial: site.id_serial, expectedSerial: serial },
      'mathei simulation: sitio target no apunta al serial virtual; use MATHEI_SIM_AUTO_CONFIGURE=true o configure manualmente',
    );
    return null;
  }
  await upsertMappings(siteId, mappings);
  return { site, serial, mappings };
}

function readMetric(
  dashboard: { resumen?: Record<string, { valor?: unknown; ok?: boolean } | undefined> } | null,
  role: string,
): number | null {
  const metric = dashboard?.resumen?.[role];
  if (metric && metric.ok === false) return null;
  return numberOrNull(metric?.valor);
}

function buildSourcePoint(
  row: EquipoRow,
  sourceSite: SiteRow | null,
  sourceMappings: RegMapRow[],
): SourcePoint | null {
  const time = toDate(row.time);
  if (!time) return null;

  const dashboard =
    sourceSite && sourceMappings.length
      ? siteTelemetryService.buildSiteDashboardData({
          site: sourceSite,
          pozoConfig: null,
          mappings: sourceMappings,
          latest: row,
        })
      : null;
  const raw = row.data || {};
  const seed = `${row.id_serial}:${time.toISOString()}:${JSON.stringify(raw)}`;

  return {
    row,
    time,
    seed,
    productLiters: firstNumber(
      readMetric(dashboard, 'salida_producto_tina'),
      raw.salida_producto_tina,
      raw.producto_l,
    ),
    pasteurTempC: firstNumber(
      readMetric(dashboard, 'temperatura_pasteurizacion'),
      raw.temperatura_pasteurizacion,
    ),
    inputTempC: firstNumber(readMetric(dashboard, 'temperatura_entrada'), raw.temperatura_entrada),
    steamPressureBar: firstNumber(readMetric(dashboard, 'presion_vapor'), raw.presion_vapor),
  };
}

function buildElectricActivity(point: SourcePoint, acc: ElectricAccumulator): ElectricActivity {
  const product = point.productLiters ?? 0;
  const temp = point.pasteurTempC ?? 0;
  const pressure = point.steamPressureBar ?? 0;
  const previousProduct = acc.sourceProductLiters;
  const previousTime = acc.sourceTime;
  const elapsedMinutes =
    previousTime === null
      ? null
      : clamp((point.time.getTime() - previousTime.getTime()) / 60_000, 0.25, 120);

  let productDeltaLiters: number | null = null;
  if (point.productLiters !== null && previousProduct !== null) {
    const rawDelta = point.productLiters - previousProduct;
    productDeltaLiters =
      rawDelta < -PRODUCT_RESET_DROP_L ? Math.max(point.productLiters, 0) : Math.max(rawDelta, 0);
  } else if (point.productLiters !== null && product > PRODUCT_ACTIVE_EPSILON_L) {
    productDeltaLiters = null;
  }

  const flowLpm =
    elapsedMinutes !== null && productDeltaLiters !== null
      ? productDeltaLiters / elapsedMinutes
      : 0;
  const productIsMoving =
    productDeltaLiters === null
      ? product > PRODUCT_ACTIVE_EPSILON_L
      : productDeltaLiters > 0.35 || flowLpm > 0.35;
  const productIsPresent = product > PRODUCT_ACTIVE_EPSILON_L;

  let mode: ProcessMode;
  if (productIsMoving && temp >= 50) mode = 'produccion';
  else if (pressure > 0.2 || temp >= 50) mode = 'precalentamiento';
  else if (productIsPresent) mode = 'lavado';
  else mode = 'standby';

  const batchProgress = clamp(product / PASTEUR_BATCH_MIN_L, 0, 1);
  const productionShape = 0.62 + Math.sin(Math.PI * batchProgress) * 0.34;
  const flowBoost = clamp(flowLpm / 120, 0, 0.22);
  const loadEnvelope =
    mode === 'produccion'
      ? clamp(productionShape + flowBoost + jitter(point.seed, 'load_env', 0.055), 0.55, 1.2)
      : mode === 'precalentamiento'
        ? clamp(0.42 + temp / 160 + jitter(point.seed, 'pre_env', 0.04), 0.38, 0.78)
        : mode === 'lavado'
          ? clamp(0.22 + jitter(point.seed, 'wash_env', 0.05), 0.14, 0.36)
          : clamp(0.05 + jitter(point.seed, 'idle_env', 0.025), 0.02, 0.12);

  acc.sourceProductLiters = point.productLiters;
  acc.sourceTime = point.time;

  return { mode, productDeltaLiters, flowLpm, batchProgress, loadEnvelope };
}

function buildElectricPayload(
  point: SourcePoint,
  acc: ElectricAccumulator,
): Record<string, unknown> {
  const activity = buildElectricActivity(point, acc);
  const mode = activity.mode;
  const seed = point.seed;
  const temp = point.pasteurTempC ?? 25;
  const inputTemp = point.inputTempC ?? 25;
  const pressure = point.steamPressureBar ?? 0;
  const product = point.productLiters ?? 0;
  const tempFactor = clamp((temp - 35) / 45, 0, 1);
  const pressureFactor = clamp(pressure / 4, 0, 1);
  const productFactor = clamp(product / PASTEUR_BATCH_MIN_L, 0, 1.25);
  const thermalLiftFactor = clamp((temp - inputTemp) / 45, 0, 1);
  const pasteurizationFactor = clamp(
    tempFactor * 0.45 + thermalLiftFactor * 0.35 + productFactor * 0.2,
    0,
    1.25,
  );

  let kw: number;
  if (mode === 'produccion')
    kw =
      7.5 +
      activity.loadEnvelope * 13.5 +
      pasteurizationFactor * 5.2 +
      pressureFactor * 2.4 +
      range(seed, 'kwp', -1.2, 2.2);
  else if (mode === 'precalentamiento')
    kw = 3.8 + activity.loadEnvelope * 6.5 + tempFactor * 2.6 + pressureFactor * 2.0;
  else if (mode === 'lavado') kw = 1.5 + activity.loadEnvelope * 6 + productFactor * 1.1;
  else kw = 0.35 + activity.loadEnvelope * 5 + range(seed, 'kws', 0, 0.45);
  kw = round(clamp(kw, 0.2, 32), 3);

  const fpBase =
    mode === 'standby' ? 0.72 : mode === 'lavado' ? 0.84 : mode === 'precalentamiento' ? 0.88 : 0.9;
  const fpSeed = clamp(fpBase + range(seed, 'fp', -0.03, 0.055), 0.68, 0.97);
  const fpPhases: [number, number, number] = [
    round(clamp(fpSeed + 0.018 + jitter(seed, 'fpl1', 0.014), 0.65, 0.99), 3),
    round(clamp(fpSeed - 0.045 + jitter(seed, 'fpl2', 0.016), 0.65, 0.98), 3),
    round(clamp(fpSeed - 0.012 + jitter(seed, 'fpl3', 0.014), 0.65, 0.98), 3),
  ];
  const fp = round(clamp((fpPhases[0] + fpPhases[1] + fpPhases[2]) / 3, 0.68, 0.97), 3);
  const kvar = round(kw * Math.tan(Math.acos(clamp(fp, 0.01, 0.99))), 3);
  const voltageBase = 392 + jitter(seed, 'vbase', 3.5);
  const voltages: [number, number, number] = [
    round(voltageBase + 2.8 + jitter(seed, 'v1', 1.8), 1),
    round(voltageBase - 2.2 + jitter(seed, 'v2', 2.1), 1),
    round(voltageBase + 0.4 + jitter(seed, 'v3', 2.0), 1),
  ];
  const avgVoltage = voltages.reduce((sum, value) => sum + value, 0) / voltages.length;
  const currentBase = (kw * 1000) / (Math.sqrt(3) * avgVoltage * Math.max(fp, 0.68));
  const currents: [number, number, number] = [
    round(currentBase * (1.08 + jitter(seed, 'i1', 0.055)), 2),
    round(currentBase * (0.94 + jitter(seed, 'i2', 0.055)), 2),
    round(currentBase * (1.01 + jitter(seed, 'i3', 0.055)), 2),
  ];
  const activePhases: [number, number, number] = (() => {
    const l1 = clamp(0.37 + jitter(seed, 'pal1', 0.028), 0.3, 0.44);
    const l2 = clamp(0.3 + jitter(seed, 'pal2', 0.026), 0.24, 0.37);
    const l3 = clamp(1 - l1 - l2, 0.24, 0.4);
    const sum = l1 + l2 + l3;
    return [round((kw * l1) / sum, 3), round((kw * l2) / sum, 3), round((kw * l3) / sum, 3)];
  })();
  const reactivePhases = activePhases.map((active, index) =>
    round(active * Math.tan(Math.acos(clamp(fpPhases[index]!, 0.01, 0.99))), 3),
  ) as [number, number, number];

  const elapsedHours =
    acc.lastTime === null
      ? 0
      : clamp((point.time.getTime() - acc.lastTime.getTime()) / 3_600_000, 0, 1);
  acc.activeKwh = round(acc.activeKwh + kw * elapsedHours, 4);
  acc.reactiveKvarh = round(acc.reactiveKvarh + kvar * elapsedHours, 4);
  acc.lastTime = point.time;

  const cargoFactorPotencia = fp < 0.93 ? Math.round((0.93 - fp) * 4_200_000) : 0;
  const cargoTotal = Math.round(acc.activeKwh * 145 + cargoFactorPotencia);
  const aumentoFactura = cargoTotal > 0 ? round((cargoFactorPotencia / cargoTotal) * 100, 1) : 0;
  const cumplimiento = round(clamp((fp / 0.93) * 100, 0, 100), 1);
  const thdBase = mode === 'standby' ? 1.4 : mode === 'lavado' ? 2.6 : 3.4;
  const thdCurrent: [number, number, number] = [
    round(clamp(thdBase + 0.35 + jitter(seed, 'thd1', 0.7), 0.4, 7.8), 2),
    round(clamp(thdBase - 0.25 + jitter(seed, 'thd2', 0.65), 0.4, 7.8), 2),
    round(clamp(thdBase + 0.75 + jitter(seed, 'thd3', 0.75), 0.4, 7.8), 2),
  ];
  const thdVoltageBase = mode === 'standby' ? 0.8 : mode === 'lavado' ? 1.15 : 1.45;
  const thdVoltage: [number, number, number] = [
    round(clamp(thdVoltageBase + 0.18 + jitter(seed, 'thdu1', 0.28), 0.2, 4.5), 2),
    round(clamp(thdVoltageBase - 0.12 + jitter(seed, 'thdu2', 0.25), 0.2, 4.5), 2),
    round(clamp(thdVoltageBase + 0.34 + jitter(seed, 'thdu3', 0.3), 0.2, 4.5), 2),
  ];

  return {
    energia: acc.activeKwh,
    energia_activa_kwh: acc.activeKwh,
    e_reactiva_kvarh: acc.reactiveKvarh,
    fp_total: fp,
    factor_potencia_l1: fpPhases[0],
    factor_potencia_l2: fpPhases[1],
    factor_potencia_l3: fpPhases[2],
    voltaje_l1: voltages[0],
    voltaje_l2: voltages[1],
    voltaje_l3: voltages[2],
    corriente_l1: currents[0],
    corriente_l2: currents[1],
    corriente_l3: currents[2],
    p_activa_kw: kw,
    p_reactiva_kvar: kvar,
    p_activa_l1: activePhases[0],
    p_activa_l2: activePhases[1],
    p_activa_l3: activePhases[2],
    p_reactiva_l1: reactivePhases[0],
    p_reactiva_l2: reactivePhases[1],
    p_reactiva_l3: reactivePhases[2],
    thd_corriente_l1: thdCurrent[0],
    thd_corriente_l2: thdCurrent[1],
    thd_corriente_l3: thdCurrent[2],
    thd_tension_l1: thdVoltage[0],
    thd_tension_l2: thdVoltage[1],
    thd_tension_l3: thdVoltage[2],
    estado: mode,
    temperatura: round(28 + kw * 0.85 + jitter(seed, 'boardt', 1.8), 1),
    cargo_fp: cargoFactorPotencia,
    cargo_total: cargoTotal,
    cumplimiento_fp: cumplimiento,
    fp_promedio: fp,
    aumento_factura: aumentoFactura,
    _simulated: true,
    _source_serial: DEFAULT_SOURCE_SERIAL,
    _source_product_l: point.productLiters,
    _source_product_delta_l:
      activity.productDeltaLiters === null ? null : round(activity.productDeltaLiters, 3),
    _source_flow_lpm: round(activity.flowLpm, 3),
    _batch_progress: round(activity.batchProgress, 3),
    _load_envelope: round(activity.loadEnvelope, 3),
    _profile: PROFILE,
  };
}

function createCycle(point: SourcePoint, productLiters: number): ProductCycle {
  const temp = point.pasteurTempC;
  return {
    start: point,
    end: point,
    reset: null,
    maxLiters: productLiters,
    lastLiters: productLiters,
    zeroCount: 0,
    tempSum: temp === null ? 0 : temp,
    tempCount: temp === null ? 0 : 1,
  };
}

function updateCycle(cycle: ProductCycle, point: SourcePoint, productLiters: number): void {
  cycle.end = point;
  cycle.maxLiters = Math.max(cycle.maxLiters, productLiters);
  cycle.lastLiters = productLiters;
  cycle.zeroCount = 0;
  cycle.reset = null;
  if (point.pasteurTempC !== null) {
    cycle.tempSum += point.pasteurTempC;
    cycle.tempCount++;
  }
}

function detectRilesCycles(points: SourcePoint[], minLiters: number): ProductCycle[] {
  const cycles: ProductCycle[] = [];
  let cycle: ProductCycle | null = null;

  const maybeClose = () => {
    if (!cycle) return;
    const volume = cycle.maxLiters;
    if (volume >= minLiters) cycles.push(cycle);
    cycle = null;
  };

  for (const point of points) {
    const product = point.productLiters;
    if (product === null || product < 0) continue;

    const active = product > PRODUCT_ACTIVE_EPSILON_L;
    if (!cycle) {
      if (active) cycle = createCycle(point, product);
      continue;
    }

    if (!active) {
      cycle.zeroCount++;
      cycle.reset = cycle.reset ?? point;
      if (cycle.zeroCount >= RESET_CONFIRM_POINTS) maybeClose();
      continue;
    }

    const resetByDrop = product + PRODUCT_RESET_DROP_L < cycle.lastLiters;
    if (resetByDrop) {
      maybeClose();
      cycle = createCycle(point, product);
      continue;
    }

    updateCycle(cycle, point, product);
  }

  return cycles;
}

function buildRilesEventPayloads(
  cycle: ProductCycle,
  acc: RilesAccumulator,
): Array<{ time: Date; data: Record<string, unknown> }> {
  const end = cycle.reset ?? cycle.end;
  const seed = `${cycle.start.seed}:${end.seed}:riles`;
  const isProductionBatch = cycle.maxLiters >= PASTEUR_BATCH_MIN_L;
  const inferredLiters = isProductionBatch
    ? round(
        clamp(
          55 + (cycle.maxLiters / 1000) * range(seed, 'clean', 6, 13) + range(seed, 'extra', 0, 45),
          45,
          180,
        ),
        3,
      )
    : round(clamp(cycle.maxLiters * range(seed, 'yield', 0.72, 0.92), 0.2, 6500), 3);
  const inferredM3 = inferredLiters / 1000;
  const avgTemp = cycle.tempCount ? cycle.tempSum / cycle.tempCount : null;
  const temp = round(clamp((avgTemp ?? 28) - 33 + range(seed, 'rtmp', 26, 38), 20, 45), 1);
  const ph = round(clamp(7.15 + jitter(seed, 'ph', 0.55), 6.2, 8.4), 2);
  const conductivity = Math.round(clamp(950 + range(seed, 'cond', -250, 650), 500, 1800));
  const quality = round(clamp(96 - range(seed, 'qdrop', 0.5, 5.5), 88, 99.8), 1);
  const shapeBase = isProductionBatch
    ? [0, 0.18, 0.52, 1, 0.78, 0.64, 0.45, 0.28, 0.13, 0]
    : [0, 0.42, 1, 0.58, 0.24, 0];
  const shape = shapeBase.map((ratio, index) =>
    ratio <= 0 ? 0 : clamp(ratio + jitter(seed, `shape_${index}`, 0.08), 0.05, 1.12),
  );
  const shapeSum = shape.reduce((sum, ratio) => sum + ratio, 0) || 1;
  const durationMinutes = Math.max(1, shape.length - 1);
  const peakFlow = round(
    clamp(
      (inferredLiters / (durationMinutes * 60)) * range(seed, 'flow', 2.4, 4.4),
      0.01,
      isProductionBatch ? 1.2 : 2.4,
    ),
    3,
  );
  const levelPeak = round(
    clamp(
      0.015 + Math.sqrt(inferredLiters) * 0.015 + range(seed, 'level', 0.005, 0.03),
      0.005,
      0.28,
    ),
    3,
  );
  const out: Array<{ time: Date; data: Record<string, unknown> }> = [];

  for (let i = 0; i < shape.length; i++) {
    const ratio = shape[i] ?? 0;
    const time = new Date(end.time.getTime() - (shape.length - 1 - i) * 60_000);
    const stepM3 = ratio > 0 ? inferredM3 * (ratio / shapeSum) : 0;
    acc.totalizerM3 = round(acc.totalizerM3 + stepM3, 6);
    out.push({
      time,
      data: {
        caudal: round(peakFlow * ratio, 3),
        totalizador: acc.totalizerM3,
        nivel: round(levelPeak * ratio, 3),
        ph: round(clamp(ph + jitter(seed, `ph_${i}`, 0.08), 6.1, 8.5), 2),
        conductividad: Math.round(clamp(conductivity + jitter(seed, `cond_${i}`, 55), 450, 1900)),
        temperatura: round(clamp(temp + jitter(seed, `temp_${i}`, 0.7), 18, 48), 1),
        estado:
          ratio > 0.05 ? (isProductionBatch ? 'Limpieza post-batch' : 'Descarga') : 'Sin flujo',
        calidad_sensor_pct: round(
          clamp(quality - ratio * range(seed, 'qratio', 0.1, 1.4), 86, 99.8),
          1,
        ),
        volumen_evento_l: inferredLiters,
        tipo_evento: isProductionBatch ? 'limpieza_post_batch' : 'descarga_corta',
        _simulated: true,
        _source_serial: DEFAULT_SOURCE_SERIAL,
        _profile: PROFILE,
      },
    });
  }

  return out;
}

async function insertVirtualRow(opts: {
  time: Date;
  receivedAt: Date | string | null;
  serial: string;
  data: Record<string, unknown>;
  dryRun: boolean;
}): Promise<boolean> {
  const { time, receivedAt, serial, data, dryRun } = opts;
  if (dryRun) return false;
  const received = toDate(receivedAt) ?? new Date();
  const existing = await query(
    `
    UPDATE equipo
    SET data = equipo.data || $3::jsonb,
        received_at = COALESCE(equipo.received_at, $4::timestamptz)
    WHERE time = $1::timestamptz
      AND id_serial = $2::varchar(50)
      AND data->>'_profile' = $5
    `,
    [time.toISOString(), serial, data, received.toISOString(), PROFILE],
    { label: 'mathei_sim__update_virtual' },
  );
  if ((existing.rowCount ?? 0) > 0) return false;

  const result = await query(
    `
    INSERT INTO equipo (time, id_serial, data, received_at)
    SELECT $1::timestamptz, $2::varchar(50), $3::jsonb, $4::timestamptz
    WHERE NOT EXISTS (
      SELECT 1 FROM equipo
      WHERE time = $1::timestamptz
        AND id_serial = $2::varchar(50)
    )
    `,
    [time.toISOString(), serial, data, received.toISOString()],
    { label: 'mathei_sim__insert_virtual' },
  );
  return (result.rowCount ?? 0) > 0;
}

function previousElectricAccumulator(row: EquipoRow | null): ElectricAccumulator {
  const time = toDate(row?.time);
  const data = row?.data ?? {};
  return {
    lastTime: time,
    activeKwh: numberOrNull(data.energia_activa_kwh) ?? 0,
    reactiveKvarh:
      numberOrNull(data.e_reactiva_kvarh) ?? numberOrNull(data.energia_reactiva_kvarh) ?? 0,
    sourceProductLiters: numberOrNull(data._source_product_l),
    sourceTime: time,
  };
}

function previousRilesAccumulator(row: EquipoRow | null): RilesAccumulator {
  return { totalizerM3: numberOrNull(row?.data?.totalizador) ?? 0 };
}

async function runCycle(): Promise<void> {
  const config = workerConfig();
  if (!config.enabled) {
    if (!warnedDisabled) {
      logger.info('mathei simulation worker deshabilitado');
      warnedDisabled = true;
    }
    return;
  }
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const [electricTarget, rilesTarget, sourceSite, sourceRows] = await Promise.all([
      prepareTargetSite({
        siteId: config.electricSiteId,
        expectedType: ELECTRIC_SITE_TYPE,
        serial: config.electricSerial,
        sourceSerial: config.sourceSerial,
        autoConfigure: config.autoConfigure,
        mappings: ELECTRIC_MAPPINGS,
      }),
      prepareTargetSite({
        siteId: config.rilesSiteId,
        expectedType: RILES_SITE_TYPE,
        serial: config.rilesSerial,
        sourceSerial: config.sourceSerial,
        autoConfigure: config.autoConfigure,
        mappings: RILES_MAPPINGS,
      }),
      loadSourceSite(config.sourceSerial),
      loadSourceRows(config),
    ]);

    if (!electricTarget && !rilesTarget) return;
    if (sourceRows.length === 0) return;

    const sourceMappings = sourceSite ? await loadMappings(sourceSite.id) : [];
    const points = sourceRows
      .map((row) => buildSourcePoint(row, sourceSite, sourceMappings))
      .filter((point): point is SourcePoint => point !== null);
    if (points.length === 0) return;

    let electricInserted = 0;
    let rilesInserted = 0;

    if (electricTarget) {
      const previousElectric = await loadPreviousVirtualRow(electricTarget.serial, points[0]!.time);
      const acc = previousElectricAccumulator(previousElectric);
      for (const point of points) {
        const data = buildElectricPayload(point, acc);
        data._source_serial = config.sourceSerial;
        const inserted = await insertVirtualRow({
          time: point.time,
          receivedAt: point.row.received_at,
          serial: electricTarget.serial,
          data,
          dryRun: config.dryRun,
        });
        if (inserted) electricInserted++;
      }
    }

    if (rilesTarget) {
      const previousRiles = await loadPreviousVirtualRow(rilesTarget.serial, points[0]!.time);
      const acc = previousRilesAccumulator(previousRiles);
      const cycles = detectRilesCycles(points, config.rilesMinLiters);
      for (const event of cycles.flatMap((cycle) => buildRilesEventPayloads(cycle, acc))) {
        event.data._source_serial = config.sourceSerial;
        const inserted = await insertVirtualRow({
          time: event.time,
          receivedAt: new Date(),
          serial: rilesTarget.serial,
          data: event.data,
          dryRun: config.dryRun,
        });
        if (inserted) rilesInserted++;
      }
    }

    logger.info(
      {
        dryRun: config.dryRun,
        sourceSerial: config.sourceSerial,
        sourceRows: sourceRows.length,
        electricInserted,
        rilesInserted,
        durationMs: Date.now() - startedAt,
      },
      'mathei simulation worker: ciclo completado',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'mathei simulation worker: ciclo fallo');
  } finally {
    running = false;
  }
}

export function startMatheiSimulationWorker(): void {
  if (intervalHandle) return;
  const config = workerConfig();
  if (!config.enabled) {
    logger.info('mathei simulation worker deshabilitado (ENABLE_MATHEI_SIMULATION_WORKER=false)');
    return;
  }
  logger.info(
    {
      pollMs: config.pollMs,
      dryRun: config.dryRun,
      autoConfigure: config.autoConfigure,
      sourceSerial: config.sourceSerial,
      electricSiteId: config.electricSiteId || null,
      rilesSiteId: config.rilesSiteId || null,
    },
    'mathei simulation worker iniciado',
  );
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, config.pollMs);
  intervalHandle.unref?.();
}

export function stopMatheiSimulationWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('mathei simulation worker detenido');
}
