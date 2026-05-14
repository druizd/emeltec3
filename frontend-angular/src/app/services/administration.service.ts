import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ApiResponse,
  CompanyNode,
  CreateCompanyPayload,
  CreateSitePayload,
  CreateSubCompanyPayload,
  CreateVariableMapPayload,
  DetectedDevice,
  SiteRecord,
  SiteTypeCatalogResponse,
  SiteVariablesPayload,
  SubCompanyNode,
  VariableMapping,
} from '@emeltec/shared';

// Re-export para consumidores que aún importan desde este archivo.
// Nuevos consumers deben importar directamente desde '@emeltec/shared'.
export type {
  ApiResponse,
  CompanyNode,
  CreateCompanyPayload,
  CreateSitePayload,
  CreateSubCompanyPayload,
  CreateVariableMapPayload,
  DetectedDevice,
  PozoConfig,
  SiteRecord,
  SiteTypeCatalogItem,
  SiteTypeCatalogResponse,
  SiteTypeRoleOption,
  SiteTypeTransformOption,
  SiteVariable,
  SiteVariablesPayload,
  SubCompanyNode,
  VariableMapping,
  VariableParameters,
} from '@emeltec/shared';

@Injectable({ providedIn: 'root' })
export class AdministrationService {
  private http = inject(HttpClient);

  getHierarchy(): Observable<ApiResponse<CompanyNode[]>> {
    return this.http.get<ApiResponse<CompanyNode[]>>(`/api/companies/tree?t=${Date.now()}`);
  }

  getDetectedDevices(limit = 100): Observable<ApiResponse<DetectedDevice[]>> {
    return this.http.get<ApiResponse<DetectedDevice[]>>(
      `/api/companies/detected-devices?limit=${limit}`,
    );
  }

  getSiteTypeCatalog(): Observable<ApiResponse<SiteTypeCatalogResponse>> {
    return this.http.get<ApiResponse<SiteTypeCatalogResponse>>('/api/companies/site-type-catalog');
  }

  createCompany(payload: CreateCompanyPayload): Observable<ApiResponse<CompanyNode>> {
    return this.http.post<ApiResponse<CompanyNode>>('/api/companies', payload);
  }

  updateCompany(
    companyId: string,
    payload: Partial<CreateCompanyPayload>,
  ): Observable<ApiResponse<CompanyNode>> {
    return this.http.patch<ApiResponse<CompanyNode>>(
      `/api/companies/${encodeURIComponent(companyId)}`,
      payload,
    );
  }

  deleteCompany(companyId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `/api/companies/${encodeURIComponent(companyId)}`,
    );
  }

  createSubCompany(
    companyId: string,
    payload: CreateSubCompanyPayload,
  ): Observable<ApiResponse<SubCompanyNode>> {
    return this.http.post<ApiResponse<SubCompanyNode>>(
      `/api/companies/${companyId}/sub-companies`,
      payload,
    );
  }

  updateSubCompany(
    companyId: string,
    subCompanyId: string,
    payload: Partial<CreateSubCompanyPayload> & { empresa_id?: string },
  ): Observable<ApiResponse<SubCompanyNode>> {
    return this.http.patch<ApiResponse<SubCompanyNode>>(
      `/api/companies/${encodeURIComponent(companyId)}/sub-companies/${encodeURIComponent(subCompanyId)}`,
      payload,
    );
  }

  deleteSubCompany(companyId: string, subCompanyId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `/api/companies/${encodeURIComponent(companyId)}/sub-companies/${encodeURIComponent(subCompanyId)}`,
    );
  }

  createSite(
    companyId: string,
    subCompanyId: string,
    payload: CreateSitePayload,
  ): Observable<ApiResponse<SiteRecord>> {
    return this.http.post<ApiResponse<SiteRecord>>(
      `/api/companies/${companyId}/sub-companies/${subCompanyId}/sites`,
      payload,
    );
  }

  updateSite(
    siteId: string,
    payload: Partial<CreateSitePayload> & { empresa_id?: string; sub_empresa_id?: string },
  ): Observable<ApiResponse<SiteRecord>> {
    return this.http.patch<ApiResponse<SiteRecord>>(
      `/api/companies/sites/${encodeURIComponent(siteId)}`,
      payload,
    );
  }

  deleteSite(siteId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `/api/companies/sites/${encodeURIComponent(siteId)}`,
    );
  }

  getSiteVariables(siteId: string): Observable<ApiResponse<SiteVariablesPayload>> {
    return this.http.get<ApiResponse<SiteVariablesPayload>>(
      `/api/companies/sites/${siteId}/variables`,
    );
  }

  createSiteVariableMap(
    siteId: string,
    payload: CreateVariableMapPayload,
  ): Observable<ApiResponse<VariableMapping>> {
    return this.http.post<ApiResponse<VariableMapping>>(
      `/api/companies/sites/${siteId}/variables`,
      payload,
    );
  }

  updateSiteVariableMap(
    siteId: string,
    mapId: string,
    payload: Partial<CreateVariableMapPayload>,
  ): Observable<ApiResponse<VariableMapping>> {
    return this.http.patch<ApiResponse<VariableMapping>>(
      `/api/companies/sites/${siteId}/variables/${mapId}`,
      payload,
    );
  }

  deleteSiteVariableMap(siteId: string, mapId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `/api/companies/sites/${siteId}/variables/${mapId}`,
    );
  }
}
