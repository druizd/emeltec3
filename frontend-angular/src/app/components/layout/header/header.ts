import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import type { PreviewRole, ViewAsContext } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';
import { ShortcutService } from '../../../services/shortcut.service';
import { LayoutUiService } from '../layout-ui.service';
import { getSiteTypeUi, siteTypesForModule } from '../../../shared/site-type-ui';
import type { CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="h-16 shrink-0 border-b border-surface-container bg-white">
      <div class="flex h-full items-stretch px-3 sm:px-5">
        <!-- Hamburguesa: abre el drawer del sidebar (solo mobile/tablet <lg). -->
        <button
          type="button"
          (click)="ui.toggleMobileNav()"
          class="my-auto mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#475569] transition duration-100 hover:bg-[#f1f5f9] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
          aria-label="Abrir menú de navegación"
        >
          <span class="material-symbols-outlined text-[22px]">menu</span>
        </button>

        <nav class="flex items-stretch" aria-label="Navegación principal">
          <button
            type="button"
            (click)="router.navigate(['/dashboard'])"
            [attr.aria-current]="isDashboard() ? 'page' : null"
            [style.color]="isDashboard() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isDashboard() ? '2px solid #0DAFBD' : '2px solid transparent'"
            class="flex items-center gap-1.5 border-0 border-t-2 border-transparent bg-transparent px-3 text-body font-medium transition-colors active:scale-95"
          >
            <span class="material-symbols-outlined text-[16px]">grid_view</span>
            <span class="hidden sm:inline">Dashboard</span>
          </button>

          <button
            type="button"
            (click)="router.navigate(['/companies'])"
            [attr.aria-current]="isMonitoreo() ? 'page' : null"
            [style.color]="isMonitoreo() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isMonitoreo() ? '2px solid #0DAFBD' : '2px solid transparent'"
            class="flex items-center gap-1.5 border-0 border-t-2 border-transparent bg-transparent px-3 text-body font-medium transition-colors active:scale-95"
          >
            <span class="material-symbols-outlined text-[16px]">monitoring</span>
            <span class="hidden sm:inline">Monitoreo</span>
          </button>
        </nav>

        <div class="flex-1"></div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            (click)="shortcuts.openPalette()"
            class="hidden h-[30px] w-[30px] items-center justify-center rounded-md text-on-surface-muted transition duration-100 hover:bg-[#f1f5f9] hover:text-[#475569] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex"
            aria-label="Atajos de teclado (?)"
            title="Atajos de teclado (?)"
          >
            <span class="material-symbols-outlined text-[16px]">keyboard</span>
          </button>
          @if (auth.canSwitchView()) {
            <div class="relative" data-menu="view-as">
              <button
                type="button"
                (click)="toggleViewAsMenu()"
                [class.text-amber-600]="auth.isViewingAs()"
                [class.bg-amber-50]="auth.isViewingAs()"
                class="flex h-[30px] items-center gap-1 rounded-md px-2 text-on-surface-muted transition duration-100 hover:bg-[#f1f5f9] hover:text-[#475569] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Vista previa de roles"
                title="Vista previa de roles"
                [attr.aria-expanded]="viewAsMenuOpen()"
              >
                <span class="material-symbols-outlined text-[16px]">visibility</span>
                @if (auth.isViewingAs()) {
                  <span class="text-[10px] font-bold uppercase tracking-wide">
                    {{ auth.viewAsRole() }}
                  </span>
                }
              </button>

              @if (viewAsMenuOpen()) {
                <div
                  class="anim-popover absolute right-0 top-full z-50 mt-2 w-[min(390px,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-xl border border-surface-container bg-white shadow-[0_18px_46px_rgba(15,23,42,0.16)]"
                >
                  <div class="border-b border-surface-container px-4 py-3">
                    <p class="text-caption-xs font-bold uppercase tracking-wide text-slate-400">
                      Vista previa
                    </p>
                    <p class="mt-1 text-caption leading-snug text-slate-500">
                      Simula un perfil con alcance real. Tu sesion sigue siendo SuperAdmin.
                    </p>
                  </div>

                  <div class="space-y-3 p-3">
                    <button
                      type="button"
                      (click)="clearPreview()"
                      class="flex w-full items-center justify-between gap-3 rounded-lg border border-surface-container bg-surface-subtle px-3 py-2.5 text-left transition-colors hover:bg-white active:scale-[0.98]"
                    >
                      <span class="flex min-w-0 items-center gap-2.5">
                        <span
                          class="material-symbols-outlined flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-[17px] text-slate-400"
                        >
                          shield_person
                        </span>
                        <span class="min-w-0">
                          <span class="block text-body-sm font-semibold text-on-surface">
                            Mi rol real
                          </span>
                          <span class="block truncate text-caption-xs text-slate-400">
                            SuperAdmin sin filtros de preview
                          </span>
                        </span>
                      </span>
                      @if (!auth.isViewingAs()) {
                        <span class="material-symbols-outlined text-[16px] text-primary">
                          check
                        </span>
                      }
                    </button>

                    <div class="grid grid-cols-3 gap-1.5">
                      @for (role of previewRoleOptions; track role.value) {
                        <button
                          type="button"
                          (click)="selectDraftRole(role.value)"
                          [class.border-primary-tint-40]="draftRole() === role.value"
                          [class.bg-primary-tint-08]="draftRole() === role.value"
                          [class.text-primary-container]="draftRole() === role.value"
                          class="flex min-h-[66px] flex-col items-start justify-between rounded-lg border border-surface-container bg-white px-2.5 py-2 text-left text-slate-500 transition hover:border-primary-tint-30 hover:bg-surface-subtle active:scale-95"
                        >
                          <span class="material-symbols-outlined text-[17px]">{{ role.icon }}</span>
                          <span>
                            <span class="block text-caption-xs font-bold uppercase tracking-wide">
                              {{ role.label }}
                            </span>
                            <span class="block text-[10px] leading-tight text-slate-400">
                              {{ role.scope }}
                            </span>
                          </span>
                        </button>
                      }
                    </div>

                    @if (previewCompanies().length === 0) {
                      <div
                        class="rounded-lg border border-dashed border-[#CBD5E1] bg-surface-subtle px-3 py-4 text-center text-caption text-slate-400"
                      >
                        No hay empresas cargadas para crear una preview.
                      </div>
                    } @else {
                      <div class="space-y-2.5">
                        <label class="block">
                          <span
                            class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                          >
                            Empresa
                          </span>
                          <select
                            [value]="draftCompanyId()"
                            (change)="onDraftCompanyChange($event)"
                            class="h-9 w-full rounded-lg border border-surface-container bg-white px-3 text-body-sm font-semibold text-on-surface outline-none focus:border-primary-tint-40 focus:ring-2 focus:ring-primary-tint-20"
                          >
                            @for (company of previewCompanies(); track company.id) {
                              <option [value]="company.id">{{ company.nombre }}</option>
                            }
                          </select>
                        </label>

                        @if (draftRole() !== 'Admin') {
                          <label class="block">
                            <span
                              class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                            >
                              Division
                            </span>
                            <select
                              [value]="draftSubCompanyId()"
                              (change)="onDraftSubCompanyChange($event)"
                              class="h-9 w-full rounded-lg border border-surface-container bg-white px-3 text-body-sm font-semibold text-on-surface outline-none focus:border-primary-tint-40 focus:ring-2 focus:ring-primary-tint-20"
                            >
                              @for (subCompany of previewSubCompanies(); track subCompany.id) {
                                <option [value]="subCompany.id">{{ subCompany.nombre }}</option>
                              }
                            </select>
                          </label>
                        }

                        @if (draftRole() === 'Cliente') {
                          <label class="block">
                            <span
                              class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                            >
                              Sitio
                            </span>
                            <select
                              [value]="draftSiteId()"
                              (change)="onDraftSiteChange($event)"
                              class="h-9 w-full rounded-lg border border-surface-container bg-white px-3 text-body-sm font-semibold text-on-surface outline-none focus:border-primary-tint-40 focus:ring-2 focus:ring-primary-tint-20"
                            >
                              @for (site of previewSites(); track site.id) {
                                <option [value]="site.id">{{ siteLabel(site) }}</option>
                              }
                            </select>
                          </label>
                        }
                      </div>

                      <div
                        class="rounded-lg border border-primary-tint-20 bg-primary-tint-08 px-3 py-2 text-caption text-primary-deep"
                      >
                        <span class="font-bold">Alcance:</span>
                        {{ previewDraftScopeLabel() || 'Selecciona un alcance valido' }}
                      </div>

                      <button
                        type="button"
                        (click)="applyPreview()"
                        [disabled]="!canApplyPreview()"
                        class="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-caption font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        <span class="material-symbols-outlined text-[15px]">visibility</span>
                        Activar preview
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <button
              [hidden]="!auth.canAccessAdministration()"
              (click)="router.navigate(['/administration'])"
              class="flex h-[30px] w-[30px] items-center justify-center rounded-md text-on-surface-muted transition duration-100 hover:bg-[#f1f5f9] hover:text-[#475569] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Administración"
            >
              <span class="material-symbols-outlined text-[16px]">settings</span>
            </button>
          } @else if (auth.canAccessAdministration()) {
            <button
              (click)="router.navigate(['/administration'])"
              class="flex h-[30px] w-[30px] items-center justify-center rounded-md text-on-surface-muted transition duration-100 hover:bg-[#f1f5f9] hover:text-[#475569] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Administración"
            >
              <span class="material-symbols-outlined text-[16px]">settings</span>
            </button>
          }

          <!-- Avatar + dropdown de usuario -->
          <div class="relative" data-menu="user">
            <button
              type="button"
              (click)="toggleUserMenu()"
              class="ml-1 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary text-caption-xs font-bold text-white ring-2 ring-transparent transition-[transform,box-shadow] duration-100 hover:ring-primary-tint-30 active:scale-95 focus-visible:outline-none focus-visible:ring-primary"
              aria-label="Menú de usuario"
              [attr.aria-expanded]="userMenuOpen()"
            >
              {{ getUserInitials() }}
            </button>

            @if (userMenuOpen()) {
              <div
                class="anim-popover absolute right-0 top-full z-50 mt-1.5 w-52 origin-top-right overflow-hidden rounded-xl border border-surface-container bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
              >
                <!-- User info -->
                <div class="border-b border-surface-container px-4 py-3">
                  <p class="text-body-sm font-bold text-slate-800">
                    {{ auth.user()?.nombre }} {{ auth.user()?.apellido }}
                  </p>
                  <p class="text-caption-xs text-slate-400">{{ auth.user()?.tipo }}</p>
                </div>
                <!-- Actions -->
                <div class="py-1">
                  <button
                    type="button"
                    (click)="goToProfile()"
                    class="flex w-full items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98]"
                  >
                    <span
                      class="material-symbols-outlined text-[16px] text-slate-400"
                      aria-hidden="true"
                      >person</span
                    >
                    Mi perfil
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98]"
                  >
                    <span
                      class="material-symbols-outlined text-[16px] text-slate-400"
                      aria-hidden="true"
                      >notifications</span
                    >
                    Notificaciones
                  </button>
                </div>
                <div class="border-t border-surface-container py-1">
                  <button
                    type="button"
                    (click)="logout()"
                    class="flex w-full items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 active:scale-[0.98]"
                  >
                    <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                      >logout</span
                    >
                    Cerrar sesión
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly shortcuts = inject(ShortcutService);
  readonly companyService = inject(CompanyService);
  readonly router = inject(Router);
  readonly ui = inject(LayoutUiService);

  private currentUrl = signal(this.router.url);
  readonly userMenuOpen = signal(false);
  readonly viewAsMenuOpen = signal(false);

  readonly previewRoleOptions: {
    value: PreviewRole;
    label: string;
    scope: string;
    icon: string;
  }[] = [
    { value: 'Admin', label: 'Admin', scope: 'Empresa', icon: 'admin_panel_settings' },
    { value: 'Gerente', label: 'Gerente', scope: 'Division', icon: 'manage_accounts' },
    { value: 'Cliente', label: 'Cliente', scope: 'Sitio', icon: 'person' },
    { value: 'Vendedor', label: 'Vendedor', scope: 'Demo', icon: 'storefront' },
  ];

  readonly draftRole = signal<PreviewRole>('Admin');
  readonly draftCompanyId = signal('');
  readonly draftSubCompanyId = signal('');
  readonly draftSiteId = signal('');

  readonly previewCompanies = computed(() => this.companyService.hierarchy());

  readonly selectedDraftCompany = computed(() => {
    return (
      this.previewCompanies().find((company) => company.id === this.draftCompanyId()) ??
      this.previewCompanies()[0] ??
      null
    );
  });

  readonly previewSubCompanies = computed(() => this.selectedDraftCompany()?.subCompanies ?? []);

  readonly selectedDraftSubCompany = computed(() => {
    return (
      this.previewSubCompanies().find((subCompany) => subCompany.id === this.draftSubCompanyId()) ??
      this.previewSubCompanies()[0] ??
      null
    );
  });

  readonly previewSites = computed(() => this.selectedDraftSubCompany()?.sites ?? []);

  readonly selectedDraftSite = computed(() => {
    return (
      this.previewSites().find((site) => site.id === this.draftSiteId()) ??
      this.previewSites()[0] ??
      null
    );
  });

  readonly previewDraftScopeLabel = computed(() => {
    const company = this.selectedDraftCompany();
    const subCompany = this.selectedDraftSubCompany();
    const site = this.selectedDraftSite();

    if (!company) return '';
    if (this.draftRole() === 'Admin') return company.nombre;
    if (this.draftRole() === 'Gerente') {
      return subCompany ? `${company.nombre} / ${subCompany.nombre}` : company.nombre;
    }

    return [company.nombre, subCompany?.nombre, site ? this.siteLabel(site) : '']
      .filter(Boolean)
      .join(' / ');
  });

  ngOnInit(): void {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentUrl.set(e.urlAfterRedirects || e.url);
        this.userMenuOpen.set(false);
        this.viewAsMenuOpen.set(false);
      });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const menu = target.closest('[data-menu]')?.getAttribute('data-menu');
    if (menu !== 'user') this.userMenuOpen.set(false);
    if (menu !== 'view-as') this.viewAsMenuOpen.set(false);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((v) => !v);
    this.viewAsMenuOpen.set(false);
  }

  toggleViewAsMenu(): void {
    const nextOpen = !this.viewAsMenuOpen();
    this.viewAsMenuOpen.set(nextOpen);
    this.userMenuOpen.set(false);

    if (!nextOpen) return;

    this.syncDraftFromActivePreview();
    if (this.previewCompanies().length === 0) {
      this.companyService.fetchHierarchy().subscribe(() => this.ensureDraftDefaults());
      return;
    }

    this.ensureDraftDefaults();
  }

  selectDraftRole(role: PreviewRole): void {
    this.draftRole.set(role);
    this.ensureDraftDefaults();
  }

  onDraftCompanyChange(event: Event): void {
    this.draftCompanyId.set(this.eventValue(event));
    this.draftSubCompanyId.set('');
    this.draftSiteId.set('');
    this.ensureDraftDefaults();
  }

  onDraftSubCompanyChange(event: Event): void {
    this.draftSubCompanyId.set(this.eventValue(event));
    this.draftSiteId.set('');
    this.ensureDraftDefaults();
  }

  onDraftSiteChange(event: Event): void {
    this.draftSiteId.set(this.eventValue(event));
    this.ensureDraftDefaults();
  }

  canApplyPreview(): boolean {
    if (this.draftRole() === 'Admin') {
      return Boolean(this.selectedDraftCompany());
    }

    if (this.draftRole() === 'Gerente') {
      return Boolean(this.selectedDraftCompany() && this.selectedDraftSubCompany());
    }

    return Boolean(
      this.selectedDraftCompany() && this.selectedDraftSubCompany() && this.selectedDraftSite(),
    );
  }

  applyPreview(): void {
    const context = this.buildPreviewContext();
    if (!context) return;

    this.focusPreviewSelection(context);
    this.auth.setViewAsContext(context);
    this.viewAsMenuOpen.set(false);
  }

  clearPreview(): void {
    if (this.auth.isViewingAs()) {
      this.auth.clearViewAs();
    }
    this.viewAsMenuOpen.set(false);
  }

  siteLabel(site: SiteRecord): string {
    const base = site.descripcion?.trim() || site.id_serial?.trim() || 'Sitio';
    const obra = site.pozo_config?.obra_dga?.trim();
    return obra ? `${base} - ${obra}` : base;
  }

  private syncDraftFromActivePreview(): void {
    const context = this.auth.viewAsContext();
    if (context) {
      this.draftRole.set(context.role);
      this.draftCompanyId.set(context.companyId || '');
      this.draftSubCompanyId.set(context.subCompanyId || '');
      this.draftSiteId.set(context.siteId || '');
      return;
    }

    const selectedSubCompanyId = this.companyService.selectedSubCompanyId();
    const selected = this.findSubCompanyParent(selectedSubCompanyId || '');
    this.draftRole.set('Admin');
    this.draftCompanyId.set(selected?.company.id || this.previewCompanies()[0]?.id || '');
    this.draftSubCompanyId.set(selected?.subCompany.id || '');
    this.draftSiteId.set(selected?.subCompany.sites?.[0]?.id || '');
  }

  private ensureDraftDefaults(): void {
    const company = this.selectedDraftCompany();
    this.draftCompanyId.set(company?.id || '');

    const subCompany =
      company?.subCompanies?.find((item) => item.id === this.draftSubCompanyId()) ??
      company?.subCompanies?.[0] ??
      null;
    this.draftSubCompanyId.set(subCompany?.id || '');

    const site =
      subCompany?.sites?.find((item) => item.id === this.draftSiteId()) ??
      subCompany?.sites?.[0] ??
      null;
    this.draftSiteId.set(site?.id || '');
  }

  private buildPreviewContext(): ViewAsContext | null {
    const role = this.draftRole();
    const company = this.selectedDraftCompany();
    if (!company) return null;

    if (role === 'Admin') {
      return {
        role,
        companyId: company.id,
        companyName: company.nombre,
      };
    }

    const subCompany = this.selectedDraftSubCompany();
    if (!subCompany) return null;

    if (role === 'Gerente') {
      return {
        role,
        companyId: company.id,
        companyName: company.nombre,
        subCompanyId: subCompany.id,
        subCompanyName: subCompany.nombre,
      };
    }

    const site = this.selectedDraftSite();
    if (!site) return null;

    return {
      role,
      companyId: company.id,
      companyName: company.nombre,
      subCompanyId: subCompany.id,
      subCompanyName: subCompany.nombre,
      siteId: site.id,
      siteName: this.siteLabel(site),
    };
  }

  private focusPreviewSelection(context: ViewAsContext): void {
    const company = this.previewCompanies().find((item) => item.id === context.companyId);
    const subCompany =
      company?.subCompanies?.find((item) => item.id === context.subCompanyId) ??
      company?.subCompanies?.[0] ??
      null;
    const site =
      subCompany?.sites?.find((item) => item.id === context.siteId) ??
      subCompany?.sites?.[0] ??
      null;

    if (subCompany) {
      this.companyService.selectedSubCompanyId.set(subCompany.id);
    }

    if (site) {
      const moduleKey = getSiteTypeUi(site.tipo_sitio).moduleKey;
      this.companyService.selectedSiteModuleKey.set(moduleKey);
      this.companyService.selectedSiteTypeFilter.set(siteTypesForModule(moduleKey));
    }
  }

  private findSubCompanyParent(
    subCompanyId: string,
  ): { company: CompanyNode; subCompany: SubCompanyNode } | null {
    if (!subCompanyId) return null;

    for (const company of this.previewCompanies()) {
      const subCompany = company.subCompanies?.find((item) => item.id === subCompanyId);
      if (subCompany) {
        return { company, subCompany };
      }
    }

    return null;
  }

  private eventValue(event: Event): string {
    return (event.target as HTMLSelectElement | null)?.value || '';
  }

  goToProfile(): void {
    this.userMenuOpen.set(false);
    this.router.navigate(['/profile']);
  }

  logout(): void {
    this.userMenuOpen.set(false);
    this.auth.logout();
  }

  isDashboard(): boolean {
    return this.currentUrl().startsWith('/dashboard');
  }

  isMonitoreo(): boolean {
    const url = this.currentUrl();
    return url === '/companies' || url.startsWith('/companies/');
  }

  getUserInitials(): string {
    const user = this.auth.user();
    if (!user) return 'U';
    const first = user.nombre?.charAt(0) ?? '';
    const last = user.apellido?.charAt(0) ?? '';
    return `${first}${last}`.trim().toUpperCase() || user.nombre.substring(0, 2).toUpperCase();
  }
}
