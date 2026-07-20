/**
 * Enmascarado de datos personales de terceros en la ficha del sitio.
 * Función pura (sin dependencias de DB) para poder testearla aislada.
 */
import type { FichaSitio } from './repo';

// Roles internos de Emeltec que ven la ficha completa. Cualquier otro rol
// (Cliente, Gerente, Empresa, SubEmpresa o rol desconocido/undefined) recibe
// la versión enmascarada. Whitelist fail-closed: un rol nuevo entra
// enmascarado por defecto, no filtra datos de terceros.
export const ROLES_FICHA_COMPLETA = new Set(['SuperAdmin', 'Admin', 'Vendedor']);

/**
 * Enmascara datos personales de terceros (tel/email de contactos) para roles
 * externos. El dato real NO sale del servidor; se revela por endpoint con 2FA.
 * Minimización + accountability (Ley 21.719).
 */
export function maskFichaForRole(f: FichaSitio, tipo: string | undefined): FichaSitio {
  if (tipo && ROLES_FICHA_COMPLETA.has(tipo)) return f;
  return {
    ...f,
    contactos: f.contactos.map((c) => ({
      nombre: c.nombre,
      rol: c.rol,
      telefono: null,
      email: null,
      datos_ocultos: Boolean(c.telefono || c.email),
    })),
  };
}
