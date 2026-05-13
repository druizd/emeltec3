/**
 * Servicio DGA: alta de informante + lectura de mediciones procesadas.
 * El insert de dato_dga lo hace el worker (modules/dga/worker.ts), no
 * exponemos endpoint manual: el flujo es completamente automático.
 */
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encryptClave } from './crypto';
import {
  findDgaUserById,
  insertDgaUser,
  listDgaUsersBySite,
  queryDatoDga,
  type DatoDgaRow,
  type DgaUserRow,
} from './repo';
import type { CreateDgaUserPayload } from './schema';

export interface DgaUserPublic {
  id_dgauser: string;
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  periodicidad: string;
  fecha_inicio: string;
  hora_inicio: string;
  last_run_at: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

function toPublic(row: DgaUserRow): DgaUserPublic {
  return {
    id_dgauser: row.id_dgauser,
    site_id: row.site_id,
    nombre_informante: row.nombre_informante,
    rut_informante: row.rut_informante,
    periodicidad: row.periodicidad,
    fecha_inicio: row.fecha_inicio,
    hora_inicio: row.hora_inicio,
    last_run_at: row.last_run_at,
    activo: row.activo,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createDgaUser(input: CreateDgaUserPayload): Promise<DgaUserPublic> {
  const claveCifrada = encryptClave(input.clave_informante);
  try {
    const row = await insertDgaUser({
      site_id: input.site_id,
      nombre_informante: input.nombre_informante,
      rut_informante: input.rut_informante,
      clave_cifrada: claveCifrada,
      periodicidad: input.periodicidad,
      fecha_inicio: input.fecha_inicio,
      hora_inicio: input.hora_inicio.length === 5 ? `${input.hora_inicio}:00` : input.hora_inicio,
    });
    return toPublic(row);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw new ConflictError('Ya existe un informante para ese sitio y RUT', {
        code: 'DGA_USER_DUPLICATE',
      });
    }
    throw err;
  }
}

export async function getDgaUsersBySite(siteId: string): Promise<DgaUserPublic[]> {
  const rows = await listDgaUsersBySite(siteId);
  return rows.map(toPublic);
}

export async function getDatoDga(
  idDgaUser: number,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const user = await findDgaUserById(idDgaUser);
  if (!user) throw new NotFoundError('Informante DGA no encontrado');
  return queryDatoDga(idDgaUser, desde, hasta);
}

export function toCsv(rows: DatoDgaRow[]): string {
  const header = 'OBRA;FECHA;HORA;CAUDAL_INSTANTANEO;FLUJO_ACUMULADO;NIVEL_FREATICO';
  const lines = rows.map((r) => {
    const fields = [
      escapeCsv(r.obra),
      r.fecha,
      r.hora,
      formatNumber(r.caudal_instantaneo),
      formatNumber(r.flujo_acumulado),
      formatNumber(r.nivel_freatico),
    ];
    return fields.join(';');
  });
  return [header, ...lines].join('\r\n');
}

function escapeCsv(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatNumber(value: string | null): string {
  if (value === null || value === undefined) return '';
  return String(value).replace('.', ',');
}
