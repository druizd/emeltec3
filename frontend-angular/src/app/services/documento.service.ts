import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export type DocumentoTipo =
  | 'ficha_tecnica'
  | 'datasheet'
  | 'certificado'
  | 'manual'
  | 'plano'
  | 'otro';

export interface DocumentoRow {
  id: number;
  sitio_id: string;
  empresa_id: string;
  sub_empresa_id: string | null;
  titulo: string;
  tipo: DocumentoTipo;
  descripcion: string | null;
  blob_path: string;
  nombre_original: string;
  mime: string;
  size_bytes: number;
  version: string | null;
  fecha_vigencia: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  sitio_desc?: string | null;
  uploader_nombre_completo?: string | null;
}

export interface DocumentoListFilters {
  sitio_id?: string;
  empresa_id?: string;
  tipo?: DocumentoTipo;
  page?: number;
  limit?: number;
}

export interface UploadDocumentoPayload {
  file: File;
  sitio_id: string;
  empresa_id: string;
  titulo: string;
  tipo?: DocumentoTipo;
  descripcion?: string | null;
  version?: string;
  fecha_vigencia?: string | null;
}

export type UpdateDocumentoPayload = Partial<
  Pick<DocumentoRow, 'titulo' | 'tipo' | 'descripcion' | 'version' | 'fecha_vigencia'>
>;

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
  total?: number;
  page?: number;
  limit?: number;
}

interface DownloadResponse {
  url: string;
  expires_in_min: number;
}

@Injectable({ providedIn: 'root' })
export class DocumentoService {
  private readonly http = inject(HttpClient);

  listar(filters: DocumentoListFilters = {}): Observable<DocumentoRow[]> {
    const qs = new URLSearchParams();
    if (filters.sitio_id) qs.set('sitio_id', filters.sitio_id);
    if (filters.empresa_id) qs.set('empresa_id', filters.empresa_id);
    if (filters.tipo) qs.set('tipo', filters.tipo);
    if (filters.page) qs.set('page', String(filters.page));
    if (filters.limit) qs.set('limit', String(filters.limit));
    const url = `/api/documentos${qs.toString() ? `?${qs}` : ''}`;
    return this.http.get<ApiEnvelope<DocumentoRow[]>>(url).pipe(map((r) => (r.ok ? r.data : [])));
  }

  subir(payload: UploadDocumentoPayload): Observable<DocumentoRow> {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('sitio_id', payload.sitio_id);
    form.append('empresa_id', payload.empresa_id);
    form.append('titulo', payload.titulo);
    if (payload.tipo) form.append('tipo', payload.tipo);
    if (payload.descripcion) form.append('descripcion', payload.descripcion);
    if (payload.version) form.append('version', payload.version);
    if (payload.fecha_vigencia) form.append('fecha_vigencia', payload.fecha_vigencia);
    return this.http
      .post<ApiEnvelope<DocumentoRow>>('/api/documentos', form)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  actualizar(id: number, payload: UpdateDocumentoPayload): Observable<DocumentoRow> {
    return this.http
      .put<ApiEnvelope<DocumentoRow>>(`/api/documentos/${id}`, payload)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }

  eliminar(id: number): Observable<void> {
    return this.http
      .delete<ApiEnvelope<unknown>>(`/api/documentos/${id}`)
      .pipe(map(() => undefined));
  }

  /**
   * Solicita una SAS URL temporal y dispara la descarga abriendo en nueva pestaña.
   */
  descargar(id: number): Observable<DownloadResponse> {
    return this.http
      .get<ApiEnvelope<DownloadResponse>>(`/api/documentos/${id}/download`)
      .pipe(map((r) => (r.ok ? r.data : (Promise.reject(r) as never))));
  }
}

export const TIPO_LABELS: Record<DocumentoTipo, string> = {
  ficha_tecnica: 'Ficha técnica',
  datasheet: 'Datasheet',
  certificado: 'Certificado',
  manual: 'Manual',
  plano: 'Plano',
  otro: 'Otro',
};

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
