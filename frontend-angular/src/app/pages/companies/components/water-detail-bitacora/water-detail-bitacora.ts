import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
import { BitacoraAuditLogComponent } from './bitacora-trazabilidad';
import { BitacoraDocumentosComponent } from './bitacora-documentos';
import { BitacoraEquipamientoComponent } from './bitacora-equipamiento';
import { BitacoraFichaSitioComponent } from './bitacora-ficha-sitio';
import { BitacoraIncidenciasComponent } from './bitacora-incidencias';

type BitacoraSection = 'ficha' | 'documentos' | 'equipamiento' | 'incidencias' | 'trazabilidad';

interface BitacoraTabItem {
  key: BitacoraSection;
  label: string;
  icon: string;
  visible: boolean;
}

@Component({
  selector: 'app-water-detail-bitacora',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BitacoraFichaSitioComponent,
    BitacoraDocumentosComponent,
    BitacoraEquipamientoComponent,
    BitacoraIncidenciasComponent,
    BitacoraAuditLogComponent,
  ],
  template: `
    <section class="space-y-3">
      <!-- Header: title + búsqueda transversal -->
      <header class="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-center">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"
            >
              <span class="material-symbols-outlined text-[22px]">menu_book</span>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Bitácora
              </p>
              <h2 class="truncate text-lg font-black leading-tight text-slate-800">
                Historial completo del sitio
              </h2>
            </div>
          </div>

          <label
            class="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 transition-colors focus-within:border-cyan-300 focus-within:bg-white"
          >
            <span class="material-symbols-outlined text-[18px] text-slate-400">search</span>
            <input
              type="text"
              [ngModel]="searchQuery()"
              (ngModelChange)="searchQuery.set($event)"
              placeholder="Buscar en incidencias, documentos, trazabilidad..."
              class="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
            @if (searchQuery()) {
              <button
                type="button"
                (click)="searchQuery.set('')"
                class="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <span class="material-symbols-outlined text-[16px]">close</span>
              </button>
            }
          </label>
        </div>
      </header>

      <!-- Sub-tabs (desktop) / dropdown (mobile) -->
      <nav class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <!-- Desktop tabs -->
        <div class="hidden flex-wrap items-center gap-1 px-2 py-2 md:flex">
          @for (tab of visibleTabs(); track tab.key) {
            <button type="button" (click)="setSection(tab.key)" [class]="getTabClass(tab.key)">
              <span class="material-symbols-outlined text-[18px]">{{ tab.icon }}</span>
              <span>{{ tab.label }}</span>
            </button>
          }
        </div>

        <!-- Mobile selector -->
        <div class="md:hidden">
          <select
            [ngModel]="activeSection()"
            (ngModelChange)="setSection($event)"
            class="w-full appearance-none rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none"
          >
            @for (tab of visibleTabs(); track tab.key) {
              <option [value]="tab.key">{{ tab.label }}</option>
            }
          </select>
        </div>
      </nav>

      <!-- Section content -->
      @if (activeSection() === 'ficha') {
        <app-bitacora-ficha-sitio [sitioId]="sitioId()" />
      } @else if (activeSection() === 'documentos') {
        <app-bitacora-documentos [sitioId]="sitioId()" [empresaId]="empresaId()" />
      } @else if (activeSection() === 'equipamiento') {
        <app-bitacora-equipamiento [sitioId]="sitioId()" />
      } @else if (activeSection() === 'incidencias') {
        <app-bitacora-incidencias [sitioId]="sitioId()" [empresaId]="empresaId()" />
      } @else if (activeSection() === 'trazabilidad') {
        <app-bitacora-trazabilidad [sitioId]="sitioId()" [empresaId]="empresaId()" />
      }
    </section>
  `,
})
export class WaterDetailBitacoraComponent {
  private auth = inject(AuthService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly isInternal = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly activeSection = signal<BitacoraSection>('ficha');
  readonly searchQuery = signal('');

  readonly tabs = computed<BitacoraTabItem[]>(() => [
    { key: 'ficha', label: 'Ficha del sitio', icon: 'description', visible: true },
    { key: 'documentos', label: 'Documentos', icon: 'folder', visible: true },
    {
      key: 'equipamiento',
      label: 'Equipamiento',
      icon: 'precision_manufacturing',
      visible: this.isInternal(),
    },
    { key: 'incidencias', label: 'Incidencias', icon: 'history', visible: true },
    { key: 'trazabilidad', label: 'Trazabilidad', icon: 'fact_check', visible: true },
  ]);

  readonly visibleTabs = computed(() => this.tabs().filter((t) => t.visible));

  setSection(section: BitacoraSection): void {
    this.activeSection.set(section);
  }

  getTabClass(key: BitacoraSection): string {
    const active = this.activeSection() === key;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all',
      active
        ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    ].join(' ');
  }
}
