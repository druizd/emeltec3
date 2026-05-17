/**
 * Service Bitácora del sitio: ficha + equipamiento.
 */
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@emeltec/shared';

export interface FichaContacto {
  nombre: string;
  rol: string;
  telefono?: string | null;
  email?: string | null;
}

export interface FichaAcreditacion {
  persona: string;
  tipo: string;
  vigencia_hasta?: string | null;
}

export interface FichaRiesgo {
  descripcion: string;
  probabilidad?: number | null;
  impacto?: number | null;
  mitigacion?: string | null;
}

export interface FichaSitio {
  pin_critico?: string | null;
  contactos: FichaContacto[];
  acreditaciones: FichaAcreditacion[];
  riesgos: FichaRiesgo[];
}

export type EquipoEstado = 'operativo' | 'en_mantencion' | 'fuera_de_servicio';

export interface SitioEquipo {
  id: string;
  sitio_id: string;
  nombre: string;
  modelo: string | null;
  fabricante: string | null;
  serie: string | null;
  fecha_compra: string | null;
  garantia_hasta: string | null;
  estado: EquipoEstado;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEquipoPayload {
  nombre: string;
  modelo?: string | null;
  fabricante?: string | null;
  serie?: string | null;
  fecha_compra?: string | null;
  garantia_hasta?: string | null;
  estado?: EquipoEstado;
  notas?: string | null;
}

export type PatchEquipoPayload = Partial<CreateEquipoPayload>;

@Injectable({ providedIn: 'root' })
export class BitacoraSitioService {
  private readonly http = inject(HttpClient);

  // ---------- Ficha ----------

  getFicha(siteId: string): Observable<FichaSitio> {
    return this.http
      .get<ApiResponse<FichaSitio>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/bitacora/ficha`,
      )
      .pipe(
        map((r) =>
          r.ok
            ? r.data
            : { pin_critico: null, contactos: [], acreditaciones: [], riesgos: [] },
        ),
      );
  }

  patchFicha(siteId: string, ficha: FichaSitio): Observable<FichaSitio> {
    return this.http
      .patch<ApiResponse<FichaSitio>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/bitacora/ficha`,
        ficha,
      )
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  // ---------- Equipamiento ----------

  listEquipos(siteId: string): Observable<SitioEquipo[]> {
    return this.http
      .get<ApiResponse<SitioEquipo[]>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/bitacora/equipos`,
      )
      .pipe(map((r) => (r.ok ? r.data : [])));
  }

  createEquipo(siteId: string, payload: CreateEquipoPayload): Observable<SitioEquipo> {
    return this.http
      .post<ApiResponse<SitioEquipo>>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/bitacora/equipos`,
        payload,
      )
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  patchEquipo(id: string, payload: PatchEquipoPayload): Observable<SitioEquipo> {
    return this.http
      .patch<ApiResponse<SitioEquipo>>(
        `/api/v2/sites/bitacora/equipos/${encodeURIComponent(id)}`,
        payload,
      )
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  deleteEquipo(id: string): Observable<void> {
    return this.http
      .delete<ApiResponse<{ deleted: true }>>(
        `/api/v2/sites/bitacora/equipos/${encodeURIComponent(id)}`,
      )
      .pipe(map(() => void 0));
  }
}
