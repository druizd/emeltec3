import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-companies-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div class="space-y-2">
        <p class="text-[12px] font-black uppercase tracking-[0.24em] text-cyan-600/80">
          {{ selectedSubCompany?.nombre || 'División seleccionada' }}
        </p>
        <h1 class="text-[2.35rem] font-black leading-none text-slate-800">
          {{ title }}
        </h1>
        <p class="text-xs font-medium text-slate-400">{{ subtitle }}</p>
      </div>

      @if (showReportButton) {
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-[0_10px_25px_rgba(15,23,42,0.06)] transition-all hover:border-cyan-200 hover:text-cyan-700"
        >
          <span class="material-symbols-outlined text-lg">download</span>
          Reporte
        </button>
      }
    </div>
  `,
})
export class CompaniesPageHeaderComponent {
  @Input() selectedSubCompany: any = null;
  @Input() sitesCount = 0;
  @Input() title = 'Instalaciones';
  @Input() subtitle = '';
  @Input() showReportButton = false;
}
