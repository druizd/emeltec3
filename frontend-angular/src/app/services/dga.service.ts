import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@emeltec/shared';

export type DgaPeriodicidad = 'hora' | 'dia' | 'semana' | 'mes';

/**
 * Modo de envío DGA por informante.
 *   off    — pausado, no rellena ni envía
 *   shadow — rellena slots y compara contra legacy, no envía a SNIA
 *   rest   — envía a SNIA via endpoint REST oficial (Res 2170)
 */
export type DgaTransport = 'off' | 'shadow' | 'rest';

export interface DgaUserPublic {
  id_dgauser: string;
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  periodicidad: DgaPeriodicidad;
  fecha_inicio: string;
  hora_inicio: string;
  last_run_at: string | null;
  activo: boolean;
  transport: DgaTransport;
  /** Caudal máximo legal L/s desde derecho de aprovechamiento. null = sin cargar. */
  caudal_max_lps: number | null;
  /** % sobre caudal_max_lps antes de marcar slot como requires_review. */
  caudal_tolerance_pct: number;
  max_retry_attempts: number;
  created_at: string;
  updated_at: string;
}

/** Patch parcial de config DGA — solo se envían los campos que se modifican. */
export interface PatchDgaUserConfigPayload {
  activo?: boolean;
  transport?: DgaTransport;
  caudal_max_lps?: number | null;
  caudal_tolerance_pct?: number;
}

export interface CreateDgaUserPayload {
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  clave_informante: string;
  periodicidad: DgaPeriodicidad;
  fecha_inicio: string; // YYYY-MM-DD
  hora_inicio: string; // HH:MM
}

export type DgaSlotEstatus =
  | 'vacio'
  | 'pendiente'
  | 'requires_review'
  | 'enviando'
  | 'enviado'
  | 'rechazado'
  | 'fallido';

export interface DatoDgaRow {
  id_dgauser: string;
  obra: string;
  ts: string;
  fecha: string;
  hora: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  estatus: DgaSlotEstatus;
  /** numeroComprobante SNIA cuando estatus='enviado'. */
  comprobante: string | null;
}

export interface DgaValidationWarning {
  code: string;
  raw?: number | null;
  suggested?: number | null;
  limit?: number;
  tolerance_pct?: number;
  reason?: string;
  [k: string]: unknown;
}

/** Slot en cola de revisión manual (estatus='requires_review'). */
export interface DgaReviewSlot {
  id_dgauser: string;
  ts: string;
  site_id: string;
  obra: string;
  codigo_obra: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  validation_warnings: DgaValidationWarning[];
  fail_reason: string | null;
  nombre_informante: string;
}

export interface DgaReviewActionPayload {
  id_dgauser: number;
  ts: string;
  action: 'accept' | 'discard';
  values?: {
    caudal_instantaneo?: number | null;
    flujo_acumulado?: number | null;
    nivel_freatico?: number | null;
  };
  admin_note: string;
}

export interface DgaApiReport {
  obra: string | null;
  fecha: string; // DD-MM-YYYY (hora Chile)
  hora: string; // H:MM:SS (hora Chile)
  caudalInstantaneo: number | null;
  flujoAcumulado: number | null;
  nivelFreatico: number | null;
  estatus: 'pendiente' | 'enviado' | 'rechazado';
  comprobante: string | null;
}

@Injectable({ providedIn: 'root' })
export class DgaService {
  private readonly http = inject(HttpClient);

  crearInformante(payload: CreateDgaUserPayload): Observable<DgaUserPublic> {
    return this.http
      .post<ApiResponse<DgaUserPublic>>('/api/v2/dga/users', payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  listarPorSitio(siteId: string): Observable<DgaUserPublic[]> {
    return this.http
      .get<ApiResponse<DgaUserPublic[]>>(`/api/v2/dga/users/${encodeURIComponent(siteId)}`)
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  /**
   * Patch parcial de config DGA del informante. Usado por la UI para
   * activar/pausar, cambiar transport (off/shadow/rest) o cargar el
   * caudal máximo legal.
   *
   * Importante: pasar de transport='off'/'shadow' → 'rest' significa
   * comenzar a enviar a SNIA en producción. La UI debe pedir
   * confirmación explícita antes de hacer ese cambio.
   */
  patchConfig(idDgaUser: string, payload: PatchDgaUserConfigPayload): Observable<DgaUserPublic> {
    return this.http
      .patch<ApiResponse<DgaUserPublic>>(
        `/api/v2/dga/users/${encodeURIComponent(idDgaUser)}/config`,
        payload,
      )
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  /**
   * Solicita un código 2FA al backend; se envía por email al admin
   * configurado (MONITOR_PRIMARY_EMAIL). Sin retorno (el código no viaja
   * en la respuesta HTTP).
   */
  request2faCode(): Observable<void> {
    return this.http
      .post<ApiResponse<{ sent: true }>>('/api/v2/dga/2fa/request', {})
      .pipe(map(() => void 0));
  }

  /**
   * Lista los slots en estatus='requires_review'. Filtro opcional por sitio.
   * Requiere rol Admin/SuperAdmin (gating en backend).
   */
  listReviewQueue(siteId?: string, limit = 100): Observable<DgaReviewSlot[]> {
    let params = new HttpParams().set('limit', limit);
    if (siteId) params = params.set('site_id', siteId);
    return this.http
      .get<ApiResponse<DgaReviewSlot[]>>('/api/v2/dga/review-queue', { params })
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  /**
   * Aplica una decisión admin sobre un slot. Requiere 2FA: el código va
   * en el header X-DGA-2FA-Code. Si action='accept', `values` define los
   * datos finales que se enviarán a SNIA.
   */
  applyReviewDecision(
    payload: DgaReviewActionPayload,
    twoFactorCode: string,
  ): Observable<{ ok: true }> {
    return this.http
      .post<ApiResponse<{ ok: true }>>('/api/v2/dga/review-queue/action', payload, {
        headers: { 'X-DGA-2FA-Code': twoFactorCode },
      })
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  consultarDato(idDgaUser: string, desdeIso: string, hastaIso: string): Observable<DatoDgaRow[]> {
    const params = new HttpParams()
      .set('id_dgauser', idDgaUser)
      .set('desde', desdeIso)
      .set('hasta', hastaIso);
    return this.http
      .get<ApiResponse<DatoDgaRow[]>>('/api/v2/dga/dato', { params })
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  /**
   * Lista los slots persistidos en `dato_dga` para un sitio en un rango.
   * Fuente de verdad para "Detalle de Registros" en la vista pozo: trae
   * estatus real del pipeline (vacio/pendiente/enviado/rechazado/etc.)
   * + comprobante SNIA cuando aplica.
   */
  consultarDatoBySite(siteId: string, desdeIso: string, hastaIso: string): Observable<DatoDgaRow[]> {
    const params = new HttpParams()
      .set('site_id', siteId)
      .set('desde', desdeIso)
      .set('hasta', hastaIso);
    return this.http
      .get<ApiResponse<DatoDgaRow[]>>('/api/v2/dga/dato', { params })
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  exportCsvUrl(idDgaUser: string, desdeIso: string, hastaIso: string): string {
    const qs = new URLSearchParams({
      id_dgauser: idDgaUser,
      desde: desdeIso,
      hasta: hastaIso,
    }).toString();
    return `/api/v2/dga/dato/export.csv?${qs}`;
  }

  exportCsvUrlBySite(siteId: string, desdeIso: string, hastaIso: string): string {
    const qs = new URLSearchParams({
      site_id: siteId,
      desde: desdeIso,
      hasta: hastaIso,
    }).toString();
    return `/api/v2/dga/dato/export.csv?${qs}`;
  }

  /**
   * Descarga manual directa: arma CSV DGA leyendo `equipo` al vuelo.
   * No depende de informantes ni de dato_dga.
   * bucket = granularidad de agregación (1 fila por bucket).
   */
  getReportsBySite(
    sitioId: string,
    from?: string,
    to?: string,
    page = 1,
    pageSize = 500,
  ): Observable<{ items: DgaApiReport[]; total: number }> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http
      .get<{
        ok: boolean;
        data: DgaApiReport[];
        meta: { total: number };
      }>(`/api/dga/sites/${encodeURIComponent(sitioId)}/reports`, { params })
      .pipe(map((r) => (r.ok ? { items: r.data, total: r.meta.total } : { items: [], total: 0 })));
  }

  exportCsvUrlDirecto(
    siteId: string,
    desdeIso: string,
    hastaIso: string,
    bucket: 'minuto' | 'hora' | 'dia' | 'semana' | 'mes' = 'hora',
  ): string {
    const qs = new URLSearchParams({
      site_id: siteId,
      desde: desdeIso,
      hasta: hastaIso,
      bucket,
    }).toString();
    return `/api/v2/dga/export-directo.csv?${qs}`;
  }
}
