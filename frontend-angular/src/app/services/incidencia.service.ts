import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export type IncidenciaOrigen = 'terreno' | 'remota';
export type IncidenciaCategoria = 'sensor' | 'comunicacion' | 'mecanico' | 'electrico' | 'otro';
export type IncidenciaGravedad = 'leve' | 'media' | 'critica';
export type IncidenciaEstado = 'abierta' | 'en_progreso' | 'resuelta' | 'cerrada';

export interface IncidenciaRow {
  id: number;
  codigo: string;
  sitio_id: string;
  empresa_id: string;
  sub_empresa_id: string | null;
  titulo: string;
  descripcion: string | null;
  origen: IncidenciaOrigen;
  categoria: IncidenciaCategoria;
  gravedad: IncidenciaGravedad;
  estado: IncidenciaEstado;
  tecnico_id: string | null;
  alerta_evento_id: number | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
  cerrado_at: string | null;
  sitio_desc?: string | null;
  empresa_nombre?: string | null;
  tecnico_nombre_completo?: string | null;
  creador_nombre_completo?: string | null;
}

export interface IncidenciaListFilters {
  sitio_id?: string;
  empresa_id?: string;
  estado?: IncidenciaEstado;
  origen?: IncidenciaOrigen;
  categoria?: IncidenciaCategoria;
  gravedad?: IncidenciaGravedad;
  alerta_evento_id?: number;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

export interface CreateIncidenciaPayload {
  sitio_id: string;
  empresa_id: string;
  titulo: string;
  descripcion?: string | null;
  origen?: IncidenciaOrigen;
  categoria?: IncidenciaCategoria;
  gravedad?: IncidenciaGravedad;
  estado?: IncidenciaEstado;
  tecnico_id?: string | null;
  alerta_evento_id?: number | null;
}

export type UpdateIncidenciaPayload = Partial<
  Pick<
    IncidenciaRow,
    | 'titulo'
    | 'descripcion'
    | 'origen'
    | 'categoria'
    | 'gravedad'
    | 'estado'
    | 'tecnico_id'
    | 'alerta_evento_id'
  >
>;

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
  total?: number;
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class IncidenciaService {
  private readonly http = inject(HttpClient);

  listar(filters: IncidenciaListFilters = {}): Observable<IncidenciaRow[]> {
    const qs = new URLSearchParams();
    if (filters.sitio_id) qs.set('sitio_id', filters.sitio_id);
    if (filters.empresa_id) qs.set('empresa_id', filters.empresa_id);
    if (filters.estado) qs.set('estado', filters.estado);
    if (filters.origen) qs.set('origen', filters.origen);
    if (filters.categoria) qs.set('categoria', filters.categoria);
    if (filters.gravedad) qs.set('gravedad', filters.gravedad);
    if (filters.alerta_evento_id) qs.set('alerta_evento_id', String(filters.alerta_evento_id));
    if (filters.desde) qs.set('desde', filters.desde);
    if (filters.hasta) qs.set('hasta', filters.hasta);
    if (filters.page) qs.set('page', String(filters.page));
    if (filters.limit) qs.set('limit', String(filters.limit));
    const url = `/api/incidencias${qs.toString() ? `?${qs}` : ''}`;
    return this.http.get<ApiEnvelope<IncidenciaRow[]>>(url).pipe(map((r) => (r.ok ? r.data : [])));
  }

  obtener(id: number): Observable<IncidenciaRow> {
    return this.http
      .get<ApiEnvelope<IncidenciaRow>>(`/api/incidencias/${id}`)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  crear(payload: CreateIncidenciaPayload): Observable<IncidenciaRow> {
    return this.http
      .post<ApiEnvelope<IncidenciaRow>>('/api/incidencias', payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  actualizar(id: number, payload: UpdateIncidenciaPayload): Observable<IncidenciaRow> {
    return this.http
      .put<ApiEnvelope<IncidenciaRow>>(`/api/incidencias/${id}`, payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  eliminar(id: number): Observable<void> {
    return this.http
      .delete<ApiEnvelope<unknown>>(`/api/incidencias/${id}`)
      .pipe(map(() => undefined));
  }
}

export const ORIGEN_LABELS: Record<IncidenciaOrigen, string> = {
  terreno: 'Terreno',
  remota: 'Remota',
};

export const CATEGORIA_LABELS: Record<IncidenciaCategoria, string> = {
  sensor: 'Sensor',
  comunicacion: 'Comunicación',
  mecanico: 'Mecánico',
  electrico: 'Eléctrico',
  otro: 'Otro',
};

export const GRAVEDAD_LABELS: Record<IncidenciaGravedad, string> = {
  leve: 'Leve',
  media: 'Media',
  critica: 'Crítica',
};

export const ESTADO_LABELS: Record<IncidenciaEstado, string> = {
  abierta: 'Abierta',
  en_progreso: 'En progreso',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
};
