import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';

interface SiteItem { id: string; label: string; }
interface CompanyItem { id: string; name: string; sites: SiteItem[]; }
interface ModuleDef { key: string; label: string; icon: string; color: string; bg: string; border: string; companies: CompanyItem[]; }

const MODULE_DEFS = [
  { key: 'Agua',      label: 'Consumo de Agua',      icon: 'water_drop',    color: '#0DAFBD', bg: 'rgba(13,175,189,0.1)',  border: 'rgba(13,175,189,0.25)' },
  { key: 'Riles',     label: 'Generación de Riles',  icon: 'waves',         color: '#22C55E', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.2)'  },
  { key: 'Proceso',   label: 'Variables de Proceso', icon: 'memory',        color: '#6366F1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)' },
  { key: 'Eléctrico', label: 'Consumo Eléctrico',    icon: 'bolt',          color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  { key: '_other',    label: 'Maletas Piloto',        icon: 'rocket_launch', color: '#F97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.2)' },
];
const KNOWN_TYPES = ['Agua', 'Riles', 'Proceso', 'Eléctrico'];

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="flex flex-col h-full flex-shrink-0 bg-white overflow-hidden transition-[width] duration-200"
      [style.width]="collapsed() ? '60px' : '248px'"
      style="border-right: 1px solid #E2E8F0; box-shadow: 1px 0 4px rgba(0,0,0,0.04);">

      <!-- Brand -->
      <div style="padding: 14px 16px; border-bottom: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; min-height: 60px; flex-shrink: 0;">
        @if (!collapsed()) {
          <img src="/images/emeltec-logo.webp" alt="Emeltec" style="height: 28px; object-fit: contain;" />
        }
        <button (click)="collapsed.set(!collapsed())"
          [style.margin-left]="collapsed() ? 'auto' : '0'"
          class="flex items-center justify-center rounded-md transition-colors"
          style="background: none; border: none; cursor: pointer; color: #CBD5E1; padding: 4px;"
          (mouseenter)="$event.currentTarget.style.color='#94A3B8'"
          (mouseleave)="$event.currentTarget.style.color='#CBD5E1'">
          <span class="material-symbols-outlined" style="font-size: 18px;">
            {{ collapsed() ? 'chevron_right' : 'keyboard_double_arrow_left' }}
          </span>
        </button>
      </div>

      <!-- User card -->
      @if (!collapsed()) {
        <div style="margin: 10px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px; flex-shrink: 0;">
          <div style="display: flex; align-items: center; gap: 9px;">
            <div style="position: relative; flex-shrink: 0;">
              <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #0DAFBD, #04606A); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff;">
                {{ getUserInitials() }}
              </div>
              <span style="position: absolute; bottom: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: #22C55E; border: 2px solid #F8FAFC;"></span>
            </div>
            <div>
              <div style="font-size: 13px; font-weight: 600; color: #1E293B; line-height: 1.2;">{{ auth.user()?.nombre || 'Usuario' }}</div>
              <div style="font-size: 11px; color: #94A3B8;">{{ auth.user()?.tipo || 'Rol' }}</div>
            </div>
          </div>
        </div>
      }

      <!-- Module tree -->
      <div style="flex: 1; overflow-y: auto; padding-bottom: 8px;">
        @for (mod of moduleTree(); track mod.key) {
          <div style="margin: 2px 8px;">

            <!-- Module header row -->
            <div (click)="toggleModule(mod.key)"
              class="flex items-center rounded-lg cursor-pointer select-none transition-all duration-100"
              [style.gap]="collapsed() ? '0' : '9px'"
              [style.justify-content]="collapsed() ? 'center' : 'space-between'"
              [style.padding]="collapsed() ? '9px 0' : '8px 10px'"
              [style.color]="openModule() === mod.key ? '#0899A5' : '#475569'"
              [style.background]="openModule() === mod.key ? 'rgba(13,175,189,0.06)' : 'transparent'"
              (mouseenter)="onModHover($event, mod.key, true)"
              (mouseleave)="onModHover($event, mod.key, false)">
              <div style="display: flex; align-items: center; gap: 9px;">
                <div [style.background]="mod.bg" [style.border]="'1px solid ' + mod.border"
                  style="width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  <span class="material-symbols-outlined" [style.color]="mod.color" style="font-size: 14px;">{{ mod.icon }}</span>
                </div>
                @if (!collapsed()) {
                  <span style="font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ mod.label }}</span>
                }
              </div>
              @if (!collapsed() && mod.companies.length > 0) {
                <span class="material-symbols-outlined"
                  style="font-size: 13px; color: #CBD5E1; flex-shrink: 0; transition: transform 0.15s;"
                  [style.transform]="openModule() === mod.key ? 'rotate(90deg)' : 'none'">chevron_right</span>
              }
            </div>

            <!-- Companies + sites tree -->
            @if (!collapsed() && openModule() === mod.key && mod.companies.length > 0) {
              <div style="padding-left: 16px; margin-bottom: 4px;">
                @for (company of mod.companies; track company.id) {
                  <div style="font-size: 10px; font-weight: 700; color: #94A3B8; letter-spacing: 0.07em; text-transform: uppercase; padding: 5px 10px 2px; display: flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-outlined" style="font-size: 10px; opacity: 0.5;">apartment</span>
                    {{ company.name }}
                  </div>
                  <div style="position: relative; padding-left: 14px;">
                    <div style="position: absolute; left: 4px; top: 0; bottom: 6px; width: 1px; background: #E2E8F0;"></div>
                    @for (site of company.sites; track site.id) {
                      <div (click)="navigateSite($event, mod.key, site.id)"
                        [style.color]="activeSiteId() === site.id ? '#0899A5' : '#64748B'"
                        [style.font-weight]="activeSiteId() === site.id ? '600' : '400'"
                        [style.background]="activeSiteId() === site.id ? 'rgba(13,175,189,0.06)' : 'transparent'"
                        style="position: relative; font-size: 12px; padding: 5px 10px 5px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 1px; transition: all 0.12s;"
                        (mouseenter)="onSiteHover($event, site.id, true)"
                        (mouseleave)="onSiteHover($event, site.id, false)">
                        <span style="position: absolute; left: -10px; top: 50%; display: block; width: 8px; height: 1px; margin-top: -0.5px;"
                          [style.background]="activeSiteId() === site.id ? '#0DAFBD' : '#E2E8F0'"></span>
                        {{ site.label }}
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- Admin link -->
        @if (auth.isSuperAdmin()) {
          <div style="margin: 2px 8px;">
            <div (click)="router.navigate(['/administration'])"
              class="flex items-center rounded-lg cursor-pointer transition-all duration-100"
              [style.justify-content]="collapsed() ? 'center' : 'flex-start'"
              [style.gap]="collapsed() ? '0' : '9px'"
              [style.padding]="collapsed() ? '9px 0' : '8px 10px'"
              style="color: #94A3B8;"
              (mouseenter)="$event.currentTarget.style.background='#F1F5F9'"
              (mouseleave)="$event.currentTarget.style.background='transparent'">
              <div style="width: 28px; height: 28px; border-radius: 7px; background: rgba(100,116,139,0.08); border: 1px solid rgba(100,116,139,0.15); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <span class="material-symbols-outlined" style="font-size: 14px; color: #94A3B8;">settings_applications</span>
              </div>
              @if (!collapsed()) {
                <span style="font-size: 13px; font-weight: 500;">Administración</span>
              }
            </div>
          </div>
        }
      </div>

      <!-- Footer: logout -->
      <div style="padding: 8px; border-top: 1px solid #E2E8F0; flex-shrink: 0;">
        <button (click)="auth.logout()"
          class="flex items-center w-full rounded-lg cursor-pointer transition-all duration-100"
          [style.justify-content]="collapsed() ? 'center' : 'flex-start'"
          style="gap: 8px; padding: 8px 10px; background: none; border: none; color: #94A3B8;"
          (mouseenter)="onLogoutHover($event, true)"
          (mouseleave)="onLogoutHover($event, false)">
          <span class="material-symbols-outlined" style="font-size: 18px; flex-shrink: 0;">logout</span>
          @if (!collapsed()) {
            <span style="font-size: 13px;">Cerrar sesión</span>
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
  activeSiteId = signal<string | null>(null);

  moduleTree = computed<ModuleDef[]>(() => {
    const tree = this.companyService.hierarchy();
    return MODULE_DEFS.map(def => {
      const filterFn = def.key === '_other'
        ? (c: any) => !KNOWN_TYPES.includes(c.tipo_empresa)
        : (c: any) => c.tipo_empresa === def.key;

      const companies: CompanyItem[] = tree.filter(filterFn).map((c: any) => ({
        id: c.id,
        name: c.nombre,
        sites: (c.subCompanies || []).flatMap((sc: any) =>
          (sc.sites || []).map((s: any) => ({
            id: s.id,
            label: s.descripcion || s.nombre || sc.nombre || s.id,
          }))
        ),
      }));

      return { ...def, companies };
    });
  });

  ngOnInit(): void {
    this.companyService.fetchHierarchy().subscribe();
    const match = this.router.url.match(/\/companies\/([^/]+)\/water/);
    if (match) this.activeSiteId.set(match[1]);
  }

  toggleModule(key: string): void {
    this.openModule.update(m => m === key ? null : key);
  }

  navigateSite(event: Event, moduleKey: string, siteId: string): void {
    event.stopPropagation();
    this.activeSiteId.set(siteId);
    this.openModule.set(moduleKey);
    this.router.navigate(['/companies', siteId, 'water']);
  }

  getUserInitials(): string {
    const u = this.auth.user();
    if (!u) return 'U';
    const parts = (u.nombre || '').trim().split(' ');
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : u.nombre.substring(0, 2).toUpperCase();
  }

  onModHover(event: MouseEvent, key: string, enter: boolean): void {
    const el = event.currentTarget as HTMLElement;
    el.style.background = enter
      ? (this.openModule() === key ? 'rgba(13,175,189,0.06)' : '#F1F5F9')
      : (this.openModule() === key ? 'rgba(13,175,189,0.06)' : 'transparent');
  }

  onSiteHover(event: MouseEvent, siteId: string, enter: boolean): void {
    const el = event.currentTarget as HTMLElement;
    el.style.background = enter
      ? (this.activeSiteId() === siteId ? 'rgba(13,175,189,0.06)' : '#F1F5F9')
      : (this.activeSiteId() === siteId ? 'rgba(13,175,189,0.06)' : 'transparent');
  }

  onLogoutHover(event: MouseEvent, enter: boolean): void {
    const el = event.currentTarget as HTMLElement;
    el.style.background = enter ? '#FEF2F2' : 'transparent';
    el.style.color = enter ? '#DC2626' : '#94A3B8';
  }
}
