import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type Preset = '7d' | '30d' | '90d';

interface KpiPeriodo {
  label: string;
  valor: string;
  subtext: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

interface FilaDiaria {
  fecha: string;
  flujo: number;
  caudalProm: number;
  nivel: number;
  alertas: number;
}

interface BarChart {
  bars: { x: number; y: number; w: number; h: number; fill: string }[];
  yTicks: { y: number; label: string }[];
  xLabels: { x: number; label: string }[];
}

@Component({
  selector: 'app-operacion-resumen-periodo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- Selector de período -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-3">

          <!-- Presets -->
          <div class="flex items-center gap-1">
            @for (p of presets; track p.key) {
              <button type="button" (click)="setPreset(p.key)" [class]="presetClass(p.key)">{{ p.label }}</button>
            }
          </div>

          <!-- Rango custom -->
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
            <span class="font-semibold">Desde</span>
            <input
              type="date"
              [value]="fechaDesde()"
              (change)="onFechaChange('desde', $any($event.target).value)"
              class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-700 focus:border-cyan-400 focus:outline-none"
            />
            <span class="font-semibold">hasta</span>
            <input
              type="date"
              [value]="fechaHasta()"
              (change)="onFechaChange('hasta', $any($event.target).value)"
              class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-700 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <!-- Exportar -->
          <button type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
            <span class="material-symbols-outlined text-[15px]">download</span>
            Exportar
          </button>
        </div>
      </section>

      <!-- KPIs del período -->
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        @for (k of data().kpis; track k.label) {
          <article class="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm" [class]="kpiBorde(k.tono)">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" [class]="kpiIconClass(k.tono)">
              <span class="material-symbols-outlined text-[20px]">{{ k.icon }}</span>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ k.label }}</p>
              <p class="mt-0.5 text-xl font-black text-slate-800">{{ k.valor }}</p>
              <p class="text-[11px] text-slate-400">{{ k.subtext }}</p>
            </div>
          </article>
        }
      </div>

      <!-- Gráfico de flujo del período -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h3 class="text-sm font-black text-slate-800">Flujo diario en el período</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">m³/día · días sin operación en gris</p>
          </div>
          <span class="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-700">{{ periodoLabel() }}</span>
        </div>
        <div class="h-44 w-full">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of chart().yTicks; track t.y) {
              <line x1="55" [attr.y1]="t.y" x2="1090" [attr.y2]="t.y" stroke="#f1f5f9" stroke-width="1"/>
              <text x="50" [attr.y]="t.y + 4" font-size="11" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ t.label }}</text>
            }
            @for (l of chart().xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">{{ l.label }}</text>
            }
            @for (b of chart().bars; track b.x) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.fill" rx="2" opacity="0.85"/>
            }
          </svg>
        </div>
      </section>

      <!-- Tabla resumen diario -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
          <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">Resumen diario — últimos 7 días del período</h3>
          <button type="button" class="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700 hover:underline">
            <span class="material-symbols-outlined text-[13px]">download</span>.CSV
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50/60">
                <th class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha</th>
                <th class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Flujo (m³)</th>
                <th class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Caudal prom.</th>
                <th class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Nivel freat.</th>
                <th class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Alertas</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (fila of data().tabla; track fila.fecha) {
                <tr class="hover:bg-slate-50/60" [class.opacity-50]="fila.flujo === 0">
                  <td class="px-4 py-2.5 font-mono text-[12px] font-bold text-slate-600">{{ fila.fecha }}</td>
                  <td class="px-4 py-2.5 text-right font-mono text-[12px] text-slate-700">
                    @if (fila.flujo > 0) { {{ fila.flujo }} } @else { <span class="text-slate-300">—</span> }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-[12px] text-slate-700">
                    @if (fila.caudalProm > 0) { {{ fila.caudalProm }} L/s } @else { <span class="text-slate-300">—</span> }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-[12px] text-slate-700">{{ fila.nivel }} m</td>
                  <td class="px-4 py-2.5 text-right">
                    @if (fila.alertas > 0) {
                      <span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                        {{ fila.alertas }}
                      </span>
                    } @else {
                      <span class="font-mono text-[12px] text-slate-300">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="border-t border-slate-100 px-4 py-2.5">
          <p class="text-[11px] text-slate-400">Los datos son provisorios hasta confirmar sincronización con DGA.</p>
        </div>
      </section>

    </div>
  `,
})
export class OperacionResumenPeriodoComponent {
  readonly preset = signal<Preset>('30d');
  readonly fechaDesde = signal('2026-04-10');
  readonly fechaHasta = signal('2026-05-10');

  readonly presets: { key: Preset; label: string }[] = [
    { key: '7d', label: '7 días' },
    { key: '30d', label: '30 días' },
    { key: '90d', label: '90 días' },
  ];

  // SVG drawing area
  private readonly DX = 55, DY = 15, DW = 1035, DH = 170;

  private readonly mockKpis: Record<Preset, KpiPeriodo[]> = {
    '7d': [
      { label: 'Flujo acumulado', valor: '1,183 m³', subtext: 'Últimos 7 días', icon: 'water_drop', tono: 'ok' },
      { label: 'Caudal promedio', valor: '3.1 L/s', subtext: 'Período activo', icon: 'speed', tono: 'ok' },
      { label: 'Nivel freático prom.', valor: '32.4 m', subtext: 'Profundidad media', icon: 'vertical_align_bottom', tono: 'neutral' },
      { label: 'Días con operación', valor: '5 / 7', subtext: '2 días sin bomba', icon: 'event_available', tono: 'neutral' },
      { label: 'Alertas en período', valor: '1', subtext: '0 críticas', icon: 'notifications', tono: 'ok' },
      { label: 'Uptime comunicación', valor: '99.8%', subtext: '~29 min offline', icon: 'wifi', tono: 'ok' },
    ],
    '30d': [
      { label: 'Flujo acumulado', valor: '4,920 m³', subtext: 'Últimos 30 días', icon: 'water_drop', tono: 'ok' },
      { label: 'Caudal promedio', valor: '3.1 L/s', subtext: 'Período activo', icon: 'speed', tono: 'ok' },
      { label: 'Nivel freático prom.', valor: '32.4 m', subtext: 'Profundidad media', icon: 'vertical_align_bottom', tono: 'neutral' },
      { label: 'Días con operación', valor: '22 / 30', subtext: '8 días sin bomba', icon: 'event_available', tono: 'neutral' },
      { label: 'Alertas en período', valor: '4', subtext: '1 crítica', icon: 'notifications', tono: 'warn' },
      { label: 'Uptime comunicación', valor: '99.1%', subtext: '~4 h 05 min offline', icon: 'wifi', tono: 'ok' },
    ],
    '90d': [
      { label: 'Flujo acumulado', valor: '14,921 m³', subtext: 'Últimos 90 días', icon: 'water_drop', tono: 'ok' },
      { label: 'Caudal promedio', valor: '3.0 L/s', subtext: 'Período activo', icon: 'speed', tono: 'ok' },
      { label: 'Nivel freático prom.', valor: '32.5 m', subtext: 'Profundidad media', icon: 'vertical_align_bottom', tono: 'neutral' },
      { label: 'Días con operación', valor: '66 / 90', subtext: '24 días sin bomba', icon: 'event_available', tono: 'neutral' },
      { label: 'Alertas en período', valor: '8', subtext: '2 críticas', icon: 'notifications', tono: 'warn' },
      { label: 'Uptime comunicación', valor: '98.7%', subtext: '~28 h offline', icon: 'wifi', tono: 'warn' },
    ],
  };

  private readonly tablaComun: FilaDiaria[] = [
    { fecha: '10/05', flujo: 169, caudalProm: 3.1, nivel: 32.4, alertas: 0 },
    { fecha: '09/05', flujo: 172, caudalProm: 3.1, nivel: 32.3, alertas: 0 },
    { fecha: '08/05', flujo: 168, caudalProm: 3.0, nivel: 32.5, alertas: 1 },
    { fecha: '07/05', flujo: 0,   caudalProm: 0,   nivel: 32.4, alertas: 0 },
    { fecha: '06/05', flujo: 175, caudalProm: 3.2, nivel: 32.4, alertas: 0 },
    { fecha: '05/05', flujo: 171, caudalProm: 3.1, nivel: 32.6, alertas: 0 },
    { fecha: '04/05', flujo: 0,   caudalProm: 0,   nivel: 32.5, alertas: 0 },
  ];

  private readonly barData: Record<Preset, { vals: number[]; labels: string[]; step: number }> = {
    '7d': {
      vals: [0, 171, 175, 0, 168, 172, 169],
      labels: ['04/05', '05/05', '06/05', '07/05', '08/05', '09/05', '10/05'],
      step: 1,
    },
    '30d': {
      vals: [172, 168, 175, 0, 163, 171, 174, 169, 177, 165, 0, 178, 172, 166, 175, 168, 0, 171, 174, 165, 172, 169, 0, 179, 171, 168, 175, 172, 0, 169],
      labels: ['11/04','12/04','13/04','14/04','15/04','16/04','17/04','18/04','19/04','20/04','21/04','22/04','23/04','24/04','25/04','26/04','27/04','28/04','29/04','30/04','01/05','02/05','03/05','04/05','05/05','06/05','07/05','08/05','09/05','10/05'],
      step: 5,
    },
    '90d': {
      vals: Array.from({ length: 90 }, (_, i) => {
        const mod = i % 7;
        if (mod === 5 || mod === 6) return 0;
        return [172, 168, 175, 163, 171, 174, 169, 177, 165, 178][i % 10];
      }),
      labels: Array.from({ length: 90 }, (_, i) => {
        const d = new Date(2026, 1, 9);
        d.setDate(d.getDate() + i);
        return `${d.getDate()}/${d.getMonth() + 1}`;
      }),
      step: 15,
    },
  };

  readonly data = computed(() => ({
    kpis: this.mockKpis[this.preset()],
    tabla: this.tablaComun,
  }));

  readonly chart = computed((): BarChart => {
    const { vals, labels, step } = this.barData[this.preset()];
    return this.buildBars(vals, labels, step);
  });

  readonly periodoLabel = computed(() => {
    const map: Record<Preset, string> = { '7d': 'Últimos 7 días', '30d': 'Últimos 30 días', '90d': 'Últimos 90 días' };
    return map[this.preset()];
  });

  setPreset(p: Preset): void {
    this.preset.set(p);
    const hasta = new Date(2026, 4, 10);
    const dias = p === '7d' ? 7 : p === '30d' ? 30 : 90;
    const desde = new Date(hasta);
    desde.setDate(desde.getDate() - dias);
    this.fechaDesde.set(desde.toISOString().slice(0, 10));
    this.fechaHasta.set(hasta.toISOString().slice(0, 10));
  }

  onFechaChange(campo: 'desde' | 'hasta', val: string): void {
    if (campo === 'desde') this.fechaDesde.set(val);
    else this.fechaHasta.set(val);
    this.preset.set('30d'); // reset preset on manual change
  }

  private buildBars(vals: number[], labels: string[], xStep: number): BarChart {
    const maxVal = Math.max(...vals) || 1;
    const slotW = this.DW / vals.length;
    const barW = Math.max(slotW * 0.72, 3);
    const gapW = (slotW - barW) / 2;

    const bars = vals.map((v, i) => {
      const h = Math.round((v / maxVal) * this.DH);
      return {
        x: Math.round(this.DX + i * slotW + gapW),
        y: Math.round(this.DY + this.DH - h),
        w: Math.round(barW),
        h: Math.max(h, v > 0 ? 2 : 0),
        fill: v === 0 ? '#e2e8f0' : '#0DAFBD',
      };
    });

    const nTicks = 4;
    const yTicks = Array.from({ length: nTicks }, (_, i) => ({
      y: Math.round(this.DY + this.DH - (i / (nTicks - 1)) * this.DH),
      label: i === 0 ? '0' : Math.round((maxVal * i) / (nTicks - 1)).toString(),
    }));

    const xLabels: { x: number; label: string }[] = [];
    for (let i = 0; i < vals.length; i += xStep) {
      xLabels.push({ x: Math.round(this.DX + i * slotW + slotW / 2), label: labels[i] ?? '' });
    }

    return { bars, yTicks, xLabels };
  }

  presetClass(p: Preset): string {
    const active = this.preset() === p;
    return ['rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all', active ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'].join(' ');
  }

  kpiBorde(t: string): string {
    return t === 'warn' ? 'border-amber-200' : 'border-slate-200';
  }

  kpiIconClass(t: string): string {
    return t === 'warn' ? 'bg-amber-50 text-amber-600' : t === 'ok' ? 'bg-cyan-50 text-cyan-600' : 'bg-slate-100 text-slate-500';
  }
}
