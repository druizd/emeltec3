import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CompaniesEventsPanelComponent } from '../components/companies-events-panel';
import { CompaniesGeneralPanelComponent } from '../components/companies-general-panel';
import { CompaniesInstallationsPanelComponent } from '../components/companies-installations-panel';
import { CompaniesPageHeaderComponent } from '../components/companies-page-header';
import { CompaniesTabItem, CompaniesTabNavComponent } from '../components/companies-tab-nav';
import { installationsTabUi, normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord, SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-companies-cliente-view',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesPageHeaderComponent,
    CompaniesTabNavComponent,
    CompaniesGeneralPanelComponent,
    CompaniesInstallationsPanelComponent,
    CompaniesEventsPanelComponent,
  ],
  template: `
    <div class="min-h-full bg-[#F0F2F5] px-5 pb-8 pt-6 md:px-7 xl:px-8">
      <app-companies-page-header
        [selectedSubCompany]="selectedSubCompany"
        [sitesCount]="sites.length"
        [sites]="sites"
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
      />

      <app-companies-tab-nav
        [tabs]="tabsComputed()"
        [activeTab]="activeTab"
        variant="superadmin"
        (activeTabChange)="activeTabChange.emit($event)"
      />

      @if (activeTab === 'general') {
        <app-companies-general-panel [sites]="sites" [subEmpresaId]="subEmpresaId" />
      }

      @if (activeTab === 'instalaciones') {
        <app-companies-installations-panel
          [sites]="sites"
          [loading]="loading"
          [contextLabel]="selectedSubCompany?.nombre || ''"
          variant="superadmin"
          (siteSelected)="siteSelected.emit($event)"
        />
      }

      @if (activeTab === 'eventos') {
        <app-companies-events-panel
          [sites]="sites"
          [subEmpresaId]="subEmpresaId"
          [empresaId]="empresaId"
        />
      }
    </div>
  `,
})
export class CompaniesClienteViewComponent {
  @Input() activeTab = 'instalaciones';
  @Input() selectedSubCompany: SubCompanyNode | null = null;
  @Input() set sites(value: SiteRecord[]) {
    this._sitesArr = value || [];
    this._sites.set(value || []);
  }
  get sites(): SiteRecord[] {
    return this._sitesArr;
  }
  private _sitesArr: SiteRecord[] = [];
  private _sites = signal<SiteRecord[]>([]);

  @Input() loading = false;
  @Input() subEmpresaId = '';
  @Input() empresaId = '';

  @Output() activeTabChange = new EventEmitter<string>();
  @Output() siteSelected = new EventEmitter<SiteRecord>();

  readonly isColdRoom = computed(() => {
    const list = this._sites();
    return list.length === 1 && normalizeSiteType(list[0]?.tipo_sitio) === 'camara_frio';
  });

  /** La empresa tiene al menos una cámara de frío → habilita el tab
   * "Configurar alarmas" (motor cold-room, transversal por salas). Las
   * alarmas de pozos de agua se gestionan por sitio, en el detalle del pozo. */
  readonly hasColdRoom = computed(() =>
    this._sites().some((s) => normalizeSiteType(s?.tipo_sitio) === 'camara_frio'),
  );

  readonly tabsComputed = computed<CompaniesTabItem[]>(() => {
    const inst = installationsTabUi(this._sites());
    return [
      { key: 'general', label: 'General', icon: 'grid_view' },
      { key: 'instalaciones', label: inst.label, icon: inst.icon },
      ...(this.hasColdRoom()
        ? [{ key: 'eventos', label: 'Configurar alarmas', icon: 'notifications' }]
        : []),
    ];
  });

  headerTitle(): string {
    if (this.activeTab === 'instalaciones') return installationsTabUi(this.sites).label;
    if (this.activeTab === 'eventos') return 'Configurar alarmas';
    return 'General';
  }

  headerSubtitle(): string {
    if (this.activeTab === 'instalaciones') {
      return this.isColdRoom()
        ? 'Concentradores TAP del sitio'
        : this.sites.length + ' sitios registrados';
    }
    if (this.activeTab === 'eventos') return 'Reglas y eventos activos';
    return 'Resumen de la división';
  }
}
