import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-companies-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div class="space-y-2">
        <p class="text-[10px] font-bold uppercase tracking-[0.1em] text-[#94A3B8]">
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
          class="inline-flex items-center gap-2 rounded-md border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm font-semibold text-[#1E293B] shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all hover:border-[#0DAFBD] hover:text-[#0899A5]"
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
