import { Component } from '@angular/core';
import { SkeletonComponent } from '../../../components/ui/skeleton';
import { KpiStripSkeletonComponent } from '../../../components/ui/kpi-strip-skeleton';
import { WellDiagramSkeletonComponent } from '../../../components/ui/well-diagram-skeleton';
import { ChartSkeletonComponent } from '../../../components/ui/chart-skeleton';
import { TableSkeletonComponent } from '../../../components/ui/table-skeleton';

/**
 * Skeleton for company-site-water-detail page during initial load (before siteContext).
 *
 * Matches the real page structure: header card (back arrow + title + badges + settings),
 * tabs row, and active DGA tab content (KPI strip + pozo/chart grid + Registros table).
 */
@Component({
  selector: 'app-companies-site-detail-skeleton',
  standalone: true,
  imports: [
    SkeletonComponent,
    KpiStripSkeletonComponent,
    WellDiagramSkeletonComponent,
    ChartSkeletonComponent,
    TableSkeletonComponent,
  ],
  template: `
    <div class="mx-auto max-w-[1360px] space-y-3" role="status" aria-label="Cargando sitio">
      <!-- Header card -->
      <section
        class="rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      >
        <div
          class="grid gap-3 border-b border-slate-100 px-3 py-3 xl:grid-cols-[minmax(360px,1fr)_auto] xl:items-center"
        >
          <div class="flex min-w-0 items-center gap-3">
            <app-skeleton class="h-11 w-11 shrink-0 rounded-xl" />
            <div class="min-w-0 space-y-2">
              <app-skeleton class="h-4 w-56 rounded" />
              <app-skeleton class="h-3 w-32 rounded" />
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 xl:justify-end">
            <app-skeleton class="h-9 w-32 rounded-lg" />
            <app-skeleton class="h-9 w-36 rounded-lg" />
            <app-skeleton class="h-8 w-8 rounded-lg" />
          </div>
        </div>

        <!-- Tabs row -->
        <div class="flex items-center gap-5 px-3 py-3">
          @for (_ of tabs; track $index) {
            <app-skeleton class="h-5 w-20 rounded" />
          }
        </div>
      </section>

      <!-- Active tab content (mimics DGA tabpanel) -->
      <div class="flex flex-col gap-6">
        <app-kpi-strip-skeleton />

        <section class="grid grid-cols-1 gap-5 xl:grid-cols-[520px_minmax(0,1fr)]">
          <div class="flex flex-col gap-5">
            <article
              class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <app-skeleton class="mb-3 h-3 w-32 rounded" />
              <app-well-diagram-skeleton />
            </article>
          </div>

          <div class="flex flex-col gap-5">
            <article
              class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div class="mb-4 flex items-start justify-between">
                <app-skeleton class="h-4 w-40 rounded" />
                <app-skeleton class="h-3 w-24 rounded" />
              </div>
              <app-chart-skeleton [bars]="12" [height]="220" />
            </article>

            <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <app-skeleton class="mb-3 h-4 w-32 rounded" />
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                @for (_ of quickActions; track $index) {
                  <app-skeleton class="h-14 rounded-lg" />
                }
              </div>
            </article>
          </div>
        </section>

        <!-- Registros DGA table -->
        <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div class="space-y-2">
              <app-skeleton class="h-4 w-40 rounded" />
              <app-skeleton class="h-3 w-56 rounded" />
            </div>
            <app-skeleton class="h-9 w-32 rounded-lg" />
          </div>
          <div class="p-3">
            <app-table-skeleton [rows]="6" [columns]="5" [showHeader]="false" />
          </div>
        </section>
      </div>
    </div>
  `,
})
export class CompaniesSiteDetailSkeletonComponent {
  readonly tabs = [0, 1, 2, 3, 4];
  readonly quickActions = [0, 1, 2, 3];
}
