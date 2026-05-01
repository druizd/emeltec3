import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Protege rutas que requieren autenticación.
 * Redirige a /login si no está logueado.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.loading()) return false;

  if (!auth.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }
  return true;
};

/**
 * Evita que usuarios autenticados vean el login.
 * Redirige a /dashboard si ya está logueado.
 */
export const publicGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.loading()) return true;

  if (auth.isAuthenticated()) {
    router.navigate(['/dashboard']);
    return false;
  }
  return true;
};

/**
 * Factory de guard por roles.
 * Uso: canActivate: [roleGuard('SuperAdmin', 'Admin')]
 * Si el usuario no tiene uno de los roles permitidos, redirige a /dashboard.
 */
export const roleGuard = (...allowedRoles: string[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (auth.loading()) return false;

    const user = auth.user();
    if (!user || !allowedRoles.includes(user.tipo)) {
      router.navigate(['/dashboard']);
      return false;
    }
    return true;
  };
};
