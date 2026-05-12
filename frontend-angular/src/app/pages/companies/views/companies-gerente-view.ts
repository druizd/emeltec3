import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UserManagementComponent } from '../../../components/ui/user-management';
import { CompaniesContactsPanelComponent } from '../components/companies-contacts-panel';
import { CompaniesGeneralPanelComponent } from '../components/companies-general-panel';
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
    CompaniesGeneralPanelComponent,
    CompaniesInstallationsPanelComponent,
    CompaniesContactsPanelComponent,
    UserManagementComponent,
  ],
  template: `
    <div class="min-h-full bg-[#F0F2F5] px-5 pb-8 pt-6 md:px-7 xl:px-8">
      <app-companies-page-header
        [selectedSubCompany]="selectedSubCompany"
        [sitesCount]="sites.length"
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        [showReportButton]="false"
      />

      <app-companies-tab-nav
        [tabs]="tabs"
        [activeTab]="activeTab"
        (activeTabChange)="activeTabChange.emit($event)"
      />

      @if (activeTab === 'general') {
        <app-companies-general-panel [sites]="sites" [subEmpresaId]="subEmpresaId" />
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

  headerTitle(): string {
    const map: Record<string, string> = { general: 'General', instalaciones: 'Instalaciones', contactos: 'Contactos', usuarios: 'Mi Equipo' };
    return map[this.activeTab] ?? 'General';
  }

  headerSubtitle(): string {
    if (this.activeTab === 'instalaciones') return `${this.sites.length} sitios registrados`;
    if (this.activeTab === 'general') return 'Resumen de la división';
    return '';
  }
}
