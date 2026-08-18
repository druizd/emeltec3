import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export type AlertaCondicion =
  | 'mayor_que'
  | 'menor_que'
  | 'igual_a'
  | 'fuera_rango'
  | 'sin_datos'
  | 'dga_atrasado'
  /**
   * Delta del totalizador dentro del día calendario chileno (acumulado
   * parcial mientras el día transcurre), NO el valor acumulado del contador.
   * A diferencia de `mayor_que`, el umbral va en unidades de ingeniería
   * (m³) porque el delta ya viene transformado por el reg_map.
   */
  | 'consumo_diario';

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
  visible_to_all: boolean;
  viewer_user_ids: string[];
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
  visible_to_all?: boolean;
  viewer_user_ids?: string[];
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
    | 'visible_to_all'
    | 'viewer_user_ids'
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

/** Evento pendiente, tal como lo entrega `/api/resumen` para la campana. */
export interface EventoReciente {
  id: string;
  severidad: AlertaSeveridad;
  mensaje: string;
  triggered_at: string;
  sitio_id: string | null;
  empresa_id: string | null;
  alerta_nombre: string | null;
  sitio_desc: string | null;
  tipo_sitio: string | null;
}

export interface EventosResumen {
  activas: number;
  criticas: number;
  altas: number;
  medias: number;
  bajas: number;
  /** No resueltas y que nadie ha reconocido. Es el número de la campana. */
  sin_revisar: number;
  /** @deprecated Espejo de `sin_revisar`; no existe "leído" por usuario. */
  no_leidas: number;
  /** Las 15 pendientes más recientes, para listar y disparar el popup. */
  recientes: EventoReciente[];
}

const RESUMEN_VACIO: EventosResumen = {
  activas: 0,
  criticas: 0,
  altas: 0,
  medias: 0,
  bajas: 0,
  sin_revisar: 0,
  no_leidas: 0,
  recientes: [],
};

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
    return this.http.get<ApiEnvelope<EventosResumen>>(url).pipe(
      map((r) => {
        if (!r.ok) return RESUMEN_VACIO;
        // El backend devuelve los COUNT como string (node-pg no castea
        // bigint). Sin normalizar, el badge concatenaría en vez de sumar.
        const d = r.data;
        return {
          ...RESUMEN_VACIO,
          ...d,
          activas: Number(d.activas ?? 0),
          criticas: Number(d.criticas ?? 0),
          altas: Number(d.altas ?? 0),
          medias: Number(d.medias ?? 0),
          bajas: Number(d.bajas ?? 0),
          sin_revisar: Number(d.sin_revisar ?? 0),
          no_leidas: Number(d.no_leidas ?? 0),
          recientes: Array.isArray(d.recientes) ? d.recientes : [],
        };
      }),
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
  consumo_diario: 'Consumo del día mayor que',
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
