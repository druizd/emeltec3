import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';

interface KpiCard {
  label: string;
  valor: string;
  subtext: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

interface PuntoMensual {
  mes: string;
  valores: number[];
}

interface SitioResumen {
  nombre: string;
  ubicacion: string;
  estado: 'online' | 'sinDatos' | 'offline';
  lat: number;
  lng: number;
  caudal: number;
  nivel: number;
  consumoMes: number;
  diasActivos: number;
  diasMes: number;
  m3Proyectados: number;
  tendenciaCaudal: number;
}

interface MetricaOperacional {
  label: string;
  valor: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

interface SitioComparacion {
  nombre: string;
  estado: 'online' | 'sinDatos' | 'offline';
  caudalA: string;
  caudalB: string;
  caudalTend: number;
  nivelA: string;
  nivelB: string;
  nivelTend: number;
  consumoA: string;
  consumoB: string;
  consumoTend: number;
}

type PeriodoPreset = 'semana' | 'mes' | '7d';

interface Periodo {
  label: string;
  desde: string;
  hasta: string;
}

@Component({
  selector: 'app-companies-general-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-4 animate-in fade-in duration-500">

      <!-- KPIs principales -->
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

        <article class="rounded-2xl bg-gradient-to-br from-[#04606A] via-[#0899A5] to-[#0DAFBD] p-5 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-[10px] font-black uppercase tracking-widest text-cyan-100">Flujo acumulado mensual</p>
              <p class="mt-2 font-mono text-3xl font-black leading-none text-white">14,921 m³</p>
              <p class="mt-1 text-[11px] text-cyan-200">Acumulado en mayo 2026</p>
            </div>
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <span class="material-symbols-outlined text-[22px] text-white">water_drop</span>
            </span>
          </div>
        </article>

        @for (k of kpisSecundarios; track k.label) {
          <article class="rounded-2xl border bg-white p-5 shadow-sm" [class]="kpiBorde(k.tono)">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ k.label }}</p>
                <p class="mt-2 font-mono text-3xl font-black leading-none text-slate-800">{{ k.valor }}</p>
                <p class="mt-1 text-[11px] text-slate-400">{{ k.subtext }}</p>
              </div>
              <span [class]="kpiIconClass(k.tono)" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <span class="material-symbols-outlined text-[22px]">{{ k.icon }}</span>
              </span>
            </div>
          </article>
        }

      </div>

      <!-- Gráfico + Lista de sitios -->
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">

        <!-- Gráfico de flujo mensual -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-black text-slate-800">Flujo mensual por instalación</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">m³/mes · últimos 6 meses · clic en leyenda para ocultar</p>
            </div>
            <!-- Leyenda interactiva -->
            <div class="flex flex-wrap justify-end gap-1">
              @for (s of sitiosResumen; track s.nombre; let i = $index) {
                <button
                  (click)="toggleSite(i)"
                  class="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold text-slate-500 transition-all hover:bg-slate-100"
                  [style.opacity]="hiddenSites().has(i) ? '0.3' : '1'"
                  [title]="hiddenSites().has(i) ? 'Mostrar ' + s.nombre : 'Ocultar ' + s.nombre">
                  <span class="h-2.5 w-2.5 rounded-full" [style.background]="colores[i % colores.length]"></span>
                  {{ s.nombre | slice:0:12 }}{{ s.nombre.length > 12 ? '…' : '' }}
                </button>
              }
            </div>
          </div>
          <div class="h-[220px] w-full">
            <svg viewBox="0 0 1000 220" class="h-full w-full" preserveAspectRatio="none">
              @for (tick of yTicks; track tick.y) {
                <line x1="60" [attr.y1]="tick.y" x2="990" [attr.y2]="tick.y" stroke="#f1f5f9" stroke-width="1"/>
                <text x="54" [attr.y]="tick.y + 4" font-size="10" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ tick.label }}</text>
              }
              @for (p of puntosMensuales; track p.mes; let i = $index) {
                <text [attr.x]="60 + (930 / (puntosMensuales.length - 1)) * i" y="215" font-size="10" fill="#94a3b8" text-anchor="middle">{{ p.mes }}</text>
              }
              @for (s of sitiosResumen; track s.nombre; let si = $index) {
                <polyline
                  [attr.points]="buildPolyline(si)"
                  fill="none"
                  [attr.stroke]="colores[si % colores.length]"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  [style.opacity]="hiddenSites().has(si) ? '0' : '0.85'"
                  style="transition: opacity 0.25s"
                />
              }
            </svg>
          </div>
        </section>

        <!-- Lista de sitios: toggle + proyección por pozo -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-2">
            <h3 class="text-sm font-black text-slate-800">Estado de sitios</h3>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">{{ sitiosResumen.length }} sitios</span>
          </div>

          @if (sitiosResumen.length === 0) {
            <div class="py-8 text-center">
              <span class="material-symbols-outlined text-3xl text-slate-300">sensors_off</span>
              <p class="mt-2 text-[12px] font-semibold text-slate-400">Sin sitios registrados</p>
            </div>
          } @else {
            <div class="space-y-2 overflow-y-auto" style="max-height: 340px">
              @for (s of sitiosResumen; track s.nombre; let i = $index) {
                <button
                  (click)="toggleSite(i)"
                  class="w-full rounded-xl border px-3 py-2.5 text-left transition-all hover:shadow-sm"
                  [style.opacity]="hiddenSites().has(i) ? '0.45' : '1'"
                  [class.border-slate-100]="!hiddenSites().has(i)"
                  [class.bg-slate-50]="!hiddenSites().has(i)"
                  [class.border-slate-200]="hiddenSites().has(i)"
                  [class.bg-white]="hiddenSites().has(i)"
                  [title]="hiddenSites().has(i) ? 'Mostrar en gráfico' : 'Ocultar del gráfico'">

                  <!-- Fila principal -->
                  <div class="flex items-center gap-3">
                    <span class="h-2 w-2 shrink-0 rounded-full" [class]="estadoDotClass(s.estado)"></span>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-[12px] font-semibold text-slate-800">{{ s.nombre }}</p>
                      <p class="truncate text-[10px] text-slate-400">{{ s.ubicacion }}</p>
                    </div>
                    <div class="flex flex-col items-end gap-0.5 shrink-0">
                      <span class="text-[10px] font-semibold" [class]="estadoTextClass(s.estado)">{{ estadoLabel(s.estado) }}</span>
                      <span class="text-[9px] font-bold"
                            [style.color]="s.tendenciaCaudal >= 0 ? '#16A34A' : '#DC2626'">
                        {{ s.tendenciaCaudal >= 0 ? '▲' : '▼' }} {{ formatNum(s.tendenciaCaudal) }}%
                      </span>
                    </div>
                  </div>

                  <!-- Proyección mensual -->
                  <div class="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                    <div class="flex items-center justify-between">
                      <span class="text-[9px] font-semibold text-slate-400">Consumido este mes</span>
                      <span class="font-mono text-[11px] font-bold text-slate-700">{{ s.consumoMes.toLocaleString() }} m³</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-[9px] font-semibold text-slate-400">Proyección fin de mes</span>
                      <span class="font-mono text-[11px] font-bold" style="color:#0dafbd">{{ s.m3Proyectados.toLocaleString() }} m³</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-[9px] font-semibold text-slate-400">Días con extracción</span>
                      <span class="font-mono text-[11px] font-bold text-slate-700">{{ s.diasActivos }} <span class="font-normal text-slate-400">de {{ s.diasMes }}</span></span>
                    </div>
                  </div>

                </button>
              }
            </div>
          }
        </section>

      </div>

      <!-- Mapa + Comparación de períodos -->
      <div class="grid gap-3 xl:grid-cols-[1fr_360px]">

        <!-- Mapa Leaflet -->
        <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div>
              <h3 class="text-sm font-black text-slate-800">Mapa de instalaciones</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">Posición geográfica · clic en marcador para métricas</p>
            </div>
          </div>
          <div class="relative" style="height: 340px">
            <div #mapContainer style="height: 100%; width: 100%;"></div>
            @if (sitiosResumen.length === 0) {
              <div class="absolute inset-0 z-10 flex items-center justify-center bg-slate-50">
                <div class="text-center">
                  <span class="material-symbols-outlined text-3xl text-slate-300">map</span>
                  <p class="mt-2 text-[12px] font-semibold text-slate-400">Sin instalaciones</p>
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Resumen operacional (panel lateral) -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h3 class="text-sm font-black text-slate-800">Resumen operacional</h3>
            <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">
              Mayo 2026
            </span>
          </div>
          <div class="grid grid-cols-2 gap-3">
            @for (m of metricasOp; track m.label) {
              <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div class="mb-2 flex items-center justify-between gap-1">
                  <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-tight">{{ m.label }}</p>
                  <span [class]="metricaOpIconClass(m.tono)" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <span class="material-symbols-outlined text-[16px]">{{ m.icon }}</span>
                  </span>
                </div>
                <p class="font-mono text-xl font-black text-slate-800">{{ m.valor }}</p>
              </div>
            }
          </div>
        </section>
      </div>

      <!-- Comparación de períodos (full width) -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

        <!-- Header -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <div class="flex-1">
            <h3 class="text-sm font-black text-slate-800">Comparación de períodos por pozo</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">Período A vs Período B · caudal, nivel y consumo</p>
          </div>
          <!-- Period labels -->
          <div class="flex items-center gap-2">
            <div class="rounded-lg px-3 py-1.5" style="background: rgba(13,175,189,0.08)">
              <p class="text-[9px] font-black uppercase tracking-widest" style="color: #0dafbd">A · {{ periodoA().label }}</p>
            </div>
            <span class="text-[11px] text-slate-300">vs</span>
            <div class="rounded-lg bg-slate-100 px-3 py-1.5">
              <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">B · {{ periodoB().label }}</p>
            </div>
          </div>
          <button
            (click)="periodosOpen.set(!periodosOpen())"
            class="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-100">
            <span class="material-symbols-outlined text-[14px]">date_range</span>
            Escoger períodos
          </button>
        </div>

        <!-- Selector de presets -->
        @if (periodosOpen()) {
          <div class="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p class="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Período de comparación</p>
            <div class="flex flex-wrap gap-2">
              @for (p of presets; track p.key) {
                <button
                  (click)="setPreset(p.key)"
                  class="rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors"
                  [style.background]="periodoPreset() === p.key ? '#0dafbd' : 'white'"
                  [style.color]="periodoPreset() === p.key ? 'white' : '#475569'"
                  [style.border]="periodoPreset() !== p.key ? '1px solid #E2E8F0' : '1px solid transparent'">
                  {{ p.label }}
                </button>
              }
            </div>
          </div>
        }

        <!-- Grid de pozos -->
        @if (sitiosComparacion.length === 0) {
          <div class="py-8 text-center">
            <span class="material-symbols-outlined text-3xl text-slate-300">sensors_off</span>
            <p class="mt-2 text-[12px] font-semibold text-slate-400">Sin datos de pozos</p>
          </div>
        } @else {
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            @for (s of sitiosComparacion; track s.nombre) {
              <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">

                <!-- Nombre del pozo -->
                <div class="mb-3 flex items-center gap-1.5">
                  <span class="h-2 w-2 shrink-0 rounded-full" [class]="estadoDotClass(s.estado)"></span>
                  <span class="truncate text-[12px] font-bold text-slate-800">{{ s.nombre | slice:0:20 }}{{ s.nombre.length > 20 ? '…' : '' }}</span>
                </div>

                <!-- Métricas A vs B con tendencia individual -->
                <div class="space-y-1.5">

                  <div class="rounded-lg bg-white px-3 py-2">
                    <div class="mb-1.5 flex items-center justify-between">
                      <div class="flex items-center gap-1">
                        <span class="material-symbols-outlined text-[12px] text-slate-300">speed</span>
                        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Caudal</p>
                      </div>
                      <span class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                            [style.background]="s.caudalTend >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)'"
                            [style.color]="s.caudalTend >= 0 ? '#16A34A' : '#DC2626'">
                        {{ s.caudalTend >= 0 ? '▲' : '▼' }} {{ formatNum(s.caudalTend) }}%
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5">
                        <span class="rounded px-1 py-0.5 text-[8px] font-black" style="background:rgba(13,175,189,0.12);color:#0899A5">A</span>
                        <span class="font-mono text-[13px] font-bold text-slate-800">{{ s.caudalA }} <span class="text-[10px] font-normal text-slate-400">L/s</span></span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <span class="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-black text-slate-500">B</span>
                        <span class="font-mono text-[12px] font-bold text-slate-400">{{ s.caudalB }} <span class="text-[10px] font-normal">L/s</span></span>
                      </div>
                    </div>
                  </div>

                  <div class="rounded-lg bg-white px-3 py-2">
                    <div class="mb-1.5 flex items-center justify-between">
                      <div class="flex items-center gap-1">
                        <span class="material-symbols-outlined text-[12px] text-slate-300">water_drop</span>
                        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Nivel</p>
                      </div>
                      <span class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                            [style.background]="s.nivelTend >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)'"
                            [style.color]="s.nivelTend >= 0 ? '#16A34A' : '#DC2626'">
                        {{ s.nivelTend >= 0 ? '▲' : '▼' }} {{ formatNum(s.nivelTend) }}%
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5">
                        <span class="rounded px-1 py-0.5 text-[8px] font-black" style="background:rgba(13,175,189,0.12);color:#0899A5">A</span>
                        <span class="font-mono text-[13px] font-bold text-slate-800">{{ s.nivelA }} <span class="text-[10px] font-normal text-slate-400">m</span></span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <span class="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-black text-slate-500">B</span>
                        <span class="font-mono text-[12px] font-bold text-slate-400">{{ s.nivelB }} <span class="text-[10px] font-normal">m</span></span>
                      </div>
                    </div>
                  </div>

                  <div class="rounded-lg bg-white px-3 py-2">
                    <div class="mb-1.5 flex items-center justify-between">
                      <div class="flex items-center gap-1">
                        <span class="material-symbols-outlined text-[12px] text-slate-300">monitoring</span>
                        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Consumo</p>
                      </div>
                      <span class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                            [style.background]="s.consumoTend >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)'"
                            [style.color]="s.consumoTend >= 0 ? '#16A34A' : '#DC2626'">
                        {{ s.consumoTend >= 0 ? '▲' : '▼' }} {{ formatNum(s.consumoTend) }}%
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5">
                        <span class="rounded px-1 py-0.5 text-[8px] font-black" style="background:rgba(13,175,189,0.12);color:#0899A5">A</span>
                        <span class="font-mono text-[13px] font-bold text-slate-800">{{ s.consumoA }} <span class="text-[10px] font-normal text-slate-400">m³</span></span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <span class="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-black text-slate-500">B</span>
                        <span class="font-mono text-[12px] font-bold text-slate-400">{{ s.consumoB }} <span class="text-[10px] font-normal">m³</span></span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            }
          </div>
        }

      </section>

    </div>
  `,
})
export class CompaniesGeneralPanelComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() sites: any[] = [];
  @Input() subEmpresaId = '';

  @ViewChild('mapContainer') mapContainer?: ElementRef<HTMLDivElement>;

  readonly colores = ['#0DAFBD', '#22C55E', '#6366F1', '#F59E0B', '#F97316'];

  // UI signals
  hiddenSites = signal<Set<number>>(new Set());
  periodosOpen = signal(false);
  periodoPreset = signal<PeriodoPreset>('semana');
  periodoA = signal<Periodo>({ label: 'Esta semana', desde: '2026-05-11', hasta: '2026-05-11' });
  periodoB = signal<Periodo>({ label: 'Semana anterior', desde: '2026-05-04', hasta: '2026-05-10' });

  readonly presets: { key: PeriodoPreset; label: string }[] = [
    { key: 'semana', label: 'Esta semana vs semana anterior' },
    { key: 'mes',    label: 'Este mes vs mes anterior' },
    { key: '7d',     label: 'Últimos 7 días vs 7 días anteriores' },
  ];

  sitiosResumen: SitioResumen[] = [];
  kpisSecundarios: KpiCard[] = [];
  sitiosComparacion: SitioComparacion[] = [];

  private readonly MOCK_FLOW_BY_SITE: number[][] = [
    [2100, 2250, 2050, 2300, 2180, 2400],
    [1800, 1950, 1700, 2000, 1900, 2100],
    [1100, 1250, 1050, 1300, 1180, 1400],
    [800,  900,  750,  950,  850,  1000],
    [600,  700,  550,  750,  650,  800],
  ];

  private readonly MOCK_SITE_GEO = [
    { lat: -29.9027, lng: -71.2517, caudal: 4.8, nivel: -12.3, consumoMes: 2400, diasActivos: 9,  tendenciaCaudal: 5.2  },
    { lat: -30.0453, lng: -71.1067, caudal: 3.2, nivel: -8.7,  consumoMes: 1900, diasActivos: 8,  tendenciaCaudal: -2.1 },
    { lat: -29.7823, lng: -71.3156, caudal: 2.1, nivel: -15.1, consumoMes: 1400, diasActivos: 7,  tendenciaCaudal: 7.4  },
    { lat: -30.1234, lng: -70.9845, caudal: 1.6, nivel: -6.2,  consumoMes: 1000, diasActivos: 9,  tendenciaCaudal: -0.5 },
    { lat: -29.5678, lng: -71.4012, caudal: 1.1, nivel: -9.8,  consumoMes: 800,  diasActivos: 6,  tendenciaCaudal: 3.8  },
  ];

  readonly puntosMensuales: PuntoMensual[] = [
    { mes: 'Dic 25', valores: [] },
    { mes: 'Ene 26', valores: [] },
    { mes: 'Feb 26', valores: [] },
    { mes: 'Mar 26', valores: [] },
    { mes: 'Abr 26', valores: [] },
    { mes: 'May 26', valores: [] },
  ];

  readonly metricasOp: MetricaOperacional[] = [
    { label: 'Uptime promedio',       valor: '99.1%', icon: 'wifi',          tono: 'ok'      },
    { label: 'Tiempo respuesta',      valor: '3.2 h', icon: 'timer',         tono: 'ok'      },
    { label: 'Visitas técnicas',      valor: '14',    icon: 'engineering',   tono: 'neutral' },
    { label: 'Resolución 1ra visita', valor: '86%',   icon: 'check_circle',  tono: 'ok'      },
  ];

  readonly yTicks = [
    { y: 10,  label: '2500' },
    { y: 73,  label: '1875' },
    { y: 137, label: '1250' },
    { y: 200, label: '0'    },
  ];

  private readonly chartX0 = 60;
  private readonly chartY0 = 10;
  private readonly chartW  = 930;
  private readonly chartH  = 190;

  private readonly DIAS_MES          = 31;
  private readonly DIAS_TRANSCURRIDOS = 11;

  private map: any = null;
  private mapMarkers: any[] = [];
  private viewReady = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnChanges(): void {
    this.sitiosResumen = this.sites.map((s, i) => {
      const geo = this.MOCK_SITE_GEO[i % this.MOCK_SITE_GEO.length];
      const m3Proyectados = Math.round(geo.consumoMes / this.DIAS_TRANSCURRIDOS * this.DIAS_MES);
      return {
        nombre:           s.descripcion || s.nombre || s.id_serial || 'Instalación',
        ubicacion:        s.ubicacion || 'Sin ubicación',
        estado:           (s.activo ? 'online' : 'sinDatos') as SitioResumen['estado'],
        lat:              geo.lat,
        lng:              geo.lng,
        caudal:           geo.caudal,
        nivel:            geo.nivel,
        consumoMes:       geo.consumoMes,
        diasActivos:      geo.diasActivos,
        diasMes:          this.DIAS_MES,
        m3Proyectados,
        tendenciaCaudal:  geo.tendenciaCaudal,
      };
    });

    const total   = this.sites.length;
    const activos = this.sites.filter(s => s.activo).length;
    const inactivos = total - activos;

    this.kpisSecundarios = [
      {
        label:   'Sitios activos',
        valor:   `${activos}/${total}`,
        subtext: inactivos > 0 ? `${inactivos} sin datos` : 'Todos operativos',
        icon:    'sensors',
        tono:    activos === total ? 'ok' : 'warn',
      },
      { label: 'Alertas activas', valor: '3', subtext: '1 crítica en seguimiento', icon: 'notifications_active', tono: 'warn'    },
      { label: 'DGA pendientes',  valor: '1', subtext: 'Mayo 2026 — en plazo',     icon: 'shield',               tono: 'neutral' },
    ];

    for (let mi = 0; mi < this.puntosMensuales.length; mi++) {
      this.puntosMensuales[mi] = {
        ...this.puntosMensuales[mi],
        valores: this.sitiosResumen.map((_, si) =>
          this.MOCK_FLOW_BY_SITE[si % this.MOCK_FLOW_BY_SITE.length][mi],
        ),
      };
    }

    this.buildMetricasComparacion();

    if (this.viewReady) {
      if (this.map) this.updateMarkers();
      else          this.initMap();
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  toggleSite(i: number): void {
    const next = new Set(this.hiddenSites());
    if (next.has(i)) next.delete(i); else next.add(i);
    this.hiddenSites.set(next);
  }

  setPreset(preset: PeriodoPreset): void {
    this.periodoPreset.set(preset);
    if (preset === 'semana') {
      this.periodoA.set({ label: 'Esta semana',       desde: '2026-05-11', hasta: '2026-05-11' });
      this.periodoB.set({ label: 'Semana anterior',   desde: '2026-05-04', hasta: '2026-05-10' });
    } else if (preset === 'mes') {
      this.periodoA.set({ label: 'Mayo 2026',         desde: '2026-05-01', hasta: '2026-05-11' });
      this.periodoB.set({ label: 'Abril 2026',        desde: '2026-04-01', hasta: '2026-04-11' });
    } else {
      this.periodoA.set({ label: 'Últimos 7 días',    desde: '2026-05-05', hasta: '2026-05-11' });
      this.periodoB.set({ label: '7 días anteriores', desde: '2026-04-28', hasta: '2026-05-04' });
    }
    this.buildMetricasComparacion();
  }

  buildPolyline(siteIndex: number): string {
    const n    = this.puntosMensuales.length;
    const step = this.chartW / (n - 1);
    const maxVal = 2500;
    return this.puntosMensuales
      .map((p, i) => {
        const x = this.chartX0 + i * step;
        const y = this.chartY0 + this.chartH - ((p.valores[siteIndex] ?? 0) / maxVal) * this.chartH;
        return `${x},${y}`;
      })
      .join(' ');
  }

  formatNum(n: number): string {
    if (!isFinite(n) || isNaN(n)) return '0.0';
    return Math.abs(n).toFixed(1);
  }

  estadoDotClass(e: SitioResumen['estado']): string {
    if (e === 'online')   return 'bg-emerald-500';
    if (e === 'offline')  return 'bg-rose-500';
    return 'bg-slate-300';
  }

  estadoTextClass(e: SitioResumen['estado']): string {
    if (e === 'online')   return 'text-emerald-600';
    if (e === 'offline')  return 'text-rose-500';
    return 'text-slate-400';
  }

  estadoLabel(e: SitioResumen['estado']): string {
    if (e === 'online')   return 'En línea';
    if (e === 'offline')  return 'Fuera de línea';
    return 'Sin datos';
  }

  kpiBorde(tono: KpiCard['tono']): string {
    if (tono === 'warn') return 'border-amber-200';
    if (tono === 'ok')   return 'border-emerald-100';
    return 'border-slate-200';
  }

  kpiIconClass(tono: KpiCard['tono']): string {
    if (tono === 'warn') return 'bg-amber-50 text-amber-600';
    if (tono === 'ok')   return 'bg-emerald-50 text-emerald-600';
    return 'bg-slate-100 text-slate-500';
  }

  metricaOpIconClass(tono: MetricaOperacional['tono']): string {
    if (tono === 'warn') return 'bg-amber-50 text-amber-600';
    if (tono === 'ok')   return 'bg-cyan-50 text-cyan-600';
    return 'bg-slate-100 text-slate-500';
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildMetricasComparacion(): void {
    const baseMult = this.periodoPreset() === 'semana' ? 0.93 : this.periodoPreset() === 'mes' ? 0.91 : 0.95;
    // Slight variation per site to simulate realistic data
    const siteOffset = [0.02, -0.03, 0.01, -0.02, 0.015];
    const pct = (a: number, b: number): number =>
      b !== 0 ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : 0;

    this.sitiosComparacion = this.sitiosResumen.map((s, i) => {
      const mult    = baseMult + (siteOffset[i % siteOffset.length] ?? 0);
      const caudalB = s.caudal * mult;
      const nivelB  = s.nivel * (1 - 0.03 * (i % 2 === 0 ? 1 : -1));
      const consumoB = Math.round(s.consumoMes * mult);

      return {
        nombre:     s.nombre,
        estado:     s.estado,
        caudalA:    s.caudal.toFixed(1),
        caudalB:    caudalB.toFixed(1),
        caudalTend: pct(s.caudal, caudalB),
        nivelA:     s.nivel.toFixed(1),
        nivelB:     nivelB.toFixed(1),
        nivelTend:  pct(s.nivel, nivelB),
        consumoA:   s.consumoMes.toLocaleString(),
        consumoB:   consumoB.toLocaleString(),
        consumoTend: pct(s.consumoMes, consumoB),
      };
    });
  }

  private async loadLeaflet(): Promise<any> {
    if ((window as any).L) return (window as any).L;

    const link = document.createElement('link');
    link.rel   = 'stylesheet';
    link.href  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    return new Promise(resolve => {
      const script  = document.createElement('script');
      script.src    = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve((window as any).L);
      document.body.appendChild(script);
    });
  }

  private async initMap(): Promise<void> {
    if (!this.mapContainer || this.map) return;
    const L = await this.loadLeaflet();
    if (!this.mapContainer || this.map) return; // guard against re-entry after await

    this.map = L.map(this.mapContainer.nativeElement, {
      scrollWheelZoom: false,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(this.map);

    this.updateMarkers();
  }

  private updateMarkers(): void {
    if (!this.map) return;
    const L: any = (window as any).L;
    if (!L) return;

    this.mapMarkers.forEach(m => m.remove());
    this.mapMarkers = [];

    if (this.sitiosResumen.length === 0) return;

    const bounds: [number, number][] = [];

    this.sitiosResumen.forEach((s, i) => {
      const color    = this.colores[i % this.colores.length];
      const dotColor = s.estado === 'online' ? '#22C55E' : s.estado === 'offline' ? '#F87171' : '#94A3B8';
      const tendSign = s.tendenciaCaudal >= 0 ? '+' : '';
      const tendColor = s.tendenciaCaudal >= 0 ? '#16A34A' : '#DC2626';

      const icon = L.divIcon({
        html: `<div style="position:relative;width:18px;height:18px;">
          <div style="width:18px;height:18px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>
          <div style="position:absolute;top:-1px;right:-1px;width:8px;height:8px;border-radius:50%;background:${dotColor};border:1.5px solid white;"></div>
        </div>`,
        className:   '',
        iconSize:    [18, 18],
        iconAnchor:  [9, 9],
        popupAnchor: [0, -14],
      });

      const popupHtml = `
        <div style="font-family:'DM Sans',sans-serif;min-width:200px;padding:2px;">
          <p style="font-weight:800;font-size:12px;color:#1E293B;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #E2E8F0;">${s.nombre}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;">
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Caudal</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#0DAFBD;margin:0;">${s.caudal} L/s</p>
            </div>
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Nivel</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#1E293B;margin:0;">${s.nivel} m</p>
            </div>
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Consumo mes</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#1E293B;margin:0;">${s.consumoMes.toLocaleString()} m³</p>
            </div>
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Tendencia</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${tendColor};margin:0;">${tendSign}${s.tendenciaCaudal}%</p>
            </div>
          </div>
        </div>
      `;

      const marker = L.marker([s.lat, s.lng], { icon })
        .bindPopup(L.popup({ closeButton: false, maxWidth: 230 }).setContent(popupHtml))
        .addTo(this.map);

      this.mapMarkers.push(marker);
      bounds.push([s.lat, s.lng]);
    });

    if (bounds.length > 0) {
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11 });
    }
  }
}
