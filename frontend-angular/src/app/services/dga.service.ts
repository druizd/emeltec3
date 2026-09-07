import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@emeltec/shared';

export type DgaPeriodicidad = 'hora' | 'dia' | 'semana' | 'mes';
export type DgaTransport = 'off' | 'shadow' | 'rest';

// ============================================================================
// Informantes (pool global)
// ============================================================================

export interface DgaInformantePublic {
  rut: string;
  referencia: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertInformantePayload {
  rut: string;
  clave_informante?: string;
  referencia?: string | null;
}

// ============================================================================
// Pozo DGA config
// ============================================================================

export interface PozoDgaConfig {
  sitio_id: string;
  obra_dga: string | null;
  dga_activo: boolean;
  dga_transport: DgaTransport;
  dga_caudal_max_lps: number | null;
  dga_caudal_tolerance_pct: number;
  dga_periodicidad: DgaPeriodicidad | null;
  dga_fecha_inicio: string | null;
  dga_hora_inicio: string | null;
  dga_informante_rut: string | null;
  dga_max_retry_attempts: number;
  dga_gcs_export: boolean;
  dga_last_run_at: string | null;
}

export interface PatchPozoDgaConfigPayload {
  dga_activo?: boolean;
  dga_transport?: DgaTransport;
  dga_caudal_max_lps?: number | null;
  dga_caudal_tolerance_pct?: number;
  dga_periodicidad?: DgaPeriodicidad | null;
  dga_fecha_inicio?: string | null;
  dga_hora_inicio?: string | null;
  dga_informante_rut?: string | null;
  dga_max_retry_attempts?: number;
  dga_gcs_export?: boolean;
}

// ============================================================================
// Verificación post-envío SNIA (Res 2170 §1)
// ============================================================================

export interface DgaVerifyResult {
  status: 'verified' | 'not_found' | 'mismatch' | 'error';
  comprobante: string;
  message: string | null;
  stored: {
    fechaMedicion: string;
    horaMedicion: string;
    caudal: string | null;
    totalizador: string | null;
    nivelFreaticoDelPozo: string | null;
  };
  remote: {
    fechaMedicion: string | null;
    horaMedicion: string | null;
    caudal: string | null;
    totalizador: string | null;
    nivelFreaticoDelPozo: string | null;
  } | null;
  diffs: string[];
  duration_ms: number;
}

// ============================================================================
// Live preview
// ============================================================================

export interface DgaLivePreview {
  ts: string | null;
  age_seconds: number | null;
  fechaMedicion: string | null;
  horaMedicion: string | null;
  caudal: string | null;
  totalizador: string | null;
  nivelFreaticoDelPozo: string;
}

// ============================================================================
// Mediciones
// ============================================================================

export type DgaSlotEstatus =
  | 'vacio'
  | 'pendiente'
  | 'requires_review'
  | 'enviando'
  | 'enviado'
  | 'rechazado'
  | 'fallido';

export interface DatoDgaRow {
  site_id: string;
  obra: string;
  ts: string;
  fecha: string;
  hora: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  estatus: DgaSlotEstatus;
  comprobante: string | null;
}

// ============================================================================
// Review queue
// ============================================================================

export interface DgaValidationWarning {
  code: string;
  raw?: number | null;
  suggested?: number | null;
  limit?: number;
  tolerance_pct?: number;
  reason?: string;
  [k: string]: unknown;
}

/** ApiResponse + el meta que agrega el handler de la cola de revisión. */
interface ReviewQueueEnvelope extends ApiResponse<DgaReviewSlot[]> {
  meta?: { total?: number; sitios?: DgaReviewSite[] };
}

export interface DgaReviewSlot {
  site_id: string;
  ts: string;
  obra: string;
  codigo_obra: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  validation_warnings: DgaValidationWarning[];
  fail_reason: string | null;
  referencia_informante: string | null;
}

/** Sitio del catálogo del filtro. Viene en el meta de la respuesta. */
export interface DgaReviewSite {
  site_id: string;
  codigo_obra: string | null;
  referencia_informante: string | null;
}

export interface DgaReviewFilters {
  siteId?: string | undefined;
  /** ISO 8601 con offset. */
  desde?: string | undefined;
  /** ISO 8601 con offset. */
  hasta?: string | undefined;
  limit?: number | undefined;
}

/**
 * `total` es el conteo SIN el tope, así la página puede distinguir "hay 40"
 * de "hay 340 y estás viendo los primeros 100".
 */
export interface DgaReviewQueuePage {
  slots: DgaReviewSlot[];
  total: number;
  sitios: DgaReviewSite[];
}

export interface DgaReviewActionPayload {
  site_id: string;
  ts: string;
  action: 'accept' | 'discard';
  values?: {
    caudal_instantaneo?: number | null;
    flujo_acumulado?: number | null;
    nivel_freatico?: number | null;
  };
  admin_note: string;
}

/** Conteo por estado de los slots de un rango, previo a una acción en bloque. */
export interface DgaSlotsResumen {
  estados: { estatus: string; total: number }[];
  total: number;
  /** Tope de filas que la acción puede tocar en un solo request. */
  limite: number;
}

export interface DgaBulkSlotActionPayload {
  action: 'recalcular' | 'dar_de_baja';
  desde: string;
  hasta: string;
  nota: string;
}

export interface DgaBulkSlotActionResult {
  action: 'recalcular' | 'dar_de_baja';
  /** Slots efectivamente modificados. */
  afectados: number;
  limite: number;
  /** Conteo por estado ANTES de la acción: explica por qué afectados ≠ total. */
  antes: { estatus: string; total: number }[];
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class DgaService {
  private readonly http = inject(HttpClient);

  // 2FA: manejado globalmente por twoFactorInterceptor (403 TWOFA_REQUIRED →
  // diálogo → reintento con X-2FA-Code). Los métodos NO reciben códigos.

  // -------- Informantes (pool global) --------

  listInformantes(): Observable<DgaInformantePublic[]> {
    return this.http
      .get<ApiResponse<DgaInformantePublic[]>>('/api/v2/dga/informantes')
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  /**
   * Crea o actualiza un informante. Si `clave_informante` está presente,
   * el backend exige 2FA — lo resuelve el interceptor global.
   */
  upsertInformante(payload: UpsertInformantePayload): Observable<DgaInformantePublic> {
    const url = `/api/v2/dga/informantes${payload.rut ? `/${encodeURIComponent(payload.rut)}` : ''}`;
    const obs = payload.rut
      ? this.http.patch<ApiResponse<DgaInformantePublic>>(url, payload)
      : this.http.post<ApiResponse<DgaInformantePublic>>(url, payload);
    return obs.pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  deleteInformante(rut: string): Observable<void> {
    return this.http
      .delete<ApiResponse<{ deleted: true }>>(`/api/v2/dga/informantes/${encodeURIComponent(rut)}`)
      .pipe(map(() => void 0));
  }

  // -------- Pozo DGA config --------

  getPozoDgaConfig(siteId: string): Observable<PozoDgaConfig | null> {
    return this.http
      .get<
        ApiResponse<PozoDgaConfig | null>
      >(`/api/v2/dga/sites/${encodeURIComponent(siteId)}/pozo-config`)
      .pipe(map((r) => (r.ok ? r.data : null)));
  }

  /**
   * Patch parcial. Si payload contiene `dga_transport: 'rest'`, el backend
   * exige 2FA — lo resuelve el interceptor global.
   */
  patchPozoDgaConfig(
    siteId: string,
    payload: PatchPozoDgaConfigPayload,
  ): Observable<PozoDgaConfig> {
    return this.http
      .patch<
        ApiResponse<PozoDgaConfig>
      >(`/api/v2/dga/sites/${encodeURIComponent(siteId)}/pozo-config`, payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  getLivePreview(siteId: string): Observable<DgaLivePreview> {
    return this.http
      .get<
        ApiResponse<DgaLivePreview>
      >(`/api/v2/dga/sites/${encodeURIComponent(siteId)}/live-preview`)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  /**
   * Último envío exitoso a SNIA para el sitio. Independiente del filtro
   * de fecha del UI. Devuelve null si nunca hubo envíos.
   */
  getUltimoEnvio(siteId: string): Observable<{ ts: string; comprobante: string | null } | null> {
    return this.http
      .get<
        ApiResponse<{ ts: string; comprobante: string | null } | null>
      >(`/api/v2/dga/sites/${encodeURIComponent(siteId)}/ultimo-envio`)
      .pipe(map((r) => (r.ok ? r.data : null)));
  }

  /**
   * Verifica vía GET SNIA que un envío previo (audit OK) quedó registrado
   * en MEE-DGA (Res 2170 §1). Compara datos guardados vs los devueltos.
   * Estado posible: 'verified' | 'not_found' | 'mismatch' | 'error'.
   */
  verifySnia(siteId: string, ts: string): Observable<DgaVerifyResult | null> {
    const params = new HttpParams().set('ts', ts);
    return this.http
      .get<
        ApiResponse<DgaVerifyResult>
      >(`/api/v2/dga/sites/${encodeURIComponent(siteId)}/verify`, { params })
      .pipe(map((r) => (r.ok ? r.data : null)));
  }

  // -------- Mediciones (Detalle de Registros) --------

  consultarDatoBySite(
    siteId: string,
    desdeIso: string,
    hastaIso: string,
  ): Observable<DatoDgaRow[]> {
    const params = new HttpParams()
      .set('site_id', siteId)
      .set('desde', desdeIso)
      .set('hasta', hastaIso);
    return this.http
      .get<ApiResponse<DatoDgaRow[]>>('/api/v2/dga/dato', { params })
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  exportCsvUrlBySite(siteId: string, desdeIso: string, hastaIso: string): string {
    const qs = new URLSearchParams({
      site_id: siteId,
      desde: desdeIso,
      hasta: hastaIso,
    }).toString();
    return `/api/v2/dga/dato/export.csv?${qs}`;
  }

  exportCsvUrlDirecto(
    siteId: string,
    desdeIso: string,
    hastaIso: string,
    bucket: 'minuto' | 'hora' | 'dia' | 'semana' | 'mes' = 'hora',
    orden: 'asc' | 'desc' = 'asc',
  ): string {
    const qs = new URLSearchParams({
      site_id: siteId,
      desde: desdeIso,
      hasta: hastaIso,
      bucket,
      orden,
    }).toString();
    return `/api/v2/dga/export-directo.csv?${qs}`;
  }

  // -------- Review queue --------

  listReviewQueue(filters: DgaReviewFilters = {}): Observable<DgaReviewQueuePage> {
    let params = new HttpParams().set('limit', filters.limit ?? 100);
    if (filters.siteId) params = params.set('site_id', filters.siteId);
    if (filters.desde) params = params.set('desde', filters.desde);
    if (filters.hasta) params = params.set('hasta', filters.hasta);
    return this.http.get<ReviewQueueEnvelope>('/api/v2/dga/review-queue', { params }).pipe(
      map((r) => ({
        slots: r.ok ? r.data : [],
        // Sin meta (respuesta vieja en caché o backend previo) el largo de la
        // página es el mejor total disponible: nunca sub-reporta lo visible.
        total: r.meta?.total ?? (r.ok ? r.data.length : 0),
        sitios: r.meta?.sitios ?? [],
      })),
    );
  }

  applyReviewDecision(payload: DgaReviewActionPayload): Observable<{ ok: true }> {
    return this.http
      .post<ApiResponse<{ ok: true }>>('/api/v2/dga/review-queue/action', payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  /**
   * Reconoce el totalizador del sitio como defectuoso: marca el sensor
   * (los slots futuros fluyen con incidencia registrada), crea una
   * incidencia abierta en la bitácora y acepta el backlog retenido solo
   * por anomalías del totalizador.
   */
  reconocerSensorDefectuoso(
    siteId: string,
    nota: string,
  ): Observable<{ incidencia_id: number; slots_aceptados: number }> {
    return this.http
      .post<
        ApiResponse<{ incidencia_id: number; slots_aceptados: number }>
      >(`/api/v2/dga/sites/${siteId}/reconocer-sensor-defectuoso`, { nota })
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  /**
   * Conteo por estado de los slots del rango. Precede a una acción en bloque
   * para que no se aplique a ciegas: es lectura, no pide 2FA.
   */
  slotsResumen(siteId: string, desdeIso: string, hastaIso: string): Observable<DgaSlotsResumen> {
    const qs = new URLSearchParams({ desde: desdeIso, hasta: hastaIso }).toString();
    return this.http
      .get<ApiResponse<DgaSlotsResumen>>(`/api/v2/dga/sites/${siteId}/slots/resumen?${qs}`)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  /**
   * Acción en bloque sobre un rango de slots.
   *
   * `recalcular` los devuelve a `vacio` para que el fill los recompute con la
   * config actual del reg_map; `dar_de_baja` los cierra como fallido con la
   * nota. Nunca toca `enviado` ni `enviando`.
   *
   * Exige 2FA en el backend: el interceptor global orquesta el step-up solo,
   * así que acá no hay nada que manejar.
   */
  bulkSlotAction(
    siteId: string,
    payload: DgaBulkSlotActionPayload,
  ): Observable<DgaBulkSlotActionResult> {
    return this.http
      .post<ApiResponse<DgaBulkSlotActionResult>>(`/api/v2/dga/sites/${siteId}/slots/bulk`, payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }
}
