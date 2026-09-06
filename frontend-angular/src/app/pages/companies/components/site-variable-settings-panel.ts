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
import { catchError, concatMap, forkJoin, from, map, of, toArray } from 'rxjs';
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
  VariableParameters,
} from '../../../services/administration.service';
import { getSiteTypeUi } from '../../../shared/site-type-ui';
import { SkeletonComponent } from '../../../components/ui/skeleton';

interface SettingsStatus {
  type: 'success' | 'error' | '';
  message: string;
}

/** Una celda del grid de bits: su índice, su estado en vivo y si está elegida. */
interface BitCell {
  index: number;
  estado: '0' | '1' | '–';
  selected: boolean;
  title: string;
}

/**
 * Una fila del cargador masivo. Solo guarda lo que el técnico escribe: si el
 * bit ya está mapeado se resuelve en vivo contra `siteVariables()`
 * (`bitBulkExistente`), para que al recargar tras un guardado parcial las
 * creadas queden bloqueadas solas y las que fallaron conserven su alias.
 */
interface BitBulkRow {
  bit: number;
  alias: string;
  invertido: boolean;
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
  /**
   * Umbral simétrico de cut-off en unidades de ingeniería (vacío = desactivado).
   * Lo que quede por debajo en valor absoluto se lee como 0.
   */
  cutOff: string;
  wordSwap: string;
  sandboxRaw: string;
  /** 'true' cuando el técnico configura la escala por rango en vez de factor/offset. */
  escalaPorRango: string;
  /** 'true' cuando el registro trae el valor en complemento a 2. */
  conSigno: string;
  /** Ancho del registro para el complemento a 2: '16' o '32'. */
  signoBits: string;
  rangoRawMin: string;
  rangoRawMax: string;
  rangoIngMin: string;
  rangoIngMax: string;
  /** Índice del bit a separar (0 = el menos significativo). */
  bitIndex: string;
  /** Ancho de la palabra que se separa en bits: '16' o '32'. */
  palabraBits: string;
  /** 'true' cuando la señal es activa en 0 (un térmico sano suele leer 1). */
  bitInvertido: string;
  etiquetaOn: string;
  etiquetaOff: string;
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
  cutOff: '',
  wordSwap: 'false',
  sandboxRaw: '',
  escalaPorRango: 'false',
  conSigno: 'false',
  signoBits: '16',
  // 4-20 mA llega del PLC como 4000-20000 en la mayoría de los equipos.
  rangoRawMin: '4000',
  rangoRawMax: '20000',
  rangoIngMin: '0',
  rangoIngMax: '',
  bitIndex: '0',
  palabraBits: '16',
  bitInvertido: 'false',
  etiquetaOn: '',
  etiquetaOff: '',
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
    id: 'bit',
    label: 'Señal digital (un bit de la palabra)',
    description:
      'Separa un bit de un registro donde cada bit es una señal 0/1: marcha, falla, límite de carrera. Se crea una variable por bit — todas comparten el mismo dato original y solo cambia el número de bit.',
    enabled: true,
  },
  {
    id: 'ieee754_32',
    label: 'Coma flotante (2 registros · IEEE754)',
    description:
      'Combina dos registros Modbus consecutivos en un decimal IEEE754 (FLOAT32). Si tu equipo invierte el orden de los bytes, cambia el "Orden de registros" a CDAB. Opcionalmente aplica factor y offset para calibrar el valor.',
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

/** Ayuda de las casillas que no son transformaciones, para el popover "?". */
const EXTRA_OPTION_HELP = [
  {
    title: 'Valor con signo (complemento a 2)',
    description:
      'Marcala cuando la variable pueda ser negativa (temperatura, presión de vacío, nivel bajo la referencia). Un registro Modbus no lleva signo, así que el PLC manda el negativo sumándole 65536: todo lo que pase de 32767 es en realidad negativo. Elegí 32 bits solo si el equipo entrega el valor de 32 bits en un único dato.',
    example: '65087 → -449 · 65535 → -1 · 32768 → -32768',
  },
  {
    title: 'Escalar por rango (señal analógica)',
    description:
      'Marcala cuando el PLC entrega la señal en unidades brutas en vez de unidades de ingeniería. Un 4-20 mA suele llegar como 4000-20000: escribí ese rango y el rango real del instrumento, y el factor se calcula solo. Fuera del rango se extrapola, así que un lazo cortado se ve como negativo en vez de como un cero legítimo.',
    example: '4000 → 0 bar · 20000 → 20 bar · 3200 → -1 bar',
  },
] as const;

/**
 * Ayuda de la transformación por bit, en el popover "?". Va aparte de
 * EXTRA_OPTION_HELP porque no es una casilla de ajuste sino un modo de trabajo
 * completo, y porque lo que más confunde en terreno no es la casilla sino cómo
 * se numeran los bits y en qué formato tiene que llegar la palabra.
 */
const BIT_HELP = [
  {
    title: '¿Qué es una señal digital?',
    description:
      'Hay registros donde el valor no es una medición sino un paquete de contactos: cada bit es una entrada independiente que vale 1 o 0 (bomba andando, térmico disparado, límite de carrera tocado). Se crea una variable por bit, con su propio nombre, y todas comparten el mismo dato original.',
    example: 'La palabra 0000000000000111 son tres señales activas: los bits 0, 1 y 2.',
  },
  {
    title: 'Cómo se numeran los bits',
    description:
      'El bit 0 es el de más a la derecha (el menos significativo) y el 15 el de más a la izquierda. Muchos manuales de PLC numeran las entradas del 1 al 16: en ese caso restale 1. Si tenés dudas, accioná la señal en terreno y mirá qué celda del cuadro cambia de 0 a 1.',
    example: 'Entrada 1 del manual → bit 0 · Entrada 16 → bit 15',
  },
  {
    title: 'La palabra tiene que llegar en decimal',
    description:
      'El equipo debe reportar el número, no la cadena de ceros y unos. Si el valor crudo solo tiene ceros y unos (1000, 10101) el equipo está mandando la palabra en binario y la plataforma la lee como un decimal enorme: eso se corrige en el equipo, no acá.',
    example: 'Bien: 7 · Mal: 111, que es 0000000000000111 leído como decimal.',
  },
  {
    title: 'Señal activa en 0',
    description:
      'Los contactos normalmente cerrados marcan 1 cuando todo está bien y 0 cuando hay falla. Marcá "Señal activa en 0" para darla vuelta y que la variable valga 1 justo cuando querés que se vea la falla.',
    example: 'Térmico sano = bit en 1 → invertida, la variable vale 0 (sin falla).',
  },
] as const;

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
              <span class="material-symbols-outlined text-[22px]" aria-hidden="true">settings</span>
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
              <span class="material-symbols-outlined text-[16px]" aria-hidden="true">memory</span>
              {{ displaySite().id_serial || 'Sin serial' }}
            </span>
            @if (showDgaReporteButton) {
              <button
                type="button"
                (click)="openDgaReporte.emit()"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-tint-25 bg-primary-tint-08 px-3 text-caption font-semibold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
                aria-label="Configurar reporte DGA"
              >
                <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                  >description</span
                >
                Configurar reporte DGA
              </button>
            }
            <button
              type="button"
              (click)="load()"
              [disabled]="loading()"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Recargar configuración"
            >
              <span
                class="material-symbols-outlined text-[18px]"
                [class.animate-spin]="loading()"
                aria-hidden="true"
                >refresh</span
              >
            </button>
          </div>
        </div>

        @if (status().message) {
          <div [class]="statusClass()">
            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{
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
                  <span
                    class="material-symbols-outlined mt-0.5 text-[22px] text-primary-container"
                    aria-hidden="true"
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

                <!-- flex-col + label grow: los labels envuelven a distinto número de
                     líneas según el ancho — sin esto los inputs quedan desalineados. -->
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="flex flex-col">
                    <label class="mb-1 grow text-caption font-bold text-slate-500"
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
                  <div class="flex flex-col">
                    <label class="mb-1 grow text-caption font-bold text-slate-500"
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
                  <span class="material-symbols-outlined text-[18px]" aria-hidden="true">save</span>
                  {{ busy() === 'pozo' ? 'Guardando' : 'Guardar configuración' }}
                </button>
              </section>
            }

            @if (bitBulkOpen()) {
              <section class="space-y-3 rounded-xl border border-primary-tint-25 bg-white p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-body-sm font-semibold text-slate-900">
                      Señales digitales de {{ bitBulkD1() }}
                    </p>
                    <p class="mt-1 text-caption font-semibold text-slate-500">
                      Escribí el alias de las entradas que uses. Las que dejes en blanco no se
                      crean, y las que ya están configuradas aparecen bloqueadas — para cambiarlas,
                      editalas una por una.
                    </p>
                  </div>
                  <button
                    type="button"
                    (click)="closeBitBulk()"
                    class="icon-button shrink-0"
                    aria-label="Cerrar el cargador"
                  >
                    <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                      >close</span
                    >
                  </button>
                </div>

                <ul class="divide-y divide-slate-100">
                  @for (row of bitBulkRows(); track row.bit) {
                    <li class="grid grid-cols-[2rem_1.75rem_minmax(0,1fr)] items-center gap-2 py-1">
                      <span class="text-caption font-bold tabular-nums text-slate-400">
                        {{ row.bit }}
                      </span>
                      <span [class]="bitBulkEstadoClass(row.bit)">{{
                        bitBulkEstado(row.bit)
                      }}</span>
                      @if (bitBulkExistente(row.bit); as existente) {
                        <span class="flex min-w-0 items-center gap-1.5">
                          <span
                            class="material-symbols-outlined text-[16px] text-slate-400"
                            aria-hidden="true"
                            >lock</span
                          >
                          <span class="min-w-0 truncate text-caption font-semibold text-slate-500">
                            {{ existente.alias }}
                          </span>
                        </span>
                      } @else {
                        <span class="flex min-w-0 items-center gap-2">
                          <input
                            [ngModel]="row.alias"
                            [ngModelOptions]="{ standalone: true }"
                            (ngModelChange)="updateBitBulkAlias(row.bit, $event)"
                            class="field-control bg-white py-1.5"
                            [attr.aria-label]="'Alias del bit ' + row.bit"
                            [placeholder]="'Entrada ' + row.bit"
                          />
                          <label
                            class="flex shrink-0 cursor-pointer items-center gap-1 text-caption-xs font-bold text-slate-500"
                            [title]="'Invertir el bit ' + row.bit + ' (señal activa en 0)'"
                          >
                            <input
                              type="checkbox"
                              [ngModel]="row.invertido"
                              [ngModelOptions]="{ standalone: true }"
                              (ngModelChange)="toggleBitBulkInvertido(row.bit, $event)"
                              class="h-3.5 w-3.5 accent-[var(--color-primary)]"
                            />
                            INV
                          </label>
                        </span>
                      }
                    </li>
                  }
                </ul>

                <p class="text-caption-xs text-slate-500">{{ bitBulkSummary() }}</p>

                <div class="grid gap-2 sm:grid-cols-2">
                  <button type="button" (click)="closeBitBulk()" class="secondary-button">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    (click)="saveBitBulk()"
                    [disabled]="busy() === 'bits-bulk' || !bitBulkPendientes()"
                    class="primary-button"
                  >
                    <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                      >label</span
                    >
                    {{ busy() === 'bits-bulk' ? 'Creando' : 'Crear señales' }}
                  </button>
                </div>
              </section>
            } @else {
              <form
                (submit)="saveVariableMap($event)"
                class="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div>
                  <p class="text-body-sm font-semibold text-slate-900">Variables del equipo</p>
                  <p class="mt-1 text-caption font-semibold text-slate-500">
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
                          class="absolute right-0 top-7 z-10 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-caption shadow-lg"
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

                          <p
                            class="mb-2 mt-3 border-t border-slate-100 pt-3 text-caption-xs font-bold uppercase tracking-[0.1em] text-slate-400"
                          >
                            Senales digitales (bits)
                          </p>
                          <dl class="space-y-2">
                            @for (ayuda of bitHelp; track ayuda.title) {
                              <div>
                                <dt class="font-semibold text-slate-700">{{ ayuda.title }}</dt>
                                <dd class="text-slate-500">{{ ayuda.description }}</dd>
                                <dd class="mt-0.5 font-mono text-caption-xs text-slate-400">
                                  {{ ayuda.example }}
                                </dd>
                              </div>
                            }
                          </dl>

                          <p
                            class="mb-2 mt-3 border-t border-slate-100 pt-3 text-caption-xs font-bold uppercase tracking-[0.1em] text-slate-400"
                          >
                            Casillas de ajuste
                          </p>
                          <dl class="space-y-2">
                            @for (extra of extraOptionHelp; track extra.title) {
                              <div>
                                <dt class="font-semibold text-slate-700">{{ extra.title }}</dt>
                                <dd class="text-slate-500">{{ extra.description }}</dd>
                                <dd class="mt-0.5 font-mono text-caption-xs text-slate-400">
                                  {{ extra.example }}
                                </dd>
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
                      <p class="mt-1 text-caption font-semibold text-slate-500">
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
                            <option [value]="variable.nombre_dato">
                              {{ variable.nombre_dato }}
                            </option>
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
                          <p class="mt-1 text-caption font-semibold text-slate-500">
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

                @if (isBitTransform()) {
                  <p class="text-caption font-semibold text-slate-500">
                    Uso en dashboard: genérico. Los roles (caudal, nivel, totalizador) son
                    magnitudes analógicas y un 0/1 metido ahí entraría a los contadores y a DGA como
                    si fuera una medición.
                  </p>
                } @else {
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
                      <p class="mt-1 text-caption font-semibold text-slate-500">
                        {{ selectedVariableRole()?.description }}
                      </p>
                    }
                  </div>
                }

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

                @if (isBitTransform()) {
                  <div
                    class="space-y-3 rounded-lg border border-primary-tint-15 bg-primary-tint-08 p-3"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="text-caption font-bold text-slate-700">Bit de la palabra</p>
                        <p class="text-caption font-semibold text-slate-500">
                          Elegí el bit que corresponde a esta señal. El bit 0 es el menos
                          significativo (abajo a la derecha); si el manual del PLC los numera desde
                          1, restale 1.
                        </p>
                      </div>
                      <select
                        name="settings-variable-word-bits"
                        [ngModel]="variableForm().palabraBits"
                        (ngModelChange)="updateWordBits($event)"
                        class="field-control w-28 shrink-0 bg-white"
                        aria-label="Ancho de la palabra"
                      >
                        <option value="16">16 bits</option>
                        <option value="32">32 bits</option>
                      </select>
                    </div>

                    <!-- 8 columnas = un byte por fila, con el más significativo arriba a la
                       izquierda: así se lee igual que el binario del manual. -->
                    <div class="grid grid-cols-8 gap-1">
                      @for (cell of bitCells(); track cell.index) {
                        <button
                          type="button"
                          (click)="selectBit(cell.index)"
                          [class]="bitCellClass(cell)"
                          [attr.aria-pressed]="cell.selected"
                          [attr.aria-label]="cell.title"
                          [title]="cell.title"
                        >
                          <span class="text-caption-xs font-bold tabular-nums opacity-70">{{
                            cell.index
                          }}</span>
                          <span class="font-mono text-body-sm font-bold leading-none">{{
                            cell.estado
                          }}</span>
                        </button>
                      }
                    </div>

                    <label class="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        name="settings-variable-bit-inverted"
                        [ngModel]="variableForm().bitInvertido === 'true'"
                        (ngModelChange)="toggleBitInvertido($event)"
                        class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span class="min-w-0">
                        <span class="block text-caption font-bold text-slate-700">
                          Señal activa en 0 (invertir)
                        </span>
                        <span class="block text-caption font-semibold text-slate-500">
                          Para los contactos normalmente cerrados: un térmico sano lee 1 y lo que
                          querés mostrar como falla es el 0.
                        </span>
                      </span>
                    </label>

                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="mb-1 block text-caption font-bold text-slate-500"
                          >Etiqueta en 1</label
                        >
                        <input
                          name="settings-variable-bit-label-on"
                          [ngModel]="variableForm().etiquetaOn"
                          (ngModelChange)="updateVariableForm('etiquetaOn', $event)"
                          class="field-control bg-white"
                          placeholder="Activo"
                        />
                      </div>
                      <div>
                        <label class="mb-1 block text-caption font-bold text-slate-500"
                          >Etiqueta en 0</label
                        >
                        <input
                          name="settings-variable-bit-label-off"
                          [ngModel]="variableForm().etiquetaOff"
                          (ngModelChange)="updateVariableForm('etiquetaOff', $event)"
                          class="field-control bg-white"
                          placeholder="Inactivo"
                        />
                      </div>
                    </div>

                    <p class="text-caption-xs text-slate-500">{{ bitSummary() }}</p>

                    <button
                      type="button"
                      (click)="openBitBulk()"
                      [disabled]="!variableForm().d1"
                      class="secondary-button flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                        >list_alt_add</span
                      >
                      Cargar las {{ bitWordWidth() }} de una
                    </button>

                    @if (bitMappingsForCurrentKey().length) {
                      <div class="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                        <p
                          class="mb-1 text-caption-xs font-bold uppercase tracking-[0.12em] text-slate-400"
                        >
                          Bits ya configurados en {{ variableForm().d1 }}
                        </p>
                        <ul class="divide-y divide-slate-100">
                          @for (item of bitMappingsForCurrentKey(); track item.mapping.id) {
                            <li class="flex items-center justify-between gap-2 py-1">
                              <span
                                class="min-w-0 truncate text-caption font-semibold text-slate-600"
                              >
                                <span class="font-mono font-bold text-slate-400">{{
                                  item.bit
                                }}</span>
                                · {{ item.mapping.alias }}
                              </span>
                              <span class="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  (click)="editBitMapping(item.mapping)"
                                  class="icon-button h-7 w-7"
                                  [attr.aria-label]="'Editar ' + item.mapping.alias"
                                >
                                  <span
                                    class="material-symbols-outlined text-[16px]"
                                    aria-hidden="true"
                                    >edit</span
                                  >
                                </button>
                                <button
                                  type="button"
                                  (click)="deleteVariableMap(item.mapping)"
                                  class="icon-button h-7 w-7 text-red-500"
                                  [attr.aria-label]="'Eliminar ' + item.mapping.alias"
                                >
                                  <span
                                    class="material-symbols-outlined text-[16px]"
                                    aria-hidden="true"
                                    >delete</span
                                  >
                                </button>
                              </span>
                            </li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                }

                @if (usesSignedOption()) {
                  <label
                    class="flex cursor-pointer items-start gap-2 rounded-lg border border-primary-tint-15 bg-primary-tint-08 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      name="settings-variable-signed-toggle"
                      [ngModel]="useSigned()"
                      (ngModelChange)="toggleSigned($event)"
                      class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span class="min-w-0">
                      <span class="block text-caption font-bold text-slate-700">
                        Valor con signo (complemento a 2)
                      </span>
                      <span class="block text-caption font-semibold text-slate-500">
                        Marcala cuando la variable pueda ser negativa. El registro no lleva signo,
                        así que el PLC manda -449 como 65087 y sin esto lo verías como 65087.
                      </span>
                    </span>
                  </label>
                }

                @if (useSigned()) {
                  <div class="space-y-2 rounded-lg border border-primary-tint-15 bg-white p-3">
                    @if (isLinearTransform()) {
                      <div>
                        <label class="mb-1 block text-caption font-bold text-slate-500"
                          >Ancho del registro</label
                        >
                        <select
                          name="settings-variable-signed-bits"
                          [ngModel]="variableForm().signoBits"
                          (ngModelChange)="updateVariableForm('signoBits', $event)"
                          class="field-control bg-white"
                        >
                          <option value="16">16 bits · un registro (0 a 65535)</option>
                          <option value="32">32 bits · valor de 32 bits en un solo dato</option>
                        </select>
                      </div>
                    }
                    <p class="text-caption-xs text-slate-500">{{ signedSummary() }}</p>
                  </div>
                }

                @if (usesScaleTransform()) {
                  <label
                    class="flex cursor-pointer items-start gap-2 rounded-lg border border-primary-tint-15 bg-primary-tint-08 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      name="settings-variable-range-toggle"
                      [ngModel]="useRangeScale()"
                      (ngModelChange)="toggleRangeScale($event)"
                      class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span class="min-w-0">
                      <span class="block text-caption font-bold text-slate-700">
                        Escalar por rango (señal analógica)
                      </span>
                      <span class="block text-caption font-semibold text-slate-500">
                        El PLC entrega la señal en unidades brutas: un 4-20 mA suele llegar como
                        4000-20000. Definí los dos rangos y el factor se calcula solo.
                      </span>
                    </span>
                  </label>
                }

                @if (useRangeScale()) {
                  <div class="space-y-3 rounded-lg border border-primary-tint-15 bg-white p-3">
                    <div>
                      <p
                        class="mb-1 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                      >
                        Señal bruta del equipo
                      </p>
                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="mb-1 block text-caption font-bold text-slate-500"
                            >Mínimo</label
                          >
                          <input
                            type="number"
                            step="any"
                            name="settings-variable-range-raw-min"
                            [ngModel]="variableForm().rangoRawMin"
                            (ngModelChange)="updateVariableForm('rangoRawMin', $event)"
                            class="field-control bg-white"
                            placeholder="4000"
                          />
                        </div>
                        <div>
                          <label class="mb-1 block text-caption font-bold text-slate-500"
                            >Máximo</label
                          >
                          <input
                            type="number"
                            step="any"
                            name="settings-variable-range-raw-max"
                            [ngModel]="variableForm().rangoRawMax"
                            (ngModelChange)="updateVariableForm('rangoRawMax', $event)"
                            class="field-control bg-white"
                            placeholder="20000"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <p
                        class="mb-1 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                      >
                        Unidades de ingeniería{{ rangeUnitSuffix() }}
                      </p>
                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="mb-1 block text-caption font-bold text-slate-500"
                            >Mínimo</label
                          >
                          <input
                            type="number"
                            step="any"
                            name="settings-variable-range-eng-min"
                            [ngModel]="variableForm().rangoIngMin"
                            (ngModelChange)="updateVariableForm('rangoIngMin', $event)"
                            class="field-control bg-white"
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <label class="mb-1 block text-caption font-bold text-slate-500"
                            >Máximo</label
                          >
                          <input
                            type="number"
                            step="any"
                            name="settings-variable-range-eng-max"
                            [ngModel]="variableForm().rangoIngMax"
                            (ngModelChange)="updateVariableForm('rangoIngMax', $event)"
                            class="field-control bg-white"
                            placeholder="20"
                          />
                        </div>
                      </div>
                    </div>

                    <p class="text-caption-xs text-slate-500">{{ rangeScaleSummary() }}</p>
                  </div>
                }

                @if (isLinearTransform() && !useRangeScale()) {
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
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Divisor</label
                      >
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
                  <p class="text-caption-xs text-slate-500">
                    Fórmula:
                    <span class="font-mono">resultado = raw × factor / divisor + offset</span>. Usá
                    divisor=100 para correr 2 decimales (ej. raw 1234 → 12.34).
                  </p>
                }

                @if (isUint32TransformSelected() && !useRangeScale()) {
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
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Divisor</label
                      >
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
                  <p class="text-caption-xs text-slate-500">
                    Fórmula:
                    <span class="font-mono"
                      >resultado = ((registro alto × 65536) + registro bajo) × factor / divisor +
                      offset</span
                    >. Usá divisor=100 para correr 2 decimales.
                  </p>
                }

                @if (isIeeeTransformSelected() && !useRangeScale()) {
                  <div class="grid grid-cols-3 gap-3">
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Factor multiplicador</label
                      >
                      <input
                        type="number"
                        step="any"
                        name="settings-variable-ieee-factor"
                        [ngModel]="variableForm().factor"
                        (ngModelChange)="updateVariableForm('factor', $event)"
                        class="field-control bg-white"
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Divisor</label
                      >
                      <input
                        type="number"
                        step="any"
                        min="0"
                        name="settings-variable-ieee-divisor"
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
                        name="settings-variable-ieee-offset"
                        [ngModel]="variableForm().offset"
                        (ngModelChange)="updateVariableForm('offset', $event)"
                        class="field-control bg-white"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <p class="text-caption-xs text-slate-500">
                    Fórmula:
                    <span class="font-mono"
                      >resultado = decimal IEEE754 × factor / divisor + offset</span
                    >. Dejá factor=1 y offset=0 para el valor sin ajuste; usá offset para calibrar
                    el sensor.
                  </p>
                }

                @if (supportsCutOff()) {
                  <div class="rounded-lg border border-border-default bg-bg-subtle p-3">
                    <label
                      class="mb-1 block text-caption font-bold text-slate-500"
                      for="settings-variable-cutoff"
                    >
                      Cut-off de caudal bajo
                      {{ variableForm().unidad ? '(' + variableForm().unidad + ')' : '' }}
                    </label>
                    <input
                      id="settings-variable-cutoff"
                      type="number"
                      step="any"
                      min="0"
                      name="settings-variable-cutoff"
                      [ngModel]="variableForm().cutOff"
                      (ngModelChange)="updateVariableForm('cutOff', $event)"
                      class="field-control bg-white"
                      placeholder="Vacio = sin corte"
                    />
                    <p class="mt-2 text-caption-xs text-slate-500">
                      Todo lo que quede por debajo de este umbral
                      <strong>en valor absoluto</strong> se lee como 0. Es el mismo corte que trae
                      el caudalimetro: un electromagnetico en reposo oscila alrededor de cero, y ni
                      los negativos son flujo inverso ni los positivos diminutos son extraccion. Se
                      aplica <strong>al leer</strong>, asi que el dato crudo del equipo no se toca y
                      vaciar el campo devuelve la serie original.
                    </p>
                    @if (cutOffPreviewNote()) {
                      <p class="mt-2 font-mono text-caption-xs text-primary-container">
                        {{ cutOffPreviewNote() }}
                      </p>
                    }
                  </div>
                }

                <div class="rounded-lg border border-primary-tint-15 bg-primary-tint-08 p-3">
                  <div class="mb-3 flex items-center gap-2">
                    <span
                      class="material-symbols-outlined text-[18px] text-primary-container"
                      aria-hidden="true"
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
                        <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                          >functions</span
                        >
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
                    <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                      >label</span
                    >
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
            }
          </div>

          <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"
            >
              <div>
                <h3 class="text-body-sm font-semibold text-slate-900">
                  Datos detectados del equipo
                </h3>
                <p class="text-caption font-semibold text-slate-500">
                  REG1, REG2 y similares se asignan manualmente por sitio.
                </p>
              </div>
              <p class="text-caption font-semibold text-slate-500">
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
                              <p class="text-caption text-slate-500">
                                {{ displayRole(variable.mapping.rol_dashboard) }} ·
                                @if (bitCountFor(variable.nombre_dato); as bits) {
                                  {{ bits }}
                                  {{ bits === 1 ? 'señal digital' : 'señales digitales' }}
                                } @else {
                                  {{ displayTransform(variable.mapping.transformacion) }}
                                  {{ variable.mapping.unidad || '' }}
                                }
                              </p>
                            </div>
                            <button
                              type="button"
                              (click)="
                                $event.stopPropagation(); deleteVariableMap(variable.mapping)
                              "
                              class="icon-button shrink-0 text-red-500 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 active:scale-95"
                              aria-label="Eliminar alias"
                            >
                              <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                                >delete</span
                              >
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
                        class="px-4 py-8 text-center text-body-sm font-semibold text-slate-500"
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

  /** Ayuda de las casillas de ajuste, renderizada en el popover "?". */
  readonly extraOptionHelp = EXTRA_OPTION_HELP;
  /** Ayuda de la transformación por bit, en el mismo popover. */
  readonly bitHelp = BIT_HELP;

  private api = inject(AdministrationService);

  inputSite = signal<SiteRecord | null>(null);
  loading = signal(false);
  busy = signal('');
  status = signal<SettingsStatus>({ type: '', message: '' });
  siteTypeCatalog = signal<SiteTypeCatalogResponse>(DEFAULT_SITE_TYPE_CATALOG);
  siteVariables = signal<SiteVariablesPayload>(emptyVariables());
  variableForm = signal<VariableForm>({ ...DEFAULT_VARIABLE_FORM });
  pozoConfigForm = signal<PozoConfigForm>({ ...DEFAULT_POZO_CONFIG_FORM });
  bitBulkOpen = signal(false);
  bitBulkRows = signal<BitBulkRow[]>([]);
  /** Dato original y ancho congelados al abrir: el formulario de al lado puede cambiar. */
  bitBulkD1 = signal('');
  bitBulkWidth = signal(16);

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

  /**
   * @param keepStatus lo pasan los handlers de guardado/borrado, que ya dejaron
   * su mensaje puesto. Sin esto la recarga posterior lo borraba en el mismo tick
   * y el técnico nunca veía la confirmación.
   */
  load(keepStatus = false): void {
    if (!this.siteId) return;

    this.loading.set(true);
    if (!keepStatus) this.status.set({ type: '', message: '' });

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
      escalaPorRango: this.usesScaleTransformValue(normalized) ? current.escalaPorRango : 'false',
      conSigno: this.usesSignedOptionValue(normalized) ? current.conSigno : 'false',
      // Un bit es 1/0 y no tiene unidad de ingeniería. Al salir del modo solo
      // se revierte el tipo si sigue en BOOLEAN, para no pisar una elección
      // deliberada del técnico.
      tipo_dato:
        normalized === 'bit'
          ? 'BOOLEAN'
          : current.tipo_dato === 'BOOLEAN' && current.transformacion === 'bit'
            ? 'FLOAT'
            : current.tipo_dato,
      unidad: normalized === 'bit' ? '' : current.unidad,
      // El rol se infiere del alias al elegir d1 ("Nivel alto estanque" → nivel).
      // Para un bit eso metería un 0/1 en el slot de una magnitud analógica.
      rol_dashboard: normalized === 'bit' ? 'generico' : current.rol_dashboard,
    }));
  }

  // ─── Señal digital (un bit de la palabra) ─────────────────────────────

  isBitTransform(): boolean {
    return this.variableForm().transformacion === 'bit';
  }

  /** Ancho declarado de la palabra: 16 o 32. */
  bitWordWidth(): number {
    return this.toNumber(this.variableForm().palabraBits) === 32 ? 32 : 16;
  }

  selectBit(index: number): void {
    this.updateVariableForm('bitIndex', String(index));
  }

  toggleBitInvertido(enabled: boolean): void {
    this.updateVariableForm('bitInvertido', enabled ? 'true' : 'false');
  }

  /** Al angostar la palabra, un bit que ya no existe se recorta al último válido. */
  updateWordBits(value: string): void {
    const width = this.toNumber(value) === 32 ? 32 : 16;
    this.variableForm.update((current) => {
      const bit = this.toNumber(current.bitIndex) ?? 0;
      return {
        ...current,
        palabraBits: String(width),
        bitIndex: String(Math.min(Math.max(bit, 0), width - 1)),
      };
    });
  }

  /**
   * Celdas del grid, del bit más significativo al menos significativo, para que
   * el grid de 8 columnas se lea como el binario del manual (byte alto arriba).
   */
  bitCells(): BitCell[] {
    const width = this.bitWordWidth();
    const word = this.liveWord();
    const elegido = this.toNumber(this.variableForm().bitIndex);
    const cells: BitCell[] = [];

    for (let index = width - 1; index >= 0; index -= 1) {
      const encendido = word === null ? null : Math.floor(word / 2 ** index) % 2 === 1;
      cells.push({
        index,
        estado: encendido === null ? '–' : encendido ? '1' : '0',
        selected: index === elegido,
        title:
          encendido === null
            ? `Bit ${index}, sin lectura`
            : `Bit ${index}, ahora en ${encendido ? '1' : '0'}`,
      });
    }

    return cells;
  }

  bitCellClass(cell: BitCell): string {
    const base =
      'flex flex-col items-center gap-0.5 rounded-md border py-1 transition active:scale-95';
    if (cell.selected) {
      return `${base} border-primary bg-primary text-white`;
    }
    if (cell.estado === '1') {
      return `${base} border-primary-tint-35 bg-primary-tint-14 text-primary-container hover:border-primary-tint-50`;
    }
    return `${base} border-slate-200 bg-white text-slate-500 hover:border-primary-tint-30 hover:bg-primary-tint-06`;
  }

  bitOnLabel(): string {
    return this.variableForm().etiquetaOn.trim() || 'Activo';
  }

  bitOffLabel(): string {
    return this.variableForm().etiquetaOff.trim() || 'Inactivo';
  }

  bitSummary(): string {
    const form = this.variableForm();
    const width = this.bitWordWidth();
    const bit = this.toNumber(form.bitIndex);

    if (bit === null || !Number.isInteger(bit) || bit < 0 || bit >= width) {
      return `Elegí un bit entre 0 y ${width - 1}.`;
    }

    const invertido =
      form.bitInvertido === 'true' ? ' Invertida: se muestra activa cuando el bit está en 0.' : '';

    const word = this.liveWord();
    if (word === null) {
      const crudo = this.liveRawValueForPreview();
      if (!crudo) return `Bit ${bit} de ${form.d1 || 'la palabra'}.${invertido}`;
      return `${crudo} no es una palabra sin signo de ${width} bits. Revisá el ancho.`;
    }

    return `Ahora mismo ${word} = ${this.formatBinary(word, width)}.${invertido}`;
  }

  /** Los bits ya mapeados sobre el dato original que está en el formulario. */
  bitMappingsForCurrentKey(): { mapping: VariableMapping; bit: number }[] {
    return this.bitMappingsFor(this.variableForm().d1);
  }

  /** Cuántas señales digitales cuelgan de este dato original (0 si no es palabra de bits). */
  bitCountFor(d1: string): number {
    return this.bitMappingsFor(d1).length;
  }

  /** Carga un bit ya guardado en el formulario para editarlo. */
  editBitMapping(mapping: VariableMapping): void {
    this.prepareVariableMap({
      nombre_dato: mapping.d1,
      valor_dato: (this.valueForVariableKey(mapping.d1) ?? null) as SiteVariable['valor_dato'],
      timestamp_completo: '',
      mapping,
    });
  }

  // ─── Cargador masivo (una tarjeta de entradas digitales completa) ──────

  openBitBulk(): void {
    const d1 = this.variableForm().d1;
    if (!d1) {
      this.setError('Elegí primero el dato original.');
      return;
    }

    const width = this.bitWordWidth();
    const existentes = new Map(this.bitMappingsFor(d1).map((item) => [item.bit, item.mapping]));

    this.bitBulkD1.set(d1);
    this.bitBulkWidth.set(width);
    this.bitBulkRows.set(
      Array.from({ length: width }, (_, bit) => ({
        bit,
        alias: existentes.get(bit)?.alias ?? '',
        invertido: existentes.get(bit)?.parametros?.invertido === true,
      })),
    );
    this.status.set({ type: '', message: '' });
    this.bitBulkOpen.set(true);
  }

  closeBitBulk(): void {
    this.bitBulkOpen.set(false);
    this.bitBulkRows.set([]);
  }

  /**
   * El mapeo que ya ocupa este bit, resuelto en vivo contra `siteVariables()`.
   * Se recalcula solo tras un `load()`, así un guardado parcial deja bloqueadas
   * las creadas sin perder lo escrito en las que fallaron.
   */
  bitBulkExistente(bit: number): VariableMapping | null {
    return this.bitMappingsFor(this.bitBulkD1()).find((item) => item.bit === bit)?.mapping ?? null;
  }

  bitBulkEstado(bit: number): '0' | '1' | '–' {
    const word = this.wordFor(this.bitBulkD1(), this.bitBulkWidth());
    if (word === null) return '–';
    return Math.floor(word / 2 ** bit) % 2 === 1 ? '1' : '0';
  }

  bitBulkEstadoClass(bit: number): string {
    const base = 'text-center font-mono text-caption font-bold';
    return this.bitBulkEstado(bit) === '1'
      ? `${base} text-primary-container`
      : `${base} text-slate-300`;
  }

  updateBitBulkAlias(bit: number, alias: string): void {
    this.bitBulkRows.update((rows) =>
      rows.map((row) => (row.bit === bit ? { ...row, alias } : row)),
    );
  }

  toggleBitBulkInvertido(bit: number, invertido: boolean): void {
    this.bitBulkRows.update((rows) =>
      rows.map((row) => (row.bit === bit ? { ...row, invertido } : row)),
    );
  }

  /** Las filas que se van a crear: con alias y sin mapeo previo. */
  bitBulkPendientes(): number {
    return this.bitBulkNuevas().length;
  }

  bitBulkSummary(): string {
    const nuevas = this.bitBulkPendientes();
    const ocupados = this.bitBulkRows().filter((row) => this.bitBulkExistente(row.bit)).length;
    const yaEstan = ocupados ? ` ${ocupados} ya estaban configuradas.` : '';
    if (!nuevas) return `No hay señales nuevas para crear.${yaEstan}`;
    return `Se van a crear ${nuevas} ${nuevas === 1 ? 'señal' : 'señales'} sobre ${this.bitBulkD1()}.${yaEstan}`;
  }

  saveBitBulk(): void {
    if (!this.siteId) return;

    const nuevas = this.bitBulkNuevas();
    if (!nuevas.length) {
      this.setError('Escribí el alias de al menos una entrada.');
      return;
    }

    const d1 = this.bitBulkD1();
    const width = this.bitBulkWidth();

    // Secuencial y no en paralelo: 16 POST simultáneos compiten por el mismo
    // candado de d1 en el backend, y así cada fallo se puede atribuir a su bit.
    this.busy.set('bits-bulk');
    from(nuevas)
      .pipe(
        concatMap((row) =>
          this.api
            .createSiteVariableMap(this.siteId, {
              alias: row.alias.trim(),
              d1,
              d2: null,
              tipo_dato: 'BOOLEAN',
              unidad: null,
              rol_dashboard: 'generico',
              transformacion: 'bit',
              parametros: {
                bit: row.bit,
                palabra_bits: width,
                ...(row.invertido ? { invertido: true } : {}),
              },
            })
            .pipe(
              map(() => ({ bit: row.bit, error: '' })),
              catchError((err: unknown) =>
                of({ bit: row.bit, error: this.errorMessage(err, 'no se pudo crear') }),
              ),
            ),
        ),
        toArray(),
      )
      .subscribe((resultados) => {
        this.busy.set('');
        const fallidas = resultados.filter((resultado) => resultado.error);
        const creadas = resultados.length - fallidas.length;

        if (fallidas.length) {
          // El cargador queda abierto: tras el load() las creadas se bloquean
          // solas y las que fallaron conservan el alias para corregirlo.
          this.setError(
            `${creadas} de ${resultados.length} señales creadas. Falló el bit ` +
              `${fallidas.map((resultado) => resultado.bit).join(', ')}: ${fallidas[0]?.error}`,
          );
        } else {
          this.setSuccess(`${creadas} ${creadas === 1 ? 'señal creada' : 'señales creadas'}.`);
          this.closeBitBulk();
        }

        this.load(true);
        this.variableMapChanged.emit();
      });
  }

  /**
   * Transforms sobre un entero crudo, donde el complemento a 2 tiene sentido.
   * ieee754_32 queda fuera: el float ya trae el signo en su propio formato.
   */
  usesSignedOption(): boolean {
    return this.usesSignedOptionValue(this.variableForm().transformacion);
  }

  useSigned(): boolean {
    return this.variableForm().conSigno === 'true' && this.usesSignedOption();
  }

  toggleSigned(enabled: boolean): void {
    this.variableForm.update((current) => ({ ...current, conSigno: enabled ? 'true' : 'false' }));
  }

  /** 32 para el par combinado (el uint32 es de 32 bits por construcción); si no, lo elegido. */
  signedBits(): number {
    if (this.variableForm().transformacion === 'uint32_registros') return 32;
    return this.toNumber(this.variableForm().signoBits) === 32 ? 32 : 16;
  }

  signedSummary(): string {
    const bits = this.signedBits();
    const limite = 2 ** (bits - 1);
    const corte = `Todo lo que pase de ${this.formatPreviewNumber(limite - 1)} se lee como negativo (se le resta ${this.formatPreviewNumber(2 ** bits)}).`;
    if (this.variableForm().transformacion === 'uint32_registros') {
      return `El par de registros combinado son 32 bits. ${corte}`;
    }
    const crudo = this.signedSourceValue();
    if (crudo === null) return corte;
    const convertido = this.applySignedWrap(crudo, bits);
    if (convertido === null) {
      return `El crudo en vivo (${this.formatPreviewNumber(crudo)}) no cabe en ${bits} bits. Revisá el ancho del registro.`;
    }
    return `${corte} Ahora mismo: ${this.formatPreviewNumber(crudo)} → ${this.formatPreviewNumber(convertido)}.`;
  }

  /** Transforms que aplican factor/offset y por lo tanto admiten escala por rango. */
  usesScaleTransform(): boolean {
    return this.usesScaleTransformValue(this.variableForm().transformacion);
  }

  useRangeScale(): boolean {
    return this.variableForm().escalaPorRango === 'true' && this.usesScaleTransform();
  }

  toggleRangeScale(enabled: boolean): void {
    this.variableForm.update((current) => ({
      ...current,
      escalaPorRango: enabled ? 'true' : 'false',
      // Al volver a factor/offset se muestran los derivados del rango, para que
      // el técnico vea de dónde salieron y pueda ajustarlos a mano.
      ...(enabled
        ? {}
        : (() => {
            const scale = this.rangeScaleParams();
            if (!scale) return {};
            return {
              factor: this.formatScaleNumber(scale.factor),
              divisor: '1',
              offset: this.formatScaleNumber(scale.offset),
            };
          })()),
    }));
  }

  rangeUnitSuffix(): string {
    const unidad = this.variableForm().unidad.trim();
    return unidad ? ` (${unidad})` : '';
  }

  rangeScaleSummary(): string {
    const form = this.variableForm();
    const scale = this.rangeScaleParams();
    if (!scale) {
      return this.toNumber(form.rangoRawMin) === this.toNumber(form.rangoRawMax)
        ? 'El mínimo y el máximo brutos no pueden ser iguales.'
        : 'Completá los cuatro valores para calcular la escala.';
    }
    const unidad = form.unidad.trim() ? ` ${form.unidad.trim()}` : '';
    return (
      `${form.rangoRawMin} → ${form.rangoIngMin}${unidad} · ` +
      `${form.rangoRawMax} → ${form.rangoIngMax}${unidad}. ` +
      `Equivale a factor ${this.formatScaleNumber(scale.factor)} y offset ` +
      `${this.formatScaleNumber(scale.offset)}. Los valores fuera del rango se extrapolan.`
    );
  }

  saveVariableMap(event: Event): void {
    event.preventDefault();
    if (!this.siteId) return;

    if (this.useRangeScale() && !this.rangeScaleParams()) {
      this.setError(this.rangeScaleSummary());
      return;
    }

    if (this.isBitTransform() && this.selectedBitIndex() === null) {
      this.setError(`Elegí un bit entre 0 y ${this.bitWordWidth() - 1}.`);
      return;
    }

    const form = this.variableForm();
    const payload: CreateVariableMapPayload = {
      alias: form.alias.trim(),
      d1: form.d1,
      d2: form.d2 || null,
      tipo_dato: form.tipo_dato,
      unidad: form.unidad || null,
      rol_dashboard: this.isBitTransform() ? 'generico' : this.normalizeRole(form.rol_dashboard),
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
        this.load(true);
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
      // A diferencia del divisor, el cut-off SÍ se persiste tal cual, así que
      // vuelve del backend y se muestra con el valor real que está aplicando.
      cutOff: this.configNumberToString(params?.cut_off) || '',
      wordSwap: String(params?.word_swap ?? params?.wordSwap ?? false),
      // sandboxRaw is no longer an editable input; calculator reads from d1 live value.
      sandboxRaw: '',
      // El rango es lo que el técnico escribió; factor/offset son su derivada.
      // Sin estas cuatro llaves solo veríamos un factor 0.00125 sin contexto.
      escalaPorRango: params?.modo_escala === 'rango' ? 'true' : 'false',
      rangoRawMin: this.configNumberToString(params?.raw_min) || DEFAULT_VARIABLE_FORM.rangoRawMin,
      rangoRawMax: this.configNumberToString(params?.raw_max) || DEFAULT_VARIABLE_FORM.rangoRawMax,
      rangoIngMin: this.configNumberToString(params?.ing_min) || DEFAULT_VARIABLE_FORM.rangoIngMin,
      rangoIngMax: this.configNumberToString(params?.ing_max),
      conSigno: params?.con_signo === true ? 'true' : 'false',
      signoBits: this.toNumber(this.configNumberToString(params?.signo_bits)) === 32 ? '32' : '16',
      bitIndex: this.configNumberToString(params?.bit) || '0',
      palabraBits:
        this.toNumber(this.configNumberToString(params?.palabra_bits)) === 32 ? '32' : '16',
      bitInvertido: params?.invertido === true ? 'true' : 'false',
      etiquetaOn: params?.etiqueta_on || '',
      etiquetaOff: params?.etiqueta_off || '',
    });
  }

  deleteVariableMap(mapping: VariableMapping): void {
    if (!this.siteId) return;

    this.busy.set('delete-variable');
    this.api.deleteSiteVariableMap(this.siteId, mapping.id).subscribe({
      next: (res) => {
        this.busy.set('');
        this.setSuccess(res.message || 'Variable eliminada.');
        this.load(true);
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

  isIeeeTransformSelected(): boolean {
    return this.variableForm().transformacion === 'ieee754_32';
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
      'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-caption font-semibold uppercase tracking-[0.1em] transition active:scale-95';
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

  /**
   * Valor transformado de ahora, ANTES del cut-off, o null si no se puede
   * calcular. Solo cubre los caminos numéricos: `bit` devuelve etiquetas y
   * `directo` devuelve el crudo sin tocar, y a ninguno de los dos se le aplica
   * corte. Sirve para el antes/después de `cutOffPreviewNote`.
   */
  private previewNumericValue(): number | null {
    const form = this.variableForm();
    if (form.transformacion === 'bit') return null;
    const { factor, offset } = this.effectiveScale();

    if (this.isLinearTransformValue(form.transformacion)) {
      const raw = this.signedOrRaw(this.toNumber(this.liveRawValueForPreview()));
      return raw === null ? null : raw * factor + offset;
    }

    if (form.transformacion === 'ieee754_32') {
      const decoded = this.decodeFloat32FromRegisters(
        this.valueForVariableKey(form.d1),
        this.valueForVariableKey(form.d2),
        form.wordSwap === 'true',
      );
      return decoded === null ? null : decoded * factor + offset;
    }

    if (form.transformacion === 'uint32_registros') {
      const rawA = this.toRegisterWord(this.valueForVariableKey(form.d1));
      const rawB = this.toRegisterWord(this.valueForVariableKey(form.d2));
      if (rawA === null || rawB === null) return null;
      const high = form.wordSwap === 'true' ? rawB : rawA;
      const low = form.wordSwap === 'true' ? rawA : rawB;
      const combinado = this.signedOrRaw(high * 65536 + low);
      return combinado === null ? null : combinado * factor + offset;
    }

    return null;
  }

  previewResultText(): string {
    const form = this.variableForm();
    const rawText = this.liveRawValueForPreview();
    const unit = form.unidad ? ` ${form.unidad}` : '';

    if (!rawText && !this.requiresSecondRegister()) {
      return form.d1 ? 'Sin lectura reciente del equipo' : 'Selecciona registro d1';
    }

    if (form.transformacion === 'bit') {
      const estado = this.bitStateNow();
      // Sin estado el resumen ya explica por qué (bit fuera de rango, palabra
      // que no cabe en el ancho, o sin lectura todavía).
      if (estado === null) return this.bitSummary();
      return `${estado ? this.bitOnLabel() : this.bitOffLabel()} · ${estado ? 1 : 0}`;
    }

    const { factor, offset } = this.effectiveScale();

    if (this.isLinearTransformValue(form.transformacion)) {
      const raw = this.signedOrRaw(this.toNumber(rawText));
      if (raw === null) return this.rawPreviewError(this.toNumber(rawText));
      return `${this.formatPreviewNumber(this.applyPreviewCutOff(raw * factor + offset))}${unit}`;
    }

    if (form.transformacion === 'ieee754_32') {
      const rawA = this.valueForVariableKey(form.d1);
      const rawB = this.valueForVariableKey(form.d2);
      const decoded = this.decodeFloat32FromRegisters(rawA, rawB, form.wordSwap === 'true');
      if (decoded === null) {
        return form.d2 ? 'Registros no numéricos' : 'Selecciona segundo registro';
      }
      return `${this.formatPreviewNumber(this.applyPreviewCutOff(decoded * factor + offset))}${unit}`;
    }

    if (form.transformacion === 'uint32_registros') {
      const rawA = this.toRegisterWord(this.valueForVariableKey(form.d1));
      const rawB = this.toRegisterWord(this.valueForVariableKey(form.d2));
      if (rawA === null || rawB === null) {
        return form.d2 ? 'Registros no numéricos' : 'Selecciona segundo registro';
      }
      const high = form.wordSwap === 'true' ? rawB : rawA;
      const low = form.wordSwap === 'true' ? rawA : rawB;
      const combinado = this.signedOrRaw(high * 65536 + low);
      if (combinado === null) return this.rawPreviewError(high * 65536 + low);
      return `${this.formatPreviewNumber(this.applyPreviewCutOff(combinado * factor + offset))}${unit}`;
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

    if (form.transformacion === 'bit') {
      // Las etiquetas son opcionales: si no se escriben, el valor sigue siendo
      // 1/0 y quien lo muestre elige cómo nombrarlo.
      const params: VariableParameters = {
        bit: this.selectedBitIndex() ?? 0,
        palabra_bits: this.bitWordWidth(),
      };
      if (form.bitInvertido === 'true') params.invertido = true;
      if (form.etiquetaOn.trim()) params.etiqueta_on = form.etiquetaOn.trim();
      if (form.etiquetaOff.trim()) params.etiqueta_off = form.etiquetaOff.trim();
      return params;
    }

    if (this.transformRequiresD2(form.transformacion)) {
      return {
        word_swap: form.wordSwap === 'true',
        formato: form.transformacion === 'ieee754_32' ? 'float32' : 'uint32',
        ...this.cutOffParameters(),
        // uint32_registros e ieee754_32 aplican factor/offset sobre el valor
        // combinado/decodificado. Mismo split UI factor/divisor que lineal: el
        // backend solo conoce factor, divisor es ayuda de UI para decimales.
        ...this.signedParameters(),
        ...(this.usesScaleTransformValue(form.transformacion)
          ? (this.rangeScaleParameters() ?? {
              factor: (this.toNumber(form.factor) ?? 1) / this.safeDivisor(form.divisor),
              offset: this.toNumber(form.offset) ?? 0,
            })
          : {}),
      };
    }

    if (this.isLinearTransformValue(form.transformacion)) {
      const signo = { ...this.signedParameters(), ...this.cutOffParameters() };
      const rango = this.rangeScaleParameters();
      if (rango) return { ...signo, ...rango };
      // Persisted factor = factor_ui / divisor_ui. The BD doesn't know about
      // "divisor" — the UI split only makes it easier to type decimals
      // (ex. divisor=100 instead of factor=0.01).
      const factor = this.toNumber(form.factor) ?? 1;
      return {
        ...signo,
        factor: factor / this.safeDivisor(form.divisor),
        offset: this.toNumber(form.offset) ?? 0,
      };
    }

    return {};
  }

  /**
   * El cut-off solo tiene sentido en las transformaciones que devuelven un
   * número en unidades de ingeniería. `bit` devuelve etiquetas y `directo`
   * devuelve el crudo del equipo: recortarlos sería mentir sobre la lectura.
   */
  supportsCutOff(): boolean {
    const t = this.variableForm().transformacion;
    return this.isLinearTransformValue(t) || this.transformRequiresD2(t) || t === 'caudal_m3h_lps';
  }

  /** Umbral de cut-off tipeado, o null si está vacío o no es un número > 0. */
  cutOffValue(): number | null {
    const n = this.toNumber(this.variableForm().cutOff);
    return n !== null && Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * `parametros` del cut-off. Igual que el complemento a 2, se omite entero
   * cuando está vacío: un `cut_off: 0` guardado sería indistinguible de "sin
   * corte" para el backend, pero ensuciaría los mappings que ya existen.
   */
  private cutOffParameters(): VariableParameters {
    const cutOff = this.cutOffValue();
    return cutOff === null ? {} : { cut_off: cutOff };
  }

  /**
   * Mismo corte simétrico que `applyCutOff` en el backend
   * (`main-api/src/utils/mappingTransform.js`). Está duplicado a propósito:
   * la vista previa tiene que poder calcular sin ir al servidor. Si cambia la
   * regla allá, cambia acá.
   */
  private applyPreviewCutOff(value: number): number {
    const cutOff = this.cutOffValue();
    if (cutOff === null) return value;
    return Math.abs(value) < cutOff ? 0 : value;
  }

  /**
   * Texto del antes/después, solo cuando el corte efectivamente cambia el
   * valor de ahora. Sin esto el técnico no tiene forma de ver qué hace el
   * umbral que acaba de escribir.
   */
  cutOffPreviewNote(): string {
    const cutOff = this.cutOffValue();
    if (cutOff === null) return '';
    const crudo = this.previewNumericValue();
    if (crudo === null) return '';
    if (Math.abs(crudo) >= cutOff) return '';
    const unit = this.variableForm().unidad ? ` ${this.variableForm().unidad}` : '';
    return `Ahora mismo: ${this.formatPreviewNumber(crudo)}${unit} → 0${unit} (|valor| < ${this.formatPreviewNumber(cutOff)}).`;
  }

  /**
   * `parametros` del complemento a 2. Se omite entero cuando la casilla está
   * apagada para no ensuciar los mappings que ya existen.
   */
  private signedParameters(): VariableParameters {
    if (!this.useSigned()) return {};
    return { con_signo: true, signo_bits: this.signedBits() };
  }

  /** El bit elegido, o null si no es un índice válido para el ancho actual. */
  private selectedBitIndex(): number | null {
    const bit = this.toNumber(this.variableForm().bitIndex);
    if (bit === null || !Number.isInteger(bit) || bit < 0 || bit >= this.bitWordWidth()) {
      return null;
    }
    return bit;
  }

  /**
   * La palabra cruda en vivo de un dato original. Devuelve null cuando no hay
   * lectura o cuando el crudo no es una palabra sin signo del ancho declarado —
   * mismo criterio que `applyBitExtraction` en
   * main-api/src/utils/mappingTransform.js, que ahí lanza en vez de entregar
   * bits inventados.
   */
  private wordFor(d1: string, width: number): number | null {
    const value = this.valueForVariableKey(d1);
    const raw =
      typeof value === 'number' || typeof value === 'string' ? this.toNumber(value) : null;
    if (raw === null || !Number.isInteger(raw) || raw < 0 || raw >= 2 ** width) return null;
    return raw;
  }

  private liveWord(): number | null {
    return this.wordFor(this.variableForm().d1, this.bitWordWidth());
  }

  /** Filas con alias escrito y sin mapeo previo: las únicas que se crean. */
  private bitBulkNuevas(): BitBulkRow[] {
    return this.bitBulkRows().filter(
      (row) => !this.bitBulkExistente(row.bit) && row.alias.trim().length > 0,
    );
  }

  /** Estado del bit elegido, ya invertido si corresponde. */
  private bitStateNow(): boolean | null {
    const word = this.liveWord();
    const bit = this.selectedBitIndex();
    if (word === null || bit === null) return null;
    const encendido = Math.floor(word / 2 ** bit) % 2 === 1;
    return this.variableForm().bitInvertido === 'true' ? !encendido : encendido;
  }

  /** La palabra en binario, agrupada de a cuatro: 0001 0000 1010 1011. */
  private formatBinary(word: number, width: number): string {
    return (
      word
        .toString(2)
        .padStart(width, '0')
        .match(/.{1,4}/g)
        ?.join(' ') ?? ''
    );
  }

  private bitMappingsFor(d1: string): { mapping: VariableMapping; bit: number }[] {
    if (!d1) return [];
    return this.siteVariables()
      .mappings.filter((mapping) => mapping.d1 === d1 && mapping.transformacion === 'bit')
      .map((mapping) => ({
        mapping,
        bit: this.toNumber(this.configNumberToString(mapping.parametros?.bit)) ?? -1,
      }))
      .sort((a, b) => a.bit - b.bit);
  }

  /** El crudo que alimenta el resumen del signo: d1 en vivo. */
  private signedSourceValue(): number | null {
    const value = this.valueForVariableKey(this.variableForm().d1);
    return typeof value === 'number' || typeof value === 'string' ? this.toNumber(value) : null;
  }

  /**
   * Espejo de `applySignedWrap` de main-api/src/utils/mappingTransform.js.
   * Devuelve null si el valor no cabe en el ancho elegido: ahí el ancho está
   * mal y mostrar un número plausible sería peor que mostrar el error.
   */
  private applySignedWrap(value: number, bits: number): number | null {
    const modulo = 2 ** bits;
    if (value < 0 || value >= modulo) return null;
    return value >= modulo / 2 ? value - modulo : value;
  }

  /** Aplica el complemento a 2 si la casilla está activa; si no, pasa el crudo. */
  private signedOrRaw(value: number | null): number | null {
    if (value === null) return null;
    if (!this.useSigned()) return value;
    return this.applySignedWrap(value, this.signedBits());
  }

  private rawPreviewError(raw: number | null): string {
    if (raw === null) return 'Valor crudo no numérico';
    return `${this.formatPreviewNumber(raw)} no cabe en ${this.signedBits()} bits`;
  }

  /**
   * Convierte el rango bruto → rango de ingeniería en la recta que ya entiende
   * el backend. Devuelve null si falta algún valor o si el rango bruto es
   * degenerado (mín = máx), porque ahí la pendiente sería infinita.
   */
  private rangeScaleParams(): { factor: number; offset: number } | null {
    const form = this.variableForm();
    const rawMin = this.toNumber(form.rangoRawMin);
    const rawMax = this.toNumber(form.rangoRawMax);
    const ingMin = this.toNumber(form.rangoIngMin);
    const ingMax = this.toNumber(form.rangoIngMax);
    if (rawMin === null || rawMax === null || ingMin === null || ingMax === null) return null;
    const span = rawMax - rawMin;
    if (span === 0) return null;
    const factor = (ingMax - ingMin) / span;
    return { factor, offset: ingMin - rawMin * factor };
  }

  /**
   * `parametros` cuando el rango está activo: guarda los cuatro extremos que
   * escribió el técnico Y el factor/offset derivado. El backend solo lee
   * factor/offset (mappingTransform.js), así que el pipeline no cambia.
   */
  private rangeScaleParameters(): VariableParameters | null {
    if (!this.useRangeScale()) return null;
    const scale = this.rangeScaleParams();
    if (!scale) return null;
    const form = this.variableForm();
    return {
      modo_escala: 'rango',
      raw_min: this.toNumber(form.rangoRawMin),
      raw_max: this.toNumber(form.rangoRawMax),
      ing_min: this.toNumber(form.rangoIngMin),
      ing_max: this.toNumber(form.rangoIngMax),
      factor: scale.factor,
      offset: scale.offset,
    };
  }

  /** Escala que se aplica realmente: la del rango si está activo, si no factor/divisor/offset. */
  private effectiveScale(): { factor: number; offset: number } {
    const rango = this.useRangeScale() ? this.rangeScaleParams() : null;
    if (rango) return rango;
    const form = this.variableForm();
    return {
      factor: (this.toNumber(form.factor) ?? 1) / this.safeDivisor(form.divisor),
      offset: this.toNumber(form.offset) ?? 0,
    };
  }

  /** Como formatPreviewNumber pero sin agrupar y con precisión para factores chicos. */
  private formatScaleNumber(value: number): string {
    return String(Number(value.toPrecision(12)));
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

  /** Transforms sobre un entero crudo, donde el complemento a 2 aplica. */
  private usesSignedOptionValue(transformId: string): boolean {
    return this.isLinearTransformValue(transformId) || transformId === 'uint32_registros';
  }

  /** Transforms que aceptan factor/divisor/offset: lineal, uint32_registros e ieee754_32. */
  private usesScaleTransformValue(transformId: string): boolean {
    return (
      this.isLinearTransformValue(transformId) ||
      transformId === 'uint32_registros' ||
      transformId === 'ieee754_32'
    );
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
