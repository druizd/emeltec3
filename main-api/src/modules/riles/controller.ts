/**
 * Controllers HTTP del módulo riles.
 *
 * El control de acceso al sitio lo pone `requireSiteAccess('siteId')` en
 * companyRoutes; acá sólo se valida la forma del payload y las reglas del
 * vínculo entre sitios.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { COUNTER_ROLES } from '../contadores/types';
import { getDayRangeChile, getMonthRangeChile } from '../contadores/service';
import { getSiteById } from '../sites/repo';
import {
  cerrarFuente,
  createFuente,
  creariaCiclo,
  findFuenteById,
  findRilesConfig,
  listFuentes,
  mismaSubEmpresa,
  upsertRilesConfig,
} from './repo';
import { getBalance } from './service';
import { DEFAULT_CONFIG, DIRECCIONES, MODOS_CAUDAL, NORMAS, type RilesConfig } from './types';

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD esperado');

const ConfigBody = z.object({
  modo_caudal: z.enum(MODOS_CAUDAL),
  coef_descarga_esperado_pct: z.number().min(0).max(500).nullable().default(null),
  coef_tolerancia_pct: z.number().min(0).max(100).default(DEFAULT_CONFIG.coef_tolerancia_pct),
  norma: z.enum(NORMAS).nullable().default(null),
  punto_descarga: z.string().trim().max(80).nullable().default(null),
  caudal_max_autorizado_lps: z.number().min(0).nullable().default(null),
  volumen_max_mensual_m3: z.number().min(0).nullable().default(null),
});

const FuenteBody = z.object({
  fuente_sitio_id: z.string().trim().min(1).max(10),
  rol: z.enum(COUNTER_ROLES).default('totalizador'),
  // 0 no se permite: una fuente que aporta cero es una fuente que no debería
  // estar declarada, y dejaría un aporte mudo dentro del balance.
  factor: z.number().gt(0).max(1000).default(1),
  direccion: z.enum(DIRECCIONES).default('entrada'),
  vigencia_desde: FECHA,
  vigencia_hasta: FECHA.nullable().default(null),
  nota: z.string().trim().max(500).nullable().default(null),
});

const BalanceQuery = z.object({
  granularidad: z.enum(['dia', 'mes']).default('mes'),
  desde: FECHA.optional(),
  hasta: FECHA.optional(),
});

const CerrarQuery = z.object({ hasta: FECHA.optional() });

function siteIdDe(req: Request): string {
  const siteId = String(req.params.siteId ?? '').trim();
  if (!siteId) throw new ValidationError('siteId requerido');
  return siteId;
}

function configPorDefecto(sitioId: string): RilesConfig {
  return { sitio_id: sitioId, ...DEFAULT_CONFIG };
}

export async function getRilesConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const existing = await findRilesConfig(siteId);
    res.json(ok(existing ?? configPorDefecto(siteId)));
  } catch (err) {
    next(err);
  }
}

export async function updateRilesConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const parsed = ConfigBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body invalido', { details: parsed.error.issues });
    }
    // Un modo derivado sin coeficiente no puede calcular nada: la salida
    // quedaría null en todos los períodos y la pantalla mostraría un balance
    // vacío sin decir por qué.
    if (parsed.data.modo_caudal === 'derivado' && parsed.data.coef_descarga_esperado_pct === null) {
      throw new ValidationError(
        'El modo derivado necesita un coeficiente de descarga esperado: es lo único con que estimar la salida.',
      );
    }
    const saved = await upsertRilesConfig({ sitio_id: siteId, ...parsed.data });
    res.json(ok(saved));
  } catch (err) {
    next(err);
  }
}

export async function listRilesFuentesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const fuentes = await listFuentes(siteId);
    res.json(ok(fuentes, { count: fuentes.length }));
  } catch (err) {
    next(err);
  }
}

export async function createRilesFuenteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const parsed = FuenteBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body invalido', { details: parsed.error.issues });
    }
    const body = parsed.data;

    if (body.fuente_sitio_id === siteId) {
      throw new ValidationError('Un sitio no puede ser fuente de sí mismo');
    }
    if (body.vigencia_hasta !== null && body.vigencia_hasta < body.vigencia_desde) {
      throw new ValidationError('La vigencia termina antes de empezar');
    }

    const fuente = await getSiteById(body.fuente_sitio_id);
    if (!fuente) throw new NotFoundError('El sitio fuente no existe');

    // Cross-tenant: ligar un sitio de otra subempresa publicaría su volumen
    // extraído en la pantalla de este cliente.
    if (!(await mismaSubEmpresa(siteId, body.fuente_sitio_id))) {
      throw new ValidationError(
        'El sitio fuente tiene que pertenecer a la misma subempresa que el sitio RILes',
      );
    }
    if (await creariaCiclo(siteId, body.fuente_sitio_id)) {
      throw new ValidationError(
        'Ese vínculo cerraría un ciclo: el sitio fuente ya se alimenta, directa o indirectamente, de este sitio',
      );
    }

    const creada = await createFuente({ riles_sitio_id: siteId, ...body });
    res.status(201).json(ok(creada));
  } catch (err) {
    next(err);
  }
}

/**
 * Da de baja una fuente cerrando su ventana de vigencia. No borra la fila: el
 * balance histórico que el cliente ya vio tiene que seguir dando lo mismo.
 */
export async function cerrarRilesFuenteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const fuenteId = String(req.params.fuenteId ?? '').trim();
    if (!fuenteId) throw new ValidationError('fuenteId requerido');

    const parsed = CerrarQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }

    const existente = await findFuenteById(fuenteId);
    if (!existente || existente.riles_sitio_id !== siteId) {
      throw new NotFoundError('Fuente no encontrada en este sitio');
    }

    const hasta = parsed.data.hasta ?? getDayRangeChile(new Date()).diaIso;
    if (hasta < existente.vigencia_desde) {
      throw new ValidationError('La fecha de cierre es anterior al inicio de la vigencia');
    }

    const cerrada = await cerrarFuente(fuenteId, hasta);
    res.json(ok(cerrada));
  } catch (err) {
    next(err);
  }
}

export async function getRilesBalanceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = siteIdDe(req);
    const parsed = BalanceQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }
    const { granularidad } = parsed.data;

    const hoy = getDayRangeChile(new Date()).diaIso;
    const hasta = parsed.data.hasta ?? hoy;
    const desde = parsed.data.desde ?? rangoPorDefecto(granularidad);

    if (desde > hasta) throw new ValidationError('`desde` es posterior a `hasta`');

    const payload = await getBalance({ sitioId: siteId, desde, hasta, granularidad });
    res.json(ok(payload, { count: payload.puntos.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

/** 12 meses hacia atrás, o 30 días. Cubre la pantalla sin que nadie pida nada. */
function rangoPorDefecto(granularidad: 'dia' | 'mes'): string {
  const ahora = new Date();
  if (granularidad === 'mes') {
    const mesActual = getMonthRangeChile(ahora).mesIso;
    const [y, m] = mesActual.split('-').map(Number);
    const inicio = new Date(Date.UTC(y!, m! - 1 - 11, 1));
    return inicio.toISOString().slice(0, 10);
  }
  const hoy = getDayRangeChile(ahora).diaIso;
  const inicio = new Date(Date.parse(`${hoy}T00:00:00Z`) - 29 * 86_400_000);
  return inicio.toISOString().slice(0, 10);
}
