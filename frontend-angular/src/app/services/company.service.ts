import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AuthService } from './auth.service';
import type { ViewAsContext } from './auth.service';
import type {
  ApiResponse,
  Company,
  CompanyNode,
  CreateOperationalContactPayload,
  OperationalContact,
  SiteRecord,
  SiteDashboardData,
  SiteDashboardHistoryEntry,
} from '@emeltec/shared';

export interface ContadorMensualPoint {
  mes: string;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  ultimo_dato: string | null;
  resets_detectados: number;
  proyeccion?: number | null;
}

export interface ContadorDiarioPoint {
  dia: string;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  ultimo_dato: string | null;
  resets_detectados: number;
}

export interface ContadorJornadaPoint {
  dia: string;
  inicio: string;
  fin: string;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  ultimo_dato: string | null;
  resets_detectados: number;
}

export interface SiteOperacionTurno {
  nombre: string;
  inicio: string;
  fin: string;
}

export interface SiteOperacionConfig {
  sitio_id: string;
  num_turnos: 2 | 3;
  turnos: SiteOperacionTurno[];
  jornada_inicio: string;
  jornada_fin: string;
  updated_at: string;
}

export type HistoryGranularity = '1m' | '1h' | '1d';

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  companies = signal<Company[]>([]);
  hierarchy = signal<CompanyNode[]>([]);
  visibleHierarchy = computed<CompanyNode[]>(() =>
    this.applyPreviewScope(this.hierarchy(), this.auth.viewAsContext()),
  );
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

  getOperationalContacts(filters: {
    empresa_id?: string;
    sub_empresa_id?: string;
  }): Observable<ApiResponse<OperationalContact[]>> {
    const params = new URLSearchParams();
    if (filters.empresa_id) params.set('empresa_id', filters.empresa_id);
    if (filters.sub_empresa_id) params.set('sub_empresa_id', filters.sub_empresa_id);
    return this.http.get<ApiResponse<OperationalContact[]>>(
      `/api/companies/contacts?${params.toString()}`,
    );
  }

  createOperationalContact(
    payload: CreateOperationalContactPayload,
  ): Observable<ApiResponse<OperationalContact>> {
    return this.http.post<ApiResponse<OperationalContact>>('/api/companies/contacts', payload);
  }

  deleteOperationalContact(contactId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `/api/companies/contacts/${encodeURIComponent(contactId)}`,
    );
  }

  getSiteDashboardData(siteId: string): Observable<ApiResponse<SiteDashboardData>> {
    return this.http.get<ApiResponse<SiteDashboardData>>(
      `/api/companies/sites/${siteId}/dashboard-data?t=${Date.now()}`,
    );
  }

  getSiteDashboardHistory(
    siteId: string,
    limit = 500,
    options: { from?: string; to?: string; granularity?: HistoryGranularity; page?: number } = {},
  ): Observable<ApiResponse<SiteDashboardHistoryEntry[]>> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (options.page) params.set('page', String(options.page));
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    if (options.granularity) params.set('granularity', options.granularity);
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<SiteDashboardHistoryEntry[]>>(
      `/api/companies/sites/${siteId}/dashboard-history?${params.toString()}`,
    );
  }

  /**
   * Endpoint bundle para el primer paint de Operación: dashboard + history
   * en 1 round-trip + dedupe de queries pozo_config / reg_map del backend.
   * Solo cubre el caso realtime (sin range). Para navegación por día usar
   * `getSiteDashboardData` + `getSiteDashboardHistory` por separado.
   */
  getSiteOperacionBundle(
    siteId: string,
    limit = 2200,
  ): Observable<
    ApiResponse<{
      dashboard: SiteDashboardData;
      history: { rows: SiteDashboardHistoryEntry[] };
      server_time: string;
    }>
  > {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('t', String(Date.now()));
    return this.http.get<
      ApiResponse<{
        dashboard: SiteDashboardData;
        history: { rows: SiteDashboardHistoryEntry[] };
        server_time: string;
      }>
    >(`/api/companies/sites/${siteId}/operacion-bundle?${params.toString()}`);
  }

  getSitePeriodAggregates(
    siteId: string,
    desde: string,
    hasta: string,
  ): Observable<
    ApiResponse<{
      caudal: { max: number | null; avg: number | null; n: number; unidad: string | null };
      nivel: { max: number | null; avg: number | null; n: number; unidad: string | null };
      nivel_freatico: { max: number | null; avg: number | null; n: number; unidad: string | null };
      muestras_total: number;
    }>
  > {
    const params = new URLSearchParams();
    params.set('desde', desde);
    params.set('hasta', hasta);
    params.set('t', String(Date.now()));
    return this.http.get<
      ApiResponse<{
        caudal: { max: number | null; avg: number | null; n: number; unidad: string | null };
        nivel: { max: number | null; avg: number | null; n: number; unidad: string | null };
        nivel_freatico: { max: number | null; avg: number | null; n: number; unidad: string | null };
        muestras_total: number;
      }>
    >(`/api/companies/sites/${siteId}/period-aggregates?${params.toString()}`);
  }

  getSitePeriodAggregatesDaily(
    siteId: string,
    desde: string,
    hasta: string,
  ): Observable<
    ApiResponse<{
      dias: Array<{
        dia: string;
        caudal: { max: number | null; avg: number | null; n: number };
        nivel: { max: number | null; avg: number | null; n: number };
        nivel_freatico: { max: number | null; avg: number | null; n: number };
        muestras: number;
      }>;
    }>
  > {
    const params = new URLSearchParams();
    params.set('desde', desde);
    params.set('hasta', hasta);
    params.set('t', String(Date.now()));
    return this.http.get<
      ApiResponse<{
        dias: Array<{
          dia: string;
          caudal: { max: number | null; avg: number | null; n: number };
          nivel: { max: number | null; avg: number | null; n: number };
          nivel_freatico: { max: number | null; avg: number | null; n: number };
          muestras: number;
        }>;
      }>
    >(`/api/companies/sites/${siteId}/period-aggregates-daily?${params.toString()}`);
  }

  getSiteMonthlyCounters(
    siteId: string,
    options: { rol?: string; meses?: number } = {},
  ): Observable<ApiResponse<ContadorMensualPoint[]>> {
    const params = new URLSearchParams();
    if (options.rol) params.set('rol', options.rol);
    if (options.meses) params.set('meses', String(options.meses));
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<ContadorMensualPoint[]>>(
      `/api/companies/sites/${siteId}/contadores-mensuales?${params.toString()}`,
    );
  }

  getSiteDailyCounters(
    siteId: string,
    options: { rol?: string; dias?: number } = {},
  ): Observable<ApiResponse<ContadorDiarioPoint[]>> {
    const params = new URLSearchParams();
    if (options.rol) params.set('rol', options.rol);
    if (options.dias) params.set('dias', String(options.dias));
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<ContadorDiarioPoint[]>>(
      `/api/companies/sites/${siteId}/contadores-diarios?${params.toString()}`,
    );
  }

  getSiteJornadaCounters(
    siteId: string,
    options: { rol?: string; dias?: number; inicio?: string; fin?: string } = {},
  ): Observable<ApiResponse<ContadorJornadaPoint[]>> {
    const params = new URLSearchParams();
    if (options.rol) params.set('rol', options.rol);
    if (options.dias) params.set('dias', String(options.dias));
    if (options.inicio) params.set('inicio', options.inicio);
    if (options.fin) params.set('fin', options.fin);
    params.set('t', String(Date.now()));
    return this.http.get<ApiResponse<ContadorJornadaPoint[]>>(
      `/api/companies/sites/${siteId}/contadores-jornadas?${params.toString()}`,
    );
  }

  getSiteOperacionConfig(siteId: string): Observable<ApiResponse<SiteOperacionConfig>> {
    return this.http.get<ApiResponse<SiteOperacionConfig>>(
      `/api/companies/sites/${siteId}/operacion-config?t=${Date.now()}`,
    );
  }

  updateSiteOperacionConfig(
    siteId: string,
    config: {
      num_turnos: 2 | 3;
      turnos: SiteOperacionTurno[];
      jornada_inicio: string;
      jornada_fin: string;
    },
  ): Observable<ApiResponse<SiteOperacionConfig>> {
    return this.http.put<ApiResponse<SiteOperacionConfig>>(
      `/api/companies/sites/${siteId}/operacion-config`,
      config,
    );
  }

  downloadSiteDashboardHistory(
    siteId: string,
    options: {
      from: string;
      to: string;
      fields: string[];
      format: 'csv';
      granularity?: HistoryGranularity;
    },
  ): Observable<HttpResponse<Blob>> {
    return this.http.get(`/api/companies/sites/${siteId}/dashboard-history/export`, {
      observe: 'response',
      responseType: 'blob',
      params: {
        from: options.from,
        to: options.to,
        fields: options.fields.join(','),
        format: options.format,
        granularity: options.granularity || '1m',
        t: String(Date.now()),
      },
    });
  }

  private applyPreviewScope(tree: CompanyNode[], context: ViewAsContext | null): CompanyNode[] {
    if (!context || this.auth.realRole() !== 'SuperAdmin') {
      return tree;
    }

    if (context.role === 'Admin') {
      return context.companyId ? tree.filter((company) => company.id === context.companyId) : tree;
    }

    if (context.role === 'Gerente') {
      return this.scopeToSubCompany(tree, context.subCompanyId);
    }

    if (context.role === 'Cliente') {
      return this.scopeToSite(tree, context.siteId);
    }

    return tree;
  }

  private scopeToSubCompany(tree: CompanyNode[], subCompanyId?: string): CompanyNode[] {
    if (!subCompanyId) return tree;

    return tree
      .map((company) => ({
        ...company,
        subCompanies: (company.subCompanies || []).filter((subCompany) => {
          return subCompany.id === subCompanyId;
        }),
      }))
      .filter((company) => company.subCompanies.length > 0);
  }

  private scopeToSite(tree: CompanyNode[], siteId?: string): CompanyNode[] {
    if (!siteId) return tree;

    return tree
      .map((company) => ({
        ...company,
        subCompanies: (company.subCompanies || [])
          .map((subCompany) => ({
            ...subCompany,
            sites: (subCompany.sites || []).filter((site) => site.id === siteId),
          }))
          .filter((subCompany) => subCompany.sites.length > 0),
      }))
      .filter((company) => company.subCompanies.length > 0);
  }
}
