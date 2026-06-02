import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Inyecta el JWT como header Authorization y captura 401/403 en cualquier
 * response. Si el token expiró o es inválido, dispara logout() del
 * AuthService que limpia storage + redirige a /login.
 *
 * Sin esto, cuando el token expiraba el operador quedaba dentro de la web
 * con todos los XHR fallando silenciosamente — tenía que cerrar sesión
 * manual para recuperar acceso.
 *
 * Excluye `/api/auth/login` para no disparar logout cuando el endpoint de
 * login devuelve 401 (credenciales inválidas).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // inject() DEBE llamarse aquí (contexto de inyección síncrono), no dentro
  // del catchError: ese callback corre async al llegar el error del XHR,
  // cuando ya no hay contexto → fallaba con NG0203 y el logout por 401 nunca
  // se ejecutaba (el operador quedaba atrapado en la web).
  const auth = inject(AuthService);
  const token = localStorage.getItem('jwt_token');
  const finalReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(finalReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.includes('/api/auth/')) {
        // Token expirado o inválido. logout() limpia storage + redirige.
        auth.logout();
      }
      return throwError(() => err);
    }),
  );
};
