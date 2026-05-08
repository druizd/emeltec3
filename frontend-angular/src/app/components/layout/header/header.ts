import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="h-[52px] shrink-0 border-b border-[#dfe7f1] bg-white">
      <div class="flex h-full items-stretch px-5">
        <nav class="flex items-stretch">
          <button
            type="button"
            (click)="router.navigate(['/dashboard'])"
            [style.color]="isDashboard() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isDashboard() ? '2px solid #0DAFBD' : '2px solid transparent'"
            class="flex items-center gap-1.5 border-0 border-t-2 border-transparent bg-transparent px-3 text-[14px] font-medium transition-colors"
          >
            <span class="material-symbols-outlined text-[16px]">grid_view</span>
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            (click)="router.navigate(['/companies'])"
            [style.color]="isMonitoreo() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isMonitoreo() ? '2px solid #0DAFBD' : '2px solid transparent'"
            class="flex items-center gap-1.5 border-0 border-t-2 border-transparent bg-transparent px-3 text-[14px] font-medium transition-colors"
          >
            <span class="material-symbols-outlined text-[16px]">monitoring</span>
            <span>Dynamic</span>
          </button>
        </nav>

        <div class="flex-1"></div>

        <div class="flex items-center gap-1.5">
          <div class="flex items-center gap-0.5 rounded-full border border-[#dfe7f1] bg-[#f8fafc] p-[2px]">
            <button class="flex h-[25px] w-[25px] items-center justify-center rounded-full bg-white text-[#0899A5] shadow-sm" title="Tema claro">
              <span class="material-symbols-outlined text-[13px]">light_mode</span>
            </button>
            <button class="flex h-[25px] w-[25px] items-center justify-center rounded-full text-[#94A3B8]" title="Tema oscuro">
              <span class="material-symbols-outlined text-[13px]">dark_mode</span>
            </button>
          </div>

          <div class="flex items-center gap-1 rounded-md border border-[#fde68a] bg-[#fffbeb] px-2.5 py-1 text-[12px] font-semibold text-[#d97706]">
            <span class="material-symbols-outlined text-[12px]">build</span>
            <span>WIP</span>
          </div>

          <button class="hidden items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9] md:flex">
            <span class="material-symbols-outlined text-[13px]">headset_mic</span>
            <span>Contactanos</span>
          </button>

          @if (auth.isSuperAdmin()) {
            <button (click)="router.navigate(['/administration'])" class="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#94a3b8] transition-colors hover:text-[#475569]" title="Administracion">
              <span class="material-symbols-outlined text-[16px]">settings</span>
            </button>
          }

          <button
            type="button"
            (click)="auth.logout()"
            class="ml-1 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gradient-to-br from-[#0dafbd] to-[#04606a] text-[11px] font-bold text-white"
            title="{{ auth.user()?.nombre }}"
          >
            {{ getUserInitials() }}
          </button>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly router = inject(Router);

  private currentUrl = signal(this.router.url);

  ngOnInit(): void {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this.currentUrl.set(e.urlAfterRedirects || e.url);
    });
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
