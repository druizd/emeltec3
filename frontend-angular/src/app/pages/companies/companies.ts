import { CommonModule } from '@angular/common';
import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CompanyService } from '../../services/company.service';
import { CompaniesAdminViewComponent } from './views/companies-admin-view';
import { CompaniesClienteViewComponent } from './views/companies-cliente-view';
import { CompaniesGerenteViewComponent } from './views/companies-gerente-view';
import { CompaniesSuperAdminViewComponent } from './views/companies-superadmin-view';
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
      if (selectedId) {
        this.loadSubCompanyData(selectedId);
      }
    });
  }

  ngOnInit(): void {
    this.companyService.fetchHierarchy().subscribe((res: ApiResponse<CompanyNode[]>) => {
      if (res.ok) {
        if (res.data.length > 0 && !this.companyService.selectedSubCompanyId()) {
          const firstSub = res.data[0].subCompanies?.[0];
          if (firstSub) {
            this.companyService.selectedSubCompanyId.set(firstSub.id);
          }
        }
      }
    });
  }

  loadSubCompanyData(id: string): void {
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
          this.sites.set(json.data);
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

    this.router.navigate(['/companies', site.id, 'water']);
  }
}
