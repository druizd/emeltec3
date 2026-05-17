import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, combineLatest, debounceTime, of, switchMap } from 'rxjs';
import { AlertaService, type EventoRow } from '../../../../services/alerta.service';
import {
  WaterOperacionStateService,
  type OperacionPreset as Preset,
} from './water-operacion-state';

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

interface AlertaPeriodo {
  id: number;
  fechaHora: string;
  titulo: string;
  severidad: 'critica' | 'advertencia' | 'info';
  estado: 'activa' | 'resuelta';
}

interface IncidenciaPeriodo {
  fecha: string;
  descripcion: string;
  categoria: string;
  estado: 'resuelta' | 'pendiente' | 'en_proceso';
  tecnico: string;
}

@Component({
  selector: 'app-operacion-resumen-periodo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <!-- Selector de perÃ­odo -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-3">
          <!-- Presets -->
          <div class="flex items-center gap-1" role="group" aria-label="Presets de perÃ­odo">
            @for (p of presets; track p.key) {
              <button
                type="button"
                (click)="setPreset(p.key)"
                [class]="presetClass(p.key)"
                [attr.aria-pressed]="preset() === p.key"
              >
                {{ p.label }}
              </button>
            }
          </div>

          <!-- Rango custom -->
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
            <span class="font-semibold" id="label-desde">Desde</span>
            <input
              type="date"
              min="2020-01-01"
              [value]="fechaDesde()"
              (change)="onFechaChange('desde', $any($event.target).value)"
              aria-labelledby="label-desde"
              class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-700 focus:border-cyan-400 focus:outline-none"
            />
            <span class="font-semibold" id="label-hasta">Hasta</span>
            <input
              type="date"
              min="2020-01-01"
              [value]="fechaHasta()"
              (change)="onFechaChange('hasta', $any($event.target).value)"
              aria-labelledby="label-hasta"
              class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-700 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <!-- Exportar -->
          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50"
          >
            <span class="material-symbols-outlined text-[15px]">download</span>
            Exportar
          </button>
        </div>
      </section>

      <!-- KPIs del perÃ­odo -->
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        @for (k of data().kpis; track k.label) {
          <article
            class="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm"
            [class]="kpiBorde(k.tono)"
          >
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              [class]="kpiIconClass(k.tono)"
            >
              <span class="material-symbols-outlined text-[20px]">{{ k.icon }}</span>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {{ k.label }}
              </p>
              <p class="mt-0.5 text-xl font-black text-slate-800">{{ k.valor }}</p>
              <p class="text-[11px] text-slate-400">{{ k.subtext }}</p>
            </div>
          </article>
        }
      </div>

      <!-- Resumen operacional por turno -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          <div class="min-w-0">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Resumen operacional por turno
            </h3>
            <p class="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-slate-400">
              <span class="material-symbols-outlined text-[12px]">link</span>
              Turnos vinculados con "Hoy en tiempo real" â€” los cambios se guardan por sitio
            </p>
          </div>
          <button
            type="button"
            (click)="resumenSettingsOpen.update((v) => !v)"
            class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
            [class]="
              resumenSettingsOpen()
                ? 'bg-cyan-100 text-cyan-700'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
            "
            aria-label="Configurar horarios de turno"
            [attr.aria-expanded]="resumenSettingsOpen()"
          >
            <span class="material-symbols-outlined text-[16px]">settings</span>
          </button>
        </div>

        @if (resumenSettingsOpen()) {
          <div class="border-b border-cyan-100 bg-cyan-50/60 p-4">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-[11px] font-black uppercase tracking-[0.12em] text-slate-600">
                Configurar horarios
              </p>
              <div
                class="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-[11px] font-bold"
                role="group"
                aria-label="Cantidad de turnos"
              >
                <button
                  type="button"
                  (click)="numTurnos.set(2)"
                  class="px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0DAFBD]"
                  [class]="
                    numTurnos() === 2
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-500 hover:bg-slate-50'
                  "
                  [attr.aria-pressed]="numTurnos() === 2"
                >
                  2 turnos
                </button>
                <button
                  type="button"
                  (click)="numTurnos.set(3)"
                  class="px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0DAFBD]"
                  [class]="
                    numTurnos() === 3
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-500 hover:bg-slate-50'
                  "
                  [attr.aria-pressed]="numTurnos() === 3"
                >
                  3 turnos
                </button>
              </div>
            </div>
            <div
              class="grid items-center gap-x-2 gap-y-1.5"
              style="grid-template-columns: 8px 1fr 82px 82px"
            >
              <span></span>
              <span class="text-[10px] font-black uppercase tracking-widest text-slate-400"
                >Nombre</span
              >
              <span
                class="text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                >Inicio</span
              >
              <span
                class="text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                >Fin</span
              >
              @for (t of turnosConfig().slice(0, numTurnos()); track t.nombre; let i = $index) {
                <span class="h-2 w-2 rounded-full" [class]="turnoDot(i)"></span>
                <input
                  type="text"
                  [value]="t.nombre"
                  (change)="updateTurnoConfig(i, 'nombre', $any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                />
                <input
                  type="time"
                  [value]="t.inicio"
                  (change)="updateTurnoConfig(i, 'inicio', $any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-[11px] text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                />
                <input
                  type="time"
                  [value]="t.fin"
                  (change)="updateTurnoConfig(i, 'fin', $any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-[11px] text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                />
              }
            </div>
            <button
              type="button"
              (click)="resumenSettingsOpen.set(false)"
              class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700"
            >
              <span class="material-symbols-outlined text-[14px]">check</span>
              Listo
            </button>
          </div>
        }

        <div class="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          @for (t of turnosResumen(); track t.nombre; let i = $index) {
            <div class="rounded-xl border p-4" [class]="turnoResumenCard(i)">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" [class]="turnoDot(i)"></span>
                <p
                  class="text-[10px] font-black uppercase tracking-widest"
                  [class]="turnoResumenLabel(i)"
                >
                  {{ t.nombre }}
                </p>
              </div>
              <p class="mt-0.5 font-mono text-[11px]" [class]="turnoResumenSub(i)">
                {{ t.horario }}
              </p>
              @if (t.flujo > 0) {
                <p class="mt-3 font-mono text-2xl font-black" [class]="turnoResumenValue(i)">
                  {{ t.flujo.toLocaleString('es-CL')
                  }}<span class="ml-1 text-sm font-bold opacity-60">mÂ³</span>
                </p>
                <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                  <div
                    class="h-full rounded-full"
                    [class]="turnoDot(i)"
                    [style.width]="t.pct + '%'"
                  ></div>
                </div>
                <p class="mt-1 text-right font-mono text-[11px]" [class]="turnoResumenSub(i)">
                  {{ t.pct }}% del perÃ­odo
                </p>
              } @else {
                <p class="mt-3 text-sm font-bold opacity-40" [class]="turnoResumenLabel(i)">
                  Sin operaciÃ³n
                </p>
              }
            </div>
          }
        </div>
      </section>

      <!-- GrÃ¡fico de flujo del perÃ­odo -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h3 class="text-sm font-black text-slate-800">Flujo diario en el perÃ­odo</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">mÂ³/dÃ­a Â· dÃ­as sin operaciÃ³n en gris</p>
          </div>
          <span class="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-700">{{
            periodoLabel()
          }}</span>
        </div>
        <div class="h-44 w-full">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of chart().yTicks; track t.y) {
              <line
                x1="55"
                [attr.y1]="t.y"
                x2="1090"
                [attr.y2]="t.y"
                stroke="#f1f5f9"
                stroke-width="1"
              />
              <text
                x="50"
                [attr.y]="t.y + 4"
                font-size="11"
                fill="#94a3b8"
                text-anchor="end"
                font-family="monospace"
              >
                {{ t.label }}
              </text>
            }
            @for (l of chart().xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                {{ l.label }}
              </text>
            }
            @for (b of chart().bars; track b.x) {
              <rect
                [attr.x]="b.x"
                [attr.y]="b.y"
                [attr.width]="b.w"
                [attr.height]="b.h"
                [attr.fill]="b.fill"
                rx="2"
                opacity="0.85"
              />
            }
          </svg>
        </div>
      </section>

      <!-- Tabla resumen diario -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Resumen diario â€” Ãºltimos 7 dÃ­as del perÃ­odo
          </h3>
          <button
            type="button"
            aria-label="Descargar resumen diario en CSV"
            class="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          >
            <span class="material-symbols-outlined text-[13px]" aria-hidden="true">download</span
            >.CSV
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50/60">
                <th
                  class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Fecha
                </th>
                <th
                  class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right"
                >
                  Flujo (mÂ³)
                </th>
                <th
                  class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right"
                >
                  Caudal prom.
                </th>
                <th
                  class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right"
                >
                  Nivel freat.
                </th>
                <th
                  class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right"
                >
                  Alertas
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (fila of data().tabla; track fila.fecha) {
                <tr class="hover:bg-slate-50/60" [class.opacity-50]="fila.flujo === 0">
                  <td class="px-4 py-2.5 font-mono text-[12px] font-bold text-slate-600">
                    {{ fila.fecha }}
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-[12px] text-slate-700">
                    @if (fila.flujo > 0) {
                      {{ fila.flujo }}
                    } @else {
                      <span class="text-slate-300">â€”</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-[12px] text-slate-700">
                    @if (fila.caudalProm > 0) {
                      {{ fila.caudalProm }} L/s
                    } @else {
                      <span class="text-slate-300">â€”</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-[12px] text-slate-700">
                    {{ fila.nivel }} m
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    @if (fila.alertas > 0) {
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700"
                      >
                        {{ fila.alertas }}
                      </span>
                    } @else {
                      <span class="font-mono text-[12px] text-slate-300">â€”</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="border-t border-slate-100 px-4 py-2.5">
          <p class="text-[11px] text-slate-400">
            Los datos son provisorios hasta confirmar sincronizaciÃ³n con DGA.
          </p>
        </div>
      </section>

      <!-- Alertas en el perÃ­odo -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Alertas en el perÃ­odo
          </h3>
          <!-- Resumen por severidad -->
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-black text-rose-700 ring-1 ring-rose-200"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
              {{ data().alertasResumen.criticas }} crÃ­tica{{
                data().alertasResumen.criticas !== 1 ? 's' : ''
              }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-black text-amber-700 ring-1 ring-amber-200"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
              {{ data().alertasResumen.advertencias }} advertencia{{
                data().alertasResumen.advertencias !== 1 ? 's' : ''
              }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600 ring-1 ring-slate-200"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
              {{ data().alertasResumen.info }} informativa{{
                data().alertasResumen.info !== 1 ? 's' : ''
              }}
            </span>
          </div>
        </div>

        @if (data().alertas.length === 0) {
          <div class="flex flex-col items-center gap-2 py-10 text-center">
            <span class="material-symbols-outlined text-[36px] text-emerald-300">check_circle</span>
            <p class="text-[13px] font-bold text-slate-400">
              Sin alertas en el perÃ­odo seleccionado
            </p>
          </div>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (alerta of data().alertas; track alerta.id) {
              <li class="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60">
                <!-- Icono severidad -->
                <span
                  class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  [class]="alertaIconClass(alerta.severidad)"
                >
                  <span class="material-symbols-outlined text-[15px]">{{
                    alertaIcon(alerta.severidad)
                  }}</span>
                </span>
                <!-- Contenido -->
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-bold text-slate-700">{{ alerta.titulo }}</p>
                  <p class="mt-0.5 font-mono text-[10px] text-slate-400">{{ alerta.fechaHora }}</p>
                </div>
                <!-- Estado -->
                <span
                  class="mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                  [class]="alertaEstadoClass(alerta.estado)"
                >
                  {{ alerta.estado === 'resuelta' ? 'Resuelta' : 'Activa' }}
                </span>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Incidencias en el perÃ­odo -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Incidencias en el perÃ­odo
          </h3>
          <span class="font-mono text-[11px] text-slate-400"
            >{{ data().incidencias.length }} registro{{
              data().incidencias.length !== 1 ? 's' : ''
            }}</span
          >
        </div>

        @if (data().incidencias.length === 0) {
          <div class="flex flex-col items-center gap-2 py-10 text-center">
            <span class="material-symbols-outlined text-[36px] text-emerald-300">handyman</span>
            <p class="text-[13px] font-bold text-slate-400">
              Sin incidencias registradas en el perÃ­odo
            </p>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr class="border-b border-slate-100 bg-slate-50/60">
                  <th
                    class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    Fecha
                  </th>
                  <th
                    class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    DescripciÃ³n
                  </th>
                  <th
                    class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    CategorÃ­a
                  </th>
                  <th
                    class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    Estado
                  </th>
                  <th
                    class="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    TÃ©cnico
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (inc of data().incidencias; track inc.fecha + inc.descripcion) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-4 py-2.5 font-mono text-[11px] font-bold text-slate-500">
                      {{ inc.fecha }}
                    </td>
                    <td class="px-4 py-2.5 text-[12px] text-slate-700">{{ inc.descripcion }}</td>
                    <td class="px-4 py-2.5">
                      <span
                        class="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600"
                        >{{ inc.categoria }}</span
                      >
                    </td>
                    <td class="px-4 py-2.5">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                        [class]="incEstadoClass(inc.estado)"
                      >
                        <span
                          class="h-1.5 w-1.5 rounded-full"
                          [class]="incEstadoDot(inc.estado)"
                        ></span>
                        {{ incEstadoLabel(inc.estado) }}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-[12px] text-slate-500">{{ inc.tecnico }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class OperacionResumenPeriodoComponent implements OnInit {
  private readonly state = inject(WaterOperacionStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly alertaService = inject(AlertaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly preset = this.state.preset;
  readonly fechaDesde = this.state.fechaDesde;
  readonly fechaHasta = this.state.fechaHasta;
  readonly numTurnos = this.state.numTurnos;
  readonly turnosConfig = this.state.turnosConfig;
  readonly resumenSettingsOpen = signal(false);

  // Eventos reales del periodo (mapeados a AlertaPeriodo para el render existente).
  private readonly eventosReales = signal<EventoRow[]>([]);
  readonly eventosLoading = signal(false);
  // toObservable solo se permite en contexto de inyeccion â†’ captura en field init.
  private readonly fechaDesde$ = toObservable(this.fechaDesde);
  private readonly fechaHasta$ = toObservable(this.fechaHasta);

  readonly presets: { key: Preset; label: string }[] = [
    { key: '7d', label: '7 dÃ­as' },
    { key: '30d', label: '30 dÃ­as' },
    { key: '90d', label: '90 dÃ­as' },
  ];

  private readonly mockTurnoFlujo: Record<Preset, (number | null)[]> = {
    '7d': [674, 509, null],
    '30d': [2804, 2116, null],
    '90d': [8505, 6416, null],
  };
  private readonly mockTurnoPct = [57, 43, 0];
  private readonly dotClasses = ['bg-cyan-500', 'bg-emerald-500', 'bg-slate-400'];

  readonly turnosResumen = computed(() => {
    const cfg = this.turnosConfig().slice(0, this.numTurnos());
    const flujos = this.mockTurnoFlujo[this.preset()];
    return cfg.map((c, i) => ({
      nombre: c.nombre,
      horario: `${c.inicio} â€“ ${c.fin}`,
      flujo: flujos[i] ?? 0,
      pct: flujos[i] ? (this.mockTurnoPct[i] ?? 0) : 0,
    }));
  });

  updateTurnoConfig(index: number, field: 'nombre' | 'inicio' | 'fin', value: string): void {
    this.state.updateTurnoConfig(index, field, value);
  }

  turnoDot(i: number): string {
    return this.dotClasses[i] ?? 'bg-slate-400';
  }

  turnoResumenCard(i: number): string {
    const cards = [
      'border-cyan-200 bg-gradient-to-br from-cyan-50 to-white',
      'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white',
      'border-slate-200 bg-slate-50',
    ];
    return cards[i] ?? 'border-slate-200 bg-slate-50';
  }

  turnoResumenLabel(i: number): string {
    return (
      (['text-cyan-700', 'text-emerald-700', 'text-slate-500'] as const)[i] ?? 'text-slate-500'
    );
  }

  turnoResumenSub(i: number): string {
    return (
      (['text-cyan-500/70', 'text-emerald-500/70', 'text-slate-400'] as const)[i] ??
      'text-slate-400'
    );
  }

  turnoResumenValue(i: number): string {
    return (
      (['text-cyan-700', 'text-emerald-700', 'text-slate-700'] as const)[i] ?? 'text-slate-700'
    );
  }

  // SVG drawing area
  private readonly DX = 55;
  private readonly DY = 15;
  private readonly DW = 1035;
  private readonly DH = 170;

  private readonly mockKpis: Record<Preset, KpiPeriodo[]> = {
    '7d': [
      {
        label: 'Flujo acumulado',
        valor: '1,183 mÂ³',
        subtext: 'Ãšltimos 7 dÃ­as',
        icon: 'water_drop',
        tono: 'ok',
      },
      {
        label: 'Caudal promedio',
        valor: '3.1 L/s',
        subtext: 'PerÃ­odo activo',
        icon: 'speed',
        tono: 'ok',
      },
      {
        label: 'Nivel freÃ¡tico prom.',
        valor: '32.4 m',
        subtext: 'Profundidad media',
        icon: 'vertical_align_bottom',
        tono: 'neutral',
      },
      {
        label: 'DÃ­as con operaciÃ³n',
        valor: '5 / 7',
        subtext: '2 dÃ­as sin bomba',
        icon: 'event_available',
        tono: 'neutral',
      },
      {
        label: 'Alertas en perÃ­odo',
        valor: '1',
        subtext: '0 crÃ­ticas',
        icon: 'notifications',
        tono: 'ok',
      },
      {
        label: 'Uptime comunicaciÃ³n',
        valor: '99.8%',
        subtext: '~29 min offline',
        icon: 'wifi',
        tono: 'ok',
      },
    ],
    '30d': [
      {
        label: 'Flujo acumulado',
        valor: '4,920 mÂ³',
        subtext: 'Ãšltimos 30 dÃ­as',
        icon: 'water_drop',
        tono: 'ok',
      },
      {
        label: 'Caudal promedio',
        valor: '3.1 L/s',
        subtext: 'PerÃ­odo activo',
        icon: 'speed',
        tono: 'ok',
      },
      {
        label: 'Nivel freÃ¡tico prom.',
        valor: '32.4 m',
        subtext: 'Profundidad media',
        icon: 'vertical_align_bottom',
        tono: 'neutral',
      },
      {
        label: 'DÃ­as con operaciÃ³n',
        valor: '22 / 30',
        subtext: '8 dÃ­as sin bomba',
        icon: 'event_available',
        tono: 'neutral',
      },
      {
        label: 'Alertas en perÃ­odo',
        valor: '4',
        subtext: '1 crÃ­tica',
        icon: 'notifications',
        tono: 'warn',
      },
      {
        label: 'Uptime comunicaciÃ³n',
        valor: '99.1%',
        subtext: '~4 h 05 min offline',
        icon: 'wifi',
        tono: 'ok',
      },
    ],
    '90d': [
      {
        label: 'Flujo acumulado',
        valor: '14,921 mÂ³',
        subtext: 'Ãšltimos 90 dÃ­as',
        icon: 'water_drop',
        tono: 'ok',
      },
      {
        label: 'Caudal promedio',
        valor: '3.0 L/s',
        subtext: 'PerÃ­odo activo',
        icon: 'speed',
        tono: 'ok',
      },
      {
        label: 'Nivel freÃ¡tico prom.',
        valor: '32.5 m',
        subtext: 'Profundidad media',
        icon: 'vertical_align_bottom',
        tono: 'neutral',
      },
      {
        label: 'DÃ­as con operaciÃ³n',
        valor: '66 / 90',
        subtext: '24 dÃ­as sin bomba',
        icon: 'event_available',
        tono: 'neutral',
      },
      {
        label: 'Alertas en perÃ­odo',
        valor: '8',
        subtext: '2 crÃ­ticas',
        icon: 'notifications',
        tono: 'warn',
      },
      {
        label: 'Uptime comunicaciÃ³n',
        valor: '98.7%',
        subtext: '~28 h offline',
        icon: 'wifi',
        tono: 'warn',
      },
    ],
  };

  private readonly tablaComun: FilaDiaria[] = [
    { fecha: '10/05', flujo: 169, caudalProm: 3.1, nivel: 32.4, alertas: 0 },
    { fecha: '09/05', flujo: 172, caudalProm: 3.1, nivel: 32.3, alertas: 0 },
    { fecha: '08/05', flujo: 168, caudalProm: 3.0, nivel: 32.5, alertas: 1 },
    { fecha: '07/05', flujo: 0, caudalProm: 0, nivel: 32.4, alertas: 0 },
    { fecha: '06/05', flujo: 175, caudalProm: 3.2, nivel: 32.4, alertas: 0 },
    { fecha: '05/05', flujo: 171, caudalProm: 3.1, nivel: 32.6, alertas: 0 },
    { fecha: '04/05', flujo: 0, caudalProm: 0, nivel: 32.5, alertas: 0 },
  ];

  private readonly barData: Record<Preset, { vals: number[]; labels: string[]; step: number }> = {
    '7d': {
      vals: [0, 171, 175, 0, 168, 172, 169],
      labels: ['04/05', '05/05', '06/05', '07/05', '08/05', '09/05', '10/05'],
      step: 1,
    },
    '30d': {
      vals: [
        172, 168, 175, 0, 163, 171, 174, 169, 177, 165, 0, 178, 172, 166, 175, 168, 0, 171, 174,
        165, 172, 169, 0, 179, 171, 168, 175, 172, 0, 169,
      ],
      labels: [
        '11/04',
        '12/04',
        '13/04',
        '14/04',
        '15/04',
        '16/04',
        '17/04',
        '18/04',
        '19/04',
        '20/04',
        '21/04',
        '22/04',
        '23/04',
        '24/04',
        '25/04',
        '26/04',
        '27/04',
        '28/04',
        '29/04',
        '30/04',
        '01/05',
        '02/05',
        '03/05',
        '04/05',
        '05/05',
        '06/05',
        '07/05',
        '08/05',
        '09/05',
        '10/05',
      ],
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

  private readonly mockAlertas: Record<Preset, AlertaPeriodo[]> = {
    '7d': [
      {
        id: 1,
        fechaHora: '08/05/2026 14:22',
        titulo: 'Caudal por debajo del umbral mÃ­nimo (2.5 L/s)',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
    ],
    '30d': [
      {
        id: 1,
        fechaHora: '08/05/2026 14:22',
        titulo: 'Caudal por debajo del umbral mÃ­nimo (2.5 L/s)',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
      {
        id: 2,
        fechaHora: '28/04/2026 03:47',
        titulo: 'PÃ©rdida de comunicaciÃ³n con sensor (>15 min)',
        severidad: 'critica',
        estado: 'resuelta',
      },
      {
        id: 3,
        fechaHora: '21/04/2026 09:10',
        titulo: 'Nivel freÃ¡tico superÃ³ lÃ­mite de alerta (34 m)',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
      {
        id: 4,
        fechaHora: '14/04/2026 16:55',
        titulo: 'SincronizaciÃ³n DGA demorada >2 horas',
        severidad: 'info',
        estado: 'resuelta',
      },
    ],
    '90d': [
      {
        id: 1,
        fechaHora: '08/05/2026 14:22',
        titulo: 'Caudal por debajo del umbral mÃ­nimo (2.5 L/s)',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
      {
        id: 2,
        fechaHora: '28/04/2026 03:47',
        titulo: 'PÃ©rdida de comunicaciÃ³n con sensor (>15 min)',
        severidad: 'critica',
        estado: 'resuelta',
      },
      {
        id: 3,
        fechaHora: '21/04/2026 09:10',
        titulo: 'Nivel freÃ¡tico superÃ³ lÃ­mite de alerta (34 m)',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
      {
        id: 4,
        fechaHora: '14/04/2026 16:55',
        titulo: 'SincronizaciÃ³n DGA demorada >2 horas',
        severidad: 'info',
        estado: 'resuelta',
      },
      {
        id: 5,
        fechaHora: '02/04/2026 11:30',
        titulo: 'Caudal cero por 4 horas consecutivas',
        severidad: 'critica',
        estado: 'resuelta',
      },
      {
        id: 6,
        fechaHora: '18/03/2026 07:15',
        titulo: 'VariaciÃ³n brusca de nivel freÃ¡tico (+3.2 m)',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
      {
        id: 7,
        fechaHora: '05/03/2026 20:40',
        titulo: 'Temperatura del equipo fuera de rango',
        severidad: 'advertencia',
        estado: 'resuelta',
      },
      {
        id: 8,
        fechaHora: '24/02/2026 13:08',
        titulo: 'SincronizaciÃ³n DGA demorada >2 horas',
        severidad: 'info',
        estado: 'resuelta',
      },
    ],
  };

  private readonly mockIncidencias: Record<Preset, IncidenciaPeriodo[]> = {
    '7d': [],
    '30d': [
      {
        fecha: '28/04/2026',
        descripcion: 'Restablecimiento de comunicaciÃ³n tras corte elÃ©ctrico en sala de equipos',
        categoria: 'ComunicaciÃ³n',
        estado: 'resuelta',
        tecnico: 'J. PÃ©rez',
      },
    ],
    '90d': [
      {
        fecha: '28/04/2026',
        descripcion: 'Restablecimiento de comunicaciÃ³n tras corte elÃ©ctrico en sala de equipos',
        categoria: 'ComunicaciÃ³n',
        estado: 'resuelta',
        tecnico: 'J. PÃ©rez',
      },
      {
        fecha: '02/04/2026',
        descripcion: 'RevisiÃ³n y limpieza de sensor de caudal â€” lectura en cero por obstrucciÃ³n',
        categoria: 'Sensor',
        estado: 'resuelta',
        tecnico: 'M. GarcÃ­a',
      },
      {
        fecha: '05/03/2026',
        descripcion: 'Reemplazo de ventilador en gabinete â€” temperatura superÃ³ 60Â°C',
        categoria: 'Hardware',
        estado: 'resuelta',
        tecnico: 'J. PÃ©rez',
      },
    ],
  };

  // â”€â”€ KPIs reales (4 wireados) + 2 mock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Filtra daily counters al rango [fechaDesde, fechaHasta] inclusivo (DB
   * guarda dia como YYYY-MM-DD asi que comparacion lexicografica funciona).
   */
  private readonly dailyInRange = computed(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    return this.state
      .dailyCountersData()
      .filter((p) => p.dia >= desde && p.dia <= hasta);
  });

  private readonly historyInRange = computed(() => {
    const desdeMs = new Date(`${this.fechaDesde()}T00:00:00-04:00`).getTime();
    const hastaMs = new Date(`${this.fechaHasta()}T23:59:59-04:00`).getTime();
    return this.state.historyRows().filter(
      (r) => r.timestampMs !== null && r.timestampMs >= desdeMs && r.timestampMs <= hastaMs,
    );
  });

  private readonly diasEsperados = computed(() => {
    const map: Record<Preset, number> = { '7d': 7, '30d': 30, '90d': 90 };
    return map[this.preset()];
  });

  private readonly computedKpis = computed<KpiPeriodo[]>(() => {
    const daily = this.dailyInRange();
    const hist = this.historyInRange();
    const diasEsperados = this.diasEsperados();
    const periodoLabel = this.periodoLabel();

    const flujoTotal = daily.reduce((acc, p) => acc + (p.delta ?? 0), 0);
    const diasOperacion = daily.filter((p) => (p.delta ?? 0) > 0).length;
    const diasSinOp = Math.max(0, diasEsperados - diasOperacion);
    const unidad = daily[0]?.unidad ?? 'mÂ³';

    const caudales = hist.map((r) => r.caudal).filter((v): v is number => v !== null);
    const caudalProm = caudales.length
      ? caudales.reduce((a, b) => a + b, 0) / caudales.length
      : null;

    const nivelesFreaticos = hist
      .map((r) => r.nivelFreatico ?? r.nivel)
      .filter((v): v is number => v !== null);
    const nivelProm = nivelesFreaticos.length
      ? nivelesFreaticos.reduce((a, b) => a + b, 0) / nivelesFreaticos.length
      : null;

    const mockAlertas = this.mockKpis[this.preset()][4];
    const mockUptime = this.mockKpis[this.preset()][5];

    return [
      {
        label: 'Flujo acumulado',
        valor: `${this.fmtThousands(flujoTotal)} ${unidad}`,
        subtext: periodoLabel,
        icon: 'water_drop',
        tono: 'ok',
      },
      {
        label: 'Caudal promedio',
        valor: caudalProm !== null ? `${this.fmt(caudalProm, 1)} L/s` : 'â€” L/s',
        subtext: caudales.length ? `${caudales.length} mediciones` : 'Sin datos',
        icon: 'speed',
        tono: caudalProm !== null ? 'ok' : 'neutral',
      },
      {
        label: 'Nivel freÃ¡tico prom.',
        valor: nivelProm !== null ? `${this.fmt(nivelProm, 1)} m` : 'â€” m',
        subtext: nivelesFreaticos.length ? `${nivelesFreaticos.length} mediciones` : 'Sin datos',
        icon: 'vertical_align_bottom',
        tono: 'neutral',
      },
      {
        label: 'DÃ­as con operaciÃ³n',
        valor: `${diasOperacion} / ${diasEsperados}`,
        subtext: diasSinOp ? `${diasSinOp} dÃ­as sin bomba` : 'Sin paradas',
        icon: 'event_available',
        tono: diasSinOp > diasEsperados / 3 ? 'warn' : 'neutral',
      },
      mockAlertas ?? {
        label: 'Alertas en perÃ­odo',
        valor: 'â€”',
        subtext: 'Sin datos',
        icon: 'notifications',
        tono: 'neutral',
      },
      mockUptime ?? {
        label: 'Uptime comunicaciÃ³n',
        valor: 'â€”',
        subtext: 'Sin datos',
        icon: 'wifi',
        tono: 'neutral',
      },
    ];
  });

  private fmt(v: number, decimals: number): string {
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(v);
  }

  private fmtThousands(v: number): string {
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(v));
  }

  /** Map backend severidad (baja|media|alta|critica) â†’ display severidad. */
  private mapSeveridad(s: string): 'critica' | 'advertencia' | 'info' {
    if (s === 'critica') return 'critica';
    if (s === 'alta' || s === 'media') return 'advertencia';
    return 'info';
  }

  private readonly alertasReales = computed<AlertaPeriodo[]>(() =>
    this.eventosReales().map((e) => ({
      id: e.id,
      fechaHora: this.formatChileDateTime(e.triggered_at),
      titulo: e.alerta_nombre || e.mensaje || `Evento ${e.id}`,
      severidad: this.mapSeveridad(e.severidad),
      estado: e.resuelta ? 'resuelta' : 'activa',
    })),
  );

  private formatChileDateTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  }

  readonly data = computed(() => {
    const alertas = this.alertasReales();
    return {
      kpis: this.computedKpis(),
      tabla: this.tablaComun,
      alertas,
      alertasResumen: {
        criticas: alertas.filter((a) => a.severidad === 'critica').length,
        advertencias: alertas.filter((a) => a.severidad === 'advertencia').length,
        info: alertas.filter((a) => a.severidad === 'info').length,
      },
      incidencias: this.mockIncidencias[this.preset()],
    };
  });

  readonly chart = computed((): BarChart => {
    const { vals, labels, step } = this.barData[this.preset()];
    return this.buildBars(vals, labels, step);
  });

  readonly periodoLabel = computed(() => {
    const map: Record<Preset, string> = {
      '7d': 'Ãšltimos 7 dÃ­as',
      '30d': 'Ãšltimos 30 dÃ­as',
      '90d': 'Ãšltimos 90 dÃ­as',
    };
    return map[this.preset()];
  });

  setPreset(p: Preset): void {
    this.state.setPreset(p);
  }

  onFechaChange(campo: 'desde' | 'hasta', val: string): void {
    this.state.onFechaChange(campo, val);
  }

  ngOnInit(): void {
    const siteId = this.resolveSiteId();
    if (!siteId) return;
    combineLatest([this.fechaDesde$, this.fechaHasta$])
      .pipe(
        debounceTime(300),
        switchMap(([desde, hasta]) => {
          this.eventosLoading.set(true);
          // backend espera ISO timestamptz: pasar inicio y fin de dia Chile.
          const desdeIso = `${desde}T00:00:00-04:00`;
          const hastaIso = `${hasta}T23:59:59-04:00`;
          return this.alertaService
            .listarEventos({
              sitio_id: siteId,
              desde: desdeIso,
              hasta: hastaIso,
              limit: 500,
            })
            .pipe(catchError(() => of([] as EventoRow[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        this.eventosLoading.set(false);
        this.eventosReales.set(rows);
      });
  }

  private resolveSiteId(): string {
    let current: ActivatedRoute | null = this.route;
    while (current) {
      const siteId = current.snapshot.paramMap.get('siteId');
      if (siteId) return siteId;
      current = current.parent;
    }
    return '';
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
    return [
      'rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-slate-800 text-white'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  kpiBorde(t: string): string {
    return t === 'warn' ? 'border-amber-200' : 'border-slate-200';
  }

  kpiIconClass(t: string): string {
    return t === 'warn'
      ? 'bg-amber-50 text-amber-600'
      : t === 'ok'
        ? 'bg-cyan-50 text-cyan-600'
        : 'bg-slate-100 text-slate-500';
  }

  alertaIcon(sev: AlertaPeriodo['severidad']): string {
    return sev === 'critica' ? 'error' : sev === 'advertencia' ? 'warning' : 'info';
  }

  alertaIconClass(sev: AlertaPeriodo['severidad']): string {
    return sev === 'critica'
      ? 'bg-rose-50 text-rose-600'
      : sev === 'advertencia'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-slate-100 text-slate-500';
  }

  alertaEstadoClass(estado: AlertaPeriodo['estado']): string {
    return estado === 'resuelta' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
  }

  incEstadoLabel(estado: IncidenciaPeriodo['estado']): string {
    return estado === 'resuelta'
      ? 'Resuelta'
      : estado === 'en_proceso'
        ? 'En proceso'
        : 'Pendiente';
  }

  incEstadoClass(estado: IncidenciaPeriodo['estado']): string {
    return estado === 'resuelta'
      ? 'bg-emerald-50 text-emerald-700'
      : estado === 'en_proceso'
        ? 'bg-cyan-50 text-cyan-700'
        : 'bg-amber-50 text-amber-700';
  }

  incEstadoDot(estado: IncidenciaPeriodo['estado']): string {
    return estado === 'resuelta'
      ? 'bg-emerald-500'
      : estado === 'en_proceso'
        ? 'bg-cyan-500'
        : 'bg-amber-500';
  }
}
