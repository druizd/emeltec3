/**
 * Análisis — Salud del sistema (conectado a /api/v2/sites/:siteId/analisis/salud).
 *
 * Calcula heartbeat real, estado por sensor (verde <5min, amber <30min,
 * rojo ≥30min) y gaps de telemetría >1h en últimos 30 días.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { AnalisisService, type SaludData, type SensorEstado } from '../../../../services/analisis.service';

type Tono = 'ok' | 'advertencia' | 'error';

@Component({
  selector: 'app-analisis-salud',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <article
          class="rounded-2xl border bg-white p-4 shadow-sm"
          [class]="metricaBorde(heartbeatTono())"
        >
          <div class="flex items-start justify-between gap-2">
            <span
              [class]="metricaIconClass(heartbeatTono())"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            >
              <span class="material-symbols-outlined text-[20px]">monitor_heart</span>
            </span>
            <span
              [class]="tonoBadgeClass(heartbeatTono())"
              class="rounded-full px-2 py-0.5 text-[10px] font-black uppercase"
            >
              {{ tonoLabel(heartbeatTono()) }}
            </span>
          </div>
          <p
            class="mt-3 text-[10px] font-black uppercase tracking-widest"
            [class]="metricaLabelColor(heartbeatTono())"
          >
            Último heartbeat
          </p>
          <p class="mt-0.5 text-2xl font-black text-slate-800">{{ heartbeatLabel() }}</p>
          <p class="text-[11px] text-slate-400">{{ heartbeatFecha() }}</p>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start gap-2">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"
            >
              <span class="material-symbols-outlined text-[20px]">sensors</span>
            </span>
          </div>
          <p class="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Sensores OK
          </p>
          <p class="mt-0.5 text-2xl font-black text-slate-800">
            {{ countSensores('ok') }} / {{ salud().sensores.length }}
          </p>
          <p class="text-[11px] text-slate-400">en última lectura</p>
        </article>

        <article class="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
          <div class="flex items-start gap-2">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
            >
              <span class="material-symbols-outlined text-[20px]">warning</span>
            </span>
          </div>
          <p class="mt-3 text-[10px] font-black uppercase tracking-widest text-amber-500">
            Sensores en alerta
          </p>
          <p class="mt-0.5 text-2xl font-black text-slate-800">
            {{ countSensores('advertencia') + countSensores('error') }}
          </p>
          <p class="text-[11px] text-slate-400">advertencia + error</p>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start gap-2">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
            >
              <span class="material-symbols-outlined text-[20px]">data_loss_prevention</span>
            </span>
          </div>
          <p class="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Gaps (30 días)
          </p>
          <p class="mt-0.5 text-2xl font-black text-slate-800">{{ salud().gaps.length }}</p>
          <p class="text-[11px] text-slate-400">interrupciones ≥ 1 h</p>
        </article>
      </div>

      <div class="grid gap-3 xl:grid-cols-2">
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span class="material-symbols-outlined text-[16px]">sensors</span>
            Estado de sensores
          </h3>
          @if (salud().sensores.length === 0) {
            <p class="text-[12px] italic text-slate-400">Sin sensores configurados.</p>
          } @else {
            <div class="space-y-2">
              @for (s of salud().sensores; track s.reg_map_id) {
                <div
                  class="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                >
                  <div class="flex items-center gap-2">
                    <span
                      [class]="'h-2 w-2 shrink-0 rounded-full ' + sensorDot(sensorTono(s))"
                    ></span>
                    <span class="text-sm font-semibold text-slate-800">{{ s.alias }}</span>
                  </div>
                  <div class="text-right">
                    <p class="font-mono text-sm font-bold text-slate-700">
                      {{ formatSensorValue(s) }}
                    </p>
                    <p class="text-[10px] text-slate-400">{{ edadLabel(s.edad_seg) }}</p>
                  </div>
                </div>
              }
            </div>
          }
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span class="material-symbols-outlined text-[16px]">data_loss_prevention</span>
            Gaps de datos — últimos 30 días
          </h3>
          @if (salud().gaps.length === 0) {
            <p class="text-[12px] italic text-emerald-600">
              ✓ Sin interrupciones detectadas (≥ 1 h).
            </p>
          } @else {
            <ul class="divide-y divide-slate-100">
              @for (g of salud().gaps; track g.desde) {
                <li class="flex items-center justify-between gap-3 py-2 text-[12px]">
                  <span class="font-mono text-slate-600">
                    {{ formatTs(g.desde) }} → {{ formatTs(g.hasta) }}
                  </span>
                  <span class="font-bold text-rose-600">{{ formatDuracion(g.duracion_min) }}</span>
                </li>
              }
            </ul>
          }
        </section>
      </div>
    </div>
  `,
})
export class AnalisisSaludComponent implements OnInit {
  private readonly api = inject(AnalisisService);

  readonly sitioId = input<string>('');

  readonly salud = signal<SaludData>({
    ultimo_heartbeat: null,
    edad_heartbeat_seg: null,
    sensores: [],
    gaps: [],
  });

  readonly heartbeatTono = computed<Tono>(() => {
    const age = this.salud().edad_heartbeat_seg;
    if (age === null) return 'error';
    if (age < 5 * 60) return 'ok';
    if (age < 30 * 60) return 'advertencia';
    return 'error';
  });

  readonly heartbeatLabel = computed(() => {
    const age = this.salud().edad_heartbeat_seg;
    if (age === null) return 'Sin datos';
    return 'Hace ' + this.formatEdadCorta(age);
  });

  readonly heartbeatFecha = computed(() => {
    const ts = this.salud().ultimo_heartbeat;
    if (!ts) return '';
    return this.formatTs(ts);
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.api.getSalud(this.sitioId()).subscribe({
      next: (s) => this.salud.set(s),
      error: () =>
        this.salud.set({
          ultimo_heartbeat: null,
          edad_heartbeat_seg: null,
          sensores: [],
          gaps: [],
        }),
    });
  }

  // ===== Helpers UI =====

  countSensores(tono: Tono): number {
    return this.salud().sensores.filter((s) => this.sensorTono(s) === tono).length;
  }

  sensorTono(s: SensorEstado): Tono {
    const age = s.edad_seg;
    if (s.raw_value === null || s.raw_value === undefined || age === null) return 'error';
    if (age < 5 * 60) return 'ok';
    if (age < 30 * 60) return 'advertencia';
    return 'error';
  }

  formatSensorValue(s: SensorEstado): string {
    if (s.raw_value === null || s.raw_value === undefined) return '—';
    const n = Number(s.raw_value);
    const valor = Number.isFinite(n) ? n.toFixed(2) : String(s.raw_value);
    return s.unidad ? `${valor} ${s.unidad}` : valor;
  }

  edadLabel(segundos: number | null): string {
    if (segundos === null) return 'sin datos';
    return 'Hace ' + this.formatEdadCorta(segundos);
  }

  private formatEdadCorta(segundos: number): string {
    if (segundos < 60) return `${segundos}s`;
    const m = Math.round(segundos / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h`;
    const d = Math.round(h / 24);
    return `${d} d`;
  }

  formatTs(iso: string): string {
    const d = new Date(new Date(iso).getTime() - 4 * 3600 * 1000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
    const HH = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${MM} ${HH}:${mm}`;
  }

  formatDuracion(minutos: number): string {
    if (minutos < 60) return `${minutos} min`;
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }

  // ===== Styling =====

  metricaBorde(t: Tono): string {
    return t === 'error' ? 'border-rose-200' : t === 'advertencia' ? 'border-amber-200' : 'border-slate-200';
  }
  metricaIconClass(t: Tono): string {
    return t === 'error'
      ? 'bg-rose-50 text-rose-500'
      : t === 'advertencia'
        ? 'bg-amber-50 text-amber-500'
        : 'bg-emerald-50 text-emerald-600';
  }
  metricaLabelColor(t: Tono): string {
    return t === 'error' ? 'text-rose-400' : t === 'advertencia' ? 'text-amber-400' : 'text-slate-400';
  }
  tonoBadgeClass(t: Tono): string {
    return t === 'error'
      ? 'bg-rose-50 text-rose-600'
      : t === 'advertencia'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-emerald-50 text-emerald-600';
  }
  tonoLabel(t: Tono): string {
    return t === 'error' ? 'Error' : t === 'advertencia' ? 'Atención' : 'OK';
  }
  sensorDot(e: Tono): string {
    return e === 'error' ? 'bg-rose-500' : e === 'advertencia' ? 'bg-amber-500' : 'bg-emerald-500';
  }
}
