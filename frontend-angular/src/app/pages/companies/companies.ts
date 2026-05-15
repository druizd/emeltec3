import { CommonModule } from '@angular/common';
import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CompanyService } from '../../services/company.service';
import { CompaniesAdminViewComponent } from './views/companies-admin-view';
import { CompaniesClienteViewComponent } from './views/companies-cliente-view';
import { CompaniesGerenteViewComponent } from './views/companies-gerente-view';
import { CompaniesSuperAdminViewComponent } from './views/companies-superadmin-view';
import {
  dashboardRouteForSite,
  getSiteTypeUi,
  normalizeSiteType,
  siteTypeMatchesModule,
  siteTypesForModule,
} from '../../shared/site-type-ui';
import type { ApiResponse, CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-companies',
  standalone: true,
  imports: [
    CommonModule,
    CompaniesSuperAdminViewComponent,
    CompaniesAdminViewComponent,
    CompaniesGerenteViewComponent,
    CompaniesClienteViewComponent,
  ],
  templateUrl: './companies.html',
})
export class CompaniesComponent implements OnInit {
  companyService = inject(CompanyService);
  auth = inject(AuthService);
  router = inject(Router);

  activeTab = signal('instalaciones');
  selectedSubCompany = signal<SubCompanyNode | null>(null);
  sites = signal<SiteRecord[]>([]);
  loading = signal(false);

  constructor() {
    effect(() => {
      const selectedId = this.companyService.selectedSubCompanyId();
      const moduleKey = this.companyService.selectedSiteModuleKey();
      const typeFilter = this.companyService.selectedSiteTypeFilter();
      if (selectedId) {
        this.loadSubCompanyData(selectedId, moduleKey, typeFilter);
      }
    });
  }

  ngOnInit(): void {
    this.companyService.fetchHierarchy().subscribe((res: ApiResponse<CompanyNode[]>) => {
      if (res.ok) {
        if (res.data.length > 0 && !this.companyService.selectedSubCompanyId()) {
          const firstMatch = this.findFirstSubCompanyWithSite(res.data);
          if (firstMatch) {
            const moduleKey = getSiteTypeUi(firstMatch.site.tipo_sitio).moduleKey;
            this.companyService.selectedSubCompanyId.set(firstMatch.subCompany.id);
            this.companyService.selectedSiteModuleKey.set(moduleKey);
            this.companyService.selectedSiteTypeFilter.set(siteTypesForModule(moduleKey));
          } else {
            const firstSub = res.data[0].subCompanies?.[0];
            if (firstSub) {
              this.companyService.selectedSubCompanyId.set(firstSub.id);
            }
          }
        }
      }
    });
  }

  loadSubCompanyData(
    id: string,
    moduleKey: string | null = this.companyService.selectedSiteModuleKey(),
    typeFilter: string[] | null = this.companyService.selectedSiteTypeFilter(),
  ): void {
    this.loading.set(true);

    const tree = this.companyService.hierarchy();
    for (const comp of tree) {
      const sub = comp.subCompanies?.find((s) => s.id === id);
      if (sub) {
        this.selectedSubCompany.set({ ...sub, empresa_id: comp.id });
        break;
      }
    }

    this.companyService.getSites(id).subscribe({
      next: (json: ApiResponse<SiteRecord[]>) => {
        if (json.ok) {
          this.sites.set(this.filterSitesBySelection(json.data, moduleKey, typeFilter));
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }

  openSite(site: SiteRecord): void {
    if (!site?.id) {
      return;
    }

    this.router.navigate(dashboardRouteForSite(site));
  }

  private filterSitesBySelection(
    sites: SiteRecord[],
    moduleKey: string | null,
    typeFilter: string[] | null,
  ): SiteRecord[] {
    if (moduleKey) {
      return sites.filter((site) => siteTypeMatchesModule(site.tipo_sitio, moduleKey));
    }

    if (typeFilter?.length) {
      const normalizedFilter = new Set(typeFilter.map((type) => normalizeSiteType(type)));
      return sites.filter((site) => normalizedFilter.has(normalizeSiteType(site.tipo_sitio)));
    }

    return sites;
  }

  private findFirstSubCompanyWithSite(
    tree: CompanyNode[],
  ): { subCompany: SubCompanyNode; site: SiteRecord } | null {
    for (const company of tree) {
      for (const subCompany of company.subCompanies || []) {
        const site = subCompany.sites?.[0];
        if (site) {
          return { subCompany, site };
        }
      }
    }

    return null;
  }
}
