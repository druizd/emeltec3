import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-table-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="admin-table-toolbar">
      <div>
        <p class="text-body-sm font-semibold text-slate-800">{{ title() }}</p>
        <p class="text-caption font-bold text-slate-400">{{ countLabel() }}</p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <label class="admin-search-control">
          <span class="material-symbols-outlined text-[18px]">search</span>
          <input
            type="search"
            [ngModel]="searchValue()"
            (ngModelChange)="searchChange.emit($event)"
            [ngModelOptions]="{ standalone: true }"
            [placeholder]="placeholder()"
          />
        </label>
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      .admin-table-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 1px solid var(--color-outline-variant);
        padding: 14px 16px;
      }
      .admin-search-control {
        display: flex;
        min-height: 36px;
        width: min(100%, 320px);
        align-items: center;
        gap: 8px;
        border-radius: 8px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 0 12px;
        color: var(--color-on-surface-muted);
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease;
      }
      .admin-search-control:focus-within {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px rgba(13, 175, 189, 0.15);
        color: var(--color-on-surface-variant);
      }
      .admin-search-control input {
        min-width: 0;
        flex: 1;
        border: 0;
        background: transparent;
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--color-on-surface);
        outline: none;
      }
      .admin-search-control input::placeholder {
        color: var(--color-on-surface-muted);
      }
      @media (max-width: 760px) {
        .admin-table-toolbar {
          align-items: stretch;
          flex-direction: column;
        }
        .admin-search-control {
          width: 100%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .admin-search-control {
          transition: none;
        }
      }
    `,
  ],
})
export class AdminTableToolbarComponent {
  readonly title = input.required<string>();
  readonly countLabel = input.required<string>();
  readonly searchValue = input.required<string>();
  readonly placeholder = input<string>('Buscar');

  readonly searchChange = output<string>();
}
