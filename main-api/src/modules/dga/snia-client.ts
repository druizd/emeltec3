/**
 * Cliente HTTP REST contra el endpoint oficial SNIA aguas subterráneas
 * (Manual Técnico DGA 1/2025, Res. Exenta 2.170 del 04-jul-2025).
 *
 * Endpoint:  https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas
 * Método:    POST
 * Headers:   codigoObra, timeStampOrigen (yyyy-MM-ddTHH:mm:ss-0000)
 * Body:      autenticacion{password,rutEmpresa,rutUsuario} +
 *            medicionSubterranea{caudal,fechaMedicion,horaMedicion,
 *                                nivelFreaticoDelPozo,totalizador}
 * Response:  { status:"00", message, data:{ numeroComprobante } }
 *
 * Formato de campos (validado server-side por SNIA, rechaza si no cumple):
 *   - caudal:                  numérico string, 2 decimales, unidad L/s
 *   - totalizador:             entero string sin decimales, unidad m³,
 *                              máximo 15 caracteres
 *   - nivelFreaticoDelPozo:    numérico string, 2 decimales, unidad m;
 *                              vacío permitido en pozos de caudales muy
 *                              pequeños y aguas del minero
 *   - fechaMedicion:           YYYY-MM-DD en hora local Chile (UTC-4)
 *   - horaMedicion:            HH24:MI:SS en hora local Chile (UTC-4)
 *   - timeStampOrigen:         hora actual del envío en UTC-4
 *
 * Códigos de retorno (Res 2170 §5.1):
 *   - status "00" → OK, en data.numeroComprobante viene el folio.
 *   - cualquier otro → rechazo. Se reintenta al día siguiente (§6.2).
 */
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';

/** Marca de texto que reemplaza el password en payloads guardados en audit. */
const REDACTED = '****';

export interface SniaSendInput {
  codigoObra: string; // OB-XXXX-XXX
  rutInformante: string; // rutUsuario
  password: string; // descifrado en memoria, NUNCA en audit
  fechaMedicion: string; // YYYY-MM-DD Chile local
  horaMedicion: string; // HH:MM:SS Chile local
  caudal: number | null;
  totalizador: number | null; // entero
  nivelFreatico: number | null;
}

export interface SniaSendResult {
  http_status: number | null;
  dga_status_code: string | null;
  dga_message: string | null;
  numero_comprobante: string | null;
  raw_response: unknown;
  /** Payload enviado con password ofuscado, para guardar en audit. */
  request_payload_redacted: unknown;
  duration_ms: number;
  ok: boolean;
}

/**
 * Formatea timestamp actual a `yyyy-MM-ddTHH:mm:ss-0000` (UTC-4 sin DST).
 * Exigido como header `timeStampOrigen` por SNIA. El offset literal
 * "-0000" en la spec es UTC-4, no UTC.
 *
 * Nota: aunque visualmente confunde, así está documentado en el manual.
 * El "-0000" del manual representa "−04:00 sin minutos", no UTC.
 */
function timestampOrigenChile(now: Date = new Date()): string {
  // Convertir a Chile local (UTC-4) y formatear.
  const utc4Ms = now.getTime() - 4 * 60 * 60 * 1000;
  const d = new Date(utc4Ms);
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}-0000`;
}

/**
 * Construye el body JSON y headers para el POST a SNIA.
 * Aplica todos los formatos requeridos por Res 2170 §4.
 *
 * @throws si rutEmpresa no está configurado (DGA_RUT_EMPRESA env).
 */
export function buildSniaPayload(input: SniaSendInput): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  bodyRedacted: Record<string, unknown>;
} {
  const rutEmpresa = config.dga.rutEmpresa;
  if (!rutEmpresa) {
    throw new Error('DGA_RUT_EMPRESA no configurado (Centro de Control registrado en DGA)');
  }

  const caudalStr = input.caudal == null ? null : input.caudal.toFixed(2);
  // Totalizador: entero sin decimales sin separador, máx 15 chars.
  const totalizadorStr =
    input.totalizador == null ? null : String(Math.trunc(input.totalizador));
  // Nivel freático: vacío permitido (pozos pequeños / minero), enviamos ""
  // en ese caso. Numérico 2 decimales si está presente.
  const nivelStr = input.nivelFreatico == null ? '' : input.nivelFreatico.toFixed(2);

  if (totalizadorStr != null && totalizadorStr.length > 15) {
    throw new Error(
      `totalizador excede 15 caracteres (${totalizadorStr.length}): ${totalizadorStr}`,
    );
  }

  const body = {
    autenticacion: {
      password: input.password,
      rutEmpresa,
      rutUsuario: input.rutInformante,
    },
    medicionSubterranea: {
      caudal: caudalStr,
      fechaMedicion: input.fechaMedicion,
      horaMedicion: input.horaMedicion,
      nivelFreaticoDelPozo: nivelStr,
      totalizador: totalizadorStr,
    },
  };

  // Versión ofuscada para audit. Headers se incluyen bajo _headers para
  // facilitar diagnóstico sin tener que cruzar con logs del worker.
  const bodyRedacted = {
    autenticacion: { ...body.autenticacion, password: REDACTED },
    medicionSubterranea: body.medicionSubterranea,
    _headers: {
      codigoObra: input.codigoObra,
      timeStampOrigen: timestampOrigenChile(),
    },
  };

  return {
    url: config.dga.apiUrl,
    headers: {
      'Content-Type': 'application/json',
      codigoObra: input.codigoObra,
      timeStampOrigen: timestampOrigenChile(),
    },
    body,
    bodyRedacted,
  };
}

interface SniaResponseShape {
  status?: string;
  message?: string;
  data?: { numeroComprobante?: string };
}

/**
 * Envía una medición a SNIA. NO lanza para errores HTTP/protocolo —
 * devuelve un SniaSendResult con ok=false. Solo lanza para errores de
 * configuración (rutEmpresa faltante, totalizador excede 15 chars).
 *
 * Timeout: 15s. SNIA puede tardar varios segundos en validar formato.
 */
export async function sendToSnia(input: SniaSendInput): Promise<SniaSendResult> {
  const { url, headers, body, bodyRedacted } = buildSniaPayload(input);

  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let raw: unknown = null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    httpStatus = response.status;
    raw = await response.json().catch(() => null);

    const parsed = raw as SniaResponseShape | null;
    const dgaStatus = parsed?.status ?? null;
    const comprobante = parsed?.data?.numeroComprobante ?? null;

    const ok = response.ok && dgaStatus === '00';

    if (!ok) {
      logger.warn(
        {
          codigoObra: input.codigoObra,
          fecha: input.fechaMedicion,
          hora: input.horaMedicion,
          httpStatus,
          dgaStatus,
          message: parsed?.message,
        },
        'SNIA rechazó envío',
      );
    }

    return {
      http_status: httpStatus,
      dga_status_code: dgaStatus,
      dga_message: parsed?.message ?? null,
      numero_comprobante: comprobante,
      raw_response: raw,
      request_payload_redacted: bodyRedacted,
      duration_ms: Date.now() - startedAt,
      ok,
    };
  } catch (err) {
    // Error de red, timeout, DNS, certificado, etc. SNIA no recibió o no respondió.
    const msg = (err as Error).message;
    logger.error(
      { codigoObra: input.codigoObra, err: msg },
      'SNIA: fallo de red al enviar',
    );
    return {
      http_status: httpStatus,
      dga_status_code: null,
      dga_message: `network_error: ${msg}`,
      numero_comprobante: null,
      raw_response: raw,
      request_payload_redacted: bodyRedacted,
      duration_ms: Date.now() - startedAt,
      ok: false,
    };
  }
}
