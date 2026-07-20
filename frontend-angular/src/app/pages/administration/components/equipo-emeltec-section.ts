import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../../components/ui/confirm-dialog';
import type { User, UserRole } from '@emeltec/shared';

interface EquipoEmeltecData {
  empresa_emeltec: { id: string; nombre: string } | null;
  miembros: MiembroEquipo[];
}

interface MiembroEquipo {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string | null;
  cargo: string | null;
  tipo: UserRole;
  activo: boolean;
  last_login_at: string | null;
}

interface DraftMiembro {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  cargo: string;
  tipo: 'SuperAdmin' | 'Vendedor';
}

interface DraftEdicion {
  nombre: string;
  apellido: string;
  cargo: string;
  tipo: 'SuperAdmin' | 'Vendedor';
}

function emptyDraft(): DraftMiembro {
  return { nombre: '', apellido: '', email: '', telefono: '', cargo: '', tipo: 'Vendedor' };
}

/**
 * Sección "Equipo Emeltec" de /administration (solo SuperAdmin).
 *
 * Lista SuperAdmins y Vendedores, y permite crear miembros nuevos. El alta
 * usa POST /api/users (flujo OTP de bienvenida por email) asociando el
 * usuario a la empresa interna Emeltec. La acción exige 2FA: el desafío lo
 * maneja el two-factor.interceptor global (abre el diálogo y reintenta).
 */
@Component({
  selector: 'app-equipo-emeltec-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  template: `
    @if (error()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-body-sm text-red-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>
        <span>{{ error() }}</span>
      </div>
    }
    @if (aviso()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-body-sm text-emerald-800"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">check_circle</span>
        <span>{{ aviso() }}</span>
      </div>
    }

    <header class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-caption text-slate-500">
        SuperAdmins (operación) y Vendedores (demos y Maletas Piloto) del equipo interno.
        @if (empresaEmeltec(); as emp) {
          Las altas nuevas se asocian a <strong>{{ emp.nombre }}</strong
          >.
        }
      </p>
      <button
        type="button"
        (click)="toggleForm()"
        [attr.aria-pressed]="mostrandoForm()"
        class="inline-flex items-center gap-1 rounded-md border border-primary-tint-25 bg-primary-tint-08 px-3 py-1.5 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
      >
        <span class="material-symbols-outlined text-[14px]" aria-hidden="true">{{
          mostrandoForm() ? 'close' : 'person_add'
        }}</span>
        {{ mostrandoForm() ? 'Cancelar' : 'Agregar miembro' }}
      </button>
    </header>

    @if (mostrandoForm()) {
      <form
        (ngSubmit)="crear()"
        class="space-y-3 rounded-lg border-2 border-dashed border-primary-tint-25 bg-primary-tint-08/30 p-4"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
              >Nombre *</span
            >
            <input
              type="text"
              required
              [(ngModel)]="draft.nombre"
              name="nombre"
              class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
              >Apellido *</span
            >
            <input
              type="text"
              required
              [(ngModel)]="draft.apellido"
              name="apellido"
              class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
              >Email *</span
            >
            <input
              type="email"
              required
              [(ngModel)]="draft.email"
              name="email"
              placeholder="nombre@emeltec.cl"
              class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
              >Cargo</span
            >
            <input
              type="text"
              [(ngModel)]="draft.cargo"
              name="cargo"
              class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
            />
          </label>
        </div>

        <fieldset>
          <legend class="mb-1.5 text-caption-xs font-semibold uppercase text-slate-400">
            Rol *
          </legend>
          <div class="flex gap-2">
            <label [class]="rolCardClass('Vendedor')">
              <input type="radio" name="tipo" value="Vendedor" [(ngModel)]="draft.tipo" hidden />
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                >storefront</span
              >
              <span>
                <span class="block text-body-sm font-bold">Vendedor</span>
                <span class="block text-caption-xs"
                  >Solo demos y Maletas Piloto (empresa Emeltec)</span
                >
              </span>
            </label>
            <label [class]="rolCardClass('SuperAdmin')">
              <input type="radio" name="tipo" value="SuperAdmin" [(ngModel)]="draft.tipo" hidden />
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                >shield_person</span
              >
              <span>
                <span class="block text-body-sm font-bold">SuperAdmin</span>
                <span class="block text-caption-xs">Toda la plataforma</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div class="flex items-center justify-between gap-2">
          <span class="text-caption-xs text-slate-400">
            Se enviará un código de activación al email del nuevo miembro (vence en 24 h). La
            creación requiere tu código 2FA.
          </span>
          <button
            type="submit"
            [disabled]="saving() || !formValido()"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>
            {{ saving() ? 'Creando…' : 'Crear miembro' }}
          </button>
        </div>
      </form>
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
              <th class="dga-table-header">Nombre</th>
              <th class="dga-table-header">Email</th>
              <th class="dga-table-header">Rol</th>
              <th class="dga-table-header">Cargo</th>
              <th class="dga-table-header">Estado</th>
              <th class="dga-table-header"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            @for (m of miembros(); track m.id) {
              <tr class="hover:bg-slate-50" [class.opacity-60]="!m.activo">
                <td class="px-4 py-2 font-semibold text-slate-700">
                  {{ m.nombre }} {{ m.apellido }}
                  @if (esYo(m)) {
                    <span class="ml-1 text-caption-xs font-normal text-slate-400">(tú)</span>
                  }
                </td>
                <td class="px-4 py-2 text-slate-500">{{ m.email }}</td>
                <td class="px-4 py-2">
                  <span [class]="rolBadgeClass(m.tipo)">{{ m.tipo }}</span>
                </td>
                <td class="px-4 py-2 text-slate-500">{{ m.cargo || '—' }}</td>
                <td class="px-4 py-2">
                  @if (m.activo) {
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-caption-xs font-semibold text-emerald-700"
                    >
                      <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                      {{ m.last_login_at ? 'Activo' : 'Pendiente activación' }}
                    </span>
                  } @else {
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-caption-xs font-semibold text-slate-500"
                    >
                      <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                      Desactivado
                    </span>
                  }
                </td>
                <td class="px-4 py-2">
                  <div class="flex justify-end gap-1">
                    <button
                      type="button"
                      (click)="toggleEdicion(m)"
                      [attr.aria-label]="'Editar a ' + m.nombre"
                      title="Editar"
                      class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary-container active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{
                        editandoId() === m.id ? 'close' : 'edit'
                      }}</span>
                    </button>
                    @if (m.activo) {
                      <button
                        type="button"
                        (click)="pedirReenvio(m)"
                        [disabled]="saving()"
                        [attr.aria-label]="'Reenviar código de acceso a ' + m.nombre"
                        title="Reenviar código de acceso"
                        class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-primary-tint-08 hover:text-primary-container active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                          >lock_reset</span
                        >
                      </button>
                    }
                    @if (m.activo) {
                      <button
                        type="button"
                        (click)="pedirDesactivar(m)"
                        [disabled]="esYo(m) || saving()"
                        [attr.aria-label]="'Desactivar a ' + m.nombre"
                        [title]="esYo(m) ? 'No puedes desactivar tu propia cuenta' : 'Desactivar'"
                        class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                          >person_off</span
                        >
                      </button>
                    } @else {
                      <button
                        type="button"
                        (click)="reactivar(m)"
                        [disabled]="saving()"
                        [attr.aria-label]="'Reactivar a ' + m.nombre"
                        title="Reactivar"
                        class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 active:scale-95 disabled:opacity-40"
                      >
                        <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                          >person_check</span
                        >
                      </button>
                    }
                  </div>
                </td>
              </tr>
              @if (editandoId() === m.id) {
                <tr class="bg-primary-tint-08/30">
                  <td colspan="6" class="px-4 py-3">
                    <form (ngSubmit)="guardarEdicion(m)" class="space-y-3">
                      <div class="grid gap-3 sm:grid-cols-4">
                        <label class="block">
                          <span
                            class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
                            >Nombre *</span
                          >
                          <input
                            type="text"
                            required
                            [(ngModel)]="editDraft.nombre"
                            name="edit-nombre-{{ m.id }}"
                            class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                          />
                        </label>
                        <label class="block">
                          <span
                            class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
                            >Apellido *</span
                          >
                          <input
                            type="text"
                            required
                            [(ngModel)]="editDraft.apellido"
                            name="edit-apellido-{{ m.id }}"
                            class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                          />
                        </label>
                        <label class="block">
                          <span
                            class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
                            >Cargo</span
                          >
                          <input
                            type="text"
                            [(ngModel)]="editDraft.cargo"
                            name="edit-cargo-{{ m.id }}"
                            class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                          />
                        </label>
                        <label class="block">
                          <span
                            class="mb-1 block text-caption-xs font-semibold uppercase text-slate-400"
                            >Rol *</span
                          >
                          <select
                            [(ngModel)]="editDraft.tipo"
                            name="edit-tipo-{{ m.id }}"
                            [disabled]="esYo(m)"
                            [title]="esYo(m) ? 'No puedes cambiar tu propio rol' : ''"
                            class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20 disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            <option value="Vendedor">Vendedor</option>
                            <option value="SuperAdmin">SuperAdmin</option>
                          </select>
                        </label>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-caption-xs text-slate-400">
                          Guardar requiere tu código 2FA. El email no se puede editar.
                        </span>
                        <div class="flex gap-2">
                          <button
                            type="button"
                            (click)="toggleEdicion(m)"
                            class="rounded-md bg-slate-100 px-3 py-1.5 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-95"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            [disabled]="saving() || !editValido()"
                            class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:opacity-50"
                          >
                            <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                              >check</span
                            >
                            {{ saving() ? 'Guardando…' : 'Guardar' }}
                          </button>
                        </div>
                      </div>
                    </form>
                  </td>
                </tr>
              }
            } @empty {
              <tr>
                <td colspan="6" class="px-4 py-6 text-center text-slate-400">
                  Sin miembros registrados.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <app-confirm-dialog
      [data]="confirmData()"
      (accept)="onConfirmAccept()"
      (dismiss)="onConfirmCancel()"
    />
  `,
})
export class EquipoEmeltecSectionComponent {
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly mostrandoForm = signal(false);
  readonly data = signal<EquipoEmeltecData>({ empresa_emeltec: null, miembros: [] });
  /** id del miembro en edición inline (null = ninguno). */
  readonly editandoId = signal<string | null>(null);
  readonly confirmData = signal<ConfirmDialogData | null>(null);

  readonly miembros = computed(() => this.data().miembros);
  readonly empresaEmeltec = computed(() => this.data().empresa_emeltec);

  draft: DraftMiembro = emptyDraft();
  editDraft: DraftEdicion = { nombre: '', apellido: '', cargo: '', tipo: 'Vendedor' };

  private pendingConfirm: (() => void) | null = null;

  constructor() {
    this.recargar();
  }

  esYo(m: MiembroEquipo): boolean {
    return String(this.auth.user()?.id ?? '') === String(m.id);
  }

  toggleEdicion(m: MiembroEquipo): void {
    if (this.editandoId() === m.id) {
      this.editandoId.set(null);
      return;
    }
    this.editDraft = {
      nombre: m.nombre,
      apellido: m.apellido,
      cargo: m.cargo ?? '',
      tipo: m.tipo === 'SuperAdmin' ? 'SuperAdmin' : 'Vendedor',
    };
    this.editandoId.set(m.id);
    this.error.set('');
    this.aviso.set('');
  }

  editValido(): boolean {
    return !!this.editDraft.nombre.trim() && !!this.editDraft.apellido.trim();
  }

  guardarEdicion(m: MiembroEquipo): void {
    if (!this.editValido() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.userService
      .updateUser(m.id, {
        nombre: this.editDraft.nombre.trim(),
        apellido: this.editDraft.apellido.trim(),
        cargo: this.editDraft.cargo.trim() || null,
        // El propio rol no se auto-edita (select deshabilitado en UI).
        ...(this.esYo(m) ? {} : { tipo: this.editDraft.tipo }),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editandoId.set(null);
          this.toast.success('Miembro actualizado satisfactoriamente.');
          this.recargar();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(err?.error?.error || 'No se pudo guardar la edición.');
        },
      });
  }

  pedirDesactivar(m: MiembroEquipo): void {
    this.pendingConfirm = () => this.desactivar(m);
    this.confirmData.set({
      title: 'Desactivar miembro',
      message:
        `¿Desactivar a ${m.nombre} ${m.apellido}? Pierde acceso a la plataforma de inmediato. ` +
        `Es reversible desde esta misma tabla.`,
      confirmText: 'Desactivar',
      tone: 'danger',
      icon: 'person_off',
    });
  }

  pedirReenvio(m: MiembroEquipo): void {
    this.pendingConfirm = () => this.reenviarCodigo(m);
    this.confirmData.set({
      title: 'Reenviar código de acceso',
      message:
        `¿Reenviar el código de acceso a ${m.nombre} ${m.apellido} (${m.email})? ` +
        `Recibirá un correo para volver a ingresar. Requiere tu código 2FA.`,
      confirmText: 'Reenviar',
      tone: 'primary',
      icon: 'lock_reset',
    });
  }

  private reenviarCodigo(m: MiembroEquipo): void {
    this.saving.set(true);
    this.error.set('');
    // El backend exige 2FA (require2fa); el twoFactorInterceptor global abre
    // el diálogo del código y reintenta la petición automáticamente.
    this.userService.resetUserPassword(m.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Código de acceso reenviado satisfactoriamente.');
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.error || 'No se pudo reenviar el código de acceso.');
      },
    });
  }

  onConfirmAccept(): void {
    const action = this.pendingConfirm;
    this.pendingConfirm = null;
    this.confirmData.set(null);
    action?.();
  }

  onConfirmCancel(): void {
    this.pendingConfirm = null;
    this.confirmData.set(null);
  }

  private desactivar(m: MiembroEquipo): void {
    this.saving.set(true);
    this.error.set('');
    this.userService.deleteUser(m.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Miembro desactivado satisfactoriamente.');
        this.recargar();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.error || 'No se pudo desactivar.');
      },
    });
  }

  reactivar(m: MiembroEquipo): void {
    this.saving.set(true);
    this.error.set('');
    this.userService.reactivateUser(m.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Miembro reactivado satisfactoriamente.');
        this.recargar();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.error || 'No se pudo reactivar.');
      },
    });
  }

  recargar(): void {
    this.loading.set(true);
    this.error.set('');
    this.userService.getEquipoEmeltec().subscribe({
      next: (res) => {
        if (res.ok) this.data.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'No se pudo cargar el equipo Emeltec.');
        this.loading.set(false);
      },
    });
  }

  toggleForm(): void {
    this.mostrandoForm.update((v) => !v);
    this.error.set('');
    this.aviso.set('');
    if (!this.mostrandoForm()) this.draft = emptyDraft();
  }

  formValido(): boolean {
    return (
      !!this.draft.nombre.trim() &&
      !!this.draft.apellido.trim() &&
      /.+@.+\..+/.test(this.draft.email.trim())
    );
  }

  rolCardClass(rol: DraftMiembro['tipo']): string {
    const base =
      'flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ';
    return this.draft.tipo === rol
      ? base + 'border-primary-tint-35 bg-primary-tint-08 text-primary-container'
      : base + 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50';
  }

  rolBadgeClass(tipo: UserRole): string {
    const base =
      'inline-flex items-center rounded-full border px-2 py-0.5 text-caption-xs font-semibold ';
    return tipo === 'SuperAdmin'
      ? base + 'border-primary-tint-35 bg-primary-tint-08 text-primary-container'
      : base + 'border-amber-200 bg-amber-50 text-amber-700';
  }

  crear(): void {
    if (!this.formValido() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.aviso.set('');
    this.userService
      .createUser({
        nombre: this.draft.nombre.trim(),
        apellido: this.draft.apellido.trim(),
        email: this.draft.email.trim(),
        telefono: this.draft.telefono.trim() || null,
        cargo: this.draft.cargo.trim() || null,
        tipo: this.draft.tipo,
        empresa_id: this.empresaEmeltec()?.id ?? null,
      })
      .subscribe({
        next: (res: { ok: boolean; data?: User }) => {
          this.saving.set(false);
          if (res.ok) {
            this.toast.success('Miembro agregado satisfactoriamente.');
            this.mostrandoForm.set(false);
            this.draft = emptyDraft();
            this.recargar();
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(err?.error?.error || 'No se pudo crear el miembro.');
        },
      });
  }
}
