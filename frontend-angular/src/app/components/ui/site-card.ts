import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-site-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      type="button"
      (click)="siteSelected.emit(site)"
      [attr.aria-pressed]="selected"
      [class]="getCardClass()"
    >
      @if (variant === 'superadmin') {
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-600"
            >
              <span class="material-symbols-outlined text-[18px]">sensors</span>
            </div>

            <div class="min-w-0">
              <h3 class="truncate text-[15px] font-bold text-slate-800">{{ getSiteTitle() }}</h3>
              <p class="truncate text-xs text-slate-400">{{ getSiteSecondary() }}</p>
            </div>
          </div>

          <span
            class="material-symbols-outlined text-base text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-500"
          >
            chevron_right
          </span>
        </div>

        <div class="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
          <div class="min-w-0">
            <p class="truncate text-[12px] text-slate-500">{{ getContextLine() }}</p>
          </div>

          <div class="flex shrink-0 items-center gap-3 text-[11px]">
            <span class="text-slate-400">{{ getDepthLabel() }}</span>
            <span [class]="'inline-flex items-center gap-1 font-semibold ' + getStatusClass()">
              <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
              {{ getStatusLabel() }}
            </span>
          </div>
        </div>
      } @else {
        <div class="mb-4 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div
              [class]="
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors ' +
                (selected ? 'bg-blue-50' : 'bg-slate-100 group-hover:bg-blue-50')
              "
            >
              <span
                [class]="
                  'material-symbols-outlined transition-colors ' +
                  (selected
                    ? 'text-primary-container'
                    : 'text-slate-500 group-hover:text-primary-container')
                "
                >location_on</span
              >
            </div>
            <div>
              <h3 class="max-w-[150px] truncate text-sm font-bold text-primary">
                {{ getSiteTitle() }}
              </h3>
              <p class="mt-0.5 text-xs text-slate-500">{{ getSiteSecondary() }}</p>
            </div>
          </div>
          <span
            [class]="
              'material-symbols-outlined transition-all ' +
              (selected
                ? 'translate-x-1 text-primary-container'
                : 'text-slate-300 group-hover:translate-x-1 group-hover:text-primary-container')
            "
            >chevron_right</span
          >
        </div>

        <div class="flex items-center justify-between border-t border-slate-100 pt-3">
          <div class="flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[14px] text-emerald-500">sensors</span>
            <span class="text-[11px] font-medium text-slate-500">Transmision Activa</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[14px] text-slate-400">schedule</span>
            <span class="text-[11px] text-slate-400">Hace 5 min</span>
          </div>
        </div>
      }
    </button>
  `,
})
export class SiteCardComponent {
  @Input() site: any;
  @Input() selected = false;
  @Input() contextLabel = '';
  @Input() variant: 'default' | 'superadmin' = 'default';

  @Output() siteSelected = new EventEmitter<any>();

  getCardClass(): string {
    if (this.variant === 'superadmin') {
      return [
        'group w-full cursor-pointer rounded-2xl border bg-white px-4 py-4 text-left transition-all duration-200',
        this.selected
          ? 'border-cyan-200 shadow-[0_10px_28px_rgba(8,145,178,0.16)]'
          : 'border-slate-200/90 shadow-[0_6px_18px_rgba(15,23,42,0.05)] hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_12px_28px_rgba(8,145,178,0.12)]',
      ].join(' ');
    }

    return [
      'group w-full cursor-pointer rounded-xl border bg-white p-5 text-left transition-all duration-200',
      this.selected
        ? 'border-primary-container ring-2 ring-primary-container/15 shadow-lg shadow-blue-900/10'
        : 'border-slate-200 hover:border-slate-300 hover:shadow-lg',
    ].join(' ');
  }

  getSiteTitle(): string {
    return this.pickFirst(['descripcion', 'nombre', 'name', 'codigo']) ?? 'Instalacion';
  }

  getSiteSecondary(): string {
    return (
      this.pickFirst(['ubicacion', 'sector', 'alias', 'nombre_corto', 'site_code']) ??
      'Sin referencia'
    );
  }

  getContextLine(): string {
    return (
      this.pickFirst(['empresa_nombre', 'company_name', 'sub_empresa_nombre', 'subCompanyName']) ??
      (this.contextLabel || 'Sin ubicacion')
    );
  }

  getDepthLabel(): string {
    const depth = this.pickFirst(['profundidad', 'prof', 'depth', 'prof_metros']);
    if (depth !== null && depth !== undefined && `${depth}`.trim() !== '') {
      return `Prof. ${depth}m`;
    }

    return 'Prof. --';
  }

  getStatusLabel(): string {
    const rawStatus = this.pickFirst(['status', 'estado', 'data_status', 'estado_datos']);
    if (typeof rawStatus === 'string') {
      const normalized = rawStatus.toLowerCase();
      if (normalized.includes('vivo') || normalized.includes('activo')) {
        return 'En vivo';
      }
      if (normalized.includes('sin')) {
        return 'Sin datos';
      }
      if (normalized.includes('con')) {
        return 'Con datos';
      }
      return rawStatus;
    }

    const hasData = this.pickFirst(['hasData', 'has_data', 'tiene_datos', 'dataAvailable']);
    if (typeof hasData === 'boolean') {
      return hasData ? 'Con datos' : 'Sin datos';
    }

    const live = this.pickFirst(['transmision_activa', 'is_live', 'online']);
    if (typeof live === 'boolean') {
      return live ? 'En vivo' : 'Sin datos';
    }

    return 'Sin datos';
  }

  getStatusClass(): string {
    const status = this.getStatusLabel().toLowerCase();

    if (status.includes('vivo')) {
      return 'text-emerald-500';
    }

    if (status.includes('con')) {
      return 'text-cyan-600';
    }

    return 'text-slate-400';
  }

  private pickFirst(keys: string[]): any {
    for (const key of keys) {
      const value = this.site?.[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') {
        return value;
      }
    }

    return null;
  }
}
