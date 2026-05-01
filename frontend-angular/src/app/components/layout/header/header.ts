import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-50 flex items-center justify-between px-6">
      <div class="flex items-center gap-8">
        <button
          type="button"
          class="flex h-12 w-[190px] items-center justify-start rounded-lg"
          (click)="router.navigate(['/dashboard'])"
        >
          <img
            src="/images/emeltec-logo.svg"
            alt="Emeltec"
            class="h-10 w-auto object-contain"
          />
        </button>
        
        <div class="relative w-96 hidden md:block">
          <span class="absolute inset-y-0 left-3 flex items-center">
            <span class="material-symbols-outlined text-slate-400 text-lg">search</span>
          </span>
          <input 
            class="w-full bg-slate-50 border-none rounded-xl py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary-container/10 transition-all outline-none" 
            placeholder="Buscador global..." 
            type="text"
          />
        </div>
      </div>
      
      <div class="flex items-center gap-2">
        <!-- Acceso a Gestión de Usuarios: solo SuperAdmin y Admin -->
        @if (auth.canManageUsers()) {
          <button (click)="goToUsers()" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 text-slate-500 hover:text-primary-container transition-all" title="Gestión de Usuarios">
            <span class="material-symbols-outlined">group</span>
          </button>
        }

        <button class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 text-slate-500 transition-colors">
          <span class="material-symbols-outlined">notifications</span>
        </button>

        <!-- Configuración: solo SuperAdmin y Admin -->
        @if (auth.canEdit()) {
          <button class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 text-slate-500 transition-colors">
            <span class="material-symbols-outlined">settings</span>
          </button>
        }
        
        <div class="h-8 w-[1px] bg-slate-200 mx-2"></div>
        
        <div class="flex items-center gap-3 pl-2">
          <div class="text-right hidden sm:block">
            <p class="text-xs font-bold text-slate-800 leading-none">{{ auth.user()?.nombre || 'Usuario' }}</p>
            <p class="text-[10px] text-slate-400 font-medium mt-1">{{ auth.user()?.tipo || 'Rol' }}</p>
          </div>

          <!-- Badge de rol con color -->
          <div [class]="'w-9 h-9 rounded-full flex items-center justify-center border ' + getRoleBadgeClasses()">
            <span [class]="'material-symbols-outlined text-lg ' + getRoleIconColor()">
              {{ getRoleIcon() }}
            </span>
          </div>
          
          <!-- Botón de Cerrar Sesión -->
          <button (click)="auth.logout()" class="ml-2 w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-all" title="Cerrar Sesión">
            <span class="material-symbols-outlined">logout</span>
          </button>
        </div>
      </div>
    </header>
  `
})
export class HeaderComponent {
  auth = inject(AuthService);
  router = inject(Router);

  goToUsers() {
    this.router.navigate(['/companies']);
  }

  getRoleIcon(): string {
    if (this.auth.isSuperAdmin()) return 'admin_panel_settings';
    if (this.auth.isAdmin()) return 'manage_accounts';
    if (this.auth.isGerente()) return 'shield_person';
    return 'person';
  }

  getRoleBadgeClasses(): string {
    if (this.auth.isSuperAdmin()) return 'bg-purple-50 border-purple-200';
    if (this.auth.isAdmin()) return 'bg-blue-50 border-blue-200';
    if (this.auth.isGerente()) return 'bg-emerald-50 border-emerald-200';
    return 'bg-slate-50 border-slate-200';
  }

  getRoleIconColor(): string {
    if (this.auth.isSuperAdmin()) return 'text-purple-500';
    if (this.auth.isAdmin()) return 'text-blue-500';
    if (this.auth.isGerente()) return 'text-emerald-500';
    return 'text-slate-500';
  }
}
