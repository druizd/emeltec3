import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import { getSiteTypeUi, normalizeSiteType } from '../../shared/site-type-ui';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { VentisquerosComponent } from '../ventisqueros/ventisqueros';

interface SiteContext {
  company: CompanyNode;
  subCompany: SubCompanyNode;
  site: SiteRecord;
}

@Component({
  selector: 'app-company-site-cold-room-detail',
  standalone: true,
  imports: [CommonModule, SkeletonComponent, VentisquerosComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (siteContext(); as context) {
      <app-ventisqueros
        [siteId]="context.site.id"
        [siteName]="context.site.descripcion || context.subCompany.nombre"
        [companyName]="context.company.nombre"
      />
    } @else {
      <div class="mx-auto flex max-w-[640px] flex-col items-center gap-4 px-6 py-16">
        <app-skeleton class="h-16 w-16 rounded-2xl" />
        <app-skeleton class="h-6 w-64 rounded-md" />
        <app-skeleton class="h-3 w-80 rounded" />
        <app-skeleton class="h-3 w-72 rounded" />
      </div>
    }
  `,
})
export class CompanySiteColdRoomDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private companyService = inject(CompanyService);

  siteContext = signal<SiteContext | null>(null);

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (!res.ok) {
          this.router.navigate(['/companies']);
          return;
        }

        const match = this.findAccessibleSite(res.data, siteId);
        if (!match) {
          this.router.navigate(['/companies']);
          return;
        }

        const type = normalizeSiteType('camara_frio');
        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set(getSiteTypeUi(type).moduleKey);
        this.companyService.selectedSiteTypeFilter.set([type]);
        this.siteContext.set(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  private findAccessibleSite(tree: CompanyNode[], siteId: string): SiteContext | null {
    for (const company of tree) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item) => item.id === siteId);
        if (site) return { company, subCompany, site };
      }
    }
    return null;
  }
}
