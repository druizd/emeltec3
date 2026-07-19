import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { CompaniesAlarmRulesPanelComponent } from './companies-alarm-rules-panel';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord } from '@emeltec/shared';

@Component({
  selector: 'app-companies-events-panel',
  standalone: true,
  imports: [CommonModule, CompaniesAlarmRulesPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isColdRoomContext()) {
      <app-companies-alarm-rules-panel
        [coldRoomSiteIds]="coldRoomSiteIdList()"
        [siteId]="primarySiteId()"
      />
    } @else {
      <div
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center"
      >
        <span class="material-symbols-outlined text-5xl text-slate-300" aria-hidden="true">notifications_paused</span>
        <h3 class="mt-4 text-body-sm font-semibold text-slate-500">
          Sin cámaras de frío en esta empresa
        </h3>
        <p class="mt-1 text-caption text-slate-400">
          Las alarmas de pozos se configuran en cada pozo, desde su pestaña “Alertas”.
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

  // Considera contexto cold-room cuando hay AL MENOS un sitio cold-room.
  // El panel de reglas es transversal (no por sitio), evalúa todas las salas.
  readonly isColdRoomContext = computed<boolean>(() => this.coldRoomSites().length > 0);

  readonly coldRoomSiteIdList = computed<string[]>(() => this.coldRoomSites().map((s) => s.id));

  readonly primarySiteId = computed<string>(() => this.coldRoomSites()[0]?.id || '');
}
