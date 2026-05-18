import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { ShortcutBinding, ShortcutService } from '../../services/shortcut.service';

/**
 * Paleta de atajos de teclado.
 *
 * Triggers (manejados por ShortcutService):
 *   ?         abre paleta
 *   ⌘K / Ctrl+K abre paleta
 *   Esc       cierra paleta (Host listener acá)
 *
 * Lista solo los atajos visibles para el rol del usuario actual. Click
 * en un item ejecuta el binding y cierra la paleta.
 */
@Component({
  selector: 'app-shortcut-palette',
  standalone: true,
  imports: [CommonModule, A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (service.paletteOpen()) {
      <div
        class="fixed inset-0 z-[150] flex items-start justify-center bg-slate-950/55 px-4 pt-20 backdrop-blur-sm"
        (click)="service.closePalette()"
      >
        <section
          class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-primary-banner"
          (click)="$event.stopPropagation()"
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-palette-title"
        >
          <header class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div class="flex items-center gap-3">
              <span
                class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-tint-10 text-primary-container"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                  >keyboard</span
                >
              </span>
              <div>
                <h2 id="shortcut-palette-title" class="text-body font-semibold text-on-surface">
                  Atajos de teclado
                </h2>
                <p class="text-caption-xs text-on-surface-muted">
                  Click para ejecutar o presiona la tecla
                </p>
              </div>
            </div>
            <button
              type="button"
              (click)="service.closePalette()"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Cerrar paleta"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
            </button>
          </header>

          <div class="max-h-[60vh] overflow-y-auto px-5 py-4">
            @if (groupedBindings().length === 0) {
              <p class="text-caption text-on-surface-muted">
                No hay atajos disponibles para tu rol actual.
              </p>
            }
            @for (group of groupedBindings(); track group.name) {
              <div class="mb-4 last:mb-0">
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  {{ group.name }}
                </p>
                <ul class="space-y-1">
                  @for (binding of group.items; track binding.combo) {
                    <li>
                      <button
                        type="button"
                        (click)="service.dispatch(binding)"
                        class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-body-sm transition-colors hover:bg-primary-tint-08 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span class="text-on-surface">{{ binding.label }}</span>
                        <kbd
                          class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 font-mono text-caption-xs font-bold text-slate-600"
                        >
                          {{ binding.combo }}
                        </kbd>
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>

          <footer
            class="border-t border-slate-100 bg-slate-50 px-5 py-3 text-caption-xs text-on-surface-muted"
          >
            Presiona <kbd class="font-mono font-bold">?</kbd> en cualquier momento para abrir esta
            paleta.
          </footer>
        </section>
      </div>
    }
  `,
})
export class ShortcutPaletteComponent {
  readonly service = inject(ShortcutService);

  /**
   * Agrupa bindings por `group` preservando el orden de declaración. Sin
   * .sort() porque queremos respetar el orden manual del array.
   */
  readonly groupedBindings = computed(() => {
    const map = new Map<string, ShortcutBinding[]>();
    for (const b of this.service.visibleBindings()) {
      const list = map.get(b.group) ?? [];
      list.push(b);
      map.set(b.group, list);
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
  });

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.service.paletteOpen()) this.service.closePalette();
  }
}
