import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export type AlertaCondicion =
  | 'mayor_que'
  | 'menor_que'
  | 'igual_a'
  | 'fuera_rango'
  | 'sin_datos'
  | 'dga_atrasado';

export type AlertaSeveridad = 'baja' | 'media' | 'alta' | 'critica';

export type AlertaDia =
  | 'lunes'
  | 'martes'
  | 'miercoles'
  | 'jueves'
  | 'viernes'
  | 'sabado'
  | 'domingo';

export interface AlertaRow {
  id: number;
  nombre: string;
  descripcion: string | null;
  sitio_id: string;
  empresa_id: string;
  sub_empresa_id: string | null;
  variable_key: string;
  condicion: AlertaCondicion;
  umbral_bajo: number | null;
  umbral_alto: number | null;
  severidad: AlertaSeveridad;
  activa: boolean;
  cooldown_minutos: number;
  dias_activos: AlertaDia[];
  creado_por: string | null;
  created_at: string;
  updated_at: string;
  sitio_desc?: string;
  id_serial?: string;
  empresa_nombre?: string;
}

export interface CreateAlertaPayload {
  nombre: string;
  descripcion?: string | null;
  sitio_id: string;
  empresa_id: string;
  variable_key: string;
  condicion: AlertaCondicion;
  umbral_bajo?: number | null;
  umbral_alto?: number | null;
  severidad?: AlertaSeveridad;
  cooldown_minutos?: number;
  dias_activos?: AlertaDia[];
}

export type UpdateAlertaPayload = Partial<
  Pick<
    AlertaRow,
    | 'nombre'
    | 'descripcion'
    | 'variable_key'
    | 'condicion'
    | 'umbral_bajo'
    | 'umbral_alto'
    | 'severidad'
    | 'cooldown_minutos'
    | 'dias_activos'
    | 'activa'
  >
>;

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
}

interface PaginatedEnvelope<T> extends ApiEnvelope<T> {
  total?: number;
  page?: number;
  limit?: number;
}

export type EventoEstado = 'activa' | 'reconocida' | 'asignada' | 'resuelta';

export interface EventoRow {
  id: number;
  alerta_id: number;
  empresa_id: string;
  sub_empresa_id: string | null;
  sitio_id: string;
  variable_key: string;
  valor_detectado: number | null;
  valor_texto: string | null;
  mensaje: string;
  severidad: AlertaSeveridad;
  notificado: boolean;
  resuelta: boolean;
  reconocida_at: string | null;
  reconocida_por: string | null;
  asignado_a: string | null;
  asignado_at: string | null;
  incidencia_id: string | null;
  triggered_at: string;
  resuelta_at: string | null;
  estado: EventoEstado;
  alerta_nombre?: string;
  condicion?: AlertaCondicion;
  sitio_desc?: string;
  id_serial?: string;
  empresa_nombre?: string;
  asignado_nombre_completo?: string | null;
  reconocido_nombre?: string | null;
  reconocido_apellido?: string | null;
}

export interface EventosResumen {
  activas: number;
  criticas: number;
  altas: number;
  medias: number;
  bajas: number;
  no_leidas: number;
}

export interface EventoListFilters {
  empresa_id?: string;
  sitio_id?: string;
  severidad?: AlertaSeveridad;
  resuelta?: boolean;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class AlertaService {
  private readonly http = inject(HttpClient);

  listar(
    filters: { sitio_id?: string; empresa_id?: string; activa?: boolean } = {},
  ): Observable<AlertaRow[]> {
    const qs = new URLSearchParams();
    if (filters.sitio_id) qs.set('sitio_id', filters.sitio_id);
    if (filters.empresa_id) qs.set('empresa_id', filters.empresa_id);
    if (filters.activa !== undefined) qs.set('activa', String(filters.activa));
    const url = `/api/alertas${qs.toString() ? `?${qs}` : ''}`;
    return this.http.get<ApiEnvelope<AlertaRow[]>>(url).pipe(map((r) => (r.ok ? r.data : [])));
  }

  crear(payload: CreateAlertaPayload): Observable<AlertaRow> {
    return this.http
      .post<ApiEnvelope<AlertaRow>>('/api/alertas', payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  actualizar(id: number, payload: UpdateAlertaPayload): Observable<AlertaRow> {
    return this.http
      .put<ApiEnvelope<AlertaRow>>(`/api/alertas/${id}`, payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  eliminar(id: number): Observable<void> {
    return this.http.delete<ApiEnvelope<unknown>>(`/api/alertas/${id}`).pipe(map(() => undefined));
  }

  listarEventos(filters: EventoListFilters = {}): Observable<EventoRow[]> {
    const qs = new URLSearchParams();
    if (filters.empresa_id) qs.set('empresa_id', filters.empresa_id);
    if (filters.sitio_id) qs.set('sitio_id', filters.sitio_id);
    if (filters.severidad) qs.set('severidad', filters.severidad);
    if (filters.resuelta !== undefined) qs.set('resuelta', String(filters.resuelta));
    if (filters.desde) qs.set('desde', filters.desde);
    if (filters.hasta) qs.set('hasta', filters.hasta);
    if (filters.page) qs.set('page', String(filters.page));
    if (filters.limit) qs.set('limit', String(filters.limit));
    const url = `/api/eventos${qs.toString() ? `?${qs}` : ''}`;
    return this.http
      .get<PaginatedEnvelope<EventoRow[]>>(url)
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  reconocerEvento(id: number): Observable<EventoRow> {
    return this.http
      .put<ApiEnvelope<EventoRow>>(`/api/eventos/${id}/reconocer`, {})
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  asignarEvento(id: number, asignadoA: string): Observable<EventoRow> {
    return this.http
      .put<ApiEnvelope<EventoRow>>(`/api/eventos/${id}/asignar`, { asignado_a: asignadoA })
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  resolverEvento(id: number): Observable<EventoRow> {
    return this.http
      .put<ApiEnvelope<EventoRow>>(`/api/eventos/${id}/resolver`, {})
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  vincularIncidencia(id: number, incidenciaId: string): Observable<EventoRow> {
    return this.http
      .put<ApiEnvelope<EventoRow>>(`/api/eventos/${id}/incidencia`, {
        incidencia_id: incidenciaId,
      })
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  resumen(filters: { empresa_id?: string; sitio_id?: string } = {}): Observable<EventosResumen> {
    const qs = new URLSearchParams();
    if (filters.empresa_id) qs.set('empresa_id', filters.empresa_id);
    if (filters.sitio_id) qs.set('sitio_id', filters.sitio_id);
    const url = `/api/resumen${qs.toString() ? `?${qs}` : ''}`;
    return this.http
      .get<ApiEnvelope<EventosResumen>>(url)
      .pipe(
        map((r) =>
          r.ok ? r.data : { activas: 0, criticas: 0, altas: 0, medias: 0, bajas: 0, no_leidas: 0 },
        ),
      );
  }
}

export const CONDICION_LABELS: Record<AlertaCondicion, string> = {
  mayor_que: 'Mayor que',
  menor_que: 'Menor que',
  igual_a: 'Igual a',
  fuera_rango: 'Fuera de rango',
  sin_datos: 'Sin datos',
  dga_atrasado: 'Reporte DGA atrasado',
};

export const SEVERIDAD_LABELS: Record<AlertaSeveridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
};

export const DIAS_ORDEN: AlertaDia[] = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
];

export const DIAS_SHORT: Record<AlertaDia, string> = {
  lunes: 'Lu',
  martes: 'Ma',
  miercoles: 'Mi',
  jueves: 'Ju',
  viernes: 'Vi',
  sabado: 'Sá',
  domingo: 'Do',
};
