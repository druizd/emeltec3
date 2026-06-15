import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
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
} from '../../../services/administration.service';
import { getSiteTypeUi } from '../../../shared/site-type-ui';
import { SkeletonComponent } from '../../../components/ui/skeleton';

interface SettingsStatus {
  type: 'success' | 'error' | '';
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
  divisor: string;
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
  divisor: '1',
  offset: '0',
  wordSwap: 'false',
  sandboxRaw: '',
};

const DEFAULT_POZO_CONFIG_FORM: PozoConfigForm = {
  profundidad_pozo_m: '',
  profundidad_sensor_m: '',
};

const COMMON_TRANSFORMS: SiteTypeTransformOption[] = [
  {
    id: 'directo',
    label: 'Directo',
    description: 'Usa el valor crudo del equipo tal como llega, sin convertir.',
    enabled: true,
  },
  {
    id: 'lineal',
    label: 'Lineal',
    description:
      'Aplica resultado = raw × factor ÷ divisor + offset. Ejemplo: si el equipo envía 1234 y quieres mostrar 12.34, usa divisor = 100.',
    enabled: true,
  },
  {
    id: 'ieee754_32',
    label: 'Coma flotante (2 registros · IEEE754)',
    description:
      'Combina dos registros Modbus consecutivos en un decimal IEEE754 (FLOAT32). Si tu equipo invierte el orden de los bytes, cambia el "Orden de registros" a CDAB.',
    enabled: true,
    requiresD2: true,
  },
  {
    id: 'uint32_registros',
    label: 'Entero combinado (2 registros · 32 bits)',
    description:
      'Combina dos registros Modbus en un entero de 32 bits: (registro alto × 65 536) + registro bajo + offset. Pensado para totalizadores que no caben en un solo registro.',
    enabled: true,
    requiresD2: true,
  },
];

const DEFAULT_SITE_TYPE_CATALOG: SiteTypeCatalogResponse = {
  generico: {
    id: 'generico',
    label: 'Generico',
    roles: [
      {
        id: 'generico',
        label: 'Generico',
        unitHint: '',
        description: 'Variable auxiliar sin uso especial en dashboard.',
      },
    ],
    transforms: COMMON_TRANSFORMS,
  },
};

function emptySite(): SiteRecord {
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

function emptyVariables(): SiteVariablesPayload {
  return {
    site: emptySite(),
    pozo_config: null,
    variables: [],
    mappings: [],
  };
}

@Component({
  selector: 'app-site-variable-settings-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SkeletonComponent],
  template: `
    <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-100 px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              [style.background]="accentSoft"
              [style.color]="accentColor"
            >
              <span class="material-symbols-outlined text-[22px]">settings</span>
            </span>
            <div class="min-w-0">
              <p
                class="truncate text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              >
                Configuración del sitio / {{ siteTypeLabel() }}
              </p>
              <h2 class="truncate text-h5 font-semibold leading-none text-slate-800">
                {{ displaySite().descripcion || 'Instalación' }}
              </h2>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-caption font-bold text-slate-500">
            <span
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3"
            >
              <span class="material-symbols-outlined text-[16px]">memory</span>
              {{ displaySite().id_serial || 'Sin serial' }}
            </span>
            @if (showDgaReporteButton) {
              <button
                type="button"
                (click)="openDgaReporte.emit()"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-tint-25 bg-primary-tint-08 px-3 text-caption font-semibold text-primary-container transition-colors hover:bg-primary-tint-14"
                aria-label="Configurar reporte DGA"
              >
                <span class="material-symbols-outlined text-[16px]">description</span>
                Configurar reporte DGA
              </button>
            }
            <button
              type="button"
              (click)="load()"
              [disabled]="loading()"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Recargar configuración"
            >
              <span class="material-symbols-outlined text-[18px]" [class.animate-spin]="loading()"
                >refresh</span
              >
            </button>
          </div>
        </div>

        @if (status().message) {
          <div [class]="statusClass()">
            <span class="material-symbols-outlined text-[18px]">{{
              status().type === 'success' ? 'check_circle' : 'error'
            }}</span>
            {{ status().message }}
          </div>
        }
      </div>

      @if (loading()) {
        <div class="grid gap-5 p-4 xl:grid-cols-[430px_minmax(0,1fr)]">
          <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <app-skeleton class="h-4 w-32 rounded" />
            @for (_ of [0, 1, 2, 3, 4]; track $index) {
              <app-skeleton class="h-10 w-full rounded-lg" />
            }
          </div>
          <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <app-skeleton class="h-4 w-40 rounded" />
            @for (_ of [0, 1, 2, 3, 4, 5]; track $index) {
              <div class="grid grid-cols-[1fr_1fr_60px] items-center gap-3">
                <app-skeleton class="h-8 rounded-lg" />
                <app-skeleton class="h-8 rounded-lg" />
                <app-skeleton class="h-8 rounded-lg" />
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="grid gap-5 p-4 xl:grid-cols-[430px_minmax(0,1fr)]">
          <div class="space-y-4">
            @if (showPozoConfig && isPozoSite()) {
              <section class="rounded-xl border border-primary-tint-15 bg-primary-tint-08 p-4">
                <div class="mb-4 flex items-start gap-3">
                  <span class="material-symbols-outlined mt-0.5 text-[22px] text-primary-container"
                    >water_drop</span
                  >
                  <div>
                    <h3 class="text-body-sm font-semibold text-slate-900">
                      Configuración manual del pozo
                    </h3>
                    <p class="text-caption font-semibold text-primary-container">
                      Campos opcionales para proyectar el nivel freático.
                    </p>
                  </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500"
                      >Profundidad total del pozo (m)</label
                    >
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
                    <label class="mb-1 block text-caption font-bold text-slate-500"
                      >Distancia del sensor desde superficie (m)</label
                    >
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
                  [disabled]="busy() === 'pozo'"
                  class="primary-button mt-4"
                >
                  <span class="material-symbols-outlined text-[18px]">save</span>
                  {{ busy() === 'pozo' ? 'Guardando' : 'Guardar configuración' }}
                </button>
              </section>
            }

            <form
              (submit)="saveVariableMap($event)"
              class="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
            >
              <div>
                <p class="text-body-sm font-semibold text-slate-900">Variables del equipo</p>
                <p class="mt-1 text-caption font-semibold text-slate-400">
                  Se guardan directamente en este sitio, sin seleccionar equipo.
                </p>
              </div>

              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-caption font-bold text-slate-500"
                    >Dato original</label
                  >
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
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <label class="block text-caption font-bold text-slate-500"
                      >Transformación</label
                    >
                    <details class="group relative">
                      <summary
                        class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-slate-200 text-caption-xs font-bold text-slate-400 hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label="Ver todas las transformaciones disponibles"
                      >
                        ?
                      </summary>
                      <div
                        class="absolute right-0 top-7 z-10 w-80 rounded-xl border border-slate-200 bg-white p-3 text-caption shadow-lg"
                      >
                        <p
                          class="mb-2 text-caption-xs font-bold uppercase tracking-[0.1em] text-slate-400"
                        >
                          Tipos de transformación
                        </p>
                        <dl class="space-y-2">
                          @for (transform of variableTransformOptions(); track transform.id) {
                            <div>
                              <dt class="font-semibold text-slate-700">{{ transform.label }}</dt>
                              <dd class="text-slate-500">{{ transform.description }}</dd>
                            </div>
                          }
                        </dl>
                      </div>
                    </details>
                  </div>
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
                    <p class="mt-1 text-caption font-semibold text-slate-400">
                      {{ selectedVariableTransform()?.description }}
                    </p>
                  }
                </div>

                @if (requiresSecondRegister()) {
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Segundo registro</label
                      >
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
                        <label class="mb-1 block text-caption font-bold text-slate-500"
                          >Orden de registros</label
                        >
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
                        <p class="mt-1 text-caption font-semibold text-slate-400">
                          {{ registerOrderHint() }}
                        </p>
                      </div>
                    } @else {
                      <div
                        class="rounded-md border border-primary-tint-15 bg-primary-tint-08 px-3 py-2 text-caption font-semibold text-primary-container"
                      >
                        Fórmula: {{ variableForm().d1 || 'primer registro' }} *
                        {{ variableForm().d2 || 'segundo registro' }}
                      </div>
                    }
                  </div>
                }
              </div>

              <div>
                <label class="mb-1 block text-caption font-bold text-slate-500">Alias</label>
                <input
                  required
                  name="settings-variable-alias"
                  [ngModel]="variableForm().alias"
                  (ngModelChange)="updateVariableForm('alias', $event)"
                  class="field-control bg-white"
                  placeholder="Nivel, caudal, energía"
                />
              </div>

              <div>
                <label class="mb-1 block text-caption font-bold text-slate-500"
                  >Uso en dashboard</label
                >
                <select
                  name="settings-variable-role"
                  [ngModel]="variableForm().rol_dashboard"
                  (ngModelChange)="updateVariableRole($event)"
                  class="field-control bg-white"
                >
                  @for (role of variableRoleOptions(); track role.id) {
                    <option [value]="role.id">{{ role.label }}</option>
                  }
                </select>
                @if (selectedVariableRole()?.description) {
                  <p class="mt-1 text-caption font-semibold text-slate-400">
                    {{ selectedVariableRole()?.description }}
                  </p>
                }
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="mb-1 block text-caption font-bold text-slate-500">Tipo</label>
                  <select
                    name="settings-variable-type"
                    [ngModel]="variableForm().tipo_dato"
                    (ngModelChange)="updateVariableForm('tipo_dato', $event)"
                    class="field-control bg-white"
                  >
                    <option value="FLOAT">FLOAT</option>
                    <option value="INTEGER">INTEGER</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="TEXT">TEXT</option>
                  </select>
                </div>
                <div>
                  <label class="mb-1 block text-caption font-bold text-slate-500">Unidad</label>
                  <input
                    name="settings-variable-unit"
                    [ngModel]="variableForm().unidad"
                    (ngModelChange)="updateVariableForm('unidad', $event)"
                    class="field-control bg-white"
                    placeholder="kWh, %, V"
                  />
                </div>
              </div>

              @if (isLinearTransform()) {
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500"
                      >Factor multiplicador</label
                    >
                    <input
                      type="number"
                      step="any"
                      name="settings-variable-factor"
                      [ngModel]="variableForm().factor"
                      (ngModelChange)="updateVariableForm('factor', $event)"
                      class="field-control bg-white"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500">Divisor</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      name="settings-variable-divisor"
                      [ngModel]="variableForm().divisor"
                      (ngModelChange)="updateVariableForm('divisor', $event)"
                      class="field-control bg-white"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500">Offset</label>
                    <input
                      type="number"
                      step="any"
                      name="settings-variable-offset"
                      [ngModel]="variableForm().offset"
                      (ngModelChange)="updateVariableForm('offset', $event)"
                      class="field-control bg-white"
                      placeholder="0"
                    />
                  </div>
                </div>
                <p class="text-caption-xs text-slate-400">
                  Fórmula:
                  <span class="font-mono">resultado = raw × factor / divisor + offset</span>. Usá
                  divisor=100 para correr 2 decimales (ej. raw 1234 → 12.34).
                </p>
              }

              @if (isUint32TransformSelected()) {
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500"
                      >Factor multiplicador</label
                    >
                    <input
                      type="number"
                      step="any"
                      name="settings-variable-uint32-factor"
                      [ngModel]="variableForm().factor"
                      (ngModelChange)="updateVariableForm('factor', $event)"
                      class="field-control bg-white"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500">Divisor</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      name="settings-variable-uint32-divisor"
                      [ngModel]="variableForm().divisor"
                      (ngModelChange)="updateVariableForm('divisor', $event)"
                      class="field-control bg-white"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label class="mb-1 block text-caption font-bold text-slate-500">Offset</label>
                    <input
                      type="number"
                      step="any"
                      name="settings-variable-uint32-offset"
                      [ngModel]="variableForm().offset"
                      (ngModelChange)="updateVariableForm('offset', $event)"
                      class="field-control bg-white"
                      placeholder="0"
                    />
                  </div>
                </div>
                <p class="text-caption-xs text-slate-400">
                  Fórmula:
                  <span class="font-mono"
                    >resultado = ((registro alto × 65536) + registro bajo) × factor / divisor +
                    offset</span
                  >. Usá divisor=100 para correr 2 decimales.
                </p>
              }

              <div class="rounded-lg border border-primary-tint-15 bg-primary-tint-08 p-3">
                <div class="mb-3 flex items-center gap-2">
                  <span class="material-symbols-outlined text-[18px] text-primary-container"
                    >calculate</span
                  >
                  <h3
                    class="text-caption font-semibold uppercase tracking-[0.16em] text-primary-container"
                  >
                    Calculadora de prueba (vista previa)
                  </h3>
                </div>

                <div>
                  <label class="mb-1 block text-caption font-bold text-slate-500"
                    >Valor crudo entrante (en vivo desde el equipo)</label
                  >
                  <input
                    name="settings-variable-sandbox-raw"
                    [value]="liveRawValueForPreview()"
                    readonly
                    class="field-control bg-slate-50 cursor-not-allowed font-mono text-slate-700"
                    placeholder="(se carga al elegir registro d1)"
                  />
                </div>

                <div
                  class="mt-3 rounded-lg border border-primary-tint-15 bg-white px-3 py-2 shadow-sm"
                >
                  <p
                    class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                  >
                    Resultado proyectado en gráfico
                  </p>
                  <p class="mt-1 text-h5 font-semibold text-primary-container">
                    {{ previewResultText() }}
                  </p>
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
                <button type="button" (click)="resetVariableForm()" class="secondary-button">
                  Limpiar
                </button>
                <button type="submit" [disabled]="busy() === 'variable'" class="primary-button">
                  <span class="material-symbols-outlined text-[18px]">label</span>
                  {{
                    busy() === 'variable'
                      ? 'Guardando'
                      : variableForm().mapId
                        ? 'Actualizar variable'
                        : 'Guardar variable'
                  }}
                </button>
              </div>
            </form>
          </div>

          <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"
            >
              <div>
                <h3 class="text-body-sm font-semibold text-slate-900">
                  Datos detectados del equipo
                </h3>
                <p class="text-caption font-semibold text-slate-400">
                  REG1, REG2 y similares se asignan manualmente por sitio.
                </p>
              </div>
              <p class="text-caption font-semibold text-slate-400">
                {{ siteVariables().variables.length }} variables
              </p>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full min-w-175 text-left text-body-sm">
                <thead
                  class="bg-slate-100 text-caption font-semibold uppercase tracking-[0.12em] text-slate-500"
                >
                  <tr>
                    <th class="px-4 py-3">Dato</th>
                    <th class="px-4 py-3">Valor</th>
                    <th class="px-4 py-3">Alias</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (variable of siteVariables().variables; track variable.nombre_dato) {
                    <tr
                      class="group cursor-pointer bg-white transition-colors hover:bg-primary-tint-06"
                      (click)="prepareVariableMap(variable)"
                      title="Seleccionar variable"
                    >
                      <td class="px-4 py-3 font-mono text-caption font-bold text-slate-700">
                        {{ variable.nombre_dato }}
                      </td>
                      <td class="px-4 py-3 font-bold text-slate-900">
                        {{ displayValue(variable.valor_dato) }}
                      </td>
                      <td class="px-4 py-3">
                        <div class="flex items-center justify-between gap-3">
                          @if (variable.mapping) {
                            <div>
                              <p class="font-bold text-slate-800">{{ variable.mapping.alias }}</p>
                              <p class="text-caption text-slate-400">
                                {{ displayRole(variable.mapping.rol_dashboard) }} ·
                                {{ displayTransform(variable.mapping.transformacion) }}
                                {{ variable.mapping.unidad || '' }}
                              </p>
                            </div>
                            <button
                              type="button"
                              (click)="
                                $event.stopPropagation(); deleteVariableMap(variable.mapping)
                              "
                              class="icon-button shrink-0 text-red-500 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                              aria-label="Eliminar alias"
                            >
                              <span class="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          } @else {
                            <span
                              class="rounded-md bg-slate-100 px-2 py-1 text-caption font-bold text-slate-500"
                            >
                              Sin alias
                            </span>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr class="bg-white">
                      <td
                        colspan="3"
                        class="px-4 py-8 text-center text-body-sm font-semibold text-slate-400"
                      >
                        Aún no hay variables detectadas para el serial de este sitio.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .field-control {
        width: 100%;
        border-radius: 0.5rem;
        border: 1px solid rgb(203 213 225);
        background: rgb(248 250 252);
        padding: 0.625rem 0.75rem;
        font-size: 0.875rem;
        color: rgb(15 23 42);
        outline: none;
        transition:
          border-color 160ms ease,
          background-color 160ms ease,
          box-shadow 160ms ease;
      }

      .field-control:focus {
        border-color: var(--color-primary);
        background: white;
        box-shadow: 0 0 0 3px rgba(13, 175, 189, 0.18);
      }

      .primary-button,
      .secondary-button,
      .icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        transition:
          background-color 160ms ease,
          color 160ms ease,
          border-color 160ms ease,
          transform 160ms ease;
      }

      .primary-button {
        min-height: 2.5rem;
        width: 100%;
        border-radius: 0.5rem;
        background: var(--color-primary);
        padding: 0.625rem 1rem;
        font-size: 0.875rem;
        font-weight: 700;
        color: white;
        border: 1px solid var(--color-primary);
      }

      .primary-button:hover:not(:disabled) {
        background: var(--color-primary-container);
        border-color: var(--color-primary-container);
      }

      .primary-button:active:not(:disabled) {
        transform: scale(0.98);
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
        font-weight: 700;
        color: rgb(71 85 105);
      }

      .secondary-button:hover {
        background: rgb(248 250 252);
        border-color: rgba(13, 175, 189, 0.3);
        color: var(--color-primary-container);
      }

      .secondary-button:active {
        transform: scale(0.98);
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
        border-color: rgba(13, 175, 189, 0.3);
        background: rgba(13, 175, 189, 0.06);
        color: var(--color-primary-container);
      }

      @media (prefers-reduced-motion: reduce) {
        .primary-button,
        .secondary-button,
        .icon-button,
        .field-control {
          transition: none;
        }
        .primary-button:active:not(:disabled),
        .secondary-button:active {
          transform: none;
        }
      }
    `,
  ],
})
export class SiteVariableSettingsPanelComponent implements OnChanges {
  @Input() siteId = '';
  @Input() site: SiteRecord | null = null;
  @Input() accentColor = '#0dafbd';
  @Input() accentSoft = 'rgba(13,175,189,0.10)';
  /**
   * Renders the pozo-config block when the loaded site is `tipo_sitio === 'pozo'`.
   * Default true; consumers that should never show pozo can pass `[showPozoConfig]="false"`.
   */
  @Input() showPozoConfig = true;
  /** Renders a "Configurar reporte DGA" button in the header, emitting `openDgaReporte`. */
  @Input() showDgaReporteButton = false;

  /** Fires after any save/delete on variables or pozo-config, so the parent can refresh dashboards/hierarchy. */
  @Output() variableMapChanged = new EventEmitter<void>();
  /** Fires when the user clicks the optional DGA reporte header button. */
  @Output() openDgaReporte = new EventEmitter<void>();

  private api = inject(AdministrationService);

  inputSite = signal<SiteRecord | null>(null);
  loading = signal(false);
  busy = signal('');
  status = signal<SettingsStatus>({ type: '', message: '' });
  siteTypeCatalog = signal<SiteTypeCatalogResponse>(DEFAULT_SITE_TYPE_CATALOG);
  siteVariables = signal<SiteVariablesPayload>(emptyVariables());
  variableForm = signal<VariableForm>({ ...DEFAULT_VARIABLE_FORM });
  pozoConfigForm = signal<PozoConfigForm>({ ...DEFAULT_POZO_CONFIG_FORM });

  displaySite = computed(() => {
    const loaded = this.siteVariables().site;
    if (loaded?.id) return loaded;
    return this.inputSite() || emptySite();
  });

  siteType = computed(() => this.displaySite().tipo_sitio || 'generico');
  siteTypeLabel = computed(() => getSiteTypeUi(this.siteType()).label);
  isPozoSite = computed(() => this.siteType() === 'pozo');

  selectedSiteCatalog = computed<SiteTypeCatalogItem>(() => {
    const type = this.siteType();
    return (
      this.siteTypeCatalog()[type] ||
      this.siteTypeCatalog()['generico'] ||
      DEFAULT_SITE_TYPE_CATALOG['generico']
    );
  });
  variableRoleOptions = computed<SiteTypeRoleOption[]>(() => this.selectedSiteCatalog().roles);
  variableTransformOptions = computed<SiteTypeTransformOption[]>(() =>
    this.selectedSiteCatalog().transforms.filter((transform) => transform.enabled !== false),
  );
  selectedVariableRole = computed(() =>
    this.variableRoleOptions().find((role) => role.id === this.variableForm().rol_dashboard),
  );
  selectedVariableTransform = computed(() =>
    this.variableTransformOptions().find(
      (transform) => transform.id === this.variableForm().transformacion,
    ),
  );

  ngOnChanges(changes: SimpleChanges): void {
    this.inputSite.set(this.site);

    if (changes['siteId'] && this.siteId) {
      this.load();
    }
  }

  load(): void {
    if (!this.siteId) return;

    this.loading.set(true);
    this.status.set({ type: '', message: '' });

    forkJoin({
      catalog: this.api.getSiteTypeCatalog(),
      variables: this.api.getSiteVariables(this.siteId),
    }).subscribe({
      next: ({ catalog, variables }) => {
        this.siteTypeCatalog.set(catalog.ok ? catalog.data : DEFAULT_SITE_TYPE_CATALOG);
        if (variables.ok) {
          this.siteVariables.set(variables.data);
          this.patchPozoConfigForm(variables.data.pozo_config);
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.setError(this.errorMessage(err, 'No fue posible cargar la configuración.'));
      },
    });
  }

  // ─── Variable form ────────────────────────────────────────────────────

  selectVariableKey(d1: string): void {
    const selected = this.siteVariables().variables.find((item) => item.nombre_dato === d1);
    const inferredRole = this.inferVariableRoleFromValues(
      this.variableForm().alias || selected?.nombre_dato,
      d1,
      this.variableForm().unidad,
    );
    const roleOption = this.variableRoleOptions().find((item) => item.id === inferredRole);

    this.variableForm.update((form) => ({
      ...form,
      d1,
      alias: form.alias || selected?.nombre_dato || '',
      tipo_dato: form.tipo_dato || this.guessDataType(selected?.valor_dato ?? null),
      rol_dashboard: form.rol_dashboard === 'generico' ? inferredRole : form.rol_dashboard,
      unidad: form.unidad || roleOption?.unitHint || '',
      sandboxRaw:
        selected?.valor_dato === null || selected?.valor_dato === undefined
          ? form.sandboxRaw
          : String(selected.valor_dato),
    }));
  }

  updateVariableForm(field: keyof VariableForm, value: string): void {
    this.variableForm.update((current) => ({ ...current, [field]: value }));
  }

  updateVariableRole(roleId: string): void {
    const role = this.variableRoleOptions().find((item) => item.id === roleId);
    this.variableForm.update((current) => ({
      ...current,
      rol_dashboard: roleId,
      unidad: current.unidad || role?.unitHint || '',
    }));
  }

  updateVariableTransform(transformId: string): void {
    const normalized = this.normalizeTransform(transformId);
    this.variableForm.update((current) => ({
      ...current,
      transformacion: normalized,
      d2: this.transformRequiresD2(normalized) ? current.d2 : '',
      wordSwap: normalized === 'uint32_registros' ? 'true' : current.wordSwap,
      factor: this.usesScaleTransformValue(normalized) ? current.factor || '1' : '1',
      divisor: this.usesScaleTransformValue(normalized) ? current.divisor || '1' : '1',
      offset: this.usesScaleTransformValue(normalized) ? current.offset || '0' : '0',
    }));
  }

  saveVariableMap(event: Event): void {
    event.preventDefault();
    if (!this.siteId) return;

    const form = this.variableForm();
    const payload: CreateVariableMapPayload = {
      alias: form.alias.trim(),
      d1: form.d1,
      d2: form.d2 || null,
      tipo_dato: form.tipo_dato,
      unidad: form.unidad || null,
      rol_dashboard: this.normalizeRole(form.rol_dashboard),
      transformacion: this.normalizeTransform(form.transformacion),
      parametros: this.buildVariableParameters(),
    };

    this.busy.set('variable');
    const request$ = form.mapId
      ? this.api.updateSiteVariableMap(this.siteId, form.mapId, payload)
      : this.api.createSiteVariableMap(this.siteId, payload);

    request$.subscribe({
      next: (res) => {
        this.busy.set('');
        this.setSuccess(res.message || 'Variable guardada.');
        this.resetVariableForm();
        this.load();
        this.variableMapChanged.emit();
      },
      error: (err: unknown) => {
        this.busy.set('');
        this.setError(this.errorMessage(err, 'No fue posible guardar la variable.'));
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
      rol_dashboard: this.normalizeRole(variable.mapping?.rol_dashboard),
      transformacion: this.normalizeTransform(variable.mapping?.transformacion),
      factor: this.configNumberToString(params?.factor) || '1',
      // divisor is UI-only; the BD only persists factor. On load, default 1
      // so an admin can re-split a stored factor for editing decimals.
      divisor: '1',
      offset: this.configNumberToString(params?.offset) || '0',
      wordSwap: String(params?.word_swap ?? params?.wordSwap ?? false),
      // sandboxRaw is no longer an editable input; calculator reads from d1 live value.
      sandboxRaw: '',
    });
  }

  deleteVariableMap(mapping: VariableMapping): void {
    if (!this.siteId) return;

    this.busy.set('delete-variable');
    this.api.deleteSiteVariableMap(this.siteId, mapping.id).subscribe({
      next: (res) => {
        this.busy.set('');
        this.setSuccess(res.message || 'Variable eliminada.');
        this.load();
        this.variableMapChanged.emit();
      },
      error: (err: unknown) => {
        this.busy.set('');
        this.setError(this.errorMessage(err, 'No fue posible eliminar la variable.'));
      },
    });
  }

  resetVariableForm(): void {
    this.variableForm.set({ ...DEFAULT_VARIABLE_FORM });
  }

  // ─── Pozo config ──────────────────────────────────────────────────────

  updatePozoConfigForm(field: keyof PozoConfigForm, value: string): void {
    this.pozoConfigForm.update((form) => ({ ...form, [field]: value }));
  }

  savePozoConfig(): void {
    if (!this.siteId || !this.isPozoSite()) return;

    this.busy.set('pozo');
    this.api
      .updateSite(this.siteId, {
        pozo_config: this.buildPozoConfigPayload(),
      })
      .subscribe({
        next: (res) => {
          this.busy.set('');
          this.setSuccess(res.message || 'Configuración del pozo guardada.');
          const pozoConfig =
            (res.data as SiteRecord & { pozo_config?: PozoConfig | null })?.pozo_config || null;
          this.siteVariables.update((current) => ({
            ...current,
            pozo_config: pozoConfig,
          }));
          this.patchPozoConfigForm(pozoConfig);
          this.variableMapChanged.emit();
        },
        error: (err: unknown) => {
          this.busy.set('');
          this.setError(
            this.errorMessage(err, 'No fue posible guardar la configuración del pozo.'),
          );
        },
      });
  }

  // ─── Derived booleans + display helpers ───────────────────────────────

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
    const base =
      'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-caption font-semibold uppercase tracking-[0.1em] transition';
    return this.variableForm().transformacion === transformId
      ? `${base} border-primary-tint-35 bg-primary-tint-14 text-primary-container`
      : `${base} border-primary-tint-15 bg-white text-primary-container hover:border-primary-tint-30 hover:bg-primary-tint-08`;
  }

  liveRawValueForPreview(): string {
    const form = this.variableForm();
    if (!form.d1) return '';
    const v = this.valueForVariableKey(form.d1);
    if (v === null || v === undefined) return '';
    return typeof v === 'number' ? String(v) : String(v);
  }

  previewResultText(): string {
    const form = this.variableForm();
    const rawText = this.liveRawValueForPreview();
    const unit = form.unidad ? ` ${form.unidad}` : '';

    if (!rawText && !this.requiresSecondRegister()) {
      return form.d1 ? 'Sin lectura reciente del equipo' : 'Selecciona registro d1';
    }

    if (this.isLinearTransformValue(form.transformacion)) {
      const raw = this.toNumber(rawText);
      const factor = this.toNumber(form.factor) ?? 1;
      const offset = this.toNumber(form.offset) ?? 0;
      if (raw === null) return 'Valor crudo no numérico';
      return `${this.formatPreviewNumber((raw * factor) / this.safeDivisor(form.divisor) + offset)}${unit}`;
    }

    if (form.transformacion === 'ieee754_32') {
      const rawA = this.valueForVariableKey(form.d1);
      const rawB = this.valueForVariableKey(form.d2);
      const decoded = this.decodeFloat32FromRegisters(rawA, rawB, form.wordSwap === 'true');
      if (decoded === null) {
        return form.d2 ? 'Registros no numéricos' : 'Selecciona segundo registro';
      }
      return `${this.formatPreviewNumber(decoded)}${unit}`;
    }

    if (form.transformacion === 'uint32_registros') {
      const rawA = this.toRegisterWord(this.valueForVariableKey(form.d1));
      const rawB = this.toRegisterWord(this.valueForVariableKey(form.d2));
      if (rawA === null || rawB === null) {
        return form.d2 ? 'Registros no numéricos' : 'Selecciona segundo registro';
      }
      const high = form.wordSwap === 'true' ? rawB : rawA;
      const low = form.wordSwap === 'true' ? rawA : rawB;
      const factor = this.toNumber(form.factor) ?? 1;
      const offset = this.toNumber(form.offset) ?? 0;
      const combinado = high * 65536 + low;
      return `${this.formatPreviewNumber((combinado * factor) / this.safeDivisor(form.divisor) + offset)}${unit}`;
    }

    return `${rawText}${unit}`;
  }

  displayValue(value: SiteVariable['valor_dato']): string {
    if (value === null || value === undefined) return 'Sin datos';
    return String(value);
  }

  displayRole(roleId: string | null | undefined): string {
    return this.variableRoleOptions().find((role) => role.id === roleId)?.label || 'Genérico';
  }

  displayTransform(transformId: string | null | undefined): string {
    const normalized = this.normalizeTransform(transformId);
    return (
      this.variableTransformOptions().find((transform) => transform.id === normalized)?.label ||
      normalized
    );
  }

  statusClass(): string {
    const base = 'mt-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-body-sm font-bold';
    return this.status().type === 'success'
      ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
      : `${base} border-red-200 bg-red-50 text-red-700`;
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private buildVariableParameters(): NonNullable<CreateVariableMapPayload['parametros']> {
    const form = this.variableForm();

    if (this.transformRequiresD2(form.transformacion)) {
      return {
        word_swap: form.wordSwap === 'true',
        formato: form.transformacion === 'ieee754_32' ? 'float32' : 'uint32',
        ...(form.transformacion === 'uint32_registros'
          ? {
              // Mismo split UI factor/divisor que lineal: el backend solo
              // conoce factor, divisor es ayuda de UI para tipear decimales.
              factor: (this.toNumber(form.factor) ?? 1) / this.safeDivisor(form.divisor),
              offset: this.toNumber(form.offset) ?? 0,
            }
          : {}),
      };
    }

    if (this.isLinearTransformValue(form.transformacion)) {
      // Persisted factor = factor_ui / divisor_ui. The BD doesn't know about
      // "divisor" — the UI split only makes it easier to type decimals
      // (ex. divisor=100 instead of factor=0.01).
      const factor = this.toNumber(form.factor) ?? 1;
      return {
        factor: factor / this.safeDivisor(form.divisor),
        offset: this.toNumber(form.offset) ?? 0,
      };
    }

    return {};
  }

  /** Divisor seguro: ignora 0/negativos/no-numéricos → 1 (no-op). */
  private safeDivisor(value: string): number {
    const divisor = this.toNumber(value) ?? 1;
    return divisor > 0 ? divisor : 1;
  }

  private buildPozoConfigPayload(): PozoConfig {
    return {
      profundidad_pozo_m: this.toNumber(this.pozoConfigForm().profundidad_pozo_m),
      profundidad_sensor_m: this.toNumber(this.pozoConfigForm().profundidad_sensor_m),
    };
  }

  private patchPozoConfigForm(config: PozoConfig | null | undefined): void {
    this.pozoConfigForm.set({
      profundidad_pozo_m: this.configNumberToString(config?.profundidad_pozo_m),
      profundidad_sensor_m: this.configNumberToString(config?.profundidad_sensor_m),
    });
  }

  private transformRequiresD2(transformId: string): boolean {
    return this.variableTransformOptions().some(
      (transform) => transform.id === transformId && transform.requiresD2 === true,
    );
  }

  private isLinearTransformValue(transformId: string): boolean {
    return transformId === 'lineal' || transformId === 'escala_lineal';
  }

  /** Transforms que aceptan factor/divisor/offset: lineal y uint32_registros. */
  private usesScaleTransformValue(transformId: string): boolean {
    return this.isLinearTransformValue(transformId) || transformId === 'uint32_registros';
  }

  private normalizeRole(roleId: string | null | undefined): string {
    const normalizedInput = String(roleId ?? '')
      .trim()
      .toLowerCase();
    const normalized = normalizedInput || 'generico';
    const availableRoles = new Set(this.variableRoleOptions().map((option) => option.id));
    if (availableRoles.has(normalized)) return normalized;
    if (normalized === 'nivel_freatico' && availableRoles.has('nivel')) return 'nivel';
    return 'generico';
  }

  private normalizeTransform(transformId: string | null | undefined): string {
    if (transformId === 'lineal' || transformId === 'escala_lineal') return 'lineal';
    if (transformId === 'ieee754' || transformId === 'ieee754_32') return 'ieee754_32';
    if (transformId === 'uint32' || transformId === 'uint32_registros') return 'uint32_registros';
    if (
      transformId === 'caudal' ||
      transformId === 'caudal_m3h_lps' ||
      transformId === 'nivel_freatico'
    ) {
      return 'lineal';
    }
    const fallback = transformId || 'directo';
    return this.variableTransformOptions().some((item) => item.id === fallback)
      ? fallback
      : 'directo';
  }

  private inferVariableRoleFromValues(...values: (string | null | undefined)[]): string {
    const text = this.normalizeSearchText(...values);
    const availableRoles = new Set(this.variableRoleOptions().map((role) => role.id));

    if (text.includes('freatico')) {
      if (availableRoles.has('nivel_freatico')) return 'nivel_freatico';
      if (availableRoles.has('nivel')) return 'nivel';
    }
    if (
      (text.includes('nivel') || text.includes('level') || text.includes('sonda')) &&
      availableRoles.has('nivel')
    )
      return 'nivel';
    if (
      (text.includes('caudal') || text.includes('l s') || text.includes('lps')) &&
      availableRoles.has('caudal')
    )
      return 'caudal';
    if (
      text.includes('totalizador') ||
      text.includes('totalizado') ||
      text.includes('acumulado') ||
      text.includes('volumen')
    ) {
      return availableRoles.has('totalizador') ? 'totalizador' : 'generico';
    }
    if ((text.includes('energia') || text.includes('kwh')) && availableRoles.has('energia'))
      return 'energia';
    if (text.includes('temperatura') && availableRoles.has('temperatura')) return 'temperatura';
    if (text.includes('presion') && availableRoles.has('presion')) return 'presion';
    if (
      (text.includes('senal') ||
        text.includes('signal') ||
        text.includes('rssi') ||
        text.includes('csq')) &&
      availableRoles.has('señal')
    )
      return 'señal';

    return 'generico';
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

  private valueForVariableKey(key: string): unknown {
    if (!key) return null;
    return (
      this.siteVariables().variables.find((variable) => variable.nombre_dato === key)?.valor_dato ??
      null
    );
  }

  private decodeFloat32FromRegisters(
    rawA: unknown,
    rawB: unknown,
    wordSwap: boolean,
  ): number | null {
    const high = this.toRegisterWord(rawA);
    const low = this.toRegisterWord(rawB);
    if (high === null || low === null) return null;
    const a = wordSwap ? low : high;
    const b = wordSwap ? high : low;
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint16(0, a);
    view.setUint16(2, b);
    const value = view.getFloat32(0);
    return Number.isFinite(value) ? value : null;
  }

  private toRegisterWord(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const int = Math.trunc(value);
      return ((int % 0x10000) + 0x10000) % 0x10000;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.replace(',', '.'));
      return Number.isFinite(parsed) ? this.toRegisterWord(parsed) : null;
    }
    return null;
  }

  private guessDataType(value: SiteVariable['valor_dato']): string {
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'FLOAT';
    return 'FLOAT';
  }

  private configNumberToString(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    return String(value);
  }

  private toNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatPreviewNumber(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 4,
    }).format(value);
  }

  private setSuccess(message: string): void {
    this.status.set({ type: 'success', message });
  }

  private setError(message: string): void {
    this.status.set({ type: 'error', message });
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error as { message?: string; error?: string } | string | undefined;
      if (typeof payload === 'string') return payload;
      return payload?.message || payload?.error || fallback;
    }
    return fallback;
  }
}
