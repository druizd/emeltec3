import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
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
  dga_auto_accept_fallback_hours: number | null;
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
  dga_auto_accept_fallback_hours?: number | null;
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

  /** Headers con X-DGA-2FA-Code para endpoints que lo exigen. */
  private headers2fa(code: string): HttpHeaders {
    return new HttpHeaders({ 'X-DGA-2FA-Code': code });
  }

  // -------- Informantes (pool global) --------

  listInformantes(): Observable<DgaInformantePublic[]> {
    return this.http
      .get<ApiResponse<DgaInformantePublic[]>>('/api/v2/dga/informantes')
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  /**
   * Crea o actualiza un informante. Si `clave_informante` está presente,
   * exige 2FA (header X-DGA-2FA-Code). Otros campos (referencia) sin 2FA.
   */
  upsertInformante(payload: UpsertInformantePayload, twoFactorCode?: string): Observable<DgaInformantePublic> {
    const opts = twoFactorCode ? { headers: this.headers2fa(twoFactorCode) } : {};
    const url = `/api/v2/dga/informantes${payload.rut ? `/${encodeURIComponent(payload.rut)}` : ''}`;
    const method = payload.rut ? 'patch' : 'post';
    const obs =
      method === 'patch'
        ? this.http.patch<ApiResponse<DgaInformantePublic>>(url, payload, opts)
        : this.http.post<ApiResponse<DgaInformantePublic>>(url, payload, opts);
    return obs.pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  deleteInformante(rut: string, twoFactorCode: string): Observable<void> {
    return this.http
      .delete<ApiResponse<{ deleted: true }>>(
        `/api/v2/dga/informantes/${encodeURIComponent(rut)}`,
        { headers: this.headers2fa(twoFactorCode) },
      )
      .pipe(map(() => void 0));
  }

  // -------- Pozo DGA config --------

  getPozoDgaConfig(siteId: string): Observable<PozoDgaConfig | null> {
    return this.http
      .get<ApiResponse<PozoDgaConfig | null>>(
        `/api/v2/dga/sites/${encodeURIComponent(siteId)}/pozo-config`,
      )
      .pipe(map((r) => (r.ok ? r.data : null)));
  }

  /**
   * Patch parcial. Si payload contiene `dga_transport: 'rest'`, el backend
   * exige 2FA (header X-DGA-2FA-Code).
   */
  patchPozoDgaConfig(
    siteId: string,
    payload: PatchPozoDgaConfigPayload,
    twoFactorCode?: string,
  ): Observable<PozoDgaConfig> {
    const opts = twoFactorCode ? { headers: this.headers2fa(twoFactorCode) } : {};
    return this.http
      .patch<ApiResponse<PozoDgaConfig>>(
        `/api/v2/dga/sites/${encodeURIComponent(siteId)}/pozo-config`,
        payload,
        opts,
      )
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  getLivePreview(siteId: string): Observable<DgaLivePreview> {
    return this.http
      .get<ApiResponse<DgaLivePreview>>(
        `/api/v2/dga/sites/${encodeURIComponent(siteId)}/live-preview`,
      )
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  // -------- Mediciones (Detalle de Registros) --------

  consultarDatoBySite(siteId: string, desdeIso: string, hastaIso: string): Observable<DatoDgaRow[]> {
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
  ): string {
    const qs = new URLSearchParams({
      site_id: siteId,
      desde: desdeIso,
      hasta: hastaIso,
      bucket,
    }).toString();
    return `/api/v2/dga/export-directo.csv?${qs}`;
  }

  // -------- 2FA --------

  request2faCode(): Observable<void> {
    return this.http
      .post<ApiResponse<{ sent: true }>>('/api/v2/dga/2fa/request', {})
      .pipe(map(() => void 0));
  }

  // -------- Review queue --------

  listReviewQueue(siteId?: string, limit = 100): Observable<DgaReviewSlot[]> {
    let params = new HttpParams().set('limit', limit);
    if (siteId) params = params.set('site_id', siteId);
    return this.http
      .get<ApiResponse<DgaReviewSlot[]>>('/api/v2/dga/review-queue', { params })
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  applyReviewDecision(
    payload: DgaReviewActionPayload,
    twoFactorCode: string,
  ): Observable<{ ok: true }> {
    return this.http
      .post<ApiResponse<{ ok: true }>>('/api/v2/dga/review-queue/action', payload, {
        headers: this.headers2fa(twoFactorCode),
      })
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }
}
