import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertaService } from '../../../../services/alerta.service';
import { AlertasBandejaComponent } from './alertas-bandeja';
import { AlertasConfiguracionComponent } from './alertas-configuracion';
import { AlertasHistoricoComponent } from './alertas-historico';

type AlertasSection = 'bandeja' | 'configuracion' | 'historico';

interface AlertasTabItem {
  key: AlertasSection;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-water-detail-alertas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    AlertasBandejaComponent,
    AlertasConfiguracionComponent,
    AlertasHistoricoComponent,
  ],
  template: `
    <section class="space-y-3">
      <!-- Header -->
      <header class="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
            >
              <span class="material-symbols-outlined text-[22px]">notifications_active</span>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Alertas</p>
              <h2 class="truncate text-lg font-black leading-tight text-slate-800">
                Gestión de alertas del sitio
              </h2>
            </div>
          </div>
          <!-- Badge activas -->
          @if (activasCount() > 0) {
            <span
              class="hidden shrink-0 items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-600 sm:inline-flex"
            >
              <span class="h-2 w-2 animate-pulse rounded-full bg-rose-500"></span>
              {{ activasCount() }} {{ activasCount() === 1 ? 'alerta activa' : 'alertas activas' }}
            </span>
          }
        </div>
      </header>

      <!-- Sub-tabs (desktop) / dropdown (mobile) -->
      <nav class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="hidden flex-wrap items-center gap-1 px-2 py-2 md:flex">
          @for (tab of tabs; track tab.key) {
            <button type="button" (click)="activeSection.set(tab.key)" [class]="tabClass(tab.key)">
              <span class="material-symbols-outlined text-[18px]">{{ tab.icon }}</span>
              <span>{{ tab.label }}</span>
            </button>
          }
        </div>
        <div class="md:hidden">
          <select
            [ngModel]="activeSection()"
            (ngModelChange)="activeSection.set($event)"
            class="w-full appearance-none rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none"
          >
            @for (tab of tabs; track tab.key) {
              <option [value]="tab.key">{{ tab.label }}</option>
            }
          </select>
        </div>
      </nav>

      <!-- Section content -->
      @if (activeSection() === 'bandeja') {
        <app-alertas-bandeja [sitioId]="sitioId()" [empresaId]="empresaId()" />
      } @else if (activeSection() === 'configuracion') {
        <app-alertas-configuracion [sitioId]="sitioId()" [empresaId]="empresaId()" />
      } @else if (activeSection() === 'historico') {
        <app-alertas-historico [sitioId]="sitioId()" />
      }
    </section>
  `,
})
export class WaterDetailAlertasComponent {
  private readonly alertaService = inject(AlertaService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');
  readonly activeSection = signal<AlertasSection>('bandeja');
  readonly activasCount = signal(0);

  readonly tabs: AlertasTabItem[] = [
    { key: 'bandeja', label: 'Bandeja activa', icon: 'inbox' },
    { key: 'configuracion', label: 'Configuración', icon: 'tune' },
    { key: 'historico', label: 'Histórico', icon: 'history' },
  ];

  constructor() {
    effect(() => {
      const sid = this.sitioId();
      if (sid) this.cargarResumen();
    });
  }

  private cargarResumen(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.alertaService.resumen({ sitio_id: sid }).subscribe({
      next: (r) => this.activasCount.set(Number(r.activas) || 0),
    });
  }

  tabClass(key: AlertasSection): string {
    const active = this.activeSection() === key;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all',
      active
        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    ].join(' ');
  }
}
