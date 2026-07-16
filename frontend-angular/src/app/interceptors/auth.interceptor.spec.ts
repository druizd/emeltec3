import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let mockAuth: { logout: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    mockAuth = { logout: vi.fn() };

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

    http.get('/api/protected').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/protected');
    req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(mockAuth.logout).toHaveBeenCalledOnce();
  });

  it('respuesta 401 en /api/auth/login → NO llama auth.logout()', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.post('/api/auth/login', {}).subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  it('respuesta 403 → NO llama auth.logout() (solo 401)', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.get('/api/admin').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/admin');
    req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  it('respuesta 200 → no llama logout', () => {
    localStorage.setItem('jwt_token', 'test-token');

    http.get('/api/data').subscribe();

    const req = httpMock.expectOne('/api/data');
    req.flush({ data: 'ok' });

    expect(mockAuth.logout).not.toHaveBeenCalled();
  });
});
