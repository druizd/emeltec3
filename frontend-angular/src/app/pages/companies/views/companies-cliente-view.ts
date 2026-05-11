import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CompaniesGeneralPanelComponent } from '../components/companies-general-panel';
import { CompaniesInstallationsPanelComponent } from '../components/companies-installations-panel';
import { CompaniesPageHeaderComponent } from '../components/companies-page-header';
import { CompaniesTabItem, CompaniesTabNavComponent } from '../components/companies-tab-nav';

@Component({
  selector: 'app-companies-cliente-view',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesPageHeaderComponent,
    CompaniesTabNavComponent,
    CompaniesGeneralPanelComponent,
    CompaniesInstallationsPanelComponent,
  ],
  template: `
    <div class="min-h-full bg-[#f5f7fb] px-5 pb-8 pt-6 md:px-7 xl:px-8">
      <app-companies-page-header
        [selectedSubCompany]="selectedSubCompany"
        [sitesCount]="sites.length"
        [title]="activeTab === 'instalaciones' ? 'Instalaciones' : 'General'"
        [subtitle]="activeTab === 'instalaciones' ? sites.length + ' sitios registrados' : 'Resumen de la división'"
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
    </div>
  `,
})
export class CompaniesClienteViewComponent {
  @Input() activeTab = 'instalaciones';
  @Input() selectedSubCompany: any = null;
  @Input() sites: any[] = [];
  @Input() loading = false;
  @Input() subEmpresaId = '';

  @Output() activeTabChange = new EventEmitter<string>();
  @Output() siteSelected = new EventEmitter<any>();

  readonly tabs: CompaniesTabItem[] = [
    { key: 'general', label: 'General', icon: 'info' },
    { key: 'instalaciones', label: 'Instalaciones', icon: 'factory' },
  ];
}
