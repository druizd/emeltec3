import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of, Subscription, switchMap, timer } from 'rxjs';
import {
  AdministrationService,
  CreateVariableMapPayload,
  PozoConfig,
  SiteRecord,
  SiteTypeCatalogItem,
  SiteTypeCatalogResponse,
  SiteTypeRoleOption,
  SiteTypeTransformOption,
  SiteVariable,
  SiteVariablesPayload,
  VariableMapping,
} from '../../services/administration.service';
import { CompanyService } from '../../services/company.service';
import { CompaniesSiteDetailSkeletonComponent } from './components/companies-site-detail-skeleton';
import { WaterDetailOperacionComponent } from './components/water-detail-operacion/water-detail-operacion';
import { WaterDetailAlertasComponent } from './components/water-detail-alertas/water-detail-alertas';
import { WaterDetailBitacoraComponent } from './components/water-detail-bitacora/water-detail-bitacora';
import { WaterDetailAnalisisComponent } from './components/water-detail-analisis/water-detail-analisis';

interface SiteContext {
  company: any;
  subCompany: any;
  site: any;
}

interface HistoricalTelemetryValue {
  ok?: boolean;
  valor?: string | number | null;
  unidad?: string | null;
  alias?: string | null;
}

interface HistoricalTelemetryApiRow {
  timestamp?: string | null;
  fecha: string;
  caudal?: HistoricalTelemetryValue | null;
  nivel?: HistoricalTelemetryValue | null;
  totalizador?: HistoricalTelemetryValue | null;
  nivel_freatico?: HistoricalTelemetryValue | null;
}

interface HistoricalTelemetryRow {
  id: string;
  fecha: string;
  timestampMs?: number | null;
  caudal: string;
  nivel?: string;
  totalizador: string;
  nivelFreatico: string;
  caudalValue?: number | null;
  nivelValue?: number | null;
  totalizadorValue?: number | null;
  nivelFreaticoValue?: number | null;
  mock?: boolean;
}

interface MonthlyFlowPoint {
  label: string;
  value: number;
}

interface RealtimeMetric {
  label: string;
  value: string;
  unit: string;
}

interface RealtimeChartPoint {
  index: number;
  x: number;
  y: number;
  value: number;
  label: string;
  timestampMs: number;
}

interface RealtimeChartTick {
  x?: number;
  y?: number;
  label: string;
}

interface RealtimeChartTooltip {
  x: number;
  y: number;
  boxX: number;
  boxY: number;
  dateLabel: string;
  valueLabel: string;
}

interface RealtimeChartData {
  points: RealtimeChartPoint[];
  polyline: string;
  yTicks: RealtimeChartTick[];
  xTicks: RealtimeChartTick[];
  tooltip: RealtimeChartTooltip | null;
}

interface DgaReportRow {
  id: string;
  recordId: string;
  fecha: string;
  dateIso: string;
  timestampMs: number;
  nivelFreatico: number;
  caudal: number;
  totalizador: number;
  estado: string;
  enviadoDga: string;
  respuesta: string;
  comprobante: string;
}

interface TelemetryStatusBadge {
  title: string;
  value: string;
  tone: 'ok' | 'warning' | 'empty';
  icon: string;
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
  resumen?: Record<string, { valor?: string | number | null; ok?: boolean; unidad?: string | null } | undefined>;
  variables?: DashboardVariable[];
}

type DetailTab = 'dga' | 'operacion' | 'alertas' | 'bitacora' | 'analisis';
type OperationMode = 'realtime' | 'turnos';
type SettingsStatusType = 'success' | 'error' | '';

interface SettingsStatus {
  type: SettingsStatusType;
  message: string;
}

interface VariableForm {
  mapId: string;
  alias: string;
  d1: string;
  d2: string;
  tipo_dato: string;
  unidad: string;
  rol_dashboard: string;
  transformacion: string;
  factor: string;
  offset: string;
  wordSwap: string;
  sandboxRaw: string;
}

interface PozoConfigForm {
  profundidad_pozo_m: string;
  profundidad_sensor_m: string;
}


const DEFAULT_VARIABLE_FORM: VariableForm = {
  mapId: '',
  alias: '',
  d1: '',
  d2: '',
  tipo_dato: 'FLOAT',
  unidad: '',
  rol_dashboard: 'generico',
  transformacion: 'directo',
  factor: '1',
  offset: '0',
  wordSwap: 'false',
  sandboxRaw: '',
};

const DEFAULT_SITE_TYPE_CATALOG: SiteTypeCatalogResponse = {
  pozo: {
    id: 'pozo',
    label: 'Pozo',
    roles: [
      { id: 'nivel', label: 'Nivel', unitHint: 'm', description: 'Lectura del sensor usada para calcular el nivel freatico del pozo.' },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      { id: 'totalizador', label: 'Totalizador', unitHint: 'm3', description: 'Volumen acumulado.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      { id: 'directo', label: 'Directo', description: 'Usa el valor entrante sin modificarlo.', enabled: true },
      { id: 'lineal', label: 'Lineal', description: 'Aplica valor * factor + offset.', enabled: true },
      { id: 'ieee754_32', label: 'IEEE754 32 bits', description: 'Une dos registros Modbus para obtener FLOAT32.', enabled: true, requiresD2: true },
      { id: 'uint32_registros', label: 'D1 * D2', description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.', enabled: true, requiresD2: true },
    ],
  },
  electrico: {
    id: 'electrico',
    label: 'Electrico',
    roles: [
      { id: 'energia', label: 'Energia', unitHint: 'kWh', description: 'Energia acumulada o consumida.' },
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      { id: 'temperatura', label: 'Temperatura', unitHint: 'C', description: 'Temperatura asociada.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      { id: 'directo', label: 'Directo', description: 'Usa el valor entrante sin modificarlo.', enabled: true },
      { id: 'lineal', label: 'Lineal', description: 'Aplica valor * factor + offset.', enabled: true },
      { id: 'ieee754_32', label: 'IEEE754 32 bits', description: 'Une dos registros Modbus para obtener FLOAT32.', enabled: true, requiresD2: true },
      { id: 'uint32_registros', label: 'D1 * D2', description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.', enabled: true, requiresD2: true },
    ],
  },
  riles: {
    id: 'riles',
    label: 'Riles',
    roles: [
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      { id: 'totalizador', label: 'Totalizador', unitHint: 'm3', description: 'Volumen acumulado.' },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      { id: 'directo', label: 'Directo', description: 'Usa el valor entrante sin modificarlo.', enabled: true },
      { id: 'lineal', label: 'Lineal', description: 'Aplica valor * factor + offset.', enabled: true },
      { id: 'ieee754_32', label: 'IEEE754 32 bits', description: 'Une dos registros Modbus para obtener FLOAT32.', enabled: true, requiresD2: true },
      { id: 'uint32_registros', label: 'D1 * D2', description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.', enabled: true, requiresD2: true },
    ],
  },
  proceso: {
    id: 'proceso',
    label: 'Proceso',
    roles: [
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'temperatura', label: 'Temperatura', unitHint: 'C', description: 'Temperatura de proceso.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      { id: 'directo', label: 'Directo', description: 'Usa el valor entrante sin modificarlo.', enabled: true },
      { id: 'lineal', label: 'Lineal', description: 'Aplica valor * factor + offset.', enabled: true },
      { id: 'ieee754_32', label: 'IEEE754 32 bits', description: 'Une dos registros Modbus para obtener FLOAT32.', enabled: true, requiresD2: true },
      { id: 'uint32_registros', label: 'D1 * D2', description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.', enabled: true, requiresD2: true },
    ],
  },
  generico: {
    id: 'generico',
    label: 'Generico',
    roles: [
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar sin uso especial.' },
    ],
    transforms: [
      { id: 'directo', label: 'Directo', description: 'Usa el valor entrante sin modificarlo.', enabled: true },
      { id: 'lineal', label: 'Lineal', description: 'Aplica valor * factor + offset.', enabled: true },
      { id: 'ieee754_32', label: 'IEEE754 32 bits', description: 'Une dos registros Modbus para obtener FLOAT32.', enabled: true, requiresD2: true },
      { id: 'uint32_registros', label: 'D1 * D2', description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.', enabled: true, requiresD2: true },
    ],
  },
};

@Component({
  selector: 'app-company-site-water-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CompaniesSiteDetailSkeletonComponent,
    WaterDetailOperacionComponent,
    WaterDetailAlertasComponent,
    WaterDetailBitacoraComponent,
    WaterDetailAnalisisComponent,
  ],
  template: `
    <div class="min-h-full bg-[#f0f2f5] px-3 pb-5 pt-3 text-slate-700 md:px-4 xl:px-5">
      @if (loading() && !siteContext()) {
        <app-companies-site-detail-skeleton />
      } @else if (siteContext(); as context) {
        <div class="mx-auto max-w-[1360px] space-y-3">
          <section class="rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div class="grid gap-3 border-b border-slate-100 px-3 py-3 xl:grid-cols-[minmax(360px,1fr)_auto] xl:items-center">
              <div class="flex min-w-0 items-center gap-3">
                <a
                  routerLink="/companies"
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700 transition-colors hover:bg-cyan-100"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[22px]">water_drop</span>
                </a>

                <div class="min-w-0">
                  <h1 class="truncate text-xl font-black leading-tight text-slate-800">{{ getSiteName(context) }}</h1>
                  <p class="truncate text-[11px] font-semibold text-slate-400">{{ context.subCompany.nombre }}</p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold xl:justify-end">
                @for (badge of telemetryStatusBadges(); track badge.title) {
                  <span [class]="telemetryBadgeClass(badge.tone)">
                    <span [class]="telemetryBadgeIconClass(badge.tone)">{{ badge.icon }}</span>
                    <span class="grid leading-tight">
                      <span class="text-[10px] font-black">{{ badge.title }}</span>
                      <span class="text-xs font-black">{{ badge.value }}</span>
                    </span>
                  </span>
                }

                <button
                  type="button"
                  (click)="openSettingsPanel()"
                  class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700"
                  aria-label="Configuracion del sitio"
                >
                  <span class="material-symbols-outlined text-[18px]">settings</span>
                </button>
              </div>
            </div>

            <div class="flex items-center gap-5 px-3" role="tablist" aria-label="Pestañas de detalle del sitio">
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('dga')"
                [class]="getDetailTabClass('dga')"
                [attr.aria-selected]="activeDetailTab() === 'dga'"
                aria-controls="tabpanel-dga"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true">layers</span>
                DGA
                @if (activeDetailTab() === 'dga') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600" aria-hidden="true"></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('operacion')"
                [class]="getDetailTabClass('operacion')"
                [attr.aria-selected]="activeDetailTab() === 'operacion'"
                aria-controls="tabpanel-operacion"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true">monitoring</span>
                Operación
                @if (activeDetailTab() === 'operacion') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600" aria-hidden="true"></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('alertas')"
                [class]="getDetailTabClass('alertas')"
                [attr.aria-selected]="activeDetailTab() === 'alertas'"
                aria-controls="tabpanel-alertas"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true">notifications_active</span>
                Alertas
                @if (activeDetailTab() === 'alertas') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600" aria-hidden="true"></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('bitacora')"
                [class]="getDetailTabClass('bitacora')"
                [attr.aria-selected]="activeDetailTab() === 'bitacora'"
                aria-controls="tabpanel-bitacora"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true">menu_book</span>
                Bitácora
                @if (activeDetailTab() === 'bitacora') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600" aria-hidden="true"></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('analisis')"
                [class]="getDetailTabClass('analisis')"
                [attr.aria-selected]="activeDetailTab() === 'analisis'"
                aria-controls="tabpanel-analisis"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true">insights</span>
                Análisis
                @if (activeDetailTab() === 'analisis') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600" aria-hidden="true"></span>
                }
              </button>
            </div>
          </section>

          @if (settingsPanelOpen()) {
            <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div class="border-b border-slate-100 px-4 py-3">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div class="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      (click)="closeSettingsPanel()"
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                      aria-label="Volver al detalle del sitio"
                    >
                      <span class="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                      <span class="material-symbols-outlined text-[22px]">settings</span>
                    </span>
                    <div class="min-w-0">
                      <p class="truncate text-[11px] font-bold text-slate-400">Configuracion del sitio / {{ siteTypeLabel(settingsSiteType()) }}</p>
                      <h2 class="truncate text-xl font-black leading-none text-slate-800">{{ getSiteName(context) }}</h2>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                    <span class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3">
                      <span class="material-symbols-outlined text-[16px]">memory</span>
                      {{ settingsSiteSerial() || 'Sin serial' }}
                    </span>
                    <button
                      type="button"
                      (click)="reloadSettingsPanel()"
                      [disabled]="settingsLoading()"
                      class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Recargar configuracion"
                    >
                      <span class="material-symbols-outlined text-[18px]" [class.animate-spin]="settingsLoading()">refresh</span>
                    </button>
                  </div>
                </div>

                @if (settingsStatus().message) {
                  <div [class]="settingsStatusClass()">
                    <span class="material-symbols-outlined text-[18px]">{{ settingsStatus().type === 'success' ? 'check_circle' : 'error' }}</span>
                    {{ settingsStatus().message }}
                  </div>
                }
              </div>

              @if (settingsLoading()) {
                <div class="flex min-h-[360px] items-center justify-center bg-slate-50/60">
                  <div class="text-center">
                    <span class="material-symbols-outlined animate-spin text-[34px] text-cyan-600">progress_activity</span>
                    <p class="mt-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Cargando configuracion</p>
                  </div>
                </div>
              } @else {
                <div class="grid gap-5 p-4 xl:grid-cols-[430px_minmax(0,1fr)]">
                  <div class="space-y-4">
                    @if (isSettingsPozo()) {
                      <section class="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4">
                        <div class="mb-4 flex items-start gap-3">
                          <span class="material-symbols-outlined mt-0.5 text-[22px] text-cyan-700">water_drop</span>
                          <div>
                            <h3 class="text-sm font-black text-slate-900">Configuracion manual del pozo</h3>
                            <p class="text-xs font-semibold text-cyan-700">Campos opcionales para proyectar el nivel freatico.</p>
                          </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label class="mb-1 block text-xs font-bold text-slate-500">Profundidad total del pozo (m)</label>
                            <input
                              type="number"
                              step="any"
                              name="settings-pozo-depth"
                              [ngModel]="pozoConfigForm().profundidad_pozo_m"
                              (ngModelChange)="updatePozoConfigForm('profundidad_pozo_m', $event)"
                              class="field-control bg-white"
                              placeholder="Ej: 80"
                            />
                          </div>
                          <div>
                            <label class="mb-1 block text-xs font-bold text-slate-500">Distancia del sensor desde superficie (m)</label>
                            <input
                              type="number"
                              step="any"
                              name="settings-sensor-depth"
                              [ngModel]="pozoConfigForm().profundidad_sensor_m"
                              (ngModelChange)="updatePozoConfigForm('profundidad_sensor_m', $event)"
                              class="field-control bg-white"
                              placeholder="Opcional"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          (click)="savePozoConfig()"
                          [disabled]="settingsBusy() === 'pozo'"
                          class="primary-button mt-4"
                        >
                          <span class="material-symbols-outlined text-[18px]">save</span>
                          {{ settingsBusy() === 'pozo' ? 'Guardando' : 'Guardar configuracion' }}
                        </button>
                      </section>
                    }

                    <form (submit)="createVariableMap($event)" class="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div>
                        <p class="text-sm font-black text-slate-900">Variables del equipo</p>
                        <p class="mt-1 text-xs font-semibold text-slate-400">Se guardan directamente en este sitio, sin seleccionar equipo.</p>
                      </div>

                      <div class="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                        <div class="grid gap-3">
                          <div>
                            <label class="mb-1 block text-xs font-bold text-slate-500">Dato original</label>
                            <select
                              required
                              name="settings-variable-key"
                              [ngModel]="variableForm().d1"
                              (ngModelChange)="selectVariableKey($event)"
                              class="field-control bg-white"
                            >
                              <option value="" disabled>Selecciona variable</option>
                              @for (variable of siteVariables().variables; track variable.nombre_dato) {
                                <option [value]="variable.nombre_dato">{{ variable.nombre_dato }}</option>
                              }
                            </select>
                          </div>

                          <div>
                            <label class="mb-1 block text-xs font-bold text-slate-500">Transformacion</label>
                            <select
                              name="settings-variable-transform"
                              [ngModel]="variableForm().transformacion"
                              (ngModelChange)="updateVariableTransform($event)"
                              class="field-control bg-white"
                            >
                              @for (transform of variableTransformOptions(); track transform.id) {
                                <option [value]="transform.id">{{ transform.label }}</option>
                              }
                            </select>
                            @if (selectedVariableTransform()?.description) {
                              <p class="mt-1 text-xs font-semibold text-slate-400">{{ selectedVariableTransform()?.description }}</p>
                            }
                          </div>

                          @if (requiresSecondRegister()) {
                            <div class="grid gap-3 sm:grid-cols-2">
                              <div>
                                <label class="mb-1 block text-xs font-bold text-slate-500">Segundo registro</label>
                                <select
                                  name="settings-variable-key-d2"
                                  [ngModel]="variableForm().d2"
                                  (ngModelChange)="updateVariableForm('d2', $event)"
                                  class="field-control bg-white"
                                >
                                  <option value="">Selecciona variable</option>
                                  @for (variable of siteVariables().variables; track variable.nombre_dato) {
                                    <option [value]="variable.nombre_dato">{{ variable.nombre_dato }}</option>
                                  }
                                </select>
                              </div>
                              @if (usesRegisterOrder()) {
                              <div>
                                <label class="mb-1 block text-xs font-bold text-slate-500">Orden de registros</label>
                                <select
                                  name="settings-variable-word-swap"
                                  [ngModel]="variableForm().wordSwap"
                                  (ngModelChange)="updateVariableForm('wordSwap', $event)"
                                  class="field-control bg-white"
                                >
                                  @if (isUint32TransformSelected()) {
                                  <option value="true">Invertido CDAB</option>
                                  <option value="false">Normal ABCD</option>
                                  } @else {
                                  <option value="false">Normal ABCD</option>
                                  <option value="true">Invertido CDAB</option>
                                  }
                                </select>
                                <p class="mt-1 text-xs font-semibold text-slate-400">{{ registerOrderHint() }}</p>
                              </div>
                              } @else {
                              <div class="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800">
                                Formula: {{ variableForm().d1 || 'primer registro' }} * {{ variableForm().d2 || 'segundo registro' }}
                              </div>
                              }
                            </div>
                          }
                      </div>
                    </div>

                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Alias</label>
                        <input
                          required
                          name="settings-variable-alias"
                          [ngModel]="variableForm().alias"
                          (ngModelChange)="updateVariableForm('alias', $event)"
                          class="field-control"
                          placeholder="Nivel, caudal, energia"
                        />
                      </div>

                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Uso en dashboard</label>
                        <select
                          name="settings-variable-role"
                          [ngModel]="variableForm().rol_dashboard"
                          (ngModelChange)="updateVariableRole($event)"
                          class="field-control"
                        >
                          @for (role of variableRoleOptions(); track role.id) {
                            <option [value]="role.id">{{ role.label }}</option>
                          }
                        </select>
                        @if (selectedVariableRole()?.description) {
                          <p class="mt-1 text-xs font-semibold text-slate-400">{{ selectedVariableRole()?.description }}</p>
                        }
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Tipo</label>
                          <select
                            name="settings-variable-type"
                            [ngModel]="variableForm().tipo_dato"
                            (ngModelChange)="updateVariableForm('tipo_dato', $event)"
                            class="field-control"
                          >
                            <option value="FLOAT">FLOAT</option>
                            <option value="INTEGER">INTEGER</option>
                            <option value="BOOLEAN">BOOLEAN</option>
                            <option value="TEXT">TEXT</option>
                          </select>
                        </div>
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Unidad</label>
                          <input
                            name="settings-variable-unit"
                            [ngModel]="variableForm().unidad"
                            (ngModelChange)="updateVariableForm('unidad', $event)"
                            class="field-control"
                            placeholder="m, %, L/s"
                          />
                        </div>
                      </div>

                      @if (isLinearTransform()) {
                        <div class="grid grid-cols-2 gap-3">
                          <div>
                            <label class="mb-1 block text-xs font-bold text-slate-500">Factor Multiplicador</label>
                            <input
                              type="number"
                              step="any"
                              name="settings-variable-factor"
                              [ngModel]="variableForm().factor"
                              (ngModelChange)="updateVariableForm('factor', $event)"
                              class="field-control"
                              placeholder="1"
                            />
                          </div>
                          <div>
                            <label class="mb-1 block text-xs font-bold text-slate-500">Offset</label>
                            <input
                              type="number"
                              step="any"
                              name="settings-variable-offset"
                              [ngModel]="variableForm().offset"
                              (ngModelChange)="updateVariableForm('offset', $event)"
                              class="field-control"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      }

                      <div class="rounded-lg border border-cyan-100 bg-cyan-50/60 p-3">
                        <div class="mb-3 flex items-center gap-2">
                          <span class="material-symbols-outlined text-[18px] text-cyan-700">calculate</span>
                          <h3 class="text-xs font-black uppercase tracking-[0.16em] text-cyan-800">Calculadora de prueba (vista previa)</h3>
                        </div>

                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Valor crudo entrante</label>
                          <input
                            name="settings-variable-sandbox-raw"
                            [ngModel]="variableForm().sandboxRaw"
                            (ngModelChange)="updateVariableForm('sandboxRaw', $event)"
                            class="field-control bg-white"
                            placeholder="Ej: 14.7"
                          />
                        </div>

                        <div class="mt-3 rounded-lg border border-cyan-100 bg-white px-3 py-2 shadow-sm">
                          <p class="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Resultado proyectado en grafico</p>
                          <p class="mt-1 text-xl font-black text-cyan-800">{{ previewResultText() }}</p>
                        </div>

                        <div class="mt-3 grid gap-2">
                          @for (transform of variableTransformOptions(); track transform.id) {
                            <button
                              type="button"
                              (click)="updateVariableTransform(transform.id)"
                              [class]="calculatorButtonClass(transform.id)"
                            >
                              <span class="material-symbols-outlined text-[16px]">functions</span>
                              <span>{{ transform.label }}</span>
                            </button>
                          }
                        </div>
                      </div>

                      <div class="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          (click)="resetVariableForm()"
                          class="secondary-button"
                        >
                          Limpiar
                        </button>
                        <button type="submit" [disabled]="settingsBusy() === 'variable'" class="primary-button">
                          <span class="material-symbols-outlined text-[18px]">label</span>
                          {{ settingsBusy() === 'variable' ? 'Guardando' : (variableForm().mapId ? 'Actualizar variable' : 'Guardar variable') }}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                      <h3 class="text-sm font-black text-slate-900">Datos detectados del equipo</h3>
                      <p class="text-xs font-semibold text-slate-400">{{ siteVariables().variables.length }} variables</p>
                    </div>

                    <div class="overflow-x-auto">
                      <table class="w-full min-w-[700px] text-left text-sm">
                        <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th class="px-4 py-3">Dato</th>
                            <th class="px-4 py-3">Valor</th>
                            <th class="px-4 py-3">Alias</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (variable of siteVariables().variables; track variable.nombre_dato) {
                            <tr
                              class="group cursor-pointer bg-white transition-colors hover:bg-cyan-50/50"
                              (click)="prepareVariableMap(variable)"
                              title="Seleccionar variable"
                            >
                              <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">{{ variable.nombre_dato }}</td>
                              <td class="px-4 py-3 font-bold text-slate-900">{{ displayValue(variable.valor_dato) }}</td>
                              <td class="px-4 py-3">
                                <div class="flex items-center justify-between gap-3">
                                  @if (variable.mapping) {
                                    <div>
                                      <p class="font-bold text-slate-800">{{ variable.mapping.alias }}</p>
                                      <p class="text-xs text-slate-400">
                                        {{ variable.mapping.tipo_dato }} - {{ displayVariableTransform(variable.mapping.transformacion) }} {{ variable.mapping.unidad || '' }}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      (click)="$event.stopPropagation(); deleteVariableMap(variable.mapping)"
                                      class="icon-button shrink-0 text-red-500 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                                      title="Eliminar alias"
                                      aria-label="Eliminar alias"
                                    >
                                      <span class="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                  } @else {
                                    <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">Sin alias</span>
                                  }
                                </div>
                              </td>
                            </tr>
                          } @empty {
                            <tr class="bg-white">
                              <td colspan="3" class="px-4 py-8 text-center text-sm font-semibold text-slate-400">Aun no hay variables detectadas para el serial de este sitio.</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              }
            </section>
          } @else if (historyPanelOpen()) {
            <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div class="border-b border-slate-100 px-4 py-3">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div class="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      (click)="closeHistoryView()"
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                      aria-label="Volver al detalle del pozo"
                    >
                      <span class="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                      <span class="material-symbols-outlined text-[22px]">database</span>
                    </span>
                    <div class="min-w-0">
                      <p class="truncate text-[11px] font-bold text-slate-400">Sitios / {{ context.subCompany.nombre }} / Datos Historicos</p>
                      <h2 class="truncate text-xl font-black leading-none text-slate-800">{{ getSiteName(context) }}</h2>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 text-xs font-bold">
                    <button
                      type="button"
                      (click)="openDownloadModal()"
                      class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      <span class="material-symbols-outlined text-[16px]">download</span>
                      Descargar
                    </button>
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
                      aria-label="Opciones de historico"
                    >
                      <span class="material-symbols-outlined text-[18px]">settings</span>
                    </button>
                  </div>
                </div>

                <div class="mt-4 flex flex-wrap items-end gap-2 text-xs font-bold text-slate-500">
                  <label class="grid gap-1">
                    <span>Desde</span>
                    <input
                      type="date"
                      [value]="historyDateFrom()"
                      (input)="setHistoryDateFrom($event)"
                      class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span>Hasta</span>
                    <input
                      type="date"
                      [value]="historyDateTo()"
                      (input)="setHistoryDateTo($event)"
                      class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span>Registros</span>
                    <select
                      [value]="historyRecordLimit()"
                      (change)="setHistoryRecordLimit($event)"
                      class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    >
                      @for (limit of historyRecordLimitOptions; track limit) {
                        <option [value]="limit">{{ limit }}</option>
                      }
                    </select>
                  </label>
                  <button
                    type="button"
                    (click)="clearHistoryFilters()"
                    class="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[11px] font-black uppercase tracking-wide text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <h3 class="text-sm font-black text-slate-800">Datos Historicos</h3>
                  <p class="mt-0.5 text-xs font-semibold text-slate-400">
                    @if (historyLoading()) {
                      Actualizando registros...
                    } @else if (isHistoryMock()) {
                      Vista referencial para pozos sin telemetria activa
                    } @else {
                      Registros minuto a minuto
                    }
                  </p>
                </div>
                <p class="text-xs font-semibold text-slate-400">{{ currentHistoryPageCount() }} registros en esta pagina</p>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full min-w-[1040px] text-left text-xs">
                  <thead class="bg-slate-50">
                    <tr class="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                      <th class="px-4 py-3">FECHA</th>
                      <th class="px-4 py-3">CAUDAL</th>
                      <th class="px-4 py-3">NIVEL</th>
                      <th class="px-4 py-3">TOTALIZADOR</th>
                      <th class="px-4 py-3">NIVEL FRE&Aacute;TICO</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of paginatedHistoryRows(); track row.id) {
                      <tr class="border-t border-slate-100 text-[13px] font-semibold text-slate-600 odd:bg-white even:bg-slate-50/60">
                        <td class="px-4 py-3">
                          <span class="inline-flex items-center gap-2">
                            <span class="h-1.5 w-1.5 rounded-full bg-cyan-500"></span>
                            {{ row.fecha }}
                          </span>
                        </td>
                        <td class="px-4 py-3">{{ row.caudal }}</td>
                        <td class="px-4 py-3">{{ row.nivel || '--' }}</td>
                        <td class="px-4 py-3">{{ row.totalizador }}</td>
                        <td class="px-4 py-3">{{ row.nivelFreatico }}</td>
                      </tr>
                    } @empty {
                      <tr class="border-t border-slate-100 text-[12px] font-semibold text-slate-400">
                        <td class="px-4 py-8 text-center" colspan="5">Sin registros disponibles para este filtro.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-400">
                <span>Filas por pagina: 50 &middot; {{ historyRangeStart() }}-{{ historyRangeEnd() }} de {{ historyTotalRows() }}</span>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="previousHistoryPage()"
                    [disabled]="historyPage() === 1"
                    class="h-8 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    &larr;
                  </button>
                  <span class="min-w-16 text-center">Pag. {{ historyPage() }} / {{ historyTotalPages() }}</span>
                  <button
                    type="button"
                    (click)="nextHistoryPage()"
                    [disabled]="historyPage() === historyTotalPages()"
                    class="h-8 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    &rarr;
                  </button>
                </div>
              </div>
            </section>
          } @else if (activeDetailTab() === 'dga') {
            <div class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-emerald-700">
              <span class="material-symbols-outlined text-[16px]">verified</span>
              <span class="text-[11px] font-bold">Último reporte DGA aceptado</span>
              <span class="text-[11px] text-emerald-500">·</span>
              <span class="font-mono text-[11px] font-bold">07/04/2026 06:00 – 07:00</span>
            </div>
            <section class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Enviados</p>
              <p class="mt-1 text-3xl font-black leading-none text-emerald-600">622</p>
              <p class="mt-1 text-xs font-semibold text-emerald-500">registros exitosos</p>
            </article>

            <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Último envío</p>
              <p class="mt-1 text-lg font-black leading-none text-slate-800">26 abr 2026</p>
              <p class="mt-1 text-xs font-semibold text-slate-500">21:00</p>
            </article>

            <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Tasa de exito</p>
              <p class="mt-1 text-3xl font-black leading-none text-slate-800">100%</p>
            </article>

            <article class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-rose-400">Rechazados</p>
              <p class="mt-1 text-3xl font-black leading-none text-rose-500">0</p>
              <p class="mt-1 text-xs font-semibold text-rose-400">por la DGA</p>
            </article>
          </section>

          <section class="grid grid-cols-1 gap-3 xl:grid-cols-[520px_minmax(0,1fr)] xl:items-start">
            <div class="space-y-3">
            <article class="rounded-xl border border-cyan-200 bg-white p-3 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]">
              <p class="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Diagrama del pozo</p>

              @if (dashboardLoading()) {
                <div class="flex min-h-[360px] items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                  <div class="text-center">
                    <span class="material-symbols-outlined animate-spin text-[32px] text-cyan-600">progress_activity</span>
                    <p class="mt-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Cargando datos del pozo</p>
                  </div>
                </div>
              } @else {
                <div class="flex gap-3 items-start">
                  <!-- SVG Well Diagram (flex:1) -->
                  <div style="flex:1;min-width:0;overflow:visible">
                  <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH" style="width:100%;height:auto;display:block;overflow:visible">
                    <style>
                      @keyframes wdiagWave1{0%,100%{transform:translateX(0)}50%{transform:translateX(-7px)}}
                      @keyframes wdiagWave2{0%,100%{transform:translateX(0)}50%{transform:translateX(6px)}}
                      @keyframes wdiagBubble{
                        0%{opacity:0;transform:translateY(0)}
                        8%{opacity:0.62}
                        78%{opacity:0.22}
                        100%{opacity:0;transform:translateY(-580px)}
                      }
                      .wdiag-w1{animation:wdiagWave1 3s ease-in-out infinite}
                      .wdiag-w2{animation:wdiagWave2 4.8s ease-in-out infinite}
                      .wdiag-b{
                        animation-name:wdiagBubble;
                        animation-timing-function:ease-in;
                        animation-iteration-count:infinite;
                        animation-fill-mode:both;
                        animation-duration:var(--d,4s);
                        animation-delay:var(--e,0s);
                      }
                    </style>
                    <defs>
                      <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#8EEAF1" stop-opacity="0.85"/>
                        <stop offset="18%" stop-color="#0DAFBD" stop-opacity="0.92"/>
                        <stop offset="65%" stop-color="#067D88" stop-opacity="0.97"/>
                        <stop offset="100%" stop-color="#034851" stop-opacity="1"/>
                      </linearGradient>
                      <radialGradient id="shimmer" cx="40%" cy="25%" r="55%">
                        <stop offset="0%" stop-color="white" stop-opacity="0.22"/>
                        <stop offset="100%" stop-color="white" stop-opacity="0"/>
                      </radialGradient>
                      <pattern id="dots" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                        <rect width="8" height="8" fill="#F5EDD8"/>
                        <circle cx="3" cy="3" r="1" fill="#C4A882" opacity="0.6"/>
                        <circle cx="7" cy="7" r="0.7" fill="#C4A882" opacity="0.4"/>
                      </pattern>
                      <clipPath id="wellClip">
                        <rect [attr.x]="svgWellL+4" [attr.y]="svgWellTop" [attr.width]="svgWellR-svgWellL-8" [attr.height]="svgWellH"/>
                      </clipPath>
                    </defs>

                    <!-- Soil left -->
                    <rect x="0" [attr.y]="svgWellTop" [attr.width]="svgWellL" [attr.height]="svgWellH" fill="url(#dots)"/>
                    <!-- Soil right (extended to SVG edge so annotation zone has background) -->
                    <rect [attr.x]="svgWellR" [attr.y]="svgWellTop" [attr.width]="svgW-svgWellR" [attr.height]="svgWellH" fill="url(#dots)"/>

                    <!-- Ground surface band -->
                    <rect x="0" y="0" [attr.width]="svgW" [attr.height]="svgWellTop" fill="#8B7355" opacity="0.15"/>
                    <line x1="0" [attr.y1]="svgWellTop" [attr.x2]="svgW" [attr.y2]="svgWellTop" stroke="#8B7355" stroke-width="2"/>

                    <!-- Grass marks -->
                    @for (gx of svgGrassX; track gx) {
                      <line [attr.x1]="gx" [attr.y1]="svgWellTop" [attr.x2]="gx-3" [attr.y2]="svgWellTop-7" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    }

                    <!-- Well casing — empty air gap -->
                    <rect [attr.x]="svgWellL+4" [attr.y]="svgWellTop" [attr.width]="svgWellR-svgWellL-8" [attr.height]="svgWaterY-svgWellTop" fill="#F0F9FF" opacity="0.9"/>

                    <!-- Water fill (gradient) -->
                    <rect [attr.x]="svgWellL+4" [attr.y]="svgWaterY" [attr.width]="svgWellR-svgWellL-8" [attr.height]="svgWellBot-svgWaterY" fill="url(#wg)" clip-path="url(#wellClip)"/>
                    <!-- Water shimmer overlay -->
                    <rect [attr.x]="svgWellL+4" [attr.y]="svgWaterY" [attr.width]="svgWellR-svgWellL-8" [attr.height]="svgWellBot-svgWaterY" fill="url(#shimmer)" clip-path="url(#wellClip)"/>
                    <!-- Surface refraction stripe -->
                    <rect [attr.x]="svgWellL+7" [attr.y]="svgWaterY+3" [attr.width]="svgWellR-svgWellL-16" height="4" fill="white" opacity="0.28" rx="2" clip-path="url(#wellClip)"/>
                    <!-- Caustic light patches near bottom -->
                    <ellipse [attr.cx]="svgTextCX-9" [attr.cy]="svgWellBot-24" rx="9" ry="3" fill="white" opacity="0.07" clip-path="url(#wellClip)"/>
                    <ellipse [attr.cx]="svgTextCX+7" [attr.cy]="svgWellBot-40" rx="6" ry="2" fill="white" opacity="0.05" clip-path="url(#wellClip)"/>

                    <!-- Wave surface (primary, animated) -->
                    <g class="wdiag-w1" clip-path="url(#wellClip)">
                      <path [attr.d]="svgWavePath" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
                    </g>
                    <!-- Wave surface (secondary, animated opposite direction) -->
                    <g class="wdiag-w2" clip-path="url(#wellClip)">
                      <path [attr.d]="svgWave2Path" fill="none" stroke="rgba(13,175,189,0.45)" stroke-width="1.2"/>
                    </g>
                    <!-- Bubbles rising from bottom -->
                    <g clip-path="url(#wellClip)">
                      <circle class="wdiag-b" style="--d:4s;--e:0s"     cx="97"  [attr.cy]="svgWellBot-22" r="2"   fill="rgba(255,255,255,0.82)"/>
                      <circle class="wdiag-b" style="--d:5.5s;--e:1.4s" cx="131" [attr.cy]="svgWellBot-40" r="1.5" fill="rgba(255,255,255,0.70)"/>
                      <circle class="wdiag-b" style="--d:3.8s;--e:2.7s" cx="113" [attr.cy]="svgWellBot-13" r="2.5" fill="rgba(255,255,255,0.75)"/>
                      <circle class="wdiag-b" style="--d:5s;--e:0.6s"   cx="145" [attr.cy]="svgWellBot-52" r="1.8" fill="rgba(255,255,255,0.65)"/>
                      <circle class="wdiag-b" style="--d:4.3s;--e:3.8s" cx="104" [attr.cy]="svgWellBot-30" r="1.2" fill="rgba(255,255,255,0.80)"/>
                      <circle class="wdiag-b" style="--d:6s;--e:2s"     cx="122" [attr.cy]="svgWellBot-8"  r="1.8" fill="rgba(255,255,255,0.68)"/>
                    </g>

                    <!-- Fill % label inside water -->
                    @if (svgFillPct > 12) {
                      <text [attr.x]="svgTextCX" [attr.y]="svgTextWaterY" font-size="15" font-weight="700" fill="white" text-anchor="middle" font-family="JetBrains Mono" opacity="0.9">{{ svgFillPct }}%</text>
                    }

                    <!-- Well walls -->
                    <rect [attr.x]="svgWellL" [attr.y]="svgWellTop" width="8" [attr.height]="svgWellH" fill="#94A3B8" rx="2"/>
                    <rect [attr.x]="svgWellR-8" [attr.y]="svgWellTop" width="8" [attr.height]="svgWellH" fill="#94A3B8" rx="2"/>
                    <rect [attr.x]="svgWellL" [attr.y]="svgWellBot-6" [attr.width]="svgWellR-svgWellL" height="7" fill="#64748B" rx="2"/>

                    <!-- Sensor: only shown when depth data exists, right wall, proportional -->
                    @if (wellSensorDepth() !== null) {
                      <!-- Vertical depth guide from well top to sensor -->
                      <line [attr.x1]="svgWellR-4" [attr.y1]="svgWellTop" [attr.x2]="svgWellR-4" [attr.y2]="svgSensorY" stroke="#F97316" stroke-width="1" stroke-dasharray="3 3" opacity="0.35"/>
                      <!-- Horizontal indicator from right wall outward -->
                      <line [attr.x1]="svgWellR" [attr.y1]="svgSensorY" [attr.x2]="svgWellR+18" [attr.y2]="svgSensorY" stroke="#F97316" stroke-width="1.5" stroke-dasharray="3 2"/>
                      <!-- Sensor marker -->
                      <rect [attr.x]="svgWellR+18" [attr.y]="svgSensorY-5" width="9" height="10" fill="#F97316" rx="2"/>
                      <!-- Sensor label -->
                      <text [attr.x]="svgWellR+30" [attr.y]="svgSensorY+5" font-size="12" fill="#F97316" font-family="DM Sans" font-weight="600">Sensor</text>
                    }

                    <!-- RIGHT BRACKET: Superficie → Nivel Freático (dynamic) -->
                    <!-- Superficie circle (at ground level) -->
                    <circle [attr.cx]="svgAnnotX" [attr.cy]="svgWellTop" r="3" fill="#64748B"/>
                    <!-- Superficie label: left-center, higher above line -->
                    <text x="124" [attr.y]="svgWellTop-16" font-size="9" fill="#64748B" font-family="DM Sans" font-weight="600" text-anchor="middle">Superficie</text>

                    <!-- Vertical dashed line: Superficie → Nivel Freático -->
                    <line [attr.x1]="svgAnnotX" [attr.y1]="svgWellTop+3" [attr.x2]="svgAnnotX" [attr.y2]="svgWaterY-3" stroke="#0DAFBD" stroke-width="1.5" stroke-dasharray="4 3"/>

                    <!-- Nivel Freático circle + horizontal line into well -->
                    <circle [attr.cx]="svgAnnotX" [attr.cy]="svgWaterY" r="3" fill="#0DAFBD"/>
                    <line [attr.x1]="svgAnnotX" [attr.y1]="svgWaterY" [attr.x2]="svgWellR-5" [attr.y2]="svgWaterY" stroke="#0DAFBD" stroke-width="1.5" stroke-dasharray="4 2"/>
                    <!-- Nivel Freático label: centered above the horizontal dashed line -->
                    <text [attr.x]="(svgAnnotX + svgWellR - 5) / 2" [attr.y]="svgWaterY-7" font-size="12" fill="#0DAFBD" font-family="DM Sans" font-weight="700" text-anchor="middle">Nv. Freático</text>

                    <!-- Left depth arrow -->
                    <line [attr.x1]="svgWellL-10" [attr.y1]="svgWellTop+2" [attr.x2]="svgWellL-10" [attr.y2]="svgWellBot-2" stroke="#CBD5E1" stroke-width="1"/>
                    <line [attr.x1]="svgWellL-14" [attr.y1]="svgWellTop+2" [attr.x2]="svgWellL-6" [attr.y2]="svgWellTop+2" stroke="#CBD5E1" stroke-width="1"/>
                    <line [attr.x1]="svgWellL-14" [attr.y1]="svgWellBot-2" [attr.x2]="svgWellL-6" [attr.y2]="svgWellBot-2" stroke="#CBD5E1" stroke-width="1"/>
                    <text [attr.x]="svgWellL-12" [attr.y]="svgDepthMidY+4" font-size="13" fill="#94A3B8" font-family="JetBrains Mono" text-anchor="middle"
                      [attr.transform]="'rotate(-90,' + (svgWellL-12) + ',' + svgDepthMidY + ')'">{{ wellTotalDepth() ?? 18 }}m prof.</text>
                  </svg>
                  </div>
                  <!-- Stats column (derecha) -->
                  <div class="flex flex-col gap-2" style="flex-shrink:0;width:124px">
                    <div style="background:rgba(13,175,189,0.06);border:1px solid rgba(13,175,189,0.2);border-radius:8px;padding:8px 10px">
                      <p style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;margin-bottom:3px">Nv. Freático</p>
                      <p style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#0DAFBD;line-height:1">
                        {{ formatMeters(wellNivelFreatico()) }}<span style="font-size:11px;color:#64748B;margin-left:2px">m</span>
                      </p>
                      <p style="font-size:9px;color:#94A3B8;margin-top:2px">desde superficie</p>
                    </div>
                    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px 10px">
                      <p style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;margin-bottom:3px">Llenado</p>
                      <p style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#1E293B;line-height:1">
                        {{ svgFillPct }}<span style="font-size:11px;color:#64748B">%</span>
                      </p>
                      <div style="margin-top:5px;height:4px;background:#E2E8F0;border-radius:999px;overflow:hidden">
                        <div [style.width.%]="wellFillStylePercent()" style="height:100%;background:linear-gradient(90deg,#0DAFBD,#22C55E);border-radius:999px"></div>
                      </div>
                    </div>
                    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px 10px">
                      <p style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;margin-bottom:3px">Prof. Total</p>
                      <p style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:#475569;line-height:1">{{ formatMeters(wellTotalDepth()) }} m</p>
                    </div>
                    <div style="background:#FFF7F0;border:1px solid #FED7AA;border-radius:8px;padding:8px 10px">
                      <p style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#F97316;margin-bottom:3px">Sensor</p>
                      <p style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:#475569;line-height:1">{{ formatMeters(wellSensorDepth()) }} m</p>
                    </div>
                    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:8px 10px">
                      <p style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0369A1;margin-bottom:3px">% Señal</p>
                      <p style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#0284C7;line-height:1">87<span style="font-size:11px;color:#64748B">%</span></p>
                      <div style="margin-top:5px;height:4px;background:#E2E8F0;border-radius:999px;overflow:hidden">
                        <div style="width:87%;height:100%;background:linear-gradient(90deg,#0284C7,#22C55E);border-radius:999px"></div>
                      </div>
                    </div>
                    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px 10px">
                      <p style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;margin-bottom:3px">Último dato recibido</p>
                      <p style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#1E293B;line-height:1">{{ latestDeviceTimeLabel() }}</p>
                      <p style="font-size:9px;color:#94A3B8;margin-top:3px">{{ latestDeviceDateLabel() }}</p>
                    </div>
                  </div>
                </div>
              }
            </article>
            </div>

            <div class="space-y-3">
              <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <span class="material-symbols-outlined text-[22px]">bar_chart</span>
                    </span>
                    <div class="min-w-0">
                      <h2 class="truncate text-xl font-black leading-none text-slate-800">Flujo Mensual</h2>
                      <p class="mt-1 text-sm font-bold text-slate-400">Volumen acumulado en m³</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 text-xs font-bold text-slate-400">
                    <span class="inline-flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-[16px]">info</span>
                      Últimos 12 meses
                    </span>
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-slate-50" aria-label="Opciones de grafico">
                      <span class="material-symbols-outlined text-[18px]">more_vert</span>
                    </button>
                  </div>
                </div>

                <div class="mt-5 grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                  <div class="grid h-[250px] grid-rows-5 text-right text-xs font-semibold text-slate-400">
                    @for (tick of monthlyFlowTicks; track tick) {
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

                    <div class="absolute inset-x-2 bottom-0 top-0 flex items-end justify-between gap-2">
                      @for (month of monthlyFlowMonths; track month.label) {
                        <div class="flex h-full min-w-0 flex-1 flex-col justify-end">
                          <div
                            class="mx-auto w-full max-w-[28px] rounded-t bg-[#5874c8] shadow-sm transition-opacity hover:opacity-85"
                            [style.height.%]="getMonthlyFlowHeight(month.value)"
                            [title]="month.label + ': ' + formatMonthlyFlowValue(month.value) + ' m³'"
                          ></div>
                        </div>
                      }
                    </div>
                  </div>
                </div>

                <div class="ml-[66px] mt-2 flex justify-between gap-2 text-[11px] font-bold text-slate-400">
                  @for (month of monthlyFlowMonths; track month.label) {
                    <span class="block min-w-0 flex-1 origin-top-left truncate text-center" style="transform: rotate(-35deg);">{{ month.label }}</span>
                  }
                </div>
              </article>

              <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p class="mb-2 text-sm font-black text-slate-700">Acciones Rápidas</p>
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  @for (action of quickActions; track action.title) {
                    <button
                      type="button"
                      (click)="handleQuickAction(action)"
                      class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-all hover:border-cyan-200 hover:bg-white hover:shadow-sm"
                    >
                      <span [class]="'material-symbols-outlined text-[20px] ' + action.color">{{ action.icon }}</span>
                      <p class="mt-0.5 text-sm font-black text-slate-800">{{ action.title }}</p>
                      <p class="text-xs font-medium text-slate-400">{{ action.subtitle }}</p>
                    </button>
                  }
                </div>
              </article>
            </div>
          </section>
          <!-- Registros DGA -->
          <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 class="text-sm font-black text-slate-800">Detalle de Registros</h2>
                <p class="mt-1 text-xs font-semibold text-slate-400">Reportes completos enviados a la DGA</p>
              </div>

              <div class="flex flex-wrap items-center gap-2 text-xs font-bold">
                <button
                  type="button"
                  (click)="openDgaDateFilter()"
                  class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-slate-600 transition-colors hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  <span class="material-symbols-outlined text-[16px]">calendar_month</span>
                  {{ dgaSelectedRangeLabel() }}
                </button>
                <span class="text-slate-400">{{ dgaTotalRecordsLabel() }}</span>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full min-w-[960px] text-left text-sm">
                <thead style="background:#F8FAFC">
                  <tr style="border-bottom:1px solid #F1F5F9">
                    @for (h of ['Fecha','Nv. Freático [m]','Caudal [l/s]','Totalizador [m³]','Estado']; track h) {
                      <th class="px-4 py-[9px] text-left" style="font-family:'Josefin Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94A3B8">{{ h }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (report of paginatedDgaReports(); track report.id) {
                    <tr style="border-bottom:1px solid #F1F5F9">
                      <td class="px-4 py-[9px]" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#94A3B8">{{ report.fecha }}</td>
                      <td class="px-4 py-[9px]" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#1E293B">{{ formatDgaNumber(report.nivelFreatico) }}</td>
                      <td class="px-4 py-[9px]" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#1E293B">{{ formatDgaNumber(report.caudal) }}</td>
                      <td class="px-4 py-[9px]" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#1E293B">{{ formatDgaInteger(report.totalizador) }}</td>
                      <td class="px-4 py-3">
                        <button
                          type="button"
                          (click)="openDgaReportDetail(report)"
                          class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors"
                          [style.background]="getDgaStatusBg(report.estado)"
                          [style.border-color]="getDgaStatusBorder(report.estado)"
                          [style.color]="getDgaStatusColor(report.estado)"
                        >
                          <span class="h-[5px] w-[5px] rounded-full" [style.background]="getDgaStatusColor(report.estado)"></span>
                          {{ report.estado }}
                          <span class="material-symbols-outlined text-[13px]">chevron_right</span>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="5" class="px-4 py-8 text-center text-sm font-semibold text-slate-400">Sin registros para el periodo seleccionado.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-5 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500">
              <label class="inline-flex items-center gap-2">
                Filas por pagina:
                <select
                  [value]="dgaRowsPerPage()"
                  (change)="setDgaRowsPerPage($event)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-slate-600 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
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

          } @else if (activeDetailTab() === 'operacion') {
            <app-water-detail-operacion />
          } @else if (activeDetailTab() === 'alertas') {
            <app-water-detail-alertas />
          } @else if (activeDetailTab() === 'bitacora') {
            <app-water-detail-bitacora />
          } @else if (activeDetailTab() === 'analisis') {
            <app-water-detail-analisis />
          }
        </div>
      } @else {
        <div class="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          No se encontro la instalacion solicitada.
        </div>
      }

      @if (dgaDateFilterOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]" (click)="closeDgaDateFilter()">
          <section class="w-full max-w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl" (click)="$event.stopPropagation()">
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div class="flex items-center gap-3">
                <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
                  <span class="material-symbols-outlined text-[20px]">calendar_month</span>
                </span>
                <div>
                  <h2 class="text-lg font-black text-slate-800">Filtrar por Período</h2>
                  <p class="text-xs font-semibold text-slate-400">Registros DGA</p>
                </div>
              </div>
              <button type="button" (click)="closeDgaDateFilter()" class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700" aria-label="Cerrar">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
              <!-- Left: presets + months -->
              <div class="border-b border-slate-100 px-5 py-5 md:border-b-0 md:border-r">
                <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Períodos rápidos</p>
                <div class="grid gap-0.5">
                  @for (preset of downloadPresets; track preset.id) {
                    <button
                      type="button"
                      (click)="applyDgaDatePreset(preset.id)"
                      [class]="dgaSelectedPreset() === preset.id
                        ? 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold bg-cyan-50 text-cyan-700 border border-cyan-200'
                        : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50'"
                    >
                      @if (dgaSelectedPreset() === preset.id) {
                        <span class="h-1.5 w-1.5 rounded-full bg-cyan-500 flex-shrink-0"></span>
                      }
                      {{ preset.label }}
                    </button>
                  }
                </div>

                <p class="mb-2 mt-5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Meses {{ 'de ' + (dgaDateFrom() || '2026').slice(0,4) }}</p>
                <div class="grid grid-cols-3 gap-1.5">
                  @for (month of downloadMonthNames; track month; let i = $index) {
                    <button
                      type="button"
                      (click)="applyDgaMonth(i)"
                      [class]="!dgaMonthHasData(i)
                        ? 'rounded-lg py-1.5 text-[11px] font-semibold bg-slate-50 text-slate-300 cursor-not-allowed select-none'
                        : dgaSelectedMonths().includes(i)
                          ? 'rounded-lg py-1.5 text-[11px] font-bold bg-cyan-600 text-white ring-2 ring-cyan-300'
                          : 'rounded-lg py-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'"
                    >{{ month.slice(0, 3) }}</button>
                  }
                </div>
                <p class="mt-2 text-[9px] font-semibold text-slate-300">Verde = datos disponibles</p>
              </div>

              <!-- Right: range display + date inputs -->
              <div class="px-6 py-5">
                <div class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                  <div>
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rango seleccionado</p>
                    <p class="mt-0.5 text-sm font-black text-slate-700">{{ dgaModalRangeLabel() }}</p>
                  </div>
                  <span class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500">
                    {{ dgaModalDaysCount() > 0 ? dgaModalDaysCount() + ' días' : '—' }}
                  </span>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="grid gap-1.5 text-xs font-bold text-slate-600">
                    Desde
                    <input
                      type="date"
                      [value]="dgaDateFrom()"
                      (input)="setDgaDateFrom($event); dgaSelectedPreset.set('custom'); dgaSelectedMonths.set([])"
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                  <label class="grid gap-1.5 text-xs font-bold text-slate-600">
                    Hasta
                    <input
                      type="date"
                      [value]="dgaDateTo()"
                      (input)="setDgaDateTo($event); dgaSelectedPreset.set('custom'); dgaSelectedMonths.set([])"
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-sm font-semibold">
              <button type="button" (click)="clearDgaDateFilter(); dgaSelectedPreset.set(null); dgaSelectedMonths.set([])" class="text-slate-500 transition-colors hover:text-slate-800">Limpiar selección</button>
              <div class="flex items-center gap-3">
                <button type="button" (click)="closeDgaDateFilter()" class="rounded-lg px-4 py-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800">Cancelar</button>
                <button type="button" (click)="applyDgaDateFilter()" class="rounded-lg bg-cyan-600 px-4 py-2 font-black text-white transition-colors hover:bg-cyan-700">Aplicar filtro</button>
              </div>
            </div>
          </section>
        </div>
      }

      @if (downloadModalOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]" (click)="closeDownloadModal()">
          <section class="w-full max-w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl" (click)="$event.stopPropagation()">
            <!-- Modal header -->
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div class="flex items-center gap-3">
                <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <span class="material-symbols-outlined text-[20px]">download</span>
                </span>
                <div>
                  <h2 class="text-lg font-black text-slate-800">Exportar Datos</h2>
                  @if (siteContext(); as ctx) {
                    <p class="text-xs font-semibold text-slate-400">{{ getSiteName(ctx) }}</p>
                  }
                </div>
              </div>
              <button type="button" (click)="closeDownloadModal()" class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700" aria-label="Cerrar">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
              <!-- Left panel: presets + month selector -->
              <div class="border-b border-slate-100 px-5 py-5 md:border-b-0 md:border-r">
                <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Períodos rápidos</p>
                <div class="grid gap-0.5">
                  @for (preset of downloadPresets; track preset.id) {
                    <button
                      type="button"
                      (click)="applyDownloadPreset(preset.id)"
                      [class]="downloadSelectedPreset() === preset.id
                        ? 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold bg-cyan-50 text-cyan-700 border border-cyan-200'
                        : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50'"
                    >
                      @if (downloadSelectedPreset() === preset.id) {
                        <span class="h-1.5 w-1.5 rounded-full bg-cyan-500 flex-shrink-0"></span>
                      }
                      {{ preset.label }}
                    </button>
                  }
                </div>

                <p class="mb-2 mt-5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Meses {{ 'de ' + (downloadDateFrom() || '2026').slice(0,4) }}</p>
                <div class="grid grid-cols-3 gap-1.5">
                  @for (month of downloadMonthNames; track month; let i = $index) {
                    <button
                      type="button"
                      (click)="applyDownloadMonth(i)"
                      [class]="!downloadMonthHasData(i)
                        ? 'rounded-lg py-1.5 text-[11px] font-semibold bg-slate-50 text-slate-300 cursor-not-allowed select-none'
                        : downloadSelectedMonths().includes(i)
                          ? 'rounded-lg py-1.5 text-[11px] font-bold bg-cyan-600 text-white ring-2 ring-cyan-300'
                          : 'rounded-lg py-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'"
                    >{{ month.slice(0, 3) }}</button>
                  }
                </div>
                <p class="mt-2 text-[9px] font-semibold text-slate-300">Verde = datos disponibles</p>
              </div>

              <!-- Right panel: date range + data types + format -->
              <div class="px-6 py-5">
                <!-- Selected range pill -->
                <div class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                  <div>
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rango seleccionado</p>
                    <p class="mt-0.5 text-sm font-black text-slate-700">{{ downloadRangeLabel() }}</p>
                  </div>
                  <span class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500">
                    {{ downloadDaysCount() > 0 ? downloadDaysCount() + ' días' : '—' }}
                  </span>
                </div>

                <!-- Custom date range -->
                <div class="mb-5 grid gap-3 sm:grid-cols-2">
                  <label class="grid gap-1.5 text-xs font-bold text-slate-600">
                    Desde
                    <input
                      type="date"
                      [value]="downloadDateFrom()"
                      (input)="downloadDateFrom.set($any($event.target).value); downloadSelectedPreset.set('custom'); downloadSelectedMonths.set([])"
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                  <label class="grid gap-1.5 text-xs font-bold text-slate-600">
                    Hasta
                    <input
                      type="date"
                      [value]="downloadDateTo()"
                      (input)="downloadDateTo.set($any($event.target).value); downloadSelectedPreset.set('custom'); downloadSelectedMonths.set([])"
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                </div>

                <!-- Data types -->
                <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Datos a incluir</p>
                <div class="mb-5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  @for (dtype of downloadDataTypeOptions; track dtype.id) {
                    <button
                      type="button"
                      (click)="toggleDownloadDataType(dtype.id)"
                      [class]="isDownloadTypeSelected(dtype.id)
                        ? 'rounded-lg border border-cyan-400 bg-cyan-50 px-3 py-2.5 text-center text-sm font-bold text-cyan-800 transition-all'
                        : 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-center text-sm font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50'"
                    >{{ dtype.label }}</button>
                  }
                </div>

                <!-- Format -->
                <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Formato de archivo</p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    (click)="downloadFormat.set('csv')"
                    [class]="downloadFormat() === 'csv'
                      ? 'flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700'
                      : 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'"
                  >
                    <span class="material-symbols-outlined text-[16px]">csv</span>
                    CSV
                  </button>
                </div>
              </div>
            </div>

            <!-- Modal footer -->
            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              @if (downloadError()) {
                <p class="basis-full text-xs font-semibold text-rose-500">{{ downloadError() }}</p>
              }
              <p class="text-xs font-semibold" [class]="downloadError() ? 'text-rose-500' : 'text-slate-400'">
                {{ downloadSelectedTypes().length === 0 ? 'Selecciona al menos un dato' : downloadSelectedTypes().length + ' variable' + (downloadSelectedTypes().length > 1 ? 's' : '') + ' · ' + downloadFormat().toUpperCase() }}
              </p>
              <div class="flex items-center gap-3">
                <button type="button" (click)="closeDownloadModal()" class="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800">Cancelar</button>
                <button
                  type="button"
                  (click)="executeDownload()"
                  [disabled]="downloadBusy() || downloadSelectedTypes().length === 0 || !downloadDateFrom() || !downloadDateTo()"
                  class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span class="material-symbols-outlined text-[17px]">download</span>
                  {{ downloadBusy() ? 'Generando...' : 'Descargar' }}
                </button>
              </div>
            </div>
          </section>
        </div>
      }

      @if (dgaReportModalOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]" (click)="closeDgaReportModal()">
          <section class="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-2xl" (click)="$event.stopPropagation()">
            <!-- Header -->
            <div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div class="flex items-center gap-3">
                <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <span class="material-symbols-outlined text-[18px]">description</span>
                </span>
                <div>
                  <h2 class="text-base font-black text-slate-800">Reporte DGA</h2>
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Formato oficial · período a exportar</p>
                </div>
              </div>
              <button type="button" (click)="closeDgaReportModal()" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700">
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <!-- Presets rápidos -->
            <div class="px-5 pt-4">
              <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Período rápido</p>
              <div class="grid grid-cols-3 gap-1.5">
                @for (preset of downloadPresets; track preset.id) {
                  <button
                    type="button"
                    (click)="applyDgaReportPreset(preset.id)"
                    [class]="dgaReportSelectedPreset() === preset.id
                      ? 'rounded-lg border border-violet-300 bg-violet-50 px-2 py-2 text-center text-[11px] font-bold text-violet-800 transition-all'
                      : 'rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-[11px] font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50'"
                  >{{ preset.label }}</button>
                }
              </div>
            </div>

            <!-- Meses -->
            <div class="px-5 pt-4">
              <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Meses {{ 'de ' + (dgaReportDateFrom() || '2026').slice(0,4) }}</p>
              <div class="grid grid-cols-6 gap-1.5">
                @for (month of downloadMonthNames; track month; let i = $index) {
                  <button
                    type="button"
                    (click)="applyDgaReportMonth(i)"
                    [class]="!dgaMonthHasData(i)
                      ? 'rounded-lg py-1.5 text-[10px] font-semibold bg-slate-50 text-slate-300 cursor-not-allowed'
                      : dgaReportSelectedMonths().includes(i)
                        ? 'rounded-lg py-1.5 text-[10px] font-bold bg-violet-600 text-white ring-2 ring-violet-300'
                        : 'rounded-lg py-1.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'"
                  >{{ month.slice(0, 3) }}</button>
                }
              </div>
            </div>

            <!-- Rango manual -->
            <div class="grid grid-cols-2 gap-3 px-5 pt-4">
              <label class="grid gap-1.5 text-[11px] font-bold text-slate-500">
                Desde
                <input type="date" [value]="dgaReportDateFrom()"
                  (input)="dgaReportDateFrom.set($any($event.target).value); dgaReportSelectedPreset.set('custom'); dgaReportSelectedMonths.set([])"
                  class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-700 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"/>
              </label>
              <label class="grid gap-1.5 text-[11px] font-bold text-slate-500">
                Hasta
                <input type="date" [value]="dgaReportDateTo()"
                  (input)="dgaReportDateTo.set($any($event.target).value); dgaReportSelectedPreset.set('custom'); dgaReportSelectedMonths.set([])"
                  class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-700 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"/>
              </label>
            </div>

            <!-- Footer: rango + acción -->
            <div class="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
              <div>
                <p class="text-xs font-black text-slate-700">{{ dgaReportRangeLabel() }}</p>
                <p class="text-[10px] font-semibold text-slate-400">{{ dgaReportDaysCount() > 0 ? dgaReportDaysCount() + ' días' : '—' }}</p>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" (click)="closeDgaReportModal()" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50">Cancelar</button>
                <button
                  type="button"
                  (click)="generateDgaReport()"
                  [disabled]="!dgaReportDateFrom() || !dgaReportDateTo()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span class="material-symbols-outlined text-[16px]">description</span>
                  Generar reporte
                </button>
              </div>
            </div>
          </section>
        </div>
      }

      @if (selectedDgaReport(); as report) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-[2px]">
          <section class="w-full max-w-[740px] overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2 class="text-xl font-black uppercase tracking-wide text-slate-800">Seguimiento de envio</h2>
              <button type="button" (click)="closeDgaReportDetail()" class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700" aria-label="Cerrar seguimiento">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="bg-slate-50 p-6">
              <div class="mx-auto max-w-[620px]">
                <div class="mb-5 flex items-center gap-3">
                  <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700">
                    <span class="material-symbols-outlined text-[22px]">assignment</span>
                  </span>
                  <div>
                    <p class="text-[11px] font-black uppercase tracking-wide text-slate-400">Registro {{ report.recordId }}</p>
                    <p class="text-lg font-black text-slate-800">{{ report.fecha }}</p>
                  </div>
                </div>

                <div class="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3">
                  <div class="px-5 py-5 text-center">
                    <p class="text-[11px] font-black uppercase tracking-wide text-slate-400">Nivel freatico</p>
                    <p class="mt-2 text-2xl font-black text-slate-800">{{ formatDgaNumber(report.nivelFreatico) }}</p>
                    <p class="mt-1 text-xs font-bold text-slate-400">m</p>
                  </div>
                  <div class="border-y border-slate-100 px-5 py-5 text-center sm:border-x sm:border-y-0">
                    <p class="text-[11px] font-black uppercase tracking-wide text-slate-400">Caudal</p>
                    <p class="mt-2 text-2xl font-black text-slate-800">{{ formatDgaNumber(report.caudal) }}</p>
                    <p class="mt-1 text-xs font-bold text-slate-400">l/s</p>
                  </div>
                  <div class="px-5 py-5 text-center">
                    <p class="text-[11px] font-black uppercase tracking-wide text-slate-400">Totalizado</p>
                    <p class="mt-2 text-2xl font-black text-slate-800">{{ formatDgaInteger(report.totalizador) }}</p>
                    <p class="mt-1 text-xs font-bold text-slate-400">m&sup3;</p>
                  </div>
                </div>

                <div class="mt-6 flex items-center justify-between gap-4">
                  <div class="flex items-center gap-3">
                    <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <span class="material-symbols-outlined text-[22px]">send</span>
                    </span>
                    <div>
                      <p class="text-[11px] font-black uppercase tracking-wide text-slate-400">Envio a DGA</p>
                      <p class="text-sm font-black text-slate-800">{{ report.enviadoDga }}</p>
                    </div>
                  </div>

                  <span class="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700">
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    Completado
                  </span>
                </div>

                <div class="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <p class="text-[11px] font-black uppercase tracking-wide text-slate-400">Respuesta del software de DGA</p>
                  <p class="mt-4 text-sm font-black text-slate-700">Respuesta</p>
                  <p class="mt-1 text-sm text-slate-600">{{ report.respuesta }}</p>
                  <p class="mt-4 text-sm font-black text-slate-700">N&deg; Comprobante</p>
                  <p class="mt-1 inline-flex items-center gap-2 text-sm font-bold text-cyan-600">
                    {{ report.comprobante }}
                    <span class="material-symbols-outlined text-[16px]">open_in_new</span>
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes dga-wave-drift {
      from { transform: translateX(-28%) rotate(0deg); }
      to { transform: translateX(2%) rotate(0deg); }
    }

    @keyframes dga-wave-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(4px); }
    }

    @keyframes dga-shine {
      0% { transform: translateX(-110%); opacity: 0; }
      35% { opacity: 0.35; }
      70% { opacity: 0.12; }
      100% { transform: translateX(130%); opacity: 0; }
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
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.38) 48%, transparent 76%);
      animation: dga-shine 5.8s ease-in-out infinite;
      pointer-events: none;
    }

    .field-control {
      width: 100%;
      border-radius: 0.5rem;
      border: 1px solid rgb(203 213 225);
      background: rgb(248 250 252);
      padding: 0.625rem 0.75rem;
      font-size: 0.875rem;
      color: rgb(15 23 42);
      outline: none;
      transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
    }

    .field-control:focus {
      border-color: rgb(6 182 212);
      background: white;
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.14);
    }

    .primary-button,
    .secondary-button,
    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .primary-button {
      min-height: 2.5rem;
      width: 100%;
      border-radius: 0.5rem;
      background: rgb(8 145 178);
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 800;
      color: white;
    }

    .primary-button:hover:not(:disabled) {
      background: rgb(14 116 144);
    }

    .primary-button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .secondary-button {
      min-height: 2.5rem;
      border-radius: 0.5rem;
      border: 1px solid rgb(203 213 225);
      background: white;
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 800;
      color: rgb(71 85 105);
    }

    .secondary-button:hover {
      background: rgb(248 250 252);
    }

    .icon-button {
      height: 2rem;
      width: 2rem;
      border-radius: 0.5rem;
      border: 1px solid rgb(226 232 240);
      background: white;
      color: rgb(71 85 105);
    }

    .icon-button:hover:not(:disabled) {
      border-color: rgb(165 243 252);
      background: rgb(236 254 255);
      color: rgb(8 145 178);
    }
  `],
})
export class CompanySiteWaterDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly companyService = inject(CompanyService);
  private readonly adminApi = inject(AdministrationService);
  private clockSub?: Subscription;
  private dashboardPollingSub?: Subscription;
  private historyPollingSub?: Subscription;
  private readonly historyFetchLimit = 500;

  siteContext = signal<SiteContext | null>(null);
  loading = signal(true);
  dashboardLoading = signal(true);
  dashboardError = signal('');
  dashboardData = signal<SiteDashboardData | null>(null);
  dashboardLastLoadedAt = signal<Date | null>(null);
  serverClockOffsetMs = signal(0);
  currentTime = signal(new Date());
  activeDetailTab = signal<DetailTab>('dga');
  historyPanelOpen = signal(false);
  settingsPanelOpen = signal(false);
  settingsLoading = signal(false);
  settingsBusy = signal('');
  settingsStatus = signal<SettingsStatus>({ type: '', message: '' });
  siteTypeCatalog = signal<SiteTypeCatalogResponse>(DEFAULT_SITE_TYPE_CATALOG);
  siteVariables = signal<SiteVariablesPayload>({ site: this.emptySettingsSite(), pozo_config: null, variables: [], mappings: [] });
  pozoConfigForm = signal<PozoConfigForm>({ profundidad_pozo_m: '', profundidad_sensor_m: '' });
  variableForm = signal<VariableForm>({ ...DEFAULT_VARIABLE_FORM });
  operationMode = signal<OperationMode>('realtime');
  historyLoading = signal(true);
  historyError = signal('');
  historyRows = signal<HistoricalTelemetryRow[]>([]);
  historyPage = signal(1);
  historyDateFrom = signal('');
  historyDateTo = signal('');
  historyRecordLimit = signal(500);
  hoveredRealtimePointIndex = signal<number | null>(null);
  dgaDateFilterOpen = signal(false);
  selectedDgaReport = signal<DgaReportRow | null>(null);
  dgaDateFrom = signal('2026-04-06');
  dgaDateTo = signal('2026-04-07');
  dgaRowsPerPage = signal(10);
  dgaPage = signal(1);
  downloadModalOpen = signal(false);
  downloadSelectedPreset = signal<string | null>('last30');
  downloadSelectedMonths = signal<number[]>([]);
  downloadDateFrom = signal('');
  downloadDateTo = signal('');
  downloadFormat = signal<'xlsx' | 'csv'>('csv');
  downloadSelectedTypes = signal<string[]>(['caudal', 'nivel', 'totalizador', 'nivel_freatico']);
  downloadBusy = signal(false);
  downloadError = signal('');
  dgaSelectedPreset = signal<string | null>(null);
  dgaSelectedMonths = signal<number[]>([]);
  dgaReportModalOpen = signal(false);
  dgaReportSelectedPreset = signal<string | null>('last30');
  dgaReportSelectedMonths = signal<number[]>([]);
  dgaReportDateFrom = signal('');
  dgaReportDateTo = signal('');
  readonly historyPageSize = 50;
  readonly historyRecordLimitOptions = [50, 100, 250, 500];
  readonly dgaRowsPerPageOptions = [10, 25, 50];
  readonly dgaMockTotal = 744;

  wellNivelFreatico = computed(() => this.extractNivelFreatico(this.dashboardData()));
  wellTotalDepth = computed(() => this.extractPozoNumber('profundidad_pozo_m'));
  wellSensorDepth = computed(() => this.extractPozoNumber('profundidad_sensor_m'));
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


  // SVG Well Diagram — dimensions & layout
  readonly svgW = 300;
  readonly svgH = 476;
  readonly svgWellL = 80;
  readonly svgWellR = 168;
  readonly svgWellTop = 40;
  readonly svgWellBot = 464;
  readonly svgWellH = 424;
  readonly svgAnnotX = 272; // x del bracket derecho Superficie→Nivel Freático
  readonly svgGrassX = [6, 14, 22, 30, 42, 52, 176, 186, 198, 210, 222, 234, 246, 258, 270, 282, 292];

  // nivelFreatico = profundidad desde superficie → waterY = top + (nivel/totalDepth)*H
  get svgWaterY(): number {
    const d = this.wellTotalDepth() ?? 18;
    const f = this.wellNivelFreatico() ?? 0;
    const safe = d > 0 ? d : 18;
    return Math.round(this.svgWellTop + Math.min(1, Math.max(0, f / safe)) * this.svgWellH);
  }
  get svgSensorY(): number {
    const d = this.wellTotalDepth() ?? 18;
    const s = this.wellSensorDepth() ?? 0;
    const safe = d > 0 ? d : 18;
    return Math.round(this.svgWellTop + Math.min(1, Math.max(0, s / safe)) * this.svgWellH);
  }
  get svgFillPct(): number { return this.wellFillStylePercent(); }
  get svgWavePath(): string {
    const L = this.svgWellL + 4, y = this.svgWaterY;
    return `M${L},${y} q13,-9 26,0 q13,9 25,0 q12,-6 25,0`;
  }
  get svgWave2Path(): string {
    const L = this.svgWellL + 4, y = this.svgWaterY + 6;
    return `M${L},${y} q19,5 38,0 q19,-5 38,0`;
  }
  get svgTextCX(): number { return Math.round((this.svgWellL + this.svgWellR) / 2); }
  get svgTextWaterY(): number { return Math.round(this.svgWaterY + (this.svgWellBot - this.svgWaterY) * 0.45 + 6); }
  get svgDepthMidY(): number { return Math.round((this.svgWellTop + this.svgWellBot) / 2); }

  dashboardRefreshLabel = computed(() => this.formatDashboardRefresh(this.dashboardLastLoadedAt(), this.currentTime()));
  latestDeviceReadingLabel = computed(() => this.formatLatestDeviceReading(this.dashboardData()?.ultima_lectura));
  currentServerTime = computed(() => new Date(this.currentTime().getTime() + this.serverClockOffsetMs()));
  telemetryStatusBadges = computed<TelemetryStatusBadge[]>(() => []);
  latestDeviceTimestampLabel = computed(() => {
    const reading = this.dashboardData()?.ultima_lectura;
    const raw = String(reading?.timestamp_completo || reading?.time || '').trim();
    if (!raw) return 'Sin dato';
    return this.formatChileDateTime(raw);
  });
  latestDeviceTimeLabel = computed(() => {
    const raw = String(this.dashboardData()?.ultima_lectura?.timestamp_completo || this.dashboardData()?.ultima_lectura?.time || '').trim();
    if (!raw) return '—';
    const parsed = this.parseUtcTimestamp(raw);
    if (!parsed) return '—';
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', hour12: false }).format(parsed);
  });
  latestDeviceDateLabel = computed(() => {
    const raw = String(this.dashboardData()?.ultima_lectura?.timestamp_completo || this.dashboardData()?.ultima_lectura?.time || '').trim();
    if (!raw) return '';
    const parsed = this.parseUtcTimestamp(raw);
    if (!parsed) return '';
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
  });
  downloadRangeLabel = computed(() => {
    const from = this.downloadDateFrom();
    const to = this.downloadDateTo();
    if (!from && !to) return 'Sin rango seleccionado';
    const fmt = (s: string) => s ? s.split('-').reverse().join('/') : '—';
    return `${fmt(from)} — ${fmt(to)}`;
  });
  downloadDaysCount = computed(() => {
    const f = this.downloadDateFrom();
    const t = this.downloadDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
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
    const fmt = (s: string) => s ? s.split('-').reverse().join('/') : '—';
    return `${fmt(from)} — ${fmt(to)}`;
  });
  dgaReportDaysCount = computed(() => {
    const f = this.dgaReportDateFrom();
    const t = this.dgaReportDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  dgaReportRangeLabel = computed(() => {
    const from = this.dgaReportDateFrom();
    const to = this.dgaReportDateTo();
    if (!from && !to) return 'Selecciona un período';
    const fmt = (s: string) => s ? s.split('-').reverse().join('/') : '—';
    return `${fmt(from)} — ${fmt(to)}`;
  });
  historySourceRows = computed(() => {
    if (this.historyRows().length) return this.historyRows();
    return this.historyLoading() ? [] : this.historyMockRows;
  });
  historyFilteredRows = computed(() => {
    const from = this.parseDateInputMs(this.historyDateFrom(), 'start');
    const to = this.parseDateInputMs(this.historyDateTo(), 'end');

    return this.historySourceRows()
      .filter((row) => {
        if (from === null && to === null) return true;
        if (row.timestampMs === null || row.timestampMs === undefined) return false;
        if (from !== null && row.timestampMs < from) return false;
        if (to !== null && row.timestampMs > to) return false;
        return true;
      })
      .slice(0, this.historyRecordLimit());
  });
  paginatedHistoryRows = computed(() => {
    const start = (this.historyPage() - 1) * this.historyPageSize;
    return this.historyFilteredRows().slice(start, start + this.historyPageSize);
  });
  historyTotalRows = computed(() => this.historyFilteredRows().length);
  currentHistoryPageCount = computed(() => this.paginatedHistoryRows().length);
  historyTotalPages = computed(() => Math.max(1, Math.ceil(this.historyTotalRows() / this.historyPageSize)));
  historyRangeStart = computed(() => this.historyTotalRows() ? ((this.historyPage() - 1) * this.historyPageSize) + 1 : 0);
  historyRangeEnd = computed(() => Math.min(this.historyPage() * this.historyPageSize, this.historyTotalRows()));
  isHistoryMock = computed(() => !this.historyLoading() && this.historyRows().length === 0);
  realtimeMetrics = computed<RealtimeMetric[]>(() => {
    const caudal = this.findDashboardNumber('caudal') ?? this.latestHistoryNumber('caudalValue');
    const totalizador = this.findDashboardNumber('totalizador') ?? this.findDashboardTransformNumber('uint32_registros') ?? this.latestHistoryNumber('totalizadorValue');
    const nivel = this.findDashboardNumber('nivel') ?? this.latestHistoryNumber('nivelFreaticoValue');
    const consumoHoy = this.calculateTodayConsumption();

    return [
      { label: 'Caudal Actual', value: this.formatRealtimeNumber(caudal, 2), unit: 'L/s' },
      { label: 'Totalizador', value: this.formatRealtimeNumber(totalizador, 0), unit: 'm³' },
      { label: 'Nivel de Agua', value: this.formatRealtimeNumber(nivel, 2), unit: 'm' },
      { label: 'Consumo Hoy', value: this.formatRealtimeNumber(consumoHoy, 1), unit: 'm³' },
    ];
  });
  latestRealtimeTimestampLabel = computed(() => {
    const latest = this.latestRealtimeTimestamp();
    return latest ? this.formatChileDateTime(latest) : 'Sin registros';
  });
  realtimeChart = computed<RealtimeChartData>(() => this.buildRealtimeChart());
  settingsSite = computed<SiteRecord>(() => {
    const site = this.siteVariables().site;
    if (site?.id) return site;

    const contextSite = this.siteContext()?.site || {};
    return {
      id: contextSite.id || '',
      descripcion: contextSite.descripcion || '',
      empresa_id: contextSite.empresa_id || '',
      sub_empresa_id: contextSite.sub_empresa_id || '',
      id_serial: contextSite.id_serial || '',
      ubicacion: contextSite.ubicacion || null,
      tipo_sitio: contextSite.tipo_sitio || 'generico',
      activo: contextSite.activo !== false,
    };
  });
  settingsSiteType = computed(() => this.settingsSite().tipo_sitio || 'generico');
  settingsSiteSerial = computed(() => this.settingsSite().id_serial || this.siteContext()?.site?.id_serial || '');
  isSettingsPozo = computed(() => this.settingsSiteType() === 'pozo');
  selectedSiteCatalog = computed<SiteTypeCatalogItem>(() => {
    const type = this.settingsSiteType();
    return this.siteTypeCatalog()[type] || this.siteTypeCatalog()['generico'] || DEFAULT_SITE_TYPE_CATALOG['generico'];
  });
  variableRoleOptions = computed<SiteTypeRoleOption[]>(() => this.selectedSiteCatalog().roles);
  variableTransformOptions = computed<SiteTypeTransformOption[]>(() =>
    this.selectedSiteCatalog().transforms.filter((transform) => transform.enabled !== false)
  );
  dgaFilteredReports = computed(() => {
    const from = this.parseDateInputMs(this.dgaDateFrom(), 'start');
    const to = this.parseDateInputMs(this.dgaDateTo(), 'end');

    return this.dgaReportRows.filter((row) => {
      if (from !== null && row.timestampMs < from) return false;
      if (to !== null && row.timestampMs > to) return false;
      return true;
    });
  });
  paginatedDgaReports = computed(() => {
    const start = (this.dgaPage() - 1) * this.dgaRowsPerPage();
    return this.dgaFilteredReports().slice(start, start + this.dgaRowsPerPage());
  });
  dgaTotalPages = computed(() => Math.max(1, Math.ceil(this.dgaFilteredReports().length / this.dgaRowsPerPage())));
  dgaRangeStart = computed(() => this.dgaFilteredReports().length ? ((this.dgaPage() - 1) * this.dgaRowsPerPage()) + 1 : 0);
  dgaRangeEnd = computed(() => this.paginatedDgaReports().length
    ? Math.min(this.dgaRangeStart() + this.paginatedDgaReports().length - 1, this.dgaMockTotal)
    : 0
  );
  dgaDisplayedTotal = computed(() => this.dgaFilteredReports().length ? this.dgaMockTotal : 0);
  dgaTotalRecordsLabel = computed(() => `${this.dgaDisplayedTotal()} registros en el periodo`);
  dgaSelectedRangeLabel = computed(() => `${this.formatDgaDateInputShort(this.dgaDateFrom())} - ${this.formatDgaDateInputShort(this.dgaDateTo())}`);
  dgaSelectedRangeLongLabel = computed(() => `${this.formatDgaDateInputLong(this.dgaDateFrom())} - ${this.formatDgaDateInputLong(this.dgaDateTo())}`);
  dgaSelectedDaysLabel = computed(() => `${this.countDgaSelectedDays()} dias`);

  readonly monthlyFlowTicks = ['120,000', '90,000', '60,000', '30,000', '0'];

  readonly monthlyFlowMonths: MonthlyFlowPoint[] = [
    { label: "Jun '25", value: 76000 },
    { label: "Jul '25", value: 45000 },
    { label: "Ago '25", value: 60000 },
    { label: "Sep '25", value: 81000 },
    { label: "Oct '25", value: 90000 },
    { label: "Nov '25", value: 80000 },
    { label: "Dic '25", value: 110000 },
    { label: "Ene '26", value: 86000 },
    { label: "Feb '26", value: 48000 },
    { label: "Mar '26", value: 73000 },
    { label: "Abr '26", value: 12000 },
    { label: "May '26", value: 0 },
  ];

  readonly dgaDatePresets = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'last7', label: 'Ultimos 7 dias' },
    { id: 'last30', label: 'Ultimos 30 dias' },
    { id: 'thisMonth', label: 'Este mes' },
    { id: 'previousMonth', label: 'Mes anterior' },
  ];

  readonly dgaReportRows: DgaReportRow[] = [
    this.createDgaReportRow('dga-001', '#601508', '2026-04-06T20:10:00Z', '06/04/2026 17:10', 54.2, 45.5, 6043411),
    this.createDgaReportRow('dga-002', '#601509', '2026-04-06T21:10:00Z', '06/04/2026 18:10', 54.1, 45.7, 6043411),
    this.createDgaReportRow('dga-003', '#601510', '2026-04-06T22:10:00Z', '06/04/2026 19:10', 53.9, 45.4, 6043411),
    this.createDgaReportRow('dga-004', '#601511', '2026-04-06T23:10:00Z', '06/04/2026 20:10', 37.2, 0, 6043411),
    this.createDgaReportRow('dga-005', '#601512', '2026-04-07T00:10:00Z', '06/04/2026 21:10', 34.2, 0, 6043411),
    this.createDgaReportRow('dga-006', '#601513', '2026-04-07T01:10:00Z', '06/04/2026 22:10', 32.9, 0, 6043411),
    this.createDgaReportRow('dga-007', '#601514', '2026-04-07T02:10:00Z', '06/04/2026 23:10', 31.9, 0, 6043411),
    this.createDgaReportRow('dga-008', '#601515', '2026-04-07T03:10:00Z', '07/04/2026 00:10', 31.2, 0, 6043411),
    this.createDgaReportRow('dga-009', '#601516', '2026-04-07T04:10:00Z', '07/04/2026 01:10', 30.7, 0, 6043411),
    this.createDgaReportRow('dga-010', '#601517', '2026-04-07T05:10:00Z', '07/04/2026 02:10', 30.2, 0, 6043411),
    this.createDgaReportRow('dga-011', '#601518', '2026-04-07T06:10:00Z', '07/04/2026 03:10', 29.8, 0, 6043411),
    this.createDgaReportRow('dga-012', '#601519', '2026-04-07T07:10:00Z', '07/04/2026 04:10', 29.4, 0, 6043411),
  ];

  readonly quickActions = [
    { icon: 'database', title: 'Datos Historicos', subtitle: 'Ver registros', color: 'text-cyan-600', openHistory: true },
    { icon: 'download', title: 'Descargar', subtitle: 'Exportar CSV', color: 'text-emerald-600', openDownload: true },
    { icon: 'open_in_new', title: 'Ver en DGA', subtitle: 'Portal oficial', color: 'text-blue-600' },
    { icon: 'description', title: 'Reporte DGA', subtitle: 'Formato oficial', color: 'text-violet-600', openDgaReport: true },
  ];

  readonly downloadPresets = [
    { id: 'last7', label: 'Últimos 7 días' },
    { id: 'last30', label: 'Últimos 30 días' },
    { id: 'last90', label: 'Últimos 90 días' },
    { id: 'thisYear', label: 'Este año' },
    { id: 'lastYear', label: 'Año pasado' },
  ];

  readonly downloadMonthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  readonly downloadMonthShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  readonly downloadDataTypeOptions = [
    { id: 'caudal', label: 'Caudal', unit: 'L/s' },
    { id: 'nivel', label: 'Nivel', unit: 'm' },
    { id: 'totalizador', label: 'Totalizador', unit: 'm³' },
    { id: 'nivel_freatico', label: 'Nivel Freático', unit: 'm' },
  ];

  readonly historyMockRows: HistoricalTelemetryRow[] = [
    { id: 'mock-2026-04-01-06-00', fecha: '01/04/2026 06:00', caudal: '0', totalizador: '531.100', nivelFreatico: '1.6', mock: true },
    { id: 'mock-2026-04-01-05-00', fecha: '01/04/2026 05:00', caudal: '19.75', totalizador: '531.060,063', nivelFreatico: '3.3', mock: true },
    { id: 'mock-2026-04-01-04-00', fecha: '01/04/2026 04:00', caudal: '0', totalizador: '531.038,375', nivelFreatico: '1.5', mock: true },
    { id: 'mock-2026-04-01-03-00', fecha: '01/04/2026 03:00', caudal: '19.75', totalizador: '531.009,375', nivelFreatico: '3.3', mock: true },
    { id: 'mock-2026-04-01-02-00', fecha: '01/04/2026 02:00', caudal: '19.63', totalizador: '530.986,75', nivelFreatico: '3.4', mock: true },
    { id: 'mock-2026-04-01-01-00', fecha: '01/04/2026 01:00', caudal: '19.88', totalizador: '530.956,188', nivelFreatico: '3.1', mock: true },
    { id: 'mock-2026-04-01-00-00', fecha: '01/04/2026 00:00', caudal: '0', totalizador: '530.921,625', nivelFreatico: '1.5', mock: true },
    { id: 'mock-2026-03-31-23-00', fecha: '31/03/2026 23:00', caudal: '19.75', totalizador: '530.900,188', nivelFreatico: '3.4', mock: true },
    { id: 'mock-2026-03-31-22-00', fecha: '31/03/2026 22:00', caudal: '19.75', totalizador: '530.858,938', nivelFreatico: '3.5', mock: true },
    { id: 'mock-2026-03-31-21-00', fecha: '31/03/2026 21:00', caudal: '19.75', totalizador: '530.806,375', nivelFreatico: '3.2', mock: true },
  ];

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');

    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    this.clockSub = timer(0, 1000).subscribe(() => this.currentTime.set(new Date()));
    this.startDashboardPolling(siteId);
    this.startHistoryPolling(siteId);

    this.companyService.fetchHierarchy().subscribe({
      next: (res: any) => {
        if (!res.ok) {
          this.router.navigate(['/companies']);
          return;
        }

        const match = this.findAccessibleSite(res.data, siteId);

        if (!match) {
          this.router.navigate(['/companies']);
          return;
        }

        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.loadHydratedSite(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  ngOnDestroy(): void {
    this.clockSub?.unsubscribe();
    this.dashboardPollingSub?.unsubscribe();
    this.historyPollingSub?.unsubscribe();
  }

  getSiteName(context: SiteContext): string {
    return context.site?.descripcion || context.subCompany?.nombre || 'Instalacion de agua';
  }

  getDgaStatusBg(estado: string): string {
    if (estado === 'Enviado') return '#F0FDF4';
    if (estado === 'Pendiente') return '#FFFBEB';
    return '#FEF2F2';
  }

  getDgaStatusBorder(estado: string): string {
    if (estado === 'Enviado') return '#BBF7D0';
    if (estado === 'Pendiente') return '#FDE68A';
    return '#FECACA';
  }

  getDgaStatusColor(estado: string): string {
    if (estado === 'Enviado') return '#16A34A';
    if (estado === 'Pendiente') return '#D97706';
    return '#DC2626';
  }

  getMonthlyFlowHeight(value: number): number {
    const max = 120000;
    return Math.max(0, Math.min(100, (value / max) * 100));
  }

  formatMonthlyFlowValue(value: number): string {
    return new Intl.NumberFormat('es-CL').format(value);
  }

  formatMeters(value: number | null): string {
    if (value === null) return '--';
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/(\.\d*?)0+$/, '$1');
  }

  formatPercent(value: number | null): string {
    return value === null ? '--%' : `${value}%`;
  }

  private buildTelemetryBadge(
    title: string,
    rawTimestamp: string,
    now: Date,
    display: 'relative' | 'datetime',
    icon: string
  ): TelemetryStatusBadge {
    const parsed = rawTimestamp ? this.parseUtcTimestamp(rawTimestamp) : null;

    if (!parsed) {
      return {
        title,
        value: 'Sin dato',
        tone: 'empty',
        icon,
      };
    }

    const elapsedMs = Math.max(0, now.getTime() - parsed.getTime());

    return {
      title,
      value: display === 'relative' ? this.formatDetailedRelativeTime(parsed, now) : this.formatChileDateTime(parsed),
      tone: elapsedMs < 60 * 60 * 1000 ? 'ok' : 'warning',
      icon,
    };
  }

  telemetryBadgeClass(tone: TelemetryStatusBadge['tone']): string {
    const base = 'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2';
    if (tone === 'ok') return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
    if (tone === 'warning') return `${base} border-amber-300 bg-amber-50 text-amber-700`;
    return `${base} border-slate-200 bg-slate-50 text-slate-500`;
  }

  telemetryBadgeIconClass(tone: TelemetryStatusBadge['tone']): string {
    const base = 'material-symbols-outlined text-[16px]';
    if (tone === 'ok') return `${base} text-emerald-600`;
    if (tone === 'warning') return `${base} text-amber-500`;
    return `${base} text-slate-400`;
  }

  private formatDetailedRelativeTime(date: Date, now: Date): string {
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

    if (elapsedSeconds < 60) return `hace ${elapsedSeconds} segundos`;

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `hace ${elapsedMinutes} min`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const remainingMinutes = elapsedMinutes % 60;
    if (elapsedHours < 24) {
      return remainingMinutes ? `hace ${elapsedHours}h ${remainingMinutes}m` : `hace ${elapsedHours}h`;
    }

    const elapsedDays = Math.floor(elapsedHours / 24);
    const remainingHours = elapsedHours % 24;
    return remainingHours ? `hace ${elapsedDays}d ${remainingHours}h` : `hace ${elapsedDays}d`;
  }

  private syncServerClock(rawServerTime: string | null | undefined): void {
    const serverTime = rawServerTime ? this.parseUtcTimestamp(String(rawServerTime)) : null;
    if (!serverTime) return;
    this.serverClockOffsetMs.set(serverTime.getTime() - Date.now());
  }

  private formatDashboardRefresh(loadedAt: Date | null, now: Date): string {
    if (!loadedAt) return 'Sin datos';
    return this.formatDetailedRelativeTime(loadedAt, now);
  }

  private formatLatestDeviceReading(reading: SiteDashboardData['ultima_lectura'] | undefined): string {
    const raw = String(reading?.timestamp_completo || reading?.time || '').trim();
    if (!raw) return 'Equipo sin dato';
    return `Ultimo dato equipo ${this.formatChileDateTime(raw)}`;
  }

  private formatChileDateTime(value: Date | string): string {
    const parsed = value instanceof Date ? value : this.parseUtcTimestamp(value);

    if (!parsed || Number.isNaN(parsed.getTime())) {
      return typeof value === 'string' ? value : '--';
    }

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).format(parsed);
  }

  private parseUtcTimestamp(value: string): Date | null {
    const raw = value.trim();
    if (!raw) return null;

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const withTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
    const parsed = new Date(withTimeZone);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
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
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(new Date(utcGuess));
    const part = (type: string) => Number(chileParts.find((item) => item.type === type)?.value || 0);
    const chileAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'), millisecond);

    return utcGuess - (chileAsUtc - utcGuess);
  }

  private createDgaReportRow(
    id: string,
    recordId: string,
    dateIso: string,
    fecha: string,
    nivelFreatico: number,
    caudal: number,
    totalizador: number
  ): DgaReportRow {
    return {
      id,
      recordId,
      dateIso,
      fecha,
      timestampMs: new Date(dateIso).getTime(),
      nivelFreatico,
      caudal,
      totalizador,
      estado: 'Enviado',
      enviadoDga: '30/04/2026 20:00',
      respuesta: 'Medicion subterranea ingresada correctamente',
      comprobante: '3qaonemdN5SkOozAE9TZAdjFo3CVr4Wg',
    };
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

  openSettingsPanel(): void {
    this.historyPanelOpen.set(false);
    this.settingsPanelOpen.set(true);
    this.loadSiteSettings();
  }

  closeSettingsPanel(): void {
    this.settingsPanelOpen.set(false);
  }

  reloadSettingsPanel(): void {
    this.loadSiteSettings();
  }

  updatePozoConfigForm(field: keyof PozoConfigForm, value: string): void {
    this.pozoConfigForm.update((form) => ({ ...form, [field]: value }));
  }

  savePozoConfig(): void {
    const siteId = this.currentSiteId();
    if (!siteId || !this.isSettingsPozo()) return;

    this.settingsBusy.set('pozo');
    this.adminApi.updateSite(siteId, {
      pozo_config: this.buildPozoConfigPayload(),
    }).subscribe({
      next: (res) => {
        this.settingsBusy.set('');
        this.setSettingsSuccess(res.message || 'Configuracion del pozo guardada.');
        const pozoConfig = (res.data as SiteRecord & { pozo_config?: PozoConfig | null })?.pozo_config || null;
        this.siteVariables.update((current) => ({ ...current, pozo_config: pozoConfig }));
        this.patchPozoConfigForm(pozoConfig);
        this.siteContext.update((current) => current
          ? { ...current, site: { ...current.site, pozo_config: pozoConfig } }
          : current
        );
      },
      error: (err: unknown) => {
        this.settingsBusy.set('');
        this.setSettingsError(this.errorMessage(err, 'No fue posible guardar la configuracion del pozo.'));
      },
    });
  }

  updateVariableForm(field: keyof VariableForm, value: string): void {
    this.variableForm.update((form) => ({ ...form, [field]: value }));
  }

  updateVariableRole(role: string): void {
    const nextRole = this.normalizeVariableRoleForForm(role);
    const roleOption = this.variableRoleOptions().find((item) => item.id === nextRole);

    this.variableForm.update((form) => ({
      ...form,
      rol_dashboard: nextRole,
      unidad: form.unidad || roleOption?.unitHint || '',
      transformacion: this.suggestTransformForRole(nextRole, form.transformacion),
    }));
  }

  selectVariableKey(d1: string): void {
    const selected = this.siteVariables().variables.find((variable) => variable.nombre_dato === d1);
    const nextRole = this.inferVariableRoleFromValues(
      this.variableForm().alias || selected?.nombre_dato,
      d1,
      this.variableForm().unidad
    );
    const roleOption = this.variableRoleOptions().find((item) => item.id === nextRole);

    this.variableForm.update((form) => ({
      ...form,
      d1,
      alias: form.alias || selected?.nombre_dato || '',
      tipo_dato: form.tipo_dato || this.guessDataType(selected?.valor_dato ?? null),
      rol_dashboard: form.rol_dashboard === 'generico' ? nextRole : form.rol_dashboard,
      unidad: form.unidad || roleOption?.unitHint || '',
      transformacion: this.suggestTransformForRole(form.rol_dashboard === 'generico' ? nextRole : form.rol_dashboard, form.transformacion),
      sandboxRaw: selected?.valor_dato === null || selected?.valor_dato === undefined
        ? form.sandboxRaw
        : String(selected.valor_dato),
    }));
  }

  updateVariableTransform(transformacion: string): void {
    const normalizedTransform = this.normalizeVariableTransformForForm(transformacion);

    this.variableForm.update((form) => ({
      ...form,
      transformacion: normalizedTransform,
      wordSwap: normalizedTransform === 'uint32_registros' ? 'true' : form.wordSwap,
      factor: this.isLinearTransformValue(normalizedTransform) ? (form.factor || '1') : '1',
      offset: this.isLinearTransformValue(normalizedTransform) ? (form.offset || '0') : '0',
    }));
  }

  isLinearTransform(): boolean {
    return this.isLinearTransformValue(this.variableForm().transformacion);
  }

  requiresSecondRegister(): boolean {
    return this.selectedVariableTransform()?.requiresD2 === true;
  }

  usesRegisterOrder(): boolean {
    return ['ieee754_32', 'uint32_registros'].includes(this.variableForm().transformacion);
  }

  isUint32TransformSelected(): boolean {
    return this.variableForm().transformacion === 'uint32_registros';
  }

  selectedVariableRole(): SiteTypeRoleOption | undefined {
    return this.variableRoleOptions().find((role) => role.id === this.variableForm().rol_dashboard);
  }

  selectedVariableTransform(): SiteTypeTransformOption | undefined {
    return this.variableTransformOptions().find((transform) => transform.id === this.variableForm().transformacion);
  }

  registerOrderHint(): string {
    const form = this.variableForm();
    const first = form.d1 || 'primer registro';
    const second = form.d2 || 'segundo registro';

    if (form.wordSwap === 'true') {
      return `${second} queda como registro alto y ${first} como registro bajo.`;
    }

    return `${first} queda como registro alto y ${second} como registro bajo.`;
  }

  calculatorButtonClass(transformId: string): string {
    const base = 'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-black uppercase tracking-[0.1em] transition';
    return this.variableForm().transformacion === transformId
      ? `${base} border-cyan-300 bg-cyan-100 text-cyan-900`
      : `${base} border-cyan-100 bg-white text-cyan-800 hover:border-cyan-200 hover:bg-cyan-50`;
  }

  previewResultText(): string {
    const form = this.variableForm();
    const rawText = String(form.sandboxRaw ?? '').trim();
    const unit = form.unidad ? ` ${form.unidad}` : '';

    if (!rawText && !this.requiresSecondRegister()) return 'Ingresa un valor crudo';

    if (this.isLinearTransformValue(form.transformacion)) {
      const raw = this.toNumber(rawText);
      const factor = this.toNumber(form.factor) ?? 1;
      const offset = this.toNumber(form.offset) ?? 0;
      if (raw === null) return 'Valor crudo no numerico';
      return `${this.formatPreviewNumber((raw * factor) + offset)}${unit}`;
    }

    if (form.transformacion === 'ieee754_32') {
      const rawA = this.valueForVariableKey(form.d1);
      const rawB = this.valueForVariableKey(form.d2);
      const decoded = this.decodeFloat32FromRegisters(rawA, rawB, form.wordSwap === 'true');

      if (decoded === null) {
        return form.d2 ? 'Registros no numericos' : 'Selecciona segundo registro';
      }

      return `${this.formatPreviewNumber(decoded)}${unit}`;
    }

    if (form.transformacion === 'uint32_registros') {
      const rawA = this.toRegisterWord(this.valueForVariableKey(form.d1));
      const rawB = this.toRegisterWord(this.valueForVariableKey(form.d2));

      if (rawA === null || rawB === null) {
        return form.d2 ? 'Registros no numericos' : 'Selecciona segundo registro';
      }

      const high = form.wordSwap === 'true' ? rawB : rawA;
      const low = form.wordSwap === 'true' ? rawA : rawB;
      return `${this.formatPreviewNumber((high * 65536) + low)}${unit}`;
    }

    return `${rawText}${unit}`;
  }

  resetVariableForm(): void {
    this.variableForm.set({ ...DEFAULT_VARIABLE_FORM });
  }

  createVariableMap(event: Event): void {
    event.preventDefault();
    const siteId = this.currentSiteId();

    if (!siteId) {
      this.setSettingsError('No se encontro el sitio actual.');
      return;
    }

    const payload: CreateVariableMapPayload = {
      alias: this.variableForm().alias,
      d1: this.variableForm().d1,
      d2: this.variableForm().d2 || null,
      tipo_dato: this.variableForm().tipo_dato,
      unidad: this.variableForm().unidad || null,
      rol_dashboard: this.normalizeVariableRoleForForm(this.variableForm().rol_dashboard),
      transformacion: this.normalizeVariableTransformForForm(this.variableForm().transformacion),
      parametros: this.buildVariableParameters(),
    };

    this.settingsBusy.set('variable');
    const request$ = this.variableForm().mapId
      ? this.adminApi.updateSiteVariableMap(siteId, this.variableForm().mapId, payload)
      : this.adminApi.createSiteVariableMap(siteId, payload);

    request$.subscribe({
      next: (res) => {
        this.settingsBusy.set('');
        this.setSettingsSuccess(res.message || 'Variable guardada.');
        this.resetVariableForm();
        this.loadSiteVariables(siteId);
      },
      error: (err: unknown) => {
        this.settingsBusy.set('');
        this.setSettingsError(this.errorMessage(err, 'No fue posible guardar la variable.'));
      },
    });
  }

  prepareVariableMap(variable: SiteVariable): void {
    const params = variable.mapping?.parametros || null;

    this.variableForm.set({
      mapId: variable.mapping?.id || '',
      alias: variable.mapping?.alias || variable.nombre_dato,
      d1: variable.nombre_dato,
      d2: variable.mapping?.d2 || '',
      tipo_dato: variable.mapping?.tipo_dato || this.guessDataType(variable.valor_dato),
      unidad: variable.mapping?.unidad || '',
      rol_dashboard: this.normalizeVariableRoleForForm(variable.mapping?.rol_dashboard),
      transformacion: this.normalizeVariableTransformForForm(variable.mapping?.transformacion),
      factor: this.configNumberToString(params?.factor) || '1',
      offset: this.configNumberToString(params?.offset) || '0',
      wordSwap: String(params?.word_swap ?? params?.wordSwap ?? false),
      sandboxRaw: variable.valor_dato === null || variable.valor_dato === undefined ? '' : String(variable.valor_dato),
    });
  }

  deleteVariableMap(mapping: VariableMapping): void {
    const siteId = this.currentSiteId();
    if (!siteId) return;

    this.settingsBusy.set('delete-variable');
    this.adminApi.deleteSiteVariableMap(siteId, mapping.id).subscribe({
      next: (res) => {
        this.settingsBusy.set('');
        this.setSettingsSuccess(res.message || 'Variable eliminada.');
        this.loadSiteVariables(siteId);
      },
      error: (err: unknown) => {
        this.settingsBusy.set('');
        this.setSettingsError(this.errorMessage(err, 'No fue posible eliminar la variable.'));
      },
    });
  }

  displayValue(value: SiteVariable['valor_dato']): string {
    if (value === null || value === undefined) return '-';
    return String(value);
  }

  displayVariableTransform(transformacion: string | null | undefined): string {
    const normalized = this.normalizeVariableTransformForForm(transformacion);
    return this.findTransformOption(normalized)?.label || normalized;
  }

  siteTypeLabel(type: string): string {
    if (type === 'electrico') return 'Electrico';
    if (type === 'riles') return 'Riles';
    if (type === 'proceso') return 'Proceso';
    if (type === 'generico') return 'Generico';
    return 'Pozo';
  }

  settingsStatusClass(): string {
    const base = 'mt-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold';
    return this.settingsStatus().type === 'success'
      ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
      : `${base} border-red-200 bg-red-50 text-red-700`;
  }

  setDetailTab(tab: DetailTab): void {
    this.historyPanelOpen.set(false);
    this.settingsPanelOpen.set(false);
    this.activeDetailTab.set(tab);
  }

  setOperationMode(mode: OperationMode): void {
    this.operationMode.set(mode);
  }

  setRealtimeChartHover(index: number): void {
    this.hoveredRealtimePointIndex.set(index);
  }

  clearRealtimeChartHover(): void {
    this.hoveredRealtimePointIndex.set(null);
  }

  handleQuickAction(action: { tab?: DetailTab; openHistory?: boolean; openDownload?: boolean; openDgaReport?: boolean }): void {
    if (action.openHistory) { this.openHistoryView(); return; }
    if (action.openDownload) { this.openDownloadModal(); return; }
    if (action.openDgaReport) { this.openDgaReportModal(); return; }
    if (action.tab) { this.setDetailTab(action.tab); }
  }

  openHistoryView(): void {
    this.settingsPanelOpen.set(false);
    this.historyPanelOpen.set(true);
    this.historyPage.set(1);
  }

  closeHistoryView(): void {
    this.historyPanelOpen.set(false);
  }

  openDownloadModal(): void {
    this.downloadSelectedMonths.set([]);
    this.downloadError.set('');
    this.downloadFormat.set('csv');
    this.applyDownloadPreset('last30');
    this.downloadModalOpen.set(true);
  }

  closeDownloadModal(): void {
    this.downloadModalOpen.set(false);
  }

  applyDownloadPreset(presetId: string): void {
    this.downloadSelectedMonths.set([]);
    const now = new Date();
    const y = now.getFullYear();
    let from: Date, to: Date;
    switch (presetId) {
      case 'last7':
        from = new Date(now); from.setDate(from.getDate() - 6); to = now; break;
      case 'last30':
        from = new Date(now); from.setDate(from.getDate() - 29); to = now; break;
      case 'last90':
        from = new Date(now); from.setDate(from.getDate() - 89); to = now; break;
      case 'thisYear':
        from = new Date(y, 0, 1); to = now; break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1); to = new Date(y - 1, 11, 31); break;
      default:
        return;
    }
    this.downloadDateFrom.set(this.toDateInputValue(from));
    this.downloadDateTo.set(this.toDateInputValue(to));
    this.downloadSelectedPreset.set(presetId);
  }

  applyDownloadMonth(monthIndex: number): void {
    if (!this.downloadMonthHasData(monthIndex)) return;
    const current = this.downloadSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter(m => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.downloadSelectedMonths.set(next);
    this.downloadSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.downloadDateFrom.set(this.toDateInputValue(from));
    this.downloadDateTo.set(this.toDateInputValue(to));
  }

  downloadMonthHasData(monthIndex: number): boolean {
    const year = new Date().getFullYear();
    const shortMonth = this.downloadMonthShort[monthIndex];
    const shortYear = String(year).slice(2);
    const match = this.monthlyFlowMonths.find(m => m.label.startsWith(`${shortMonth} '${shortYear}`));
    return match ? match.value > 0 : false;
  }

  toggleDownloadDataType(typeId: string): void {
    const current = this.downloadSelectedTypes();
    if (current.includes(typeId)) {
      this.downloadSelectedTypes.set(current.filter(t => t !== typeId));
    } else {
      this.downloadSelectedTypes.set([...current, typeId]);
    }
  }

  isDownloadTypeSelected(typeId: string): boolean {
    return this.downloadSelectedTypes().includes(typeId);
  }

  executeDownload(): void {
    const siteId = this.currentSiteId();
    const from = this.downloadDateFrom();
    const to = this.downloadDateTo();
    const fields = this.downloadSelectedTypes();

    if (!siteId) {
      this.downloadError.set('No se encontro el sitio actual.');
      return;
    }

    if (!from || !to || fields.length === 0) {
      this.downloadError.set('Selecciona rango y datos para exportar.');
      return;
    }

    this.downloadBusy.set(true);
    this.downloadError.set('');

    this.companyService.downloadSiteDashboardHistory(siteId, {
      from,
      to,
      fields,
      format: 'csv',
    }).subscribe({
      next: (response) => {
        const blob = response.body;
        if (!blob) {
          this.downloadBusy.set(false);
          this.downloadError.set('No se recibio el archivo.');
          return;
        }

        const filename = this.filenameFromContentDisposition(response.headers.get('content-disposition'))
          || `historico_${siteId}_${from}_${to}.csv`;
        this.saveBlob(blob, filename);
        this.downloadBusy.set(false);
        this.closeDownloadModal();
      },
      error: (err: unknown) => {
        this.downloadBusy.set(false);
        this.downloadError.set(this.errorMessage(err, 'No fue posible descargar los datos historicos.'));
      },
    });
  }

  private filenameFromContentDisposition(value: string | null): string | null {
    if (!value) return null;
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(value);
    return match?.[1] ? decodeURIComponent(match[1].replace(/"/g, '')) : null;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  openDgaReportModal(): void {
    this.dgaReportSelectedMonths.set([]);
    this.applyDgaReportPreset('last30');
    this.dgaReportModalOpen.set(true);
  }

  closeDgaReportModal(): void {
    this.dgaReportModalOpen.set(false);
  }

  applyDgaReportPreset(presetId: string): void {
    this.dgaReportSelectedMonths.set([]);
    this.dgaReportSelectedPreset.set(presetId);
    const now = new Date();
    const y = now.getFullYear();
    let from = new Date(now), to = new Date(now);
    switch (presetId) {
      case 'last7':    from = this.addDays(now, -6); break;
      case 'last30':   from = this.addDays(now, -29); break;
      case 'last90':   from = this.addDays(now, -89); break;
      case 'thisYear': from = new Date(y, 0, 1); break;
      case 'lastYear': from = new Date(y - 1, 0, 1); to = new Date(y - 1, 11, 31); break;
    }
    this.dgaReportDateFrom.set(this.toDateInputValue(from));
    this.dgaReportDateTo.set(this.toDateInputValue(to));
  }

  applyDgaReportMonth(monthIndex: number): void {
    if (!this.dgaMonthHasData(monthIndex)) return;
    const current = this.dgaReportSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter(m => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.dgaReportSelectedMonths.set(next);
    this.dgaReportSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.dgaReportDateFrom.set(this.toDateInputValue(from));
    this.dgaReportDateTo.set(this.toDateInputValue(to));
  }

  generateDgaReport(): void {
    this.closeDgaReportModal();
  }

  setHistoryDateFrom(event: Event): void {
    this.historyDateFrom.set((event.target as HTMLInputElement).value);
    this.historyPage.set(1);
  }

  setHistoryDateTo(event: Event): void {
    this.historyDateTo.set((event.target as HTMLInputElement).value);
    this.historyPage.set(1);
  }

  setHistoryRecordLimit(event: Event): void {
    const parsed = Number((event.target as HTMLSelectElement).value);
    this.historyRecordLimit.set(this.historyRecordLimitOptions.includes(parsed) ? parsed : 500);
    this.historyPage.set(1);
  }

  clearHistoryFilters(): void {
    this.historyDateFrom.set('');
    this.historyDateTo.set('');
    this.historyRecordLimit.set(500);
    this.historyPage.set(1);
  }

  openDgaDateFilter(): void {
    this.dgaDateFilterOpen.set(true);
  }

  closeDgaDateFilter(): void {
    this.dgaDateFilterOpen.set(false);
  }

  applyDgaDateFilter(): void {
    this.dgaPage.set(1);
    this.closeDgaDateFilter();
  }

  clearDgaDateFilter(): void {
    this.dgaDateFrom.set('2026-04-06');
    this.dgaDateTo.set('2026-04-07');
    this.dgaPage.set(1);
  }

  setDgaDateFrom(event: Event): void {
    this.dgaDateFrom.set((event.target as HTMLInputElement).value);
    this.dgaPage.set(1);
  }

  setDgaDateTo(event: Event): void {
    this.dgaDateTo.set((event.target as HTMLInputElement).value);
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
      case 'last7':   from = this.addDays(now, -6); break;
      case 'last30':  from = this.addDays(now, -29); break;
      case 'last90':  from = this.addDays(now, -89); break;
      case 'thisYear': from = new Date(y, 0, 1); break;
      case 'lastYear': from = new Date(y - 1, 0, 1); to = new Date(y - 1, 11, 31); break;
    }
    this.dgaDateFrom.set(this.toDateInputValue(from));
    this.dgaDateTo.set(this.toDateInputValue(to));
    this.dgaPage.set(1);
  }

  applyDgaMonth(monthIndex: number): void {
    if (!this.dgaMonthHasData(monthIndex)) return;
    const current = this.dgaSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter(m => m !== monthIndex)
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

  dgaMonthHasData(monthIndex: number): boolean {
    const year = new Date().getFullYear();
    return this.dgaReportRows.some(row => {
      const d = new Date(row.dateIso);
      return d.getFullYear() === year && d.getMonth() === monthIndex;
    });
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

  formatDgaNumber(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 1,
    }).format(value);
  }

  formatDgaInteger(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 0,
      useGrouping: false,
    }).format(value);
  }

  previousHistoryPage(): void {
    this.historyPage.set(Math.max(1, this.historyPage() - 1));
  }

  nextHistoryPage(): void {
    this.historyPage.set(Math.min(this.historyTotalPages(), this.historyPage() + 1));
  }

  getDetailTabClass(tab: DetailTab): string {
    const active = this.activeDetailTab() === tab;
    const base = 'relative inline-flex h-9 items-center gap-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD] focus-visible:rounded';
    return active
      ? `${base} font-black text-cyan-700`
      : `${base} font-bold text-slate-500 hover:text-slate-700`;
  }

  getOperationModeClass(mode: OperationMode): string {
    const active = this.operationMode() === mode;
    const base = 'inline-flex h-11 items-center gap-2 border-b-2 px-5 text-sm transition-colors';
    return active
      ? `${base} border-cyan-500 bg-cyan-50 font-black text-cyan-700`
      : `${base} border-transparent font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700`;
  }


  private loadSiteSettings(): void {
    const siteId = this.currentSiteId();

    if (!siteId) {
      this.setSettingsError('No se encontro el sitio actual.');
      return;
    }

    this.settingsLoading.set(true);
    this.settingsStatus.set({ type: '', message: '' });

    forkJoin({
      catalog: this.adminApi.getSiteTypeCatalog(),
      variables: this.adminApi.getSiteVariables(siteId),
    }).subscribe({
      next: ({ catalog, variables }) => {
        this.siteTypeCatalog.set(catalog.ok ? catalog.data : DEFAULT_SITE_TYPE_CATALOG);

        if (variables.ok) {
          this.siteVariables.set(variables.data);
          this.patchPozoConfigForm(variables.data.pozo_config);
        }

        this.settingsLoading.set(false);
      },
      error: (err: unknown) => {
        this.settingsLoading.set(false);
        this.setSettingsError(this.errorMessage(err, 'No fue posible cargar la configuracion del sitio.'));
      },
    });
  }

  private loadSiteVariables(siteId: string): void {
    this.adminApi.getSiteVariables(siteId).subscribe({
      next: (res) => {
        if (res.ok) {
          this.siteVariables.set(res.data);
          this.patchPozoConfigForm(res.data.pozo_config);
        }
      },
      error: (err: unknown) => this.setSettingsError(this.errorMessage(err, 'No fue posible recargar variables.')),
    });
  }

  private currentSiteId(): string {
    return this.siteContext()?.site?.id || this.route.snapshot.paramMap.get('siteId') || '';
  }

  private setSettingsSuccess(message: string): void {
    this.settingsStatus.set({ type: 'success', message });
  }

  private setSettingsError(message: string): void {
    this.settingsStatus.set({ type: 'error', message });
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error as { message?: string; error?: string } | string | undefined;
      if (typeof payload === 'string') return payload;
      return payload?.message || payload?.error || fallback;
    }

    return fallback;
  }

  private emptySettingsSite(): SiteRecord {
    return {
      id: '',
      descripcion: '',
      empresa_id: '',
      sub_empresa_id: '',
      id_serial: '',
      ubicacion: null,
      tipo_sitio: 'generico',
      activo: true,
    };
  }

  private buildPozoConfigPayload(): PozoConfig {
    return {
      profundidad_pozo_m: this.toNumber(this.pozoConfigForm().profundidad_pozo_m),
      profundidad_sensor_m: this.toNumber(this.pozoConfigForm().profundidad_sensor_m),
    };
  }

  private patchPozoConfigForm(config: PozoConfig | null): void {
    this.pozoConfigForm.set({
      profundidad_pozo_m: this.configNumberToString(config?.profundidad_pozo_m),
      profundidad_sensor_m: this.configNumberToString(config?.profundidad_sensor_m),
    });
  }

  private buildVariableParameters(): NonNullable<CreateVariableMapPayload['parametros']> {
    const form = this.variableForm();

    if (form.transformacion === 'ieee754_32' || form.transformacion === 'uint32_registros') {
      return {
        word_swap: form.wordSwap === 'true',
        formato: form.transformacion === 'ieee754_32' ? 'float32' : 'uint32',
      };
    }

    if (this.transformUsesLinearParameters(form.transformacion)) {
      return {
        factor: this.toNumber(form.factor) ?? 1,
        offset: this.toNumber(form.offset) ?? 0,
      };
    }

    return {};
  }

  private inferVariableRoleFromValues(...values: Array<string | null | undefined>): string {
    const text = this.normalizeSearchText(...values);
    const availableRoles = new Set(this.variableRoleOptions().map((role) => role.id));

    if (text.includes('freatico') && availableRoles.has('nivel')) return 'nivel';
    if ((text.includes('nivel') || text.includes('level') || text.includes('sonda')) && availableRoles.has('nivel')) return 'nivel';
    if ((text.includes('caudal') || text.includes('l s') || text.includes('lps')) && availableRoles.has('caudal')) return 'caudal';
    if (text.includes('totalizador') || text.includes('totalizado') || text.includes('acumulado') || text.includes('volumen')) {
      return availableRoles.has('totalizador') ? 'totalizador' : 'generico';
    }
    if ((text.includes('energia') || text.includes('kwh')) && availableRoles.has('energia')) return 'energia';
    if (text.includes('temperatura') && availableRoles.has('temperatura')) return 'temperatura';
    if (text.includes('presion') && availableRoles.has('presion')) return 'presion';

    return 'generico';
  }

  private guessDataType(value: SiteVariable['valor_dato']): string {
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'FLOAT';
    return 'TEXT';
  }

  private isLinearTransformValue(transformacion: string): boolean {
    return this.transformUsesLinearParameters(transformacion);
  }

  private normalizeVariableTransformForForm(transformacion: string | null | undefined): string {
    if (transformacion === 'lineal' || transformacion === 'escala_lineal') return 'lineal';
    if (transformacion === 'ieee754' || transformacion === 'ieee754_32') return 'ieee754_32';
    if (transformacion === 'uint32' || transformacion === 'uint32_registros') return 'uint32_registros';
    if (transformacion === 'caudal' || transformacion === 'caudal_m3h_lps' || transformacion === 'nivel_freatico') return 'lineal';
    return 'directo';
  }

  private normalizeVariableRoleForForm(role: string | null | undefined): string {
    const normalizedInput = String(role ?? '').trim().toLowerCase();
    const normalized = normalizedInput === 'nivel_freatico' ? 'nivel' : normalizedInput || 'generico';
    return this.variableRoleOptions().some((option) => option.id === normalized) ? normalized : 'generico';
  }

  private suggestTransformForRole(_role: string, currentTransform: string): string {
    return this.normalizeVariableTransformForForm(currentTransform);
  }

  private transformUsesLinearParameters(transformacion: string): boolean {
    return transformacion === 'lineal';
  }

  private findTransformOption(transformacion: string): SiteTypeTransformOption | undefined {
    const normalized = this.normalizeVariableTransformForForm(transformacion);
    return this.variableTransformOptions().find((option) => option.id === normalized);
  }

  private valueForVariableKey(key: string): unknown {
    if (!key) return null;
    return this.siteVariables().variables.find((variable) => variable.nombre_dato === key)?.valor_dato ?? null;
  }

  private decodeFloat32FromRegisters(rawA: unknown, rawB: unknown, wordSwap: boolean): number | null {
    const wordA = this.toRegisterWord(rawA);
    const wordB = this.toRegisterWord(rawB);
    if (wordA === null || wordB === null) return null;

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    const first = wordSwap ? wordB : wordA;
    const second = wordSwap ? wordA : wordB;

    view.setUint16(0, first, false);
    view.setUint16(2, second, false);

    const decoded = view.getFloat32(0, false);
    return Number.isFinite(decoded) ? decoded : null;
  }

  private toRegisterWord(value: unknown): number | null {
    const parsed = this.toNumber(value);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return null;
    return parsed;
  }

  private formatPreviewNumber(value: number): string {
    if (!Number.isFinite(value)) return 'No calculable';
    const rounded = Math.round(value * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  private configNumberToString(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  private loadHydratedSite(match: SiteContext): void {
    this.companyService.getSites(match.subCompany.id).subscribe({
      next: (json: any) => {
        const hydratedSite = json.ok
          ? (json.data || []).find((site: any) => site.id === match.site.id)
          : null;

        this.siteContext.set({
          ...match,
          site: {
            ...match.site,
            ...(hydratedSite || {}),
          },
        });
        this.loading.set(false);
      },
      error: () => {
        this.siteContext.set(match);
        this.loading.set(false);
      },
    });
  }

  private startDashboardPolling(siteId: string): void {
    this.dashboardLoading.set(!this.dashboardData());
    this.dashboardError.set('');
    this.dashboardPollingSub?.unsubscribe();

    this.dashboardPollingSub = timer(0, 60000).pipe(
      switchMap(() =>
        this.companyService.getSiteDashboardData(siteId).pipe(
          catchError(() => {
            this.dashboardError.set('No fue posible cargar datos del pozo.');
            this.dashboardLoading.set(false);
            return of(null);
          })
        )
      )
    ).subscribe((res: any) => {
      if (!res) return;

      const payload = res?.ok === false ? null : (res?.data || res || null);
      this.syncServerClock(payload?.server_time);
      this.dashboardData.set(payload);
      this.dashboardLastLoadedAt.set(new Date());
      this.dashboardError.set(payload ? '' : 'No fue posible cargar datos del pozo.');
      this.dashboardLoading.set(false);
    });
  }

  private startHistoryPolling(siteId: string): void {
    this.historyLoading.set(true);
    this.historyError.set('');
    this.historyPollingSub?.unsubscribe();

    this.historyPollingSub = timer(0, 60000).pipe(
      switchMap(() =>
        this.companyService.getSiteDashboardHistory(siteId, this.historyFetchLimit).pipe(
          catchError(() => {
            this.historyError.set('No fue posible cargar datos historicos.');
            this.historyLoading.set(false);
            return of(null);
          })
        )
      )
    ).subscribe((res: any) => {
      if (!res) return;

      const apiRows = this.extractHistoryApiRows(res);
      const mappedRows = apiRows
        .map((row, index) => this.mapHistoryApiRow(row, index))
        .filter((row): row is HistoricalTelemetryRow => row !== null);

      this.historyRows.set(mappedRows);
      this.historyError.set('');
      this.historyLoading.set(false);

      if (this.historyPage() > this.historyTotalPages()) {
        this.historyPage.set(this.historyTotalPages());
      }
    });
  }

  private extractHistoryApiRows(res: any): HistoricalTelemetryApiRow[] {
    if (res?.ok === false) return [];
    const rows = res?.data?.rows || res?.data || [];
    return Array.isArray(rows) ? rows : [];
  }

  private mapHistoryApiRow(row: HistoricalTelemetryApiRow, index: number): HistoricalTelemetryRow | null {
    const rawTimestamp = String(row?.timestamp || row?.fecha || '').trim();
    if (!rawTimestamp) return null;

    const parsedTimestamp = this.parseUtcTimestamp(rawTimestamp);
    const timestampMs = parsedTimestamp?.getTime() ?? null;

    return {
      id: `${rawTimestamp}-${index}`,
      fecha: parsedTimestamp ? this.formatChileDateTime(parsedTimestamp) : rawTimestamp,
      timestampMs,
      caudal: this.formatHistoricalValue(row.caudal),
      nivel: this.formatHistoricalValue(row.nivel),
      totalizador: this.formatHistoricalValue(row.totalizador),
      nivelFreatico: this.formatHistoricalValue(row.nivel_freatico),
      caudalValue: this.extractHistoricalNumber(row.caudal),
      nivelValue: this.extractHistoricalNumber(row.nivel),
      totalizadorValue: this.extractHistoricalNumber(row.totalizador),
      nivelFreaticoValue: this.extractHistoricalNumber(row.nivel_freatico),
    };
  }

  private extractHistoricalNumber(value: HistoricalTelemetryValue | null | undefined): number | null {
    if (!value || value.ok === false) return null;
    return this.toNumber(value.valor);
  }

  private formatHistoricalValue(value: HistoricalTelemetryValue | null | undefined): string {
    if (!value || value.ok === false || value.valor === null || value.valor === undefined || value.valor === '') {
      return '--';
    }

    const numericValue = this.toNumber(value.valor);

    if (numericValue === null) {
      return String(value.valor);
    }

    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 3,
    }).format(numericValue);
  }

  private findDashboardNumber(role: string): number | null {
    const summaryValue = this.toNumber(this.dashboardData()?.resumen?.[role]?.valor);
    if (summaryValue !== null) return summaryValue;

    const variable = (this.dashboardData()?.variables || []).find((item) => {
      if (item.ok === false) return false;
      const text = this.normalizeSearchText(item.key, item.alias, item.rol_dashboard);
      return item.key === role || item.rol_dashboard === role || text.includes(role);
    });

    return this.toNumber(variable?.valor);
  }

  private findDashboardTransformNumber(transformacion: string): number | null {
    const variable = (this.dashboardData()?.variables || []).find((item) =>
      item.ok !== false && item.transformacion === transformacion
    );
    return this.toNumber(variable?.valor);
  }

  private latestHistoryNumber(field: 'caudalValue' | 'totalizadorValue' | 'nivelFreaticoValue'): number | null {
    return this.historyRows().find((row) => this.toNumber(row[field]) !== null)?.[field] ?? null;
  }

  private latestRealtimeTimestamp(): Date | null {
    const latestHistory = this.historyRows().find((row) => row.timestampMs !== null && row.timestampMs !== undefined);
    if (latestHistory?.timestampMs) return new Date(latestHistory.timestampMs);

    const reading = this.dashboardData()?.ultima_lectura;
    const parsed = this.parseUtcTimestamp(String(reading?.timestamp_completo || reading?.time || '').trim());
    return parsed;
  }

  private calculateTodayConsumption(): number {
    const todayKey = this.formatChileDateKey(this.currentTime());
    const rows = this.historyRows()
      .filter((row) =>
        row.timestampMs !== null &&
        row.timestampMs !== undefined &&
        row.totalizadorValue !== null &&
        row.totalizadorValue !== undefined &&
        this.formatChileDateKey(new Date(row.timestampMs)) === todayKey
      )
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

    if (rows.length < 2) return 0;

    const first = rows[0].totalizadorValue ?? 0;
    const last = rows[rows.length - 1].totalizadorValue ?? first;
    return Math.max(0, last - first);
  }

  private buildRealtimeChart(): RealtimeChartData {
    const chartLeft = 58;
    const chartRight = 1092;
    const chartTop = 24;
    const chartBottom = 156;
    const rows = this.historyRows()
      .filter((row) =>
        row.timestampMs !== null &&
        row.timestampMs !== undefined &&
        row.caudalValue !== null &&
        row.caudalValue !== undefined
      )
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0))
      .slice(-60);

    if (!rows.length) {
      return { points: [], polyline: '', yTicks: [], xTicks: [], tooltip: null };
    }

    const values = rows.map((row) => row.caudalValue ?? 0);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const step = this.niceChartStep((maxValue - minValue) / 4 || Math.max(Math.abs(maxValue) * 0.005, 0.05));
    let yMin = Math.floor((minValue - (step * 0.2)) / step) * step;
    let yMax = Math.ceil((maxValue + (step * 0.2)) / step) * step;

    if (yMax <= yMin) {
      yMax = yMin + step;
    }

    const yRange = yMax - yMin || 1;
    const minTime = rows[0].timestampMs || 0;
    const maxTime = rows[rows.length - 1].timestampMs || minTime;
    const timeRange = Math.max(1000, maxTime - minTime);

    const points = rows.map((row, index) => {
      const value = row.caudalValue ?? 0;
      const timestampMs = row.timestampMs || minTime;
      const x = rows.length > 1
        ? chartLeft + (((timestampMs - minTime) / timeRange) * (chartRight - chartLeft))
        : (chartLeft + chartRight) / 2;
      const y = chartBottom - (((value - yMin) / yRange) * (chartBottom - chartTop));

      return {
        index,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        value,
        label: row.fecha,
        timestampMs,
      };
    });

    const yTickPositions = [24, 57, 90, 123, 156];
    const yTicks = yTickPositions.map((y, index) => {
      const ratio = index / (yTickPositions.length - 1);
      const value = yMax - (ratio * yRange);
      return { y, label: this.formatChartNumber(value) };
    });

    const xTicks = this.buildFiveMinuteTicks(minTime, maxTime, chartLeft, chartRight);
    const hoveredIndex = this.hoveredRealtimePointIndex();
    const tooltipPoint = points.find((point) => point.index === hoveredIndex) || points[points.length - 1] || null;
    const tooltip = tooltipPoint
      ? {
          x: tooltipPoint.x,
          y: tooltipPoint.y,
          boxX: this.clamp(tooltipPoint.x + 12, 8, 944),
          boxY: this.clamp(tooltipPoint.y - 62, 8, 132),
          dateLabel: this.formatChartTooltipDate(new Date(tooltipPoint.timestampMs)),
          valueLabel: this.formatChartNumber(tooltipPoint.value),
        }
      : null;

    return {
      points,
      polyline: points.map((point) => `${point.x},${point.y}`).join(' '),
      yTicks,
      xTicks,
      tooltip,
    };
  }

  private buildFiveMinuteTicks(minTime: number, maxTime: number, chartLeft: number, chartRight: number): RealtimeChartTick[] {
    const intervalMs = 5 * 60 * 1000;
    const timeRange = Math.max(1000, maxTime - minTime);
    const firstTick = Math.ceil(minTime / intervalMs) * intervalMs;
    const ticks: RealtimeChartTick[] = [];

    for (let tick = firstTick; tick <= maxTime; tick += intervalMs) {
      ticks.push({
        x: Math.round(chartLeft + (((tick - minTime) / timeRange) * (chartRight - chartLeft))),
        label: this.formatChileTimeShort(new Date(tick)),
      });
    }

    if (!ticks.length) {
      return [
        { x: chartLeft, label: this.formatChileTimeShort(new Date(minTime)) },
        { x: chartRight - 30, label: this.formatChileTimeShort(new Date(maxTime)) },
      ];
    }

    return ticks;
  }

  private niceChartStep(value: number): number {
    const raw = Math.max(Math.abs(value), 0.01);
    const exponent = Math.floor(Math.log10(raw));
    const magnitude = 10 ** exponent;
    const normalized = raw / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  private formatRealtimeNumber(value: number | null, maximumFractionDigits: number): string {
    if (value === null) return '--';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: maximumFractionDigits > 0 ? Math.min(1, maximumFractionDigits) : 0,
      maximumFractionDigits,
    }).format(value);
  }

  formatChartNumber(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    }).format(value);
  }

  private formatChileTimeShort(value: Date): string {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).format(value);
  }

  private formatChartTooltipDate(value: Date): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    const month = get('month');
    const cleanMonth = month ? `${month.charAt(0).toUpperCase()}${month.slice(1)}` : '';
    return `${get('day')} ${cleanMonth} ${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  private formatChileDateKey(value: Date): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private findAccessibleSite(tree: any[], siteId: string): SiteContext | null {
    for (const company of tree || []) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item: any) => item.id === siteId);
        if (site) {
          return { company, subCompany, site };
        }
      }
    }

    return null;
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
        variable.transformacion
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
      return !text.includes('freatico') && (text.includes('nivel') || text.includes('level') || text.includes('sonda'));
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

    const site = this.siteContext()?.site;
    return this.toNumber(site?.pozo_config?.[key]) ?? this.toNumber(site?.[key]);
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeSearchText(...values: Array<string | null | undefined>): string {
    return values
      .map((value) => String(value ?? '').trim())
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
