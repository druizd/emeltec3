import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService, UserRole } from '../../../services/auth.service';
import { ShortcutService } from '../../../services/shortcut.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="h-16 shrink-0 border-b border-[#E2E8F0] bg-white">
      <div class="flex h-full items-stretch px-5">
        <nav class="flex items-stretch" aria-label="Navegación principal">
          <button
            type="button"
            (click)="router.navigate(['/dashboard'])"
            [style.color]="isDashboard() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isDashboard() ? '2px solid #0DAFBD' : '2px solid transparent'"
            class="flex items-center gap-1.5 border-0 border-t-2 border-transparent bg-transparent px-3 text-body font-medium transition-colors"
          >
            <span class="material-symbols-outlined text-[16px]">grid_view</span>
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            (click)="router.navigate(['/companies'])"
            [style.color]="isMonitoreo() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isMonitoreo() ? '2px solid #0DAFBD' : '2px solid transparent'"
            class="flex items-center gap-1.5 border-0 border-t-2 border-transparent bg-transparent px-3 text-body font-medium transition-colors"
          >
            <span class="material-symbols-outlined text-[16px]">monitoring</span>
            <span>Monitoreo</span>
          </button>
        </nav>

        <div class="flex-1"></div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            (click)="shortcuts.openPalette()"
            class="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#475569] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
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
                class="flex h-[30px] items-center gap-1 rounded-md px-2 text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#475569] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                aria-label="Ver como otro rol"
                title="Ver como otro rol"
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
                  class="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
                >
                  <div class="border-b border-[#E2E8F0] px-4 py-2.5">
                    <p class="text-caption-xs font-bold uppercase tracking-wide text-slate-400">
                      Ver como
                    </p>
                  </div>
                  <div class="py-1">
                    @for (role of viewAsOptions; track role.value) {
                      <button
                        type="button"
                        (click)="selectViewAs(role.value)"
                        class="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-body-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <span class="flex items-center gap-2.5">
                          <span class="material-symbols-outlined text-[16px] text-slate-400">
                            {{ role.icon }}
                          </span>
                          {{ role.label }}
                        </span>
                        @if (isActiveViewOption(role.value)) {
                          <span class="material-symbols-outlined text-[16px] text-[#0DAFBD]">
                            check
                          </span>
                        }
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <button
              (click)="router.navigate(['/administration'])"
              class="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#475569] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              aria-label="Administración"
            >
              <span class="material-symbols-outlined text-[16px]">settings</span>
            </button>
          } @else if (auth.isSuperAdmin()) {
            <button
              (click)="router.navigate(['/administration'])"
              class="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#475569] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
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
              class="ml-1 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary text-caption-xs font-bold text-white ring-2 ring-transparent transition-all hover:ring-primary-tint-30 focus-visible:outline-none focus-visible:ring-[#0DAFBD]"
              aria-label="Menú de usuario"
              [attr.aria-expanded]="userMenuOpen()"
            >
              {{ getUserInitials() }}
            </button>

            @if (userMenuOpen()) {
              <div
                class="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
              >
                <!-- User info -->
                <div class="border-b border-[#E2E8F0] px-4 py-3">
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
                    class="flex w-full items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <span class="material-symbols-outlined text-[16px] text-slate-400">person</span>
                    Mi perfil
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <span class="material-symbols-outlined text-[16px] text-slate-400"
                      >notifications</span
                    >
                    Notificaciones
                  </button>
                </div>
                <div class="border-t border-[#E2E8F0] py-1">
                  <button
                    type="button"
                    (click)="logout()"
                    class="flex w-full items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
                  >
                    <span class="material-symbols-outlined text-[16px]">logout</span>
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
  readonly router = inject(Router);

  private currentUrl = signal(this.router.url);
  readonly userMenuOpen = signal(false);
  readonly viewAsMenuOpen = signal(false);

  readonly viewAsOptions: { value: UserRole; label: string; icon: string }[] = [
    { value: 'SuperAdmin', label: 'Mi rol (SuperAdmin)', icon: 'shield_person' },
    { value: 'Admin', label: 'Admin', icon: 'admin_panel_settings' },
    { value: 'Gerente', label: 'Gerente', icon: 'manage_accounts' },
    { value: 'Cliente', label: 'Cliente', icon: 'person' },
  ];

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
    this.viewAsMenuOpen.update((v) => !v);
    this.userMenuOpen.set(false);
  }

  selectViewAs(role: UserRole): void {
    if (role === 'SuperAdmin') {
      this.auth.clearViewAs();
    } else {
      this.auth.setViewAs(role);
    }
    this.viewAsMenuOpen.set(false);
  }

  isActiveViewOption(role: UserRole): boolean {
    const viewAs = this.auth.viewAsRole();
    if (viewAs === null) return role === 'SuperAdmin';
    return role === viewAs;
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
