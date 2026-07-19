import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, combineLatest, debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { AlertaService, type EventoRow } from '../../../../services/alerta.service';
import { CompanyService, type ContadorJornadaPoint } from '../../../../services/company.service';
import {
  CATEGORIA_LABELS,
  IncidenciaService,
  type IncidenciaRow,
} from '../../../../services/incidencia.service';
import {
  WaterOperacionStateService,
  type OperacionPreset as Preset,
} from './water-operacion-state';
import { FlujoDiarioChartComponent } from './flujo-diario-chart';

interface KpiPeriodo {
  label: string;
  valor: string;
  subtext: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

interface FilaDiaria {
  /** ISO YYYY-MM-DD para sorting/keying. */
  diaIso: string;
  /** Etiqueta legible (DD/MM/YYYY) para mostrar. */
  fecha: string;
  /** Delta de totalizador del día — flujo m³. null si sin datos. */
  flujo: number | null;
  /** Peak de caudal en el día — L/s. null si sin datos. */
  caudalPeak: number | null;
  /** Promedio de caudal en el día — L/s. null si sin datos. */
  caudalProm: number | null;
  /** Nivel freático más alto en el día — m. null si sin datos. */
  freaticoPeak: number | null;
  /** Cantidad de eventos/alertas disparadas en ese día. */
  alertas: number;
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
  imports: [CommonModule, FlujoDiarioChartComponent],
  template: `
    <div class="space-y-3">
      <!-- Selector de período. Dos sub-componentes en horizontal separados
           por divisor: (1) Atajos rápidos = presets canónicos; (2) Rango
           custom = inputs de fecha + Aplicar. El rango actual aplicado se
           muestra como subtitle bajo los presets para que el operador sepa
           exactamente qué fechas cubre. -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-3">
          <!-- Sub-componente 1: Atajos rápidos -->
          <div class="flex flex-col gap-1">
            <span class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Atajos
            </span>
            <div class="flex items-center gap-1" role="group" aria-label="Presets de período">
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
          </div>

          <!-- Divisor visual entre los dos sub-componentes -->
          <div class="hidden h-12 w-px self-center bg-slate-200 md:block" aria-hidden="true"></div>

          <!-- Sub-componente 2: Rango custom. Los inputs editan signals
               locales (Input); recién al click en Aplicar se propaga al state
               global y se re-dispara la query. Evita 1 fetch por keystroke
               parcial. Si las nuevas fechas no matchean un preset canónico
               (last-N días terminando hoy), preset queda en null y ningún
               botón aparece resaltado. -->
          <div class="flex flex-col gap-1">
            <span class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Rango personalizado
            </span>
            <div class="flex flex-wrap items-center gap-2 text-caption text-slate-500">
              <span class="font-semibold" id="label-desde">Desde</span>
              <input
                type="date"
                min="2020-01-01"
                [value]="fechaDesdeInput()"
                (input)="fechaDesdeInput.set($any($event.target).value)"
                aria-labelledby="label-desde"
                class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-caption text-slate-700 focus:border-primary-tint-55 focus:outline-none"
              />
              <span class="font-semibold" id="label-hasta">Hasta</span>
              <input
                type="date"
                min="2020-01-01"
                [value]="fechaHastaInput()"
                (input)="fechaHastaInput.set($any($event.target).value)"
                aria-labelledby="label-hasta"
                class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-caption text-slate-700 focus:border-primary-tint-55 focus:outline-none"
              />
              <button
                type="button"
                (click)="aplicarFechas()"
                [disabled]="!fechasPendientes()"
                class="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
                Aplicar
              </button>
            </div>
          </div>

          <!-- Exportar CSV del resumen diario -->
          <button
            type="button"
            (click)="exportarCsv()"
            [disabled]="data().tabla.length === 0"
            class="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-[15px]" aria-hidden="true">download</span>
            Exportar CSV
          </button>
        </div>

        <!-- Subtitle con rango activo: ayuda al operador a entender qué
             fechas exactas cubre el preset/rango seleccionado. -->
        <p class="mt-3 flex items-center gap-1 text-caption-xs font-medium text-slate-500">
          <span class="material-symbols-outlined text-[13px]" aria-hidden="true">date_range</span>
          <span>Rango activo:</span>
          <span class="font-mono font-semibold text-slate-700">{{ rangoLabel() }}</span>
          @if (preset() === null) {
            <span
              class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700"
              >Personalizado</span
            >
          }
        </p>
      </section>

      <!-- KPIs del período: hero destacado + grid de soporte -->
      <div class="grid gap-2 lg:grid-cols-4">
        @if (heroKpi(); as k) {
          <article
            class="flex flex-col justify-between gap-3 rounded-2xl border bg-white p-5 shadow-sm lg:col-span-1"
            [class]="kpiBorde(k.tono)"
          >
            <p class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              {{ k.label }}
            </p>
            <p class="text-[40px] font-bold leading-none tracking-tight text-slate-800">
              {{ heroNum()
              }}<span class="ml-1.5 text-[16px] font-semibold text-slate-400">{{ heroUnidad() }}</span>
            </p>
            <p class="text-caption text-slate-500">{{ k.subtext }}</p>
          </article>
        }
        <div class="grid gap-2 sm:grid-cols-2 lg:col-span-3 xl:grid-cols-4">
          @for (k of restoKpis(); track k.label) {
            <article
              class="flex items-center gap-2.5 rounded-xl border bg-white p-3 shadow-sm"
              [class]="kpiBorde(k.tono)"
            >
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                [class]="kpiIconClass(k.tono)"
              >
                <span class="material-symbols-outlined text-[16px]">{{ k.icon }}</span>
              </span>
              <div class="min-w-0">
                <p
                  class="truncate text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  {{ k.label }}
                </p>
                <p class="mt-0.5 text-body-sm font-semibold text-slate-800">{{ k.valor }}</p>
                <p class="truncate text-caption-xs text-slate-500">{{ k.subtext }}</p>
              </div>
            </article>
          }
        </div>
      </div>

      <!-- Resumen operacional por turno -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          <div class="min-w-0">
            <h3 class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Resumen operacional por turno
            </h3>
            <p class="mt-0.5 flex items-center gap-1 text-caption-xs font-medium text-slate-500">
              <span class="material-symbols-outlined text-[12px]" aria-hidden="true">link</span>
              Turnos vinculados con "Hoy en tiempo real" — los cambios se guardan por sitio
            </p>
          </div>
          <button
            type="button"
            (click)="resumenSettingsOpen.update((v) => !v)"
            class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            [class]="
              resumenSettingsOpen()
                ? 'bg-primary-tint-14 text-primary-container'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
            "
            aria-label="Configurar horarios de turno"
            [attr.aria-expanded]="resumenSettingsOpen()"
          >
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">settings</span>
          </button>
        </div>

        @if (resumenSettingsOpen()) {
          <div class="border-b border-primary-tint-15 bg-primary-tint-08 p-4">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-caption-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                Configurar horarios
              </p>
              <div
                class="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-caption-xs font-bold"
                role="group"
                aria-label="Cantidad de turnos"
              >
                <button
                  type="button"
                  (click)="numTurnos.set(2)"
                  class="px-3 py-1.5 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  [class]="
                    numTurnos() === 2 ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50'
                  "
                  [attr.aria-pressed]="numTurnos() === 2"
                >
                  2 turnos
                </button>
                <button
                  type="button"
                  (click)="numTurnos.set(3)"
                  class="px-3 py-1.5 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  [class]="
                    numTurnos() === 3 ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50'
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
              <span class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Nombre</span
              >
              <span
                class="text-center text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Inicio</span
              >
              <span
                class="text-center text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Fin</span
              >
              @for (t of turnosConfig().slice(0, numTurnos()); track t.nombre; let i = $index) {
                <span class="h-2 w-2 rounded-full" [class]="turnoDot(i)"></span>
                <input
                  type="text"
                  [value]="t.nombre"
                  (change)="updateTurnoConfig(i, 'nombre', $any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-3 text-caption font-semibold text-slate-700 outline-none focus:border-primary-tint-55 focus:ring-1 focus:ring-primary-tint-20"
                />
                <input
                  type="time"
                  [value]="t.inicio"
                  (change)="updateTurnoConfig(i, 'inicio', $any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-caption-xs text-slate-700 outline-none focus:border-primary-tint-55 focus:ring-1 focus:ring-primary-tint-20"
                />
                <input
                  type="time"
                  [value]="t.fin"
                  (change)="updateTurnoConfig(i, 'fin', $any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-caption-xs text-slate-700 outline-none focus:border-primary-tint-55 focus:ring-1 focus:ring-primary-tint-20"
                />
              }
            </div>
            <button
              type="button"
              (click)="resumenSettingsOpen.set(false)"
              class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-95"
            >
              <span class="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
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
                  class="text-caption-xs font-semibold uppercase tracking-widest"
                  [class]="turnoResumenLabel(i)"
                >
                  {{ t.nombre }}
                </p>
              </div>
              <p class="mt-0.5 font-mono text-caption-xs" [class]="turnoResumenSub(i)">
                {{ t.horario }}
              </p>
              @if (t.flujo > 0) {
                <p class="mt-3 font-mono text-h4 font-semibold" [class]="turnoResumenValue(i)">
                  {{ t.flujo.toLocaleString('es-CL')
                  }}<span class="ml-1 text-body-sm font-bold opacity-60">m³</span>
                </p>
                <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/10">
                  <div
                    class="h-full rounded-full"
                    [class]="turnoDot(i)"
                    [style.width]="t.pct + '%'"
                  ></div>
                </div>
                <p class="mt-1 text-right font-mono text-caption-xs" [class]="turnoResumenSub(i)">
                  {{ t.pct }}% del período
                </p>
              } @else {
                <p class="mt-3 text-body-sm font-bold opacity-40" [class]="turnoResumenLabel(i)">
                  Sin operación
                </p>
              }
            </div>
          }
        </div>
      </section>

      <!-- Gráfico de flujo del período (Chart.js) -->
      <app-flujo-diario-chart [points]="dailyChartPoints()" [periodoLabel]="periodoLabel()" />

      <!-- Tabla resumen diario: una fila por día calendario en el rango
           aplicado. Cruza daily counters (flujo) + daily aggregates (peaks)
           + eventos reales (alertas por día). Cap 60 filas para no romper
           UI en rangos grandes — el operador afina fechas para ver detalle. -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"
        >
          <div>
            <h3 class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Resumen diario
            </h3>
            <p class="mt-0.5 text-caption-xs text-slate-500">
              {{ data().tabla.length }} días · {{ periodoLabel() }}
              @if (dailyAggregatesLoading()) {
                · <span class="text-primary-container">cargando…</span>
              }
            </p>
          </div>
          <button
            type="button"
            (click)="tablaDiariaOpen.update((v) => !v)"
            [attr.aria-expanded]="tablaDiariaOpen()"
            class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {{ tablaDiariaOpen() ? 'Ocultar detalle' : 'Ver detalle diario' }}
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{
              tablaDiariaOpen() ? 'expand_less' : 'expand_more'
            }}</span>
          </button>
        </div>
        @if (tablaDiariaOpen()) {
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-body-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50/60">
                <th
                  class="px-4 py-2.5 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Fecha
                </th>
                <th
                  class="px-4 py-2.5 text-right text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Flujo (m³)
                </th>
                <th
                  class="px-4 py-2.5 text-right text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Caudal peak
                </th>
                <th
                  class="px-4 py-2.5 text-right text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Caudal prom.
                </th>
                <th
                  class="px-4 py-2.5 text-right text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Freático max
                </th>
                <th
                  class="px-4 py-2.5 text-right text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Alertas
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (fila of data().tabla; track fila.diaIso) {
                <tr class="hover:bg-slate-50/60" [class.opacity-60]="(fila.flujo ?? 0) === 0">
                  <td class="px-4 py-2.5 font-mono text-caption font-bold text-slate-600">
                    {{ fila.fecha }}
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-caption text-slate-700">
                    @if (fila.flujo !== null && fila.flujo > 0) {
                      {{ formatNumber(fila.flujo, 1) }}
                    } @else {
                      <span class="text-slate-300">—</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-caption text-slate-700">
                    @if (fila.caudalPeak !== null) {
                      {{ formatNumber(fila.caudalPeak, 1) }} L/s
                    } @else {
                      <span class="text-slate-300">—</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-caption text-slate-700">
                    @if (fila.caudalProm !== null) {
                      {{ formatNumber(fila.caudalProm, 1) }} L/s
                    } @else {
                      <span class="text-slate-300">—</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono text-caption text-slate-700">
                    @if (fila.freaticoPeak !== null) {
                      {{ formatNumber(fila.freaticoPeak, 2) }} m
                    } @else {
                      <span class="text-slate-300">—</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    @if (fila.alertas > 0) {
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-caption-xs font-semibold text-amber-700"
                      >
                        {{ fila.alertas }}
                      </span>
                    } @else {
                      <span class="font-mono text-caption text-slate-300">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="border-t border-slate-100 px-4 py-2.5">
          <p class="text-caption-xs text-slate-500">
            Los datos son provisorios hasta confirmar sincronización con DGA.
          </p>
        </div>
        }
      </section>

      <!-- Detalle: Alertas + Incidencias en tabs -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <!-- Tabs: Alertas | Incidencias -->
        <div
          class="flex items-center gap-1 border-b border-slate-100 bg-slate-50 px-2 py-2"
          role="tablist"
          aria-label="Detalle del período"
        >
          <button
            type="button"
            role="tab"
            (click)="detalleTab.set('alertas')"
            [attr.aria-selected]="detalleTab() === 'alertas'"
            [class]="
              detalleTab() === 'alertas'
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-caption-xs font-bold text-slate-800 shadow-sm transition active:scale-95'
                : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption-xs font-bold text-slate-500 transition hover:text-slate-700 active:scale-95'
            "
          >
            Alertas
            <span class="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">{{
              data().alertas.length
            }}</span>
          </button>
          <button
            type="button"
            role="tab"
            (click)="detalleTab.set('incidencias')"
            [attr.aria-selected]="detalleTab() === 'incidencias'"
            [class]="
              detalleTab() === 'incidencias'
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-caption-xs font-bold text-slate-800 shadow-sm transition active:scale-95'
                : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption-xs font-bold text-slate-500 transition hover:text-slate-700 active:scale-95'
            "
          >
            Incidencias
            <span class="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">{{
              data().incidencias.length
            }}</span>
          </button>
        </div>

        @if (detalleTab() === 'alertas') {
          <!-- Resumen por severidad -->
          <div class="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-caption-xs font-semibold text-rose-700 ring-1 ring-rose-200"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
              {{ data().alertasResumen.criticas }} crítica{{
                data().alertasResumen.criticas !== 1 ? 's' : ''
              }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-caption-xs font-semibold text-amber-700 ring-1 ring-amber-200"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
              {{ data().alertasResumen.advertencias }} advertencia{{
                data().alertasResumen.advertencias !== 1 ? 's' : ''
              }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-caption-xs font-semibold text-slate-600 ring-1 ring-slate-200"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
              {{ data().alertasResumen.info }} informativa{{
                data().alertasResumen.info !== 1 ? 's' : ''
              }}
            </span>
          </div>

          @if (data().alertas.length === 0) {
          <div class="flex flex-col items-center gap-2 py-10 text-center">
            <span class="material-symbols-outlined text-[36px] text-emerald-300">check_circle</span>
            <p class="text-body-sm font-bold text-slate-500">
              Sin alertas en el período seleccionado
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
                  <p class="text-body-sm font-bold text-slate-700">{{ alerta.titulo }}</p>
                  <p class="mt-0.5 font-mono text-caption-xs text-slate-500">
                    {{ alerta.fechaHora }}
                  </p>
                </div>
                <!-- Estado -->
                <span
                  class="mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-caption-xs font-semibold"
                  [class]="alertaEstadoClass(alerta.estado)"
                >
                  {{ alerta.estado === 'resuelta' ? 'Resuelta' : 'Activa' }}
                </span>
              </li>
            }
          </ul>
          }
        } @else {
          @if (data().incidencias.length === 0) {
          <div class="flex flex-col items-center gap-2 py-10 text-center">
            <span class="material-symbols-outlined text-[36px] text-emerald-300">handyman</span>
            <p class="text-body-sm font-bold text-slate-500">
              Sin incidencias registradas en el período
            </p>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full min-w-[620px] text-left text-body-sm">
              <thead>
                <tr class="border-b border-slate-100 bg-slate-50/60">
                  <th
                    class="px-4 py-2.5 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Fecha
                  </th>
                  <th
                    class="px-4 py-2.5 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Descripción
                  </th>
                  <th
                    class="px-4 py-2.5 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Categoría
                  </th>
                  <th
                    class="px-4 py-2.5 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Estado
                  </th>
                  <th
                    class="px-4 py-2.5 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Técnico
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (inc of data().incidencias; track inc.fecha + inc.descripcion) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-4 py-2.5 font-mono text-caption-xs font-bold text-slate-500">
                      {{ inc.fecha }}
                    </td>
                    <td class="px-4 py-2.5 text-caption text-slate-700">{{ inc.descripcion }}</td>
                    <td class="px-4 py-2.5">
                      <span
                        class="rounded-md bg-slate-100 px-2 py-0.5 text-caption-xs font-bold text-slate-600"
                        >{{ inc.categoria }}</span
                      >
                    </td>
                    <td class="px-4 py-2.5">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption-xs font-semibold"
                        [class]="incEstadoClass(inc.estado)"
                      >
                        <span
                          class="h-1.5 w-1.5 rounded-full"
                          [class]="incEstadoDot(inc.estado)"
                        ></span>
                        {{ incEstadoLabel(inc.estado) }}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-caption text-slate-500">{{ inc.tecnico }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          }
        }
      </section>
    </div>
  `,
})
export class OperacionResumenPeriodoComponent implements OnInit {
  private readonly state = inject(WaterOperacionStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly alertaService = inject(AlertaService);
  private readonly companyService = inject(CompanyService);
  private readonly incidenciaService = inject(IncidenciaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly preset = this.state.preset;
  readonly fechaDesde = this.state.fechaDesde;
  readonly fechaHasta = this.state.fechaHasta;
  readonly numTurnos = this.state.numTurnos;
  readonly turnosConfig = this.state.turnosConfig;
  readonly resumenSettingsOpen = signal(false);

  // ── Estado del replanteo (resumen ejecutivo + drill-down) ──
  /** KPI destacado (hero) = primero de la lista; el resto va al grid de soporte. */
  readonly heroKpi = computed(() => this.data().kpis[0] ?? null);
  readonly restoKpis = computed(() => this.data().kpis.slice(1));
  /** Hero: número y unidad separados para renderizar la unidad más chica. */
  readonly heroNum = computed(() => {
    const v = this.heroKpi()?.valor ?? '';
    const i = v.lastIndexOf(' ');
    return i > 0 ? v.slice(0, i) : v;
  });
  readonly heroUnidad = computed(() => {
    const v = this.heroKpi()?.valor ?? '';
    const i = v.lastIndexOf(' ');
    return i > 0 ? v.slice(i + 1) : '';
  });
  /** Tabla diaria como drill-down colapsable bajo el gráfico. */
  readonly tablaDiariaOpen = signal(false);
  /** Tabs de detalle: alertas | incidencias (antes eran 2 secciones apiladas). */
  readonly detalleTab = signal<'alertas' | 'incidencias'>('alertas');

  // Input signals locales: el operador edita estos sin disparar fetches hasta
  // que clickea Aplicar. Inicializados desde el state actual y resincronizados
  // cuando los presets cambian.
  readonly fechaDesdeInput = signal(this.state.fechaDesde());
  readonly fechaHastaInput = signal(this.state.fechaHasta());
  readonly fechasPendientes = computed(
    () =>
      this.fechaDesdeInput() !== this.fechaDesde() || this.fechaHastaInput() !== this.fechaHasta(),
  );

  // Eventos reales del periodo (mapeados a AlertaPeriodo para el render existente).
  private readonly eventosReales = signal<EventoRow[]>([]);
  readonly eventosLoading = signal(false);
  // Incidencias reales del periodo. Se mapean luego al shape de
  // IncidenciaPeriodo del template legado.
  private readonly incidenciasRaw = signal<IncidenciaRow[]>([]);
  readonly incidenciasLoading = signal(false);
  // Contadores por turno: cada índice corresponde al turno (0,1,2) y trae
  // delta acumulado en el rango seleccionado. Se rellena con 3 calls
  // paralelas al endpoint `contadores-jornadas` cuando cambia el rango,
  // preset, turnos config o num turnos.
  private readonly turnoCountersData = signal<ContadorJornadaPoint[][]>([[], [], []]);
  readonly turnoCountersLoading = signal(false);
  // Agregados (max, promedio) de caudal/nivel/nivel_freatico para el rango.
  // Lo fetch un endpoint dedicado que lee equipo_5min cagg sobre el rango
  // completo (no limitado a 25h como historyRows). Sin esto, los KPIs de
  // peak solo cubrirían la ventana realtime, no el periodo seleccionado.
  private readonly periodAggregates = signal<{
    caudal: { max: number | null; avg: number | null; n: number; unidad: string | null };
    nivel_freatico: { max: number | null; avg: number | null; n: number; unidad: string | null };
  } | null>(null);
  readonly periodAggregatesLoading = signal(false);
  // Agregados por día (caudal max/avg + nivel_freatico max + count) para
  // poblar la tabla "Resumen diario". Endpoint dedicado lee equipo_5min y
  // agrupa por día Chile en backend → 1 fila por día visible.
  private readonly dailyAggregates = signal<
    {
      dia: string;
      caudal: { max: number | null; avg: number | null; n: number };
      nivel: { max: number | null; avg: number | null; n: number };
      nivel_freatico: { max: number | null; avg: number | null; n: number };
      muestras: number;
    }[]
  >([]);
  readonly dailyAggregatesLoading = signal(false);
  // toObservable solo se permite en contexto de inyeccion → captura en field init.
  private readonly fechaDesde$ = toObservable(this.fechaDesde);
  private readonly fechaHasta$ = toObservable(this.fechaHasta);
  private readonly preset$ = toObservable(this.preset);
  private readonly numTurnos$ = toObservable(this.numTurnos);
  private readonly turnosConfig$ = toObservable(this.turnosConfig);

  readonly presets: { key: Preset; label: string }[] = [
    { key: '7d', label: '7 días' },
    { key: '30d', label: '30 días' },
    { key: '90d', label: '90 días' },
  ];

  private readonly dotClasses = ['bg-primary', 'bg-primary-container', 'bg-slate-400'];

  /**
   * Cards por turno con datos REALES desde `contadores-jornadas`.
   *
   * Suma de deltas por turno en el rango [fechaDesde, fechaHasta] (filtrado
   * client-side porque el endpoint devuelve los últimos `dias` días enteros).
   * % es relativo al total del periodo entre todos los turnos visibles.
   */
  readonly turnosResumen = computed(() => {
    const cfg = this.turnosConfig().slice(0, this.numTurnos());
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const dataByTurno = this.turnoCountersData();

    const flujos = cfg.map((_, i) => {
      const points = dataByTurno[i] ?? [];
      return points
        .filter((p) => p.dia >= desde && p.dia <= hasta)
        .reduce((acc, p) => acc + (p.delta ?? 0), 0);
    });

    const total = flujos.reduce((a, b) => a + b, 0);

    return cfg.map((c, i) => {
      const flujo = flujos[i] ?? 0;
      return {
        nombre: c.nombre,
        horario: `${c.inicio} – ${c.fin}`,
        flujo: Math.round(flujo),
        pct: total > 0 ? Math.round((flujo / total) * 100) : 0,
      };
    });
  });

  updateTurnoConfig(index: number, field: 'nombre' | 'inicio' | 'fin', value: string): void {
    this.state.updateTurnoConfig(index, field, value);
  }

  turnoDot(i: number): string {
    return this.dotClasses[i] ?? 'bg-slate-400';
  }

  turnoResumenCard(i: number): string {
    const cards = [
      'border-primary-tint-25 bg-primary-tint-08',
      'border-emerald-200 bg-emerald-50',
      'border-slate-200 bg-slate-50',
    ];
    return cards[i] ?? 'border-slate-200 bg-slate-50';
  }

  turnoResumenLabel(i: number): string {
    return (
      (['text-primary-container', 'text-emerald-700', 'text-slate-500'] as const)[i] ??
      'text-slate-500'
    );
  }

  turnoResumenSub(i: number): string {
    return (
      (['text-primary/70', 'text-emerald-500/70', 'text-slate-400'] as const)[i] ?? 'text-slate-400'
    );
  }

  turnoResumenValue(i: number): string {
    return (
      (['text-primary-container', 'text-emerald-700', 'text-slate-700'] as const)[i] ??
      'text-slate-700'
    );
  }


  /**
   * Tabla "Resumen diario" — una fila por día calendario en el rango aplicado.
   * Cruza tres fuentes de datos:
   *   - dailyCountersData (state): delta totalizador por día (flujo m³).
   *   - dailyAggregates (local fetch): peak/avg caudal + peak nivel freático.
   *   - eventosReales (alertas service): bucketea por día Chile.
   *
   * Si el rango es grande (>60d) cortamos a últimos 60 días para no saturar
   * el DOM; el operador puede afinar fechas para ver el detalle.
   */
  readonly tablaDiariaReal = computed<FilaDiaria[]>(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    if (!desde || !hasta) return [];

    // Index daily counters por diaIso para lookup O(1).
    const dailyByDia = new Map(this.state.dailyCountersData().map((p) => [p.dia, p]));

    // Index aggregates por diaIso.
    const aggByDia = new Map(this.dailyAggregates().map((d) => [d.dia, d]));

    // Index eventos por diaIso: tomamos triggered_at, convertimos a dayKey
    // Chile y agrupamos.
    const eventosByDia = new Map<string, number>();
    for (const ev of this.eventosReales()) {
      const diaKey = this.chileDayKey(new Date(ev.triggered_at));
      eventosByDia.set(diaKey, (eventosByDia.get(diaKey) ?? 0) + 1);
    }

    // Genera filas calendario-correctas entre desde y hasta (inclusive).
    const filas: FilaDiaria[] = [];
    const desdeMs = new Date(`${desde}T00:00:00-04:00`).getTime();
    const hastaMs = new Date(`${hasta}T00:00:00-04:00`).getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    for (let t = hastaMs; t >= desdeMs; t -= dayMs) {
      const diaIso = new Date(t).toISOString().slice(0, 10);
      const counter = dailyByDia.get(diaIso);
      const agg = aggByDia.get(diaIso);

      filas.push({
        diaIso,
        fecha: this.formatDiaLargo(diaIso),
        flujo: counter?.delta != null ? Number(counter.delta) : null,
        caudalPeak: agg?.caudal.max ?? null,
        caudalProm: agg?.caudal.avg ?? null,
        freaticoPeak: agg?.nivel_freatico.max ?? null,
        alertas: eventosByDia.get(diaIso) ?? 0,
      });
    }

    // Cap a 60 filas para no romper la UI si el rango es enorme.
    return filas.slice(0, 60);
  });

  /**
   * Convierte un timestamp a su dayKey YYYY-MM-DD en zona Chile.
   */
  private chileDayKey(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  // ── KPIs reales (4 wireados) + 2 mock ─────────────────────

  /**
   * Filtra daily counters al rango [fechaDesde, fechaHasta] inclusivo (DB
   * guarda dia como YYYY-MM-DD asi que comparacion lexicografica funciona).
   */
  private readonly dailyInRange = computed(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    return this.state.dailyCountersData().filter((p) => p.dia >= desde && p.dia <= hasta);
  });

  private readonly historyInRange = computed(() => {
    const desdeMs = new Date(`${this.fechaDesde()}T00:00:00-04:00`).getTime();
    const hastaMs = new Date(`${this.fechaHasta()}T23:59:59-04:00`).getTime();
    return this.state
      .historyRows()
      .filter(
        (r) => r.timestampMs !== null && r.timestampMs >= desdeMs && r.timestampMs <= hastaMs,
      );
  });

  /**
   * Días esperados en el rango actualmente aplicado. Sirve como denominador
   * de "uptime" y "días con operación". Calculado a partir de fechaDesde y
   * fechaHasta (inclusive), no del preset — soporta rangos custom.
   */
  private readonly diasEsperados = computed(() => {
    const desde = new Date(`${this.fechaDesde()}T00:00:00-04:00`).getTime();
    const hasta = new Date(`${this.fechaHasta()}T00:00:00-04:00`).getTime();
    const dias = Math.round((hasta - desde) / (24 * 60 * 60 * 1000)) + 1;
    return Math.max(1, dias);
  });

  private readonly computedKpis = computed<KpiPeriodo[]>(() => {
    const daily = this.dailyInRange();
    const hist = this.historyInRange();
    const diasEsperados = this.diasEsperados();
    const periodoLabel = this.periodoLabel();

    const flujoTotal = daily.reduce((acc, p) => acc + (p.delta ?? 0), 0);
    const diasOperacion = daily.filter((p) => (p.delta ?? 0) > 0).length;
    const diasSinOp = Math.max(0, diasEsperados - diasOperacion);
    const unidad = daily[0]?.unidad ?? 'm³';

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

    // Alertas reales: cuenta total de eventos del periodo + breakdown críticas
    // vs advertencias. `eventosReales` viene del endpoint alertas que ya se
    // fetchea en ngOnInit cuando cambia rango.
    const alertas = this.alertasReales();
    const criticas = alertas.filter((a) => a.severidad === 'critica').length;
    const advertencias = alertas.filter((a) => a.severidad === 'advertencia').length;
    const alertasTono: KpiPeriodo['tono'] = criticas > 0 ? 'warn' : 'neutral';

    // Uptime comunicación: días con al menos una muestra dividido sobre días
    // esperados. Aproximación; para precisión a nivel de minuto haría falta
    // contar todas las mediciones esperadas vs recibidas.
    const diasConDatos = daily.filter((p) => p.muestras > 0).length;
    const uptimePct = diasEsperados > 0 ? Math.round((diasConDatos / diasEsperados) * 100) : 0;
    const uptimeTono: KpiPeriodo['tono'] =
      uptimePct >= 95 ? 'ok' : uptimePct >= 80 ? 'neutral' : 'warn';

    // Peaks del periodo desde period-aggregates (cubre rango completo, no
    // limitado a 25h como historyRows). Si endpoint aún no respondió: null.
    const agg = this.periodAggregates();
    const caudalMax = agg?.caudal.max ?? null;
    const caudalMaxUnidad = agg?.caudal.unidad || 'L/s';
    const freaticoMax = agg?.nivel_freatico.max ?? null;
    const freaticoMaxUnidad = agg?.nivel_freatico.unidad || 'm';

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
        valor: caudalProm !== null ? `${this.fmt(caudalProm, 1)} L/s` : '— L/s',
        subtext: caudales.length ? `${caudales.length} mediciones` : 'Sin datos',
        icon: 'speed',
        tono: caudalProm !== null ? 'ok' : 'neutral',
      },
      {
        label: 'Nivel freático prom.',
        valor: nivelProm !== null ? `${this.fmt(nivelProm, 1)} m` : '— m',
        subtext: nivelesFreaticos.length ? `${nivelesFreaticos.length} mediciones` : 'Sin datos',
        icon: 'vertical_align_bottom',
        tono: 'neutral',
      },
      {
        label: 'Días con operación',
        valor: `${diasOperacion} / ${diasEsperados}`,
        subtext: diasSinOp ? `${diasSinOp} días sin bomba` : 'Sin paradas',
        icon: 'event_available',
        tono: diasSinOp > diasEsperados / 3 ? 'warn' : 'neutral',
      },
      {
        label: 'Peak de caudal',
        valor:
          caudalMax !== null
            ? `${this.fmt(caudalMax, 1)} ${caudalMaxUnidad}`
            : `— ${caudalMaxUnidad}`,
        subtext:
          agg && agg.caudal.n > 0
            ? `Sobre ${this.fmtThousands(agg.caudal.n)} mediciones`
            : 'Sin datos en el rango',
        icon: 'trending_up',
        tono: caudalMax !== null ? 'ok' : 'neutral',
      },
      {
        label: 'Nivel freático más alto',
        valor:
          freaticoMax !== null
            ? `${this.fmt(freaticoMax, 2)} ${freaticoMaxUnidad}`
            : `— ${freaticoMaxUnidad}`,
        subtext:
          agg && agg.nivel_freatico.n > 0
            ? `Sobre ${this.fmtThousands(agg.nivel_freatico.n)} mediciones`
            : 'Sin datos en el rango',
        icon: 'water',
        tono: freaticoMax !== null ? 'ok' : 'neutral',
      },
      {
        label: 'Alertas en período',
        valor: String(alertas.length),
        subtext: alertas.length === 0 ? 'Sin eventos' : `${criticas} crít · ${advertencias} adv`,
        icon: 'notifications',
        tono: alertasTono,
      },
      {
        label: 'Uptime comunicación',
        valor: `${uptimePct}%`,
        subtext: `${diasConDatos} / ${diasEsperados} días con datos`,
        icon: 'wifi',
        tono: uptimeTono,
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

  /** Helper público para usar desde el template de la tabla diaria. */
  formatNumber(v: number | null, decimals: number): string {
    if (v === null || !Number.isFinite(v)) return '—';
    return this.fmt(v, decimals);
  }

  /** Map backend severidad (baja|media|alta|critica) → display severidad. */
  private mapSeveridad(s: string): 'critica' | 'advertencia' | 'info' {
    if (s === 'critica') return 'critica';
    if (s === 'alta' || s === 'media') return 'advertencia';
    return 'info';
  }

  /**
   * Mapea las incidencias del backend al shape esperado por el template
   * legado. Estados:
   *   - 'abierta'    → 'pendiente'
   *   - 'en_progreso'→ 'en_proceso'
   *   - 'resuelta'   → 'resuelta'
   *   - 'cerrada'    → 'resuelta' (mostramos como resuelta porque es estado final)
   * Sort: más recientes primero.
   */
  private readonly incidenciasReales = computed<IncidenciaPeriodo[]>(() =>
    [...this.incidenciasRaw()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((i) => ({
        fecha: this.formatChileDateTime(i.created_at),
        descripcion: i.titulo + (i.descripcion ? ` — ${i.descripcion}` : ''),
        categoria: CATEGORIA_LABELS[i.categoria] ?? i.categoria,
        estado:
          i.estado === 'resuelta' || i.estado === 'cerrada'
            ? ('resuelta' as const)
            : i.estado === 'en_progreso'
              ? ('en_proceso' as const)
              : ('pendiente' as const),
        tecnico: i.tecnico_nombre_completo ?? '—',
      })),
  );

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
      tabla: this.tablaDiariaReal(),
      alertas,
      alertasResumen: {
        criticas: alertas.filter((a) => a.severidad === 'critica').length,
        advertencias: alertas.filter((a) => a.severidad === 'advertencia').length,
        info: alertas.filter((a) => a.severidad === 'info').length,
      },
      incidencias: this.incidenciasReales(),
    };
  });

  /** Puntos para el gráfico de flujo diario (Chart.js, sub-componente). Datos reales del rango. */
  readonly dailyChartPoints = computed(() =>
    this.dailyInRange().map((p) => ({ dia: p.dia, delta: p.delta })),
  );

  /**
   * Label corto del rango activo para mostrar al lado de los botones de
   * preset. Sirve para que el operador entienda exactamente qué fechas
   * cubre el preset seleccionado.
   */
  readonly rangoLabel = computed(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    if (!desde || !hasta) return '';
    return `${this.formatDiaLargo(desde)} → ${this.formatDiaLargo(hasta)}`;
  });

  readonly periodoLabel = computed(() => {
    const p = this.preset();
    if (p === '7d') return 'Últimos 7 días';
    if (p === '30d') return 'Últimos 30 días';
    if (p === '90d') return 'Últimos 90 días';
    return 'Rango personalizado';
  });

  /** Exporta el resumen diario del período a CSV (datos reales de la tabla). */
  exportarCsv(): void {
    const filas = this.data().tabla;
    if (filas.length === 0) return;
    const headers = [
      'Fecha',
      'Flujo (m3)',
      'Caudal peak (L/s)',
      'Caudal prom (L/s)',
      'Freatico max (m)',
      'Alertas',
    ];
    const rows = filas.map((f) => [
      f.fecha,
      f.flujo ?? '',
      f.caudalPeak ?? '',
      f.caudalProm ?? '',
      f.freaticoPeak ?? '',
      f.alertas,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumen-periodo-${this.fechaDesde()}_${this.fechaHasta()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  setPreset(p: Preset): void {
    this.state.setPreset(p);
    // El preset reescribe el rango. Sincronizamos los inputs locales para que
    // el botón Aplicar quede desactivado (no hay cambios pendientes).
    this.fechaDesdeInput.set(this.state.fechaDesde());
    this.fechaHastaInput.set(this.state.fechaHasta());
  }

  aplicarFechas(): void {
    const desde = this.fechaDesdeInput();
    const hasta = this.fechaHastaInput();
    if (!desde || !hasta) return;
    // Validación básica: desde no puede ser mayor que hasta.
    if (desde > hasta) return;
    this.state.onFechaChange('desde', desde);
    this.state.onFechaChange('hasta', hasta);
  }

  ngOnInit(): void {
    const siteId = this.resolveSiteId();
    if (!siteId) return;

    // Lazy-trigger contadores: solo se necesitan en esta tab. Idempotente.
    this.state.ensureContadoresPolling(siteId);

    // Sync inputs cuando state cambia desde fuera (ej. preset clic).
    combineLatest([this.fechaDesde$, this.fechaHasta$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([desde, hasta]) => {
        this.fechaDesdeInput.set(desde);
        this.fechaHastaInput.set(hasta);
      });

    // Eventos (alertas) reales del periodo.
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

    // Incidencias reales del sitio en el rango. Endpoint
    // /api/incidencias acepta sitio_id + desde/hasta + limit.
    combineLatest([this.fechaDesde$, this.fechaHasta$])
      .pipe(
        debounceTime(300),
        switchMap(([desde, hasta]) => {
          this.incidenciasLoading.set(true);
          // Backend espera ISO timestamptz: convertimos a inicio/fin día Chile.
          const desdeIso = `${desde}T00:00:00-04:00`;
          const hastaIso = `${hasta}T23:59:59-04:00`;
          return this.incidenciaService
            .listar({ sitio_id: siteId, desde: desdeIso, hasta: hastaIso, limit: 200 })
            .pipe(catchError(() => of([] as IncidenciaRow[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        this.incidenciasLoading.set(false);
        this.incidenciasRaw.set(rows);
      });

    // Daily aggregates: agregados por día Chile en el rango. Llenan la tabla
    // "Resumen diario" con flujo + caudal peak/prom + nivel freático peak +
    // alertas (estas last se cuentan client-side desde eventosReales).
    combineLatest([this.fechaDesde$, this.fechaHasta$])
      .pipe(
        debounceTime(300),
        switchMap(([desde, hasta]) => {
          this.dailyAggregatesLoading.set(true);
          return this.companyService
            .getSitePeriodAggregatesDaily(siteId, desde, hasta)
            .pipe(catchError(() => of({ ok: false, data: null as never })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.dailyAggregatesLoading.set(false);
        this.dailyAggregates.set(res.ok && res.data ? res.data.dias : []);
      });

    // Period aggregates: peaks + promedios de caudal/nivel_freatico sobre el
    // rango completo. Endpoint lee equipo_5min en el rango (no limitado a 25h
    // como historyRows). Trigger en cambio de fechas.
    combineLatest([this.fechaDesde$, this.fechaHasta$])
      .pipe(
        debounceTime(300),
        switchMap(([desde, hasta]) => {
          this.periodAggregatesLoading.set(true);
          return this.companyService
            .getSitePeriodAggregates(siteId, desde, hasta)
            .pipe(catchError(() => of({ ok: false, data: null as never })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.periodAggregatesLoading.set(false);
        if (!res.ok || !res.data) {
          this.periodAggregates.set(null);
          return;
        }
        this.periodAggregates.set({
          caudal: res.data.caudal,
          nivel_freatico: res.data.nivel_freatico,
        });
      });

    // Contadores por turno: 3 calls paralelas, una por turno (inicio/fin
    // HH:MM). Se refetchean cuando cambia preset/fechas, num turnos, config
    // de turnos. Cache server-side TTL 15 min absorbe rebotes.
    //
    // Para rangos custom (preset === null) pedimos `dias` = días desde
    // fechaDesde hasta hoy; el backend `contadores-jornadas` solo soporta
    // ventanas que terminan hoy, así que cubrimos hasta hoy y luego
    // filtramos client-side al rango aplicado dentro de turnosResumen.
    combineLatest([this.fechaDesde$, this.fechaHasta$, this.numTurnos$, this.turnosConfig$])
      .pipe(
        debounceTime(300),
        switchMap(([fechaDesde, , numTurnos, turnos]) => {
          const cfg = turnos.slice(0, numTurnos);
          const desdeMs = new Date(`${fechaDesde}T00:00:00-04:00`).getTime();
          const hoyMs = Date.now();
          const dias = Math.max(1, Math.ceil((hoyMs - desdeMs) / (24 * 60 * 60 * 1000)));
          this.turnoCountersLoading.set(true);
          return forkJoin(
            cfg.map((t) =>
              this.companyService
                .getSiteJornadaCounters(siteId, {
                  rol: 'totalizador',
                  dias,
                  inicio: t.inicio,
                  fin: t.fin,
                })
                .pipe(catchError(() => of({ ok: false, data: [] as ContadorJornadaPoint[] }))),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.turnoCountersLoading.set(false);
        const padded: ContadorJornadaPoint[][] = [[], [], []];
        results.forEach((r, i) => {
          padded[i] = (r && r.ok ? r.data : []) ?? [];
        });
        this.turnoCountersData.set(padded);
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

  /**
   * Formato largo para tooltip (DD/MM/YYYY).
   */
  private formatDiaLargo(diaIso: string): string {
    const [y, m, d] = diaIso.split('-');
    return `${d}/${m}/${y}`;
  }

  presetClass(p: Preset): string {
    const active = this.preset() === p;
    return [
      'rounded-lg px-3 py-1.5 text-caption font-bold transition-colors active:scale-95',
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
        ? 'bg-primary-tint-08 text-primary-container'
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
        ? 'bg-primary-tint-08 text-primary-container'
        : 'bg-amber-50 text-amber-700';
  }

  incEstadoDot(estado: IncidenciaPeriodo['estado']): string {
    return estado === 'resuelta'
      ? 'bg-emerald-500'
      : estado === 'en_proceso'
        ? 'bg-primary/10'
        : 'bg-amber-500';
  }
}
