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

  createSubCompany(
    companyId: string,
    payload: CreateSubCompanyPayload,
  ): Observable<ApiResponse<SubCompanyNode>> {
    return this.http.post<ApiResponse<SubCompanyNode>>(
      `/api/companies/${companyId}/sub-companies`,
      payload,
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
    payload: Partial<CreateSitePayload>,
  ): Observable<ApiResponse<SiteRecord>> {
    return this.http.patch<ApiResponse<SiteRecord>>(`/api/companies/sites/${siteId}`, payload);
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
