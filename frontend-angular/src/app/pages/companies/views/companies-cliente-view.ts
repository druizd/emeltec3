import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CompaniesGeneralSkeletonComponent } from '../components/companies-general-skeleton';
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
    CompaniesGeneralSkeletonComponent,
    CompaniesInstallationsPanelComponent,
  ],
  template: `
    <div class="p-8">
      <app-companies-page-header
        [selectedSubCompany]="selectedSubCompany"
        [sitesCount]="sites.length"
        [showReportButton]="false"
      />

      <div class="mb-6 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2">
        <span class="material-symbols-outlined text-blue-500 text-sm">visibility</span>
        <span class="text-xs font-bold text-blue-700">Vista de Cliente - Solo Lectura</span>
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
    </div>
  `,
})
export class CompaniesClienteViewComponent {
  @Input() activeTab = 'instalaciones';
  @Input() selectedSubCompany: any = null;
  @Input() sites: any[] = [];
  @Input() loading = false;

  @Output() activeTabChange = new EventEmitter<string>();
  @Output() siteSelected = new EventEmitter<any>();

  readonly tabs: CompaniesTabItem[] = [
    { key: 'general', label: 'General', icon: 'info' },
    { key: 'instalaciones', label: 'Instalaciones', icon: 'factory' },
  ];
}
