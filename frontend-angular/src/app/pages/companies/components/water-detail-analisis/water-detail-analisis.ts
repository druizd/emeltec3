import { CommonModule } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalisisSaludComponent } from './analisis-salud';
import { AnalisisCalendarioComponent } from './analisis-calendario';
import { AnalisisReportesComponent } from './analisis-reportes';
import { AnalisisMetricasComponent } from './analisis-metricas';
import { AnalisisSugerenciasComponent } from './analisis-sugerencias';
import { AnalisisPredictivoComponent } from './analisis-predictivo';

type AnalisisSection =
  | 'salud'
  | 'calendario'
  | 'reportes'
  | 'metricas'
  | 'sugerencias'
  | 'predictivo';

interface AnalisisTabItem {
  key: AnalisisSection;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-water-detail-analisis',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AnalisisSaludComponent,
    AnalisisCalendarioComponent,
    AnalisisReportesComponent,
    AnalisisMetricasComponent,
    AnalisisSugerenciasComponent,
    AnalisisPredictivoComponent,
  ],
  template: `
    <section class="space-y-3">
      <!-- Header -->
      <header class="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600"
            >
              <span class="material-symbols-outlined text-[22px]">insights</span>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Análisis
              </p>
              <h2 class="truncate text-lg font-black leading-tight text-slate-800">
                Salud, calendario, reportes y métricas
              </h2>
            </div>
          </div>
          <span
            class="hidden shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 sm:inline-flex"
          >
            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
            Sistema operativo
          </span>
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
      @if (activeSection() === 'salud') {
        <app-analisis-salud [sitioId]="sitioId()" />
      } @else if (activeSection() === 'calendario') {
        <app-analisis-calendario />
      } @else if (activeSection() === 'reportes') {
        <app-analisis-reportes [sitioId]="sitioId()" />
      } @else if (activeSection() === 'metricas') {
        <app-analisis-metricas [sitioId]="sitioId()" />
      } @else if (activeSection() === 'sugerencias') {
        <app-analisis-sugerencias />
      } @else if (activeSection() === 'predictivo') {
        <app-analisis-predictivo />
      }
    </section>
  `,
})
export class WaterDetailAnalisisComponent {
  readonly sitioId = input<string>('');
  readonly activeSection = signal<AnalisisSection>('salud');

  readonly tabs: AnalisisTabItem[] = [
    { key: 'salud', label: 'Salud del sistema', icon: 'monitor_heart' },
    { key: 'calendario', label: 'Calendario', icon: 'calendar_month' },
    { key: 'reportes', label: 'Reportes', icon: 'download' },
    { key: 'metricas', label: 'Métricas', icon: 'leaderboard' },
    { key: 'sugerencias', label: 'Sugerencias', icon: 'lightbulb' },
    { key: 'predictivo', label: 'Predictivo', icon: 'auto_awesome' },
  ];

  tabClass(key: AnalisisSection): string {
    const active = this.activeSection() === key;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all',
      active
        ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-100'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    ].join(' ');
  }
}
