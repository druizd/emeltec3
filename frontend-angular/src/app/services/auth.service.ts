import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';

export interface User {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  tipo: string;
  empresa_id?: string;
  sub_empresa_id?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<User | null>(null);
  private tokenSignal = signal<string | null>(null);
  private loadingSignal = signal<boolean>(true);

  readonly user = this.userSignal.asReadonly();
  readonly token = this.tokenSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly isAuthenticated = computed(() => !!this.userSignal());

  // ── Role helpers ──────────────────────────────────────────────────────
  readonly isSuperAdmin = computed(() => this.userSignal()?.tipo === 'SuperAdmin');
  readonly isAdmin = computed(() => this.userSignal()?.tipo === 'Admin');
  readonly isGerente = computed(() => this.userSignal()?.tipo === 'Gerente');
  readonly isCliente = computed(() => this.userSignal()?.tipo === 'Cliente');

  /** SuperAdmin o Admin pueden gestionar usuarios y editar datos */
  readonly canManageUsers = computed(() => {
    const tipo = this.userSignal()?.tipo;
    return tipo === 'SuperAdmin' || tipo === 'Admin';
  });

  /** SuperAdmin, Admin y Gerente pueden ver la lista de usuarios (Gerente solo lectura) */
  readonly canViewUsers = computed(() => {
    const tipo = this.userSignal()?.tipo;
    return tipo === 'SuperAdmin' || tipo === 'Admin' || tipo === 'Gerente';
  });

  /** Solo SuperAdmin y Admin pueden crear/editar/eliminar */
  readonly canEdit = computed(() => {
    const tipo = this.userSignal()?.tipo;
    return tipo === 'SuperAdmin' || tipo === 'Admin';
  });

  constructor(private router: Router) {
    this.initFromStorage();
  }

  private initFromStorage(): void {
    const storedToken = localStorage.getItem('jwt_token');
    const storedUser = localStorage.getItem('user_data');
    if (storedToken && storedUser) {
      this.tokenSignal.set(storedToken);
      this.userSignal.set(JSON.parse(storedUser));
    }
    this.loadingSignal.set(false);
  }

  login(tokenStr: string, userData: User): void {
    localStorage.setItem('jwt_token', tokenStr);
    localStorage.setItem('user_data', JSON.stringify(userData));
    this.tokenSignal.set(tokenStr);
    this.userSignal.set(userData);
  }

  logout(): void {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
    this.tokenSignal.set(null);
    this.userSignal.set(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.tokenSignal();
  }
}
