import {
  HttpErrorResponse,
  HttpEvent,
  HttpEventType,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, tap, throwError } from 'rxjs';
import { TwoFactorService } from '../services/two-factor.service';

/**
 * Captura 403 TWOFA_REQUIRED/INVALID y orquesta el step-up: pide un código (solo
 * en el primer desafío), abre el diálogo y reintenta con header X-2FA-Code. Si
 * el código es incorrecto, REABRE el mismo diálogo con error (sin pedir uno
 * nuevo) para reintentar — el código sigue válido sus 5 min. Recursivo hasta
 * éxito o cancelación. Global → cubre cualquier endpoint con require2fa.
 */
export const twoFactorInterceptor: HttpInterceptorFn = (req, next) => {
  const tf = inject(TwoFactorService);

  const run = (code?: string): Observable<HttpEvent<unknown>> => {
    const r = code ? req.clone({ setHeaders: { 'X-2FA-Code': code } }) : req;
    return next(r).pipe(
      tap((ev) => {
        if (code && ev.type === HttpEventType.Response) tf.close();
      }),
      catchError((err: HttpErrorResponse) => {
        const ecode = err?.error?.code;
        const is2fa =
          err.status === 403 && (ecode === 'TWOFA_REQUIRED' || ecode === 'TWOFA_INVALID');
        if (!is2fa) {
          if (code) tf.close();
          return throwError(() => err);
        }
        // Código ingresado pero inválido → reintento sin pedir uno nuevo.
        const prompt$ = ecode === 'TWOFA_INVALID' && code ? tf.again() : tf.begin();
        return from(prompt$).pipe(
          switchMap((entered) => {
            if (!entered) {
              tf.close();
              return throwError(() => err);
            }
            return run(entered);
          }),
        );
      }),
    );
  };

  return run();
};
