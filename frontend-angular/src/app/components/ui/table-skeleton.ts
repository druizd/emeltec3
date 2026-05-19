import { Component, Input } from '@angular/core';
import { SkeletonComponent } from './skeleton';

/**
 * Table placeholder — configurable rows and columns.
 *
 * <app-table-skeleton [rows]="8" [columns]="5"></app-table-skeleton>
 *
 * First column rendered narrower (date/id pattern). Last column wider (status/actions).
 * Use [showHeader]="false" to omit the header row when embedding inside an existing table chrome.
 */
@Component({
  selector: 'app-table-skeleton',
  standalone: true,
  imports: [SkeletonComponent],
  host: { class: 'block' },
  template: `
    <div
      class="w-full overflow-hidden rounded-lg border border-slate-100 bg-white"
      role="status"
      aria-label="Cargando tabla"
    >
      @if (showHeader) {
        <div class="flex items-center gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3">
          @for (_ of columnIndices; track $index) {
            <app-skeleton
              class="h-2.5 rounded"
              [style.flex]="$index === 0 ? '0 0 100px' : $index === columns - 1 ? '0 0 80px' : '1'"
            ></app-skeleton>
          }
        </div>
      }

      @for (_ of rowIndices; track $index) {
        <div class="flex items-center gap-4 border-b border-slate-50 px-4 py-3 last:border-b-0">
          @for (__ of columnIndices; track $index) {
            <app-skeleton
              class="h-3 rounded"
              [style.flex]="$index === 0 ? '0 0 100px' : $index === columns - 1 ? '0 0 80px' : '1'"
            ></app-skeleton>
          }
        </div>
      }
    </div>
  `,
})
export class TableSkeletonComponent {
  @Input() rows = 6;
  @Input() columns = 4;
  @Input() showHeader = true;

  get rowIndices(): number[] {
    return Array.from({ length: this.rows }, (_, i) => i);
  }

  get columnIndices(): number[] {
    return Array.from({ length: this.columns }, (_, i) => i);
  }
}
