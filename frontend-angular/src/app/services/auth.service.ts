import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import type { User, UserRole } from '@emeltec/shared';

export type { User, UserRole };

const VIEW_AS_STORAGE_KEY = 'view_as_role';

export type PreviewRole = Exclude<UserRole, 'SuperAdmin'>;

export interface ViewAsContext {
  role: PreviewRole;
  companyId?: string;
  companyName?: string;
  subCompanyId?: string;
  subCompanyName?: string;
  siteId?: string;
  siteName?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<User | null>(null);
  private tokenSignal = signal<string | null>(null);
  private loadingSignal = signal<boolean>(true);
  private viewAsContextSignal = signal<ViewAsContext | null>(null);

  readonly user = this.userSignal.asReadonly();
  readonly token = this.tokenSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly isAuthenticated = computed(() => !!this.userSignal());

  /** Rol real del usuario logueado (nunca cambia por view-as) */
  readonly realRole = computed<UserRole | null>(() => this.userSignal()?.tipo ?? null);
  /** Rol simulado activo (null si no hay view-as) */
  readonly viewAsContext = this.viewAsContextSignal.asReadonly();
  readonly viewAsRole = computed<UserRole | null>(() => this.viewAsContextSignal()?.role ?? null);
  /** Rol efectivo: simulado si existe, sino el real. Lo consumen los computeds de permisos */
  readonly effectiveRole = computed<UserRole | null>(
    () => this.viewAsContextSignal()?.role ?? this.realRole(),
  );
  /** True si el usuario está actualmente viendo la app como otro rol */
  readonly isViewingAs = computed(() => this.viewAsContextSignal() !== null);
  /** Solo SuperAdmin real puede activar el switcher */
  readonly canSwitchView = computed(() => this.realRole() === 'SuperAdmin');

  readonly viewAsScopeLabel = computed(() => {
    const context = this.viewAsContextSignal();
    if (!context) return '';

    const parts = [context.companyName, context.subCompanyName, context.siteName].filter(
      (part): part is string => Boolean(part?.trim()),
    );

    return parts.join(' / ');
  });

  readonly isSuperAdmin = computed(() => this.effectiveRole() === 'SuperAdmin');
  readonly isAdmin = computed(() => this.effectiveRole() === 'Admin');
  readonly isGerente = computed(() => this.effectiveRole() === 'Gerente');
  readonly isCliente = computed(() => this.effectiveRole() === 'Cliente');

  readonly canAccessAdministration = computed(() => this.effectiveRole() === 'SuperAdmin');

  readonly canReviewDga = computed(() => {
    const tipo = this.effectiveRole();
    return tipo === 'SuperAdmin' || tipo === 'Admin';
  });

  readonly canEditSiteSettings = computed(() => {
    const tipo = this.effectiveRole();
    return tipo === 'SuperAdmin' || tipo === 'Admin';
  });

  readonly canManageAlerts = computed(() => {
    const tipo = this.effectiveRole();
    return tipo === 'SuperAdmin' || tipo === 'Admin' || tipo === 'Gerente';
  });

  readonly canViewAdvancedAnalysis = computed(() => this.effectiveRole() === 'SuperAdmin');

  /** SuperAdmin o Admin pueden gestionar usuarios y editar datos */
  readonly canManageUsers = computed(() => {
    const tipo = this.effectiveRole();
    return tipo === 'SuperAdmin' || tipo === 'Admin';
  });

  /** Solo SuperAdmin puede ver el listado de usuarios */
  readonly canViewUsers = computed(() => {
    const tipo = this.effectiveRole();
    return tipo === 'SuperAdmin';
  });

  /** Solo SuperAdmin y Admin pueden crear/editar/eliminar */
  readonly canEdit = computed(() => {
    const tipo = this.effectiveRole();
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
      const storedViewAs = this.parseStoredViewAs(sessionStorage.getItem(VIEW_AS_STORAGE_KEY));
      if (storedViewAs && this.realRole() === 'SuperAdmin') {
        this.viewAsContextSignal.set(storedViewAs);
      }
    }
    this.loadingSignal.set(false);
  }

  login(tokenStr: string, userData: User): void {
    localStorage.setItem('jwt_token', tokenStr);
    localStorage.setItem('user_data', JSON.stringify(userData));
    sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
    this.tokenSignal.set(tokenStr);
    this.userSignal.set(userData);
    this.viewAsContextSignal.set(null);
  }

  updateUser(userData: Partial<User>): void {
    const current = this.userSignal();
    if (!current) return;

    const next = { ...current, ...userData };
    localStorage.setItem('user_data', JSON.stringify(next));
    this.userSignal.set(next);
  }

  logout(): void {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
    sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
    this.tokenSignal.set(null);
    this.userSignal.set(null);
    this.viewAsContextSignal.set(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.tokenSignal();
  }

  /** Activa la simulación de rol. Solo SuperAdmin puede invocar. */
  setViewAs(role: UserRole): void {
    if (this.realRole() !== 'SuperAdmin') return;
    if (role === 'SuperAdmin') {
      this.clearViewAs();
      return;
    }
    this.setViewAsContext({ role });
  }

  /** Activa la preview contextual: Admin=empresa, Gerente=subempresa, Cliente=sitio. */
  setViewAsContext(context: ViewAsContext): void {
    if (this.realRole() !== 'SuperAdmin') return;

    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(context));
    this.viewAsContextSignal.set(context);
    this.router.navigate(['/dashboard']);
  }

  /** Desactiva la simulación y vuelve al rol real */
  clearViewAs(): void {
    sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
    this.viewAsContextSignal.set(null);
    this.router.navigate(['/dashboard']);
  }

  private parseStoredViewAs(value: string | null): ViewAsContext | null {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value) as Partial<Omit<ViewAsContext, 'role'>> & {
        role?: string;
      };
      if (parsed?.role && parsed.role !== 'SuperAdmin') {
        return { ...parsed, role: parsed.role as PreviewRole };
      }
    } catch {
      if (value !== 'SuperAdmin') {
        return { role: value as PreviewRole };
      }
    }

    return null;
  }
}
