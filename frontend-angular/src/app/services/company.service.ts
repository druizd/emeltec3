import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private http = inject(HttpClient);
  
  companies = signal<any[]>([]);
  hierarchy = signal<any[]>([]);
  selectedSubCompanyId = signal<string | null>(null);
  loading = signal(false);

  fetchCompanies(): Observable<any> {
    this.loading.set(true);
    return this.http.get<any>('/api/companies').pipe(
      tap(res => {
        if (res.ok) this.companies.set(res.data);
        this.loading.set(false);
      })
    );
  }

  fetchHierarchy(): Observable<any> {
    this.loading.set(true);
    // Agregamos un timestamp (?t=...) para obligar al navegador a traer datos nuevos siempre
    return this.http.get<any>(`/api/companies/tree?t=${Date.now()}`).pipe(
      tap(res => {
        if (res.ok) {
          console.log('Datos de Jerarquía recibidos:', res.data);
          this.hierarchy.set(res.data);
        }
        this.loading.set(false);
      })
    );
  }

  getSites(id: string): Observable<any> {
     return this.http.get<any>(`/api/companies/${id}/sites`); 
  }

  getSiteDashboardData(siteId: string): Observable<any> {
    return this.http.get<any>(`/api/companies/sites/${siteId}/dashboard-data?t=${Date.now()}`);
  }

  getSiteDashboardHistory(siteId: string, limit = 500): Observable<any> {
    return this.http.get<any>(`/api/companies/sites/${siteId}/dashboard-history?limit=${limit}&t=${Date.now()}`);
  }
}
