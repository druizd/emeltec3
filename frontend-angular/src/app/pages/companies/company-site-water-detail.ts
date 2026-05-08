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
  totalizador?: HistoricalTelemetryValue | null;
  nivel_freatico?: HistoricalTelemetryValue | null;
}

interface HistoricalTelemetryRow {
  id: string;
  fecha: string;
  timestampMs?: number | null;
  caudal: string;
  totalizador: string;
  nivelFreatico: string;
  mock?: boolean;
}

interface MonthlyFlowPoint {
  label: string;
  value: number;
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
  pozo_config?: {
    profundidad_pozo_m?: number | string | null;
    profundidad_sensor_m?: number | string | null;
  } | null;
  ultima_lectura?: {
    time?: string | null;
    timestamp_completo?: string | null;
    id_serial?: string | null;
  } | null;
  resumen?: Record<string, { valor?: string | number | null; ok?: boolean; unidad?: string | null } | undefined>;
  variables?: DashboardVariable[];
}

type DetailTab = 'dga' | 'operacion';
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
    ],
  },
};

@Component({
  selector: 'app-company-site-water-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CompaniesSiteDetailSkeletonComponent],
  template: `
    <div class="min-h-full bg-[#f4f7fb] px-3 pb-5 pt-3 text-slate-700 md:px-4 xl:px-5">
      @if (loading() && !siteContext()) {
        <app-companies-site-detail-skeleton />
      } @else if (siteContext(); as context) {
        <div class="mx-auto max-w-[1360px] space-y-3">
          <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                  {{ latestDeviceReadingLabel() }}
                </span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-blue-700">
                  <span class="material-symbols-outlined text-[15px]">schedule</span>
                  {{ dashboardRefreshLabel() }}
                </span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700">
                  <span class="material-symbols-outlined text-[15px]">verified</span>
                  Reporte DGA · Aceptado · 17:00
                </span>
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

            <div class="flex items-center gap-5 px-3">
              <button
                type="button"
                (click)="setDetailTab('dga')"
                [class]="getDetailTabClass('dga')"
              >
                <span class="material-symbols-outlined text-[18px]">layers</span>
                DGA
                @if (activeDetailTab() === 'dga') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600"></span>
                }
              </button>
              <button
                type="button"
                (click)="setDetailTab('operacion')"
                [class]="getDetailTabClass('operacion')"
              >
                <span class="material-symbols-outlined text-[18px]">monitoring</span>
                Operación
                @if (activeDetailTab() === 'operacion') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600"></span>
                }
              </button>
            </div>
          </section>

          @if (settingsPanelOpen()) {
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
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

                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Dato original</label>
                        <select
                          required
                          name="settings-variable-key"
                          [ngModel]="variableForm().d1"
                          (ngModelChange)="selectVariableKey($event)"
                          class="field-control"
                        >
                          <option value="" disabled>Selecciona variable</option>
                          @for (variable of siteVariables().variables; track variable.nombre_dato) {
                            <option [value]="variable.nombre_dato">{{ variable.nombre_dato }}</option>
                          }
                        </select>
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

                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Transformacion</label>
                        <select
                          name="settings-variable-transform"
                          [ngModel]="variableForm().transformacion"
                          (ngModelChange)="updateVariableTransform($event)"
                          class="field-control"
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
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Segundo registro</label>
                          <select
                            name="settings-variable-key-d2"
                            [ngModel]="variableForm().d2"
                            (ngModelChange)="updateVariableForm('d2', $event)"
                            class="field-control"
                          >
                            <option value="">Selecciona variable</option>
                            @for (variable of siteVariables().variables; track variable.nombre_dato) {
                              <option [value]="variable.nombre_dato">{{ variable.nombre_dato }}</option>
                            }
                          </select>
                        </div>
                      }

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
                      <table class="w-full min-w-[760px] text-left text-sm">
                        <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th class="px-4 py-3">Dato</th>
                            <th class="px-4 py-3">Valor</th>
                            <th class="px-4 py-3">Alias</th>
                            <th class="px-4 py-3 text-right">Accion</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (variable of siteVariables().variables; track variable.nombre_dato) {
                            <tr class="bg-white">
                              <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">{{ variable.nombre_dato }}</td>
                              <td class="px-4 py-3 font-bold text-slate-900">{{ displayValue(variable.valor_dato) }}</td>
                              <td class="px-4 py-3">
                                @if (variable.mapping) {
                                  <div>
                                    <p class="font-bold text-slate-800">{{ variable.mapping.alias }}</p>
                                    <p class="text-xs text-slate-400">
                                      {{ variable.mapping.tipo_dato }} - {{ displayVariableTransform(variable.mapping.transformacion) }} {{ variable.mapping.unidad || '' }}
                                    </p>
                                  </div>
                                } @else {
                                  <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">Sin alias</span>
                                }
                              </td>
                              <td class="px-4 py-3">
                                <div class="flex justify-end gap-2">
                                  <button type="button" (click)="prepareVariableMap(variable)" class="icon-button" title="Editar formulario">
                                    <span class="material-symbols-outlined text-[18px]">edit_square</span>
                                  </button>
                                  @if (variable.mapping) {
                                    <button type="button" (click)="deleteVariableMap(variable.mapping)" class="icon-button text-red-500" title="Eliminar alias">
                                      <span class="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                  }
                                </div>
                              </td>
                            </tr>
                          } @empty {
                            <tr class="bg-white">
                              <td colspan="4" class="px-4 py-8 text-center text-sm font-semibold text-slate-400">Aun no hay variables detectadas para el serial de este sitio.</td>
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
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
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
                <table class="w-full min-w-[920px] text-left text-xs">
                  <thead class="bg-slate-50">
                    <tr class="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                      <th class="px-4 py-3">FECHA</th>
                      <th class="px-4 py-3">CAUDAL</th>
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
                        <td class="px-4 py-3">{{ row.totalizador }}</td>
                        <td class="px-4 py-3">{{ row.nivelFreatico }}</td>
                      </tr>
                    } @empty {
                      <tr class="border-t border-slate-100 text-[12px] font-semibold text-slate-400">
                        <td class="px-4 py-8 text-center" colspan="4">Sin registros disponibles para este filtro.</td>
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

          <section class="grid grid-cols-1 gap-3 xl:grid-cols-[520px_minmax(0,1fr)]">
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
                <div class="grid grid-cols-[minmax(0,1fr)_128px] gap-5">
                  <div class="relative h-[300px] overflow-hidden rounded-lg border border-slate-100 bg-[#eee7d8]">
                    <div class="absolute inset-0 opacity-40" style="background-image: radial-gradient(#c6b58f 1px, transparent 1px); background-size: 8px 8px;"></div>
                    <div class="absolute left-[31%] top-8 h-[238px] w-[12px] rounded-sm bg-slate-300"></div>
                    <div class="absolute left-[38%] top-8 h-[238px] w-[112px] border-x-4 border-slate-500 bg-white/80"></div>
                    <div
                      class="dga-water-column absolute bottom-0 left-[38%] w-[112px] overflow-hidden border-x-4 border-slate-500 bg-gradient-to-b from-cyan-300 via-cyan-500 to-cyan-800"
                      [style.height.px]="wellWaterColumnHeightPx()"
                    >
                      <div class="dga-water-wave dga-water-wave-a"></div>
                      <div class="dga-water-wave dga-water-wave-b"></div>
                      <div class="dga-water-shine"></div>
                    </div>
                    <div class="absolute left-[16%] top-[112px] w-[215px] border-t-2 border-dashed border-cyan-600"></div>
                    <div class="absolute left-5 top-[100px] text-[10px] font-black text-cyan-700">Nivel<br>Freatico</div>
                    <div class="absolute bottom-[116px] left-[57%] z-10 text-2xl font-black text-white drop-shadow-sm">{{ formatPercent(wellFillPercentage()) }}</div>
                    <div class="absolute right-4 top-8 text-[10px] font-bold text-slate-500">Superficie</div>
                    <div class="absolute bottom-7 right-5 flex items-center gap-1 text-[10px] font-bold text-orange-500">
                      <span class="h-2.5 w-2.5 rounded-sm bg-orange-500"></span>
                      Sensor
                    </div>
                  </div>

                  <div class="space-y-3">
                    <div class="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-cyan-500">Nivel freatico</p>
                      <p class="mt-1 text-2xl font-black leading-none text-cyan-700">{{ formatMeters(wellNivelFreatico()) }}<span class="text-base"> m</span></p>
                      <p class="mt-1 text-[10px] font-semibold text-cyan-500">desde superficie</p>
                    </div>

                    <div class="rounded-xl border border-slate-200 bg-white p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Llenado</p>
                      <p class="mt-1 text-2xl font-black leading-none text-slate-800">{{ formatPercent(wellFillPercentage()) }}</p>
                      <div class="mt-2 h-1.5 rounded-full bg-slate-100">
                        <div class="h-full rounded-full bg-cyan-600 transition-all duration-700" [style.width.%]="wellFillStylePercent()"></div>
                      </div>
                    </div>

                    <div class="rounded-xl border border-slate-200 bg-white p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Prof. total</p>
                      <p class="mt-1 text-2xl font-black leading-none text-slate-800">{{ formatMeters(wellTotalDepth()) }}<span class="text-base"> m</span></p>
                    </div>

                    <div class="rounded-xl border border-orange-200 bg-orange-50 p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-orange-500">Sensor</p>
                      <p class="mt-1 text-2xl font-black leading-none text-slate-800">{{ formatMeters(wellSensorDepth()) }}<span class="text-base"> m</span></p>
                    </div>
                  </div>
                </div>
              }
            </article>

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

          <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                <thead class="bg-slate-50 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th class="px-4 py-3">FECHA</th>
                    <th class="px-4 py-3 text-center">NV. FRE&Aacute;TICO [M]</th>
                    <th class="px-4 py-3 text-center">CAUDAL [L/S]</th>
                    <th class="px-4 py-3 text-center">TOTALIZADOR [M&sup3;]</th>
                    <th class="px-4 py-3 text-right">ESTADO</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (report of paginatedDgaReports(); track report.id) {
                    <tr class="bg-white text-slate-600 even:bg-slate-50/50">
                      <td class="px-4 py-3 font-semibold">
                        <span class="inline-flex items-center gap-2">
                          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                          {{ report.fecha }}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-center font-semibold">{{ formatDgaNumber(report.nivelFreatico) }}</td>
                      <td class="px-4 py-3 text-center font-semibold">{{ formatDgaNumber(report.caudal) }}</td>
                      <td class="px-4 py-3 text-center font-semibold">{{ formatDgaInteger(report.totalizador) }}</td>
                      <td class="px-4 py-3 text-right">
                        <button
                          type="button"
                          (click)="openDgaReportDetail(report)"
                          class="inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
                        >
                          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                          {{ report.estado }}
                          <span class="material-symbols-outlined text-[15px]">chevron_right</span>
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

          } @else {
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    (click)="setOperationMode('realtime')"
                    [class]="getOperationModeClass('realtime')"
                  >
                    <span class="material-symbols-outlined text-[17px]">sync</span>
                    Tiempo Real
                  </button>
                  <button
                    type="button"
                    (click)="setOperationMode('turnos')"
                    [class]="getOperationModeClass('turnos')"
                  >
                    <span class="material-symbols-outlined text-[17px]">schedule</span>
                    Operación por Turnos
                  </button>
                </div>

                <p class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  <span class="material-symbols-outlined text-[15px]">help</span>
                  La visualización puede presentar variaciones o desfases momentáneos en los datos.
                </p>
              </div>

              <div class="p-4">
                @if (operationMode() === 'realtime') {
                  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                    <div class="rounded-xl bg-gradient-to-r from-[#0797ad] to-[#18bfd0] p-4 text-white shadow-sm">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex items-baseline gap-3">
                          <h2 class="text-sm font-black">Datos en tiempo real</h2>
                          <span class="text-xs font-semibold text-cyan-100">(actualización cada minuto)</span>
                        </div>
                        <span class="inline-flex items-center gap-2 text-xs font-bold text-cyan-50">
                          <span class="h-2 w-2 rounded-full bg-emerald-300"></span>
                          06/05/2026 09:37
                        </span>
                      </div>

                      <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        @for (metric of realtimeMetrics; track metric.label) {
                          <article class="rounded-lg bg-white/12 px-4 py-3 ring-1 ring-white/10">
                            <p class="text-xs font-bold text-cyan-100">{{ metric.label }}</p>
                            <p class="mt-1 text-2xl font-black leading-none">
                              {{ metric.value }}
                              <span class="text-sm font-bold">{{ metric.unit }}</span>
                            </p>
                          </article>
                        }
                      </div>
                    </div>

                    <article class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-black text-slate-800">Caudal en Tiempo Real</h3>
                        <p class="text-xs font-semibold text-slate-400">Últimos 60 registros</p>
                      </div>

                      <div class="mt-4 h-[310px] w-full overflow-hidden rounded-lg border border-slate-100 bg-white">
                        <svg viewBox="0 0 1120 260" class="h-full w-full" role="img" aria-label="Gráfico visual de caudal en tiempo real">
                          <g class="text-slate-200" stroke="currentColor" stroke-width="1">
                            <line x1="70" y1="26" x2="1070" y2="26" />
                            <line x1="70" y1="78" x2="1070" y2="78" />
                            <line x1="70" y1="130" x2="1070" y2="130" />
                            <line x1="70" y1="182" x2="1070" y2="182" />
                            <line x1="70" y1="234" x2="1070" y2="234" />
                            <line x1="180" y1="26" x2="180" y2="234" />
                            <line x1="335" y1="26" x2="335" y2="234" />
                            <line x1="490" y1="26" x2="490" y2="234" />
                            <line x1="645" y1="26" x2="645" y2="234" />
                            <line x1="800" y1="26" x2="800" y2="234" />
                            <line x1="955" y1="26" x2="955" y2="234" />
                          </g>

                          <g class="text-slate-400" fill="currentColor" font-size="14" font-weight="700">
                            <text x="18" y="31">46.7</text>
                            <text x="18" y="83">46.65</text>
                            <text x="18" y="135">46.6</text>
                            <text x="18" y="187">46.55</text>
                            <text x="18" y="239">46.5</text>
                            <text x="78" y="254">08:40</text>
                            <text x="250" y="254">08:45</text>
                            <text x="420" y="254">08:50</text>
                            <text x="590" y="254">09:00</text>
                            <text x="760" y="254">09:10</text>
                            <text x="930" y="254">09:25</text>
                          </g>

                          <polyline
                            points="70,26 88,26 105,78 122,26 140,26 157,130 174,130 192,130 209,130 226,26 244,130 261,26 278,26 296,130 313,130 330,130 348,130 365,26 382,130 400,130 417,26 434,130 452,130 469,130 486,26 504,130 521,26 538,130 556,130 573,130 590,130 608,182 625,130 642,182 660,130 677,130 694,130 712,26 729,130 746,130 764,130 781,130 798,26 816,130 833,130 850,26 868,26 885,26 902,130 920,130 937,130 954,130 972,130 989,234 1006,130 1024,130 1041,130 1058,234 1070,26"
                            fill="none"
                            stroke="#5f7fd4"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="3"
                          />
                        </svg>
                      </div>
                    </article>
                  </div>
                } @else {
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-5 py-10 text-center">
                      <span class="material-symbols-outlined text-4xl text-cyan-600">schedule</span>
                      <h2 class="mt-2 text-lg font-black text-slate-800">Operación por Turnos</h2>
                      <p class="mx-auto mt-1 max-w-xl text-sm font-semibold text-slate-400">
                        Esta vista queda preparada para separar horas operativas, pausas y comparativas por turno cuando conectemos los datos reales.
                      </p>
                    </div>
                  </div>
                }
              </div>
            </section>
          }
        </div>
      } @else {
        <div class="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          No se encontro la instalacion solicitada.
        </div>
      }

      @if (dgaDateFilterOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]">
          <section class="w-full max-w-[740px] overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2 class="text-xl font-black uppercase tracking-wide text-slate-800">Filtrar por fecha</h2>
              <button type="button" (click)="closeDgaDateFilter()" class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700" aria-label="Cerrar filtro">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="grid gap-6 px-6 py-6 md:grid-cols-[190px_minmax(0,1fr)]">
              <div class="border-slate-200 md:border-r md:pr-6">
                <p class="mb-4 text-xs font-black uppercase tracking-wide text-slate-400">Acceso rapido</p>
                <div class="grid gap-1">
                  @for (preset of dgaDatePresets; track preset.id) {
                    <button
                      type="button"
                      (click)="applyDgaDatePreset(preset.id)"
                      class="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-600 transition-colors hover:bg-cyan-50 hover:text-cyan-700"
                    >
                      {{ preset.label }}
                    </button>
                  }
                </div>
              </div>

              <div>
                <div class="mb-5 rounded-lg bg-slate-50 px-4 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-bold text-slate-400">Rango seleccionado</p>
                      <p class="mt-0.5 text-sm font-black text-slate-700">{{ dgaSelectedRangeLongLabel() }}</p>
                    </div>
                    <span class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500">{{ dgaSelectedDaysLabel() }}</span>
                  </div>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                  <label class="grid gap-2 text-sm font-bold text-slate-600">
                    Desde
                    <input
                      type="date"
                      [value]="dgaDateFrom()"
                      (input)="setDgaDateFrom($event)"
                      class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                  <label class="grid gap-2 text-sm font-bold text-slate-600">
                    Hasta
                    <input
                      type="date"
                      [value]="dgaDateTo()"
                      (input)="setDgaDateTo($event)"
                      class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-sm font-semibold">
              <button type="button" (click)="clearDgaDateFilter()" class="text-slate-500 transition-colors hover:text-slate-800">Limpiar seleccion</button>
              <div class="flex items-center gap-3">
                <button type="button" (click)="closeDgaDateFilter()" class="rounded-lg px-4 py-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800">Cancelar</button>
                <button type="button" (click)="applyDgaDateFilter()" class="rounded-lg bg-cyan-600 px-4 py-2 font-black text-white transition-colors hover:bg-cyan-700">Aplicar filtro</button>
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
  dgaDateFilterOpen = signal(false);
  selectedDgaReport = signal<DgaReportRow | null>(null);
  dgaDateFrom = signal('2026-04-06');
  dgaDateTo = signal('2026-04-07');
  dgaRowsPerPage = signal(10);
  dgaPage = signal(1);
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
  dashboardRefreshLabel = computed(() => this.formatDashboardRefresh(this.dashboardLastLoadedAt(), this.currentTime()));
  latestDeviceReadingLabel = computed(() => this.formatLatestDeviceReading(this.dashboardData()?.ultima_lectura));
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
    { icon: 'download', title: 'Descargar', subtitle: 'Exportar Excel', color: 'text-emerald-600' },
    { icon: 'open_in_new', title: 'Ver en DGA', subtitle: 'Portal oficial', color: 'text-blue-600' },
    { icon: 'description', title: 'Reporte DGA', subtitle: 'Formato oficial', color: 'text-violet-600' },
  ];

  readonly realtimeMetrics = [
    { label: 'Caudal Actual', value: '46.60', unit: 'L/s' },
    { label: 'Totalizador', value: '6,043,415', unit: 'm³' },
    { label: 'Nivel de Agua', value: '27.20', unit: 'm' },
    { label: 'Consumo Hoy', value: '0.0', unit: 'm³' },
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

  private formatDashboardRefresh(date: Date | null, now: Date): string {
    if (!date) return 'Vista sin actualizar';

    return `Vista cargada ${this.formatChileDateTime(date)} - ${this.formatRelativeTime(date, now)}`;
  }

  private formatRelativeTime(date: Date, now: Date): string {

    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
    if (elapsedSeconds < 60) return `hace ${elapsedSeconds} segundos`;

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `hace ${elapsedMinutes} min`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return `hace ${elapsedHours} h`;
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

  selectedVariableRole(): SiteTypeRoleOption | undefined {
    return this.variableRoleOptions().find((role) => role.id === this.variableForm().rol_dashboard);
  }

  selectedVariableTransform(): SiteTypeTransformOption | undefined {
    return this.variableTransformOptions().find((transform) => transform.id === this.variableForm().transformacion);
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

    if (!rawText) return 'Ingresa un valor crudo';

    if (this.isLinearTransformValue(form.transformacion)) {
      const raw = this.toNumber(rawText);
      const factor = this.toNumber(form.factor) ?? 1;
      const offset = this.toNumber(form.offset) ?? 0;
      if (raw === null) return 'Valor crudo no numerico';
      return `${this.formatPreviewNumber((raw * factor) + offset)}${unit}`;
    }

    if (form.transformacion === 'ieee754_32') {
      return form.d2 ? 'Se calculara con dos registros' : 'Selecciona segundo registro';
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

  handleQuickAction(action: { tab?: DetailTab; openHistory?: boolean }): void {
    if (action.openHistory) {
      this.openHistoryView();
      return;
    }

    if (action.tab) {
      this.setDetailTab(action.tab);
    }
  }

  openHistoryView(): void {
    this.settingsPanelOpen.set(false);
    this.historyPanelOpen.set(true);
    this.historyPage.set(1);
  }

  closeHistoryView(): void {
    this.historyPanelOpen.set(false);
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
    const today = new Date();
    let from = new Date(today);
    let to = new Date(today);

    if (presetId === 'yesterday') {
      from = this.addDays(today, -1);
      to = this.addDays(today, -1);
    } else if (presetId === 'last7') {
      from = this.addDays(today, -6);
    } else if (presetId === 'last30') {
      from = this.addDays(today, -29);
    } else if (presetId === 'thisMonth') {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (presetId === 'previousMonth') {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
    }

    this.dgaDateFrom.set(this.toDateInputValue(from));
    this.dgaDateTo.set(this.toDateInputValue(to));
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
    const base = 'relative inline-flex h-9 items-center gap-2 text-xs transition-colors';
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
      totalizador: this.formatHistoricalValue(row.totalizador),
      nivelFreatico: this.formatHistoricalValue(row.nivel_freatico),
    };
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
