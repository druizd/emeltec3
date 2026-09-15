import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import type { RilesBalancePayload, RilesBalancePoint, RilesGranularidad } from '@emeltec/shared';
import { CompanyService } from '../../../services/company.service';
import { SkeletonComponent } from '../../../components/ui/skeleton';

const MESES = [
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

interface BalanceKpi {
  label: string;
  value: string;
  unit: string;
  helper: string;
  icon: string;
}

/**
 * Balance hídrico del sitio: cuántos m³ entraron por los sitios ligados y
 * cuántos salieron como RIL.
 *
 * Dos marcas importan más que los números: `estimado` (la descarga no se midió,
 * se dedujo del coeficiente configurado) y `completo` (todas las fuentes
 * aportaron dato y cubrieron el período entero). Un balance estimado que se
 * muestre como medido es peor que no mostrar nada.
 */
@Component({
  selector: 'app-riles-balance-panel',
  standalone: true,
  imports: [CommonModule, SkeletonComponent],
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
            Balance hídrico
          </p>
          <p class="text-body-sm font-semibold text-slate-500">
            Agua que entra por los sitios ligados contra el volumen descargado.
          </p>
        </div>

        <div class="flex shrink-0 gap-1 rounded-lg bg-slate-100 p-1">
          @for (opcion of granularidades; track opcion.id) {
            <button
              type="button"
              (click)="setGranularidad(opcion.id)"
              [class]="granularidadClass(opcion.id)"
            >
              {{ opcion.label }}
            </button>
          }
        </div>
      </div>

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
      } @else if (sinFuentes()) {
        <section
          class="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm"
        >
          <span class="material-symbols-outlined text-[28px] text-slate-300">account_tree</span>
          <h2 class="mt-3 text-h6 font-semibold text-slate-800">Este sitio no tiene fuentes</h2>
          <p class="mx-auto mt-1 max-w-lg text-body-sm font-semibold text-slate-500">
            El balance compara el agua que entra con la que se descarga. Hay que declarar en
            Configurar de qué pozos —o de qué otros RILes— se alimenta este punto.
          </p>
        </section>
      } @else {
        <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          @for (kpi of kpis(); track kpi.label) {
            <article
              class="flex min-h-[126px] items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div class="min-w-0">
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
              </div>
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700"
              >
                <span class="material-symbols-outlined text-[20px]">{{ kpi.icon }}</span>
              </span>
            </article>
          }
        </section>

        @if (algunEstimado()) {
          <p
            class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-caption font-semibold leading-5 text-amber-800"
          >
            <span class="material-symbols-outlined text-[18px]">function</span>
            <span>
              Los períodos marcados <strong>Estimado</strong> no tienen medidor en la descarga: el
              volumen sale de aplicar el coeficiente configurado al agua de entrada. En esos
              períodos el coeficiente no mide nada — es el que se declaró.
            </span>
          </p>
        }

        <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[860px] border-collapse">
              <thead class="bg-slate-50">
                <tr class="border-b border-slate-200">
                  <th [class]="thClass">Período</th>
                  <th [class]="thClass + ' text-right'">Entrada [m3]</th>
                  <th [class]="thClass + ' text-right'">Descarga [m3]</th>
                  <th [class]="thClass">Proporción</th>
                  <th [class]="thClass + ' text-right'">Coef. [%]</th>
                  <th [class]="thClass + ' text-right'">Neto [m3]</th>
                  <th [class]="thClass">Estado</th>
                  <th [class]="thClass"></th>
                </tr>
              </thead>
              <tbody>
                @for (punto of puntos(); track punto.periodo) {
                  <tr class="border-b border-slate-100 last:border-0">
                    <td class="px-4 py-3 text-body-sm font-semibold text-slate-800">
                      {{ periodoLabel(punto.periodo) }}
                      @if (!punto.completo) {
                        <span
                          class="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-caption font-bold text-slate-500"
                          title="Falta dato de alguna fuente, o una vigencia no cubre el período completo"
                        >
                          Parcial
                        </span>
                      }
                    </td>
                    <td [class]="numeroClass">{{ m3(punto.volumen_entrada_m3) }}</td>
                    <td [class]="numeroClass">
                      {{ m3(punto.volumen_salida_m3) }}
                      @if (punto.estimado) {
                        <span
                          class="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-[2px] text-caption font-bold text-amber-700"
                        >
                          Estimado
                        </span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <span
                        class="flex h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-slate-100"
                      >
                        <span
                          class="h-full rounded-full bg-emerald-500"
                          [style.width.%]="barraPct(punto)"
                        ></span>
                      </span>
                    </td>
                    <td [class]="numeroClass">{{ pct(punto.coeficiente_pct) }}</td>
                    <td [class]="numeroClass">{{ m3(punto.consumo_neto_m3) }}</td>
                    <td class="px-4 py-3">
                      <span [class]="estadoClass(punto.estado)">{{
                        estadoLabel(punto.estado)
                      }}</span>
                    </td>
                    <td class="px-4 py-3 text-right">
                      @if (punto.aportes.length) {
                        <button
                          type="button"
                          (click)="toggleDetalle(punto.periodo)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95"
                          [attr.aria-label]="'Ver fuentes de ' + periodoLabel(punto.periodo)"
                          [attr.aria-expanded]="detalleAbierto() === punto.periodo"
                        >
                          <span class="material-symbols-outlined text-[18px]">
                            {{ detalleAbierto() === punto.periodo ? 'expand_less' : 'expand_more' }}
                          </span>
                        </button>
                      }
                    </td>
                  </tr>

                  @if (detalleAbierto() === punto.periodo) {
                    <tr class="border-b border-slate-100 bg-slate-50">
                      <td colspan="8" class="px-4 py-3">
                        <p
                          class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                          style="font-family: var(--font-josefin);"
                        >
                          Aporte por fuente
                        </p>
                        <ul class="mt-2 space-y-2">
                          @for (aporte of punto.aportes; track aporte.fuente_id) {
                            <li
                              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                            >
                              <span class="flex min-w-0 items-center gap-2">
                                <span
                                  class="material-symbols-outlined text-[18px]"
                                  [class]="
                                    aporte.direccion === 'entrada'
                                      ? 'text-primary-container'
                                      : 'text-emerald-600'
                                  "
                                >
                                  {{ aporte.direccion === 'entrada' ? 'south_east' : 'north_east' }}
                                </span>
                                <span class="truncate text-body-sm font-semibold text-slate-800">
                                  {{ aporte.descripcion || aporte.sitio_id }}
                                </span>
                                <span class="text-caption font-semibold text-slate-400">
                                  {{ aporte.sitio_id }} · {{ aporte.rol }}
                                </span>
                                @if (aporte.factor !== 1) {
                                  <span
                                    class="rounded-full bg-slate-100 px-2 py-[2px] text-caption font-bold text-slate-600"
                                  >
                                    ×{{ aporte.factor }}
                                  </span>
                                }
                                @if (aporte.vigencia_parcial) {
                                  <span
                                    class="rounded-full bg-amber-50 px-2 py-[2px] text-caption font-bold text-amber-700"
                                    title="La vigencia de este vínculo no cubre el período completo"
                                  >
                                    Vigencia parcial
                                  </span>
                                }
                              </span>
                              <span class="flex items-center gap-3">
                                @if (aporte.sin_dato) {
                                  <span class="text-caption font-bold text-slate-400">
                                    Sin lecturas
                                  </span>
                                } @else {
                                  <span
                                    class="text-body-sm font-semibold text-slate-800"
                                    style="font-family: var(--font-mono);"
                                  >
                                    {{ m3(aporte.aporte_m3) }} m3
                                  </span>
                                  @if (aporte.unidad_origen && !esM3(aporte.unidad_origen)) {
                                    <span
                                      class="rounded-full bg-slate-100 px-2 py-[2px] text-caption font-bold text-slate-600"
                                      [title]="
                                        'El contador mide en ' +
                                        aporte.unidad_origen +
                                        '; el balance lo convierte a m3'
                                      "
                                    >
                                      origen: {{ aporte.unidad_origen }}
                                    </span>
                                  }
                                }
                              </span>
                            </li>
                          }
                        </ul>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td
                      colspan="8"
                      class="px-4 py-10 text-center text-body-sm font-semibold text-slate-500"
                    >
                      Sin períodos en el rango seleccionado.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `,
})
export class RilesBalancePanelComponent implements OnInit {
  private companyService = inject(CompanyService);

  @Input({ required: true }) siteId = '';

  readonly granularidad = signal<RilesGranularidad>('mes');
  readonly payload = signal<RilesBalancePayload | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly detalleAbierto = signal<string | null>(null);

  readonly granularidades: { id: RilesGranularidad; label: string }[] = [
    { id: 'mes', label: 'Mensual' },
    { id: 'dia', label: 'Diario' },
  ];

  readonly thClass =
    'px-4 py-3 text-left text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400';
  readonly numeroClass =
    'px-4 py-3 text-right text-body-sm font-semibold text-slate-800 tabular-nums';

  readonly puntos = computed<RilesBalancePoint[]>(() => this.payload()?.puntos ?? []);
  readonly sinFuentes = computed(() => {
    const puntos = this.puntos();
    return puntos.length > 0 && puntos.every((p) => p.aportes.length === 0);
  });
  readonly algunEstimado = computed(() => this.puntos().some((p) => p.estimado));

  readonly kpis = computed<BalanceKpi[]>(() => {
    const puntos = this.puntos();
    if (!puntos.length) return [];

    const entrada = this.sumar(puntos.map((p) => p.volumen_entrada_m3));
    const salida = this.sumar(puntos.map((p) => p.volumen_salida_m3));
    const coef =
      entrada !== null && entrada > 0 && salida !== null ? (salida / entrada) * 100 : null;
    const conDato = puntos.filter((p) => p.volumen_entrada_m3 !== null).length;
    const completos = puntos.filter((p) => p.completo).length;
    const unidad = this.granularidad() === 'mes' ? 'meses' : 'días';

    return [
      {
        label: 'Vol. entrada',
        value: this.m3(entrada),
        unit: 'm3',
        helper: `${conDato} de ${puntos.length} ${unidad} con lecturas`,
        icon: 'south_east',
      },
      {
        label: 'Vol. descarga',
        value: this.m3(salida),
        unit: 'm3',
        helper: this.algunEstimado() ? 'incluye períodos estimados' : 'medido en la descarga',
        icon: 'north_east',
      },
      {
        label: 'Coef. descarga',
        value: this.pct(coef),
        unit: '%',
        helper: this.bandaHelper(),
        icon: 'percent',
      },
      {
        label: 'Consumo neto',
        value: this.m3(entrada !== null && salida !== null ? entrada - salida : null),
        unit: 'm3',
        helper: `${completos} de ${puntos.length} ${unidad} completos`,
        icon: 'water_loss',
      },
    ];
  });

  ngOnInit(): void {
    this.cargar();
  }

  setGranularidad(valor: RilesGranularidad): void {
    if (this.granularidad() === valor) return;
    this.granularidad.set(valor);
    this.detalleAbierto.set(null);
    this.cargar();
  }

  cargar(): void {
    const siteId = this.siteId;
    if (!siteId) return;
    this.loading.set(true);
    this.error.set(null);
    this.companyService.getRilesBalance(siteId, { granularidad: this.granularidad() }).subscribe({
      next: (res) => {
        if (res.ok) this.payload.set(res.data);
        else this.error.set('No se pudo cargar el balance.');
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el balance.');
        this.loading.set(false);
      },
    });
  }

  toggleDetalle(periodo: string): void {
    this.detalleAbierto.set(this.detalleAbierto() === periodo ? null : periodo);
  }

  granularidadClass(id: RilesGranularidad): string {
    const base =
      'rounded-md px-3 py-1.5 text-body-sm font-semibold transition-colors active:scale-95';
    return this.granularidad() === id
      ? `${base} bg-white text-emerald-700 shadow-sm`
      : `${base} text-slate-500 hover:text-slate-800`;
  }

  periodoLabel(periodo: string): string {
    if (this.granularidad() === 'dia') {
      const [y, m, d] = periodo.split('-');
      return `${d}/${m}/${y}`;
    }
    const [y, m] = periodo.split('-');
    return `${MESES[Number(m) - 1] ?? periodo} ${y}`;
  }

  /** Ancho de la barra: qué proporción de la entrada se fue como descarga. */
  barraPct(punto: RilesBalancePoint): number {
    const coef = punto.coeficiente_pct;
    if (coef === null) return 0;
    return Math.max(0, Math.min(100, coef));
  }

  estadoLabel(estado: RilesBalancePoint['estado']): string {
    switch (estado) {
      case 'ok':
        return 'En banda';
      case 'sobre':
        return 'Sobre banda';
      case 'bajo':
        return 'Bajo banda';
      case 'sin_dato':
        return 'Sin dato';
      default:
        return 'Sin banda';
    }
  }

  estadoClass(estado: RilesBalancePoint['estado']): string {
    const base = 'inline-flex items-center rounded-full px-2 py-[3px] text-caption font-bold';
    switch (estado) {
      case 'ok':
        return `${base} border border-emerald-200 bg-emerald-50 text-emerald-700`;
      case 'sobre':
        return `${base} border border-rose-200 bg-rose-50 text-rose-700`;
      case 'bajo':
        return `${base} border border-amber-200 bg-amber-50 text-amber-700`;
      default:
        return `${base} border border-slate-200 bg-slate-50 text-slate-500`;
    }
  }

  esM3(unidad: string): boolean {
    return ['m3', 'm³', 'mc'].includes(unidad.trim().toLowerCase());
  }

  m3(valor: number | null): string {
    if (valor === null) return '—';
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(valor);
  }

  pct(valor: number | null): string {
    if (valor === null) return '—';
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(valor);
  }

  private bandaHelper(): string {
    const config = this.payload()?.config;
    if (!config || config.coef_descarga_esperado_pct === null) return 'sin banda configurada';
    return `banda: ${config.coef_descarga_esperado_pct} ± ${config.coef_tolerancia_pct} %`;
  }

  /** Suma ignorando los períodos sin dato; null si ninguno tuvo. */
  private sumar(valores: (number | null)[]): number | null {
    return valores
      .filter((v): v is number => v !== null)
      .reduce<number | null>((acc, v) => (acc ?? 0) + v, null);
  }
}
