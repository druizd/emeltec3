import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UpdateUserProfilePayload, User } from '@emeltec/shared';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { formatRutInput } from '../../shared/rut';

type EditableProfileField = 'nombre' | 'apellido' | 'rut_usuario' | 'telefono' | 'cargo';

interface ProfileRow {
  label: string;
  value: string;
  icon: string;
  field?: EditableProfileField;
  locked?: boolean;
}

interface EditState {
  field: EditableProfileField;
  label: string;
  currentValue: string;
  value: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="min-h-full bg-[#F0F2F5] px-5 py-5">
      <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p
            class="mb-1 flex items-center gap-1.5 text-caption-xs font-bold uppercase tracking-[0.14em] text-primary"
          >
            <span class="material-symbols-outlined text-[15px]">account_circle</span>
            Cuenta
          </p>
          <h1
            class="text-h4 font-bold leading-tight tracking-[0.03em] text-[#1e293b]"
            style="font-family: 'Josefin Sans', sans-serif"
          >
            Mi perfil
          </h1>
          <p class="mt-0.5 text-body-sm text-[#94a3b8]">
            Información personal asociada a tu sesión.
          </p>
        </div>

        @if (loading()) {
          <span
            class="inline-flex items-center gap-1.5 text-caption-xs font-semibold text-[#94a3b8]"
          >
            <span class="material-symbols-outlined animate-spin text-[14px]"
              >progress_activity</span
            >
            Cargando perfil
          </span>
        }
      </div>

      @if (errorMsg()) {
        <div
          class="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm font-semibold text-amber-800"
          role="status"
        >
          <span class="material-symbols-outlined text-[18px]">warning</span>
          {{ errorMsg() }}
        </div>
      }

      @if (displayUser(); as user) {
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(260px,340px)_1fr]">
          <section
            class="rounded-xl border border-[#e2e8f0] bg-white px-5 py-5 shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
          >
            <div class="flex items-start gap-4">
              <div
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-h6 font-bold text-white shadow-[0_8px_24px_rgba(13,175,189,0.24)]"
              >
                {{ initials(user) }}
              </div>
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-h6 font-bold text-[#1e293b]">{{ fullName(user) }}</h2>
                <p class="mt-1 truncate text-body-sm font-semibold text-primary">
                  {{ displayValue(user.email) }}
                </p>
                <p class="mt-3 flex items-center gap-1.5 text-body-sm font-semibold text-[#64748b]">
                  <span class="material-symbols-outlined text-[16px] text-[#94a3b8]">work</span>
                  {{ displayValue(user.cargo, 'Cargo no registrado') }}
                </p>
                @if (companyLine(user)) {
                  <p class="mt-1 flex items-center gap-1.5 text-caption text-[#94a3b8]">
                    <span class="material-symbols-outlined text-[15px]">business</span>
                    {{ companyLine(user) }}
                  </p>
                }
              </div>
            </div>
          </section>

          <section
            class="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
          >
            <div class="border-b border-[#e2e8f0] px-5 py-4">
              <h2 class="text-body font-bold text-[#1e293b]">Datos personales</h2>
            </div>

            <div class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              @for (row of personalRows(); track row.label) {
                <button
                  type="button"
                  (click)="openEdit(row)"
                  [disabled]="!row.field"
                  [attr.aria-label]="row.field ? 'Editar ' + row.label : row.label"
                  class="group min-w-0 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3 text-left transition-all hover:border-primary-tint-35 hover:bg-primary-tint-08/40 hover:shadow-[0_4px_14px_rgba(13,175,189,0.10)] disabled:cursor-default disabled:hover:border-[#e2e8f0] disabled:hover:bg-white disabled:hover:shadow-none"
                >
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <p
                      class="flex min-w-0 items-center gap-1.5 text-caption-xs font-bold uppercase tracking-[0.14em] text-[#94a3b8]"
                    >
                      <span class="material-symbols-outlined text-[15px]">{{ row.icon }}</span>
                      {{ row.label }}
                    </p>
                    @if (row.locked) {
                      <span
                        class="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                      >
                        <span class="material-symbols-outlined text-[12px]">lock</span>
                        No editable
                      </span>
                    } @else {
                      <span
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <span class="material-symbols-outlined text-[17px]">edit</span>
                      </span>
                    }
                  </div>
                  <p class="break-words text-body-sm font-semibold text-[#1e293b]">
                    {{ row.value }}
                  </p>
                </button>
              }
            </div>
          </section>

          <section
            class="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)] xl:col-span-2"
          >
            <div class="border-b border-[#e2e8f0] px-5 py-4">
              <h2 class="text-body font-bold text-[#1e293b]">Empresa asociada</h2>
            </div>
            <div class="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              @for (row of companyRows(); track row.label) {
                <div class="min-w-0 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
                  <p
                    class="mb-2 flex items-center gap-1.5 text-caption-xs font-bold uppercase tracking-[0.14em] text-[#94a3b8]"
                  >
                    <span class="material-symbols-outlined text-[15px]">{{ row.icon }}</span>
                    {{ row.label }}
                  </p>
                  <p class="break-words text-body-sm font-semibold text-[#1e293b]">
                    {{ row.value }}
                  </p>
                </div>
              }
            </div>
          </section>

          <section
            class="rounded-xl border border-primary-tint-25 bg-primary-tint-08/50 shadow-[0_1px_4px_rgba(15,23,42,0.04)] xl:col-span-2"
          >
            <div
              class="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex min-w-0 items-start gap-3">
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-[0_1px_4px_rgba(15,23,42,0.06)]"
                >
                  <span class="material-symbols-outlined text-[20px]">shield_lock</span>
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-body font-bold text-[#1e293b]">Contraseña y seguridad</h2>
                    <span
                      class="rounded-md border border-primary-tint-25 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                    >
                      Pendiente
                    </span>
                  </div>
                  <p class="mt-1 text-body-sm text-[#64748b]">
                    Correo de recuperación:
                    <span class="font-semibold text-[#1e293b]">{{ user.email }}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled
                class="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-tint-25 bg-white px-4 text-body-sm font-bold text-[#94a3b8] opacity-70"
              >
                <span class="material-symbols-outlined text-[17px]">lock_reset</span>
                Cambiar contraseña
              </button>
            </div>
          </section>
        </div>
      } @else {
        <section
          class="rounded-xl border border-[#e2e8f0] bg-white px-8 py-12 text-center shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
        >
          <div
            class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100"
          >
            <span class="material-symbols-outlined text-[24px] text-[#94a3b8]">person_off</span>
          </div>
          <h2 class="text-h6 font-bold text-[#1e293b]">Perfil no disponible</h2>
          <p class="mt-1 text-body-sm text-[#64748b]">
            No se pudo cargar información de la sesión actual.
          </p>
        </section>
      }

      @if (editState(); as edit) {
        <div
          class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          (click)="closeEdit()"
        >
          <section
            class="w-full max-w-md overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[19px] text-primary">edit</span>
                <h2 class="text-body font-bold text-[#1e293b]">Editar {{ edit.label }}</h2>
              </div>
              <button
                type="button"
                (click)="closeEdit()"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-slate-100 hover:text-[#475569]"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div class="space-y-4 px-5 py-5">
              <label class="grid gap-1.5">
                <span class="text-caption-xs font-bold uppercase tracking-[0.14em] text-[#94a3b8]">
                  Actual
                </span>
                <input
                  type="text"
                  [value]="edit.currentValue || 'No registrado'"
                  disabled
                  class="h-10 rounded-lg border border-[#e2e8f0] bg-slate-50 px-3 text-body-sm font-semibold text-[#64748b]"
                />
              </label>

              <label class="grid gap-1.5">
                <span class="text-caption-xs font-bold uppercase tracking-[0.14em] text-[#94a3b8]">
                  Nuevo
                </span>
                <input
                  type="text"
                  [ngModel]="edit.value"
                  (ngModelChange)="setEditValue($event)"
                  [attr.inputmode]="edit.field === 'telefono' ? 'tel' : 'text'"
                  class="h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-body-sm font-semibold text-[#1e293b] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                  autofocus
                />
              </label>

              @if (editError()) {
                <div
                  class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-caption font-semibold text-rose-700"
                  role="alert"
                >
                  {{ editError() }}
                </div>
              }
            </div>

            <div
              class="flex items-center justify-end gap-2 border-t border-[#e2e8f0] bg-slate-50 px-5 py-4"
            >
              <button
                type="button"
                (click)="closeEdit()"
                class="h-9 rounded-lg border border-[#e2e8f0] bg-white px-4 text-body-sm font-semibold text-[#64748b] transition-colors hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="saveEdit()"
                [disabled]="editSaving() || !canSaveEdit(edit)"
                class="h-9 rounded-lg bg-primary px-4 text-body-sm font-bold text-white transition-colors hover:bg-[#0899a5] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {{ editSaving() ? 'Guardando...' : 'Confirmar' }}
              </button>
            </div>
          </section>
        </div>
      }
    </section>
  `,
})
export class ProfileComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);

  readonly profile = signal<User | null>(null);
  readonly loading = signal(true);
  readonly errorMsg = signal('');
  readonly editState = signal<EditState | null>(null);
  readonly editSaving = signal(false);
  readonly editError = signal('');
  readonly displayUser = computed(() => this.profile() ?? this.auth.user());

  readonly personalRows = computed<ProfileRow[]>(() => {
    const user = this.displayUser();
    if (!user) return [];

    return [
      {
        label: 'Nombre',
        value: this.displayValue(user.nombre),
        icon: 'badge',
        field: 'nombre',
      },
      {
        label: 'Apellido',
        value: this.displayValue(user.apellido, 'No registrado'),
        icon: 'badge',
        field: 'apellido',
      },
      {
        label: 'RUT',
        value: this.displayValue(user.rut_usuario, 'No registrado'),
        icon: 'fingerprint',
        field: 'rut_usuario',
      },
      {
        label: 'Teléfono',
        value: this.displayValue(user.telefono, 'No registrado'),
        icon: 'call',
        field: 'telefono',
      },
      {
        label: 'Cargo',
        value: this.displayValue(user.cargo, 'No registrado'),
        icon: 'work',
        field: 'cargo',
      },
      {
        label: 'Correo',
        value: this.displayValue(user.email),
        icon: 'mail',
        locked: true,
      },
    ];
  });

  readonly companyRows = computed<ProfileRow[]>(() => {
    const user = this.displayUser();
    if (!user) return [];

    return [
      {
        label: 'Empresa',
        value: this.displayValue(user.empresa_nombre, 'Sin empresa asignada'),
        icon: 'business',
      },
      {
        label: 'Sub empresa',
        value: this.displayValue(user.sub_empresa_nombre, 'Sin sub empresa asignada'),
        icon: 'groups',
      },
    ];
  });

  ngOnInit(): void {
    this.profile.set(this.auth.user());
    this.loading.set(true);
    this.errorMsg.set('');

    this.userService.getCurrentUser().subscribe({
      next: (res) => {
        if (res.ok) this.profile.set(res.data);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMsg.set(
          err.error?.error ?? err.error?.message ?? 'No se pudo actualizar la ficha del perfil.',
        );
      },
    });
  }

  openEdit(row: ProfileRow): void {
    if (!row.field) return;
    const currentValue = this.editableValue(row.field);
    this.editState.set({
      field: row.field,
      label: row.label,
      currentValue,
      value: currentValue,
    });
    this.editError.set('');
  }

  setEditValue(value: string): void {
    const edit = this.editState();
    if (!edit) return;

    this.editState.set({
      ...edit,
      value: edit.field === 'rut_usuario' ? formatRutInput(value) : value,
    });
  }

  closeEdit(): void {
    if (this.editSaving()) return;
    this.editState.set(null);
    this.editError.set('');
  }

  saveEdit(): void {
    const edit = this.editState();
    if (!edit || !this.canSaveEdit(edit)) return;

    const value = edit.value.trim();
    const payload: UpdateUserProfilePayload = {};

    if (edit.field === 'nombre') {
      payload.nombre = value;
    } else {
      payload[edit.field] = value || null;
    }

    this.editSaving.set(true);
    this.editError.set('');

    this.userService.updateCurrentUser(payload).subscribe({
      next: (res) => {
        if (res.ok) {
          this.profile.set(res.data);
          this.auth.updateUser(res.data);
          this.editState.set(null);
        }
        this.editSaving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.editSaving.set(false);
        this.editError.set(
          err.error?.error ?? err.error?.message ?? 'No se pudo actualizar este dato.',
        );
      },
    });
  }

  canSaveEdit(edit: EditState): boolean {
    const value = edit.value.trim();
    if (edit.field === 'nombre' && !value) return false;
    return value !== edit.currentValue.trim();
  }

  fullName(user: User): string {
    return [user.nombre, user.apellido].filter(Boolean).join(' ').trim() || 'Usuario';
  }

  initials(user: User): string {
    const first = user.nombre?.charAt(0) ?? '';
    const last = user.apellido?.charAt(0) ?? '';
    return `${first}${last}`.trim().toUpperCase() || this.fullName(user).slice(0, 2).toUpperCase();
  }

  companyLine(user: User): string {
    return [user.empresa_nombre, user.sub_empresa_nombre].filter(Boolean).join(' · ');
  }

  displayValue(value: string | null | undefined, fallback = 'No informado'): string {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  private editableValue(field: EditableProfileField): string {
    const user = this.displayUser();
    if (!user) return '';

    return this.displayValue(user[field], '');
  }
}
