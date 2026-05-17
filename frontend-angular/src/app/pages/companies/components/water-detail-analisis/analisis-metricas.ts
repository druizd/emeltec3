/**
 * Análisis — Métricas agregadas del sitio en un rango.
 * GET /api/v2/sites/:siteId/analisis/metricas?desde&hasta
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalisisService, type MetricasData } from '../../../../services/analisis.service';

function chileMonthStartDate(): string {
  const d = new Date(Date.now() - 4 * 3600 * 1000);
  return d.toISOString().slice(0, 8) + '01';
}
function chileTodayDate(): string {
  const d = new Date(Date.now() - 4 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function dateToUtcIsoStart(date: string): string {
  return `${date}T04:00:00.000Z`;
}
function dateToUtcIsoEnd(date: string): string {
  const d = new Date(`${date}T04:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return new Date(d.getTime() - 1).toISOString();
}

@Component({
  selector: 'app-analisis-metricas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      <header
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <div class="flex items-center gap-3">
          <span class="material-symbols-outlined text-violet-600">leaderboard</span>
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Rango</p>
            <p class="text-sm font-bold text-slate-700">{{ desde() }} → {{ hasta() }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-[12px]">
          <label class="grid gap-0.5">
            <span class="text-[10px] font-bold text-slate-500">Desde</span>
            <input
              type="date"
              min="2020-01-01"
              [value]="desde()"
              (change)="onDesde($event)"
              class="h-8 rounded-lg border border-slate-200 px-2 outline-none focus:border-violet-300"
            />
          </label>
          <label class="grid gap-0.5">
            <span class="text-[10px] font-bold text-slate-500">Hasta</span>
            <input
              type="date"
              min="2020-01-01"
              [value]="hasta()"
              (change)="onHasta($event)"
              class="h-8 rounded-lg border border-slate-200 px-2 outline-none focus:border-violet-300"
            />
          </label>
          <button
            type="button"
            (click)="reload()"
            [disabled]="loading()"
            class="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      </header>

      <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Total de lecturas en rango
        </p>
        <p class="mt-1 text-3xl font-black text-slate-800">
          {{ data().total_lecturas.toLocaleString('es-CL') }}
        </p>
        <p class="text-[11px] text-slate-400">
          de {{ data().variables.length }} variable(s) configurada(s)
        </p>
      </article>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Variable
                </th>
                <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Rol
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Lecturas
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Mín
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Prom
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Máx
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Último
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @if (loading()) {
                <tr>
                  <td colspan="7" class="px-3 py-6 text-center text-sm text-slate-400">
                    Calculando…
                  </td>
                </tr>
              } @else if (data().variables.length === 0) {
                <tr>
                  <td colspan="7" class="px-3 py-6 text-center text-sm italic text-slate-400">
                    Sin variables configuradas o sin lecturas en el rango.
                  </td>
                </tr>
              } @else {
                @for (v of data().variables; track v.reg_map_id) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-3 py-2 font-semibold text-slate-800">{{ v.alias }}</td>
                    <td class="px-3 py-2 text-[11px] uppercase text-slate-500">
                      {{ v.rol_dashboard || '—' }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600">
                      {{ v.count.toLocaleString('es-CL') }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                      {{ fmt(v.min) }}{{ unidadSuffix(v.unidad) }}
                    </td>
                    <td
                      class="px-3 py-2 text-right font-mono text-[12px] font-bold text-violet-700"
                    >
                      {{ fmt(v.avg) }}{{ unidadSuffix(v.unidad) }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                      {{ fmt(v.max) }}{{ unidadSuffix(v.unidad) }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[12px] text-slate-800">
                      {{ fmt(v.last) }}{{ unidadSuffix(v.unidad) }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class AnalisisMetricasComponent implements OnInit {
  private readonly api = inject(AnalisisService);

  readonly sitioId = input<string>('');

  readonly desde = signal<string>(chileMonthStartDate());
  readonly hasta = signal<string>(chileTodayDate());
  readonly loading = signal<boolean>(false);
  readonly data = signal<MetricasData>({
    desde: this.desde(),
    hasta: this.hasta(),
    total_lecturas: 0,
    variables: [],
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.loading.set(true);
    this.api
      .getMetricas(this.sitioId(), dateToUtcIsoStart(this.desde()), dateToUtcIsoEnd(this.hasta()))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  onDesde(e: Event): void {
    this.desde.set((e.target as HTMLInputElement).value);
  }
  onHasta(e: Event): void {
    this.hasta.set((e.target as HTMLInputElement).value);
  }

  fmt(n: number | null): string {
    if (n === null || !Number.isFinite(n)) return '—';
    return n.toFixed(2);
  }
  unidadSuffix(u: string | null): string {
    return u ? ` ${u}` : '';
  }
}
