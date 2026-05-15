import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export type AuditTargetType = 'usuario' | 'empresa' | 'alerta' | 'evento' | 'incidencia' | 'sitio';

export interface AuditLogEntry {
  id: number;
  ts: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_tipo: string | null;
  action: string;
  target_type: AuditTargetType | string | null;
  target_id: string | null;
  status_code: number | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  resolved_sitio_id: string | null;
}

export interface AuditLogFilters {
  sitio_id?: string;
  empresa_id?: string;
  target_type?: AuditTargetType;
  action?: string;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
  total?: number;
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly http = inject(HttpClient);

  listar(filters: AuditLogFilters = {}): Observable<AuditLogEntry[]> {
    const qs = new URLSearchParams();
    if (filters.sitio_id) qs.set('sitio_id', filters.sitio_id);
    if (filters.empresa_id) qs.set('empresa_id', filters.empresa_id);
    if (filters.target_type) qs.set('target_type', filters.target_type);
    if (filters.action) qs.set('action', filters.action);
    if (filters.desde) qs.set('desde', filters.desde);
    if (filters.hasta) qs.set('hasta', filters.hasta);
    if (filters.page) qs.set('page', String(filters.page));
    if (filters.limit) qs.set('limit', String(filters.limit));
    const url = `/api/audit-log${qs.toString() ? `?${qs}` : ''}`;
    return this.http.get<ApiEnvelope<AuditLogEntry[]>>(url).pipe(map((r) => (r.ok ? r.data : [])));
  }
}

export const ACCION_VERBO: Record<string, string> = {
  create: 'Creó',
  update: 'Modificó',
  delete: 'Eliminó',
  mutate: 'Modificó',
};

export function describeAccion(action: string): { verbo: string; recurso: string } {
  const [recurso, verbo] = action.split('.');
  return {
    verbo: ACCION_VERBO[verbo] || verbo || action,
    recurso: recurso || 'desconocido',
  };
}
