import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  AdministrationService,
  CreateVariableMapPayload,
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
  offset: string;
  wordSwap: string;
  sandboxRaw: string;
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

const COMMON_TRANSFORMS: SiteTypeTransformOption[] = [
  {
    id: 'directo',
    label: 'Directo',
    description: 'Usa el valor entrante sin modificarlo.',
    enabled: true,
  },
  {
    id: 'lineal',
    label: 'Lineal',
    description: 'Aplica valor * factor + offset.',
    enabled: true,
  },
  {
    id: 'ieee754_32',
    label: 'IEEE754 32 bits',
    description: 'Une dos registros Modbus para obtener FLOAT32.',
    enabled: true,
    requiresD2: true,
  },
  {
    id: 'uint32_registros',
    label: 'D1 * D2',
    description: 'Combina dos registros Modbus en un entero de 32 bits.',
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
  imports: [CommonModule, FormsModule],
  template: `
    <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            [style.background]="accentSoft"
            [style.color]="accentColor"
          >
            <span class="material-symbols-outlined text-[22px]">settings</span>
          </span>
          <div class="min-w-0">
            <p class="truncate text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              Configuracion del sitio / {{ siteTypeLabel() }}
            </p>
            <h2 class="truncate text-xl font-black leading-none text-slate-800">
              {{ displaySite().descripcion || 'Instalacion' }}
            </h2>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          <span
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3"
          >
            <span class="material-symbols-outlined text-[16px]">memory</span>
            {{ displaySite().id_serial || 'Sin serial' }}
          </span>
          <button
            type="button"
            (click)="load()"
            [disabled]="loading()"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Recargar configuracion"
          >
            <span class="material-symbols-outlined text-[18px]" [class.animate-spin]="loading()"
              >refresh</span
            >
          </button>
        </div>
      </div>

      @if (status().message) {
        <div class="px-4 pt-4">
          <div [class]="statusClass()">
            <span class="material-symbols-outlined text-[18px]">{{
              status().type === 'success' ? 'check_circle' : 'error'
            }}</span>
            {{ status().message }}
          </div>
        </div>
      }

      @if (loading()) {
        <div class="flex min-h-[320px] items-center justify-center bg-slate-50/60">
          <div class="text-center">
            <span
              class="material-symbols-outlined animate-spin text-[34px]"
              [style.color]="accentColor"
              >progress_activity</span
            >
            <p class="mt-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              Cargando configuracion
            </p>
          </div>
        </div>
      } @else {
        <div class="grid gap-5 p-4 xl:grid-cols-[430px_minmax(0,1fr)]">
          <form (submit)="saveVariableMap($event)" class="space-y-4 rounded-xl bg-slate-50 p-4">
            <div>
              <p class="text-sm font-black text-slate-900">Variables del equipo</p>
              <p class="mt-1 text-xs font-semibold text-slate-400">
                La lectura cruda no cambia: aqui solo decides que significa cada dato para este
                sitio.
              </p>
            </div>

            <div>
              <label class="mb-1 block text-xs font-bold text-slate-500">Dato original</label>
              <select
                required
                name="variable-key"
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
                name="variable-transform"
                [ngModel]="variableForm().transformacion"
                (ngModelChange)="updateVariableTransform($event)"
                class="field-control bg-white"
              >
                @for (transform of variableTransformOptions(); track transform.id) {
                  <option [value]="transform.id">{{ transform.label }}</option>
                }
              </select>
              @if (selectedVariableTransform()?.description) {
                <p class="mt-1 text-xs font-semibold text-slate-400">
                  {{ selectedVariableTransform()?.description }}
                </p>
              }
            </div>

            @if (requiresSecondRegister()) {
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs font-bold text-slate-500"
                    >Segundo registro</label
                  >
                  <select
                    name="variable-key-d2"
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
                <div>
                  <label class="mb-1 block text-xs font-bold text-slate-500"
                    >Orden de registros</label
                  >
                  <select
                    name="variable-word-swap"
                    [ngModel]="variableForm().wordSwap"
                    (ngModelChange)="updateVariableForm('wordSwap', $event)"
                    class="field-control bg-white"
                  >
                    <option value="false">Normal ABCD</option>
                    <option value="true">Invertido CDAB</option>
                  </select>
                </div>
              </div>
            }

            <div>
              <label class="mb-1 block text-xs font-bold text-slate-500">Alias</label>
              <input
                required
                name="variable-alias"
                [ngModel]="variableForm().alias"
                (ngModelChange)="updateVariableForm('alias', $event)"
                class="field-control bg-white"
                placeholder="Energia activa, voltaje L1, pH"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs font-bold text-slate-500">Uso en dashboard</label>
              <select
                name="variable-role"
                [ngModel]="variableForm().rol_dashboard"
                (ngModelChange)="updateVariableRole($event)"
                class="field-control bg-white"
              >
                @for (role of variableRoleOptions(); track role.id) {
                  <option [value]="role.id">{{ role.label }}</option>
                }
              </select>
              @if (selectedVariableRole()?.description) {
                <p class="mt-1 text-xs font-semibold text-slate-400">
                  {{ selectedVariableRole()?.description }}
                </p>
              }
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="mb-1 block text-xs font-bold text-slate-500">Tipo</label>
                <select
                  name="variable-type"
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
                <label class="mb-1 block text-xs font-bold text-slate-500">Unidad</label>
                <input
                  name="variable-unit"
                  [ngModel]="variableForm().unidad"
                  (ngModelChange)="updateVariableForm('unidad', $event)"
                  class="field-control bg-white"
                  placeholder="kWh, %, V"
                />
              </div>
            </div>

            @if (isLinearTransform()) {
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="mb-1 block text-xs font-bold text-slate-500">Factor</label>
                  <input
                    type="number"
                    step="any"
                    name="variable-factor"
                    [ngModel]="variableForm().factor"
                    (ngModelChange)="updateVariableForm('factor', $event)"
                    class="field-control bg-white"
                    placeholder="1"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs font-bold text-slate-500">Offset</label>
                  <input
                    type="number"
                    step="any"
                    name="variable-offset"
                    [ngModel]="variableForm().offset"
                    (ngModelChange)="updateVariableForm('offset', $event)"
                    class="field-control bg-white"
                    placeholder="0"
                  />
                </div>
              </div>
            }

            <div class="rounded-lg border border-slate-200 bg-white p-3">
              <label class="mb-1 block text-xs font-bold text-slate-500">Valor crudo de prueba</label>
              <input
                name="variable-sandbox-raw"
                [ngModel]="variableForm().sandboxRaw"
                (ngModelChange)="updateVariableForm('sandboxRaw', $event)"
                class="field-control bg-white"
                placeholder="Ej: 14.7"
              />
              <div class="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <p class="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Resultado proyectado
                </p>
                <p class="mt-1 text-xl font-black text-slate-800">{{ previewResultText() }}</p>
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

          <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h3 class="text-sm font-black text-slate-900">Datos detectados del equipo</h3>
                <p class="text-xs font-semibold text-slate-400">
                  REG1, REG2 y similares se asignan manualmente por sitio.
                </p>
              </div>
              <p class="text-xs font-semibold text-slate-400">
                {{ siteVariables().variables.length }} variables
              </p>
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
                      class="group cursor-pointer bg-white transition-colors hover:bg-slate-50"
                      (click)="prepareVariableMap(variable)"
                    >
                      <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">
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
                              <p class="text-xs text-slate-400">
                                {{ displayRole(variable.mapping.rol_dashboard) }} -
                                {{ displayTransform(variable.mapping.transformacion) }}
                                {{ variable.mapping.unidad || '' }}
                              </p>
                            </div>
                            <button
                              type="button"
                              (click)="$event.stopPropagation(); deleteVariableMap(variable.mapping)"
                              class="icon-button shrink-0 text-red-500 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                              aria-label="Eliminar alias"
                            >
                              <span class="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          } @else {
                            <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
                              Sin alias
                            </span>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr class="bg-white">
                      <td colspan="3" class="px-4 py-8 text-center text-sm font-semibold text-slate-400">
                        Aun no hay variables detectadas para el serial de este sitio.
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
})
export class SiteVariableSettingsPanelComponent implements OnChanges {
  @Input() siteId = '';
  @Input() site: SiteRecord | null = null;
  @Input() accentColor = '#0dafbd';
  @Input() accentSoft = 'rgba(13,175,189,0.10)';

  private api = inject(AdministrationService);

  inputSite = signal<SiteRecord | null>(null);
  loading = signal(false);
  busy = signal('');
  status = signal<SettingsStatus>({ type: '', message: '' });
  siteTypeCatalog = signal<SiteTypeCatalogResponse>(DEFAULT_SITE_TYPE_CATALOG);
  siteVariables = signal<SiteVariablesPayload>(emptyVariables());
  variableForm = signal<VariableForm>({ ...DEFAULT_VARIABLE_FORM });

  displaySite = computed(() => {
    const loaded = this.siteVariables().site;
    if (loaded?.id) return loaded;
    return this.inputSite() || emptySite();
  });

  siteType = computed(() => this.displaySite().tipo_sitio || 'generico');
  siteTypeLabel = computed(() => getSiteTypeUi(this.siteType()).label);
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
  requiresSecondRegister = computed(() => this.selectedVariableTransform()?.requiresD2 === true);
  isLinearTransform = computed(() =>
    ['lineal', 'escala_lineal'].includes(this.variableForm().transformacion),
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
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.setError(this.errorMessage(err, 'No fue posible cargar la configuracion.'));
      },
    });
  }

  selectVariableKey(key: string): void {
    const variable = this.siteVariables().variables.find((item) => item.nombre_dato === key);
    this.variableForm.update((current) => ({
      ...current,
      d1: key,
      alias: current.alias || variable?.mapping?.alias || key,
      sandboxRaw:
        variable?.valor_dato === null || variable?.valor_dato === undefined
          ? current.sandboxRaw
          : String(variable.valor_dato),
    }));

    if (variable?.mapping) {
      this.prepareVariableMap(variable);
    }
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
    this.variableForm.update((current) => ({
      ...current,
      transformacion: transformId,
      d2: this.transformRequiresD2(transformId) ? current.d2 : '',
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
      offset: this.configNumberToString(params?.offset) || '0',
      wordSwap: String(params?.word_swap ?? params?.wordSwap ?? false),
      sandboxRaw:
        variable.valor_dato === null || variable.valor_dato === undefined
          ? ''
          : String(variable.valor_dato),
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

  previewResultText(): string {
    const form = this.variableForm();
    const rawText = String(form.sandboxRaw ?? '').trim();
    const unit = form.unidad ? ` ${form.unidad}` : '';

    if (!rawText && !this.requiresSecondRegister()) return 'Ingresa un valor crudo';

    if (this.isLinearTransform()) {
      const raw = this.toNumber(rawText);
      const factor = this.toNumber(form.factor) ?? 1;
      const offset = this.toNumber(form.offset) ?? 0;
      if (raw === null) return 'Valor crudo no numerico';
      return `${this.formatPreviewNumber(raw * factor + offset)}${unit}`;
    }

    if (this.requiresSecondRegister()) {
      return form.d2 ? 'Se calculara con dos registros' : 'Selecciona segundo registro';
    }

    return `${rawText}${unit}`;
  }

  displayValue(value: SiteVariable['valor_dato']): string {
    if (value === null || value === undefined) return '-';
    return String(value);
  }

  displayRole(roleId: string | null | undefined): string {
    return this.variableRoleOptions().find((role) => role.id === roleId)?.label || 'Generico';
  }

  displayTransform(transformId: string | null | undefined): string {
    const normalized = this.normalizeTransform(transformId);
    return this.variableTransformOptions().find((transform) => transform.id === normalized)?.label || normalized;
  }

  statusClass(): string {
    const base = 'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold';
    return this.status().type === 'success'
      ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
      : `${base} border-red-200 bg-red-50 text-red-700`;
  }

  private buildVariableParameters(): NonNullable<CreateVariableMapPayload['parametros']> {
    const form = this.variableForm();

    if (this.transformRequiresD2(form.transformacion)) {
      return {
        word_swap: form.wordSwap === 'true',
        formato: form.transformacion === 'ieee754_32' ? 'float32' : 'uint32',
      };
    }

    if (this.isLinearTransform()) {
      return {
        factor: this.toNumber(form.factor) ?? 1,
        offset: this.toNumber(form.offset) ?? 0,
      };
    }

    return {};
  }

  private transformRequiresD2(transformId: string): boolean {
    return this.variableTransformOptions().some(
      (transform) => transform.id === transformId && transform.requiresD2 === true,
    );
  }

  private normalizeRole(roleId: string | null | undefined): string {
    const role = roleId || 'generico';
    return this.variableRoleOptions().some((item) => item.id === role) ? role : 'generico';
  }

  private normalizeTransform(transformId: string | null | undefined): string {
    const transform = transformId || 'directo';
    return this.variableTransformOptions().some((item) => item.id === transform)
      ? transform
      : 'directo';
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
