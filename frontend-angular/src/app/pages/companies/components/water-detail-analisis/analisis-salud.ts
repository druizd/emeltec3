import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface SaludMetric {
  label: string;
  valor: string;
  subtext: string;
  tono: 'ok' | 'advertencia' | 'error';
  icon: string;
}

interface GapItem {
  desde: string;
  hasta: string;
  duracion: string;
  causa: string;
}

interface SensorEstado {
  nombre: string;
  ultimaLectura: string;
  valor: string;
  estado: 'ok' | 'advertencia' | 'error';
}

@Component({
  selector: 'app-analisis-salud',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <!-- KPIs principales -->
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        @for (m of metricas; track m.label) {
          <article class="rounded-2xl border bg-white p-4 shadow-sm" [class]="metricaBorde(m.tono)">
            <div class="flex items-start justify-between gap-2">
              <span
                [class]="metricaIconClass(m.tono)"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              >
                <span class="material-symbols-outlined text-[20px]">{{ m.icon }}</span>
              </span>
              <span
                [class]="tonoBadgeClass(m.tono)"
                class="rounded-full px-2 py-0.5 text-[10px] font-black uppercase"
              >
                {{ tonoLabel(m.tono) }}
              </span>
            </div>
            <p
              class="mt-3 text-[10px] font-black uppercase tracking-widest"
              [class]="metricaLabelColor(m.tono)"
            >
              {{ m.label }}
            </p>
            <p class="mt-0.5 text-2xl font-black text-slate-800">{{ m.valor }}</p>
            <p class="text-[11px] text-slate-400">{{ m.subtext }}</p>
          </article>
        }
      </div>

      <div class="grid gap-3 xl:grid-cols-2">
        <!-- Estado de sensores -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3
            class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
          >
            <span class="material-symbols-outlined text-[16px]">sensors</span>
            Estado de sensores
          </h3>
          <div class="space-y-2">
            @for (sensor of sensores; track sensor.nombre) {
              <div
                class="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
              >
                <div class="flex items-center gap-2">
                  <span
                    [class]="sensorDot(sensor.estado)"
                    class="h-2 w-2 shrink-0 rounded-full"
                  ></span>
                  <span class="font-semibold text-slate-800 text-sm">{{ sensor.nombre }}</span>
                </div>
                <div class="text-right">
                  <p class="font-mono text-sm font-bold text-slate-700">{{ sensor.valor }}</p>
                  <p class="text-[10px] text-slate-400">{{ sensor.ultimaLectura }}</p>
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Gaps de datos -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3
            class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
          >
            <span class="material-symbols-outlined text-[16px]">data_loss_prevention</span>
            Gaps de datos — últimos 30 días
          </h3>
          @if (gaps.length === 0) {
            <div class="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3">
              <span class="material-symbols-outlined text-[20px] text-emerald-600"
                >check_circle</span
              >
              <p class="text-sm font-semibold text-emerald-700">
                Sin gaps detectados. Datos completos.
              </p>
            </div>
          } @else {
            <div class="space-y-2">
              @for (gap of gaps; track gap.desde) {
                <div class="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <p class="font-mono text-[11px] font-bold text-amber-700">
                        {{ gap.desde }} → {{ gap.hasta }}
                      </p>
                      <p class="text-[11px] text-amber-600">{{ gap.causa }}</p>
                    </div>
                    <span
                      class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-700"
                      >{{ gap.duracion }}</span
                    >
                  </div>
                </div>
              }
            </div>
          }
        </section>
      </div>

      <!-- Barra de calidad de datos visual -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Calidad de datos — últimos 30 días
          </h3>
          <span class="font-mono text-sm font-black text-slate-700">98.3%</span>
        </div>
        <div class="h-3 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            class="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400"
            style="width: 98.3%"
          ></div>
        </div>
        <div class="mt-2 flex justify-between text-[10px] text-slate-400">
          <span>8 829 registros válidos</span>
          <span>152 inválidos o faltantes</span>
        </div>
      </section>
    </div>
  `,
})
export class AnalisisSaludComponent {
  readonly metricas: SaludMetric[] = [
    {
      label: 'Uptime comunicación',
      valor: '99.1%',
      subtext: 'Últimos 30 días',
      tono: 'ok',
      icon: 'wifi',
    },
    {
      label: 'Calidad de datos',
      valor: '98.3%',
      subtext: '152 registros inválidos',
      tono: 'ok',
      icon: 'database',
    },
    {
      label: 'Último heartbeat',
      valor: 'Hace 4 min',
      subtext: '06/05/2026 12:31',
      tono: 'ok',
      icon: 'monitor_heart',
    },
    {
      label: 'Sensor en alerta',
      valor: '1',
      subtext: 'Tablero — temperatura',
      tono: 'advertencia',
      icon: 'sensors',
    },
  ];

  readonly sensores: SensorEstado[] = [
    {
      nombre: 'Sensor de nivel freático',
      ultimaLectura: 'Hace 4 min',
      valor: '32.4 m',
      estado: 'ok',
    },
    { nombre: 'Caudalímetro', ultimaLectura: 'Hace 4 min', valor: '3.1 L/s', estado: 'ok' },
    {
      nombre: 'Temperatura tablero',
      ultimaLectura: 'Hace 4 min',
      valor: '67°C',
      estado: 'advertencia',
    },
    { nombre: 'Presión bomba', ultimaLectura: 'Hace 4 min', valor: '4.2 bar', estado: 'ok' },
    { nombre: 'UPS — batería', ultimaLectura: 'Hace 12 min', valor: '18%', estado: 'error' },
  ];

  readonly gaps: GapItem[] = [
    {
      desde: '02/04 11:00',
      hasta: '02/04 14:05',
      duracion: '3 h 05 min',
      causa: 'Corte de comunicación GPRS',
    },
  ];

  metricaBorde(t: string): string {
    return t === 'error'
      ? 'border-rose-200'
      : t === 'advertencia'
        ? 'border-amber-200'
        : 'border-slate-200';
  }

  metricaIconClass(t: string): string {
    return t === 'error'
      ? 'bg-rose-50 text-rose-500'
      : t === 'advertencia'
        ? 'bg-amber-50 text-amber-500'
        : 'bg-emerald-50 text-emerald-600';
  }

  metricaLabelColor(t: string): string {
    return t === 'error'
      ? 'text-rose-400'
      : t === 'advertencia'
        ? 'text-amber-400'
        : 'text-slate-400';
  }

  tonoBadgeClass(t: string): string {
    return t === 'error'
      ? 'bg-rose-50 text-rose-600'
      : t === 'advertencia'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-emerald-50 text-emerald-600';
  }

  tonoLabel(t: string): string {
    return t === 'error' ? 'Error' : t === 'advertencia' ? 'Atención' : 'OK';
  }

  sensorDot(e: string): string {
    return e === 'error' ? 'bg-rose-500' : e === 'advertencia' ? 'bg-amber-500' : 'bg-emerald-500';
  }
}
