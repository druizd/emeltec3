import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header style="background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0,0,0,0.05);">
      <!-- Tab bar -->
      <div style="height: 52px; display: flex; align-items: stretch; padding: 0 20px;">

        <!-- Tabs -->
        <div style="display: flex; align-items: stretch;">
          <button (click)="router.navigate(['/dashboard'])"
            [style.color]="isDashboard() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isDashboard() ? '2px solid #0DAFBD' : '2px solid transparent'"
            style="display: flex; align-items: center; gap: 6px; padding: 0 16px; font-size: 14px; font-weight: 500; background: none; border: none; border-top: 2px solid transparent; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s;">
            <span class="material-symbols-outlined" style="font-size: 16px;">grid_view</span>
            Dashboard
          </button>
          <button (click)="router.navigate(['/companies'])"
            [style.color]="isMonitoreo() ? '#0899A5' : '#94A3B8'"
            [style.border-bottom]="isMonitoreo() ? '2px solid #0DAFBD' : '2px solid transparent'"
            style="display: flex; align-items: center; gap: 6px; padding: 0 16px; font-size: 14px; font-weight: 500; background: none; border: none; border-top: 2px solid transparent; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s;">
            <span class="material-symbols-outlined" style="font-size: 16px;">monitoring</span>
            Monitoreo
          </button>
        </div>

        <div style="flex: 1;"></div>

        <!-- Right controls -->
        <div style="display: flex; align-items: center; gap: 6px;">

          <!-- Theme toggle (decorative) -->
          <div style="display: flex; align-items: center; background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 20px; padding: 3px; gap: 2px;">
            <div style="width: 26px; height: 26px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: #FFFFFF; color: #0899A5; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;">
              <span class="material-symbols-outlined" style="font-size: 13px;">light_mode</span>
            </div>
            <div style="width: 26px; height: 26px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #94A3B8; cursor: pointer;">
              <span class="material-symbols-outlined" style="font-size: 13px;">dark_mode</span>
            </div>
          </div>

          <!-- WIP badge -->
          <div style="display: flex; align-items: center; gap: 5px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 600; color: #D97706; cursor: default;">
            <span class="material-symbols-outlined" style="font-size: 12px;">build</span>
            WIP
          </div>

          <!-- Contáctanos -->
          <div style="display: flex; align-items: center; gap: 5px; color: #64748B; font-size: 13px; cursor: pointer; padding: 5px 8px; border-radius: 6px; font-family: 'DM Sans', sans-serif; transition: all 0.12s;"
            (mouseenter)="$event.currentTarget.style.background='#F1F5F9'"
            (mouseleave)="$event.currentTarget.style.background='transparent'">
            <span class="material-symbols-outlined" style="font-size: 13px;">headset_mic</span>
            Contáctanos
          </div>

          @if (auth.canManageUsers()) {
            <button (click)="router.navigate(['/users'])"
              style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 6px; background: none; border: none; cursor: pointer; color: #94A3B8; transition: all 0.12s;"
              title="Gestión de Usuarios"
              (mouseenter)="$event.currentTarget.style.color='#475569'"
              (mouseleave)="$event.currentTarget.style.color='#94A3B8'">
              <span class="material-symbols-outlined" style="font-size: 16px;">group</span>
            </button>
          }

          @if (auth.isSuperAdmin()) {
            <button (click)="router.navigate(['/administration'])"
              style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 6px; background: none; border: none; cursor: pointer; color: #94A3B8; transition: all 0.12s;"
              title="Administración"
              (mouseenter)="$event.currentTarget.style.color='#475569'"
              (mouseleave)="$event.currentTarget.style.color='#94A3B8'">
              <span class="material-symbols-outlined" style="font-size: 16px;">settings</span>
            </button>
          }

          <!-- User avatar -->
          <div style="width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #0DAFBD, #04606A); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; cursor: pointer; flex-shrink: 0; user-select: none;"
            title="{{ auth.user()?.nombre }}">
            {{ getUserInitials() }}
          </div>
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
    const url = this.currentUrl();
    return url === '/dashboard' || url.startsWith('/dashboard');
  }

  isMonitoreo(): boolean {
    const url = this.currentUrl();
    return url === '/companies' || url.startsWith('/companies/');
  }

  getUserInitials(): string {
    const u = this.auth.user();
    if (!u) return 'U';
    const parts = (u.nombre || '').trim().split(' ');
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : u.nombre.substring(0, 2).toUpperCase();
  }
}
