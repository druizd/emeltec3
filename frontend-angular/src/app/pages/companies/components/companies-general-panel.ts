import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';

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
}

interface MetricaOperacional {
  label: string;
  valor: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

@Component({
  selector: 'app-companies-general-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-4 animate-in fade-in duration-500">

      <!-- KPIs principales -->
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

        <!-- Card primario (gradiente) -->
        <article class="rounded-2xl bg-gradient-to-br from-[#04606A] via-[#0D8A96] to-[#0DAFBD] p-5 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-cyan-100">Flujo acumulado mensual</p>
              <p class="mt-2 font-mono text-3xl font-black text-white leading-none">14,921 m³</p>
              <p class="mt-1 text-[11px] text-cyan-200">Acumulado en mayo 2026</p>
            </div>
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <span class="material-symbols-outlined text-[22px] text-white">water_drop</span>
            </span>
          </div>
        </article>

        <!-- KPIs secundarios -->
        @for (k of kpisSecundarios; track k.label) {
          <article class="rounded-2xl border bg-white p-5 shadow-sm" [class]="kpiBorde(k.tono)">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ k.label }}</p>
                <p class="mt-2 font-mono text-3xl font-black text-slate-800 leading-none">{{ k.valor }}</p>
                <p class="mt-1 text-[11px] text-slate-400">{{ k.subtext }}</p>
              </div>
              <span [class]="kpiIconClass(k.tono)" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <span class="material-symbols-outlined text-[22px]">{{ k.icon }}</span>
              </span>
            </div>
          </article>
        }

      </div>

      <!-- Gráfico + Sitios -->
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">

        <!-- Gráfico de flujo mensual -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-black text-slate-800">Flujo mensual por instalación</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">m³/mes · últimos 6 meses</p>
            </div>
            <div class="flex flex-wrap gap-2">
              @for (s of sitiosResumen; track s.nombre; let i = $index) {
                <span class="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  <span class="h-2.5 w-2.5 rounded-full" [style.background]="colores[i % colores.length]"></span>
                  {{ s.nombre | slice:0:12 }}{{ s.nombre.length > 12 ? '…' : '' }}
                </span>
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
                  opacity="0.85"
                />
              }
            </svg>
          </div>
        </section>

        <!-- Lista de sitios con estado -->
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
            <div class="space-y-2">
              @for (s of sitiosResumen; track s.nombre) {
                <div class="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <span [class]="estadoDotClass(s.estado)" class="h-2 w-2 shrink-0 rounded-full"></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[12px] font-semibold text-slate-800">{{ s.nombre }}</p>
                    <p class="truncate text-[10px] text-slate-400">{{ s.ubicacion }}</p>
                  </div>
                  <span class="text-[10px] font-semibold" [class]="estadoTextClass(s.estado)">
                    {{ estadoLabel(s.estado) }}
                  </span>
                </div>
              }
            </div>
          }
        </section>

      </div>

      <!-- Métricas operacionales -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3">
          <h3 class="text-sm font-black text-slate-800">Resumen operacional</h3>
          <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">
            Mayo 2026
          </span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          @for (m of metricasOp; track m.label) {
            <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ m.label }}</p>
                <span [class]="metricaOpIconClass(m.tono)" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                  <span class="material-symbols-outlined text-[18px]">{{ m.icon }}</span>
                </span>
              </div>
              <p class="mt-2 font-mono text-2xl font-black text-slate-800">{{ m.valor }}</p>
            </div>
          }
        </div>
      </section>

    </div>
  `,
})
export class CompaniesGeneralPanelComponent implements OnChanges {
  @Input() sites: any[] = [];
  @Input() subEmpresaId = '';

  readonly colores = ['#0DAFBD', '#22C55E', '#6366F1', '#F59E0B', '#F97316'];

  sitiosResumen: SitioResumen[] = [];
  kpisSecundarios: KpiCard[] = [];

  private readonly MOCK_FLOW_BY_SITE: number[][] = [
    [2100, 2250, 2050, 2300, 2180, 2400],
    [1800, 1950, 1700, 2000, 1900, 2100],
    [1100, 1250, 1050, 1300, 1180, 1400],
    [800, 900, 750, 950, 850, 1000],
    [600, 700, 550, 750, 650, 800],
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
    { label: 'Uptime promedio', valor: '99.1%', icon: 'wifi', tono: 'ok' },
    { label: 'Tiempo respuesta', valor: '3.2 h', icon: 'timer', tono: 'ok' },
    { label: 'Visitas técnicas', valor: '14', icon: 'engineering', tono: 'neutral' },
    { label: 'Resolución 1ra visita', valor: '86%', icon: 'check_circle', tono: 'ok' },
  ];

  readonly yTicks = [
    { y: 10, label: '2500' },
    { y: 73, label: '1875' },
    { y: 137, label: '1250' },
    { y: 200, label: '0' },
  ];

  private readonly chartX0 = 60;
  private readonly chartY0 = 10;
  private readonly chartW = 930;
  private readonly chartH = 190;

  ngOnChanges(): void {
    this.sitiosResumen = this.sites.map((s) => ({
      nombre: s.descripcion || s.nombre || s.id_serial || 'Instalación',
      ubicacion: s.ubicacion || 'Sin ubicación',
      estado: s.activo ? 'online' : 'sinDatos',
    }));

    const total = this.sites.length;
    const activos = this.sites.filter((s) => s.activo).length;
    const inactivos = total - activos;

    this.kpisSecundarios = [
      {
        label: 'Sitios activos',
        valor: `${activos}/${total}`,
        subtext: inactivos > 0 ? `${inactivos} sin datos` : 'Todos operativos',
        icon: 'sensors',
        tono: activos === total ? 'ok' : 'warn',
      },
      { label: 'Alertas activas', valor: '3', subtext: '1 crítica en seguimiento', icon: 'notifications_active', tono: 'warn' },
      { label: 'DGA pendientes', valor: '1', subtext: 'Mayo 2026 — en plazo', icon: 'shield', tono: 'neutral' },
    ];

    // Rebuild puntosMensuales.valores per actual site count
    for (let mi = 0; mi < this.puntosMensuales.length; mi++) {
      this.puntosMensuales[mi] = {
        ...this.puntosMensuales[mi],
        valores: this.sitiosResumen.map((_, si) => this.MOCK_FLOW_BY_SITE[si % this.MOCK_FLOW_BY_SITE.length][mi]),
      };
    }
  }

  buildPolyline(siteIndex: number): string {
    const n = this.puntosMensuales.length;
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

  estadoDotClass(e: SitioResumen['estado']): string {
    if (e === 'online') return 'bg-emerald-500';
    if (e === 'offline') return 'bg-rose-500';
    return 'bg-slate-300';
  }

  estadoTextClass(e: SitioResumen['estado']): string {
    if (e === 'online') return 'text-emerald-600';
    if (e === 'offline') return 'text-rose-500';
    return 'text-slate-400';
  }

  estadoLabel(e: SitioResumen['estado']): string {
    if (e === 'online') return 'En línea';
    if (e === 'offline') return 'Fuera de línea';
    return 'Sin datos';
  }

  kpiBorde(tono: KpiCard['tono']): string {
    if (tono === 'warn') return 'border-amber-200';
    if (tono === 'ok') return 'border-emerald-100';
    return 'border-slate-200';
  }

  kpiIconClass(tono: KpiCard['tono']): string {
    if (tono === 'warn') return 'bg-amber-50 text-amber-600';
    if (tono === 'ok') return 'bg-emerald-50 text-emerald-600';
    return 'bg-slate-100 text-slate-500';
  }

  metricaOpIconClass(tono: MetricaOperacional['tono']): string {
    if (tono === 'warn') return 'bg-amber-50 text-amber-600';
    if (tono === 'ok') return 'bg-cyan-50 text-cyan-600';
    return 'bg-slate-100 text-slate-500';
  }
}
