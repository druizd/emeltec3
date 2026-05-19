import { Component } from '@angular/core';
import { SkeletonComponent } from './skeleton';

/**
 * KPI strip placeholder — 4 cards matching real KPI strip layout
 * (grid-cols-1 md:grid-cols-2 xl:grid-cols-4, gap-2).
 *
 * Each card mimics the visual mass of a real KPI card: label bone + value bone + helper bone.
 */
@Component({
  selector: 'app-kpi-strip-skeleton',
  standalone: true,
  imports: [SkeletonComponent],
  host: { class: 'block' },
  template: `
    <section
      class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4"
      role="status"
      aria-label="Cargando indicadores"
    >
      @for (_ of cards; track $index) {
        <article
          class="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <app-skeleton class="h-3 w-20 rounded"></app-skeleton>
          <app-skeleton class="h-8 w-16 rounded-md"></app-skeleton>
          <app-skeleton class="h-3 w-24 rounded"></app-skeleton>
        </article>
      }
    </section>
  `,
})
export class KpiStripSkeletonComponent {
  readonly cards = [0, 1, 2, 3];
}
