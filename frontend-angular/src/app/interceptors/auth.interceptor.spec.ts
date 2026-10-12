import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient, HttpContext } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { USE_REAL_TOKEN } from '../services/auth-http-context';
import { ToastService } from '../services/toast.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let mockAuth: { logout: ReturnType<typeof vi.fn>; endViewAsExpired: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockAuth = { logout: vi.fn(), endViewAsExpired: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: mockAuth },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('token en localStorage → request incluye Authorization: Bearer <token>', () => {
    localStorage.setItem('jwt_token', 'test-token-123');

    http.get('/api/data').subscribe();

    const req = httpMock.expectOne('/api/data');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token-123');
    req.flush({});
  });

  it('sin token → request NO tiene header Authorization', () => {
    // localStorage está vacío

    http.get('/api/data').subscribe();

    const req = httpMock.expectOne('/api/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('respuesta 401 en endpoint normal → llama auth.logout()', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.get('/api/protected').subscribe({ error: () => undefined });

    const req = httpMock.expectOne('/api/protected');
    req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(mockAuth.logout).toHaveBeenCalledOnce();
  });

  it('respuesta 401 en /api/auth/login → NO llama auth.logout()', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  it('respuesta 403 → NO llama auth.logout() (solo 401)', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.get('/api/admin').subscribe({ error: () => undefined });

    const req = httpMock.expectOne('/api/admin');
    req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  describe('modo "ver como"', () => {
    beforeEach(() => {
      localStorage.setItem('jwt_token', 'real-token');
      sessionStorage.setItem('view_as_token', 'view-as-token');
    });

    afterEach(() => sessionStorage.clear());

    it('con token "ver como" activo → Authorization usa el token "ver como"', () => {
      http.get('/api/data').subscribe();

      const req = httpMock.expectOne('/api/data');
      expect(req.request.headers.get('Authorization')).toBe('Bearer view-as-token');
      req.flush({});
    });

    it('llamada con USE_REAL_TOKEN → usa el token real aunque haya "ver como"', () => {
      http
        .post('/api/v2/auth/view-as', {}, { context: new HttpContext().set(USE_REAL_TOKEN, true) })
        .subscribe();

      const req = httpMock.expectOne('/api/v2/auth/view-as');
      expect(req.request.headers.get('Authorization')).toBe('Bearer real-token');
      req.flush({});
    });

    it('401 con token "ver como" → termina la simulación y NO hace logout', () => {
      http.get('/api/protected').subscribe({ error: () => undefined });

      httpMock
        .expectOne('/api/protected')
        .flush(
          { message: 'Token inválido o expirado' },
          { status: 401, statusText: 'Unauthorized' },
        );

      expect(mockAuth.endViewAsExpired).toHaveBeenCalledOnce();
      expect(mockAuth.logout).not.toHaveBeenCalled();
    });

    it('403 de solo lectura en escritura → toast con el mensaje, sin logout ni fin de "ver como"', () => {
      const toast = TestBed.inject(ToastService);
      const errorSpy = vi.spyOn(toast, 'error');
      http.put('/api/sites/1', {}).subscribe({ error: () => undefined });

      httpMock
        .expectOne('/api/sites/1')
        .flush(
          { message: 'Modo "ver como" es solo lectura' },
          { status: 403, statusText: 'Forbidden' },
        );

      expect(errorSpy).toHaveBeenCalledWith('Modo "ver como" es solo lectura');
      expect(mockAuth.logout).not.toHaveBeenCalled();
      expect(mockAuth.endViewAsExpired).not.toHaveBeenCalled();
    });

    it('401 en llamada USE_REAL_TOKEN → flujo normal (logout), no toca "ver como"', () => {
      http
        .get('/api/v2/companies/tree', { context: new HttpContext().set(USE_REAL_TOKEN, true) })
        .subscribe({ error: () => undefined });

      httpMock
        .expectOne('/api/v2/companies/tree')
        .flush({ message: 'expirado' }, { status: 401, statusText: 'Unauthorized' });

      expect(mockAuth.logout).toHaveBeenCalledOnce();
      expect(mockAuth.endViewAsExpired).not.toHaveBeenCalled();
    });
  });

  it('respuesta 200 → no llama logout', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.get('/api/data').subscribe();

    const req = httpMock.expectOne('/api/data');
    req.flush({ data: 'ok' });

    expect(mockAuth.logout).not.toHaveBeenCalled();
  });
});
