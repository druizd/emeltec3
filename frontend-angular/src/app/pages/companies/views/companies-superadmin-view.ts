import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UserManagementComponent } from '../../../components/ui/user-management';
import { CompaniesContactsPanelComponent } from '../components/companies-contacts-panel';
import { CompaniesGeneralSkeletonComponent } from '../components/companies-general-skeleton';
import { CompaniesInstallationsPanelComponent } from '../components/companies-installations-panel';
import { CompaniesTabItem, CompaniesTabNavComponent } from '../components/companies-tab-nav';

@Component({
  selector: 'app-companies-superadmin-view',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesTabNavComponent,
    CompaniesGeneralSkeletonComponent,
    CompaniesInstallationsPanelComponent,
    CompaniesContactsPanelComponent,
    UserManagementComponent,
  ],
  template: `
    <div class="min-h-full bg-[#f5f7fb] px-5 pb-8 pt-6 md:px-7 xl:px-8">
      <div class="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div class="space-y-2">
          <p class="text-[12px] font-black uppercase tracking-[0.24em] text-cyan-600/80">
            {{ selectedSubCompany?.nombre || 'Division seleccionada' }}
          </p>
          <h1 class="text-[2.35rem] font-black leading-none text-slate-800">
            {{ getActiveTitle() }}
          </h1>
          <p class="text-xs font-medium text-slate-400">
            {{ getActiveSubtitle() }}
          </p>
        </div>

        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-[0_10px_25px_rgba(15,23,42,0.06)] transition-all hover:border-cyan-200 hover:text-cyan-700"
        >
          <span class="material-symbols-outlined text-lg">download</span>
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
        <app-companies-general-skeleton />
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
  @Input() selectedSubCompany: any = null;
  @Input() sites: any[] = [];
  @Input() loading = false;
  @Input() subEmpresaId = '';
  @Input() empresaId = '';

  @Output() activeTabChange = new EventEmitter<string>();
  @Output() siteSelected = new EventEmitter<any>();

  contactsCount = 0;

  readonly tabs: CompaniesTabItem[] = [
    { key: 'general', label: 'General', icon: 'info' },
    { key: 'instalaciones', label: 'Instalaciones', icon: 'factory' },
    { key: 'contactos', label: 'Contactos', icon: 'contact_phone' },
    { key: 'usuarios', label: 'Gestion Usuarios', icon: 'person_add' },
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
      return 'Gestion de usuarios asociados';
    }

    return 'Resumen de la division seleccionada';
  }
}
