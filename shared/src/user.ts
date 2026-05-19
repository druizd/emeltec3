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

export interface UserListFilters {
  empresa_id?: string;
  sub_empresa_id?: string;
}
