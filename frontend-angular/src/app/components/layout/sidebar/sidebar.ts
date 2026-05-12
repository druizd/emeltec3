import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';

interface SiteItem {
  id: string;
  label: string;
}

interface CompanyItem {
  id: string;
  name: string;
  sites: SiteItem[];
}

interface ModuleDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
  companies: CompanyItem[];
}

const MODULES = [
  {
    key: 'Agua',
    label: 'Consumo de Agua',
    icon: 'water_drop',
    color: '#0dafbd',
    bg: 'rgba(13,175,189,0.10)',
    border: 'rgba(13,175,189,0.25)',
  },
  {
    key: 'Riles',
    label: 'Generacion de Riles',
    icon: 'waves',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.20)',
  },
  {
    key: 'Proceso',
    label: 'Variables de Proceso',
    icon: 'memory',
    color: '#6366f1',
    bg: 'rgba(99,102,241,0.08)',
    border: 'rgba(99,102,241,0.20)',
  },
  {
    key: 'Electrico',
    label: 'Consumo Electrico',
    icon: 'bolt',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.20)',
  },
  {
    key: '_other',
    label: 'Maletas Piloto',
    icon: 'rocket_launch',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.20)',
  },
];

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside
      class="flex h-full shrink-0 flex-col overflow-hidden bg-white"
      style="border-right: 1px solid #E2E8F0; box-shadow: 1px 0 4px rgba(15, 23, 42, 0.04); transition: width 0.2s cubic-bezier(0.4,0,0.2,1);"
      [style.width]="collapsed() ? '60px' : '248px'"
      aria-label="Menú lateral de navegación"
    >
      <!-- Header -->
      <div class="relative flex h-16 shrink-0 items-center border-b border-[#E2E8F0] px-4">
        @if (!collapsed()) {
          <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <img
              src="/images/emeltec-logo.webp"
              alt="Emeltec"
              class="h-[30px] w-auto object-contain"
            />
          </div>
        }
        <button
          type="button"
          (click)="collapsed.update((v) => !v)"
          class="flex h-5 w-5 items-center justify-center rounded-md text-[#cbd5e1] transition-colors hover:text-[#94a3b8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          [class.ml-auto]="!collapsed()"
          [class.mx-auto]="collapsed()"
          [attr.aria-label]="collapsed() ? 'Expandir barra lateral' : 'Contraer barra lateral'"
        >
          <span class="material-symbols-outlined text-[16px]">
            {{ collapsed() ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left' }}
          </span>
        </button>
      </div>

      <!-- User card -->
      @if (!collapsed()) {
        <div class="mx-2 mt-2.5 rounded-lg border border-[#E2E8F0] bg-[#f8fafc] px-2 py-1.5">
          <div class="flex items-center gap-1.5">
            <div class="relative shrink-0">
              <div
                class="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#0dafbd] to-[#04606a] text-[9px] font-bold text-white"
              >
                {{ getUserInitials() }}
              </div>
              <span
                class="absolute bottom-[1px] right-[1px] h-2 w-2 rounded-full border-[1.5px] border-[#f8fafc] bg-[#22c55e]"
              ></span>
            </div>
            <div class="min-w-0">
              <p class="truncate text-[12px] font-semibold leading-tight text-[#1e293b]">
                {{ auth.user()?.nombre || 'Usuario' }}
              </p>
              <p class="text-[10px] text-[#94a3b8]">{{ auth.user()?.tipo || 'Rol' }}</p>
            </div>
          </div>
        </div>

        <!-- Search (solo con 10+ empresas o sitios) -->
        @if (showSearch()) {
          <div class="mx-2 mt-2">
            <label class="relative block">
              <span
                class="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-[#94a3b8]"
                >search</span
              >
              <input
                type="search"
                [value]="searchTerm()"
                (input)="onSearchInput($event)"
                placeholder="Buscar empresa..."
                class="h-8 w-full rounded-lg border border-[#E2E8F0] bg-white pl-7 pr-7 text-[11px] font-medium text-[#334155] outline-none transition-colors placeholder:text-[#a8b5c7] focus:border-[#8bdde5] focus:bg-[#faffff]"
              />
              @if (searchTerm()) {
                <button
                  type="button"
                  (click)="clearSearch()"
                  class="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#64748b]"
                  aria-label="Limpiar búsqueda"
                >
                  <span class="material-symbols-outlined text-[13px]">close</span>
                </button>
              }
            </label>
          </div>
        }
      }

      <!-- Module list -->
      <div class="mt-1.5 flex-1 overflow-y-auto pb-1.5">
        @for (mod of moduleTree(); track mod.key) {
          <div [class]="collapsed() ? 'mx-1 my-px' : 'mx-1.5 my-px'">
            <button
              type="button"
              (click)="onModuleClick(mod.key)"
              class="flex w-full cursor-pointer select-none items-center rounded-lg transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              [style.justify-content]="collapsed() ? 'center' : 'space-between'"
              [style.padding]="collapsed() ? '8px' : '6px 7px'"
              [style.gap]="collapsed() ? '0' : '7px'"
              [style.color]="openModule() === mod.key ? '#0899a5' : '#475569'"
              [style.background]="
                openModule() === mod.key ? 'rgba(13,175,189,0.06)' : 'transparent'
              "
              [attr.aria-expanded]="openModule() === mod.key"
              [title]="collapsed() ? mod.label : ''"
            >
              <span class="flex min-w-0 items-center" [style.gap]="collapsed() ? '0' : '7px'">
                <span
                  class="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md"
                  [style.background]="mod.bg"
                  [style.border]="'1px solid ' + mod.border"
                >
                  <span class="material-symbols-outlined text-[14px]" [style.color]="mod.color">{{
                    mod.icon
                  }}</span>
                </span>
                @if (!collapsed()) {
                  <span class="truncate text-left text-[13px] font-medium">{{ mod.label }}</span>
                }
              </span>

              @if (!collapsed() && mod.companies.length > 0) {
                <span
                  class="material-symbols-outlined shrink-0 text-[12px] text-[#cbd5e1] transition-transform"
                  [style.transform]="openModule() === mod.key ? 'rotate(90deg)' : 'none'"
                >
                  chevron_right
                </span>
              }
            </button>

            @if (!collapsed() && openModule() === mod.key && mod.companies.length > 0) {
              <div class="mb-0.5 pl-2.5">
                @for (company of mod.companies; track company.id) {
                  <button
                    type="button"
                    (click)="toggleCompany(company.id)"
                    class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-[4px] text-left text-[9px] font-bold uppercase tracking-[0.07em] text-[#94a3b8] transition-colors hover:bg-[#f8fafc] hover:text-[#64748b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                    [attr.aria-expanded]="isCompanyOpen(company.id)"
                  >
                    <span class="material-symbols-outlined text-[11px] opacity-50">domain</span>
                    <span class="truncate">{{ company.name }}</span>
                  </button>

                  @if (isCompanyOpen(company.id)) {
                    <div class="relative ml-2.5 pl-2.5">
                      <span class="absolute bottom-[6px] left-1 top-0 w-px bg-[#e2e8f0]"></span>
                      @for (site of company.sites; track site.id) {
                        <button
                          type="button"
                          (click)="selectSubCompany($event, mod.key, company.id, site.id)"
                          class="relative mb-px block w-full cursor-pointer rounded-md py-[3px] pl-2 pr-1.5 text-left text-[10.5px] transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                          [style.color]="activeSiteId() === site.id ? '#0899a5' : '#64748b'"
                          [style.font-weight]="activeSiteId() === site.id ? '600' : '400'"
                          [style.background]="
                            activeSiteId() === site.id ? 'rgba(13,175,189,0.06)' : 'transparent'
                          "
                          [attr.aria-current]="activeSiteId() === site.id ? 'page' : null"
                        >
                          <span
                            class="absolute left-[-10px] top-1/2 block h-px w-2"
                            [style.background]="activeSiteId() === site.id ? '#0dafbd' : '#e2e8f0'"
                          ></span>
                          <span class="block truncate">{{ site.label }}</span>
                        </button>
                      }
                    </div>
                  }
                }
              </div>
            }
          </div>
        }

        @if (!collapsed() && searchTerm() && !hasSearchResults()) {
          <div
            class="mx-2 mt-2 rounded-lg border border-dashed border-[#E2E8F0] bg-[#f8fafc] px-2 py-2 text-center text-[11px] font-medium text-[#94a3b8]"
          >
            Sin resultados
          </div>
        }
      </div>

      <!-- Logout -->
      <div class="shrink-0 border-t border-[#E2E8F0] p-1.5">
        <button
          type="button"
          (click)="auth.logout()"
          class="flex w-full items-center rounded-lg border-0 bg-transparent px-2 py-1.5 text-[#94a3b8] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
          [class.justify-center]="collapsed()"
          [class.gap-1.5]="!collapsed()"
          [title]="collapsed() ? 'Cerrar sesión' : ''"
        >
          <span class="material-symbols-outlined text-[16px]">logout</span>
          @if (!collapsed()) {
            <span class="text-[12px]">Cerrar sesion</span>
          }
        </button>
      </div>
    </aside>
  `,
})
export class SidebarComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly companyService = inject(CompanyService);
  readonly router = inject(Router);

  collapsed = signal(false);
  openModule = signal<string | null>('Agua');
  searchTerm = signal('');
  expandedCompanyIds = signal<Set<string>>(new Set());
  activeSiteId = this.companyService.selectedSubCompanyId;

  moduleTree = computed<ModuleDef[]>(() => {
    const tree = this.companyService.hierarchy();
    const tokens = this.getSearchTokens(this.searchTerm());

    const modules = MODULES.map((def) => {
      const companies = tree
        .filter((company: any) => this.matchesModule(company.tipo_empresa, def.key))
        .map((company: any) => this.toCompanyItem(def, company, tokens))
        .filter((company): company is CompanyItem => Boolean(company));

      return { ...def, companies };
    });

    return tokens.length ? modules.filter((module) => module.companies.length > 0) : modules;
  });

  showSearch = computed(() => {
    const modules = this.moduleTree();
    let total = 0;
    for (const mod of modules) {
      total += mod.companies.length;
      for (const company of mod.companies) {
        total += company.sites.length;
      }
    }
    return total >= 15;
  });

  hasSearchResults = computed(() => {
    if (!this.searchTerm().trim()) {
      return true;
    }

    return this.moduleTree().some((module) => module.companies.length > 0);
  });

  ngOnInit(): void {
    this.companyService.fetchHierarchy().subscribe(() => {
      if (this.searchTerm().trim()) {
        this.syncOpenStateWithSearch();
      } else {
        this.initializeSelection();
      }
    });
  }

  onModuleClick(key: string): void {
    if (this.collapsed()) {
      this.collapsed.set(false);
      this.openModule.set(key);
    } else {
      this.toggleModule(key);
    }
  }

  toggleModule(key: string): void {
    this.openModule.update((current) => (current === key ? null : key));
  }

  toggleCompany(companyId: string): void {
    this.expandedCompanyIds.update((current) => {
      const next = new Set(current);

      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }

      return next;
    });
  }

  isCompanyOpen(companyId: string): boolean {
    return this.expandedCompanyIds().has(companyId);
  }

  selectSubCompany(event: Event, moduleKey: string, companyId: string, subCompanyId: string): void {
    event.stopPropagation();
    this.companyService.selectedSubCompanyId.set(subCompanyId);
    this.openModule.set(moduleKey);
    this.expandCompany(companyId);
    this.router.navigate(['/companies']);
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.searchTerm.set(input?.value || '');
    this.syncOpenStateWithSearch();
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.expandedCompanyIds.set(new Set());
    this.openActivePath();
  }

  getUserInitials(): string {
    const user = this.auth.user();
    if (!user) return 'U';

    const first = user.nombre?.charAt(0) ?? '';
    const last = user.apellido?.charAt(0) ?? '';
    return `${first}${last}`.trim().toUpperCase() || user.nombre.substring(0, 2).toUpperCase();
  }

  private matchesModule(type: string, key: string): boolean {
    const normalized = (type || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (key === 'Agua') return normalized.includes('agua');
    if (key === 'Riles') return normalized.includes('ril');
    if (key === 'Proceso') return normalized.includes('proceso') || normalized.includes('variable');
    if (key === 'Electrico') return normalized.includes('elect');

    return !['agua', 'ril', 'proceso', 'variable', 'elect'].some((value) =>
      normalized.includes(value),
    );
  }

  private initializeSelection(): void {
    if (this.openActivePath()) {
      return;
    }

    const firstModule = this.moduleTree().find((module) =>
      module.companies.some((company) => company.sites.length),
    );
    const firstSubCompany = firstModule?.companies[0]?.sites[0];

    if (firstModule) {
      this.openModule.set(firstModule.key);
    }

    if (firstSubCompany) {
      this.companyService.selectedSubCompanyId.set(firstSubCompany.id);
      this.expandCompany(firstModule.companies[0].id);
    }
  }

  private toCompanyItem(
    def: (typeof MODULES)[number],
    company: any,
    tokens: string[],
  ): CompanyItem | null {
    const sites: SiteItem[] = (company.subCompanies || []).map((sub: any) => ({
      id: sub.id,
      label: sub.nombre || sub.descripcion || sub.id,
    }));

    const item: CompanyItem = {
      id: company.id,
      name: company.nombre,
      sites,
    };

    if (!tokens.length) {
      return item;
    }

    const companyTarget = this.normalizeSearch(`${def.label} ${def.key} ${item.name}`);
    const companyMatches = this.matchesTokens(companyTarget, tokens);
    const filteredSites = sites.filter((site) => {
      const target = this.normalizeSearch(`${def.label} ${def.key} ${item.name} ${site.label}`);
      return this.matchesTokens(target, tokens);
    });

    if (companyMatches) {
      return item;
    }

    if (filteredSites.length) {
      return { ...item, sites: filteredSites };
    }

    return null;
  }

  private syncOpenStateWithSearch(): void {
    if (!this.searchTerm().trim()) {
      this.expandedCompanyIds.set(new Set());
      this.openActivePath();
      return;
    }

    const firstModule = this.moduleTree().find((module) => module.companies.length > 0);

    if (!firstModule) {
      this.expandedCompanyIds.set(new Set());
      return;
    }

    this.openModule.set(firstModule.key);
    this.expandedCompanyIds.set(new Set(firstModule.companies.map((company) => company.id)));
  }

  private openActivePath(): boolean {
    const activeId = this.activeSiteId();

    if (!activeId) {
      return false;
    }

    for (const module of this.moduleTree()) {
      const company = module.companies.find((item) =>
        item.sites.some((site) => site.id === activeId),
      );

      if (company) {
        this.openModule.set(module.key);
        this.expandCompany(company.id);
        return true;
      }
    }

    return false;
  }

  private expandCompany(companyId: string): void {
    this.expandedCompanyIds.update((current) => {
      if (current.has(companyId)) {
        return current;
      }

      const next = new Set(current);
      next.add(companyId);
      return next;
    });
  }

  private getSearchTokens(value: string): string[] {
    return this.normalizeSearch(value).split(/\s+/).filter(Boolean);
  }

  private normalizeSearch(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private matchesTokens(target: string, tokens: string[]): boolean {
    return tokens.every(
      (token) =>
        target.includes(token) || (token.length >= 5 && target.includes(token.slice(0, 5))),
    );
  }
}
