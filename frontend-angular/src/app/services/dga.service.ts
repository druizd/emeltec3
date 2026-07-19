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

  listReviewQueue(siteId?: string, limit = 100): Observable<DgaReviewSlot[]> {
    let params = new HttpParams().set('limit', limit);
    if (siteId) params = params.set('site_id', siteId);
    return this.http
      .get<ApiResponse<DgaReviewSlot[]>>('/api/v2/dga/review-queue', { params })
      .pipe(map((r) => (r.ok ? r.data : [])));
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
}
