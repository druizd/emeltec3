import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../../services/user.service';
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
  imports: [CommonModule, FormsModule],
  template: `
    @if (error()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-body-sm text-red-800"
      >
        <span class="material-symbols-outlined text-[18px]">error</span>
        <span>{{ error() }}</span>
      </div>
    }
    @if (aviso()) {
      <div
        class="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-body-sm text-emerald-800"
      >
        <span class="material-symbols-outlined text-[18px]">check_circle</span>
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
        class="inline-flex items-center gap-1 rounded-md border border-primary-tint-25 bg-primary-tint-08 px-3 py-1.5 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14"
      >
        <span class="material-symbols-outlined text-[14px]">{{
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
              <span class="material-symbols-outlined text-[18px]">storefront</span>
              <span>
                <span class="block text-body-sm font-bold">Vendedor</span>
                <span class="block text-caption-xs"
                  >Solo demos y Maletas Piloto (empresa Emeltec)</span
                >
              </span>
            </label>
            <label [class]="rolCardClass('SuperAdmin')">
              <input type="radio" name="tipo" value="SuperAdmin" [(ngModel)]="draft.tipo" hidden />
              <span class="material-symbols-outlined text-[18px]">shield_person</span>
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
            <span class="material-symbols-outlined text-[16px]">check</span>
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
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            @for (m of miembros(); track m.id) {
              <tr class="hover:bg-slate-50">
                <td class="px-4 py-2 font-semibold text-slate-700">
                  {{ m.nombre }} {{ m.apellido }}
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
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="px-4 py-6 text-center text-slate-400">
                  Sin miembros registrados.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class EquipoEmeltecSectionComponent {
  private readonly userService = inject(UserService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly mostrandoForm = signal(false);
  readonly data = signal<EquipoEmeltecData>({ empresa_emeltec: null, miembros: [] });

  readonly miembros = computed(() => this.data().miembros);
  readonly empresaEmeltec = computed(() => this.data().empresa_emeltec);

  draft: DraftMiembro = emptyDraft();

  constructor() {
    this.recargar();
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
            this.aviso.set(
              `${this.draft.nombre} ${this.draft.apellido} creado. Se envió el código de activación a ${this.draft.email}.`,
            );
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
