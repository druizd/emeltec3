import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
import { BitacoraAuditLogComponent } from './bitacora-trazabilidad';
import { BitacoraDocumentosComponent } from './bitacora-documentos';
import { BitacoraFichaSitioComponent } from './bitacora-ficha-sitio';
import { BitacoraIncidenciasComponent } from './bitacora-incidencias';

type BitacoraSection = 'ficha' | 'documentos' | 'equipamiento' | 'incidencias' | 'trazabilidad';

interface BitacoraTabItem {
  key: BitacoraSection;
  label: string;
  icon: string;
  visible: boolean;
  /** 'registro' = historial (primario); 'referencia' = ficha/docs/equipos. */
  group: 'registro' | 'referencia';
}

@Component({
  selector: 'app-water-detail-bitacora',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BitacoraFichaSitioComponent,
    BitacoraDocumentosComponent,
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
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint-08 text-primary-container"
            >
              <span class="material-symbols-outlined text-[22px]">menu_book</span>
            </span>
            <div class="min-w-0">
              <p class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
                Bitácora
              </p>
              <h2 class="truncate text-h6 font-semibold leading-tight text-slate-800">
                Registro de incidentes y cambios
              </h2>
            </div>
          </div>

          @if (searchable()) {
            <label
              class="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 transition-colors focus-within:border-primary-tint-35 focus-within:bg-white"
            >
              <span class="material-symbols-outlined text-[18px] text-slate-400" aria-hidden="true"
                >search</span
              >
              <input
                type="text"
                [ngModel]="searchQuery()"
                (ngModelChange)="searchQuery.set($event)"
                [placeholder]="searchPlaceholder()"
                [attr.aria-label]="searchPlaceholder()"
                class="w-full bg-transparent text-body-sm text-slate-700 placeholder:text-slate-500 focus:outline-none"
              />
              @if (searchQuery()) {
                <button
                  type="button"
                  (click)="searchQuery.set('')"
                  class="flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-700 active:scale-95"
                  aria-label="Limpiar búsqueda"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                    >close</span
                  >
                </button>
              }
            </label>
          }
        </div>
      </header>

      <!-- Sub-tabs (desktop) / dropdown (mobile) -->
      <nav class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <!-- Desktop tabs -->
        <div class="hidden flex-wrap items-center gap-1 px-2 py-2 md:flex">
          @for (tab of visibleTabs(); track tab.key; let i = $index) {
            @if (i > 0 && visibleTabs()[i - 1].group !== tab.group) {
              <span class="mx-1 h-6 w-px self-center bg-slate-200" aria-hidden="true"></span>
            }
            <button
              type="button"
              (click)="setSection(tab.key)"
              [class]="getTabClass(tab.key)"
              [attr.aria-current]="activeSection() === tab.key ? 'page' : null"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{
                tab.icon
              }}</span>
              <span>{{ tab.label }}</span>
            </button>
          }
        </div>

        <!-- Mobile selector -->
        <div class="md:hidden">
          <select
            [ngModel]="activeSection()"
            (ngModelChange)="setSection($event)"
            class="w-full appearance-none rounded-2xl bg-white px-4 py-3 text-body-sm font-bold text-slate-700 focus:outline-none"
          >
            @for (tab of visibleTabs(); track tab.key) {
              <option [value]="tab.key">{{ tab.label }}</option>
            }
          </select>
        </div>
      </nav>

      <!-- Section content -->
      @if (activeSection() === 'ficha') {
        <app-bitacora-ficha-sitio [sitioId]="sitioId()" [empresaId]="empresaId()" />
      } @else if (activeSection() === 'documentos') {
        <app-bitacora-documentos
          [sitioId]="sitioId()"
          [empresaId]="empresaId()"
          [search]="searchQuery()"
        />
      } @else if (activeSection() === 'incidencias') {
        <app-bitacora-incidencias
          [sitioId]="sitioId()"
          [empresaId]="empresaId()"
          [search]="searchQuery()"
        />
      } @else if (activeSection() === 'trazabilidad') {
        <app-bitacora-trazabilidad
          [sitioId]="sitioId()"
          [empresaId]="empresaId()"
          [search]="searchQuery()"
        />
      }
    </section>
  `,
})
export class WaterDetailBitacoraComponent {
  private auth = inject(AuthService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly isInternal = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly activeSection = signal<BitacoraSection>('incidencias');
  readonly searchQuery = signal('');

  // Orden "registro-first": lo central es el historial (incidencias + cambios);
  // ficha / documentos / equipamiento quedan como referencia.
  readonly tabs = computed<BitacoraTabItem[]>(() => [
    { key: 'incidencias', label: 'Incidencias', icon: 'history', visible: true, group: 'registro' },
    {
      key: 'trazabilidad',
      label: 'Trazabilidad',
      icon: 'fact_check',
      visible: this.isInternal(),
      group: 'registro',
    },
    {
      key: 'ficha',
      label: 'Ficha del sitio',
      icon: 'description',
      visible: true,
      group: 'referencia',
    },
    { key: 'documentos', label: 'Documentos', icon: 'folder', visible: true, group: 'referencia' },
  ]);

  readonly visibleTabs = computed(() => this.tabs().filter((t) => t.visible));

  /** Solo estas secciones tienen lista filtrable → el buscador aplica ahí. */
  private readonly searchableSections: BitacoraSection[] = [
    'incidencias',
    'documentos',
    'trazabilidad',
  ];
  readonly searchable = computed(() => this.searchableSections.includes(this.activeSection()));
  readonly searchPlaceholder = computed(() => {
    switch (this.activeSection()) {
      case 'incidencias':
        return 'Buscar en incidencias…';
      case 'documentos':
        return 'Buscar en documentos…';
      case 'trazabilidad':
        return 'Buscar en trazabilidad…';
      default:
        return 'Buscar…';
    }
  });

  constructor() {
    effect(() => {
      if (!this.visibleTabs().some((tab) => tab.key === this.activeSection())) {
        this.activeSection.set(this.visibleTabs()[0]?.key ?? 'incidencias');
      }
    });
  }

  setSection(section: string): void {
    const next = section as BitacoraSection;
    const visible = this.visibleTabs().some((tab) => tab.key === next);
    this.activeSection.set(visible ? next : (this.visibleTabs()[0]?.key ?? 'incidencias'));
  }

  getTabClass(key: BitacoraSection): string {
    const active = this.activeSection() === key;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-body-sm font-bold transition-colors active:scale-95',
      active
        ? 'bg-primary-tint-08 text-primary-container ring-1 ring-primary-tint-20'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    ].join(' ');
  }
}
