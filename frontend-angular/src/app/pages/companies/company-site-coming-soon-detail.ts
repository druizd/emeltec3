import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import { getSiteTypeUi, normalizeSiteType } from '../../shared/site-type-ui';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';

interface SiteContext {
  company: CompanyNode;
  subCompany: SubCompanyNode;
  site: SiteRecord;
}

@Component({
  selector: 'app-company-site-coming-soon-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, SiteVariableSettingsPanelComponent],
  template: `
    <div class="min-h-full bg-[#f4f7fa] px-4 pb-8 pt-4 text-slate-700 md:px-6">
      @if (siteContext(); as context) {
        <div class="mx-auto max-w-[1360px] space-y-4">
          <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div
              class="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div class="flex min-w-0 items-center gap-3">
                <a
                  routerLink="/companies"
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors"
                  [style.background]="accentSoft()"
                  [style.color]="accentColor()"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[24px]">{{ typeUi().icon }}</span>
                </a>
                <div class="min-w-0">
                  <p class="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                    {{ typeUi().label }}
                  </p>
                  <h1 class="truncate text-xl font-black text-slate-900">
                    {{ siteName(context) }}
                  </h1>
                  <p class="truncate text-sm font-semibold text-slate-500">
                    {{ context.subCompany.nombre }}
                  </p>
                </div>
              </div>

              <button
                type="button"
                (click)="settingsOpen.update((value) => !value)"
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
                aria-label="Configurar variables"
              >
                <span class="material-symbols-outlined text-[20px]">settings</span>
              </button>
            </div>
            <div class="h-1" [style.background]="accentColor()"></div>
          </section>

          @if (settingsOpen()) {
            <app-site-variable-settings-panel
              [siteId]="context.site.id"
              [site]="context.site"
              [accentColor]="accentColor()"
              [accentSoft]="accentSoft()"
            />
          } @else {
            <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div class="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div>
                  <div
                    class="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center"
                  >
                    <div class="max-w-lg px-6">
                      <span
                        class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
                        [style.background]="accentSoft()"
                        [style.color]="accentColor()"
                      >
                        <span class="material-symbols-outlined text-[34px]">{{
                          typeUi().icon
                        }}</span>
                      </span>
                      <h2 class="mt-5 text-2xl font-black text-slate-900">
                        Dashboard {{ typeUi().label }} proximamente
                      </h2>
                      <p class="mt-3 text-sm font-semibold leading-6 text-slate-500">
                        La ruta y la configuracion de variables ya quedan separadas por tipo de
                        instalacion. Esta vista puede crecer con sus propios graficos, calculos y
                        alertas sin tocar el dashboard de pozo.
                      </p>
                    </div>
                  </div>
                </div>

                <aside class="space-y-3">
                  @for (item of skeletonCards; track item.label) {
                    <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p
                        class="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-400"
                      >
                        <span
                          class="material-symbols-outlined text-[16px]"
                          [style.color]="accentColor()"
                        >
                          {{ item.icon }}
                        </span>
                        {{ item.label }}
                      </p>
                      <div class="mt-4 h-3 w-2/3 rounded-full bg-slate-100"></div>
                      <div class="mt-3 h-3 w-1/2 rounded-full bg-slate-100"></div>
                    </article>
                  }
                </aside>
              </div>
            </section>
          }
        </div>
      } @else {
        <div class="grid min-h-[420px] place-items-center">
          <span
            class="material-symbols-outlined animate-spin text-[34px]"
            [style.color]="accentColor()"
          >
            progress_activity
          </span>
        </div>
      }
    </div>
  `,
})
export class CompanySiteComingSoonDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly companyService = inject(CompanyService);

  siteContext = signal<SiteContext | null>(null);
  settingsOpen = signal(false);
  requestedType = signal('generico');

  readonly skeletonCards = [
    { label: 'Indicadores', icon: 'monitoring' },
    { label: 'Tendencias', icon: 'show_chart' },
    { label: 'Alertas', icon: 'notifications_active' },
  ];

  typeUi = () => getSiteTypeUi(this.requestedType());
  accentColor = () => {
    const type = normalizeSiteType(this.requestedType());
    if (type === 'riles') return '#22c55e';
    if (type === 'camara_frio') return '#0284c7';
    if (type === 'proceso') return '#6366f1';
    return '#f97316';
  };
  accentSoft = () => {
    const type = normalizeSiteType(this.requestedType());
    if (type === 'riles') return 'rgba(34,197,94,0.10)';
    if (type === 'camara_frio') return 'rgba(2,132,199,0.10)';
    if (type === 'proceso') return 'rgba(99,102,241,0.10)';
    return 'rgba(249,115,22,0.10)';
  };

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    const type = normalizeSiteType(String(this.route.snapshot.data['siteType'] || 'generico'));
    this.requestedType.set(type);

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

        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set(getSiteTypeUi(type).moduleKey);
        this.companyService.selectedSiteTypeFilter.set([type]);
        this.siteContext.set(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  siteName(context: SiteContext): string {
    return context.site.descripcion || context.subCompany.nombre || 'Instalacion';
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
