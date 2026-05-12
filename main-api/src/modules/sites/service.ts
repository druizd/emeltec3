/**
 * Servicio del módulo sites: ensambla dashboard-data e histórico transformado.
 * Reemplaza `services/siteTelemetryService.js`. Mantiene la misma forma de
 * respuesta para compatibilidad v1.
 */
import {
  getDashboardHistory,
  getLatestEquipoForSerial,
  getMappingsBySiteId,
  getPozoConfigBySiteId,
  getSiteById,
} from './repo';
import { applyMappingTransform, normalizeTransform, readRawValue } from './transforms';
import type {
  DashboardData,
  DashboardResumen,
  DashboardVariable,
  HistoricalCell,
  HistoricalRow,
  HistoryEquipoRow,
  LatestEquipoRow,
  PozoConfig,
  RegMap,
  Site,
} from './types';

import { calcularNivelFreatico } from '../../utils/nivelFreatico';

function cleanString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUtcIsoString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function responseKeyForMapping(mapping: RegMap): string {
  if (mapping.rol_dashboard && mapping.rol_dashboard !== 'generico') return mapping.rol_dashboard;
  return (
    cleanString(mapping.alias)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || mapping.d1
  );
}

function dashboardRoleForVariable(variable: DashboardVariable): string {
  if (
    variable.transformacion === 'nivel_freatico' ||
    variable.key === 'nivel_freatico' ||
    variable.rol_dashboard === 'nivel_freatico'
  ) {
    return 'nivel_freatico';
  }
  return variable.rol_dashboard || 'generico';
}

function normalizeSearchText(...values: Array<unknown>): string {
  return values
    .map((v) => cleanString(v))
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isLevelSensorVariable(variable: DashboardVariable): boolean {
  if (variable.rol_dashboard === 'nivel') return true;
  const text = normalizeSearchText(variable.alias, variable.key, variable.fuente?.d1);
  if (text.includes('freatico')) return false;
  return [
    'nivel agua',
    'nivel',
    'level',
    'sonda',
    'lectura pozo',
    'columna agua',
    'altura agua',
  ].some((token) => text.includes(token));
}

function findRawLevelSensor(rawData: unknown): {
  key: string;
  alias: string;
  rol_dashboard: 'nivel';
  valor: number;
} | null {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
  for (const [key, value] of Object.entries(rawData as Record<string, unknown>)) {
    const text = normalizeSearchText(key);
    const numericValue = numberOrNull(value);
    if (
      numericValue !== null &&
      !text.includes('freatico') &&
      (text.includes('nivel') ||
        text.includes('level') ||
        text.includes('sonda') ||
        text.includes('altura agua'))
    ) {
      return { key, alias: key, rol_dashboard: 'nivel', valor: numericValue };
    }
  }
  return null;
}

function buildDerivedNivelFreatico(opts: {
  variables: DashboardVariable[];
  pozoConfig: PozoConfig | null;
  rawData: unknown;
}): DashboardVariable | null {
  const { variables, pozoConfig, rawData } = opts;
  const source =
    variables.find(
      (v) =>
        v.ok &&
        v.transformacion !== 'nivel_freatico' &&
        Number.isFinite(Number(v.valor)) &&
        isLevelSensorVariable(v),
    ) ?? findRawLevelSensor(rawData);
  if (!source) return null;

  const sourceValor =
    'valor' in source ? source.valor : Number((source as DashboardVariable).valor);

  const derived: DashboardVariable = {
    id: 'derived:nivel_freatico',
    key: 'nivel_freatico',
    alias: 'Nivel freatico',
    rol_dashboard: 'nivel_freatico',
    transformacion: 'derivado_pozo',
    unidad: 'm',
    fuente: {
      d1: '',
      d2: null,
      variable: (source as { key: string }).key,
      alias: (source as { alias: string }).alias,
    },
    crudo: { d1: null, d2: null, lectura_sensor_m: Number(sourceValor) },
    derivado: true,
    ok: true,
    valor: null,
  };

  try {
    derived.valor = calcularNivelFreatico({
      lecturaPozo: Number(sourceValor),
      profundidadSensor: numberOrNull(pozoConfig?.profundidad_sensor_m),
      profundidadTotal: (() => {
        const n = numberOrNull(pozoConfig?.profundidad_pozo_m);
        if (n === null) throw new Error('profundidad_pozo_m debe ser numerico');
        return n;
      })(),
    });
  } catch (err) {
    derived.ok = false;
    derived.error = (err as Error).message;
  }

  return derived;
}

function buildDashboardVariablesForRaw(opts: {
  site: Site;
  mappings: RegMap[];
  pozoConfig: PozoConfig | null;
  rawData: unknown;
  telemetryError?: string | null;
}): DashboardVariable[] {
  const { site, mappings, pozoConfig, rawData, telemetryError = null } = opts;
  const variables: DashboardVariable[] = [];

  for (const mapping of mappings) {
    const rawD1 = readRawValue(rawData, mapping.d1);
    const rawD2 = readRawValue(rawData, mapping.d2 ?? undefined);
    const transformacion = normalizeTransform(mapping.transformacion);
    const isNivelFreatico = transformacion === 'nivel_freatico';

    const variable: DashboardVariable = {
      id: mapping.id,
      key: isNivelFreatico ? 'nivel_freatico' : responseKeyForMapping(mapping),
      alias: mapping.alias,
      rol_dashboard: isNivelFreatico ? 'nivel_freatico' : mapping.rol_dashboard || 'generico',
      transformacion,
      unidad: mapping.unidad ?? null,
      fuente: { d1: mapping.d1, d2: mapping.d2 ?? null },
      crudo: { d1: rawD1 ?? null, d2: rawD2 ?? null },
      ok: true,
      valor: null,
    };

    try {
      if (telemetryError) throw new Error(telemetryError);
      variable.valor = applyMappingTransform({ rawData, mapping, pozoConfig });
    } catch (err) {
      variable.ok = false;
      variable.error = (err as Error).message;
    }
    variables.push(variable);
  }

  const alreadyHasNivelFreatico = variables.some(
    (v) => v.key === 'nivel_freatico' || v.transformacion === 'nivel_freatico',
  );
  if (site.tipo_sitio === 'pozo' && !alreadyHasNivelFreatico && !telemetryError) {
    const derived = buildDerivedNivelFreatico({ variables, pozoConfig, rawData });
    if (derived) variables.push(derived);
  }

  return variables;
}

function buildResumen(variables: DashboardVariable[]): DashboardResumen {
  const resumen: DashboardResumen = {};
  for (const variable of variables) {
    const role = dashboardRoleForVariable(variable);
    if (role === 'generico') continue;
    resumen[role] = {
      ok: variable.ok,
      valor: variable.valor,
      unidad: variable.unidad,
      alias: variable.alias,
      error: variable.error ?? null,
    };
    if (role === 'nivel_freatico' && variable.fuente?.variable) {
      resumen[role]!.fuente = variable.fuente.variable;
    }
  }
  return resumen;
}

export function buildSiteDashboardData(opts: {
  site: Site;
  pozoConfig: PozoConfig | null;
  mappings: RegMap[];
  latest: LatestEquipoRow | null;
}): DashboardData {
  const { site, pozoConfig, mappings, latest } = opts;
  const rawData = latest?.data ?? {};
  const variables = buildDashboardVariablesForRaw({
    site,
    mappings,
    pozoConfig,
    rawData,
    telemetryError: latest ? null : `No hay telemetria para el serial ${site.id_serial}`,
  });

  return {
    server_time: toUtcIsoString(new Date()),
    site: {
      id: site.id,
      descripcion: site.descripcion,
      id_serial: site.id_serial,
      tipo_sitio: site.tipo_sitio,
    },
    pozo_config: pozoConfig,
    ultima_lectura: latest
      ? {
          time: toUtcIsoString(latest.time),
          timestamp_completo: toUtcIsoString(latest.time),
          received_at: toUtcIsoString(latest.received_at),
          id_serial: latest.id_serial,
        }
      : null,
    resumen: buildResumen(variables),
    variables,
  };
}

const HISTORICAL_ROLE_TOKENS: Record<string, string[]> = {
  caudal: ['caudal', 'flujo', 'flow'],
  nivel: ['nivel agua', 'nivel', 'level', 'sonda', 'altura agua'],
  totalizador: ['totalizador', 'totalizado', 'acumulado', 'volumen', 'volume', 'totalizer'],
  nivel_freatico: ['nivel freatico', 'freatico'],
};

function findHistoricalVariable(
  variables: DashboardVariable[],
  role: keyof typeof HISTORICAL_ROLE_TOKENS,
): DashboardVariable | null {
  const tokens = HISTORICAL_ROLE_TOKENS[role] ?? [normalizeSearchText(role)];
  return (
    variables.find((variable) => {
      if (role === 'nivel_freatico') {
        const text = normalizeSearchText(
          variable.key,
          variable.alias,
          variable.rol_dashboard,
          variable.transformacion,
        );
        return text.includes('nivel freatico');
      }
      if (variable.rol_dashboard === role || variable.key === role) return true;
      if (
        role === 'totalizador' &&
        ['uint32_registros', 'uint32'].includes(variable.transformacion)
      ) {
        return true;
      }
      const text = normalizeSearchText(
        variable.key,
        variable.alias,
        variable.rol_dashboard,
        variable.fuente?.d1,
        variable.fuente?.d2,
      );
      return tokens.some((t) => text.includes(t));
    }) ?? null
  );
}

function serializeHistoricalVariable(variable: DashboardVariable | null): HistoricalCell {
  if (!variable) return { ok: false, valor: null, unidad: null, alias: null };
  return {
    ok: variable.ok !== false,
    valor: variable.ok === false ? null : variable.valor,
    unidad: variable.unidad ?? null,
    alias: variable.alias ?? null,
    error: variable.error ?? null,
  };
}

export function mapHistoricalDashboardRow(opts: {
  row: HistoryEquipoRow;
  site: Site;
  mappings: RegMap[];
  pozoConfig: PozoConfig | null;
}): HistoricalRow {
  const { row, site, mappings, pozoConfig } = opts;
  const variables = buildDashboardVariablesForRaw({
    site,
    mappings,
    pozoConfig,
    rawData: row.data,
  });
  return {
    timestamp: toUtcIsoString(row.time),
    fecha: toUtcIsoString(row.time),
    received_at: toUtcIsoString(row.received_at),
    caudal: serializeHistoricalVariable(findHistoricalVariable(variables, 'caudal')),
    nivel: serializeHistoricalVariable(findHistoricalVariable(variables, 'nivel')),
    totalizador: serializeHistoricalVariable(findHistoricalVariable(variables, 'totalizador')),
    nivel_freatico: serializeHistoricalVariable(
      findHistoricalVariable(variables, 'nivel_freatico'),
    ),
  };
}

/* ── Casos de uso de alto nivel ───────────────────────────────────────── */

export async function loadDashboardData(siteId: string): Promise<{
  site: Site;
  data: DashboardData;
} | null> {
  const site = await getSiteById(siteId);
  if (!site) return null;
  const [pozoConfig, mappings, latest] = await Promise.all([
    getPozoConfigBySiteId(site.id),
    getMappingsBySiteId(site.id),
    site.id_serial ? getLatestEquipoForSerial(site.id_serial) : Promise.resolve(null),
  ]);
  return {
    site,
    data: buildSiteDashboardData({ site, pozoConfig, mappings, latest }),
  };
}

export async function loadDashboardHistory(
  siteId: string,
  limit: number,
): Promise<{
  site: Site;
  rows: HistoricalRow[];
} | null> {
  const site = await getSiteById(siteId);
  if (!site) return null;
  if (!site.id_serial) return { site, rows: [] };
  const [pozoConfig, mappings, history] = await Promise.all([
    getPozoConfigBySiteId(site.id),
    getMappingsBySiteId(site.id),
    getDashboardHistory(site.id_serial, limit),
  ]);
  const rows = history.map((row) =>
    mapHistoricalDashboardRow({ row, site, mappings, pozoConfig }),
  );
  return { site, rows };
}
