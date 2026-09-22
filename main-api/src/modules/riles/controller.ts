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
import {
  cerrarLimite,
  createLimite,
  createMuestra,
  deleteMuestra,
  findLimiteById,
  findMuestraById,
  listLimites,
  listParametros,
  parametrosDesconocidos,
} from './lab-repo';
import { getBalance, getMuestra, getMuestras } from './service';
import type { AuthUser } from '../../shared/permissions';
import {
  DEFAULT_CONFIG,
  DIRECCIONES,
  MODOS_CAUDAL,
  NORMAS,
  TIPOS_LIMITE,
  TIPOS_MUESTRA,
  type RilesConfig,
} from './types';

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

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

// ── Laboratorio (fase 2) ─────────────────────────────────────────────────────

const LimiteBody = z
  .object({
    parametro: z.string().trim().min(1).max(30),
    norma: z.enum(NORMAS),
    tipo: z.enum(TIPOS_LIMITE).default('concentracion'),
    limite_min: z.number().min(0).nullable().default(null),
    limite_max: z.number().min(0).nullable().default(null),
    unidad: z.string().trim().min(1).max(20),
    vigencia_desde: FECHA,
    vigencia_hasta: FECHA.nullable().default(null),
    nota: z.string().trim().max(500).nullable().default(null),
  })
  .refine((l) => l.limite_min !== null || l.limite_max !== null, {
    message: 'Un límite sin piso ni techo no limita nada: declare al menos uno de los dos',
  })
  .refine((l) => l.limite_min === null || l.limite_max === null || l.limite_max >= l.limite_min, {
    message: 'El techo del límite es menor que su piso',
  });

const ResultadoBody = z.object({
  parametro: z.string().trim().min(1).max(30),
  valor: z.number().min(0),
  unidad: z.string().trim().min(1).max(20),
  bajo_ld: z.boolean().default(false),
  nota: z.string().trim().max(300).nullable().default(null),
});

const MuestraBody = z.object({
  fecha_muestra: FECHA,
  tipo: z.enum(TIPOS_MUESTRA).default('autocontrol'),
  laboratorio: z.string().trim().max(120).nullable().default(null),
  n_informe: z.string().trim().max(60).nullable().default(null),
  punto: z.string().trim().max(80).nullable().default(null),
  documento_id: z.string().trim().max(30).nullable().default(null),
  nota: z.string().trim().max(500).nullable().default(null),
  resultados: z.array(ResultadoBody).min(1, 'Una muestra sin resultados no dice nada'),
});

const RangoQuery = z.object({ desde: FECHA.optional(), hasta: FECHA.optional() });

export async function listRilesParametrosHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parametros = await listParametros();
    res.json(ok(parametros, { count: parametros.length }));
  } catch (err) {
    next(err);
  }
}

export async function listRilesLimitesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const limites = await listLimites(siteIdDe(req));
    res.json(ok(limites, { count: limites.length }));
  } catch (err) {
    next(err);
  }
}

export async function createRilesLimiteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const parsed = LimiteBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body invalido', { details: parsed.error.issues });
    }
    const body = parsed.data;

    const faltantes = await parametrosDesconocidos([body.parametro]);
    if (faltantes.length > 0) {
      throw new ValidationError(`El parámetro "${faltantes[0]}" no está en el catálogo`);
    }

    const creado = await createLimite({ sitio_id: siteId, ...body });
    res.status(201).json(ok(creado));
  } catch (err) {
    next(err);
  }
}

/**
 * Cierra la vigencia de un límite. No lo borra: la muestra de marzo tiene que
 * seguir leyéndose contra el límite que regía en marzo.
 */
export async function cerrarRilesLimiteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const limiteId = String(req.params.limiteId ?? '').trim();
    if (!limiteId) throw new ValidationError('limiteId requerido');

    const parsed = CerrarQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }

    const existente = await findLimiteById(limiteId);
    if (!existente || existente.sitio_id !== siteId) {
      throw new NotFoundError('Límite no encontrado en este sitio');
    }

    const hasta = parsed.data.hasta ?? getDayRangeChile(new Date()).diaIso;
    if (hasta < existente.vigencia_desde) {
      throw new ValidationError('La fecha de cierre es anterior al inicio de la vigencia');
    }

    res.json(ok(await cerrarLimite(limiteId, hasta)));
  } catch (err) {
    next(err);
  }
}

export async function listRilesMuestrasHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = siteIdDe(req);
    const parsed = RangoQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }

    const hoy = getDayRangeChile(new Date()).diaIso;
    const hasta = parsed.data.hasta ?? hoy;
    const desde = parsed.data.desde ?? haceUnAnio(hoy);
    if (desde > hasta) throw new ValidationError('`desde` es posterior a `hasta`');

    const muestras = await getMuestras({ sitioId: siteId, desde, hasta });
    res.json(ok(muestras, { count: muestras.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function getRilesMuestraHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const muestraId = String(req.params.muestraId ?? '').trim();
    if (!muestraId) throw new ValidationError('muestraId requerido');
    res.json(ok(await getMuestra(siteId, muestraId)));
  } catch (err) {
    next(err);
  }
}

export async function createRilesMuestraHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const parsed = MuestraBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body invalido', { details: parsed.error.issues });
    }
    const body = parsed.data;

    // Una muestra fechada mañana es un error de tipeo, no un dato del futuro.
    if (body.fecha_muestra > getDayRangeChile(new Date()).diaIso) {
      throw new ValidationError('La fecha de la muestra es futura');
    }

    // Dos filas del mismo parámetro chocarían contra el índice único con una
    // traza de Postgres; mejor decir cuál se repite.
    const vistos = new Set<string>();
    for (const r of body.resultados) {
      if (vistos.has(r.parametro)) {
        throw new ValidationError(`El parámetro "${r.parametro}" viene repetido en la muestra`);
      }
      vistos.add(r.parametro);
    }

    const faltantes = await parametrosDesconocidos([...vistos]);
    if (faltantes.length > 0) {
      throw new ValidationError(
        `Estos parámetros no están en el catálogo: ${faltantes.join(', ')}`,
      );
    }

    const creada = await createMuestra({
      sitio_id: siteId,
      ...body,
      created_by: String(getUser(req)?.id ?? '') || null,
    });
    res.status(201).json(ok(await getMuestra(siteId, creada.id)));
  } catch (err) {
    next(err);
  }
}

/**
 * Una muestra sí se borra, a diferencia de un límite o una fuente: es la
 * transcripción de un informe, y una transcripción equivocada se corrige.
 */
export async function deleteRilesMuestraHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = siteIdDe(req);
    const muestraId = String(req.params.muestraId ?? '').trim();
    if (!muestraId) throw new ValidationError('muestraId requerido');

    const existente = await findMuestraById(muestraId);
    if (!existente || existente.sitio_id !== siteId) {
      throw new NotFoundError('Muestra no encontrada en este sitio');
    }

    await deleteMuestra(muestraId);
    res.json(ok({ id: muestraId, eliminada: true }));
  } catch (err) {
    next(err);
  }
}

/** Un año hacia atrás: el período que cubre un informe anual de autocontrol. */
function haceUnAnio(hoy: string): string {
  const [y, m, d] = hoy.split('-').map(Number);
  const anio = String(y! - 1).padStart(4, '0');
  return `${anio}-${String(m!).padStart(2, '0')}-${String(d!).padStart(2, '0')}`;
}
