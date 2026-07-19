import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import type { SessionUser } from './auth.service';
import type { User } from '@emeltec/shared';

// Alias para compatibilidad de tipos en el test
type SessionUserShape = SessionUser;

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeJwt(expOffsetSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: '1', exp: now + expOffsetSeconds };
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `header.${encoded}.sig`;
}

const usuarioCompleto: User = {
  id: '1',
  nombre: 'Juan',
  apellido: 'Pérez',
  tipo: 'Admin',
  cargo: 'Jefe',
  empresa_id: 'e1',
  sub_empresa_id: 'se1',
  email: 'juan@test.com',
  rut_usuario: '12.345.678-9',
  telefono: '+56912345678',
};

const proyeccionEsperada: SessionUserShape = {
  id: '1',
  nombre: 'Juan',
  apellido: 'Pérez',
  tipo: 'Admin',
  cargo: 'Jefe',
  empresa_id: 'e1',
  sub_empresa_id: 'se1',
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ─── login() ─────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('persiste jwt_token en localStorage', () => {
      const token = makeJwt(3600);
      service.login(token, usuarioCompleto);
      expect(localStorage.getItem('jwt_token')).toBe(token);
    });

    it('persiste solo SessionUser en user_data (SIN email, rut_usuario, telefono)', () => {
      const token = makeJwt(3600);
      service.login(token, usuarioCompleto);

      const stored = JSON.parse(localStorage.getItem('user_data')!);
      expect(stored).toEqual(proyeccionEsperada);
      expect(stored.email).toBeUndefined();
      expect(stored.rut_usuario).toBeUndefined();
      expect(stored.telefono).toBeUndefined();
    });

    it('el signal user() tiene el perfil completo (con email)', () => {
      const token = makeJwt(3600);
      service.login(token, usuarioCompleto);

      expect(service.user()?.email).toBe('juan@test.com');
      expect(service.user()?.rut_usuario).toBe('12.345.678-9');
    });

    it('limpia view_as_role de sessionStorage', () => {
      sessionStorage.setItem('view_as_role', JSON.stringify({ role: 'Gerente' }));
      const token = makeJwt(3600);
      service.login(token, usuarioCompleto);

      expect(sessionStorage.getItem('view_as_role')).toBeNull();
    });

    it('actualiza el signal token()', () => {
      const token = makeJwt(3600);
      service.login(token, usuarioCompleto);
      expect(service.token()).toBe(token);
    });
  });

  // ─── initFromStorage() ───────────────────────────────────────────────────

  describe('initFromStorage() — restauración de sesión', () => {
    it('token válido + user_data válido → restaura sesión', async () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify(proyeccionEsperada));

      // Re-crear el servicio para que ejecute initFromStorage()
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);
      const hm = TestBed.inject(HttpTestingController);

      expect(svc.user()).not.toBeNull();
      expect(svc.token()).toBe(token);
      expect(svc.isAuthenticated()).toBe(true);

      // Drenar la microtask queue para que queueMicrotask() se ejecute
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Absorber la petición de hidratación
      hm.expectOne('/api/users/me').flush({ ok: true, data: usuarioCompleto });
      hm.verify();
    });

    it('token válido + user_data con perfil completo (legacy) → re-persiste solo proyección', async () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      // Guardar perfil completo (como haría una versión anterior)
      localStorage.setItem('user_data', JSON.stringify(usuarioCompleto));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);
      const hm = TestBed.inject(HttpTestingController);

      const stored = JSON.parse(localStorage.getItem('user_data')!);
      expect(stored.email).toBeUndefined();
      expect(stored.rut_usuario).toBeUndefined();
      expect(svc.user()).not.toBeNull();

      // Drenar la microtask queue para que queueMicrotask() se ejecute
      await new Promise((resolve) => setTimeout(resolve, 0));

      hm.expectOne('/api/users/me').flush({ ok: true, data: usuarioCompleto });
      hm.verify();
    });

    it('token expirado → limpia storage', () => {
      const expiredToken = makeJwt(-100);
      localStorage.setItem('jwt_token', expiredToken);
      localStorage.setItem('user_data', JSON.stringify(proyeccionEsperada));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);

      expect(svc.user()).toBeNull();
      expect(svc.token()).toBeNull();
      expect(localStorage.getItem('jwt_token')).toBeNull();
    });

    it('user_data con JSON corrupto → limpia storage', () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', 'NOT_VALID_JSON{{{');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);

      expect(svc.user()).toBeNull();
      expect(svc.token()).toBeNull();
    });

    it('user_data sin campo id → limpia storage', () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify({ nombre: 'Juan' }));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);

      expect(svc.user()).toBeNull();
    });

    it('restauración con view-as en sessionStorage y usuario SuperAdmin → restaura viewAsContext', async () => {
      const token = makeJwt(3600);
      const superAdmin: User = { ...usuarioCompleto, tipo: 'SuperAdmin' };
      const superAdminSession: SessionUserShape = { ...proyeccionEsperada, tipo: 'SuperAdmin' };
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify(superAdminSession));
      sessionStorage.setItem('view_as_role', JSON.stringify({ role: 'Gerente', companyId: 'c1' }));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);
      const hm = TestBed.inject(HttpTestingController);

      expect(svc.viewAsContext()).not.toBeNull();
      expect(svc.viewAsContext()?.role).toBe('Gerente');

      // Drenar la microtask queue para que queueMicrotask() se ejecute
      await new Promise((resolve) => setTimeout(resolve, 0));

      hm.expectOne('/api/users/me').flush({ ok: true, data: superAdmin });
      hm.verify();
    });
  });

  // ─── hydrateUserFromApi() ─────────────────────────────────────────────────

  describe('hydrateUserFromApi()', () => {
    it('después de restaurar sesión válida, lanza GET /api/users/me', async () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify(proyeccionEsperada));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      TestBed.inject(AuthService); // construye el servicio: dispara initFromStorage + hidratación
      const hm = TestBed.inject(HttpTestingController);

      // Drenar la microtask queue
      await new Promise((resolve) => setTimeout(resolve, 0));

      const req = hm.expectOne('/api/users/me');
      expect(req.request.method).toBe('GET');
      req.flush({ ok: true, data: usuarioCompleto });
      hm.verify();
    });

    it('la respuesta del backend actualiza el signal user() con datos completos', async () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify(proyeccionEsperada));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);
      const hm = TestBed.inject(HttpTestingController);

      await new Promise((resolve) => setTimeout(resolve, 0));

      hm.expectOne('/api/users/me').flush({ ok: true, data: usuarioCompleto });

      expect(svc.user()?.email).toBe('juan@test.com');
      hm.verify();
    });

    it('NO actualiza si el token cambió entre inicio y respuesta', async () => {
      const token = makeJwt(3600);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify(proyeccionEsperada));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);
      const hm = TestBed.inject(HttpTestingController);

      await new Promise((resolve) => setTimeout(resolve, 0));

      // Simular logout entre inicio y respuesta: limpiar el token
      svc.logout();

      const req = hm.expectOne('/api/users/me');
      req.flush({ ok: true, data: usuarioCompleto });

      // El signal debe ser null porque se cerró sesión
      expect(svc.user()).toBeNull();
      hm.verify();
    });
  });

  // ─── updateUser() ─────────────────────────────────────────────────────────

  describe('updateUser()', () => {
    beforeEach(() => {
      service.login(makeJwt(3600), usuarioCompleto);
    });

    it('fusiona en memoria (signal user() contiene la clave actualizada)', () => {
      service.updateUser({ cargo: 'Director' });
      expect(service.user()?.cargo).toBe('Director');
    });

    it('persiste solo la proyección en localStorage (sin email aunque se pase)', () => {
      service.updateUser({ cargo: 'Director', email: 'nuevo@test.com' } as Partial<User>);

      const stored = JSON.parse(localStorage.getItem('user_data')!);
      expect(stored.email).toBeUndefined();
      expect(stored.cargo).toBe('Director');
    });

    it('no hace nada si no hay usuario en sesión', () => {
      service.logout();
      // No debe lanzar error
      expect(() => service.updateUser({ cargo: 'X' })).not.toThrow();
    });
  });

  // ─── scheduleAutoLogout / timers ─────────────────────────────────────────

  describe('scheduleAutoLogout — auto-logout con fake timers', () => {
    it('token expirando en N segundos → tras N segundos navega a /login', async () => {
      vi.useFakeTimers();
      const navigateSpy = vi.spyOn(router, 'navigate');

      const tokenIn5s = makeJwt(5);
      service.login(tokenIn5s, usuarioCompleto);

      vi.advanceTimersByTime(6000);
      // Drenar microtasks que pueda haber creado Angular
      await vi.runAllTimersAsync();

      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });

    it('aviso de sesión: ≤31s restantes → sessionExpiringSoon() es true', async () => {
      vi.useFakeTimers();

      // Token que expira en 20s (ya dentro del umbral de 31s)
      const shortToken = makeJwt(20);
      service.login(shortToken, usuarioCompleto);

      // El aviso debe activarse de inmediato (warnDelay ≤ 0)
      expect(service.sessionExpiringSoon()).toBe(true);
    });

    it('dismissExpiryWarning() → sessionExpiringSoon() false, countdown cancela', async () => {
      vi.useFakeTimers();

      const shortToken = makeJwt(20);
      service.login(shortToken, usuarioCompleto);

      expect(service.sessionExpiringSoon()).toBe(true);
      service.dismissExpiryWarning();
      expect(service.sessionExpiringSoon()).toBe(false);
    });

    it('token ya expirado al hacer login → logout inmediato', async () => {
      vi.useFakeTimers();
      const navigateSpy = vi.spyOn(router, 'navigate');

      const expiredToken = makeJwt(-10);
      service.login(expiredToken, usuarioCompleto);

      await vi.runAllTimersAsync();
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });
  });

  // ─── view-as ─────────────────────────────────────────────────────────────

  describe('view-as', () => {
    let superAdminService: AuthService;

    beforeEach(() => {
      // Crear un SuperAdmin
      const superAdmin: User = { ...usuarioCompleto, tipo: 'SuperAdmin' };
      service.login(makeJwt(3600), superAdmin);
      superAdminService = service;
    });

    it('setViewAs("Admin") con SuperAdmin → cambia effectiveRole() a "Admin"', () => {
      superAdminService.setViewAs('Admin');
      expect(superAdminService.effectiveRole()).toBe('Admin');
    });

    it('setViewAs("Admin") con SuperAdmin → persiste en sessionStorage', () => {
      superAdminService.setViewAs('Admin');
      const stored = sessionStorage.getItem('view_as_role');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.role).toBe('Admin');
    });

    it('setViewAs("Admin") con usuario no-SuperAdmin → NO cambia nada', () => {
      // Crear un Admin normal
      const adminService = TestBed.inject(AuthService);
      adminService.login(makeJwt(3600), usuarioCompleto); // tipo: 'Admin'

      adminService.setViewAs('SuperAdmin');
      expect(adminService.effectiveRole()).toBe('Admin'); // sin cambio
    });

    it('setViewAsContext({ role: "Gerente", companyId: "c1" }) → persiste contexto completo', () => {
      superAdminService.setViewAsContext({ role: 'Gerente', companyId: 'c1' });

      const ctx = superAdminService.viewAsContext();
      expect(ctx?.role).toBe('Gerente');
      expect(ctx?.companyId).toBe('c1');

      const stored = sessionStorage.getItem('view_as_role');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.companyId).toBe('c1');
    });

    it('clearViewAs() → limpia sessionStorage, viewAsContext null', () => {
      superAdminService.setViewAs('Admin');
      expect(superAdminService.viewAsContext()).not.toBeNull();

      superAdminService.clearViewAs();

      expect(superAdminService.viewAsContext()).toBeNull();
      expect(sessionStorage.getItem('view_as_role')).toBeNull();
    });

    it('isViewingAs() es true tras setViewAs, false tras clearViewAs', () => {
      expect(superAdminService.isViewingAs()).toBe(false);
      superAdminService.setViewAs('Admin');
      expect(superAdminService.isViewingAs()).toBe(true);
      superAdminService.clearViewAs();
      expect(superAdminService.isViewingAs()).toBe(false);
    });

    it('canSwitchView() es true solo para SuperAdmin', () => {
      expect(superAdminService.canSwitchView()).toBe(true);

      // Crear un servicio para Admin normal
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const svc = TestBed.inject(AuthService);
      const hm = TestBed.inject(HttpTestingController);

      svc.login(makeJwt(3600), usuarioCompleto); // Admin
      expect(svc.canSwitchView()).toBe(false);

      hm.verify();
    });

    it('effectiveRole() usa viewAs si está activo, sino el real', () => {
      expect(superAdminService.effectiveRole()).toBe('SuperAdmin');
      superAdminService.setViewAs('Gerente');
      expect(superAdminService.effectiveRole()).toBe('Gerente');
      superAdminService.clearViewAs();
      expect(superAdminService.effectiveRole()).toBe('SuperAdmin');
    });
  });

  // ─── logout() ────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('limpia storage y navega a /login', async () => {
      const navigateSpy = vi.spyOn(router, 'navigate');
      service.login(makeJwt(3600), usuarioCompleto);

      service.logout();

      expect(localStorage.getItem('jwt_token')).toBeNull();
      expect(localStorage.getItem('user_data')).toBeNull();
      expect(service.user()).toBeNull();
      expect(service.token()).toBeNull();
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });
  });
});
