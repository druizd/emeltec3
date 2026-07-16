import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { twoFactorInterceptor } from './two-factor.interceptor';
import { TwoFactorService } from '../services/two-factor.service';

describe('twoFactorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let mockTf: {
    begin: ReturnType<typeof vi.fn>;
    again: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTf = {
      begin: vi.fn(),
      again: vi.fn(),
      close: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([twoFactorInterceptor])),
        provideHttpClientTesting(),
        { provide: TwoFactorService, useValue: mockTf },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('request normal (200) → pasa sin tocar TwoFactorService', () => {
    http.get('/api/data').subscribe();

    const req = httpMock.expectOne('/api/data');
    req.flush({ data: 'ok' });

    expect(mockTf.begin).not.toHaveBeenCalled();
    expect(mockTf.again).not.toHaveBeenCalled();
    expect(mockTf.close).not.toHaveBeenCalled();
  });

  it('403 con código TWOFA_REQUIRED → llama tf.begin(), con código resuelto reintenta request', async () => {
    mockTf.begin.mockResolvedValueOnce('123456');

    let responseData: unknown = null;
    http.get('/api/action').subscribe((data) => {
      responseData = data;
    });

    // Primera petición falla con TWOFA_REQUIRED
    const firstReq = httpMock.expectOne('/api/action');
    firstReq.flush(
      { code: 'TWOFA_REQUIRED' },
      { status: 403, statusText: 'Forbidden' },
    );

    // Esperar que el interceptor procese el begin() promise
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTf.begin).toHaveBeenCalledOnce();

    // Segunda petición (reintento con el código)
    const secondReq = httpMock.expectOne('/api/action');
    expect(secondReq.request.headers.get('X-2FA-Code')).toBe('123456');
    secondReq.flush({ data: 'success' });

    // close() debe haberse llamado al recibir 200
    await Promise.resolve();
    expect(mockTf.close).toHaveBeenCalled();
  });

  it('403 con código TWOFA_INVALID → llama tf.again() (no begin)', async () => {
    // Simular que el usuario ya tenía un código (el interceptor llama again cuando hay un código previo)
    // Para hacer esto: primera request con TWOFA_REQUIRED, usuario da código, segunda falla con TWOFA_INVALID
    mockTf.begin.mockResolvedValueOnce('wrong-code');
    mockTf.again.mockResolvedValueOnce('correct-code');

    http.get('/api/action').subscribe({ error: () => {} });

    // Primera falla: TWOFA_REQUIRED
    const firstReq = httpMock.expectOne('/api/action');
    firstReq.flush({ code: 'TWOFA_REQUIRED' }, { status: 403, statusText: 'Forbidden' });

    await Promise.resolve();
    await Promise.resolve();

    // Segunda petición con el código incorrecto
    const secondReq = httpMock.expectOne('/api/action');
    secondReq.flush({ code: 'TWOFA_INVALID' }, { status: 403, statusText: 'Forbidden' });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockTf.again).toHaveBeenCalledOnce();

    // Absorber el tercer reintento
    const thirdReq = httpMock.expectOne('/api/action');
    thirdReq.flush({ data: 'ok' });

    await Promise.resolve();
  });

  it('usuario cancela (begin resuelve null) → tf.close(), propaga error original', async () => {
    mockTf.begin.mockResolvedValueOnce(null);

    let caughtError: unknown = null;
    http.get('/api/action').subscribe({
      error: (err) => {
        caughtError = err;
      },
    });

    const req = httpMock.expectOne('/api/action');
    req.flush({ code: 'TWOFA_REQUIRED' }, { status: 403, statusText: 'Forbidden' });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockTf.close).toHaveBeenCalled();
    expect(caughtError).not.toBeNull();
  });

  it('error no-403 → propaga sin tocar TwoFactorService', () => {
    http.get('/api/data').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/data');
    req.flush({ message: 'Server Error' }, { status: 500, statusText: 'Internal Server Error' });

    expect(mockTf.begin).not.toHaveBeenCalled();
    expect(mockTf.again).not.toHaveBeenCalled();
    expect(mockTf.close).not.toHaveBeenCalled();
  });

  it('403 con código distinto (FORBIDDEN) → propaga sin step-up', () => {
    http.get('/api/data').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/data');
    req.flush({ code: 'FORBIDDEN' }, { status: 403, statusText: 'Forbidden' });

    expect(mockTf.begin).not.toHaveBeenCalled();
    expect(mockTf.again).not.toHaveBeenCalled();
  });
});
