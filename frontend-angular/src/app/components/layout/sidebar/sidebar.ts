import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, FormsModule],
  template: `
    <aside class="fixed left-0 top-16 bottom-0 z-40 flex w-[220px] flex-col overflow-y-auto border-r border-slate-200 bg-white pt-4 text-xs font-['Inter']">
      <div class="px-3 pb-3 pt-1">
        <div class="rounded-2xl border border-slate-200 bg-slate-50/90 px-2.5 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.05)]">
          <div class="flex items-center gap-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 text-[10px] font-black text-white shadow-sm">
              {{ getUserInitials() }}
            </div>

            <div class="min-w-0">
              <p class="truncate text-[13px] font-black text-slate-700">{{ auth.user()?.nombre || 'Usuario' }}</p>
              <p class="text-[10px] text-slate-400">{{ auth.user()?.tipo || 'Rol' }}</p>
            </div>
          </div>
        </div>
      </div>

      <nav class="mb-4 flex flex-col gap-1 px-3">
        <a
          routerLink="/dashboard"
          routerLinkActive="bg-cyan-50 text-cyan-700 shadow-sm ring-1 ring-cyan-100 font-bold"
          class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700"
        >
          <span class="material-symbols-outlined text-[18px]">grid_view</span>
          <span class="text-[12px]">Dashboard</span>
        </a>
        @if (auth.isSuperAdmin()) {
          <a
            routerLink="/administration"
            routerLinkActive="bg-cyan-50 text-cyan-700 shadow-sm ring-1 ring-cyan-100 font-bold"
            class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700"
          >
            <span class="material-symbols-outlined text-[18px]">settings_applications</span>
            <span class="text-[12px]">Administracion</span>
          </a>
        }
      </nav>

      @if (auth.isSuperAdmin()) {
        <div class="mb-2 px-3">
          <div class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-100 bg-gradient-to-r from-cyan-50 to-teal-50 px-2.5 py-0.5">
            <span class="material-symbols-outlined text-[15px] text-cyan-600">water_drop</span>
            <h3 class="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">Consumo de Agua</h3>
          </div>
        </div>

        <div class="flex flex-col space-y-0.5 px-2.5">
          @for (company of filteredTree(); track company.id) {
            @if (company.tipo_empresa === 'Agua') {
              <div class="flex flex-col">
                <div (click)="toggleItem(company.id)" class="group flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-all hover:bg-slate-50">
                  <span class="material-symbols-outlined text-[18px] text-slate-300 transition-transform group-hover:text-cyan-500" [class.rotate-90]="expanded[company.id]">keyboard_arrow_right</span>
                  <span class="flex-1 truncate text-[12px] font-semibold text-slate-700">{{ company.nombre }}</span>
                </div>

                @if (expanded[company.id]) {
                  <div class="ml-4 mt-0.5 flex flex-col gap-0.5">
                    @for (sub of company.subCompanies; track sub.id) {
                      <div
                        (click)="selectSubCompany(sub.id)"
                        [class]="'cursor-pointer rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-all ' + (selectedId() === sub.id ? 'border-cyan-100 bg-cyan-50/80 text-cyan-800 shadow-[0_6px_14px_rgba(8,145,178,0.08)]' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700')"
                      >
                        <span class="truncate">{{ sub.nombre }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          }

          <div class="mb-2 mt-4 px-0.5">
            <div class="inline-flex items-center gap-1.5 rounded-xl border border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 px-2.5 py-0.5">
              <span class="material-symbols-outlined text-[15px] text-amber-500">bolt</span>
              <h3 class="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">Suministro Eléctrico</h3>
            </div>
          </div>

          @for (company of filteredTree(); track company.id) {
            @if (company.tipo_empresa === 'Eléctrico') {
              <div class="flex flex-col">
                <div (click)="toggleItem(company.id)" class="group flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-all hover:bg-slate-50">
                  <span class="material-symbols-outlined text-[18px] text-slate-300 transition-transform group-hover:text-amber-500" [class.rotate-90]="expanded[company.id]">keyboard_arrow_right</span>
                  <span class="flex-1 truncate text-[12px] font-semibold text-slate-700">{{ company.nombre }}</span>
                </div>

                @if (expanded[company.id]) {
                  <div class="ml-4 mt-0.5 flex flex-col gap-0.5">
                    @for (sub of company.subCompanies; track sub.id) {
                      <div
                        (click)="selectSubCompany(sub.id)"
                        [class]="'cursor-pointer rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-all ' + (selectedId() === sub.id ? 'border-cyan-100 bg-cyan-50/80 text-cyan-800 shadow-[0_6px_14px_rgba(8,145,178,0.08)]' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700')"
                      >
                        <span class="truncate">{{ sub.nombre }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          }

          @if (hasOtherTypes()) {
            <div class="mb-2 mt-4 px-0.5">
              <div class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <span class="material-symbols-outlined text-[15px] text-slate-500">factory</span>
                <h3 class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Industrial</h3>
              </div>
            </div>

            @for (company of filteredTree(); track company.id) {
              @if (company.tipo_empresa !== 'Agua' && company.tipo_empresa !== 'Eléctrico') {
                <div class="flex flex-col">
                  <div (click)="toggleItem(company.id)" class="group flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-all hover:bg-slate-50">
                    <span class="material-symbols-outlined text-[18px] text-slate-300 transition-transform group-hover:text-slate-500" [class.rotate-90]="expanded[company.id]">keyboard_arrow_right</span>
                    <span class="flex-1 truncate text-[12px] font-semibold text-slate-700">{{ company.nombre }}</span>
                  </div>

                  @if (expanded[company.id]) {
                    <div class="ml-4 mt-0.5 flex flex-col gap-0.5">
                      @for (sub of company.subCompanies; track sub.id) {
                        <div
                          (click)="selectSubCompany(sub.id)"
                          [class]="'cursor-pointer rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-all ' + (selectedId() === sub.id ? 'border-cyan-100 bg-cyan-50/80 text-cyan-800 shadow-[0_6px_14px_rgba(8,145,178,0.08)]' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700')"
                        >
                          <span class="truncate">{{ sub.nombre }}</span>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            }
          }
        </div>
      }

      @if (auth.isAdmin()) {
        <div class="mb-2 px-3">
          <div class="inline-flex items-center gap-1.5 rounded-xl border border-sky-100 bg-sky-50 px-2.5 py-1.5">
            <span class="material-symbols-outlined text-[15px] text-sky-600">domain</span>
            <h3 class="text-[10px] font-black uppercase tracking-[0.16em] text-sky-700">Mi Empresa</h3>
          </div>
        </div>

      @if (auth.isGerente()) {
        <div class="mb-2 px-3">
          <div class="inline-flex items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50 px-2.5 py-1.5">
            <span class="material-symbols-outlined text-[15px] text-emerald-600">shield_person</span>
            <h3 class="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Mi División</h3>
          </div>
        </div>

        <div class="flex flex-col space-y-1 px-2.5">
          @for (company of filteredTree(); track company.id) {
            <div class="flex flex-col">
              <div class="mb-1 flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5">
                <span class="material-symbols-outlined text-[16px] text-sky-600">corporate_fare</span>
                <span class="flex-1 truncate text-[12px] font-bold text-slate-700">{{ company.nombre }}</span>
              </div>

              <div class="ml-2 flex flex-col gap-0.5">
                @for (sub of company.subCompanies; track sub.id) {
                  <div
                    (click)="selectSubCompany(sub.id)"
                    [class]="'flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 transition-all ' + (selectedId() === sub.id ? 'bg-cyan-50 text-cyan-800 ring-1 ring-cyan-100 shadow-sm font-bold' : 'text-slate-500 hover:bg-slate-50 font-medium')"
                  >
                    <span class="material-symbols-outlined text-[15px]" [class.text-cyan-700]="selectedId() === sub.id">factory</span>
                    <span class="truncate text-[11px]">{{ sub.nombre }}</span>
                    @if (sub.sites?.length) {
                      <span class="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-400">{{ sub.sites.length }}</span>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

        <div class="flex flex-col space-y-1 px-2.5">
          @for (company of filteredTree(); track company.id) {
            <div class="flex items-center gap-1.5 px-2.5 py-1 text-slate-400">
              <span class="material-symbols-outlined text-[14px]">domain</span>
              <span class="truncate text-[10px] font-medium">{{ company.nombre }}</span>
            </div>

            @for (sub of company.subCompanies; track sub.id) {
              <div
                (click)="selectSubCompany(sub.id)"
                class="flex cursor-pointer items-center gap-2 rounded-xl bg-cyan-50/70 px-3 py-2 text-cyan-800 ring-1 ring-cyan-100 shadow-sm"
              >
                <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
                  <span class="material-symbols-outlined text-[15px] text-emerald-600">factory</span>
                </div>
                <div class="min-w-0">
                  <span class="block truncate text-[11px] font-bold">{{ sub.nombre }}</span>
                  <span class="text-[9px] font-medium text-slate-400">Encargado de División</span>
                </div>
              </div>
            }
          }

          <a routerLink="/companies" class="mt-3 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-500 transition-all hover:bg-slate-50">
            <span class="material-symbols-outlined text-[16px]">group</span>
            <span>Mi Equipo</span>
          </a>
        </div>
      }

      @if (auth.isCliente()) {
        <div class="mb-2 px-3">
          <div class="inline-flex items-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50 px-2.5 py-1.5">
            <span class="material-symbols-outlined text-[15px] text-blue-500">visibility</span>
            <h3 class="text-[10px] font-black uppercase tracking-[0.16em] text-blue-700">Mi Vista</h3>
          </div>
        </div>

        <div class="flex flex-col space-y-1 px-2.5">
          @for (company of filteredTree(); track company.id) {
            <div class="flex items-center gap-1.5 px-2.5 py-1 text-slate-400">
              <span class="material-symbols-outlined text-[14px]">domain</span>
              <span class="truncate text-[10px] font-medium">{{ company.nombre }}</span>
            </div>

            @for (sub of company.subCompanies; track sub.id) {
              <div
                (click)="selectSubCompany(sub.id)"
                class="flex cursor-pointer items-center gap-2 rounded-xl bg-blue-50/70 px-3 py-2 text-blue-800 ring-1 ring-blue-100 shadow-sm"
              >
                <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
                  <span class="material-symbols-outlined text-[15px] text-blue-500">factory</span>
                </div>
                <div class="min-w-0">
                  <span class="block truncate text-[11px] font-bold">{{ sub.nombre }}</span>
                  <span class="text-[9px] font-medium text-slate-400">Solo lectura</span>
                </div>
              </div>
            }
          }
        </div>
      }

      <div class="flex-1"></div>
    </aside>
  `,
})
export class SidebarComponent implements OnInit {
  companyService = inject(CompanyService);
  auth = inject(AuthService);
  router = inject(Router);

  expanded: Record<string, boolean> = {};
  filteredTree = signal<any[]>([]);
  selectedId = this.companyService.selectedSubCompanyId;

  getUserInitials(): string {
    const user = this.auth.user();
    const first = user?.nombre?.charAt(0) ?? '';
    const last = user?.apellido?.charAt(0) ?? '';
    const initials = `${first}${last}`.trim();

    return (initials || first || 'U').toUpperCase();
  }

  ngOnInit() {
    this.companyService.fetchHierarchy().subscribe((res: any) => {
      if (res.ok) {
        this.filteredTree.set(res.data);

        if (res.data.length > 0) {
          const firstCompany = res.data[0];

          if (this.auth.isSuperAdmin()) {
            this.expanded[firstCompany.id] = true;
            if (firstCompany.subCompanies?.[0]) {
              this.setSelectedSubCompany(firstCompany.subCompanies[0].id);
            }
          } else if (this.auth.isAdmin()) {
            this.expanded[firstCompany.id] = true;
            if (firstCompany.subCompanies?.[0] && !this.selectedId()) {
              this.setSelectedSubCompany(firstCompany.subCompanies[0].id);
            }
          } else if (firstCompany.subCompanies?.[0]) {
            this.setSelectedSubCompany(firstCompany.subCompanies[0].id);
          }
        }
      }
    });
  }

  toggleItem(id: string) {
    this.expanded[id] = !this.expanded[id];
  }

  selectSubCompany(id: string) {
    this.setSelectedSubCompany(id);
    this.router.navigate(['/companies']);
  }

  private setSelectedSubCompany(id: string) {
    this.companyService.selectedSubCompanyId.set(id);
  }

  hasOtherTypes(): boolean {
    return this.filteredTree().some(c => c.tipo_empresa !== 'Agua' && c.tipo_empresa !== 'Eléctrico');
  }
}
