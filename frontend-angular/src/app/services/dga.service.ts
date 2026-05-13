import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@emeltec/shared';

export type DgaPeriodicidad = 'hora' | 'dia' | 'semana' | 'mes';

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
  created_at: string;
  updated_at: string;
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

export interface DatoDgaRow {
  id_dgauser: string;
  obra: string;
  ts: string;
  fecha: string;
  hora: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
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

  consultarDato(idDgaUser: string, desdeIso: string, hastaIso: string): Observable<DatoDgaRow[]> {
    const params = new HttpParams()
      .set('id_dgauser', idDgaUser)
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
