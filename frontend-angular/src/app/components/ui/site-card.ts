import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { SiteRecord } from '@emeltec/shared';
import { getSiteTypeUi } from '../../shared/site-type-ui';

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
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-100 bg-cyan-50 text-cyan-600"
            >
              <span class="material-symbols-outlined text-[14px]">{{ getSiteIcon() }}</span>
            </div>

            <div class="min-w-0">
              <h3 class="truncate text-[12px] font-bold leading-tight text-slate-800">
                {{ getSiteTitle() }}
              </h3>
              <p class="truncate text-[10px] leading-tight text-slate-400">
                {{ getContextLine() }}
              </p>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <span
              [class]="'inline-flex items-center gap-1 text-[10px] font-semibold ' + getStatusClass()"
            >
              <span
                [class]="
                  'h-1.5 w-1.5 rounded-full ' +
                  getStatusDotClass() +
                  (getStatusLabel() === 'En vivo' ? ' animate-pulse' : '')
                "
              ></span>
              {{ getStatusLabel() }}
            </span>
            <span
              class="material-symbols-outlined text-[14px] text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-500"
            >
              chevron_right
            </span>
          </div>
        </div>
      } @else {
        <div class="mb-3 flex items-start justify-between">
          <div class="flex items-center gap-2.5">
            <div
              [class]="
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors ' +
                (selected ? 'bg-blue-50' : 'bg-slate-100 group-hover:bg-blue-50')
              "
            >
              <span
                [class]="
                  'material-symbols-outlined text-[18px] transition-colors ' +
                  (selected
                    ? 'text-primary-container'
                    : 'text-slate-500 group-hover:text-primary-container')
                "
                >{{ getSiteIcon() }}</span
              >
            </div>
            <div class="min-w-0">
              <h3 class="max-w-[180px] truncate text-[13px] font-bold text-primary">
                {{ getSiteTitle() }}
              </h3>
              <p class="mt-0.5 truncate text-[11px] text-slate-500">{{ getSiteSecondary() }}</p>
            </div>
          </div>
          <span
            [class]="
              'material-symbols-outlined text-[16px] transition-all ' +
              (selected
                ? 'translate-x-1 text-primary-container'
                : 'text-slate-300 group-hover:translate-x-1 group-hover:text-primary-container')
            "
            >chevron_right</span
          >
        </div>

        <div class="flex items-center justify-between border-t border-slate-100 pt-2">
          <div class="flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[12px] text-slate-400">{{
              getSiteIcon()
            }}</span>
            <span class="text-[10px] font-medium text-slate-500">{{ getSiteTypeLabel() }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span [class]="'h-1.5 w-1.5 rounded-full ' + getStatusDotClass()"></span>
            <span [class]="'text-[10px] font-semibold ' + getStatusClass()">{{
              getStatusLabel()
            }}</span>
          </div>
        </div>
      }
    </button>
  `,
})
export class SiteCardComponent {
  @Input() site!: SiteRecord;
  @Input() selected = false;
  @Input() contextLabel = '';
  @Input() variant: 'default' | 'superadmin' = 'default';

  @Output() siteSelected = new EventEmitter<SiteRecord>();

  /** Card compacto: una fila, 56px de alto. */
  getCardClass(): string {
    if (this.variant === 'superadmin') {
      return [
        'group w-full cursor-pointer rounded-lg border bg-white px-2.5 py-2 text-left transition-all duration-200',
        this.selected
          ? 'border-cyan-200 shadow-[0_4px_12px_rgba(8,145,178,0.14)]'
          : 'border-slate-200/90 shadow-[0_2px_6px_rgba(15,23,42,0.04)] hover:border-cyan-200 hover:shadow-[0_4px_10px_rgba(8,145,178,0.08)]',
      ].join(' ');
    }

    return [
      'group w-full cursor-pointer rounded-lg border bg-white px-2.5 py-2 text-left transition-all duration-200',
      this.selected
        ? 'border-primary-container ring-2 ring-primary-container/15 shadow-md shadow-blue-900/10'
        : 'border-slate-200 hover:border-slate-300 hover:shadow-md',
    ].join(' ');
  }

  /**
   * Título del card: descripción del sitio + " · OB-XXXX-XXX" si es pozo
   * y tiene obra_dga cargada. Si no, solo descripción.
   */
  getSiteTitle(): string {
    const base = this.pickFirst(['descripcion', 'nombre', 'name', 'codigo']) ?? 'Instalacion';
    const obra = this.getObraDga();
    return obra ? `${base} · ${obra}` : base;
  }

  /** obra_dga del pozo si está cargada, sino null. */
  private getObraDga(): string | null {
    const raw = this.site?.pozo_config?.obra_dga;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed || null;
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

  getSiteTypeId(): string {
    return getSiteTypeUi(this.site?.tipo_sitio).id;
  }

  getSiteTypeLabel(): string {
    return getSiteTypeUi(this.site?.tipo_sitio).label;
  }

  getSiteIcon(): string {
    return getSiteTypeUi(this.site?.tipo_sitio).icon;
  }

  getTypeBadgeClass(): string {
    return `rounded-md px-1.5 py-0.5 text-[10px] font-bold ${getSiteTypeUi(this.site?.tipo_sitio).badgeClass}`;
  }

  /**
   * Estado conectado a la última lectura. Requiere que backend pueble
   * `site.last_seen_at` (timestamp ISO) — sin este campo, fallback a
   * los flags status/transmision_activa pre-existentes.
   *
   * Etiquetas:
   *   - "En vivo"   → última lectura < 1h    (verde)
   *   - "Con datos" → < 24h                  (cyan)
   *   - "Sin datos" → ≥ 24h o sin timestamp  (gris)
   */
  getStatusLabel(): string {
    const ageMin = this.lastSeenAgeMinutes();
    if (ageMin !== null) {
      if (ageMin < 60) return 'En vivo';
      if (ageMin < 24 * 60) return 'Con datos';
      return 'Sin datos';
    }

    // Fallback a flags legacy si backend no manda last_seen_at todavía.
    const rawStatus = this.pickFirst(['status', 'estado', 'data_status', 'estado_datos']);
    if (typeof rawStatus === 'string') {
      const normalized = rawStatus.toLowerCase();
      if (normalized.includes('vivo') || normalized.includes('activo')) return 'En vivo';
      if (normalized.includes('sin')) return 'Sin datos';
      if (normalized.includes('con')) return 'Con datos';
      return rawStatus;
    }
    const hasData = this.pickFirst(['hasData', 'has_data', 'tiene_datos', 'dataAvailable']);
    if (typeof hasData === 'boolean') return hasData ? 'Con datos' : 'Sin datos';
    const live = this.pickFirst(['transmision_activa', 'is_live', 'online']);
    if (typeof live === 'boolean') return live ? 'En vivo' : 'Sin datos';
    return 'Sin datos';
  }

  getStatusClass(): string {
    const status = this.getStatusLabel().toLowerCase();
    if (status.includes('vivo')) return 'text-emerald-500';
    if (status.includes('con')) return 'text-cyan-600';
    return 'text-slate-400';
  }

  getStatusDotClass(): string {
    const status = this.getStatusLabel().toLowerCase();
    if (status.includes('vivo')) return 'bg-emerald-500';
    if (status.includes('con')) return 'bg-cyan-500';
    return 'bg-slate-300';
  }

  /**
   * Minutos transcurridos desde la última lectura, o null si el backend
   * no manda timestamp. Probamos varios nombres de campo por compat.
   */
  private lastSeenAgeMinutes(): number | null {
    const raw = this.pickFirst([
      'last_seen_at',
      'ultima_lectura_at',
      'last_telemetry_at',
      'ultimaLecturaAt',
    ]);
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 60_000));
  }

  private pickFirst(keys: string[]): string | null {
    const source = this.site as unknown as Record<string, unknown>;
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') {
        return `${value}`;
      }
    }
    return null;
  }
}
