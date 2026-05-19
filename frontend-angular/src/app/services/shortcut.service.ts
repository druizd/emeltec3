import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Atajos disponibles. role: opcional gate por rol. Cuando `role` está
 * presente, el atajo solo dispara para usuarios con ese rol.
 */
export interface ShortcutBinding {
  /** Combo legible para mostrar en palette. Ej: "g d", "?". */
  combo: string;
  /** Descripción en español. */
  label: string;
  /** Sección agrupada en palette (Navegación, Ayuda, etc.). */
  group: 'Navegación' | 'Ayuda';
  /** Roles permitidos. Si vacío, todos. */
  roles?: Array<'SuperAdmin' | 'Admin' | 'Gerente' | 'Cliente'>;
  /** Callback que ejecuta el atajo. Recibe el dispatcher. */
  action: () => void;
}

/**
 * Servicio singleton para atajos de teclado globales.
 *
 * Patrón g-lead-in: presionar `g` (sin modificadores, fuera de inputs)
 * abre una ventana de 500ms para la segunda tecla. Después de 500ms o
 * un segundo input, la ventana cierra.
 *
 * `?` y `⌘K` / `Ctrl+K` abren la paleta sin lead-in.
 *
 * Skip cuando focus está en input/textarea/select/[contenteditable].
 */
@Injectable({ providedIn: 'root' })
export class ShortcutService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /** Estado de visibilidad de la paleta. */
  readonly paletteOpen = signal(false);

  /** Lista de bindings; computed filtra por rol del usuario actual. */
  readonly visibleBindings = computed<ShortcutBinding[]>(() => {
    const user = this.auth.user();
    if (!user) return [];
    return this.bindings.filter(
      (b) =>
        !b.roles || b.roles.includes(user.tipo as 'SuperAdmin' | 'Admin' | 'Gerente' | 'Cliente'),
    );
  });

  private leadIn: 'g' | null = null;
  private leadInTimer = 0;
  private readonly LEAD_IN_MS = 500;

  private readonly bindings: ShortcutBinding[] = [
    {
      combo: 'g d',
      label: 'Ir al dashboard',
      group: 'Navegación',
      action: () => this.router.navigate(['/dashboard']),
    },
    {
      combo: 'g m',
      label: 'Ir a monitoreo (instalaciones)',
      group: 'Navegación',
      action: () => this.router.navigate(['/companies']),
    },
    {
      combo: 'g a',
      label: 'Ir a administración',
      group: 'Navegación',
      roles: ['SuperAdmin'],
      action: () => this.router.navigate(['/administration']),
    },
    {
      combo: 'g r',
      label: 'Ir a revisión DGA',
      group: 'Navegación',
      roles: ['SuperAdmin', 'Admin'],
      action: () => this.router.navigate(['/dga-review']),
    },
    {
      combo: '?',
      label: 'Abrir esta paleta de atajos',
      group: 'Ayuda',
      action: () => this.openPalette(),
    },
    {
      combo: '⌘K  /  Ctrl K',
      label: 'Abrir esta paleta de atajos',
      group: 'Ayuda',
      action: () => this.openPalette(),
    },
  ];

  constructor() {
    this.document.addEventListener('keydown', this.handler);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('keydown', this.handler);
      window.clearTimeout(this.leadInTimer);
    });
  }

  openPalette(): void {
    this.paletteOpen.set(true);
  }

  closePalette(): void {
    this.paletteOpen.set(false);
  }

  /**
   * Despacha una acción directa (usado por la paleta cuando el usuario
   * clickea un item). Cierra la paleta y ejecuta el callback.
   */
  dispatch(binding: ShortcutBinding): void {
    this.closePalette();
    binding.action();
  }

  private handler = (event: KeyboardEvent): void => {
    // Skip si el foco está en un editable surface — el usuario está tipeando.
    if (this.isTypingTarget(event.target)) return;

    // ⌘K / Ctrl+K abre paleta sin lead-in
    if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      this.openPalette();
      return;
    }

    // Skip otros combos con modificadores (Ctrl/Cmd/Alt/Shift+Tab etc)
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // ? abre paleta (Shift+/ en US/ES layout). Aceptar también el shift
    // explícito porque Shift es necesario para ? — la guard previa solo
    // bloquea Cmd/Ctrl/Alt.
    if (event.key === '?') {
      event.preventDefault();
      this.openPalette();
      return;
    }

    // Si la paleta está abierta, el modal maneja su propio teclado.
    if (this.paletteOpen()) return;

    // g lead-in
    if (event.key === 'g' && !this.leadIn) {
      this.leadIn = 'g';
      window.clearTimeout(this.leadInTimer);
      this.leadInTimer = window.setTimeout(() => {
        this.leadIn = null;
      }, this.LEAD_IN_MS);
      return;
    }

    // Segunda tecla del combo g-X
    if (this.leadIn === 'g') {
      window.clearTimeout(this.leadInTimer);
      this.leadIn = null;
      const combo = `g ${event.key.toLowerCase()}`;
      const match = this.visibleBindings().find((b) => b.combo === combo);
      if (match) {
        event.preventDefault();
        match.action();
      }
    }
  };

  /**
   * Aceptamos input/textarea/select/[contenteditable]. Excluimos botones,
   * checkboxes, radios — esos no consumen text input pero pueden tener foco.
   */
  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (target as HTMLInputElement).type;
      // text/email/number/search/password/url/tel/date/time/datetime-local
      const textTypes = new Set([
        'text',
        'email',
        'number',
        'search',
        'password',
        'url',
        'tel',
        'date',
        'time',
        'datetime-local',
        'month',
        'week',
      ]);
      return textTypes.has(type);
    }
    if (tag === 'textarea' || tag === 'select') return true;
    return target.isContentEditable;
  }
}
