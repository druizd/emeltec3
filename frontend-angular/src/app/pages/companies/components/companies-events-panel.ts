import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { WaterDetailAlertasComponent } from './water-detail-alertas/water-detail-alertas';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord } from '@emeltec/shared';

@Component({
  selector: 'app-companies-events-panel',
  standalone: true,
  imports: [CommonModule, WaterDetailAlertasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selectedSite(); as site) {
      <app-water-detail-alertas [sitioId]="site.id" [empresaId]="empresaId" />
    } @else {
      <div
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center"
      >
        <span class="material-symbols-outlined text-5xl text-slate-300">notifications_paused</span>
        <h3 class="mt-4 text-body-sm font-semibold text-slate-500">Sin sitio seleccionado</h3>
        <p class="mt-1 text-caption text-slate-400">
          Selecciona una subempresa con sitios para gestionar alertas.
        </p>
      </div>
    }
  `,
})
export class CompaniesEventsPanelComponent {
  @Input() set sites(value: SiteRecord[]) {
    this._sites.set(value || []);
  }
  get sites(): SiteRecord[] {
    return this._sites();
  }
  @Input() subEmpresaId = '';
  @Input() empresaId = '';

  private _sites = signal<SiteRecord[]>([]);

  readonly coldRoomSites = computed<SiteRecord[]>(() => {
    return this._sites().filter((s) => normalizeSiteType(s?.tipo_sitio) === 'camara_frio');
  });

  readonly coldRoomSite = computed<SiteRecord | null>(() => {
    const list = this._sites();
    if (list.length === 0) return null;
    const cold = this.coldRoomSites();
    if (cold.length === 0 || cold.length !== list.length) return null;
    return cold[0];
  });

  readonly selectedSite = computed<SiteRecord | null>(() => {
    const cold = this.coldRoomSite();
    if (cold) return cold;
    const list = this._sites();
    return list[0] ?? null;
  });
}
