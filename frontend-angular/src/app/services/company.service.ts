import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import type {
  ApiResponse,
  Company,
  CompanyNode,
  SiteRecord,
  SiteDashboardData,
  SiteDashboardHistoryEntry,
} from '@emeltec/shared';

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private http = inject(HttpClient);

  companies = signal<Company[]>([]);
  hierarchy = signal<CompanyNode[]>([]);
  selectedSubCompanyId = signal<string | null>(null);
  selectedSiteModuleKey = signal<string | null>(null);
  selectedSiteTypeFilter = signal<string[] | null>(null);
  loading = signal(false);

  fetchCompanies(): Observable<ApiResponse<Company[]>> {
    this.loading.set(true);
    return this.http.get<ApiResponse<Company[]>>('/api/companies').pipe(
      tap((res) => {
        if (res.ok) this.companies.set(res.data);
        this.loading.set(false);
      }),
    );
  }

  fetchHierarchy(): Observable<ApiResponse<CompanyNode[]>> {
    this.loading.set(true);
    return this.http.get<ApiResponse<CompanyNode[]>>(`/api/companies/tree?t=${Date.now()}`).pipe(
      tap((res) => {
        if (res.ok) {
          this.hierarchy.set(res.data);
        }
        this.loading.set(false);
      }),
    );
  }

  getSites(id: string): Observable<ApiResponse<SiteRecord[]>> {
    return this.http.get<ApiResponse<SiteRecord[]>>(`/api/companies/${id}/sites`);
  }

  getSiteDashboardData(siteId: string): Observable<ApiResponse<SiteDashboardData>> {
    return this.http.get<ApiResponse<SiteDashboardData>>(
      `/api/companies/sites/${siteId}/dashboard-data?t=${Date.now()}`,
    );
  }

  getSiteDashboardHistory(
    siteId: string,
    limit = 500,
  ): Observable<ApiResponse<SiteDashboardHistoryEntry[]>> {
    return this.http.get<ApiResponse<SiteDashboardHistoryEntry[]>>(
      `/api/companies/sites/${siteId}/dashboard-history?limit=${limit}&t=${Date.now()}`,
    );
  }

  downloadSiteDashboardHistory(
    siteId: string,
    options: { from: string; to: string; fields: string[]; format: 'csv' },
  ): Observable<HttpResponse<Blob>> {
    return this.http.get(`/api/companies/sites/${siteId}/dashboard-history/export`, {
      observe: 'response',
      responseType: 'blob',
      params: {
        from: options.from,
        to: options.to,
        fields: options.fields.join(','),
        format: options.format,
        t: String(Date.now()),
      },
    });
  }
}
