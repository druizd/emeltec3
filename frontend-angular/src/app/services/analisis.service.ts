import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@emeltec/shared';

export interface SensorEstado {
  reg_map_id: string;
  alias: string;
  rol_dashboard: string | null;
  unidad: string | null;
  raw_value: unknown;
  edad_seg: number | null;
}

export interface Gap {
  desde: string;
  hasta: string;
  duracion_min: number;
}

export interface SaludData {
  ultimo_heartbeat: string | null;
  edad_heartbeat_seg: number | null;
  sensores: SensorEstado[];
  gaps: Gap[];
}

export interface MetricaVariable {
  reg_map_id: string;
  alias: string;
  rol_dashboard: string | null;
  unidad: string | null;
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  last: number | null;
}

export interface MetricasData {
  desde: string;
  hasta: string;
  total_lecturas: number;
  variables: MetricaVariable[];
}

export interface ReporteReciente {
  ts: string;
  fecha: string;
  hora: string;
  estatus: string;
  comprobante: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
}

@Injectable({ providedIn: 'root' })
export class AnalisisService {
  private readonly http = inject(HttpClient);

  getSalud(siteId: string): Observable<SaludData> {
    return this.http
      .get<ApiResponse<SaludData>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/analisis/salud`,
      )
      .pipe(
        map((r) =>
          r.ok
            ? r.data
            : { ultimo_heartbeat: null, edad_heartbeat_seg: null, sensores: [], gaps: [] },
        ),
      );
  }

  getMetricas(siteId: string, desdeIso: string, hastaIso: string): Observable<MetricasData> {
    const params = new HttpParams().set('desde', desdeIso).set('hasta', hastaIso);
    return this.http
      .get<ApiResponse<MetricasData>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/analisis/metricas`,
        { params },
      )
      .pipe(
        map((r) =>
          r.ok
            ? r.data
            : { desde: desdeIso, hasta: hastaIso, total_lecturas: 0, variables: [] },
        ),
      );
  }

  getReportesRecientes(siteId: string, limit = 50): Observable<ReporteReciente[]> {
    const params = new HttpParams().set('limit', limit);
    return this.http
      .get<ApiResponse<ReporteReciente[]>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/analisis/reportes`,
        { params },
      )
      .pipe(map((r) => (r.ok ? r.data : [])));
  }
}
