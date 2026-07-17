import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { catchError, firstValueFrom, of, Subscription, switchMap, timer } from 'rxjs';
import { ChartSkeletonComponent } from '../../../../components/ui/chart-skeleton';
import { KpiStripSkeletonComponent } from '../../../../components/ui/kpi-strip-skeleton';
import { TableSkeletonComponent } from '../../../../components/ui/table-skeleton';
import { WellDiagramSkeletonComponent } from '../../../../components/ui/well-diagram-skeleton';
import { WellStatCardComponent } from '../../../../components/ui/well-stat-card';
import { type ContadorMensualPoint, CompanyService } from '../../../../services/company.service';
import { DatoDgaRow, DgaService } from '../../../../services/dga.service';
import { CHILE_TIME_ZONE } from '../../../../shared/timezone';

/**
 * Devuelve "YYYY-MM-DD" para hoy en zona Chile (UTC-4, fijo sin DST).
 */
function chileToday(): string {
  const d = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Devuelve "YYYY-MM-01" del mes actual en zona Chile (UTC-4).
 */
function chileMonthStart(): string {
  const d = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 8) + '01';
}

interface MonthlyFlowPoint {
  label: string;
  value: number;
  proyeccion?: number | null;
}

interface DgaReportRow {
  id: string;
  recordId: string;
  fecha: string;
  dateIso: string;
  timestampMs: number;
  nivelFreatico: number | null;
  caudal: number | null;
  totalizador: number | null;
  estado: string;
  enviadoDga: string;
  respuesta: string;
  comprobante: string;
}

interface DashboardVariable {
  key?: string | null;
  alias?: string | null;
  rol_dashboard?: string | null;
  transformacion?: string | null;
  unidad?: string | null;
  ok?: boolean;
  valor?: string | number | null;
}

interface SiteDashboardData {
  server_time?: string | null;
  pozo_config?: {
    profundidad_pozo_m?: number | string | null;
    profundidad_sensor_m?: number | string | null;
  } | null;
  ultima_lectura?: {
    time?: string | null;
    timestamp_completo?: string | null;
    received_at?: string | null;
    id_serial?: string | null;
  } | null;
  resumen?: Record<
    string,
    { valor?: string | number | null; ok?: boolean; unidad?: string | null } | undefined
  >;
  variables?: DashboardVariable[];
}

@Component({
  selector: 'app-water-detail-dga',
  standalone: true,
  imports: [
    CommonModule,
    A11yModule,
    KpiStripSkeletonComponent,
    WellDiagramSkeletonComponent,
    ChartSkeletonComponent,
    TableSkeletonComponent,
    WellStatCardComponent,
  ],
  template: `
    <ng-container>
      <!-- Tab panel DGA -->
      <div role="tabpanel" id="tabpanel-dga" aria-labelledby="tab-dga" class="flex flex-col gap-6">
        @if (dgaLoading()) {
          <app-kpi-strip-skeleton />
        } @else {
          <section class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <!-- Enviados: cuenta en rango filtrado -->
            <article
              class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center shadow-sm"
            >
              <p class="text-caption-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
                Enviados
              </p>
              <p class="mt-1 text-h3 font-semibold leading-none text-emerald-600">
                {{ dgaCountEnviados() }}
              </p>
              <p class="mt-1 text-caption font-semibold text-emerald-500">en rango filtrado</p>
            </article>

            <!-- Último envío: ABSOLUTE, no afectado por filtro. Card entero clickeable -->
            @if (dgaUltimoEnvio()?.comprobante; as comp) {
              @if (comprobanteUrl(comp); as url) {
                <a
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  [title]="'Abrir comprobante en SNIA · ' + comp"
                  class="group flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm transition-all hover:border-emerald-400 hover:shadow-md"
                >
                  <div class="flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-emerald-600"
                      >verified</span
                    >
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-[0.18em] text-emerald-700"
                    >
                      Último envío aceptado
                    </p>
                  </div>
                  <p
                    class="text-center font-mono text-h4 font-semibold leading-tight text-slate-800"
                  >
                    {{ dgaUltimoEnvioFecha() }}
                  </p>
                </a>
              } @else {
                <article
                  class="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm"
                  [title]="'Carga el número de obra para habilitar el link SNIA · ' + comp"
                >
                  <div class="flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-emerald-600"
                      >verified</span
                    >
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-[0.18em] text-emerald-700"
                    >
                      Último envío aceptado
                    </p>
                  </div>
                  <p
                    class="text-center font-mono text-h4 font-semibold leading-tight text-slate-800"
                  >
                    {{ dgaUltimoEnvioFecha() }}
                  </p>
                  <span class="truncate font-mono text-caption-xs text-slate-500">{{ comp }}</span>
                </article>
              }
            } @else {
              <article
                class="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm"
              >
                <p class="text-caption-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Último envío aceptado
                </p>
                <p class="font-mono text-h4 font-semibold leading-tight text-slate-400">—</p>
                <span class="text-caption-xs italic text-slate-500">sin envíos aún</span>
              </article>
            }

            <!-- Tasa éxito: enviados / (enviados + rechazados + fallidos). Color dinamico. -->
            <article
              [class]="
                'relative rounded-xl border px-4 py-3 text-center shadow-sm ' +
                dgaTasaExitoColors().border +
                ' ' +
                dgaTasaExitoColors().bg
              "
            >
              <div class="flex items-start justify-between">
                <p
                  [class]="
                    'flex-1 text-caption-xs font-semibold uppercase tracking-[0.2em] ' +
                    dgaTasaExitoColors().text
                  "
                >
                  Tasa de éxito
                </p>
                <details class="group relative">
                  <summary
                    [class]="
                      'flex h-5 w-5 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
                      dgaTasaExitoColors().text
                    "
                    aria-label="Ver leyenda de la tasa de éxito"
                  >
                    <span class="material-symbols-outlined text-[14px]">help_outline</span>
                  </summary>
                  <div
                    class="absolute right-0 top-7 z-10 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left text-caption shadow-lg"
                  >
                    <p class="mb-2 font-semibold text-slate-700">Cómo se calcula</p>
                    <p class="mb-3 text-slate-500">
                      enviados ÷ (enviados + rechazados + fallidos) × 100. Solo se cuentan slots
                      dentro del rango filtrado.
                    </p>
                    <p class="mb-2 font-semibold text-slate-700">Umbrales</p>
                    <ul class="space-y-1.5 text-slate-600">
                      <li class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                        100 %: sin rechazos
                      </li>
                      <li class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                        90–99 %: alerta leve
                      </li>
                      <li class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-full bg-lime-500"></span>
                        75–89 %: revisar configuración
                      </li>
                      <li class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                        60–74 %: atención requerida
                      </li>
                      <li class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-full bg-orange-500"></span>
                        40–59 %: bloqueo probable
                      </li>
                      <li class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
                        &lt; 40 %: falla persistente
                      </li>
                    </ul>
                  </div>
                </details>
              </div>
              <p [class]="'mt-1 text-h3 font-semibold leading-none ' + dgaTasaExitoColors().text">
                {{ dgaTasaExito() === null ? '—' : dgaTasaExito() + '%' }}
              </p>
              <p
                [class]="
                  'mt-1 text-caption-xs font-bold uppercase tracking-wider ' +
                  dgaTasaExitoColors().text
                "
              >
                {{ dgaTasaExitoLabel() }}
              </p>
              <p class="text-caption-xs font-semibold text-slate-500">en rango filtrado</p>
            </article>

            <!-- Rechazados: cuenta en rango -->
            <article
              class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center shadow-sm"
              title="Envíos que el portal SNIA no aceptó (Rechazado) o que fallaron antes de llegar (Fallido). Revisa la columna 'Estado' en la tabla para identificar la causa."
            >
              <p class="text-caption-xs font-semibold uppercase tracking-[0.2em] text-rose-700">
                Rechazados
              </p>
              <p class="mt-1 text-h3 font-semibold leading-none text-rose-600">
                {{ dgaCountRechazados() }}
              </p>
              <p class="mt-1 text-caption font-semibold text-rose-700">
                Rechazados por SNIA + fallidos antes del envío
              </p>
            </article>
          </section>
        }

        <section class="grid grid-cols-1 gap-5 xl:grid-cols-[520px_minmax(0,1fr)] xl:items-stretch">
          <div class="flex flex-col gap-5 xl:h-full">
            <article
              class="flex flex-1 flex-col rounded-xl border border-primary-tint-25 bg-white p-3 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]"
            >
              <p
                class="mb-3 text-caption-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
              >
                Diagrama del pozo
              </p>

              @if (dashboardLoading()) {
                <app-well-diagram-skeleton />
              } @else {
                <div class="flex gap-3 items-start">
                  <!-- SVG Well Diagram (flex:1) -->
                  <div style="flex:1;min-width:0;overflow:visible">
                    <svg
                      [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH"
                      style="width:100%;height:auto;display:block;overflow:visible"
                    >
                      <style>
                        @keyframes wdiagWave1 {
                          0%,
                          100% {
                            transform: translateX(0);
                          }
                          50% {
                            transform: translateX(-7px);
                          }
                        }
                        @keyframes wdiagWave2 {
                          0%,
                          100% {
                            transform: translateX(0);
                          }
                          50% {
                            transform: translateX(6px);
                          }
                        }
                        @keyframes wdiagBubble {
                          0% {
                            opacity: 0;
                            transform: translateY(0);
                          }
                          8% {
                            opacity: 0.62;
                          }
                          78% {
                            opacity: 0.22;
                          }
                          100% {
                            opacity: 0;
                            transform: translateY(-580px);
                          }
                        }
                        .wdiag-w1 {
                          animation: wdiagWave1 3s ease-in-out infinite;
                        }
                        .wdiag-w2 {
                          animation: wdiagWave2 4.8s ease-in-out infinite;
                        }
                        .wdiag-b {
                          animation-name: wdiagBubble;
                          animation-timing-function: ease-in;
                          animation-iteration-count: infinite;
                          animation-fill-mode: both;
                          animation-duration: var(--d, 4s);
                          animation-delay: var(--e, 0s);
                        }
                        @media (prefers-reduced-motion: reduce) {
                          .wdiag-w1,
                          .wdiag-w2,
                          .wdiag-b {
                            animation: none !important;
                          }
                        }
                      </style>
                      <defs>
                        <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stop-color="#8EEAF1" stop-opacity="0.85" />
                          <stop offset="18%" stop-color="#0DAFBD" stop-opacity="0.92" />
                          <stop offset="65%" stop-color="#067D88" stop-opacity="0.97" />
                          <stop offset="100%" stop-color="#034851" stop-opacity="1" />
                        </linearGradient>
                        <radialGradient id="shimmer" cx="40%" cy="25%" r="55%">
                          <stop offset="0%" stop-color="white" stop-opacity="0.22" />
                          <stop offset="100%" stop-color="white" stop-opacity="0" />
                        </radialGradient>
                        <pattern
                          id="dots"
                          x="0"
                          y="0"
                          width="8"
                          height="8"
                          patternUnits="userSpaceOnUse"
                        >
                          <rect width="8" height="8" fill="#F5EDD8" />
                          <circle cx="3" cy="3" r="1" fill="#C4A882" opacity="0.6" />
                          <circle cx="7" cy="7" r="0.7" fill="#C4A882" opacity="0.4" />
                        </pattern>
                        <clipPath id="wellClip">
                          <rect
                            [attr.x]="svgWellL + 4"
                            [attr.y]="svgWellTop"
                            [attr.width]="svgWellR - svgWellL - 8"
                            [attr.height]="svgWellH"
                          />
                        </clipPath>
                      </defs>

                      <!-- Soil left -->
                      <rect
                        x="0"
                        [attr.y]="svgWellTop"
                        [attr.width]="svgWellL"
                        [attr.height]="svgWellH"
                        fill="url(#dots)"
                      />
                      <!-- Soil right (extended to SVG edge so annotation zone has background) -->
                      <rect
                        [attr.x]="svgWellR"
                        [attr.y]="svgWellTop"
                        [attr.width]="svgW - svgWellR"
                        [attr.height]="svgWellH"
                        fill="url(#dots)"
                      />

                      <!-- Ground surface band -->
                      <rect
                        x="0"
                        y="0"
                        [attr.width]="svgW"
                        [attr.height]="svgWellTop"
                        fill="#8B7355"
                        opacity="0.15"
                      />
                      <line
                        x1="0"
                        [attr.y1]="svgWellTop"
                        [attr.x2]="svgW"
                        [attr.y2]="svgWellTop"
                        stroke="#8B7355"
                        stroke-width="2"
                      />

                      <!-- Grass marks -->
                      @for (gx of svgGrassX; track gx) {
                        <line
                          [attr.x1]="gx"
                          [attr.y1]="svgWellTop"
                          [attr.x2]="gx - 3"
                          [attr.y2]="svgWellTop - 7"
                          stroke="#6B9B37"
                          stroke-width="1.5"
                          stroke-linecap="round"
                        />
                      }

                      <!-- Well casing — empty air gap -->
                      <rect
                        [attr.x]="svgWellL + 4"
                        [attr.y]="svgWellTop"
                        [attr.width]="svgWellR - svgWellL - 8"
                        [attr.height]="svgWaterY - svgWellTop"
                        fill="#F0F9FF"
                        opacity="0.9"
                      />

                      <!-- Water fill (gradient) -->
                      <rect
                        [attr.x]="svgWellL + 4"
                        [attr.y]="svgWaterY"
                        [attr.width]="svgWellR - svgWellL - 8"
                        [attr.height]="svgWellBot - svgWaterY"
                        fill="url(#wg)"
                        clip-path="url(#wellClip)"
                      />
                      <!-- Water shimmer overlay -->
                      <rect
                        [attr.x]="svgWellL + 4"
                        [attr.y]="svgWaterY"
                        [attr.width]="svgWellR - svgWellL - 8"
                        [attr.height]="svgWellBot - svgWaterY"
                        fill="url(#shimmer)"
                        clip-path="url(#wellClip)"
                      />
                      <!-- Surface refraction stripe -->
                      <rect
                        [attr.x]="svgWellL + 7"
                        [attr.y]="svgWaterY + 3"
                        [attr.width]="svgWellR - svgWellL - 16"
                        height="4"
                        fill="white"
                        opacity="0.28"
                        rx="2"
                        clip-path="url(#wellClip)"
                      />
                      <!-- Caustic light patches near bottom -->
                      <ellipse
                        [attr.cx]="svgTextCX - 9"
                        [attr.cy]="svgWellBot - 24"
                        rx="9"
                        ry="3"
                        fill="white"
                        opacity="0.07"
                        clip-path="url(#wellClip)"
                      />
                      <ellipse
                        [attr.cx]="svgTextCX + 7"
                        [attr.cy]="svgWellBot - 40"
                        rx="6"
                        ry="2"
                        fill="white"
                        opacity="0.05"
                        clip-path="url(#wellClip)"
                      />

                      <!-- Wave surface (primary, animated) -->
                      <g class="wdiag-w1" clip-path="url(#wellClip)">
                        <path
                          [attr.d]="svgWavePath"
                          fill="none"
                          stroke="rgba(255,255,255,0.65)"
                          stroke-width="2"
                          stroke-linecap="round"
                        />
                      </g>
                      <!-- Wave surface (secondary, animated opposite direction) -->
                      <g class="wdiag-w2" clip-path="url(#wellClip)">
                        <path
                          [attr.d]="svgWave2Path"
                          fill="none"
                          stroke="rgba(13,175,189,0.45)"
                          stroke-width="1.2"
                        />
                      </g>
                      <!-- Bubbles rising from bottom -->
                      <g clip-path="url(#wellClip)">
                        <circle
                          class="wdiag-b"
                          style="--d:4s;--e:0s"
                          cx="97"
                          [attr.cy]="svgWellBot - 22"
                          r="2"
                          fill="rgba(255,255,255,0.82)"
                        />
                        <circle
                          class="wdiag-b"
                          style="--d:5.5s;--e:1.4s"
                          cx="131"
                          [attr.cy]="svgWellBot - 40"
                          r="1.5"
                          fill="rgba(255,255,255,0.70)"
                        />
                        <circle
                          class="wdiag-b"
                          style="--d:3.8s;--e:2.7s"
                          cx="113"
                          [attr.cy]="svgWellBot - 13"
                          r="2.5"
                          fill="rgba(255,255,255,0.75)"
                        />
                        <circle
                          class="wdiag-b"
                          style="--d:5s;--e:0.6s"
                          cx="145"
                          [attr.cy]="svgWellBot - 52"
                          r="1.8"
                          fill="rgba(255,255,255,0.65)"
                        />
                        <circle
                          class="wdiag-b"
                          style="--d:4.3s;--e:3.8s"
                          cx="104"
                          [attr.cy]="svgWellBot - 30"
                          r="1.2"
                          fill="rgba(255,255,255,0.80)"
                        />
                        <circle
                          class="wdiag-b"
                          style="--d:6s;--e:2s"
                          cx="122"
                          [attr.cy]="svgWellBot - 8"
                          r="1.8"
                          fill="rgba(255,255,255,0.68)"
                        />
                      </g>

                      <!-- Fill % label inside water -->
                      @if (svgFillPct > 12) {
                        <text
                          [attr.x]="svgTextCX"
                          [attr.y]="svgTextWaterY"
                          font-size="15"
                          font-weight="700"
                          fill="white"
                          text-anchor="middle"
                          font-family="JetBrains Mono"
                          opacity="0.9"
                        >
                          {{ svgFillPct }}%
                        </text>
                      }

                      <!-- Well walls -->
                      <rect
                        [attr.x]="svgWellL"
                        [attr.y]="svgWellTop"
                        width="8"
                        [attr.height]="svgWellH"
                        fill="#94A3B8"
                        rx="2"
                      />
                      <rect
                        [attr.x]="svgWellR - 8"
                        [attr.y]="svgWellTop"
                        width="8"
                        [attr.height]="svgWellH"
                        fill="#94A3B8"
                        rx="2"
                      />
                      <rect
                        [attr.x]="svgWellL"
                        [attr.y]="svgWellBot - 6"
                        [attr.width]="svgWellR - svgWellL"
                        height="7"
                        fill="#64748B"
                        rx="2"
                      />

                      <!-- Sensor: only shown when depth data exists, right wall, proportional -->
                      @if (wellSensorDepth() !== null) {
                        <!-- Vertical depth guide from well top to sensor -->
                        <line
                          [attr.x1]="svgWellR - 4"
                          [attr.y1]="svgWellTop"
                          [attr.x2]="svgWellR - 4"
                          [attr.y2]="svgSensorY"
                          stroke="#F97316"
                          stroke-width="1"
                          stroke-dasharray="3 3"
                          opacity="0.35"
                        />
                        <!-- Horizontal indicator from right wall outward -->
                        <line
                          [attr.x1]="svgWellR"
                          [attr.y1]="svgSensorY"
                          [attr.x2]="svgWellR + 18"
                          [attr.y2]="svgSensorY"
                          stroke="#F97316"
                          stroke-width="1.5"
                          stroke-dasharray="3 2"
                        />
                        <!-- Sensor marker -->
                        <rect
                          [attr.x]="svgWellR + 18"
                          [attr.y]="svgSensorY - 5"
                          width="9"
                          height="10"
                          fill="#F97316"
                          rx="2"
                        />
                        <!-- Sensor label -->
                        <text
                          [attr.x]="svgWellR + 30"
                          [attr.y]="svgSensorY + 5"
                          font-size="12"
                          fill="#F97316"
                          font-family="DM Sans"
                          font-weight="600"
                        >
                          Sensor
                        </text>
                      }

                      <!-- RIGHT BRACKET: Superficie → Nivel Freático (dynamic) -->
                      <!-- Superficie circle (at ground level) -->
                      <circle [attr.cx]="svgAnnotX" [attr.cy]="svgWellTop" r="3" fill="#64748B" />
                      <!-- Superficie label: left-center, higher above line -->
                      <text
                        x="124"
                        [attr.y]="svgWellTop - 16"
                        font-size="9"
                        fill="#64748B"
                        font-family="DM Sans"
                        font-weight="600"
                        text-anchor="middle"
                      >
                        Superficie
                      </text>

                      <!-- Vertical dashed line: Superficie → Nivel Freático -->
                      <line
                        [attr.x1]="svgAnnotX"
                        [attr.y1]="svgWellTop + 3"
                        [attr.x2]="svgAnnotX"
                        [attr.y2]="svgWaterY - 3"
                        stroke="#0DAFBD"
                        stroke-width="1.5"
                        stroke-dasharray="4 3"
                      />

                      <!-- Nivel Freático circle + horizontal line into well -->
                      <circle [attr.cx]="svgAnnotX" [attr.cy]="svgWaterY" r="3" fill="#0DAFBD" />
                      <line
                        [attr.x1]="svgAnnotX"
                        [attr.y1]="svgWaterY"
                        [attr.x2]="svgWellR - 5"
                        [attr.y2]="svgWaterY"
                        stroke="#0DAFBD"
                        stroke-width="1.5"
                        stroke-dasharray="4 2"
                      />
                      <!-- Nivel Freático label: centered above the horizontal dashed line -->
                      <text
                        [attr.x]="(svgAnnotX + svgWellR - 5) / 2"
                        [attr.y]="svgWaterY - 7"
                        font-size="12"
                        fill="#0DAFBD"
                        font-family="DM Sans"
                        font-weight="700"
                        text-anchor="middle"
                      >
                        Nv. Freático
                      </text>

                      <!-- Left depth arrow -->
                      <line
                        [attr.x1]="svgWellL - 10"
                        [attr.y1]="svgWellTop + 2"
                        [attr.x2]="svgWellL - 10"
                        [attr.y2]="svgWellBot - 2"
                        stroke="#CBD5E1"
                        stroke-width="1"
                      />
                      <line
                        [attr.x1]="svgWellL - 14"
                        [attr.y1]="svgWellTop + 2"
                        [attr.x2]="svgWellL - 6"
                        [attr.y2]="svgWellTop + 2"
                        stroke="#CBD5E1"
                        stroke-width="1"
                      />
                      <line
                        [attr.x1]="svgWellL - 14"
                        [attr.y1]="svgWellBot - 2"
                        [attr.x2]="svgWellL - 6"
                        [attr.y2]="svgWellBot - 2"
                        stroke="#CBD5E1"
                        stroke-width="1"
                      />
                      <text
                        [attr.x]="svgWellL - 12"
                        [attr.y]="svgDepthMidY + 4"
                        font-size="13"
                        fill="#94A3B8"
                        font-family="JetBrains Mono"
                        text-anchor="middle"
                        [attr.transform]="
                          'rotate(-90,' + (svgWellL - 12) + ',' + svgDepthMidY + ')'
                        "
                      >
                        {{ wellTotalDepth() ?? 18 }}m prof.
                      </text>
                    </svg>
                  </div>
                  <!-- Stats column (derecha) -->
                  <div class="flex w-[124px] shrink-0 flex-col gap-2">
                    <app-well-stat-card
                      tone="primary"
                      label="Nv. Freático"
                      [value]="formatMeters(wellNivelFreatico())"
                      unit="m"
                      helper="desde superficie"
                    />
                    <app-well-stat-card
                      tone="neutral"
                      label="Llenado"
                      [value]="svgFillPct"
                      unit="%"
                    >
                      <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
                        <div
                          class="h-full w-full origin-left rounded-full bg-gradient-to-r from-primary-container to-emerald-500 transition-transform duration-500 ease-in-out-strong motion-reduce:transition-none"
                          [style.transform]="'scaleX(' + wellFillStylePercent() / 100 + ')'"
                        ></div>
                      </div>
                    </app-well-stat-card>
                    <app-well-stat-card
                      tone="neutral"
                      size="md"
                      label="Prof. Total"
                      [value]="formatMeters(wellTotalDepth()) + ' m'"
                    />
                    <app-well-stat-card
                      tone="orange"
                      size="md"
                      label="Sensor"
                      [value]="formatMeters(wellSensorDepth()) + ' m'"
                    />
                    @if (wellSignalPercent() !== null) {
                      <app-well-stat-card
                        tone="blue"
                        label="% Señal"
                        [value]="wellSignalPercent() ?? ''"
                        unit="%"
                      >
                        <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
                          <div
                            class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500"
                            [style.width.%]="wellSignalPercent()"
                          ></div>
                        </div>
                      </app-well-stat-card>
                    }
                    <app-well-stat-card
                      tone="neutral"
                      size="sm"
                      label="Último dato recibido"
                      [value]="latestDeviceTimeLabel()"
                      [helper]="latestDeviceDateLabel()"
                    />
                  </div>
                </div>
              }
            </article>
          </div>

          <div class="flex flex-col gap-5 xl:h-full">
            <article
              class="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
                  >
                    <span class="material-symbols-outlined text-[22px]">bar_chart</span>
                  </span>
                  <div class="min-w-0">
                    <h2 class="truncate text-h5 font-semibold leading-none text-slate-800">
                      Flujo Mensual
                    </h2>
                    <p class="mt-1 text-body-sm font-bold text-slate-500">
                      Volumen acumulado en {{ monthlyFlowUnit() }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-3 text-caption font-bold text-slate-500">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[16px]">info</span>
                    Últimos 12 meses
                  </span>
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-slate-50"
                    aria-label="Opciones de grafico"
                  >
                    <span class="material-symbols-outlined text-[18px]">more_vert</span>
                  </button>
                </div>
              </div>

              @if (monthlyCountersLoading()) {
                <div class="mt-5">
                  <app-chart-skeleton [bars]="12" [height]="250" />
                </div>
              } @else {
                <div class="mt-5 grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                  <div
                    class="grid h-[250px] grid-rows-5 text-right text-caption font-semibold text-slate-400"
                  >
                    @for (tick of monthlyFlowTicks(); track $index) {
                      <span>{{ tick }}</span>
                    }
                  </div>

                  <div class="relative h-[250px] border-b border-l border-slate-200">
                    <div class="absolute inset-0 grid grid-rows-4">
                      <span class="border-t border-slate-200"></span>
                      <span class="border-t border-slate-200"></span>
                      <span class="border-t border-slate-200"></span>
                      <span class="border-t border-slate-200"></span>
                    </div>

                    <div
                      class="absolute inset-x-2 bottom-0 top-0 flex items-end justify-between gap-2"
                    >
                      @for (month of monthlyFlowMonths(); track $index) {
                        <div class="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                          <div
                            class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1.5 text-caption-xs font-semibold text-white shadow-lg group-hover:block"
                          >
                            <div class="font-bold">{{ month.label }}</div>
                            <div class="font-mono">
                              {{ formatMonthlyFlowValue(month.value) }}
                              {{ monthlyFlowUnit() }}
                            </div>
                            @if (month.proyeccion) {
                              <div class="font-mono text-slate-300">
                                proy. {{ formatMonthlyFlowValue(month.proyeccion) }}
                                {{ monthlyFlowUnit() }}
                              </div>
                            }
                            <div
                              class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800"
                            ></div>
                          </div>
                          <div
                            class="mx-auto flex w-full max-w-[28px] flex-col justify-end overflow-hidden rounded-t"
                            [style.height.%]="
                              month.proyeccion && month.proyeccion > month.value
                                ? getMonthlyFlowHeight(month.proyeccion)
                                : getMonthlyFlowHeight(month.value)
                            "
                          >
                            @if (month.proyeccion && month.proyeccion > month.value) {
                              <div
                                class="w-full bg-[#5874c8]/30"
                                [style.height.%]="getMonthlyFlowProjectionExtra(month)"
                              ></div>
                            }
                            <div
                              class="w-full bg-[#5874c8] shadow-sm transition-opacity group-hover:opacity-85"
                              [style.flex]="'1 1 auto'"
                            ></div>
                          </div>
                        </div>
                      }
                    </div>
                  </div>
                </div>

                <div
                  class="ml-[66px] mt-2 flex h-10 justify-between gap-2 px-2 text-caption-xs font-bold text-slate-400"
                >
                  @for (month of monthlyFlowMonths(); track $index) {
                    <div class="relative h-full min-w-0 flex-1">
                      <span
                        class="absolute right-1/2 top-1 origin-top-right -rotate-45 whitespace-nowrap"
                        >{{ month.label }}</span
                      >
                    </div>
                  }
                </div>
              }
            </article>

            <article
              class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <p class="mb-2 text-body-sm font-semibold text-slate-700">Acciones Rápidas</p>
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                @for (action of quickActions; track action.title) {
                  <button
                    type="button"
                    (click)="handleQuickAction(action)"
                    [disabled]="quickActionDisabled(action)"
                    [title]="quickActionTitle(action)"
                    [class]="
                      quickActionDisabled(action)
                        ? 'rounded-lg px-3 py-2 text-left opacity-50 cursor-not-allowed'
                        : 'rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary-tint-06 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
                    "
                  >
                    <span
                      [class]="
                        quickActionDisabled(action)
                          ? 'material-symbols-outlined text-[20px] text-slate-400'
                          : 'material-symbols-outlined text-[20px] ' + action.color
                      "
                      >{{ action.icon }}</span
                    >
                    <p
                      [class]="
                        quickActionDisabled(action)
                          ? 'mt-0.5 text-body-sm font-semibold text-slate-500'
                          : 'mt-0.5 text-body-sm font-semibold text-slate-800'
                      "
                    >
                      {{ action.title }}
                    </p>
                    <p class="text-caption font-medium text-slate-500">
                      {{ action.subtitle }}
                    </p>
                    @if (quickActionDisabled(action)) {
                      <p class="mt-1 text-caption-xs italic text-amber-600">
                        {{ quickActionTitle(action) }}
                      </p>
                    }
                  </button>
                }
              </div>
            </article>
          </div>
        </section>
        <!-- Registros DGA -->
        <section
          class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
        >
          <div
            class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <div>
              <h2 class="text-body-sm font-semibold text-slate-800">Detalle de Registros</h2>
              <p class="mt-1 text-caption font-semibold text-slate-500">
                Reportes completos enviados a la DGA
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-caption font-bold">
              <button
                type="button"
                (click)="openDgaDateFilter()"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-slate-600 transition-colors hover:border-primary-tint-30 hover:bg-primary-tint-08 hover:text-primary-container"
              >
                <span class="material-symbols-outlined text-[16px]">calendar_month</span>
                {{ dgaSelectedRangeLabel() }}
              </button>
              <span class="text-slate-500">{{ dgaTotalRecordsLabel() }}</span>
            </div>
          </div>

          <div class="overflow-x-auto">
            @if (dgaLoading()) {
              <div class="p-3">
                <app-table-skeleton [rows]="6" [columns]="5" [showHeader]="false" />
              </div>
            } @else {
              <table class="responsive-table w-full text-left text-body-sm md:min-w-[960px]">
                <thead class="bg-slate-50">
                  <tr class="border-b border-slate-100">
                    @for (
                      h of [
                        'Fecha',
                        'Nv. Freático [m]',
                        'Caudal [l/s]',
                        'Totalizador [m³]',
                        'Estado',
                      ];
                      track h
                    ) {
                      <th class="dga-table-header">{{ h }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (report of paginatedDgaReports(); track report.id) {
                    <tr class="border-b border-slate-100">
                      <td class="dga-table-cell dga-table-cell--muted" data-label="Fecha">
                        {{ report.fecha }}
                      </td>
                      <td class="dga-table-cell" data-label="Nv. freático">
                        {{ formatDgaNumber(report.nivelFreatico) }}
                      </td>
                      <td class="dga-table-cell" data-label="Caudal">
                        {{ formatDgaNumber(report.caudal) }}
                      </td>
                      <td class="dga-table-cell" data-label="Totalizador">
                        {{ formatDgaInteger(report.totalizador) }}
                      </td>
                      <td class="px-4 py-3" data-label="Estado">
                        <div class="flex flex-col gap-1">
                          <div class="inline-flex items-center gap-2">
                            <button
                              type="button"
                              (click)="openDgaReportDetail(report)"
                              class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-caption-xs font-semibold transition-colors"
                              [style.background]="getDgaStatusBg(report.estado)"
                              [style.border-color]="getDgaStatusBorder(report.estado)"
                              [style.color]="getDgaStatusColor(report.estado)"
                            >
                              <span
                                class="h-[5px] w-[5px] rounded-full"
                                [style.background]="getDgaStatusColor(report.estado)"
                              ></span>
                              {{ report.estado }}
                              <span class="material-symbols-outlined text-[13px]"
                                >chevron_right</span
                              >
                            </button>
                            @if (
                              report.estado === 'Enviado' && comprobanteUrl(report.comprobante);
                              as snia
                            ) {
                              <a
                                [href]="snia"
                                target="_blank"
                                rel="noopener noreferrer"
                                (click)="$event.stopPropagation()"
                                [title]="'Ver comprobante en SNIA: ' + report.comprobante"
                                class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
                              >
                                <span class="material-symbols-outlined text-[14px]"
                                  >receipt_long</span
                                >
                              </a>
                            }
                          </div>
                          @if (
                            report.estado === 'Rechazado' ||
                            report.estado === 'Fallido' ||
                            report.estado === 'Revisar'
                          ) {
                            <p
                              class="max-w-[420px] text-caption-xs font-medium leading-snug text-slate-500"
                            >
                              {{ report.respuesta }}
                            </p>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td
                        colspan="5"
                        class="px-4 py-8 text-center text-body-sm font-semibold text-slate-500"
                        data-label=""
                      >
                        Sin registros para el periodo seleccionado.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>

          <div
            class="flex flex-wrap items-center justify-end gap-5 border-t border-slate-100 px-4 py-3 text-caption font-semibold text-slate-500"
          >
            <label class="inline-flex items-center gap-2">
              Filas por pagina:
              <select
                [value]="dgaRowsPerPage()"
                (change)="setDgaRowsPerPage($event)"
                class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-slate-600 outline-none focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
              >
                @for (size of dgaRowsPerPageOptions; track size) {
                  <option [value]="size">{{ size }}</option>
                }
              </select>
            </label>
            <span>{{ dgaRangeStart() }} - {{ dgaRangeEnd() }} de {{ dgaDisplayedTotal() }}</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="previousDgaPage()"
                [disabled]="dgaPage() === 1"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Pagina anterior"
              >
                <span class="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <button
                type="button"
                (click)="nextDgaPage()"
                [disabled]="dgaPage() === dgaTotalPages()"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Pagina siguiente"
              >
                <span class="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- Modal filtro de fechas DGA -->
      @if (dgaDateFilterOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]"
          (click)="closeDgaDateFilter()"
        >
          <section
            class="w-full max-w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
            role="dialog"
            cdkTrapFocus
            cdkTrapFocusAutoCapture
            aria-modal="true"
            aria-labelledby="dga-date-filter-title"
          >
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint-08 text-primary-container"
                >
                  <span class="material-symbols-outlined text-[20px]">calendar_month</span>
                </span>
                <div>
                  <h2 id="dga-date-filter-title" class="text-h6 font-semibold text-slate-800">
                    Filtrar por Período
                  </h2>
                  <p class="text-caption font-semibold text-slate-500">Registros DGA</p>
                </div>
              </div>
              <button
                type="button"
                (click)="closeDgaDateFilter()"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
              <!-- Left: presets + months -->
              <div class="border-b border-slate-100 px-5 py-5 md:border-b-0 md:border-r">
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Períodos rápidos
                </p>
                <div class="grid gap-0.5">
                  @for (preset of downloadPresets; track preset.id) {
                    <button
                      type="button"
                      (click)="applyDgaDatePreset(preset.id)"
                      [class]="
                        dgaSelectedPreset() === preset.id
                          ? 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-bold bg-primary-tint-08 text-primary-container border border-primary-tint-25'
                          : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-semibold text-slate-600 hover:bg-slate-50'
                      "
                    >
                      @if (dgaSelectedPreset() === preset.id) {
                        <span class="h-1.5 w-1.5 rounded-full bg-primary/10 flex-shrink-0"></span>
                      }
                      {{ preset.label }}
                    </button>
                  }
                </div>

                <p
                  class="mb-2 mt-5 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Meses {{ 'de ' + (dgaDateFrom() || '2026').slice(0, 4) }}
                </p>
                <div class="grid grid-cols-3 gap-1.5">
                  @for (month of downloadMonthNames; track month; let i = $index) {
                    <button
                      type="button"
                      (click)="applyDgaMonth(i)"
                      [class]="
                        !dgaMonthHasData(i)
                          ? 'rounded-lg py-1.5 text-caption-xs font-semibold bg-slate-50 text-slate-300 cursor-not-allowed select-none'
                          : dgaSelectedMonths().includes(i)
                            ? 'rounded-lg py-1.5 text-caption-xs font-bold bg-primary text-white ring-2 ring-[rgba(13,175,189,0.45)]'
                            : 'rounded-lg py-1.5 text-caption-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'
                      "
                    >
                      {{ month.slice(0, 3) }}
                    </button>
                  }
                </div>
                <p class="mt-2 text-caption-xs font-semibold text-slate-300">
                  Verde = datos disponibles
                </p>
              </div>

              <!-- Right: range display + date inputs -->
              <div class="px-6 py-5">
                <div
                  class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p class="text-caption-xs font-bold uppercase tracking-wide text-slate-400">
                      Rango seleccionado
                    </p>
                    <p class="mt-0.5 text-body-sm font-semibold text-slate-700">
                      {{ dgaModalRangeLabel() }}
                    </p>
                  </div>
                  <span
                    class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-caption-xs font-bold text-slate-500"
                  >
                    {{ dgaModalDaysCount() > 0 ? dgaModalDaysCount() + ' días' : '—' }}
                  </span>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                    Desde
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="dgaDateFrom()"
                      (input)="
                        setDgaDateFrom($event);
                        dgaSelectedPreset.set('custom');
                        dgaSelectedMonths.set([])
                      "
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                  <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                    Hasta
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="dgaDateTo()"
                      (input)="
                        setDgaDateTo($event);
                        dgaSelectedPreset.set('custom');
                        dgaSelectedMonths.set([])
                      "
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-body-sm font-semibold"
            >
              <button
                type="button"
                (click)="
                  clearDgaDateFilter(); dgaSelectedPreset.set(null); dgaSelectedMonths.set([])
                "
                class="text-slate-500 transition-colors hover:text-slate-800"
              >
                Limpiar selección
              </button>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  (click)="closeDgaDateFilter()"
                  class="rounded-lg px-4 py-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  (click)="applyDgaDateFilter()"
                  class="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition-colors hover:bg-[var(--color-primary-container)]"
                >
                  Aplicar filtro
                </button>
              </div>
            </div>
          </section>
        </div>
      }
    </ng-container>
  `,
  styles: [
    `
      @keyframes dga-wave-drift {
        from {
          transform: translateX(-28%) rotate(0deg);
        }
        to {
          transform: translateX(2%) rotate(0deg);
        }
      }

      @keyframes dga-wave-bob {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(4px);
        }
      }

      @keyframes dga-shine {
        0% {
          transform: translateX(-110%);
          opacity: 0;
        }
        35% {
          opacity: 0.35;
        }
        70% {
          opacity: 0.12;
        }
        100% {
          transform: translateX(130%);
          opacity: 0;
        }
      }

      .dga-water-column {
        animation: dga-wave-bob 4.2s ease-in-out infinite;
      }

      .dga-water-wave {
        position: absolute;
        left: -42%;
        top: -18px;
        width: 184%;
        height: 36px;
        border-radius: 48%;
        pointer-events: none;
      }

      .dga-water-wave-a {
        background: rgba(165, 243, 252, 0.82);
        animation: dga-wave-drift 5.6s linear infinite;
      }

      .dga-water-wave-b {
        top: -11px;
        background: rgba(34, 211, 238, 0.34);
        animation: dga-wave-drift 4.1s linear infinite reverse;
      }

      .dga-water-shine {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.38) 48%,
          transparent 76%
        );
        animation: dga-shine 5.8s ease-in-out infinite;
        pointer-events: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .dga-water-column,
        .dga-water-wave-a,
        .dga-water-wave-b,
        .dga-water-shine {
          animation: none !important;
        }
      }
    `,
  ],
})
export class WaterDetailDgaComponent implements OnInit, OnDestroy {
  private readonly dgaService = inject(DgaService);
  private readonly companyService = inject(CompanyService);

  // Inputs
  siteId = input.required<string>();
  obraDga = input<string | null>(null);
  dashboardData = input<SiteDashboardData | null>(null);
  dashboardLoading = input<boolean>(false);
  latestDeviceTimeLabel = input<string>('—');
  latestDeviceDateLabel = input<string>('—');
  latestDeviceTimestampLabel = input<string>('—');

  // Outputs — el padre es dueño de los tres overlays (historial, descarga,
  // reporte DGA oficial); el tab solo emite la intención.
  openDgaReportModal = output<void>();
  openHistoryPanel = output<void>();
  openDownloadPanel = output<void>();

  // DGA signals
  dgaDateFilterOpen = signal(false);
  dgaDateFrom = signal(chileMonthStart());
  dgaDateTo = signal(chileToday());
  dgaRowsPerPage = signal(10);
  dgaPage = signal(1);
  dgaSelectedPreset = signal<string | null>(null);
  dgaSelectedMonths = signal<number[]>([]);
  dgaLoading = signal(false);
  dgaUltimoEnvio = signal<{ ts: string; comprobante: string | null } | null>(null);
  dgaReportRows = signal<DgaReportRow[]>([]);
  selectedDgaReport = signal<DgaReportRow | null>(null);

  // Monthly flow signals
  monthlyCountersData = signal<ContadorMensualPoint[]>([]);
  monthlyCountersLoading = signal(false);
  private monthlyCountersSub: Subscription | null = null;

  // Well diagram animation
  private readonly wellLevelAnim = signal<number | null>(null);
  private wellLevelRafId = 0;
  private readonly wellLevelTween = effect(() => {
    const target = this.wellNivelFreatico();
    const from = untracked(this.wellLevelAnim);
    cancelAnimationFrame(this.wellLevelRafId);
    const reduce =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (target === null || from === null || from === target || reduce) {
      this.wellLevelAnim.set(target);
      return;
    }
    const start = performance.now();
    const durationMs = 500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeInOutCubic ≈ --ease-in-out-strong
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.wellLevelAnim.set(from + (target - from) * e);
      if (t < 1) this.wellLevelRafId = requestAnimationFrame(tick);
    };
    this.wellLevelRafId = requestAnimationFrame(tick);
  });

  // DGA computed
  dgaCountEnviados = computed(
    () => this.dgaReportRows().filter((r) => r.estado === 'Enviado').length,
  );
  dgaCountRechazados = computed(
    () =>
      this.dgaReportRows().filter((r) => r.estado === 'Rechazado' || r.estado === 'Fallido').length,
  );
  dgaTasaExito = computed<number | null>(() => {
    const enviados = this.dgaCountEnviados();
    const malos = this.dgaCountRechazados();
    const denom = enviados + malos;
    if (denom === 0) return null;
    return Math.round((enviados / denom) * 1000) / 10;
  });
  dgaTasaExitoColors = computed<{ text: string; border: string; bg: string }>(() => {
    const t = this.dgaTasaExito();
    if (t === null) return { text: 'text-slate-400', border: 'border-slate-200', bg: 'bg-white' };
    if (t >= 100)
      return { text: 'text-emerald-600', border: 'border-emerald-300', bg: 'bg-emerald-50' };
    if (t >= 90)
      return { text: 'text-emerald-500', border: 'border-emerald-200', bg: 'bg-emerald-50' };
    if (t >= 75) return { text: 'text-lime-600', border: 'border-lime-200', bg: 'bg-lime-50' };
    if (t >= 60) return { text: 'text-amber-600', border: 'border-amber-200', bg: 'bg-amber-50' };
    if (t >= 40)
      return { text: 'text-orange-600', border: 'border-orange-200', bg: 'bg-orange-50' };
    return { text: 'text-rose-600', border: 'border-rose-300', bg: 'bg-rose-50' };
  });
  dgaTasaExitoLabel = computed<string>(() => {
    const t = this.dgaTasaExito();
    if (t === null) return 'Sin datos';
    if (t >= 100) return 'Sin rechazos';
    if (t >= 90) return 'Alerta leve';
    if (t >= 75) return 'Revisar config';
    if (t >= 60) return 'Atención requerida';
    if (t >= 40) return 'Bloqueo probable';
    return 'Falla persistente';
  });
  dgaUltimoEnvioFecha = computed<string>(() => {
    const u = this.dgaUltimoEnvio();
    if (!u) return '—';
    const d = new Date(new Date(u.ts).getTime() - 4 * 3600 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const HH = String(d.getUTCHours()).padStart(2, '0');
    const MM = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
  });
  dgaFilteredReports = computed(() => {
    const from = this.parseDateInputMs(this.dgaDateFrom(), 'start');
    const to = this.parseDateInputMs(this.dgaDateTo(), 'end');
    return this.dgaReportRows().filter((row) => {
      if (from !== null && row.timestampMs < from) return false;
      if (to !== null && row.timestampMs > to) return false;
      return true;
    });
  });
  paginatedDgaReports = computed(() => {
    const start = (this.dgaPage() - 1) * this.dgaRowsPerPage();
    return this.dgaFilteredReports().slice(start, start + this.dgaRowsPerPage());
  });
  dgaTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.dgaFilteredReports().length / this.dgaRowsPerPage())),
  );
  dgaRangeStart = computed(() =>
    this.dgaFilteredReports().length ? (this.dgaPage() - 1) * this.dgaRowsPerPage() + 1 : 0,
  );
  dgaRangeEnd = computed(() =>
    this.paginatedDgaReports().length
      ? this.dgaRangeStart() + this.paginatedDgaReports().length - 1
      : 0,
  );
  dgaDisplayedTotal = computed(() => this.dgaFilteredReports().length);
  dgaTotalRecordsLabel = computed(() => `${this.dgaDisplayedTotal()} registros en el periodo`);
  dgaSelectedRangeLabel = computed(
    () =>
      `${this.formatDgaDateInputShort(this.dgaDateFrom())} - ${this.formatDgaDateInputShort(this.dgaDateTo())}`,
  );
  dgaSelectedRangeLongLabel = computed(
    () =>
      `${this.formatDgaDateInputLong(this.dgaDateFrom())} - ${this.formatDgaDateInputLong(this.dgaDateTo())}`,
  );
  dgaSelectedDaysLabel = computed(() => `${this.countDgaSelectedDays()} dias`);
  dgaModalDaysCount = computed(() => {
    const f = this.dgaDateFrom();
    const t = this.dgaDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  dgaModalRangeLabel = computed(() => {
    const from = this.dgaDateFrom();
    const to = this.dgaDateTo();
    if (!from && !to) return 'Sin rango seleccionado';
    const fmt = (s: string) => (s ? s.split('-').reverse().join('/') : '—');
    return `${fmt(from)} — ${fmt(to)}`;
  });

  // Well diagram computed
  wellNivelFreatico = computed(() => this.extractNivelFreatico(this.dashboardData()));
  wellTotalDepth = computed(() => this.extractPozoNumber('profundidad_pozo_m'));
  wellSensorDepth = computed(() => this.extractPozoNumber('profundidad_sensor_m'));
  wellSignalPercent = computed<number | null>(() => {
    const raw = this.findDashboardNumber('señal');
    if (raw === null) return null;
    return Math.round(this.clamp(raw, 0, 100));
  });
  wellFillPercentage = computed(() => {
    const totalDepth = this.wellTotalDepth();
    const nivelFreatico = this.wellNivelFreatico();

    if (totalDepth === null || nivelFreatico === null || totalDepth <= 0) {
      return null;
    }

    return Math.round(this.clamp(((totalDepth - nivelFreatico) / totalDepth) * 100, 0, 100));
  });
  wellFillStylePercent = computed(() => this.wellFillPercentage() ?? 0);
  wellWaterColumnHeightPx = computed(() => Math.round(238 * (this.wellFillStylePercent() / 100)));

  // Monthly flow computed
  private readonly monthShortNames = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  monthlyFlowMonths = computed<MonthlyFlowPoint[]>(() => {
    const points = this.monthlyCountersData();
    if (points.length === 0) return this.monthlyFlowFallback;
    return points.map((p) => {
      const date = new Date(`${p.mes}T00:00:00-04:00`);
      const mes = this.monthShortNames[date.getUTCMonth()] ?? '';
      const yr = String(date.getUTCFullYear()).slice(2);
      return {
        label: `${mes} '${yr}`,
        value: p.delta ?? 0,
        proyeccion: p.proyeccion ?? null,
      };
    });
  });

  monthlyFlowMax = computed<number>(() => {
    const months = this.monthlyFlowMonths();
    let max = 0;
    for (const m of months) {
      if (m.value > max) max = m.value;
      if (m.proyeccion && m.proyeccion > max) max = m.proyeccion;
    }
    if (max <= 0) return 100;
    const padded = max * 1.05;
    const ladder = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
    const norm = padded / magnitude;
    const nice = ladder.find((n) => norm <= n) ?? 10;
    return nice * magnitude;
  });

  monthlyFlowTicks = computed<string[]>(() => {
    const max = this.monthlyFlowMax();
    const fmt = new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return [1, 0.75, 0.5, 0.25, 0].map((f) => fmt.format(max * f));
  });

  monthlyFlowUnit = computed<string>(() => this.monthlyCountersData()[0]?.unidad ?? 'm³');

  private readonly monthlyFlowFallback: MonthlyFlowPoint[] = [
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
  ];

  // SVG Well Diagram — dimensions & layout
  readonly svgW = 300;
  readonly svgH = 476;
  readonly svgWellL = 80;
  readonly svgWellR = 168;
  readonly svgWellTop = 40;
  readonly svgWellBot = 464;
  readonly svgWellH = 424;
  readonly svgAnnotX = 272;
  readonly svgGrassX = [
    6, 14, 22, 30, 42, 52, 176, 186, 198, 210, 222, 234, 246, 258, 270, 282, 292,
  ];

  get svgWaterY(): number {
    const d = this.wellTotalDepth() ?? 18;
    const f = this.wellLevelAnim() ?? this.wellNivelFreatico() ?? 0;
    const safe = d > 0 ? d : 18;
    return Math.round(this.svgWellTop + Math.min(1, Math.max(0, f / safe)) * this.svgWellH);
  }
  get svgSensorY(): number {
    const d = this.wellTotalDepth() ?? 18;
    const s = this.wellSensorDepth() ?? 0;
    const safe = d > 0 ? d : 18;
    return Math.round(this.svgWellTop + Math.min(1, Math.max(0, s / safe)) * this.svgWellH);
  }
  get svgFillPct(): number {
    return this.wellFillStylePercent();
  }
  get svgWavePath(): string {
    const L = this.svgWellL + 4,
      y = this.svgWaterY;
    return `M${L},${y} q13,-9 26,0 q13,9 25,0 q12,-6 25,0`;
  }
  get svgWave2Path(): string {
    const L = this.svgWellL + 4,
      y = this.svgWaterY + 6;
    return `M${L},${y} q19,5 38,0 q19,-5 38,0`;
  }
  get svgTextCX(): number {
    return Math.round((this.svgWellL + this.svgWellR) / 2);
  }
  get svgTextWaterY(): number {
    return Math.round(this.svgWaterY + (this.svgWellBot - this.svgWaterY) * 0.45 + 6);
  }
  get svgDepthMidY(): number {
    return Math.round((this.svgWellTop + this.svgWellBot) / 2);
  }

  // DGA date presets / quick actions / download presets / month names
  readonly dgaDatePresets = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'last7', label: 'Ultimos 7 dias' },
    { id: 'last30', label: 'Ultimos 30 dias' },
    { id: 'thisMonth', label: 'Este mes' },
    { id: 'previousMonth', label: 'Mes anterior' },
  ];

  readonly quickActions = [
    {
      icon: 'database',
      title: 'Datos Historicos',
      subtitle: 'Ver registros',
      color: 'text-primary-container',
      openHistory: true,
    },
    {
      icon: 'download',
      title: 'Descargar',
      subtitle: 'Exportar CSV',
      color: 'text-emerald-600',
      openDownload: true,
    },
    {
      icon: 'open_in_new',
      title: 'Ver en DGA',
      subtitle: 'Portal oficial',
      color: 'text-primary-container',
      openDga: true,
    },
    {
      icon: 'description',
      title: 'Reporte DGA',
      subtitle: 'Formato oficial',
      color: 'text-accent',
      openDgaReport: true,
    },
  ];

  readonly downloadPresets = [
    { id: 'last7', label: 'Últimos 7 días' },
    { id: 'last30', label: 'Últimos 30 días' },
    { id: 'last90', label: 'Últimos 90 días' },
    { id: 'thisYear', label: 'Este año' },
    { id: 'lastYear', label: 'Año pasado' },
  ];

  readonly downloadMonthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  readonly dgaRowsPerPageOptions = [10, 25, 50];

  ngOnInit(): void {
    void this.loadDgaReports();
    this.loadUltimoEnvio(this.siteId());
    this.startMonthlyCountersPolling(this.siteId());
  }

  ngOnDestroy(): void {
    this.monthlyCountersSub?.unsubscribe();
    cancelAnimationFrame(this.wellLevelRafId);
  }

  // DGA methods
  comprobanteUrl(comprobante: string | null | undefined): string | null {
    if (!comprobante) return null;
    const obra = this.obraDga();
    if (!obra) return null;
    return `https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas?codigoObra=${encodeURIComponent(obra)}&numeroComprobante=${encodeURIComponent(comprobante)}`;
  }

  private async loadDgaReports(): Promise<void> {
    const siteId = this.siteId();
    if (!siteId) return;
    this.dgaLoading.set(true);
    try {
      const from = this.dgaDateFrom()
        ? this.toChileStartIso(this.dgaDateFrom())
        : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const to = this.dgaDateTo() ? this.toChileEndIso(this.dgaDateTo()) : new Date().toISOString();
      const rows = await firstValueFrom(this.dgaService.consultarDatoBySite(siteId, from, to));
      this.dgaReportRows.set(rows.map((r, i) => this.datoDgaToRow(r, i)));
    } catch {
      this.dgaReportRows.set([]);
    } finally {
      this.dgaLoading.set(false);
    }
  }

  private datoDgaToRow(r: DatoDgaRow, idx: number): DgaReportRow {
    const estadoMap: Record<DatoDgaRow['estatus'], string> = {
      vacio: 'Pendiente',
      pendiente: 'Pendiente',
      requires_review: 'Revisar',
      enviando: 'Enviando',
      enviado: 'Enviado',
      rechazado: 'Rechazado',
      fallido: 'Fallido',
    };
    const respuestaMap: Record<DatoDgaRow['estatus'], string> = {
      vacio: 'Slot pre-seedeado, aún sin telemetría rellenada',
      pendiente: 'Pendiente de envío a SNIA',
      requires_review: 'Anomalías detectadas — esperando decisión admin',
      enviando: 'Envío a SNIA en curso',
      enviado: 'Medición subterránea ingresada correctamente',
      rechazado: 'Rechazado por MIA-DGA — reintentará en 24h',
      fallido: 'Reintentos agotados — requiere intervención manual',
    };
    return {
      id: `dga-${idx}-${r.ts}`,
      recordId: `${r.fecha}-${r.hora.replace(/:/g, '')}`,
      fecha: `${r.fecha} ${r.hora}`,
      dateIso: r.ts,
      timestampMs: new Date(r.ts).getTime(),
      nivelFreatico: r.nivel_freatico == null ? null : Number(r.nivel_freatico),
      caudal: r.caudal_instantaneo == null ? null : Number(r.caudal_instantaneo),
      totalizador: r.flujo_acumulado == null ? null : Number(r.flujo_acumulado),
      estado: estadoMap[r.estatus] ?? 'Pendiente',
      enviadoDga: r.estatus === 'enviado' ? `${r.fecha} ${r.hora}` : '',
      respuesta: respuestaMap[r.estatus] ?? 'Pendiente',
      comprobante: r.comprobante ?? '',
    };
  }

  private toChileStartIso(dateStr: string): string {
    return `${dateStr}T04:00:00.000Z`;
  }

  private toChileEndIso(dateStr: string): string {
    const d = new Date(`${dateStr}T04:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return new Date(d.getTime() - 1).toISOString();
  }

  private formatDgaDateInputShort(value: string): string {
    const date = this.dateInputToUtcDate(value);
    if (!date) return '--';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
    }).format(date);
  }

  private formatDgaDateInputLong(value: string): string {
    const date = this.dateInputToUtcDate(value);
    if (!date) return '--';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  private countDgaSelectedDays(): number {
    const from = this.dateInputToUtcDate(this.dgaDateFrom());
    const to = this.dateInputToUtcDate(this.dgaDateTo());
    if (!from || !to) return 0;

    const diff = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    return Math.max(0, diff);
  }

  private dateInputToUtcDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  }

  private loadUltimoEnvio(siteId: string): void {
    this.dgaService.getUltimoEnvio(siteId).subscribe({
      next: (row) => this.dgaUltimoEnvio.set(row),
      error: () => this.dgaUltimoEnvio.set(null),
    });
  }

  openDgaDateFilter(): void {
    this.dgaDateFilterOpen.set(true);
  }

  closeDgaDateFilter(): void {
    this.dgaDateFilterOpen.set(false);
  }

  setDgaDateFrom(event: Event): void {
    this.dgaDateFrom.set((event.target as HTMLInputElement).value);
    this.dgaPage.set(1);
  }

  setDgaDateTo(event: Event): void {
    this.dgaDateTo.set((event.target as HTMLInputElement).value);
    this.dgaPage.set(1);
  }

  setDgaRowsPerPage(event: Event): void {
    const parsed = Number((event.target as HTMLSelectElement).value);
    this.dgaRowsPerPage.set(this.dgaRowsPerPageOptions.includes(parsed) ? parsed : 10);
    this.dgaPage.set(1);
  }

  previousDgaPage(): void {
    this.dgaPage.set(Math.max(1, this.dgaPage() - 1));
  }

  nextDgaPage(): void {
    this.dgaPage.set(Math.min(this.dgaTotalPages(), this.dgaPage() + 1));
  }

  openDgaReportDetail(report: DgaReportRow): void {
    this.selectedDgaReport.set(report);
  }

  closeDgaReportDetail(): void {
    this.selectedDgaReport.set(null);
  }

  getDgaStatusBg(estado: string): string {
    if (estado === 'Enviado') return '#F0FDF4';
    if (estado === 'Pendiente' || estado === 'Enviando') return '#FFFBEB';
    if (estado === 'Revisar') return '#FEF3C7';
    return '#FEF2F2';
  }

  getDgaStatusBorder(estado: string): string {
    if (estado === 'Enviado') return '#BBF7D0';
    if (estado === 'Pendiente' || estado === 'Enviando') return '#FDE68A';
    if (estado === 'Revisar') return '#FCD34D';
    return '#FECACA';
  }

  getDgaStatusColor(estado: string): string {
    if (estado === 'Enviado') return '#16A34A';
    if (estado === 'Pendiente' || estado === 'Enviando') return '#D97706';
    if (estado === 'Revisar') return '#B45309';
    return '#DC2626';
  }

  formatDgaNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(2);
  }

  formatDgaInteger(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return Math.trunc(value).toString();
  }

  applyDgaDateFilter(): void {
    this.dgaPage.set(1);
    this.closeDgaDateFilter();
    void this.loadDgaReports();
  }

  clearDgaDateFilter(): void {
    this.dgaDateFrom.set(chileMonthStart());
    this.dgaDateTo.set(chileToday());
    this.dgaPage.set(1);
  }

  applyDgaDatePreset(presetId: string): void {
    this.dgaSelectedMonths.set([]);
    this.dgaSelectedPreset.set(presetId);
    const now = new Date();
    const y = now.getFullYear();
    let from = new Date(now);
    let to = new Date(now);
    switch (presetId) {
      case 'last7':
        from = this.addDays(now, -6);
        break;
      case 'last30':
        from = this.addDays(now, -29);
        break;
      case 'last90':
        from = this.addDays(now, -89);
        break;
      case 'thisYear':
        from = new Date(y, 0, 1);
        break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1);
        to = new Date(y - 1, 11, 31);
        break;
    }
    this.dgaDateFrom.set(this.toDateInputValue(from));
    this.dgaDateTo.set(this.toDateInputValue(to));
    this.dgaPage.set(1);
  }

  applyDgaMonth(monthIndex: number): void {
    if (!this.dgaMonthHasData(monthIndex)) return;
    const current = this.dgaSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter((m) => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.dgaSelectedMonths.set(next);
    this.dgaSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.dgaDateFrom.set(this.toDateInputValue(from));
    this.dgaDateTo.set(this.toDateInputValue(to));
    this.dgaPage.set(1);
  }

  dgaMonthHasData(_monthIndex: number): boolean {
    return true;
  }

  // Monthly flow methods
  private startMonthlyCountersPolling(siteId: string): void {
    this.monthlyCountersLoading.set(true);
    this.monthlyCountersSub?.unsubscribe();

    this.monthlyCountersSub = timer(0, 10 * 60_000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getSiteMonthlyCounters(siteId, { rol: 'totalizador', meses: 12 })
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((res) => {
        this.monthlyCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.monthlyCountersData.set(res.data ?? []);
      });
  }

  formatMonthlyFlowValue(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  getMonthlyFlowHeight(value: number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const max = this.monthlyFlowMax();
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (value / max) * 100));
  }

  getMonthlyFlowProjectionExtra(month: MonthlyFlowPoint): number {
    if (!month.proyeccion || month.proyeccion <= month.value) return 0;
    return this.getMonthlyFlowHeight(month.proyeccion) - this.getMonthlyFlowHeight(month.value);
  }

  // Quick actions
  handleQuickAction(action: {
    openHistory?: boolean;
    openDownload?: boolean;
    openDgaReport?: boolean;
    openDga?: boolean;
  }): void {
    if (action.openDgaReport) {
      this.openDgaReportModal.emit();
      return;
    }
    if (action.openHistory) {
      this.openHistoryPanel.emit();
      return;
    }
    if (action.openDownload) {
      this.openDownloadPanel.emit();
      return;
    }
    if (action.openDga) {
      const obra = this.obraDga();
      if (!obra) return;
      window.open(
        `https://snia.mop.gob.cl/cExtracciones2/#/consultaQR/${encodeURIComponent(obra)}`,
        '_blank',
        'noopener,noreferrer',
      );
    }
  }

  quickActionDisabled(action: { openDga?: boolean }): boolean {
    return action.openDga === true && !this.obraDga();
  }

  quickActionTitle(action: { openDga?: boolean }): string {
    if (action.openDga && !this.obraDga()) {
      return 'Sin número de obra asignado';
    }
    return '';
  }

  // Well diagram helpers
  formatMeters(value: number | null): string {
    if (value === null) return '--';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private extractNivelFreatico(data: SiteDashboardData | null): number | null {
    const variables = data?.variables || [];
    const fromSummary = this.toNumber(data?.resumen?.['nivel_freatico']?.valor);
    if (fromSummary !== null) return fromSummary;

    const fromVariables = variables.find((variable) => {
      if (variable.ok === false) return false;
      const text = this.normalizeSearchText(
        variable.key,
        variable.alias,
        variable.rol_dashboard,
        variable.transformacion,
      );

      return text.includes('nivel freatico');
    });

    const derivedValue = this.toNumber(fromVariables?.valor);
    if (derivedValue !== null) return derivedValue;

    const sensorDepth = this.extractPozoNumber('profundidad_sensor_m');
    const totalDepth = this.extractPozoNumber('profundidad_pozo_m');
    const sourceLevel = variables.find((variable) => {
      if (variable.ok === false) return false;
      const text = this.normalizeSearchText(variable.key, variable.alias, variable.rol_dashboard);
      return (
        !text.includes('freatico') &&
        (text.includes('nivel') || text.includes('level') || text.includes('sonda'))
      );
    });
    const sourceLevelValue = this.toNumber(sourceLevel?.valor);
    const baseDelSensor = sensorDepth !== null && sensorDepth > 0 ? sensorDepth : totalDepth;

    if (
      baseDelSensor !== null &&
      baseDelSensor > 0 &&
      sourceLevelValue !== null &&
      sourceLevelValue >= 0 &&
      sourceLevelValue <= baseDelSensor
    ) {
      return Math.round((baseDelSensor - sourceLevelValue) * 1000) / 1000;
    }

    return null;
  }

  private extractPozoNumber(key: 'profundidad_pozo_m' | 'profundidad_sensor_m'): number | null {
    const dataValue = this.toNumber(this.dashboardData()?.pozo_config?.[key]);
    if (dataValue !== null) return dataValue;

    // Fallback: sitios legacy pueden traer la clave directamente en el objeto de sitio
    return null;
  }

  private findDashboardNumber(role: string): number | null {
    const summaryValue = this.toNumber(this.dashboardData()?.resumen?.[role]?.valor);
    if (summaryValue !== null) return summaryValue;

    const variable = (this.dashboardData()?.variables || []).find((item) => {
      if (item.ok === false) return false;
      const text = this.normalizeSearchText(item.key, item.alias, item.rol_dashboard);
      if (role === 'nivel' && text.includes('freatico')) return false;
      return item.key === role || item.rol_dashboard === role || text.includes(role);
    });

    return this.toNumber(variable?.valor);
  }

  private parseDateInputMs(value: string, boundary: 'start' | 'end'): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = boundary === 'start' ? 0 : 23;
    const minute = boundary === 'start' ? 0 : 59;
    const second = boundary === 'start' ? 0 : 59;
    const millisecond = boundary === 'start' ? 0 : 999;
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const chileParts = new Intl.DateTimeFormat('en-US', {
      timeZone: CHILE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(new Date(utcGuess));
    const part = (type: string) =>
      Number(chileParts.find((item) => item.type === type)?.value || 0);
    const chileAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
      millisecond,
    );

    return utcGuess - (chileAsUtc - utcGuess);
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeSearchText(...values: (string | null | undefined)[]): string {
    return values
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0)
      .join(' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }
}
