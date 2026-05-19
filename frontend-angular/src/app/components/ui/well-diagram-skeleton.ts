import { Component } from '@angular/core';
import { SkeletonComponent } from './skeleton';

/**
 * Well diagram placeholder — hints the cross-section shape:
 * - Vertical well column with partial water fill
 * - Side labels (Superficie, Nivel Freático, Sensor)
 * - Right-side stats column
 *
 * Matches min-h-[360px] container of the real well-diagram SVG.
 */
@Component({
  selector: 'app-well-diagram-skeleton',
  standalone: true,
  imports: [SkeletonComponent],
  host: { class: 'block' },
  template: `
    <div
      class="flex min-h-[360px] flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50 p-4"
      role="status"
      aria-label="Cargando diagrama del pozo"
    >
      <div class="flex items-center justify-between">
        <app-skeleton class="h-3 w-32 rounded"></app-skeleton>
        <app-skeleton class="h-3 w-16 rounded"></app-skeleton>
      </div>

      <div class="grid flex-1 grid-cols-[80px_minmax(0,1fr)_120px] gap-3">
        <!-- Left labels column -->
        <div class="flex flex-col justify-between py-4">
          <app-skeleton class="h-2.5 w-16 rounded"></app-skeleton>
          <app-skeleton class="h-2.5 w-14 rounded"></app-skeleton>
          <app-skeleton class="h-2.5 w-12 rounded"></app-skeleton>
        </div>

        <!-- Well column -->
        <div class="relative flex flex-col items-center">
          <div
            class="relative w-20 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            <!-- Water fill (bottom half) -->
            <div class="absolute inset-x-0 bottom-0 h-2/3">
              <app-skeleton class="h-full w-full rounded-none"></app-skeleton>
            </div>
            <!-- Sensor marker -->
            <div class="absolute inset-x-0 bottom-1/3 flex justify-center">
              <app-skeleton class="h-3 w-3 rounded-full"></app-skeleton>
            </div>
          </div>
        </div>

        <!-- Right stats column -->
        <div class="flex flex-col justify-between gap-2 py-2">
          @for (_ of stats; track $index) {
            <div class="space-y-1.5 rounded-md border border-slate-200 bg-white p-2">
              <app-skeleton class="h-2 w-12 rounded"></app-skeleton>
              <app-skeleton class="h-4 w-16 rounded"></app-skeleton>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class WellDiagramSkeletonComponent {
  readonly stats = [0, 1, 2, 3, 4];
}
