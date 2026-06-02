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

  /** Aviso final: 31s deja 1s de margen para que el usuario vea al menos 00:30. */
  private static readonly WARNING_LEAD_MS = 31 * 1000;

  /** Timer de auto-logout que dispara cuando el token JWT expira. */
  private logoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Timer que dispara el aviso "sesión por expirar" (exp - 31s). */
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  /** Intervalo que actualiza el countdown cada segundo mientras el aviso está visible. */
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  private sessionExpiringSoonSignal = signal(false);
  private secondsUntilLogoutSignal = signal<number | null>(null);

  /** True cuando faltan ≤31s para el cierre automático de sesión. */
  readonly sessionExpiringSoon = this.sessionExpiringSoonSignal.asReadonly();
  /** Segundos restantes hasta el auto-logout (null si el aviso no está activo). */
  readonly secondsUntilLogout = this.secondsUntilLogoutSignal.asReadonly();

  constructor(private router: Router) {
    this.initFromStorage();
    this.installExpiryGuards();
  }

  private initFromStorage(): void {
    const storedToken = localStorage.getItem('jwt_token');
    const storedUser = localStorage.getItem('user_data');
    // Restaurar solo si hay token Y no está expirado. Sin esta validación, un
    // token viejo en localStorage (p.ej. tras apagar el PC y volver al día
    // siguiente) restauraba una sesión "zombie": app dentro de la cuenta pero
    // con todos los XHR fallando → usuario debía cerrar sesión a mano.
    if (storedToken && storedUser && !this.isTokenExpired(storedToken)) {
      this.tokenSignal.set(storedToken);
      this.userSignal.set(JSON.parse(storedUser));
      const storedViewAs = this.parseStoredViewAs(sessionStorage.getItem(VIEW_AS_STORAGE_KEY));
      if (storedViewAs && this.realRole() === 'SuperAdmin') {
        this.viewAsContextSignal.set(storedViewAs);
      }
      this.scheduleAutoLogout(storedToken);
    } else if (storedToken) {
      // Token presente pero expirado/corrupto: limpiar para no dejar basura.
      this.clearSession();
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
    this.scheduleAutoLogout(tokenStr);
  }

  /**
   * Decodifica el claim `exp` (segundos epoch) del JWT.
   * Devuelve el instante de expiración en ms, o null si no se puede leer.
   */
  private getTokenExpiryMs(token: string): number | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const exp = JSON.parse(json)?.exp;
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  /** True si el token expiró (o no tiene exp legible → se trata como inválido). */
  private isTokenExpired(token: string): boolean {
    const expMs = this.getTokenExpiryMs(token);
    if (expMs === null) return true;
    return Date.now() >= expMs;
  }

  /** Revalida al volver a la pestaña por si el navegador pausó timers durante suspensión. */
  private installExpiryGuards(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const check = () => {
      const token = this.tokenSignal();
      if (token && this.isTokenExpired(token)) {
        this.logout();
      }
    };

    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
  }

  /**
   * Programa el cierre de sesión automático para el instante exacto en que el
   * token expira, más un aviso 31s antes. Si la pestaña sigue abierta al
   * expirar, desloguea solo.
   */
  private scheduleAutoLogout(token: string): void {
    this.clearTimers();
    const expMs = this.getTokenExpiryMs(token);
    if (expMs === null) {
      this.logout();
      return;
    }
    const delay = expMs - Date.now();
    if (delay <= 0) {
      this.logout();
      return;
    }
    this.logoutTimer = setTimeout(() => this.logout(), delay);

    // Aviso a falta de 31s. Si el token ya nace con menos de 31s de vida,
    // muestra el aviso de inmediato.
    const warnDelay = delay - AuthService.WARNING_LEAD_MS;
    if (warnDelay <= 0) {
      this.startExpiryCountdown(expMs);
    } else {
      this.warningTimer = setTimeout(() => this.startExpiryCountdown(expMs), warnDelay);
    }
  }

  /** Activa el aviso de sesión por expirar y refresca el countdown cada segundo. */
  private startExpiryCountdown(expMs: number): void {
    this.sessionExpiringSoonSignal.set(true);
    this.secondsUntilLogoutSignal.set(Math.max(0, Math.ceil((expMs - Date.now()) / 1000)));
    this.countdownInterval = setInterval(() => {
      const secs = Math.max(0, Math.ceil((expMs - Date.now()) / 1000));
      this.secondsUntilLogoutSignal.set(secs);
      if (secs <= 0 && this.countdownInterval !== null) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }, 1000);
  }

  /**
   * Oculta el aviso de sesión por expirar (el usuario lo descarta). El
   * auto-logout sigue programado: sin refresh token no hay forma de extender.
   */
  dismissExpiryWarning(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.sessionExpiringSoonSignal.set(false);
  }

  /** Cancela todos los timers/intervalos de sesión y resetea el aviso. */
  private clearTimers(): void {
    if (this.logoutTimer !== null) {
      clearTimeout(this.logoutTimer);
      this.logoutTimer = null;
    }
    if (this.warningTimer !== null) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.sessionExpiringSoonSignal.set(false);
    this.secondsUntilLogoutSignal.set(null);
  }

  /** Limpia storage + signals de sesión, sin navegar. */
  private clearSession(): void {
    this.clearTimers();
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
    sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
    this.tokenSignal.set(null);
    this.userSignal.set(null);
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
    this.clearSession();
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
