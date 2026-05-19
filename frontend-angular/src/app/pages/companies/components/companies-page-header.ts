import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-companies-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div class="space-y-2">
        <p class="text-caption-xs font-bold uppercase tracking-[0.1em] text-[#94A3B8]">
          {{ selectedSubCompany?.nombre || 'División seleccionada' }}
        </p>
        <h1
          class="text-h4 font-bold leading-tight tracking-[0.03em] text-[#1E293B]"
          style="font-family: 'Josefin Sans', sans-serif;"
        >
          {{ title }}
        </h1>
        <p class="text-body-sm text-[#64748B]">{{ subtitle }}</p>
      </div>
    </div>
  `,
})
export class CompaniesPageHeaderComponent {
  @Input() selectedSubCompany: SubCompanyNode | null = null;
  @Input() sitesCount = 0;
  @Input() title = 'Instalaciones';
  @Input() subtitle = '';
}
