import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';
import type { ApiResponse, CreateUserPayload, User, UserListFilters } from '@emeltec/shared';

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  users = signal<User[]>([]);
  loading = signal(false);

  fetchUsers(filters: UserListFilters = {}): Observable<ApiResponse<User[]>> {
    this.loading.set(true);
    const url = this.buildUsersUrl(filters);

    return this.http.get<ApiResponse<User[]>>(url).pipe(
      tap((res) => {
        if (res.ok) this.users.set(res.data);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  getUsers(filters: UserListFilters = {}): Observable<ApiResponse<User[]>> {
    return this.http.get<ApiResponse<User[]>>(this.buildUsersUrl(filters));
  }

  createUser(userData: CreateUserPayload): Observable<ApiResponse<User>> {
    return this.http.post<ApiResponse<User>>('/api/users', userData);
  }

  deleteUser(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`/api/users/${id}`);
  }

  private buildUsersUrl(filters: UserListFilters): string {
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
