import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-admin-section-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-primary-container">
          {{ selected() ? selectedLabel() : newLabel() }}
        </p>
        <p class="mt-1 text-sm text-slate-500">
          {{ selected() ? selectedHint() : newHint() }}
        </p>
      </div>
      @if (selected()) {
        <button type="button" (click)="createNew.emit()" class="admin-section-header__btn">
          <span class="material-symbols-outlined text-[18px]">add</span>
          {{ buttonLabel() }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      .admin-section-header__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 8px 16px;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-on-surface-variant);
        cursor: pointer;
        transition: all 160ms ease;
      }
      .admin-section-header__btn:hover {
        border-color: rgba(13, 175, 189, 0.3);
        background: rgba(13, 175, 189, 0.04);
        color: var(--color-primary-container);
      }
      .admin-section-header__btn:active {
        transform: scale(0.98);
      }
      @media (prefers-reduced-motion: reduce) {
        .admin-section-header__btn {
          transition: none;
        }
        .admin-section-header__btn:active {
          transform: none;
        }
      }
    `,
  ],
})
export class AdminSectionHeaderComponent {
  readonly selected = input.required<boolean>();
  readonly selectedLabel = input.required<string>();
  readonly selectedHint = input.required<string>();
  readonly newLabel = input.required<string>();
  readonly newHint = input.required<string>();
  readonly buttonLabel = input<string>('Nueva');

  readonly createNew = output<void>();
}
