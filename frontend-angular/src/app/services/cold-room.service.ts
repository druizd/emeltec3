import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ApiResponse } from '@emeltec/shared';

export type ColdRoomRange = '1h' | '6h' | '24h' | '7d';

/** Intervalo de agrupación para el export histórico ('auto' = resolución base). */
export type ColdRoomExportInterval = 'auto' | '1min' | '5min' | '15min' | '1h' | '1d';

export interface ColdRoomExportPoint {
  ts: string;
  sensorId: string;
  area: string;
  tap: string;
  /** Promedio del intervalo. */
  t: number | null;
  tMin: number | null;
  tMax: number | null;
  h: number | null;
  hMin: number | null;
  hMax: number | null;
}

export interface ColdRoomHistoryExportResponse {
  ok: boolean;
  data: { points: ColdRoomExportPoint[] };
  meta: {
    view: string;
    interval?: string;
    rows: number;
    from: string;
    to: string;
    sensorCount: number;
  };
  error?: string;
}

export interface ColdRoomHistPoint {
  t: string;
  v: number;
}

export interface ColdRoomSensor {
  id: string;
  tap: string;
  area: string;
  cx: number;
  cy: number;
  r: number;
  t: number;
  h: number;
  alerted: boolean;
  setpoint: number;
  tMin: number;
  tMax: number;
  lastSeen: string;
  hist: number[];
  histPoints: ColdRoomHistPoint[];
  /** Serie histórica de humedad (mismo eje temporal que histPoints). */
  histHumPoints?: ColdRoomHistPoint[];
  /** True si reg_map.parametros.defective === true. */
  defective?: boolean;
  defectiveReason?: string;
}

export interface ColdRoomSensorsResponse {
  ok: boolean;
  data: ColdRoomSensor[];
  meta?: {
    range: ColdRoomRange;
    count: number;
    serverTime: string;
    source?: string;
    /** Presente solo en modo fecha específica (?date). 'YYYY-MM-DD' día Chile. */
    date?: string;
    /** Inicio de la ventana del día (ISO UTC). */
    from?: string;
    /** Fin de la ventana del día (ISO UTC, exclusivo). */
    to?: string;
  };
  error?: string;
}

export interface ColdRoomSensorHistory {
  id: string;
  area: string;
  tap: string;
  setpoint: number;
  tMin: number;
  tMax: number;
  range: ColdRoomRange;
  temperature: ColdRoomHistPoint[];
  humidity: ColdRoomHistPoint[];
}

export interface ColdRoomConcentratorChannel {
  id: string;
  tap: string;
  area: string;
  online: boolean;
  rssi: number;
  lastSeen: string;
}

export interface ColdRoomConcentrator {
  alerted: boolean;
  lastSeen: string | null;
  uptime?: number;
  online?: number;
  total?: number;
  channels?: ColdRoomConcentratorChannel[];
  firmwareVersion?: string;
  bridgeAddress?: string;
}

export interface ColdRoomBackupSensor {
  id: string;
  area: string;
  tap: string;
  t: number;
  h: number;
  alertaFisica: boolean;
  setpoint: number;
  tMin: number;
  tMax: number;
  lastSeen: string;
  hist: number[];
}

@Injectable({ providedIn: 'root' })
export class ColdRoomService {
  private http = inject(HttpClient);

  getSensors(
    siteId: string,
    tap: string | null,
    range: ColdRoomRange = '24h',
    siteIds?: string[],
    date?: string | null,
  ): Observable<ColdRoomSensorsResponse> {
    const params = new URLSearchParams();
    if (tap) params.set('tap', tap);
    params.set('range', range);
    params.set('t', String(Date.now()));
    if (siteIds && siteIds.length > 0) {
      params.set('siteIds', siteIds.join(','));
    }
    // Modo fecha específica: backend ancla ventana 24h al día Chile, ignora range.
    if (date) {
      params.set('date', date);
    }
    return this.http.get<ColdRoomSensorsResponse>(
      `/api/cold-room/${encodeURIComponent(siteId)}/sensors?${params.toString()}`,
    );
  }

  /**
   * Export histórico custom: rango de fechas + selección de salas/sensores.
   * Backend elige cagg óptimo (1min/5min/hourly/daily) según duración.
   */
  exportHistory(
    siteId: string,
    from: string,
    to: string,
    siteIds: string[],
    sensorIds: string[],
    interval?: ColdRoomExportInterval,
  ): Observable<ColdRoomHistoryExportResponse> {
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    if (siteIds.length > 0) params.set('siteIds', siteIds.join(','));
    if (sensorIds.length > 0) params.set('sensorIds', sensorIds.join(','));
    if (interval) params.set('interval', interval);
    return this.http.get<ColdRoomHistoryExportResponse>(
      `/api/cold-room/${encodeURIComponent(siteId)}/history-export?${params.toString()}`,
    );
  }

  /**
   * Marca/desmarca un sensor como defective (fuera de servicio). Backend persiste
   * en reg_map.parametros y registra audit log. Cliente debe refrescar sensors
   * después para ver el cambio reflejado.
   */
  setSensorDefective(
    siteId: string,
    sensorId: string,
    defective: boolean,
    reason?: string,
  ): Observable<ApiResponse<{ sensorId: string; defective: boolean; reason: string | null }>> {
    return this.http.put<
      ApiResponse<{ sensorId: string; defective: boolean; reason: string | null }>
    >(
      `/api/cold-room/${encodeURIComponent(siteId)}/sensors/${encodeURIComponent(sensorId)}/defective`,
      { defective, reason: reason || null },
    );
  }

  getSensorHistory(
    siteId: string,
    sensorId: string,
    range: ColdRoomRange = '24h',
  ): Observable<ApiResponse<ColdRoomSensorHistory>> {
    const params = new URLSearchParams();
    params.set('range', range);
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<ColdRoomSensorHistory>>(
      `/api/cold-room/${encodeURIComponent(siteId)}/sensors/${encodeURIComponent(sensorId)}/history?${params.toString()}`,
    );
  }

  getConcentrator(siteId: string): Observable<ApiResponse<ColdRoomConcentrator>> {
    const params = new URLSearchParams();
    params.set('tap', 'TAP 1');
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<ColdRoomConcentrator>>(
      `/api/cold-room/${encodeURIComponent(siteId)}/concentrator?${params.toString()}`,
    );
  }

  getBackup(
    siteId: string,
    range: ColdRoomRange = '24h',
  ): Observable<ApiResponse<ColdRoomBackupSensor[]>> {
    const params = new URLSearchParams();
    params.set('tap', 'TAP 1');
    params.set('range', range);
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<ColdRoomBackupSensor[]>>(
      `/api/cold-room/${encodeURIComponent(siteId)}/backup?${params.toString()}`,
    );
  }

  exportCsvUrl(siteId: string, tap: string | null, range: ColdRoomRange = '24h'): string {
    const params = new URLSearchParams();
    if (tap) params.set('tap', tap);
    params.set('range', range);
    params.set('format', 'csv');
    return `/api/cold-room/${encodeURIComponent(siteId)}/export?${params.toString()}`;
  }

  downloadCsv(siteId: string, tap: string | null, range: ColdRoomRange = '24h'): Observable<Blob> {
    return this.http.get(this.exportCsvUrl(siteId, tap, range), { responseType: 'blob' });
  }
}
