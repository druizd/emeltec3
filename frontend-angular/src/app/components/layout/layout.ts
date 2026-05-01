import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header/header';
import { SidebarComponent } from './sidebar/sidebar';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, SidebarComponent],
  template: `
    <div class="min-h-screen bg-slate-50 font-['Inter']">
      <app-header></app-header>
      
      <div class="flex">
        <app-sidebar></app-sidebar>
        
        <!-- Main Content Area -->
        <!-- pt-16 para compensar la altura del header (h-16) -->
        <!-- ml-[260px] para compensar el ancho del sidebar -->
        <main class="flex-1 ml-[220px] pt-16 min-h-screen">
          <div class="animate-in fade-in duration-500">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>
  `
})
export class LayoutComponent implements OnInit {
  private router = inject(Router);

  ngOnInit(): void {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    if (navigation?.type === 'reload' && this.router.url !== '/dashboard') {
      queueMicrotask(() => {
        this.router.navigate(['/dashboard'], { replaceUrl: true });
      });
    }
  }
}
