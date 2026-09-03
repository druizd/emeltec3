/**
 * GET /api/companies/:id/period-comparison
 *   ?a_desde=YYYY-MM-DD&a_hasta=YYYY-MM-DD&b_desde=YYYY-MM-DD&b_hasta=YYYY-MM-DD
 *   [&site_ids=S1,S2]
 *
 * `:id` es una sub-empresa o una empresa (mismo orden de resolución que
 * `/:id/sites`). Devuelve, por cada sitio del alcance visible para el usuario,
 * el promedio de caudal y nivel y el consumo acumulado de los períodos A y B.
 *
 * Autorización: misma regla que `/:id/sites`. SuperAdmin ve todo; el resto
 * solo su empresa; Gerente/Cliente/SubEmpresa/Vendedor con sub-empresa
 * asignada quedan restringidos a ella aunque pidan la empresa completa.
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
import { canReadSite } from '../../shared/permissions';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { chileDayKey } from '../contadores/service';
import {
  MAX_DIAS_RANGO,
  compararPeriodos,
  diasInclusivos,
  listarSitiosDelAlcance,
  resolverAlcance,
  type RangoIso,
} from './service';

const ISO_DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD esperado');

const ComparacionQuery = z.object({
  a_desde: ISO_DIA,
  a_hasta: ISO_DIA,
  b_desde: ISO_DIA,
  b_hasta: ISO_DIA,
  site_ids: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : null,
    ),
});

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

/** Tipos que quedan acotados a su sub-empresa cuando la tienen asignada. */
const TIPOS_CON_SUB_EMPRESA = new Set(['Gerente', 'Cliente', 'SubEmpresa', 'Vendedor']);

export function validarRango(rango: RangoIso, etiqueta: string, hoyIso: string): void {
  if (Number.isNaN(Date.parse(`${rango.desde}T00:00:00Z`))) {
    throw new ValidationError(`Fecha inválida en ${etiqueta}: ${rango.desde}`);
  }
  if (Number.isNaN(Date.parse(`${rango.hasta}T00:00:00Z`))) {
    throw new ValidationError(`Fecha inválida en ${etiqueta}: ${rango.hasta}`);
  }
  if (rango.desde > rango.hasta) {
    throw new ValidationError(`En el período ${etiqueta}, "desde" no puede ser mayor que "hasta".`);
  }
  if (rango.hasta > hoyIso) {
    throw new ValidationError(`El período ${etiqueta} no puede incluir fechas futuras.`);
  }
  if (diasInclusivos(rango.desde, rango.hasta) > MAX_DIAS_RANGO) {
    throw new ValidationError(`El período ${etiqueta} puede cubrir como máximo 1 año.`);
  }
}

export async function getPeriodComparisonHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const id = String(req.params.id ?? '')
      .trim()
      .toUpperCase();
    if (!id) throw new ValidationError('id de empresa o sub-empresa requerido');

    const parsed = ComparacionQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }
    const q = parsed.data;
    const rangos = {
      a: { desde: q.a_desde, hasta: q.a_hasta },
      b: { desde: q.b_desde, hasta: q.b_hasta },
    };
    const hoy = chileDayKey(new Date());
    validarRango(rangos.a, 'A', hoy);
    validarRango(rangos.b, 'B', hoy);

    const user = getUser(req);
    const alcance = await resolverAlcance(id);
    if (!alcance) throw new NotFoundError('Empresa o sub-empresa no encontrada.');

    const scope = {
      empresa_id: alcance.empresa_id,
      sub_empresa_id: alcance.tipo === 'sub_empresa' ? alcance.id : null,
    };
    // Para la empresa completa, canReadSite exige que el usuario no tenga
    // sub-empresa o que coincida; acá en vez de negar, acotamos el listado a
    // la sub-empresa del usuario (mismo comportamiento que `/:id/sites`).
    let soloSubEmpresa: string | null = null;
    if (user && user.tipo !== 'SuperAdmin') {
      if (user.empresa_id !== alcance.empresa_id) {
        throw new ForbiddenError('No tiene acceso a esta empresa.');
      }
      if (TIPOS_CON_SUB_EMPRESA.has(user.tipo) && user.sub_empresa_id) {
        if (alcance.tipo === 'sub_empresa' && !canReadSite(user, scope)) {
          throw new ForbiddenError('No tiene acceso a esta sub-empresa.');
        }
        soloSubEmpresa = user.sub_empresa_id;
      }
    } else if (!canReadSite(user, scope)) {
      throw new ForbiddenError('No tiene acceso a esta empresa.');
    }

    let sitios = await listarSitiosDelAlcance(alcance, soloSubEmpresa);
    if (q.site_ids) {
      const pedidos = new Set(q.site_ids);
      sitios = sitios.filter((s) => pedidos.has(s.id));
    }

    const data = await compararPeriodos({ sitios, rangos, hoyIso: hoy });
    res.json(
      ok(
        { alcance: { tipo: alcance.tipo, id: alcance.id, nombre: alcance.nombre }, ...data },
        { count: data.sitios.length, durationMs: elapsedMs(startedAt) },
      ),
    );
  } catch (err) {
    next(err);
  }
}
