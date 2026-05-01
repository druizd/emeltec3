import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-companies-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mb-8">
      <div class="flex justify-between items-start gap-4">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 bg-primary-container rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <span class="material-symbols-outlined text-white text-3xl">corporate_fare</span>
          </div>

          <div>
            <h1 class="text-3xl font-black text-primary leading-none tracking-tight">
              {{ selectedSubCompany?.nombre || 'Seleccione una division' }}
            </h1>
            <p class="text-sm text-slate-400 mt-2 font-bold uppercase tracking-wider">
              {{ sitesCount }} Instalaciones
            </p>
          </div>
        </div>

        @if (showReportButton) {
          <div class="flex gap-3">
            <button
              type="button"
              class="bg-white border border-slate-200 px-4 py-2 rounded-xl text-primary text-xs font-black hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm uppercase"
            >
              <span class="material-symbols-outlined text-lg">download</span>
              Reporte
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class CompaniesPageHeaderComponent {
  @Input() selectedSubCompany: any = null;
  @Input() sitesCount = 0;
  @Input() showReportButton = false;
}
