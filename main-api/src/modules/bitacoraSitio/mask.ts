/**
 * Enmascarado de datos personales de terceros en la ficha del sitio.
 * Función pura (sin dependencias de DB) para poder testearla aislada.
 */
import type { FichaSitio } from './repo';

/**
 * Enmascara datos personales (tel/email de contactos) para CUALQUIER rol.
 * Nadie recibe el dato real en la lectura: se revela puntualmente por el
 * endpoint con 2FA y auditoría. Minimización + accountability (Ley 21.719).
 * Nombre y rol se mantienen (necesarios para identificar a quién contactar).
 */
export function maskFicha(f: FichaSitio): FichaSitio {
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
