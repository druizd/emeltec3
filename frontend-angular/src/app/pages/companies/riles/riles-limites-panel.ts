import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RilesLimite, RilesNorma, RilesParametro, RilesTipoLimite } from '@emeltec/shared';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';
import { SkeletonComponent } from '../../../components/ui/skeleton';

const NORMA_LABEL: Record<RilesNorma, string> = {
  ds90: 'DS 90 — cauce superficial',
  ds46: 'DS 46 — infiltración',
  ds609: 'DS 609 — alcantarillado',
  rca: 'RCA — resolución del proyecto',
};

/**
 * Los límites del sitio: qué puede contener el efluente según la norma que lo
 * rige, y desde cuándo.
 *
 * Igual que las fuentes del balance, un límite no se edita ni se borra: se
 * cierra su vigencia y se declara otro. La muestra de marzo tiene que seguir
 * leyéndose contra el límite que regía en marzo, o los veredictos ya emitidos
 * cambiarían solos.
 */
@Component({
  selector: 'app-riles-limites-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SkeletonComponent],
  template: `
    <section class="space-y-4 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <p
            class="text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            style="font-family: var(--font-josefin);"
          >
            Límites de calidad
          </p>
          <p class="text-body-sm font-semibold text-slate-500">
            Contra qué se compara cada parámetro del laboratorio. Dar de baja cierra la vigencia; no
            borra el límite.
          </p>
        </div>
        @if (puedeEditar()) {
          <button
            type="button"
            (click)="toggleFormulario()"
            class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-body-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95"
          >
            <span class="material-symbols-outlined">{{
              mostrarFormulario() ? 'close' : 'add'
            }}</span>
            {{ mostrarFormulario() ? 'Cancelar' : 'Agregar límite' }}
          </button>
        }
      </div>

      @if (mostrarFormulario()) {
        <form
          (ngSubmit)="guardar()"
          class="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-3 md:grid-cols-2 xl:grid-cols-4"
        >
          <label class="block">
            <span [class]="labelClass">Parámetro</span>
            <select
              [ngModel]="form.parametro"
              (ngModelChange)="setParametro($event)"
              name="parametro"
              [class]="inputClass"
            >
              <option value="">Elegir…</option>
              @for (p of parametros(); track p.codigo) {
                <option [value]="p.codigo">{{ p.nombre }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span [class]="labelClass">Norma</span>
            <select [(ngModel)]="form.norma" name="norma" [class]="inputClass">
              @for (n of normas; track n.id) {
                <option [value]="n.id">{{ n.label }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span [class]="labelClass">Tipo</span>
            <select [(ngModel)]="form.tipo" name="tipo" [class]="inputClass">
              <option value="concentracion">Concentración</option>
              <option value="carga">Carga (kg)</option>
            </select>
          </label>

          <label class="block">
            <span [class]="labelClass">Unidad</span>
            <input
              type="text"
              [(ngModel)]="form.unidad"
              name="unidad"
              maxlength="20"
              [class]="inputClass"
            />
          </label>

          <label class="block">
            <span [class]="labelClass">Mínimo (opcional)</span>
            <input
              type="number"
              step="any"
              min="0"
              [(ngModel)]="form.limite_min"
              name="min"
              placeholder="sólo pH y temperatura"
              [class]="inputClass"
            />
          </label>

          <label class="block">
            <span [class]="labelClass">Máximo</span>
            <input
              type="number"
              step="any"
              min="0"
              [(ngModel)]="form.limite_max"
              name="max"
              [class]="inputClass"
            />
          </label>

          <label class="block">
            <span [class]="labelClass">Vigente desde</span>
            <input
              type="date"
              [(ngModel)]="form.vigencia_desde"
              name="desde"
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

          @if (formError(); as mensaje) {
            <p class="text-body-sm font-semibold text-rose-700 md:col-span-2 xl:col-span-4">
              {{ mensaje }}
            </p>
          }

          <div class="flex justify-end md:col-span-2 xl:col-span-4">
            <button
              type="submit"
              [disabled]="guardando()"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {{ guardando() ? 'Guardando…' : 'Guardar límite' }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <app-skeleton class="h-40 w-full rounded-lg" />
      } @else if (error(); as mensaje) {
        <p class="text-body-sm font-semibold text-rose-700">{{ mensaje }}</p>
      } @else if (limites().length === 0) {
        <p
          class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-body-sm font-semibold text-slate-500"
        >
          Sin límites declarados. Mientras no haya ninguno, los resultados del laboratorio se
          muestran pero no se comparan contra nada.
        </p>
      } @else {
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-100">
            <thead>
              <tr>
                <th [class]="thClass">Parámetro</th>
                <th [class]="thClass">Norma</th>
                <th [class]="thClass">Tipo</th>
                <th [class]="thClass + ' text-right'">Rango</th>
                <th [class]="thClass">Unidad</th>
                <th [class]="thClass">Vigencia</th>
                <th [class]="thClass"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (l of limites(); track l.id) {
                <tr [class]="l.vigencia_hasta ? 'opacity-60' : ''">
                  <td class="px-4 py-2 text-body-sm font-semibold text-slate-800">
                    {{ l.parametro_nombre || l.parametro }}
                  </td>
                  <td class="px-4 py-2 text-body-sm font-semibold text-slate-600">
                    {{ normaCorta(l.norma) }}
                  </td>
                  <td class="px-4 py-2 text-body-sm font-semibold text-slate-600">
                    {{ l.tipo === 'carga' ? 'Carga' : 'Concentración' }}
                  </td>
                  <td [class]="numeroClass">{{ rango(l) }}</td>
                  <td class="px-4 py-2 text-body-sm font-semibold text-slate-500">
                    {{ l.unidad }}
                  </td>
                  <td class="px-4 py-2 text-body-sm font-semibold text-slate-600">
                    {{ fecha(l.vigencia_desde) }}
                    @if (l.vigencia_hasta) {
                      → {{ fecha(l.vigencia_hasta) }}
                    } @else {
                      <span class="ml-1 text-caption font-bold text-emerald-600">vigente</span>
                    }
                  </td>
                  <td class="px-4 py-2 text-right">
                    @if (puedeEditar() && !l.vigencia_hasta) {
                      <button
                        type="button"
                        (click)="cerrar(l)"
                        class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-50"
                      >
                        Dar de baja
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class RilesLimitesPanelComponent implements OnInit {
  private companyService = inject(CompanyService);
  private auth = inject(AuthService);

  @Input({ required: true }) siteId = '';

  /** Mismo conjunto que RILES_ADMIN_ROLES en companyRoutes. */
  readonly puedeEditar = computed(
    () => this.auth.isSuperAdmin() || this.auth.isAdmin() || this.auth.isGerente(),
  );

  /**
   * Norma del sitio, para proponerla al agregar un límite. Se pide acá en vez
   * de recibirla del padre: proponer `ds609` a un sitio que descarga a cauce
   * dejaría el límite bajo la norma equivocada si nadie mira el selector.
   */
  private readonly normaSitio = signal<RilesNorma | null>(null);

  readonly limites = signal<RilesLimite[]>([]);
  readonly parametros = signal<RilesParametro[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly mostrarFormulario = signal(false);
  readonly guardando = signal(false);
  readonly formError = signal<string | null>(null);

  form = this.formVacio();

  readonly normas = computed(() =>
    (Object.keys(NORMA_LABEL) as RilesNorma[]).map((id) => ({ id, label: NORMA_LABEL[id] })),
  )();

  readonly thClass =
    'px-4 py-2 text-left text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400';
  readonly numeroClass =
    'px-4 py-2 text-right text-body-sm font-semibold text-slate-800 tabular-nums';
  readonly labelClass =
    'mb-1 block text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400';
  readonly inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-body-sm font-semibold text-slate-800 focus:border-emerald-400 focus:outline-none';

  ngOnInit(): void {
    this.cargar();
    this.companyService.getRilesConfig(this.siteId).subscribe({
      next: (res) => {
        if (res.ok) this.normaSitio.set(res.data.norma);
      },
    });
  }

  cargar(): void {
    const siteId = this.siteId;
    if (!siteId) return;
    this.loading.set(true);
    this.error.set(null);
    this.companyService.getRilesLimites(siteId).subscribe({
      next: (res) => {
        if (res.ok) this.limites.set(res.data);
        else this.error.set('No se pudieron cargar los límites.');
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los límites.');
        this.loading.set(false);
      },
    });
  }

  toggleFormulario(): void {
    const abriendo = !this.mostrarFormulario();
    this.mostrarFormulario.set(abriendo);
    this.formError.set(null);
    if (abriendo) {
      this.form = this.formVacio();
      if (this.parametros().length === 0) {
        this.companyService.getRilesParametros(this.siteId).subscribe({
          next: (res) => {
            if (res.ok) this.parametros.set(res.data);
          },
        });
      }
    }
  }

  /** Al elegir parámetro se propone su unidad canónica. */
  setParametro(codigo: string): void {
    const unidad = this.parametros().find((p) => p.codigo === codigo)?.unidad ?? '';
    this.form = { ...this.form, parametro: codigo, unidad: this.form.unidad || unidad };
  }

  guardar(): void {
    const min = this.form.limite_min === '' ? null : Number(this.form.limite_min);
    const max = this.form.limite_max === '' ? null : Number(this.form.limite_max);

    if (!this.form.parametro) {
      this.formError.set('Falta el parámetro.');
      return;
    }
    if (!this.form.vigencia_desde) {
      this.formError.set('Falta desde cuándo rige.');
      return;
    }
    if (min === null && max === null) {
      this.formError.set('Un límite sin piso ni techo no limita nada.');
      return;
    }
    if (min !== null && max !== null && max < min) {
      this.formError.set('El techo del límite es menor que su piso.');
      return;
    }

    this.guardando.set(true);
    this.formError.set(null);
    this.companyService
      .createRilesLimite(this.siteId, {
        parametro: this.form.parametro,
        norma: this.form.norma,
        tipo: this.form.tipo,
        limite_min: min,
        limite_max: max,
        unidad: this.form.unidad,
        vigencia_desde: this.form.vigencia_desde,
        nota: this.form.nota || null,
      })
      .subscribe({
        next: (res) => {
          this.guardando.set(false);
          if (!res.ok) {
            this.formError.set('No se pudo guardar el límite.');
            return;
          }
          this.mostrarFormulario.set(false);
          this.cargar();
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.guardando.set(false);
          this.formError.set(err?.error?.error?.message ?? 'No se pudo guardar el límite.');
        },
      });
  }

  cerrar(limite: RilesLimite): void {
    this.companyService.cerrarRilesLimite(this.siteId, limite.id).subscribe({
      next: () => this.cargar(),
      error: () => this.error.set('No se pudo dar de baja el límite.'),
    });
  }

  // ── Presentación ───────────────────────────────────────────────────────────

  normaCorta(norma: RilesNorma): string {
    return (NORMA_LABEL[norma] ?? norma).split('—')[0]!.trim();
  }

  rango(l: RilesLimite): string {
    if (l.limite_min !== null && l.limite_max !== null) {
      return `${this.numero(l.limite_min)} – ${this.numero(l.limite_max)}`;
    }
    if (l.limite_max !== null) return `≤ ${this.numero(l.limite_max)}`;
    if (l.limite_min !== null) return `≥ ${this.numero(l.limite_min)}`;
    return '—';
  }

  fecha(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  numero(valor: number): string {
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 }).format(valor);
  }

  private formVacio(): {
    parametro: string;
    norma: RilesNorma;
    tipo: RilesTipoLimite;
    limite_min: string;
    limite_max: string;
    unidad: string;
    vigencia_desde: string;
    nota: string;
  } {
    return {
      parametro: '',
      norma: this.normaSitio() ?? 'ds609',
      tipo: 'concentracion',
      limite_min: '',
      limite_max: '',
      unidad: '',
      vigencia_desde: '',
      nota: '',
    };
  }
}
