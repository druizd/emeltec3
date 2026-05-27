import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();
  if (!token) return next(req);

  try {
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(atob(payloadB64));
    if (payload?.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
      auth.logout();
      return next(req);
    }
  } catch {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
