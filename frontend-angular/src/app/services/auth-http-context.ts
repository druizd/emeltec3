import { HttpContextToken } from '@angular/common/http';

/**
 * Fuerza al authInterceptor a enviar el token REAL del usuario aunque haya un
 * token "ver como" activo (emitir uno nuevo, listar el árbol completo para el
 * selector de preview). El token "ver como" nunca debe usarse en esas llamadas.
 */
export const USE_REAL_TOKEN = new HttpContextToken<boolean>(() => false);

/** Clave de sessionStorage del token "ver como" (junto al contexto `view_as_role`). */
export const VIEW_AS_TOKEN_STORAGE_KEY = 'view_as_token';
