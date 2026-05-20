export type UserRole = 'SuperAdmin' | 'Admin' | 'Gerente' | 'Cliente';

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
  password_login_enabled?: boolean;
  otp_login_enabled?: boolean;
  two_factor_enabled?: boolean;
  password_set_at?: string | null;
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

export interface UpdateUserSecurityPayload {
  password_login_enabled?: boolean;
  otp_login_enabled?: boolean;
  two_factor_enabled?: boolean;
}

export interface UpdateUserPasswordPayload {
  current_password?: string;
  new_password: string;
}

export interface UserListFilters {
  empresa_id?: string;
  sub_empresa_id?: string;
}
