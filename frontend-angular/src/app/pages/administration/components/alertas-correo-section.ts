import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  HealthDigestService,
  type DigestDestinatario,
  type DigestMeta,
} from '../../../services/health-digest.service';
import { UserService } from '../../../services/user.service';
import { ToastService } from '../../../services/toast.service';
import { CHILE_TIME_ZONE } from '../../../shared/timezone';

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
          Quién recibe el monitoreo interno y a qué hora: un correo con los equipos sin transmitir y
          los reportes DGA atrasados.
        </p>
        <p class="mt-1 text-caption-xs text-slate-400">
          Hora de Chile, con horario de verano. Los avisos inmediatos por instalación se retiraron:
          este resumen los reemplaza.
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
          >), así que <strong>el resumen no se enviará</strong> hasta activarlo. La configuración se
          guarda igual.
          @if (meta().worker_seguridad_activo) {
            Las alertas de seguridad no dependen de este worker y sí se están enviando.
          }
        </span>
      </div>
    }

    @if (sinResumen() && !loading()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">warning</span>
        <span>
          Nadie está suscrito al resumen. Mientras siga así, se envía solo a
          <strong>{{ meta().fallback_email }}</strong> (buzón de respaldo).
        </span>
      </div>
    }

    <!-- Programación del resumen. Antes vivía en variables de entorno de la VM:
         cambiar una hora obligaba a editar el .env y recrear el container. -->
    @if (!loading()) {
      <section class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <p class="mb-3 flex items-center gap-2 text-body-sm font-semibold text-slate-700">
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">schedule</span>
          Programación del resumen
        </p>
        <div class="flex flex-wrap items-end gap-5">
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Horas de envío</label
            >
            <div class="flex flex-wrap gap-1.5">
              @for (h of horasDelDia; track h) {
                <button
                  type="button"
                  (click)="toggleHora(h)"
                  [attr.aria-pressed]="horas().includes(h)"
                  [class]="
                    horas().includes(h)
                      ? 'bg-primary text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-100'
                  "
                  class="w-11 rounded-lg border border-slate-200 px-1 py-1 font-mono text-caption-xs font-bold transition-colors active:scale-95"
                >
                  {{ h < 10 ? '0' + h : h }}
                </button>
              }
            </div>
            <p class="mt-1 text-caption-xs text-slate-500">
              Hora de Chile. Se recomiendan dos: una antes de que llegue el cliente y otra a media
              tarde.
            </p>
          </div>
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Equipo sin datos desde</label
            >
            <div class="relative w-32">
              <input
                type="number"
                min="0.5"
                step="0.5"
                [ngModel]="umbralHoras()"
                (ngModelChange)="umbralHoras.set($event)"
                name="umbral-horas"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-center font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
              />
              <span
                class="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-caption-xs text-slate-400"
                >h</span
              >
            </div>
            <p class="mt-1 text-caption-xs text-slate-500">
              Mismo umbral para las dos secciones del correo.
            </p>
          </div>
          <button
            type="button"
            (click)="guardarConfig()"
            [disabled]="!configDirty() || savingConfig()"
            class="rounded-xl bg-primary px-4 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-primary-tint-90 active:scale-95 disabled:opacity-40"
          >
            {{ savingConfig() ? 'Guardando…' : 'Guardar horario' }}
          </button>
        </div>
      </section>
    }

    @if (!meta().worker_seguridad_activo && !loading()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">pause_circle</span>
        <span>
          El worker de auditoría está apagado (<code class="font-mono text-caption-xs"
            >ENABLE_AUDIT_ALERTS_WORKER</code
          >), así que la columna <strong>Seguridad</strong> no enviará nada hasta activarlo.
        </span>
      </div>
    }

    @if (sinSeguridad() && meta().worker_seguridad_activo && !loading()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">shield</span>
        <span>
          Nadie recibe las alertas de seguridad. Los cambios de rol y las ráfagas de logins fallidos
          no se están avisando a nadie: a diferencia del resumen, estas alertas
          <strong>no tienen buzón de respaldo</strong>.
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
              <th class="dga-table-header">Resumen</th>
              <th class="dga-table-header">Seguridad</th>
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
                    <span class="text-caption-xs text-slate-500">{{ horariosTexto() }}</span>
                  </label>
                </td>
                <td class="px-4 py-2">
                  <label class="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      [ngModel]="d.recibe_seguridad"
                      (ngModelChange)="setCampo(d.email, 'recibe_seguridad', $event)"
                      [name]="'seguridad-' + d.email"
                      class="h-4 w-4 accent-primary"
                    />
                    <span class="text-caption-xs text-slate-500">Cambios de rol y logins</span>
                  </label>
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
                <td colspan="7" class="px-4 py-6 text-center text-caption italic text-slate-500">
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
    umbral_horas: 6,
    zona_horaria: CHILE_TIME_ZONE,
    fallback_email: '',
    worker_activo: false,
    worker_seguridad_activo: false,
    max_destinatarios: 25,
  });
  /** Miembros del equipo interno que aún no están en la lista. */
  private readonly equipo = signal<CandidatoEquipo[]>([]);

  /** Programación en edición. Se guarda aparte de la lista de destinatarios. */
  readonly horas = signal<number[]>([7, 16]);
  readonly umbralHoras = signal<number>(6);
  readonly savingConfig = signal(false);
  readonly horasDelDia = Array.from({ length: 24 }, (_, i) => i);

  nuevoEmail = '';
  nuevoNombre = '';

  readonly dirty = computed(() => JSON.stringify(this.filas()) !== JSON.stringify(this.original()));

  readonly configDirty = computed(() => {
    const m = this.meta();
    return (
      JSON.stringify(this.horas()) !== JSON.stringify(m.horarios_resumen) ||
      Number(this.umbralHoras()) !== Number(m.umbral_horas)
    );
  });

  readonly sinResumen = computed(
    () => this.filas().filter((d) => d.activo && d.recibe_resumen).length === 0,
  );

  /**
   * A diferencia de `sinResumen`, acá no hay buzón de respaldo: si nadie está
   * suscrito, las alertas de seguridad simplemente no se envían. El aviso en
   * pantalla es la única forma de que ese silencio se note.
   */
  readonly sinSeguridad = computed(
    () => this.filas().filter((d) => d.activo && d.recibe_seguridad).length === 0,
  );

  readonly sinCupo = computed(() => this.filas().length >= this.meta().max_destinatarios);

  readonly horariosTexto = computed(() =>
    this.meta()
      .horarios_resumen.map((h) => `${String(h).padStart(2, '0')}:00`)
      .join(' y '),
  );

  /** Una hora que ya está seleccionada se saca; nunca se deja la lista vacía. */
  toggleHora(h: number): void {
    this.horas.update((hs) => {
      if (hs.includes(h)) return hs.length === 1 ? hs : hs.filter((x) => x !== h);
      return [...hs, h].sort((a, b) => a - b);
    });
  }

  guardarConfig(): void {
    const umbral = Number(this.umbralHoras());
    if (!Number.isFinite(umbral) || umbral < 0.5) {
      this.error.set('El umbral debe ser de al menos 0,5 horas.');
      return;
    }
    this.savingConfig.set(true);
    this.error.set('');
    this.service.saveConfig(this.horas(), umbral).subscribe({
      next: (r) => {
        this.savingConfig.set(false);
        this.meta.update((m) => ({
          ...m,
          horarios_resumen: r.data.horarios_resumen,
          umbral_horas: r.data.umbral_horas,
        }));
        this.horas.set(r.data.horarios_resumen);
        this.umbralHoras.set(r.data.umbral_horas);
        this.toast.success('Programación guardada.');
      },
      error: (err) => {
        this.savingConfig.set(false);
        this.error.set(err?.error?.error?.message || 'No se pudo guardar la programación.');
      },
    });
  }

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
        if (res.meta) {
          this.meta.set(res.meta);
          this.horas.set(res.meta.horarios_resumen);
          this.umbralHoras.set(res.meta.umbral_horas);
        }
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

  setCampo(email: string, campo: 'recibe_resumen' | 'recibe_seguridad', valor: boolean): void {
    this.filas.update((rows) =>
      rows.map((r) => (r.email === email ? { ...r, [campo]: valor } : r)),
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
        // Las de seguridad no se heredan al sumar a alguien al monitoreo: hay que
        // marcarlas a mano. Un cambio de rol es dato sensible, no operación.
        recibe_seguridad: false,
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

    const seguridad = rows.filter((d) => d.recibe_seguridad).length;
    return `${resumen} en el resumen · ${seguridad} en seguridad.`;
  }
}
