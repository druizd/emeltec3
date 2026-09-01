import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { SiteDashboardHistoryDigital, SiteDashboardHistoryEntry } from '@emeltec/shared';
import { CompanyService, type HistoryGranularity } from '../../../services/company.service';
import { SkeletonComponent } from '../../../components/ui/skeleton';

/** Un tramo contiguo con el mismo estado dentro de la ventana consultada. */
interface Tramo {
  /** Posición y ancho en porcentaje del eje de tiempo. */
  left: number;
  width: number;
  estado: 'activo' | 'inactivo' | 'sin_dato';
  desde: number;
  hasta: number;
}

/** Una señal digital con su serie ya convertida en tramos dibujables. */
interface Lane {
  key: string;
  alias: string;
  bit: number;
  tramos: Tramo[];
  /** Último valor conocido de la ventana, para el badge de la derecha. */
  actual: 'activo' | 'inactivo' | 'sin_dato';
  /** Cuántas veces pasó de 0 a 1 dentro de la ventana. */
  activaciones: number;
}

const VENTANAS = [
  { id: '6h', label: '6 h', horas: 6, granularity: '1m' as HistoryGranularity, limit: 400 },
  { id: '24h', label: '24 h', horas: 24, granularity: '1m' as HistoryGranularity, limit: 1500 },
  { id: '7d', label: '7 días', horas: 24 * 7, granularity: '1h' as HistoryGranularity, limit: 200 },
] as const;

type VentanaId = (typeof VENTANAS)[number]['id'];

/**
 * Línea de tiempo de las señales digitales de un sitio.
 *
 * Una banda por señal: verde donde el bit estuvo en 1, gris donde estuvo en 0 y
 * ámbar donde no hubo lectura. Es la vista que responde "¿a qué hora se
 * disparó el térmico anoche?", que un gráfico de líneas con 16 series
 * superpuestas no responde.
 *
 * No dibuja nada si el sitio no tiene señales digitales configuradas, así que
 * es seguro montarlo en cualquier página de detalle.
 */
@Component({
  selector: 'app-site-digital-signals-timeline',
  standalone: true,
  imports: [CommonModule, SkeletonComponent],
  template: `
    @if (loading()) {
      <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <app-skeleton class="h-4 w-48 rounded" />
        @for (_ of [0, 1, 2, 3, 4]; track $index) {
          <app-skeleton class="h-6 w-full rounded-md" />
        }
      </section>
    } @else if (lanes().length) {
      <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <div class="min-w-0">
            <h2 class="text-body-sm font-semibold text-slate-900">Señales digitales</h2>
            <p class="text-caption font-semibold text-slate-500">
              {{ lanes().length }}
              {{ lanes().length === 1 ? 'entrada configurada' : 'entradas configuradas' }} ·
              {{ rangoLabel() }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="flex rounded-lg border border-slate-200 p-0.5">
              @for (ventana of ventanas; track ventana.id) {
                <button
                  type="button"
                  (click)="setVentana(ventana.id)"
                  [class]="ventanaClass(ventana.id)"
                >
                  {{ ventana.label }}
                </button>
              }
            </div>
            <button
              type="button"
              (click)="load()"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 active:scale-95"
              aria-label="Recargar señales digitales"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>
            </button>
          </div>
        </div>

        @if (errorMsg()) {
          <p
            class="border-b border-red-100 bg-red-50 px-4 py-2 text-caption font-bold text-red-700"
          >
            {{ errorMsg() }}
          </p>
        }

        <div class="space-y-1 px-4 py-3">
          @for (lane of lanes(); track lane.key) {
            <div
              class="grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_5.5rem] items-center gap-3"
            >
              <div class="min-w-0">
                <p class="truncate text-caption font-bold text-slate-700" [title]="lane.alias">
                  {{ lane.alias }}
                </p>
                <p class="text-caption-xs font-semibold text-slate-400">
                  bit {{ lane.bit }}
                  @if (lane.activaciones) {
                    · {{ lane.activaciones }}
                    {{ lane.activaciones === 1 ? 'activación' : 'activaciones' }}
                  }
                </p>
              </div>

              <div class="relative h-6 overflow-hidden rounded-md bg-slate-100">
                @for (tramo of lane.tramos; track $index) {
                  <span
                    class="absolute inset-y-0"
                    [class]="tramoClass(tramo)"
                    [style.left.%]="tramo.left"
                    [style.width.%]="tramo.width"
                    [title]="tramoTitle(lane, tramo)"
                  ></span>
                }
              </div>

              <span [class]="badgeClass(lane.actual)">{{ badgeLabel(lane.actual) }}</span>
            </div>
          }
        </div>

        <div
          class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2"
        >
          <div
            class="flex flex-wrap items-center gap-3 text-caption-xs font-semibold text-slate-500"
          >
            <span class="flex items-center gap-1.5">
              <span class="h-3 w-4 rounded-sm bg-[var(--color-primary)]"></span> Activa
            </span>
            <span class="flex items-center gap-1.5">
              <span class="h-3 w-4 rounded-sm bg-slate-200"></span> Inactiva
            </span>
            <span class="flex items-center gap-1.5">
              <span class="h-3 w-4 rounded-sm bg-amber-100"></span> Sin lectura
            </span>
          </div>
          <div class="flex gap-4 text-caption-xs font-semibold tabular-nums text-slate-400">
            <span>{{ ejeInicio() }}</span>
            <span>{{ ejeFin() }}</span>
          </div>
        </div>
      </section>
    }
  `,
})
export class SiteDigitalSignalsTimelineComponent implements OnChanges {
  @Input() siteId = '';

  readonly ventanas = VENTANAS;

  private api = inject(CompanyService);

  loading = signal(false);
  errorMsg = signal('');
  ventana = signal<VentanaId>('24h');
  rows = signal<SiteDashboardHistoryEntry[]>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['siteId'] && this.siteId) this.load();
  }

  setVentana(id: VentanaId): void {
    if (this.ventana() === id) return;
    this.ventana.set(id);
    this.load();
  }

  load(): void {
    if (!this.siteId) return;
    const config = this.ventanaConfig();

    this.loading.set(true);
    this.errorMsg.set('');
    this.api
      .getSiteDashboardHistory(this.siteId, config.limit, { granularity: config.granularity })
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.rows.set(res.ok ? (res.data?.rows ?? []) : []);
        },
        error: () => {
          this.loading.set(false);
          this.rows.set([]);
          this.errorMsg.set('No se pudieron cargar las señales digitales.');
        },
      });
  }

  /**
   * Convierte las filas (una por bucket, en orden descendente) en una banda por
   * señal. Los tramos contiguos con el mismo estado se fusionan: 1440 buckets
   * de un día se vuelven un puñado de `<span>`, no 1440 por señal.
   */
  lanes = computed<Lane[]>(() => {
    const puntos = this.puntos();
    if (puntos.length < 2) return [];

    const inicio = puntos[0]!.t;
    const fin = puntos[puntos.length - 1]!.t;
    const span = fin - inicio;
    if (span <= 0) return [];

    const señales = this.señales(puntos);

    return señales.map(({ key, alias, bit }) => {
      const tramos: Tramo[] = [];
      let activaciones = 0;
      let previo: Tramo['estado'] | null = null;

      for (let i = 0; i < puntos.length; i += 1) {
        const punto = puntos[i]!;
        const estado = this.estadoDe(punto.digitales[key]);
        const hasta = puntos[i + 1]?.t ?? fin;

        if (previo === 'inactivo' && estado === 'activo') activaciones += 1;
        previo = estado;

        const ultimo = tramos[tramos.length - 1];
        if (ultimo && ultimo.estado === estado) {
          ultimo.hasta = hasta;
          ultimo.width = ((hasta - ultimo.desde) / span) * 100;
          continue;
        }
        tramos.push({
          estado,
          desde: punto.t,
          hasta,
          left: ((punto.t - inicio) / span) * 100,
          width: ((hasta - punto.t) / span) * 100,
        });
      }

      return {
        key,
        alias,
        bit,
        tramos,
        actual: this.estadoDe(puntos[puntos.length - 1]!.digitales[key]),
        activaciones,
      };
    });
  });

  rangoLabel(): string {
    const config = this.ventanaConfig();
    return config.horas >= 24 ? `últimas ${config.horas / 24} d` : `últimas ${config.horas} h`;
  }

  ejeInicio(): string {
    return this.formatEje(this.puntos()[0]?.t);
  }

  ejeFin(): string {
    const puntos = this.puntos();
    return this.formatEje(puntos[puntos.length - 1]?.t);
  }

  ventanaClass(id: VentanaId): string {
    const base = 'rounded-md px-2.5 py-1 text-caption font-bold transition-colors';
    return this.ventana() === id
      ? `${base} bg-primary-tint-14 text-primary-container`
      : `${base} text-slate-500 hover:bg-slate-50`;
  }

  tramoClass(tramo: Tramo): string {
    if (tramo.estado === 'activo') return 'bg-[var(--color-primary)]';
    // Sin lectura no es lo mismo que apagado: se distingue en ámbar para que
    // un hueco de transmisión no se lea como "la bomba estuvo detenida".
    if (tramo.estado === 'sin_dato') return 'bg-amber-100';
    return 'bg-slate-200';
  }

  tramoTitle(lane: Lane, tramo: Tramo): string {
    const estado =
      tramo.estado === 'activo'
        ? 'Activa'
        : tramo.estado === 'sin_dato'
          ? 'Sin lectura'
          : 'Inactiva';
    return `${lane.alias} · ${estado} · ${this.formatEje(tramo.desde)} → ${this.formatEje(tramo.hasta)}`;
  }

  badgeClass(estado: Tramo['estado']): string {
    const base =
      'rounded-md px-2 py-1 text-center text-caption-xs font-bold uppercase tracking-[0.08em]';
    if (estado === 'activo') return `${base} bg-primary-tint-14 text-primary-container`;
    if (estado === 'sin_dato') return `${base} bg-amber-50 text-amber-700`;
    return `${base} bg-slate-100 text-slate-500`;
  }

  badgeLabel(estado: Tramo['estado']): string {
    if (estado === 'activo') return 'Activa';
    if (estado === 'sin_dato') return 'Sin dato';
    return 'Inactiva';
  }

  // ─── Privados ─────────────────────────────────────────────────────────

  private ventanaConfig() {
    return VENTANAS.find((item) => item.id === this.ventana()) ?? VENTANAS[1];
  }

  /** Las filas en orden ascendente y sin las que no tienen timestamp usable. */
  private puntos = computed(() => {
    const out: { t: number; digitales: Record<string, SiteDashboardHistoryDigital> }[] = [];
    for (const row of this.rows()) {
      const t = Date.parse(String(row.timestamp ?? row.fecha ?? ''));
      if (!Number.isFinite(t)) continue;
      out.push({ t, digitales: row.digitales ?? {} });
    }
    return out.sort((a, b) => a.t - b.t);
  });

  /**
   * El catálogo de señales sale de los datos, no de una consulta aparte: cada
   * fila trae alias y bit de cada una. Se recorren todos los puntos porque una
   * señal recién configurada puede faltar en los buckets más viejos.
   */
  private señales(puntos: { digitales: Record<string, SiteDashboardHistoryDigital> }[]) {
    const vistas = new Map<string, { key: string; alias: string; bit: number }>();
    for (const punto of puntos) {
      for (const [key, señal] of Object.entries(punto.digitales)) {
        if (vistas.has(key)) continue;
        vistas.set(key, { key, alias: señal.alias || key, bit: señal.bit ?? 0 });
      }
    }
    return [...vistas.values()].sort((a, b) => a.bit - b.bit);
  }

  private estadoDe(señal: SiteDashboardHistoryDigital | undefined): Tramo['estado'] {
    if (!señal || señal.ok === false || señal.valor === null) return 'sin_dato';
    return señal.valor === 1 ? 'activo' : 'inactivo';
  }

  private formatEje(t: number | undefined): string {
    if (t === undefined) return '';
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Santiago',
    }).format(new Date(t));
  }
}
