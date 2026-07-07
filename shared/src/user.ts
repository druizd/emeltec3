export type UserRole = 'SuperAdmin' | 'Admin' | 'Gerente' | 'Cliente' | 'Vendedor';
export type AuthMode = 'password' | 'otp' | 'password_otp';

export interface User {
  id: string;
  nombre: string;
  apellido: string;
  rut_usuario?: string | null;
  email: string;
  tipo: UserRole;
  telefono?: string | null;
  cargo?: string | null;
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
  empresa_nombre?: string | null;
  sub_empresa_nombre?: string | null;
  last_login_at?: string | null;
  activated_at?: string | null;
  has_password?: boolean;
  auth_mode?: AuthMode | null;
  password_set_at?: string | null;
  activo?: boolean;
}

export interface CreateUserPayload {
  nombre: string;
  apellido: string;
  rut_usuario?: string | null;
  email: string;
  tipo: UserRole;
  telefono?: string | null;
  cargo?: string | null;
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
}

export interface UpdateUserProfilePayload {
  nombre?: string;
  apellido?: string | null;
  rut_usuario?: string | null;
  telefono?: string | null;
  cargo?: string | null;
}

/** Edición de un usuario por un administrador (no incluye email). */
export interface UpdateUserAdminPayload {
  nombre?: string;
  apellido?: string;
  rut_usuario?: string | null;
  tipo?: UserRole;
  telefono?: string | null;
  cargo?: string | null;
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
  activo?: boolean;
}

export interface UpdateUserSecurityPayload {
  auth_mode: AuthMode;
}

export interface UpdateUserPasswordPayload {
  current_password?: string;
  new_password: string;
}

export interface UserListFilters {
  empresa_id?: string;
  sub_empresa_id?: string;
}
