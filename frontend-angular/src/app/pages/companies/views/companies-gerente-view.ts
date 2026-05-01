import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UserManagementComponent } from '../../../components/ui/user-management';
import { CompaniesContactsPanelComponent } from '../components/companies-contacts-panel';
import { CompaniesGeneralSkeletonComponent } from '../components/companies-general-skeleton';
import { CompaniesInstallationsPanelComponent } from '../components/companies-installations-panel';
import { CompaniesPageHeaderComponent } from '../components/companies-page-header';
import { CompaniesTabItem, CompaniesTabNavComponent } from '../components/companies-tab-nav';

@Component({
  selector: 'app-companies-gerente-view',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesPageHeaderComponent,
    CompaniesTabNavComponent,
    CompaniesGeneralSkeletonComponent,
    CompaniesInstallationsPanelComponent,
    CompaniesContactsPanelComponent,
    UserManagementComponent,
  ],
  template: `
    <div class="p-8">
      <app-companies-page-header
        [selectedSubCompany]="selectedSubCompany"
        [sitesCount]="sites.length"
        [showReportButton]="false"
      />

      <div class="mb-6 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
        <span class="material-symbols-outlined text-emerald-600 text-sm">shield_person</span>
        <span class="text-xs font-bold text-emerald-700">Vista de Gerente - Gestion de tu Division</span>
      </div>

      <app-companies-tab-nav
        [tabs]="tabs"
        [activeTab]="activeTab"
        (activeTabChange)="activeTabChange.emit($event)"
      />

      @if (activeTab === 'general') {
        <app-companies-general-skeleton />
      }

      @if (activeTab === 'instalaciones') {
        <app-companies-installations-panel
          [sites]="sites"
          [loading]="loading"
          (siteSelected)="siteSelected.emit($event)"
        />
      }

      @if (activeTab === 'contactos') {
        <app-companies-contacts-panel
          [empresaId]="empresaId"
          [subEmpresaId]="subEmpresaId"
          [selectedLabel]="selectedSubCompany?.nombre || ''"
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
export class CompaniesGerenteViewComponent {
  @Input() activeTab = 'instalaciones';
  @Input() selectedSubCompany: any = null;
  @Input() sites: any[] = [];
  @Input() loading = false;
  @Input() subEmpresaId = '';
  @Input() empresaId = '';

  @Output() activeTabChange = new EventEmitter<string>();
  @Output() siteSelected = new EventEmitter<any>();

  readonly tabs: CompaniesTabItem[] = [
    { key: 'general', label: 'General', icon: 'info' },
    { key: 'instalaciones', label: 'Instalaciones', icon: 'factory' },
    { key: 'contactos', label: 'Contactos', icon: 'contact_phone' },
    { key: 'usuarios', label: 'Mi Equipo', icon: 'group' },
  ];
}
