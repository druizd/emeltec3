import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { TwoFactorService } from '../services/two-factor.service';

/**
 * Captura 403 con code TWOFA_REQUIRED/TWOFA_INVALID (acciones destructivas que
 * exigen step-up), pide un código por email, lo solicita al usuario y reintenta
 * la acción original con header X-2FA-Code. Global → cubre cualquier endpoint
 * protegido con require2fa sin tocar cada llamada.
 */
export const twoFactorInterceptor: HttpInterceptorFn = (req, next) => {
  const twoFactor = inject(TwoFactorService);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const code = err?.error?.code;
      const needs2fa =
        err.status === 403 && (code === 'TWOFA_REQUIRED' || code === 'TWOFA_INVALID');
      // Si ya reintentamos con header (o no es 2FA), propagar — evita loop.
      if (!needs2fa || req.headers.has('X-2FA-Code')) {
        return throwError(() => err);
      }
      return from(twoFactor.open()).pipe(
        switchMap((entered) => {
          if (!entered) return throwError(() => err);
          return next(req.clone({ setHeaders: { 'X-2FA-Code': entered } }));
        }),
      );
    }),
  );
};
