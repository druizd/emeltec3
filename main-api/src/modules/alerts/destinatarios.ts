/**
 * Quién recibe el correo de una regla de alerta. Vive fuera del worker porque
 * lo necesitan dos caminos: el correo inmediato de una crítica y el consolidado
 * de las 08:00 / 18:00, que resuelve destinatarios para un lote de eventos.
 */
import { query } from '../../config/dbHelpers';
import { config } from '../../config/appConfig';

/** Default espejo del de appConfig, para tests que mockean `config` sin `alertas`. */
const GUARDIA_EMELTEC_DEFAULT = ['druiz@emeltec.cl', 'nlira@emeltec.cl'];

export function guardiaEmeltec(): string[] {
  const lista = (config as { alertas?: { emeltecEmails?: string[] } }).alertas?.emeltecEmails;
  return Array.isArray(lista) && lista.length > 0 ? lista : GUARDIA_EMELTEC_DEFAULT;
}

export interface DestinatarioAlerta {
  id: string;
  email: string;
  nombre: string;
  apellido: string | null;
}

/** Los campos de la regla que deciden a quién se avisa. */
export interface ReglaNotificable {
  creado_por: string;
  notificar_user_ids?: string[] | null;
  notificar_superadmins?: boolean | null;
}

/**
 * Destinatarios: los elegidos en la regla, más el equipo Emeltec si la regla lo
 * pide. Con la lista vacía se conserva el comportamiento histórico (avisar al
 * creador), así que una regla anterior a esa opción sigue igual.
 *
 * "Avisar al equipo Emeltec" no es todos los SuperAdmin: es la guardia de
 * alertas (ALERT_EMELTEC_EMAILS). Sigue exigiendo tipo SuperAdmin para que un
 * correo mal escrito en la env no le mande alertas a un cliente.
 */
export async function destinatariosDeAlerta(
  alerta: ReglaNotificable,
): Promise<DestinatarioAlerta[]> {
  const elegidos = Array.isArray(alerta.notificar_user_ids)
    ? alerta.notificar_user_ids.filter((id) => typeof id === 'string' && id.length > 0)
    : [];
  const avisarSuperadmins = alerta.notificar_superadmins !== false;
  const usuarios = await query<DestinatarioAlerta>(
    `SELECT DISTINCT id, email, nombre, apellido FROM usuario
     WHERE COALESCE(activo, TRUE)
       AND (
         ($2::boolean AND tipo = 'SuperAdmin' AND lower(email) = ANY($4::text[]))
         OR id = ANY($3::text[])
         OR (cardinality($3::text[]) = 0 AND id = $1)
       )`,
    [alerta.creado_por, avisarSuperadmins, elegidos, guardiaEmeltec()],
    { name: 'alerts__notify_users' },
  );
  return usuarios.rows;
}

export function nombreCompleto(u: DestinatarioAlerta): string {
  return `${u.nombre} ${u.apellido ?? ''}`.trim();
}
