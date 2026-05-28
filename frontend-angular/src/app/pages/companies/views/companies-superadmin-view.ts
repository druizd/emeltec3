import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { UserManagementComponent } from '../../../components/ui/user-management';
import { CompaniesContactsPanelComponent } from '../components/companies-contacts-panel';
import { CompaniesEventsPanelComponent } from '../components/companies-events-panel';
import { CompaniesGeneralPanelComponent } from '../components/companies-general-panel';
import { CompaniesInstallationsPanelComponent } from '../components/companies-installations-panel';
import { CompaniesPageHeaderComponent } from '../components/companies-page-header';
import { CompaniesTabItem, CompaniesTabNavComponent } from '../components/companies-tab-nav';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord, SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-companies-superadmin-view',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesPageHeaderComponent,
    CompaniesTabNavComponent,
    CompaniesGeneralPanelComponent,
    CompaniesInstallationsPanelComponent,
    CompaniesContactsPanelComponent,
    CompaniesEventsPanelComponent,
    UserManagementComponent,
  ],
  template: `
    <div class="min-h-full bg-[#F0F2F5] px-5 pb-8 pt-6 md:px-7 xl:px-8">
      <app-companies-page-header
        [selectedSubCompany]="selectedSubCompany"
        [sitesCount]="sites.length"
        [sites]="sites"
        [title]="getActiveTitle()"
        [subtitle]="getActiveSubtitle()"
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
        <app-companies-events-panel [sites]="sites" [subEmpresaId]="subEmpresaId" />
      }

      @if (activeTab === 'contactos') {
        <app-companies-contacts-panel
          [empresaId]="empresaId"
          [subEmpresaId]="subEmpresaId"
          [selectedLabel]="selectedSubCompany?.nombre || ''"
          variant="superadmin"
          (contactsCountChange)="contactsCount = $event"
        />
      }

      @if (activeTab === 'usuarios') {
        <div class="animate-in fade-in duration-500">
          <app-user-management
            [subEmpresaId]="subEmpresaId"
            [empresaId]="empresaId"
            [readOnly]="false"
          />
        </div>
      }
    </div>
  `,
})
export class CompaniesSuperAdminViewComponent {
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

  contactsCount = 0;

  readonly isColdRoom = computed(() => {
    const list = this._sites();
    return list.length === 1 && normalizeSiteType(list[0]?.tipo_sitio) === 'camara_frio';
  });

  readonly tabsComputed = computed<CompaniesTabItem[]>(() => {
    const cold = this.isColdRoom();
    return [
      { key: 'general', label: 'General', icon: 'info' },
      cold
        ? { key: 'instalaciones', label: 'TAPs', icon: 'memory' }
        : { key: 'instalaciones', label: 'Instalaciones', icon: 'factory' },
      { key: 'eventos', label: 'Eventos', icon: 'notifications' },
      { key: 'contactos', label: 'Contactos', icon: 'contact_phone' },
      { key: 'usuarios', label: 'Gestión usuarios', icon: 'person_add' },
    ];
  });

  getActiveTitle(): string {
    if (this.activeTab === 'instalaciones') {
      return this.isColdRoom() ? 'TAPs' : 'Instalaciones';
    }

    if (this.activeTab === 'eventos') {
      return 'Eventos';
    }

    if (this.activeTab === 'contactos') {
      return 'Contactos';
    }

    if (this.activeTab === 'usuarios') {
      return 'Usuarios';
    }

    return 'General';
  }

  getActiveSubtitle(): string {
    if (this.activeTab === 'instalaciones') {
      return this.isColdRoom()
        ? 'Concentradores TAP del sitio'
        : `${this.sites.length} sitios registrados`;
    }

    if (this.activeTab === 'eventos') {
      return 'Alertas y eventos recientes';
    }

    if (this.activeTab === 'contactos') {
      return `${this.contactsCount} contactos operativos`;
    }

    if (this.activeTab === 'usuarios') {
      return 'Gestión de usuarios asociados';
    }

    return 'Resumen de la división seleccionada';
  }
}
