import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  HealthDigestService,
  type DigestDestinatario,
  type DigestMeta,
  type UmbralEvento,
} from '../../../services/health-digest.service';
import { UserService } from '../../../services/user.service';
import { ToastService } from '../../../services/toast.service';

interface CandidatoEquipo {
  email: string;
  nombre: string;
}

function clonar(rows: DigestDestinatario[]): DigestDestinatario[] {
  return rows.map((r) => ({ ...r }));
}

/**
 * Sección "Alertas por correo" de /administration (solo SuperAdmin).
 *
 * Administra los destinatarios del monitoreo interno (worker `healthDigest`):
 * el resumen diario 07:00/16:00 y los correos inmediatos cuando un sitio
 * escala de tier (3 h → 6 h → 12 h+). Antes era un único buzón fijo en la env
 * `MONITOR_PRIMARY_EMAIL`; ahora es la tabla `health_digest_destinatario`.
 *
 * El guardado es un PUT del set completo: se editan varias filas y se confirma
 * una vez, así la lista nunca queda a medias. Sin nadie suscrito al resumen, el
 * backend cae al buzón de respaldo — la UI lo advierte.
 */
@Component({
  selector: 'app-alertas-correo-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    @if (error()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-body-sm text-red-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>
        <span>{{ error() }}</span>
      </div>
    }

    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-caption text-slate-500">
          Quién recibe el monitoreo interno: el resumen de sitios sin transmitir y reportes DGA
          atrasados, y los avisos inmediatos cuando una instalación se queda muda.
        </p>
        <p class="mt-1 text-caption-xs text-slate-400">
          Resumen a las {{ horariosTexto() }} (hora de Chile). Escalación en tres niveles: 3 h, 6 h
          y 12 h sin reportar.
        </p>
      </div>
      <button
        type="button"
        (click)="recargar()"
        [disabled]="loading() || saving()"
        class="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-caption font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 disabled:opacity-50"
      >
        <span class="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
        Recargar
      </button>
    </header>

    @if (!meta().worker_activo && !loading()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">pause_circle</span>
        <span>
          El worker de monitoreo está apagado en este servidor (<code
            class="font-mono text-caption-xs"
            >ENABLE_HEALTH_DIGEST_WORKER</code
          >), así que no se enviará nada hasta activarlo. La configuración se guarda igual.
        </span>
      </div>
    }

    @if (sinResumen() && !loading()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">warning</span>
        <span>
          Nadie está suscrito al resumen diario. Mientras siga así, el resumen se envía solo a
          <strong>{{ meta().fallback_email }}</strong> (buzón de respaldo).
        </span>
      </div>
    }

    @if (loading()) {
      <div class="animate-pulse space-y-2">
        @for (i of [1, 2, 3]; track i) {
          <div class="h-12 rounded-lg bg-slate-100"></div>
        }
      </div>
    } @else {
      <div class="overflow-x-auto rounded-lg border border-slate-200">
        <table class="min-w-full text-caption">
          <thead class="bg-surface-subtle">
            <tr>
              <th class="dga-table-header">Destinatario</th>
              <th class="dga-table-header">Resumen diario</th>
              <th class="dga-table-header">Escalaciones</th>
              <th class="dga-table-header">Desde</th>
              <th class="dga-table-header">Estado</th>
              <th class="dga-table-header"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            @for (d of filas(); track d.email) {
              <tr class="hover:bg-slate-50" [class.opacity-60]="!d.activo">
                <td class="px-4 py-2">
                  <p class="font-semibold text-slate-700">{{ d.nombre || '—' }}</p>
                  <p class="text-caption-xs text-slate-500">{{ d.email }}</p>
                </td>
                <td class="px-4 py-2">
                  <label class="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      [ngModel]="d.recibe_resumen"
                      (ngModelChange)="setCampo(d.email, 'recibe_resumen', $event)"
                      [name]="'resumen-' + d.email"
                      class="h-4 w-4 accent-primary"
                    />
                    <span class="text-caption-xs text-slate-500">07:00 y 16:00</span>
                  </label>
                </td>
                <td class="px-4 py-2">
                  <label class="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      [ngModel]="d.recibe_eventos"
                      (ngModelChange)="setCampo(d.email, 'recibe_eventos', $event)"
                      [name]="'eventos-' + d.email"
                      class="h-4 w-4 accent-primary"
                    />
                    <span class="text-caption-xs text-slate-500">Aviso inmediato</span>
                  </label>
                </td>
                <td class="px-4 py-2">
                  <select
                    [ngModel]="d.umbral_evento"
                    (ngModelChange)="setUmbral(d.email, $event)"
                    [name]="'umbral-' + d.email"
                    [disabled]="!d.recibe_eventos"
                    [title]="
                      d.recibe_eventos
                        ? 'Tier mínimo para recibir el aviso inmediato'
                        : 'Solo aplica con escalaciones activadas'
                    "
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-caption-xs outline-none focus:border-primary-tint-35 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="t3">Desde 3 h</option>
                    <option value="t6">Desde 6 h</option>
                    <option value="t12">Solo 12 h+</option>
                  </select>
                </td>
                <td class="px-4 py-2">
                  @if (d.activo) {
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-caption-xs font-semibold text-emerald-700"
                    >
                      <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                      Recibiendo
                    </span>
                  } @else {
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-caption-xs font-semibold text-slate-500"
                    >
                      <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                      En pausa
                    </span>
                  }
                </td>
                <td class="px-4 py-2">
                  <div class="flex justify-end gap-1">
                    <button
                      type="button"
                      (click)="enviarPrueba(d)"
                      [disabled]="enviandoPrueba() === d.email || dirty()"
                      [attr.aria-label]="'Enviar correo de prueba a ' + d.email"
                      [title]="
                        dirty()
                          ? 'Guarda los cambios antes de enviar una prueba'
                          : 'Enviar resumen de prueba ahora'
                      "
                      class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-primary-tint-08 hover:text-primary-container active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{
                        enviandoPrueba() === d.email ? 'hourglass_top' : 'outgoing_mail'
                      }}</span>
                    </button>
                    <button
                      type="button"
                      (click)="toggleActivo(d.email)"
                      [attr.aria-label]="(d.activo ? 'Pausar' : 'Reactivar') + ' ' + d.email"
                      [title]="d.activo ? 'Pausar envíos' : 'Reactivar envíos'"
                      class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary-container active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{
                        d.activo ? 'notifications_off' : 'notifications_active'
                      }}</span>
                    </button>
                    <button
                      type="button"
                      (click)="quitar(d.email)"
                      [attr.aria-label]="'Quitar ' + d.email"
                      title="Quitar de la lista"
                      class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                        >delete</span
                      >
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="px-4 py-6 text-center text-caption italic text-slate-500">
                  Sin destinatarios configurados. El monitoreo se enviará solo a
                  {{ meta().fallback_email }}.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4">
        <p class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
          Agregar destinatario
        </p>

        @if (candidatos().length > 0) {
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-caption-xs text-slate-500">Del equipo Emeltec:</span>
            @for (c of candidatos(); track c.email) {
              <button
                type="button"
                (click)="agregarCandidato(c)"
                class="inline-flex items-center gap-1 rounded-full border border-primary-tint-25 bg-primary-tint-08 px-2 py-0.5 text-caption-xs font-semibold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
              >
                <span class="material-symbols-outlined text-[13px]" aria-hidden="true">add</span>
                {{ c.nombre }}
              </button>
            }
          </div>
        }

        <form (ngSubmit)="agregarManual()" class="flex flex-wrap items-end gap-2">
          <label class="block min-w-[220px] flex-1">
            <span class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
              >Correo *</span
            >
            <input
              type="email"
              required
              [(ngModel)]="nuevoEmail"
              name="nuevo-email"
              placeholder="persona@empresa.cl"
              class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
            />
          </label>
          <label class="block min-w-[180px] flex-1">
            <span class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
              >Nombre</span
            >
            <input
              type="text"
              [(ngModel)]="nuevoNombre"
              name="nuevo-nombre"
              placeholder="Para identificarlo en esta lista"
              class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
            />
          </label>
          <button
            type="submit"
            [disabled]="!emailValido(nuevoEmail) || sinCupo()"
            [title]="sinCupo() ? 'Máximo ' + meta().max_destinatarios + ' destinatarios' : ''"
            class="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary-tint-25 bg-primary-tint-08 px-3 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95 disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">person_add</span>
            Agregar
          </button>
        </form>

        <p class="text-caption-xs text-slate-400">
          Guardar una dirección nueva pide tu código 2FA. Pausar, quitar o cambiar el umbral de
          direcciones ya autorizadas, no.
        </p>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-caption-xs text-slate-400">
          @if (dirty()) {
            Cambios sin guardar.
          } @else {
            {{ resumenActivos() }}
          }
        </span>
        <div class="flex gap-2">
          <button
            type="button"
            (click)="descartar()"
            [disabled]="!dirty() || saving()"
            class="rounded-md bg-slate-100 px-3 py-1.5 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-95 disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            type="button"
            (click)="guardar()"
            [disabled]="!dirty() || saving()"
            class="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>
            {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class AlertasCorreoSectionComponent {
  private service = inject(HealthDigestService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly enviandoPrueba = signal<string | null>(null);

  /** Lista editable en pantalla. */
  readonly filas = signal<DigestDestinatario[]>([]);
  /** Última lista confirmada por el backend, para detectar cambios. */
  private readonly original = signal<DigestDestinatario[]>([]);
  readonly meta = signal<DigestMeta>({
    horarios_resumen: [7, 16],
    zona_horaria: 'America/Santiago',
    fallback_email: '',
    worker_activo: false,
    max_destinatarios: 25,
  });
  /** Miembros del equipo interno que aún no están en la lista. */
  private readonly equipo = signal<CandidatoEquipo[]>([]);

  nuevoEmail = '';
  nuevoNombre = '';

  readonly dirty = computed(() => JSON.stringify(this.filas()) !== JSON.stringify(this.original()));

  readonly sinResumen = computed(
    () => this.filas().filter((d) => d.activo && d.recibe_resumen).length === 0,
  );

  readonly sinCupo = computed(() => this.filas().length >= this.meta().max_destinatarios);

  readonly horariosTexto = computed(() =>
    this.meta()
      .horarios_resumen.map((h) => `${String(h).padStart(2, '0')}:00`)
      .join(' y '),
  );

  readonly candidatos = computed(() => {
    const yaEstan = new Set(this.filas().map((d) => d.email));
    return this.equipo().filter((c) => !yaEstan.has(c.email));
  });

  constructor() {
    this.recargar();
    this.cargarEquipo();
  }

  recargar(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.list().subscribe({
      next: (res) => {
        this.filas.set(clonar(res.data ?? []));
        this.original.set(clonar(res.data ?? []));
        if (res.meta) this.meta.set(res.meta);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err?.error?.error?.message || 'No se pudo cargar la lista de destinatarios.',
        );
      },
    });
  }

  private cargarEquipo(): void {
    // Best-effort: el quick-pick es una comodidad, no un requisito.
    this.userService.getEquipoEmeltec().subscribe({
      next: (res) => {
        if (!res.ok) return;
        this.equipo.set(
          (res.data.miembros ?? [])
            .filter((m) => m.activo && !!m.email)
            .map((m) => ({
              email: m.email.trim().toLowerCase(),
              nombre: `${m.nombre} ${m.apellido}`.trim(),
            })),
        );
      },
      error: () => this.equipo.set([]),
    });
  }

  emailValido(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  }

  setCampo(email: string, campo: 'recibe_resumen' | 'recibe_eventos', valor: boolean): void {
    this.filas.update((rows) =>
      rows.map((r) => (r.email === email ? { ...r, [campo]: valor } : r)),
    );
  }

  setUmbral(email: string, umbral: UmbralEvento): void {
    this.filas.update((rows) =>
      rows.map((r) => (r.email === email ? { ...r, umbral_evento: umbral } : r)),
    );
  }

  toggleActivo(email: string): void {
    this.filas.update((rows) =>
      rows.map((r) => (r.email === email ? { ...r, activo: !r.activo } : r)),
    );
  }

  quitar(email: string): void {
    this.filas.update((rows) => rows.filter((r) => r.email !== email));
  }

  agregarCandidato(c: CandidatoEquipo): void {
    this.agregar(c.email, c.nombre);
  }

  agregarManual(): void {
    if (!this.emailValido(this.nuevoEmail)) return;
    this.agregar(this.nuevoEmail, this.nuevoNombre);
    this.nuevoEmail = '';
    this.nuevoNombre = '';
  }

  private agregar(email: string, nombre: string): void {
    const normalizado = email.trim().toLowerCase();
    if (this.filas().some((r) => r.email === normalizado)) {
      this.toast.info(`${normalizado} ya está en la lista.`);
      return;
    }
    if (this.sinCupo()) {
      this.toast.error(`Máximo ${this.meta().max_destinatarios} destinatarios.`);
      return;
    }
    this.filas.update((rows) => [
      ...rows,
      {
        email: normalizado,
        nombre: nombre.trim() || null,
        recibe_resumen: true,
        recibe_eventos: true,
        umbral_evento: 't3',
        activo: true,
        updated_at: null,
      },
    ]);
  }

  descartar(): void {
    this.filas.set(clonar(this.original()));
    this.error.set('');
  }

  guardar(): void {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.service.save(this.filas()).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.filas.set(clonar(res.data ?? []));
        this.original.set(clonar(res.data ?? []));
        this.toast.success('Destinatarios actualizados satisfactoriamente.');
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.error?.message || 'No se pudieron guardar los destinatarios.');
      },
    });
  }

  enviarPrueba(d: DigestDestinatario): void {
    if (this.enviandoPrueba()) return;
    this.enviandoPrueba.set(d.email);
    this.service.enviarPrueba(d.email).subscribe({
      next: (res) => {
        this.enviandoPrueba.set(null);
        const total = (res.data?.incidencias_data ?? 0) + (res.data?.incidencias_dga ?? 0);
        this.toast.success(
          total === 0
            ? `Resumen de prueba enviado a ${d.email} (sin incidencias).`
            : `Resumen de prueba enviado a ${d.email} con ${total} incidencia(s).`,
        );
      },
      error: (err) => {
        this.enviandoPrueba.set(null);
        this.error.set(err?.error?.error?.message || 'No se pudo enviar el correo de prueba.');
      },
    });
  }

  resumenActivos(): string {
    const rows = this.filas().filter((d) => d.activo);
    const resumen = rows.filter((d) => d.recibe_resumen).length;
    const eventos = rows.filter((d) => d.recibe_eventos).length;
    return `${resumen} en el resumen diario · ${eventos} en escalaciones.`;
  }
}
