import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UserManagementComponent } from '../../../components/ui/user-management';
import { CompaniesContactsPanelComponent } from '../components/companies-contacts-panel';
import { CompaniesGeneralPanelComponent } from '../components/companies-general-panel';
import { CompaniesInstallationsPanelComponent } from '../components/companies-installations-panel';
import { CompaniesTabItem, CompaniesTabNavComponent } from '../components/companies-tab-nav';
import type { SiteRecord, SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-companies-superadmin-view',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesTabNavComponent,
    CompaniesGeneralPanelComponent,
    CompaniesInstallationsPanelComponent,
    CompaniesContactsPanelComponent,
    UserManagementComponent,
  ],
  template: `
    <div class="min-h-full bg-[#F0F2F5] px-5 pb-8 pt-6 md:px-7 xl:px-8">
      <div class="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div class="space-y-1.5">
          <p class="text-[10px] font-bold uppercase tracking-[0.1em] text-[#94A3B8]">
            {{ selectedSubCompany?.nombre || 'División seleccionada' }}
          </p>
          <h1
            class="text-[22px] font-bold leading-tight tracking-[0.03em] text-[#1E293B]"
            style="font-family: 'Josefin Sans', sans-serif;"
          >
            {{ getActiveTitle() }}
          </h1>
          <p class="text-[13px] text-[#64748B]">
            {{ getActiveSubtitle() }}
          </p>
        </div>

        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-md border border-[#E2E8F0] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#1E293B] shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all hover:border-[#0DAFBD] hover:text-[#0899A5]"
        >
          <span class="material-symbols-outlined text-lg" aria-hidden="true">download</span>
          Reporte
        </button>
      </div>

      <app-companies-tab-nav
        [tabs]="tabs"
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
  @Input() sites: SiteRecord[] = [];
  @Input() loading = false;
  @Input() subEmpresaId = '';
  @Input() empresaId = '';

  @Output() activeTabChange = new EventEmitter<string>();
  @Output() siteSelected = new EventEmitter<SiteRecord>();

  contactsCount = 0;

  readonly tabs: CompaniesTabItem[] = [
    { key: 'general', label: 'General', icon: 'info' },
    { key: 'instalaciones', label: 'Instalaciones', icon: 'factory' },
    { key: 'contactos', label: 'Contactos', icon: 'contact_phone' },
    { key: 'usuarios', label: 'Gestión Usuarios', icon: 'person_add' },
  ];

  getActiveTitle(): string {
    if (this.activeTab === 'instalaciones') {
      return 'Instalaciones';
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
      return `${this.sites.length} sitios registrados`;
    }

    if (this.activeTab === 'contactos') {
      return `${this.contactsCount} usuarios registrados`;
    }

    if (this.activeTab === 'usuarios') {
      return 'Gestión de usuarios asociados';
    }

    return 'Resumen de la division seleccionada';
  }
}
