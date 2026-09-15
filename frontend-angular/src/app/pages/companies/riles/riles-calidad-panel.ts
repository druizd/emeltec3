import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  RilesEstadoResultado,
  RilesMuestraEvaluada,
  RilesParametro,
  RilesResultadoEvaluado,
  RilesTipoMuestra,
} from '@emeltec/shared';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';
import { SkeletonComponent } from '../../../components/ui/skeleton';

interface CalidadKpi {
  label: string;
  value: string;
  unit: string;
  helper: string;
}

interface FilaResultado {
  parametro: string;
  valor: string;
  unidad: string;
  bajo_ld: boolean;
}

/**
 * Calidad del efluente: los análisis de laboratorio del sitio y la carga
 * contaminante que sale de cruzarlos con el volumen del balance.
 *
 * Tres marcas importan más que los números:
 *
 *  - **estimado**: el volumen del día no se midió, se dedujo del coeficiente.
 *    Entonces la carga en kg también es una deducción.
 *  - **cota**: el laboratorio informó "< LD". La carga es un techo, no una
 *    medición, y se escribe con un `<` adelante.
 *  - **sin comparar**: hay límite pero no se pudo contrastar. Nunca se pinta
 *    como cumplimiento.
 */
@Component({
  selector: 'app-riles-calidad-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SkeletonComponent],
  template: `
    <section class="space-y-5">
      <div
        class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="min-w-0">
          <p
            class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            style="font-family: var(--font-josefin);"
          >
            Calidad del efluente
          </p>
          <p class="text-body-sm font-semibold text-slate-500">
            Análisis de laboratorio y carga contaminante contra el volumen descargado.
          </p>
        </div>

        @if (puedeEditar()) {
          <button
            type="button"
            (click)="toggleFormulario()"
            class="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-95"
          >
            <span class="material-symbols-outlined">{{
              mostrarFormulario() ? 'close' : 'add'
            }}</span>
            {{ mostrarFormulario() ? 'Cancelar' : 'Cargar muestra' }}
          </button>
        }
      </div>

      @if (sinNorma() && !loading()) {
        <div
          class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm font-semibold text-amber-800"
        >
          <span class="material-symbols-outlined shrink-0 text-amber-600">gavel</span>
          <span>
            Este sitio no tiene norma configurada, así que ningún resultado se compara contra un
            límite. Se declara en Configurar.
          </span>
        </div>
      }

      @if (mostrarFormulario()) {
        <form
          (ngSubmit)="guardar()"
          class="space-y-4 rounded-xl border border-emerald-200 bg-white px-4 py-4 shadow-sm"
        >
          <p
            class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            style="font-family: var(--font-josefin);"
          >
            Nueva muestra
          </p>

          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label class="block">
              <span [class]="labelClass">Fecha de la toma</span>
              <input
                type="date"
                [(ngModel)]="form.fecha_muestra"
                name="fecha"
                [class]="inputClass"
              />
            </label>
            <label class="block">
              <span [class]="labelClass">Tipo</span>
              <select [(ngModel)]="form.tipo" name="tipo" [class]="inputClass">
                @for (t of tipos; track t.id) {
                  <option [value]="t.id">{{ t.label }}</option>
                }
              </select>
            </label>
            <label class="block">
              <span [class]="labelClass">Laboratorio</span>
              <input
                type="text"
                [(ngModel)]="form.laboratorio"
                name="laboratorio"
                maxlength="120"
                [class]="inputClass"
              />
            </label>
            <label class="block">
              <span [class]="labelClass">N° de informe</span>
              <input
                type="text"
                [(ngModel)]="form.n_informe"
                name="informe"
                maxlength="60"
                [class]="inputClass"
              />
            </label>
            <label class="block">
              <span [class]="labelClass">Punto de muestreo</span>
              <input
                type="text"
                [(ngModel)]="form.punto"
                name="punto"
                maxlength="80"
                [class]="inputClass"
              />
            </label>
            <label class="block">
              <span [class]="labelClass">Nota</span>
              <input
                type="text"
                [(ngModel)]="form.nota"
                name="nota"
                maxlength="500"
                [class]="inputClass"
              />
            </label>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span [class]="labelClass">Resultados</span>
              <button
                type="button"
                (click)="agregarFila()"
                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <span class="material-symbols-outlined">add</span>
                Agregar parámetro
              </button>
            </div>

            @for (fila of filas(); track $index) {
              <div class="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto_auto] md:items-center">
                <select
                  [ngModel]="fila.parametro"
                  (ngModelChange)="setParametro($index, $event)"
                  [name]="'param' + $index"
                  [class]="inputClass"
                >
                  <option value="">Parámetro…</option>
                  @for (p of parametros(); track p.codigo) {
                    <option [value]="p.codigo">{{ p.nombre }}</option>
                  }
                </select>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Valor"
                  [(ngModel)]="fila.valor"
                  [name]="'valor' + $index"
                  [class]="inputClass"
                />
                <input
                  type="text"
                  placeholder="Unidad"
                  [(ngModel)]="fila.unidad"
                  [name]="'unidad' + $index"
                  maxlength="20"
                  [class]="inputClass"
                />
                <label
                  class="inline-flex items-center gap-1 whitespace-nowrap text-caption font-bold text-slate-600"
                  title="El laboratorio informó «menor que el límite de detección»"
                >
                  <input type="checkbox" [(ngModel)]="fila.bajo_ld" [name]="'ld' + $index" />
                  &lt; LD
                </label>
                <button
                  type="button"
                  (click)="quitarFila($index)"
                  class="justify-self-start rounded-lg p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Quitar parámetro"
                >
                  <span class="material-symbols-outlined">delete</span>
                </button>
              </div>
            }
          </div>

          @if (formError(); as mensaje) {
            <p class="text-body-sm font-semibold text-rose-700">{{ mensaje }}</p>
          }

          <div class="flex justify-end gap-2">
            <button
              type="button"
              (click)="toggleFormulario()"
              class="rounded-lg border border-slate-200 px-3 py-2 text-body-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              [disabled]="guardando()"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {{ guardando() ? 'Guardando…' : 'Guardar muestra' }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <app-skeleton class="h-28 rounded-xl" />
          <app-skeleton class="h-28 rounded-xl" />
          <app-skeleton class="h-28 rounded-xl" />
          <app-skeleton class="h-28 rounded-xl" />
        </div>
        <app-skeleton class="h-[320px] w-full rounded-xl" />
      } @else if (error(); as mensaje) {
        <div
          class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-body-sm font-semibold text-rose-700"
        >
          {{ mensaje }}
        </div>
      } @else if (muestras().length === 0) {
        <section
          class="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm"
        >
          <span class="material-symbols-outlined text-[28px] text-slate-300">science</span>
          <h2 class="mt-3 text-h6 font-semibold text-slate-800">
            Sin muestras en los últimos 12 meses
          </h2>
          <p class="mx-auto mt-1 max-w-xl text-body-sm font-semibold text-slate-500">
            Acá se cargan los análisis del autocontrol. Cada resultado se compara contra el límite
            vigente a la fecha de la toma, y la carga en kg sale de cruzarlo con el volumen que
            calcula el balance ese día.
          </p>
        </section>
      } @else {
        <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          @for (kpi of kpis(); track kpi.label) {
            <article
              class="flex min-h-[126px] flex-col justify-center rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p
                class="truncate text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                style="font-family: var(--font-josefin);"
              >
                {{ kpi.label }}
              </p>
              <div class="mt-2 flex items-end gap-2">
                <strong
                  class="truncate text-[28px] font-semibold leading-none text-primary-container"
                  style="font-family: var(--font-mono);"
                >
                  {{ kpi.value }}
                </strong>
                <span class="pb-1 text-caption font-bold text-slate-500">{{ kpi.unit }}</span>
              </div>
              <p class="mt-2 truncate text-caption font-semibold text-slate-500">
                {{ kpi.helper }}
              </p>
            </article>
          }
        </section>

        <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-100">
              <thead class="bg-slate-50">
                <tr>
                  <th [class]="thClass">Fecha</th>
                  <th [class]="thClass">Tipo</th>
                  <th [class]="thClass">Laboratorio</th>
                  <th [class]="thClass">N° informe</th>
                  <th [class]="thClass + ' text-right'">Vol. día [M3]</th>
                  <th [class]="thClass + ' text-right'">Parámetros</th>
                  <th [class]="thClass">Estado</th>
                  <th [class]="thClass"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (muestra of muestras(); track muestra.id) {
                  <tr class="transition-colors hover:bg-slate-50">
                    <td class="px-4 py-3 text-body-sm font-semibold text-slate-800">
                      {{ fecha(muestra.fecha_muestra) }}
                    </td>
                    <td class="px-4 py-3 text-body-sm font-semibold text-slate-600">
                      {{ tipoLabel(muestra.tipo) }}
                    </td>
                    <td class="px-4 py-3 text-body-sm font-semibold text-slate-600">
                      {{ muestra.laboratorio || '—' }}
                    </td>
                    <td class="px-4 py-3 text-body-sm font-semibold text-slate-600">
                      {{ muestra.n_informe || '—' }}
                    </td>
                    <td [class]="numeroClass">
                      {{ numero(muestra.volumen_dia_m3) }}
                      @if (muestra.volumen_estimado) {
                        <span
                          class="ml-1 text-caption font-bold text-amber-600"
                          title="Volumen estimado desde el coeficiente, no medido"
                          >est.</span
                        >
                      }
                    </td>
                    <td [class]="numeroClass">{{ muestra.resultados.length }}</td>
                    <td class="px-4 py-3">
                      <span [class]="muestraBadgeClass(muestra)">{{ muestraBadge(muestra) }}</span>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <button
                        type="button"
                        (click)="toggleDetalle(muestra.id)"
                        class="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        [attr.aria-label]="
                          abierta() === muestra.id ? 'Cerrar detalle' : 'Ver detalle'
                        "
                      >
                        <span class="material-symbols-outlined">
                          {{ abierta() === muestra.id ? 'expand_less' : 'expand_more' }}
                        </span>
                      </button>
                    </td>
                  </tr>

                  @if (abierta() === muestra.id) {
                    <tr class="bg-slate-50/60">
                      <td colspan="8" class="px-4 py-4">
                        <table class="min-w-full">
                          <thead>
                            <tr>
                              <th [class]="thClass">Parámetro</th>
                              <th [class]="thClass + ' text-right'">Valor</th>
                              <th [class]="thClass">Unidad</th>
                              <th [class]="thClass + ' text-right'">Límite</th>
                              <th [class]="thClass + ' text-right'">Uso [%]</th>
                              <th [class]="thClass + ' text-right'">Carga [KG]</th>
                              <th [class]="thClass">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (r of muestra.resultados; track r.id) {
                              <tr>
                                <td class="px-4 py-2 text-body-sm font-semibold text-slate-800">
                                  {{ r.parametro_nombre || r.parametro }}
                                </td>
                                <td [class]="numeroClass">
                                  @if (r.bajo_ld) {
                                    <span title="Bajo el límite de detección">&lt; </span>
                                  }
                                  {{ numero(r.valor_norm ?? r.valor, 4) }}
                                </td>
                                <td class="px-4 py-2 text-body-sm font-semibold text-slate-500">
                                  {{ r.unidad_canonica || r.unidad }}
                                </td>
                                <td [class]="numeroClass">{{ limiteTexto(r) }}</td>
                                <td [class]="numeroClass">{{ numero(r.uso_limite_pct) }}</td>
                                <td [class]="numeroClass">
                                  @if (r.carga_es_cota && r.carga_kg !== null) {
                                    <span title="Sale de un «< LD»: es una cota superior"
                                      >&lt;
                                    </span>
                                  }
                                  {{ numero(r.carga_kg, 3) }}
                                </td>
                                <td class="px-4 py-2">
                                  <span [class]="estadoClass(r.estado)">{{
                                    estadoLabel(r.estado)
                                  }}</span>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>

                        <div class="mt-3 flex flex-wrap items-center gap-3">
                          @if (muestra.punto) {
                            <span class="text-caption font-semibold text-slate-500">
                              Punto: {{ muestra.punto }}
                            </span>
                          }
                          @if (muestra.nota) {
                            <span class="text-caption font-semibold text-slate-500">
                              {{ muestra.nota }}
                            </span>
                          }
                          @if (puedeEditar()) {
                            <button
                              type="button"
                              (click)="eliminar(muestra)"
                              class="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-caption font-bold text-rose-600 transition-colors hover:bg-rose-50"
                            >
                              <span class="material-symbols-outlined">delete</span>
                              Eliminar muestra
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `,
})
export class RilesCalidadPanelComponent implements OnInit {
  private companyService = inject(CompanyService);
  private auth = inject(AuthService);

  @Input({ required: true }) siteId = '';

  /** Mismo conjunto que RILES_ADMIN_ROLES en companyRoutes. */
  readonly puedeEditar = computed(
    () => this.auth.isSuperAdmin() || this.auth.isAdmin() || this.auth.isGerente(),
  );

  readonly muestras = signal<RilesMuestraEvaluada[]>([]);
  readonly parametros = signal<RilesParametro[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly abierta = signal<string | null>(null);

  readonly mostrarFormulario = signal(false);
  readonly guardando = signal(false);
  readonly formError = signal<string | null>(null);
  readonly filas = signal<FilaResultado[]>([]);

  form: {
    fecha_muestra: string;
    tipo: RilesTipoMuestra;
    laboratorio: string;
    n_informe: string;
    punto: string;
    nota: string;
  } = this.formVacio();

  readonly tipos: { id: RilesTipoMuestra; label: string }[] = [
    { id: 'autocontrol', label: 'Autocontrol' },
    { id: 'fiscalizacion', label: 'Fiscalización' },
    { id: 'interna', label: 'Interna' },
  ];

  readonly thClass =
    'px-4 py-3 text-left text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400';
  readonly numeroClass =
    'px-4 py-3 text-right text-body-sm font-semibold text-slate-800 tabular-nums';
  readonly labelClass =
    'mb-1 block text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400';
  readonly inputClass =
    'w-full rounded-lg border border-slate-200 px-3 py-2 text-body-sm font-semibold text-slate-800 focus:border-emerald-400 focus:outline-none';

  /** Ninguna muestra pudo compararse porque el sitio no declaró norma. */
  readonly sinNorma = computed(
    () => this.muestras().length > 0 && this.muestras().every((m) => m.norma === null),
  );

  readonly kpis = computed<CalidadKpi[]>(() => {
    const muestras = this.muestras();
    if (!muestras.length) return [];

    const conExcedencia = muestras.filter((m) => m.n_excede > 0).length;
    const ultima = muestras[0];
    const sinLimite = muestras
      .flatMap((m) => m.resultados)
      .filter((r) => r.estado === 'sin_limite').length;

    return [
      {
        label: 'Muestras',
        value: String(muestras.length),
        unit: '',
        helper: 'últimos 12 meses',
      },
      {
        label: 'Con excedencia',
        value: String(conExcedencia),
        unit: '',
        helper: conExcedencia === 0 ? 'ningún parámetro fuera de límite' : 'revisar el detalle',
      },
      {
        label: 'Última muestra',
        value: ultima ? this.fecha(ultima.fecha_muestra) : '—',
        unit: '',
        helper: ultima ? this.tipoLabel(ultima.tipo) : '',
      },
      {
        label: 'Sin límite',
        value: String(sinLimite),
        unit: 'result.',
        helper:
          sinLimite === 0 ? 'todos tienen límite declarado' : 'falta declararlos en Configurar',
      },
    ];
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const siteId = this.siteId;
    if (!siteId) return;
    this.loading.set(true);
    this.error.set(null);
    this.companyService.getRilesMuestras(siteId).subscribe({
      next: (res) => {
        if (res.ok) this.muestras.set(res.data);
        else this.error.set('No se pudieron cargar las muestras.');
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las muestras.');
        this.loading.set(false);
      },
    });
  }

  toggleDetalle(id: string): void {
    this.abierta.set(this.abierta() === id ? null : id);
  }

  toggleFormulario(): void {
    const abriendo = !this.mostrarFormulario();
    this.mostrarFormulario.set(abriendo);
    this.formError.set(null);
    if (abriendo) {
      this.form = this.formVacio();
      this.filas.set([this.filaVacia()]);
      // El catálogo se pide una sola vez, al abrir el formulario por primera vez.
      if (this.parametros().length === 0) {
        this.companyService.getRilesParametros(this.siteId).subscribe({
          next: (res) => {
            if (res.ok) this.parametros.set(res.data);
          },
        });
      }
    }
  }

  agregarFila(): void {
    this.filas.update((filas) => [...filas, this.filaVacia()]);
  }

  quitarFila(index: number): void {
    this.filas.update((filas) => filas.filter((_, i) => i !== index));
  }

  /** Al elegir parámetro se propone su unidad canónica, que es la del informe. */
  setParametro(index: number, codigo: string): void {
    const unidad = this.parametros().find((p) => p.codigo === codigo)?.unidad ?? '';
    this.filas.update((filas) =>
      filas.map((f, i) =>
        i === index ? { ...f, parametro: codigo, unidad: f.unidad || unidad } : f,
      ),
    );
  }

  guardar(): void {
    const filas = this.filas().filter((f) => f.parametro && f.valor !== '');
    if (!this.form.fecha_muestra) {
      this.formError.set('Falta la fecha de la toma.');
      return;
    }
    if (filas.length === 0) {
      this.formError.set('Una muestra sin resultados no dice nada: agregue al menos un parámetro.');
      return;
    }
    const repetido = filas.find(
      (f, i) => filas.findIndex((o) => o.parametro === f.parametro) !== i,
    );
    if (repetido) {
      this.formError.set(`El parámetro "${repetido.parametro}" viene repetido.`);
      return;
    }

    this.guardando.set(true);
    this.formError.set(null);
    this.companyService
      .createRilesMuestra(this.siteId, {
        fecha_muestra: this.form.fecha_muestra,
        tipo: this.form.tipo,
        laboratorio: this.form.laboratorio || null,
        n_informe: this.form.n_informe || null,
        punto: this.form.punto || null,
        nota: this.form.nota || null,
        resultados: filas.map((f) => ({
          parametro: f.parametro,
          valor: Number(f.valor),
          unidad: f.unidad,
          bajo_ld: f.bajo_ld,
        })),
      })
      .subscribe({
        next: (res) => {
          this.guardando.set(false);
          if (!res.ok) {
            this.formError.set('No se pudo guardar la muestra.');
            return;
          }
          this.mostrarFormulario.set(false);
          this.cargar();
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.guardando.set(false);
          this.formError.set(err?.error?.error?.message ?? 'No se pudo guardar la muestra.');
        },
      });
  }

  eliminar(muestra: RilesMuestraEvaluada): void {
    this.companyService.deleteRilesMuestra(this.siteId, muestra.id).subscribe({
      next: () => {
        this.abierta.set(null);
        this.cargar();
      },
      error: () => this.error.set('No se pudo eliminar la muestra.'),
    });
  }

  // ── Presentación ───────────────────────────────────────────────────────────

  fecha(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  tipoLabel(tipo: RilesTipoMuestra): string {
    return this.tipos.find((t) => t.id === tipo)?.label ?? tipo;
  }

  numero(valor: number | null, decimales = 2): string {
    if (valor === null || valor === undefined) return '—';
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: decimales }).format(valor);
  }

  limiteTexto(r: RilesResultadoEvaluado): string {
    if (r.limite_min !== null && r.limite_max !== null) {
      return `${this.numero(r.limite_min, 4)} – ${this.numero(r.limite_max, 4)}`;
    }
    if (r.limite_max !== null) return `≤ ${this.numero(r.limite_max, 4)}`;
    if (r.limite_min !== null) return `≥ ${this.numero(r.limite_min, 4)}`;
    return '—';
  }

  estadoLabel(estado: RilesEstadoResultado): string {
    switch (estado) {
      case 'ok':
        return 'Cumple';
      case 'excede':
        return 'Excede';
      case 'bajo_minimo':
        return 'Bajo mínimo';
      case 'sin_comparar':
        return 'Sin comparar';
      default:
        return 'Sin límite';
    }
  }

  estadoClass(estado: RilesEstadoResultado): string {
    const base = 'inline-flex items-center rounded-full px-2 py-[3px] text-caption font-bold';
    switch (estado) {
      case 'ok':
        return `${base} border border-emerald-200 bg-emerald-50 text-emerald-700`;
      case 'excede':
        return `${base} border border-rose-200 bg-rose-50 text-rose-700`;
      case 'bajo_minimo':
        return `${base} border border-amber-200 bg-amber-50 text-amber-700`;
      case 'sin_comparar':
        return `${base} border border-sky-200 bg-sky-50 text-sky-700`;
      default:
        return `${base} border border-slate-200 bg-slate-50 text-slate-500`;
    }
  }

  muestraBadge(muestra: RilesMuestraEvaluada): string {
    if (muestra.n_excede > 0) {
      return muestra.n_excede === 1 ? '1 excedencia' : `${muestra.n_excede} excedencias`;
    }
    if (muestra.norma === null) return 'Sin norma';
    if (muestra.resultados.every((r) => r.estado === 'sin_limite')) return 'Sin límites';
    return 'Conforme';
  }

  muestraBadgeClass(muestra: RilesMuestraEvaluada): string {
    const base = 'inline-flex items-center rounded-full px-2 py-[3px] text-caption font-bold';
    if (muestra.n_excede > 0) return `${base} border border-rose-200 bg-rose-50 text-rose-700`;
    if (muestra.norma === null || muestra.resultados.every((r) => r.estado === 'sin_limite')) {
      return `${base} border border-slate-200 bg-slate-50 text-slate-500`;
    }
    return `${base} border border-emerald-200 bg-emerald-50 text-emerald-700`;
  }

  private formVacio() {
    return {
      fecha_muestra: '',
      tipo: 'autocontrol' as RilesTipoMuestra,
      laboratorio: '',
      n_informe: '',
      punto: '',
      nota: '',
    };
  }

  private filaVacia(): FilaResultado {
    return { parametro: '', valor: '', unidad: '', bajo_ld: false };
  }
}
