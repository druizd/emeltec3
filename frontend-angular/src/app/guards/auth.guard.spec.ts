import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal, computed } from '@angular/core';
import { authGuard, publicGuard, roleGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

// ─── Helper ────────────────────────────────────────────────────────────────

function makeAuthMock(
  overrides: Partial<{
    loading: boolean;
    isAuthenticated: boolean;
    effectiveRole: string | null;
  }> = {},
) {
  return {
    loading: signal(overrides.loading ?? false),
    isAuthenticated: signal(overrides.isAuthenticated ?? false),
    effectiveRole: computed(() => overrides.effectiveRole ?? null),
  };
}

function setupTestBed(authMock: ReturnType<typeof makeAuthMock>) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: authMock }],
  });
  return TestBed.inject(Router);
}

// ─── authGuard ─────────────────────────────────────────────────────────────

describe('authGuard', () => {
  it('loading = true → retorna false sin navegar', () => {
    const mock = makeAuthMock({ loading: true, isAuthenticated: false });
    const router = setupTestBed(mock);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));

    expect(result).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('no autenticado → navega a /login y retorna false', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: false });
    const router = setupTestBed(mock);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));

    expect(result).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('autenticado → retorna true', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: true });
    setupTestBed(mock);

    const result = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));

    expect(result).toBe(true);
  });
});

// ─── publicGuard ───────────────────────────────────────────────────────────

describe('publicGuard', () => {
  it('loading = true → retorna true (deja pasar)', () => {
    const mock = makeAuthMock({ loading: true, isAuthenticated: false });
    setupTestBed(mock);

    const result = TestBed.runInInjectionContext(() => publicGuard({} as never, {} as never));

    expect(result).toBe(true);
  });

  it('autenticado → navega a /dashboard y retorna false', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: true });
    const router = setupTestBed(mock);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() => publicGuard({} as never, {} as never));

    expect(result).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('no autenticado → retorna true', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: false });
    setupTestBed(mock);

    const result = TestBed.runInInjectionContext(() => publicGuard({} as never, {} as never));

    expect(result).toBe(true);
  });
});

// ─── roleGuard ─────────────────────────────────────────────────────────────

describe('roleGuard', () => {
  it('sin rol (null) → navega a /dashboard y retorna false', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: true, effectiveRole: null });
    const router = setupTestBed(mock);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const guard = roleGuard('Admin');
    const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

    expect(result).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('rol no permitido → navega a /dashboard y retorna false', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: true, effectiveRole: 'Cliente' });
    const router = setupTestBed(mock);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const guard = roleGuard('SuperAdmin', 'Admin');
    const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

    expect(result).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('rol permitido → retorna true', () => {
    const mock = makeAuthMock({ loading: false, isAuthenticated: true, effectiveRole: 'Admin' });
    setupTestBed(mock);

    const guard = roleGuard('Admin');
    const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

    expect(result).toBe(true);
  });

  it('múltiples roles permitidos → acepta cualquiera de ellos', () => {
    const mock = makeAuthMock({
      loading: false,
      isAuthenticated: true,
      effectiveRole: 'Gerente',
    });
    setupTestBed(mock);

    const guard = roleGuard('SuperAdmin', 'Admin', 'Gerente');
    const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

    expect(result).toBe(true);
  });

  it('loading = true → retorna false sin navegar', () => {
    const mock = makeAuthMock({ loading: true, isAuthenticated: true, effectiveRole: 'Admin' });
    const router = setupTestBed(mock);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const guard = roleGuard('Admin');
    const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

    expect(result).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
