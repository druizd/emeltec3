import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

/** Tier mínimo de escalación desde el que un destinatario recibe correos. */
export type UmbralEvento = 't3' | 't6' | 't12';

export interface DigestDestinatario {
  email: string;
  nombre: string | null;
  recibe_resumen: boolean;
  recibe_eventos: boolean;
  /** Alertas de auditoría: cambios de rol y ráfagas de logins fallidos. */
  recibe_seguridad: boolean;
  umbral_evento: UmbralEvento;
  activo: boolean;
  updated_at: string | null;
}

/** Contexto del worker que la pantalla muestra como referencia. */
export interface DigestMeta {
  horarios_resumen: number[];
  zona_horaria: string;
  fallback_email: string;
  worker_activo: boolean;
  max_destinatarios: number;
}

export interface DigestDestinatariosResponse {
  ok: boolean;
  data: DigestDestinatario[];
  meta: DigestMeta;
}

export interface DigestGuardadoResponse {
  ok: boolean;
  data: DigestDestinatario[];
  meta: { fallback_en_uso: boolean; fallback_email: string };
}

export interface DigestPruebaResponse {
  ok: boolean;
  data: { email: string; incidencias_data: number; incidencias_dga: number };
}

/**
 * Destinatarios del monitoreo interno: resumen diario 07:00/16:00 y correos
 * inmediatos de escalación (worker `healthDigest`), más las alertas de auditoría
 * de seguridad (worker `auditAlerts`). Solo SuperAdmin — el backend rechaza
 * cualquier otro rol.
 */
@Injectable({ providedIn: 'root' })
export class HealthDigestService {
  private http = inject(HttpClient);

  list(): Observable<DigestDestinatariosResponse> {
    return this.http.get<DigestDestinatariosResponse>('/api/v2/health-digest/destinatarios');
  }

  /** Reemplaza la lista completa (PUT del set entero, no altas sueltas). */
  save(destinatarios: DigestDestinatario[]): Observable<DigestGuardadoResponse> {
    return this.http.put<DigestGuardadoResponse>('/api/v2/health-digest/destinatarios', {
      destinatarios: destinatarios.map((d) => ({
        email: d.email,
        nombre: d.nombre,
        recibe_resumen: d.recibe_resumen,
        recibe_eventos: d.recibe_eventos,
        recibe_seguridad: d.recibe_seguridad,
        umbral_evento: d.umbral_evento,
        activo: d.activo,
      })),
    });
  }

  /** Manda el resumen con el estado real de este momento a un solo correo. */
  enviarPrueba(email: string): Observable<DigestPruebaResponse> {
    return this.http.post<DigestPruebaResponse>('/api/v2/health-digest/prueba', { email });
  }
}
