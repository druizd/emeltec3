/**
 * Análisis — Reportes recientes del sitio.
 *
 * Lista los últimos N envíos DGA reales del sitio (estatus + comprobante)
 * con enlace al portal SNIA. Para descarga masiva CSV usar "Generar
 * Reporte DGA" en el header del water-detail.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  AnalisisService,
  type ReporteReciente,
} from '../../../../services/analisis.service';

@Component({
  selector: 'app-analisis-reportes',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <header
        class="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <div class="flex items-center gap-3">
          <span class="material-symbols-outlined text-violet-600">download</span>
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Reportes recientes
            </p>
            <p class="text-sm font-bold text-slate-700">{{ reportes().length }} envíos DGA</p>
          </div>
        </div>
        <button
          type="button"
          (click)="reload()"
          class="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
        >
          Recargar
        </button>
      </header>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Fecha · Hora
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Caudal
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Totalizador
                </th>
                <th
                  class="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Nivel
                </th>
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Estado
                </th>
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Comprobante
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @if (loading()) {
                <tr>
                  <td colspan="6" class="px-3 py-6 text-center text-sm text-slate-400">
                    Cargando…
                  </td>
                </tr>
              } @else if (reportes().length === 0) {
                <tr>
                  <td colspan="6" class="px-3 py-6 text-center text-sm italic text-slate-400">
                    Sin envíos registrados todavía.
                  </td>
                </tr>
              } @else {
                @for (r of reportes(); track r.ts) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {{ r.fecha }} {{ r.hora }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                      {{ r.caudal_instantaneo || '—' }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                      {{ r.flujo_acumulado || '—' }}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                      {{ r.nivel_freatico || '—' }}
                    </td>
                    <td class="px-3 py-2">
                      <span
                        [class]="
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ' +
                          estadoClass(r.estatus)
                        "
                      >
                        <span [class]="'h-1.5 w-1.5 rounded-full ' + estadoDot(r.estatus)"></span>
                        {{ estadoLabel(r.estatus) }}
                      </span>
                    </td>
                    <td class="px-3 py-2 font-mono text-[10px] text-slate-500">
                      {{ r.comprobante ? (r.comprobante | slice: 0 : 14) + '…' : '—' }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>

      <p class="text-[11px] italic text-slate-400">
        Para descarga masiva CSV usá el botón
        <span class="font-semibold text-violet-700">Generar Reporte DGA</span> del header del
        pozo.
      </p>
    </div>
  `,
})
export class AnalisisReportesComponent implements OnInit {
  private readonly api = inject(AnalisisService);

  readonly sitioId = input<string>('');

  readonly reportes = signal<ReporteReciente[]>([]);
  readonly loading = signal<boolean>(false);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.loading.set(true);
    this.api.getReportesRecientes(this.sitioId(), 50).subscribe({
      next: (rows) => {
        this.reportes.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  estadoLabel(estatus: string): string {
    const map: Record<string, string> = {
      enviado: 'Enviado',
      pendiente: 'Pendiente',
      vacio: 'Vacío',
      requires_review: 'Revisar',
      enviando: 'Enviando',
      rechazado: 'Rechazado',
      fallido: 'Fallido',
    };
    return map[estatus] ?? estatus;
  }

  estadoClass(estatus: string): string {
    if (estatus === 'enviado') return 'bg-emerald-50 text-emerald-700';
    if (estatus === 'rechazado' || estatus === 'fallido') return 'bg-rose-50 text-rose-700';
    if (estatus === 'requires_review') return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-600';
  }

  estadoDot(estatus: string): string {
    if (estatus === 'enviado') return 'bg-emerald-500';
    if (estatus === 'rechazado' || estatus === 'fallido') return 'bg-rose-500';
    if (estatus === 'requires_review') return 'bg-amber-500';
    return 'bg-slate-400';
  }
}
