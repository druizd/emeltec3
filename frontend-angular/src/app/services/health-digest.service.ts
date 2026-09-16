import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface DigestDestinatario {
  email: string;
  nombre: string | null;
  recibe_resumen: boolean;
  /** Alertas de auditoría: cambios de rol y ráfagas de logins fallidos. */
  recibe_seguridad: boolean;
  activo: boolean;
  updated_at: string | null;
}

/** Contexto del worker que la pantalla muestra como referencia. */
export interface DigestMeta {
  /** Horas de envío del resumen, en hora de pared de Chile. Editables acá. */
  horarios_resumen: number[];
  /** Horas sin transmitir desde las que un equipo entra al resumen. Editable. */
  umbral_horas: number;
  zona_horaria: string;
  fallback_email: string;
  /** Worker healthDigest: el resumen de dos veces al día. */
  worker_activo: boolean;
  /** Worker auditAlerts (bajo retención): alertas de seguridad. Switch aparte. */
  worker_seguridad_activo: boolean;
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

export interface DigestConfigResponse {
  ok: boolean;
  data: { horarios_resumen: number[]; umbral_horas: number };
}

/**
 * Monitoreo interno: el resumen de dos veces al día (worker `healthDigest`) y
 * las alertas de auditoría de seguridad (worker `auditAlerts`, switch aparte).
 * Solo SuperAdmin — el backend rechaza cualquier otro rol.
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
        recibe_seguridad: d.recibe_seguridad,
        activo: d.activo,
      })),
    });
  }

  /** Programación del resumen: horas de envío y umbral de horas sin transmitir. */
  saveConfig(horas: number[], umbralHoras: number): Observable<DigestConfigResponse> {
    return this.http.put<DigestConfigResponse>('/api/v2/health-digest/config', {
      horas,
      umbral_horas: umbralHoras,
    });
  }

  /** Manda el resumen con el estado real de este momento a un solo correo. */
  enviarPrueba(email: string): Observable<DigestPruebaResponse> {
    return this.http.post<DigestPruebaResponse>('/api/v2/health-digest/prueba', { email });
  }
}
