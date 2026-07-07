import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';
import type {
  ApiResponse,
  CreateUserPayload,
  UpdateUserPasswordPayload,
  UpdateUserAdminPayload,
  UpdateUserProfilePayload,
  UpdateUserSecurityPayload,
  User,
  UserListFilters,
  UserRole,
} from '@emeltec/shared';

export interface Tecnico {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
}

export interface EquipoEmeltecResponse {
  empresa_emeltec: { id: string; nombre: string } | null;
  miembros: {
    id: string;
    nombre: string;
    apellido: string;
    email: string;
    telefono: string | null;
    cargo: string | null;
    tipo: UserRole;
    activo: boolean;
    last_login_at: string | null;
    activated_at: string | null;
  }[];
}

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

  /**
   * Técnicos asignables a incidencias: equipo Emeltec (SuperAdmin activos).
   * El backend expone solo id/nombre/apellido/cargo (sin datos de contacto).
   */
  getTecnicos(): Observable<ApiResponse<Tecnico[]>> {
    return this.http.get<ApiResponse<Tecnico[]>>('/api/users/tecnicos');
  }

  /** Equipo interno Emeltec (SuperAdmin + Vendedor) + empresa Emeltec. Solo SuperAdmin. */
  getEquipoEmeltec(): Observable<ApiResponse<EquipoEmeltecResponse>> {
    return this.http.get<ApiResponse<EquipoEmeltecResponse>>('/api/users/equipo-emeltec');
  }

  getCurrentUser(): Observable<ApiResponse<User>> {
    return this.http.get<ApiResponse<User>>('/api/users/me');
  }

  updateCurrentUser(payload: UpdateUserProfilePayload): Observable<ApiResponse<User>> {
    return this.http.patch<ApiResponse<User>>('/api/users/me', payload);
  }

  updateCurrentPassword(payload: UpdateUserPasswordPayload): Observable<ApiResponse<User>> {
    return this.http.patch<ApiResponse<User>>('/api/users/me/password', payload);
  }

  updateCurrentSecurity(payload: UpdateUserSecurityPayload): Observable<ApiResponse<User>> {
    return this.http.patch<ApiResponse<User>>('/api/users/me/security', payload);
  }

  createUser(userData: CreateUserPayload): Observable<ApiResponse<User>> {
    return this.http.post<ApiResponse<User>>('/api/users', userData);
  }

  updateUser(id: string, payload: UpdateUserAdminPayload): Observable<ApiResponse<User>> {
    return this.http.patch<ApiResponse<User>>(`/api/users/${id}`, payload);
  }

  /** Reactiva un usuario desactivado (soft-delete inverso). */
  reactivateUser(id: string): Observable<ApiResponse<User>> {
    return this.http.patch<ApiResponse<User>>(`/api/users/${id}`, { activo: true });
  }

  /** Reset de contraseña por admin: reenvía el código de acceso. */
  resetUserPassword(id: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`/api/users/${id}/reset-password`, {});
  }

  /** Desactiva (soft-delete). El backend marca activo=false. */
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
