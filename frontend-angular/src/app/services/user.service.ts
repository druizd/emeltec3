import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  
  users = signal<any[]>([]);
  loading = signal(false);

  fetchUsers(filters: { empresa_id?: string, sub_empresa_id?: string } = {}): Observable<any> {
    this.loading.set(true);
    const url = this.buildUsersUrl(filters);

    return this.http.get<any>(url).pipe(
      tap(res => {
        if (res.ok) this.users.set(res.data);
      }),
      finalize(() => this.loading.set(false))
    );
  }

  getUsers(filters: { empresa_id?: string, sub_empresa_id?: string } = {}): Observable<any> {
    return this.http.get<any>(this.buildUsersUrl(filters));
  }

  createUser(userData: any): Observable<any> {
    return this.http.post<any>('/api/users', userData);
  }

  deleteUser(id: string): Observable<any> {
    return this.http.delete<any>(`/api/users/${id}`);
  }

  private buildUsersUrl(filters: { empresa_id?: string, sub_empresa_id?: string }): string {
    let url = '/api/users';
    const params = new URLSearchParams();
    if (filters.sub_empresa_id) params.append('sub_empresa_id', filters.sub_empresa_id);
    if (filters.empresa_id) params.append('empresa_id', filters.empresa_id);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    return url;
  }
}
