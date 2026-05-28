import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { VentisquerosComponent } from '../../ventisqueros/ventisqueros';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord } from '@emeltec/shared';

@Component({
  selector: 'app-companies-events-panel',
  standalone: true,
  imports: [CommonModule, VentisquerosComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (coldRoomSite(); as coldSite) {
      <app-ventisqueros
        [siteId]="coldSite.id"
        [siteName]="coldSite.descripcion"
        [embedded]="true"
        view="eventos"
      />
    } @else {
      <div
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center"
      >
        <span class="material-symbols-outlined text-5xl text-slate-300">notifications_paused</span>
        <h3 class="mt-4 text-body-sm font-semibold text-slate-500">Sin eventos registrados</h3>
        <p class="mt-1 text-caption text-slate-400">
          Las alertas y eventos del sitio aparecerán aquí.
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

  private _sites = signal<SiteRecord[]>([]);

  readonly coldRoomSite = computed<SiteRecord | null>(() => {
    const list = this._sites();
    if (list.length !== 1) return null;
    return normalizeSiteType(list[0]?.tipo_sitio) === 'camara_frio' ? list[0] : null;
  });
}
