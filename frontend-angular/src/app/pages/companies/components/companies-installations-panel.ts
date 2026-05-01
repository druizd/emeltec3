import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SiteCardComponent } from '../../../components/ui/site-card';

@Component({
  selector: 'app-companies-installations-panel',
  standalone: true,
  imports: [CommonModule, SiteCardComponent],
  template: `
    <div [class]="getGridClass()">
      @for (site of sites; track site.id) {
        <app-site-card
          [site]="site"
          [contextLabel]="contextLabel"
          [variant]="variant"
          (siteSelected)="siteSelected.emit($event)"
        />
      }

      @if (sites.length === 0 && !loading) {
        <div [class]="getEmptyStateClass()">
          <span class="material-symbols-outlined text-slate-300 text-5xl mb-4">inventory_2</span>
          <p [class]="variant === 'superadmin' ? 'text-slate-500 text-sm font-semibold' : 'text-slate-400 font-bold uppercase tracking-widest'">
            No hay instalaciones registradas
          </p>
        </div>
      }
    </div>
  `,
})
export class CompaniesInstallationsPanelComponent {
  @Input() sites: any[] = [];
  @Input() loading = false;
  @Input() contextLabel = '';
  @Input() variant: 'default' | 'superadmin' = 'default';

  @Output() siteSelected = new EventEmitter<any>();

  getGridClass(): string {
    if (this.variant === 'superadmin') {
      return 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 animate-in fade-in duration-500';
    }

    return 'grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 animate-in fade-in duration-500';
  }

  getEmptyStateClass(): string {
    if (this.variant === 'superadmin') {
      return 'col-span-full rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-20 text-center shadow-[0_8px_30px_rgba(15,23,42,0.05)]';
    }

    return 'col-span-full rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 py-20 text-center';
  }
}
