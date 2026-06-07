import { CommonModule } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord, SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-companies-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (coldRoomSite(); as coldSite) {
      <div
        class="cr-site-header mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-2.5 shadow-sm"
      >
        <div class="cr-module-icon flex h-9 w-9 shrink-0 items-center justify-center">
          <span class="material-symbols-outlined text-[18px] text-[#0284C7]">ac_unit</span>
        </div>
        <div class="min-w-0">
          <div class="cr-site-title truncate">
            {{ selectedSubCompany?.nombre || '' }}
            @if (coldSite.descripcion) {
              · {{ coldSite.descripcion }}
            }
          </div>
          <div class="cr-site-subtitle truncate">
            Cámara frío · monitoreo de temperatura y humedad en vivo
          </div>
        </div>
      </div>
    } @else {
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
    }
  `,
  styles: [
    `
      .cr-site-header {
        border-bottom: 2px solid #0284c7;
      }
      .cr-module-icon {
        border-radius: 9px;
        background: rgba(2, 132, 199, 0.1);
        border: 1px solid rgba(2, 132, 199, 0.25);
      }
      .cr-site-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
        line-height: 1.1;
      }
      .cr-site-subtitle {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .cr-chip-live {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 500;
        color: #16a34a;
      }
      .cr-chip-live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #22c55e;
        display: inline-block;
      }
      .cr-chip-time {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        color: #2563eb;
        font-family: 'JetBrains Mono', monospace;
      }
    `,
  ],
})
export class CompaniesPageHeaderComponent {
  @Input() selectedSubCompany: SubCompanyNode | null = null;
  @Input() sitesCount = 0;
  @Input() title = 'Salas';
  @Input() subtitle = '';
  @Input() set sites(value: SiteRecord[]) {
    this._sites.set(value || []);
  }
  get sites(): SiteRecord[] {
    return this._sites();
  }
  private _sites = signal<SiteRecord[]>([]);

  readonly coldRoomSite = computed<SiteRecord | null>(() => {
    const list = this._sites();
    if (list.length === 0) return null;
    const cold = list.filter((s) => normalizeSiteType(s?.tipo_sitio) === 'camara_frio');
    if (cold.length === 0 || cold.length !== list.length) return null;
    return cold[0];
  });

  readonly nowLabel = signal<string>('');

  constructor() {
    this.updateTime();
    setInterval(() => this.updateTime(), 30_000);
  }

  private updateTime(): void {
    const d = new Date();
    const months = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ];
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    this.nowLabel.set(`${day} ${months[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`);
  }
}
