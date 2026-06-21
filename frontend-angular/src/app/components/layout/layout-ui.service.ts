import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * Estado UI compartido del shell entre header, sidebar y layout. Hoy solo
 * gobierna el drawer del sidebar en mobile/tablet (<lg): el header lo abre
 * con la hamburguesa, el layout pinta el backdrop y el sidebar se traslada.
 *
 * Se auto-cierra en cada navegación para que al elegir un sitio/ruta el
 * drawer desaparezca sin acoplar la lógica de cierre a cada acción.
 */
@Injectable({ providedIn: 'root' })
export class LayoutUiService {
  private readonly router = inject(Router);

  readonly mobileNavOpen = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.mobileNavOpen.set(false));
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((v) => !v);
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }
}
