import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  count?: number;
  message?: string;
  error?: string;
}

export interface CompanyNode {
  id: string;
  nombre: string;
  rut: string;
  tipo_empresa: string;
  subCompanies: SubCompanyNode[];
}

export interface SubCompanyNode {
  id: string;
  nombre: string;
  rut: string;
  empresa_id: string;
  sites: SiteRecord[];
}

export interface SiteRecord {
  id: string;
  descripcion: string;
  empresa_id: string;
  sub_empresa_id: string;
  id_serial: string;
  ubicacion?: string | null;
  tipo_sitio: string;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PozoConfig {
  sitio_id?: string;
  profundidad_pozo_m?: number | null;
  profundidad_sensor_m?: number | null;
  nivel_estatico_manual_m?: number | null;
  obra_dga?: string | null;
  slug?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DetectedDevice {
  id_serial: string;
  total_registros: number;
  ultimo_registro: string;
  sitio_id?: string | null;
  sitio_descripcion?: string | null;
  empresa_id?: string | null;
  empresa_nombre?: string | null;
  sub_empresa_id?: string | null;
  sub_empresa_nombre?: string | null;
}

export interface VariableParameters {
  factor?: number | null;
  offset?: number | null;
  word_order?: string | null;
  formula?: string | null;
}

export interface VariableMapping {
  id: string;
  alias: string;
  d1: string;
  d2?: string | null;
  tipo_dato: string;
  unidad?: string | null;
  sitio_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface SiteVariable {
  nombre_dato: string;
  valor_dato: string | number | boolean | null;
  timestamp_completo: string;
  mapping: VariableMapping | null;
}

export interface SiteVariablesPayload {
  site: SiteRecord;
  pozo_config: PozoConfig | null;
  variables: SiteVariable[];
  mappings: VariableMapping[];
}

export interface CreateCompanyPayload {
  nombre: string;
  rut: string;
  tipo_empresa: string;
}

export interface CreateSubCompanyPayload {
  nombre: string;
  rut: string;
}

export interface CreateSitePayload {
  descripcion: string;
  id_serial: string;
  ubicacion?: string | null;
  tipo_sitio: string;
  activo: boolean;
  pozo_config?: PozoConfig | null;
}

export interface CreateVariableMapPayload {
  alias: string;
  d1: string;
  d2?: string | null;
  tipo_dato: string;
  unidad?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdministrationService {
  private http = inject(HttpClient);

  getHierarchy(): Observable<ApiResponse<CompanyNode[]>> {
    return this.http.get<ApiResponse<CompanyNode[]>>(`/api/companies/tree?t=${Date.now()}`);
  }

  getDetectedDevices(limit = 100): Observable<ApiResponse<DetectedDevice[]>> {
    return this.http.get<ApiResponse<DetectedDevice[]>>(`/api/companies/detected-devices?limit=${limit}`);
  }

  createCompany(payload: CreateCompanyPayload): Observable<ApiResponse<CompanyNode>> {
    return this.http.post<ApiResponse<CompanyNode>>('/api/companies', payload);
  }

  createSubCompany(companyId: string, payload: CreateSubCompanyPayload): Observable<ApiResponse<SubCompanyNode>> {
    return this.http.post<ApiResponse<SubCompanyNode>>(`/api/companies/${companyId}/sub-companies`, payload);
  }

  createSite(companyId: string, subCompanyId: string, payload: CreateSitePayload): Observable<ApiResponse<SiteRecord>> {
    return this.http.post<ApiResponse<SiteRecord>>(
      `/api/companies/${companyId}/sub-companies/${subCompanyId}/sites`,
      payload
    );
  }

  updateSite(siteId: string, payload: Partial<CreateSitePayload>): Observable<ApiResponse<SiteRecord>> {
    return this.http.patch<ApiResponse<SiteRecord>>(`/api/companies/sites/${siteId}`, payload);
  }

  getSiteVariables(siteId: string): Observable<ApiResponse<SiteVariablesPayload>> {
    return this.http.get<ApiResponse<SiteVariablesPayload>>(`/api/companies/sites/${siteId}/variables`);
  }

  createSiteVariableMap(siteId: string, payload: CreateVariableMapPayload): Observable<ApiResponse<VariableMapping>> {
    return this.http.post<ApiResponse<VariableMapping>>(`/api/companies/sites/${siteId}/variables`, payload);
  }

  updateSiteVariableMap(
    siteId: string,
    mapId: string,
    payload: Partial<CreateVariableMapPayload>
  ): Observable<ApiResponse<VariableMapping>> {
    return this.http.patch<ApiResponse<VariableMapping>>(
      `/api/companies/sites/${siteId}/variables/${mapId}`,
      payload
    );
  }

  deleteSiteVariableMap(siteId: string, mapId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`/api/companies/sites/${siteId}/variables/${mapId}`);
  }
}
