import { Component, Input } from '@angular/core';
import { SkeletonComponent } from './skeleton';

/**
 * Chart placeholder — Y-axis label column + N bars (varying heights for realism)
 * + X-axis label row.
 *
 * Heights cycle through a fixed pattern so the skeleton suggests data variance.
 */
@Component({
  selector: 'app-chart-skeleton',
  standalone: true,
  imports: [SkeletonComponent],
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col gap-2"
      role="status"
      [attr.aria-label]="'Cargando gráfico'"
    >
      <div class="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
        <!-- Y axis labels -->
        <div class="flex flex-col justify-between py-1">
          @for (_ of yLabels; track $index) {
            <app-skeleton class="h-2 w-8 rounded"></app-skeleton>
          }
        </div>

        <!-- Bars -->
        <div
          class="flex items-end justify-between gap-1.5 border-l border-slate-100 pl-2"
          [style.height.px]="height"
        >
          @for (h of barHeights; track $index) {
            <app-skeleton
              class="flex-1 rounded-t-sm"
              [style.height.%]="h"
            ></app-skeleton>
          }
        </div>
      </div>

      <!-- X axis labels -->
      <div class="ml-[50px] flex justify-between gap-1.5">
        @for (_ of barHeights; track $index) {
          <app-skeleton class="h-2 w-6 rounded"></app-skeleton>
        }
      </div>
    </div>
  `,
})
export class ChartSkeletonComponent {
  @Input() bars = 12;
  @Input() height = 180;

  readonly yLabels = [0, 1, 2, 3];

  private readonly heightPattern = [55, 78, 42, 90, 63, 71, 38, 84, 50, 66, 73, 45];

  get barHeights(): number[] {
    return Array.from({ length: this.bars }, (_, i) => this.heightPattern[i % this.heightPattern.length]);
  }
}
