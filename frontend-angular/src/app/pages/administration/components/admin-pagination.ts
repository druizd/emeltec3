import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-admin-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3"
    >
      <p class="text-xs font-bold text-slate-400">
        Mostrando {{ startItem() }}-{{ endItem() }} de {{ total() }}
      </p>
      @if (totalPages() > 1) {
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            (click)="goto(page() - 1)"
            [disabled]="page() === 1"
            class="admin-pag-btn"
          >
            Anterior
          </button>
          @for (p of pages(); track p) {
            <button type="button" (click)="goto(p)" [class]="btnClass(p === page())">
              {{ p }}
            </button>
          }
          <button
            type="button"
            (click)="goto(page() + 1)"
            [disabled]="page() >= totalPages()"
            class="admin-pag-btn"
          >
            Siguiente
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .admin-pag-btn {
        display: inline-flex;
        min-height: 32px;
        min-width: 32px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 0 10px;
        font-family: var(--font-body);
        font-size: 12px;
        font-weight: 600;
        color: var(--color-on-surface-variant);
        transition: all 160ms ease;
        cursor: pointer;
      }
      .admin-pag-btn:hover:not(:disabled) {
        border-color: rgba(13, 175, 189, 0.3);
        color: var(--color-primary-container);
      }
      .admin-pag-btn:active:not(:disabled) {
        transform: scale(0.97);
      }
      .admin-pag-btn:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }
      @media (prefers-reduced-motion: reduce) {
        .admin-pag-btn {
          transition: none;
        }
        .admin-pag-btn:active:not(:disabled) {
          transform: none;
        }
      }
    `,
  ],
})
export class AdminPaginationComponent {
  readonly total = input.required<number>();
  readonly page = input.required<number>();
  readonly pageSize = input<number>(10);

  readonly pageChange = output<number>();

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly startItem = computed(() => {
    const total = this.total();
    if (!total) return 0;
    return (this.clamp(this.page()) - 1) * this.pageSize() + 1;
  });

  readonly endItem = computed(() =>
    Math.min(this.total(), this.clamp(this.page()) * this.pageSize()),
  );

  readonly pages = computed(() => {
    const total = this.totalPages();
    const current = this.page();
    const start = Math.max(1, Math.min(current - 2, Math.max(1, total - 4)));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  goto(target: number): void {
    const next = this.clamp(target);
    if (next === this.page()) return;
    this.pageChange.emit(next);
  }

  btnClass(active: boolean): string {
    const base = 'admin-pag-btn';
    return active
      ? `${base} border-[rgba(13,175,189,0.45)] bg-primary-tint-10 text-primary-container`
      : base;
  }

  private clamp(target: number): number {
    return Math.max(1, Math.min(target, this.totalPages()));
  }
}
