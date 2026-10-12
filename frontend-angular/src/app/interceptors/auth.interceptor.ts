import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { USE_REAL_TOKEN, VIEW_AS_TOKEN_STORAGE_KEY } from '../services/auth-http-context';
import { ToastService } from '../services/toast.service';

/**
 * Inyecta el JWT como header Authorization y captura 401/403 en cualquier
 * response. Si el token expiró o es inválido, dispara logout() del
 * AuthService que limpia storage + redirige a /login.
 *
 * Sin esto, cuando el token expiraba el operador quedaba dentro de la web
 * con todos los XHR fallando silenciosamente — tenía que cerrar sesión
 * manual para recuperar acceso.
 *
 * Con un token "ver como" activo (sessionStorage) lo usa en lugar del real; un
 * 401 lo termina (vuelve al rol real, sin logout) y un 403 (solo lectura) se
 * muestra como toast sin tocar la sesión.
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
  const toast = inject(ToastService);
  // Con "ver como" activo se envía el token del servidor (solo lectura) en vez
  // del real, salvo en llamadas marcadas USE_REAL_TOKEN (emitir/cambiar la vista).
  const viewAsToken = req.context.get(USE_REAL_TOKEN)
    ? null
    : sessionStorage.getItem(VIEW_AS_TOKEN_STORAGE_KEY);
  const token = viewAsToken ?? localStorage.getItem('jwt_token');
  const finalReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(finalReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (viewAsToken) {
        // Un fallo del token "ver como" nunca cierra la sesión real.
        if (err.status === 401) {
          // Vencido o revocado: volver al rol real.
          auth.endViewAsExpired();
        } else if (err.status === 403 && req.method !== 'GET') {
          // Escritura bloqueada por el modo solo lectura del servidor.
          toast.error(err.error?.message ?? 'El modo "ver como" es de solo lectura.');
        }
      } else if (err.status === 401 && !req.url.includes('/api/auth/')) {
        // Token expirado o inválido. logout() limpia storage + redirige.
        auth.logout();
      }
      return throwError(() => err);
    }),
  );
};
