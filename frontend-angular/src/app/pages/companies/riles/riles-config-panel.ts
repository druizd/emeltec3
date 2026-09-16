import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  RilesConfig,
  RilesDireccion,
  RilesFuente,
  RilesModoCaudal,
  RilesNorma,
  SiteRecord,
} from '@emeltec/shared';
import { CompanyService } from '../../../services/company.service';

interface OpcionModo {
  id: RilesModoCaudal;
  label: string;
  detalle: string;
}

const MODOS: OpcionModo[] = [
  {
    id: 'propio',
    label: 'Medidor propio',
    detalle: 'El sitio tiene caudalímetro en la descarga. El volumen de salida es el suyo.',
  },
  {
    id: 'derivado',
    label: 'Derivado de las fuentes',
    detalle:
      'No hay medidor: la descarga se estima aplicando el coeficiente al agua de entrada. Los períodos quedan marcados como estimados.',
  },
  {
    id: 'mixto',
    label: 'Mixto',
    detalle:
      'Usa el medidor propio cuando hay lecturas y cae al coeficiente cuando no. Útil si el medidor se instaló a mitad del histórico.',
  },
];

const NORMAS: { id: RilesNorma; label: string }[] = [
  { id: 'ds609', label: 'DS 609 — alcantarillado' },
  { id: 'ds90', label: 'DS 90 — cuerpo de agua' },
  { id: 'ds46', label: 'DS 46 — infiltración' },
  { id: 'rca', label: 'RCA propia' },
];

/**
 * Configuración del sitio RILes y sus fuentes.
 *
 * Dar de baja una fuente cierra su vigencia — no borra la fila —, así que el
 * balance que el cliente ya vio sigue dando lo mismo.
 */
@Component({
  selector: 'app-riles-config-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-5">
      <!-- ── Config del sitio ────────────────────────────────────────────── -->
      <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header class="border-b border-slate-100 px-5 py-4">
          <h2 class="text-h6 font-semibold text-slate-900">Cómo se calcula la descarga</h2>
          <p class="text-body-sm font-semibold text-slate-500">
            De dónde sale el volumen de salida y contra qué norma se compara.
          </p>
        </header>

        <div class="space-y-5 px-5 py-5">
          <fieldset class="space-y-2">
            <legend
              class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              style="font-family: var(--font-josefin);"
            >
              Origen del caudal
            </legend>
            <div class="grid gap-2 lg:grid-cols-3">
              @for (modo of modos; track modo.id) {
                <button
                  type="button"
                  (click)="setModo(modo.id)"
                  [class]="modoClass(modo.id)"
                  [attr.aria-pressed]="form().modo_caudal === modo.id"
                >
                  <span class="block text-body font-semibold">{{ modo.label }}</span>
                  <span class="mt-1 block text-caption font-semibold leading-4 text-slate-500">
                    {{ modo.detalle }}
                  </span>
                </button>
              }
            </div>
          </fieldset>

          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label class="block">
              <span [class]="labelClass">Coef. descarga esperado [%]</span>
              <input
                type="number"
                min="0"
                max="500"
                step="0.1"
                [ngModel]="form().coef_descarga_esperado_pct"
                (ngModelChange)="patch({ coef_descarga_esperado_pct: numeroONull($event) })"
                [class]="inputClass"
                placeholder="ej. 80"
              />
              <span class="mt-1 block text-caption font-semibold text-slate-400">
                Qué porcentaje del agua de entrada se espera ver descargada.
              </span>
            </label>

            <label class="block">
              <span [class]="labelClass">Tolerancia [puntos %]</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                [ngModel]="form().coef_tolerancia_pct"
                (ngModelChange)="patch({ coef_tolerancia_pct: numeroONull($event) ?? 0 })"
                [class]="inputClass"
              />
              <span class="mt-1 block text-caption font-semibold text-slate-400">
                Ancho de la banda alrededor del coeficiente esperado.
              </span>
            </label>

            <label class="block">
              <span [class]="labelClass">Norma</span>
              <select
                [ngModel]="form().norma"
                (ngModelChange)="patch({ norma: $event || null })"
                [class]="inputClass"
              >
                <option [ngValue]="null">Sin definir</option>
                @for (norma of normas; track norma.id) {
                  <option [ngValue]="norma.id">{{ norma.label }}</option>
                }
              </select>
            </label>

            <label class="block">
              <span [class]="labelClass">Punto de descarga</span>
              <input
                type="text"
                maxlength="80"
                [ngModel]="form().punto_descarga"
                (ngModelChange)="patch({ punto_descarga: $event || null })"
                [class]="inputClass"
                placeholder="código o N° de resolución"
              />
            </label>

            <label class="block">
              <span [class]="labelClass">Caudal máx. autorizado [L/s]</span>
              <input
                type="number"
                min="0"
                step="0.01"
                [ngModel]="form().caudal_max_autorizado_lps"
                (ngModelChange)="patch({ caudal_max_autorizado_lps: numeroONull($event) })"
                [class]="inputClass"
              />
            </label>

            <label class="block">
              <span [class]="labelClass">Volumen máx. mensual [m3]</span>
              <input
                type="number"
                min="0"
                step="1"
                [ngModel]="form().volumen_max_mensual_m3"
                (ngModelChange)="patch({ volumen_max_mensual_m3: numeroONull($event) })"
                [class]="inputClass"
              />
            </label>
          </div>

          @if (avisoModo(); as aviso) {
            <p
              class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-caption font-semibold leading-5 text-amber-800"
            >
              <span class="material-symbols-outlined text-[18px]">info</span>
              <span>{{ aviso }}</span>
            </p>
          }

          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              (click)="guardarConfig()"
              [disabled]="guardando()"
              class="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-700 bg-cyan-700 px-4 text-body-sm font-semibold text-white transition-colors hover:bg-cyan-800 active:scale-[0.98] disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-[18px]">save</span>
              Guardar configuración
            </button>
            @if (mensajeConfig(); as mensaje) {
              <span [class]="mensajeClass(mensaje.tipo)">{{ mensaje.texto }}</span>
            }
          </div>
        </div>
      </section>

      <!-- ── Fuentes ─────────────────────────────────────────────────────── -->
      <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header class="border-b border-slate-100 px-5 py-4">
          <h2 class="text-h6 font-semibold text-slate-900">Sitios ligados</h2>
          <p class="text-body-sm font-semibold text-slate-500">
            De qué pozos —o de qué otros RILes— se alimenta el balance de este punto.
          </p>
        </header>

        <div class="px-5 py-5">
          @if (fuentes().length) {
            <ul class="space-y-2">
              @for (fuente of fuentes(); track fuente.id) {
                <li
                  class="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3"
                  [class]="
                    fuente.vigencia_hasta
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-slate-200 bg-white'
                  "
                >
                  <span class="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      class="material-symbols-outlined text-[18px]"
                      [class]="
                        fuente.direccion === 'entrada'
                          ? 'text-primary-container'
                          : 'text-emerald-600'
                      "
                    >
                      {{ fuente.direccion === 'entrada' ? 'south_east' : 'north_east' }}
                    </span>
                    <span class="truncate text-body-sm font-semibold text-slate-800">
                      {{ fuente.fuente_descripcion || fuente.fuente_sitio_id }}
                    </span>
                    <span class="text-caption font-semibold text-slate-400">
                      {{ fuente.fuente_sitio_id }} · {{ fuente.rol }}
                    </span>
                    @if (fuente.factor !== 1) {
                      <span
                        class="rounded-full bg-slate-100 px-2 py-[2px] text-caption font-bold text-slate-600"
                      >
                        ×{{ fuente.factor }}
                      </span>
                    }
                    <span class="text-caption font-semibold text-slate-500">
                      {{ fechaCorta(fuente.vigencia_desde) }} →
                      {{ fuente.vigencia_hasta ? fechaCorta(fuente.vigencia_hasta) : 'vigente' }}
                    </span>
                    @if (fuente.nota) {
                      <span class="text-caption font-semibold text-slate-400">{{
                        fuente.nota
                      }}</span>
                    }
                  </span>

                  @if (!fuente.vigencia_hasta) {
                    <button
                      type="button"
                      (click)="darDeBaja(fuente)"
                      class="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-caption font-bold text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[16px]">event_busy</span>
                      Dar de baja
                    </button>
                  } @else {
                    <span class="text-caption font-bold text-slate-400">Fuera de vigencia</span>
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="text-body-sm font-semibold text-slate-500">
              Todavía no hay sitios ligados. Sin al menos una entrada, el balance no tiene con qué
              comparar la descarga.
            </p>
          }

          <!-- Alta -->
          <div class="mt-5 rounded-lg border border-dashed border-slate-300 p-4">
            <p
              class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              style="font-family: var(--font-josefin);"
            >
              Ligar un sitio
            </p>

            @if (candidatos().length) {
              <div class="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label class="block">
                  <span [class]="labelClass">Sitio</span>
                  <select [(ngModel)]="nuevaFuenteSitioId" [class]="inputClass">
                    <option value="">Seleccionar…</option>
                    @for (sitio of candidatos(); track sitio.id) {
                      <option [value]="sitio.id">{{ sitio.descripcion }} ({{ sitio.id }})</option>
                    }
                  </select>
                </label>

                <label class="block">
                  <span [class]="labelClass">Dirección</span>
                  <select [(ngModel)]="nuevaDireccion" [class]="inputClass">
                    <option value="entrada">Entrada (agua que llega)</option>
                    <option value="salida">Salida (descarga aguas abajo)</option>
                  </select>
                </label>

                <label class="block">
                  <span [class]="labelClass">Factor de prorrateo</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.01"
                    [(ngModel)]="nuevoFactor"
                    [class]="inputClass"
                  />
                </label>

                <label class="block">
                  <span [class]="labelClass">Vigente desde</span>
                  <input type="date" [(ngModel)]="nuevaVigenciaDesde" [class]="inputClass" />
                </label>
              </div>

              <label class="mt-3 block">
                <span [class]="labelClass">Nota (opcional)</span>
                <input
                  type="text"
                  maxlength="500"
                  [(ngModel)]="nuevaNota"
                  [class]="inputClass"
                  placeholder="ej. abastece también la planta 2, por eso el 0,5"
                />
              </label>

              <div class="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  (click)="agregarFuente()"
                  [disabled]="!nuevaFuenteSitioId || !nuevaVigenciaDesde || agregando()"
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-600 bg-emerald-600 px-4 text-body-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
                >
                  <span class="material-symbols-outlined text-[18px]">add_link</span>
                  Ligar sitio
                </button>
                @if (mensajeFuente(); as mensaje) {
                  <span [class]="mensajeClass(mensaje.tipo)">{{ mensaje.texto }}</span>
                }
              </div>
            } @else {
              <p class="mt-2 text-body-sm font-semibold text-slate-500">
                No hay otros sitios en esta subempresa para ligar. Un sitio fuente tiene que
                pertenecer a la misma subempresa: ligar uno de otro cliente publicaría su volumen
                extraído en esta pantalla.
              </p>
            }
          </div>
        </div>
      </section>
    </div>
  `,
})
export class RilesConfigPanelComponent implements OnInit {
  private companyService = inject(CompanyService);

  @Input({ required: true }) siteId = '';
  /** Sitios de la misma subempresa. El backend igual valida el parentesco. */
  @Input() sitiosHermanos: SiteRecord[] = [];

  readonly modos = MODOS;
  readonly normas = NORMAS;

  readonly labelClass =
    'mb-1 block text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400';
  readonly inputClass =
    'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-body-sm font-semibold text-slate-800 outline-none transition-colors focus:border-primary';

  readonly form = signal<Omit<RilesConfig, 'sitio_id' | 'updated_at'>>({
    modo_caudal: 'propio',
    coef_descarga_esperado_pct: null,
    coef_tolerancia_pct: 15,
    norma: null,
    punto_descarga: null,
    caudal_max_autorizado_lps: null,
    volumen_max_mensual_m3: null,
  });
  readonly fuentes = signal<RilesFuente[]>([]);
  readonly guardando = signal(false);
  readonly agregando = signal(false);
  readonly mensajeConfig = signal<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  readonly mensajeFuente = signal<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  nuevaFuenteSitioId = '';
  nuevaDireccion: RilesDireccion = 'entrada';
  nuevoFactor = 1;
  nuevaVigenciaDesde = new Date().toISOString().slice(0, 10);
  nuevaNota = '';

  /** Los que se pueden ligar: hermanos que no sean este sitio ni ya estén ligados y vigentes. */
  readonly candidatos = computed<SiteRecord[]>(() => {
    const ligados = new Set(
      this.fuentes()
        .filter((f) => !f.vigencia_hasta)
        .map((f) => f.fuente_sitio_id),
    );
    return this.sitiosHermanos.filter((s) => s.id !== this.siteId && !ligados.has(s.id));
  });

  readonly avisoModo = computed<string | null>(() => {
    const { modo_caudal, coef_descarga_esperado_pct } = this.form();
    if (modo_caudal === 'derivado' && coef_descarga_esperado_pct === null) {
      return 'El modo derivado necesita un coeficiente de descarga esperado: es lo único con que estimar la salida.';
    }
    if (modo_caudal === 'derivado') {
      return 'En modo derivado el coeficiente que muestra el balance es el que se declara acá, no una medición. Los períodos van marcados como estimados.';
    }
    if (modo_caudal === 'mixto' && coef_descarga_esperado_pct === null) {
      return 'Sin coeficiente, el modo mixto se comporta igual que "medidor propio": los períodos sin lecturas quedan vacíos.';
    }
    return null;
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    if (!this.siteId) return;
    this.companyService.getRilesConfig(this.siteId).subscribe({
      next: (res) => {
        if (!res.ok) return;
        const { sitio_id: _sitioId, updated_at: _updatedAt, ...resto } = res.data;
        this.form.set(resto);
      },
      error: () => undefined,
    });
    this.recargarFuentes();
  }

  recargarFuentes(): void {
    this.companyService.getRilesFuentes(this.siteId).subscribe({
      next: (res) => {
        if (res.ok) this.fuentes.set(res.data || []);
      },
      error: () => undefined,
    });
  }

  patch(cambio: Partial<Omit<RilesConfig, 'sitio_id' | 'updated_at'>>): void {
    this.form.set({ ...this.form(), ...cambio });
    this.mensajeConfig.set(null);
  }

  setModo(modo: RilesModoCaudal): void {
    this.patch({ modo_caudal: modo });
  }

  guardarConfig(): void {
    this.guardando.set(true);
    this.mensajeConfig.set(null);
    this.companyService.updateRilesConfig(this.siteId, this.form()).subscribe({
      next: (res) => {
        this.guardando.set(false);
        if (res.ok) this.mensajeConfig.set({ tipo: 'ok', texto: 'Configuración guardada.' });
        else this.mensajeConfig.set({ tipo: 'error', texto: 'No se pudo guardar.' });
      },
      error: (err) => {
        this.guardando.set(false);
        this.mensajeConfig.set({ tipo: 'error', texto: this.mensajeDeError(err) });
      },
    });
  }

  agregarFuente(): void {
    if (!this.nuevaFuenteSitioId || !this.nuevaVigenciaDesde) return;
    this.agregando.set(true);
    this.mensajeFuente.set(null);
    this.companyService
      .createRilesFuente(this.siteId, {
        fuente_sitio_id: this.nuevaFuenteSitioId,
        direccion: this.nuevaDireccion,
        factor: Number(this.nuevoFactor) || 1,
        vigencia_desde: this.nuevaVigenciaDesde,
        nota: this.nuevaNota.trim() || null,
      })
      .subscribe({
        next: (res) => {
          this.agregando.set(false);
          if (!res.ok) {
            this.mensajeFuente.set({ tipo: 'error', texto: 'No se pudo ligar el sitio.' });
            return;
          }
          this.nuevaFuenteSitioId = '';
          this.nuevaNota = '';
          this.nuevoFactor = 1;
          this.mensajeFuente.set({ tipo: 'ok', texto: 'Sitio ligado.' });
          this.recargarFuentes();
        },
        error: (err) => {
          this.agregando.set(false);
          this.mensajeFuente.set({ tipo: 'error', texto: this.mensajeDeError(err) });
        },
      });
  }

  darDeBaja(fuente: RilesFuente): void {
    this.companyService.cerrarRilesFuente(this.siteId, fuente.id).subscribe({
      next: () => this.recargarFuentes(),
      error: (err) => this.mensajeFuente.set({ tipo: 'error', texto: this.mensajeDeError(err) }),
    });
  }

  modoClass(modo: RilesModoCaudal): string {
    const base = 'rounded-lg border px-3 py-3 text-left transition-colors active:scale-[0.99]';
    return this.form().modo_caudal === modo
      ? `${base} border-emerald-400 bg-emerald-50 text-emerald-900`
      : `${base} border-slate-200 bg-white text-slate-800 hover:border-emerald-200`;
  }

  mensajeClass(tipo: 'ok' | 'error'): string {
    return tipo === 'ok'
      ? 'text-caption font-bold text-emerald-700'
      : 'text-caption font-bold text-rose-700';
  }

  numeroONull(valor: unknown): number | null {
    if (valor === null || valor === undefined || valor === '') return null;
    const parsed = Number(valor);
    return Number.isFinite(parsed) ? parsed : null;
  }

  fechaCorta(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  /** El backend explica por qué rechazó; mostrarlo tal cual evita adivinar. */
  private mensajeDeError(err: unknown): string {
    const mensaje = (err as { error?: { error?: { message?: string } } })?.error?.error?.message;
    return mensaje || 'No se pudo completar la operación.';
  }
}
