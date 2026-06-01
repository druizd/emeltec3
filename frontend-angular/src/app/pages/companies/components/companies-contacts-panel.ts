import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SkeletonComponent } from '../../../components/ui/skeleton';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';
import { UserService } from '../../../services/user.service';
import type {
  ApiResponse,
  CreateOperationalContactPayload,
  OperationalContact,
  User,
} from '@emeltec/shared';

interface ContactForm {
  usuario_id: string;
  tipo_contacto: string;
  nombre: string;
  apellido: string;
  email: string;
  telefonoDigits: string;
  cargo: string;
  notas: string;
}

const CONTACT_TYPES = [
  'Reporte DGA',
  'Responsable',
  'Emergencia',
  'Mantencion',
  'Operacion',
  'Comercial',
];

@Component({
  selector: 'app-companies-contacts-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SkeletonComponent],
  template: `
    <section
      [class]="
        variant === 'superadmin'
          ? 'animate-in fade-in duration-500'
          : 'animate-in fade-in duration-500 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm'
      "
    >
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          @if (variant !== 'superadmin') {
            <h3 class="mb-1 text-body-sm font-semibold uppercase tracking-widest text-primary">
              Contactos
            </h3>
          }
          <p class="text-body-sm text-slate-400">
            Personal operativo asociado a {{ selectedLabel || 'la division seleccionada' }}
          </p>
        </div>

        <div class="flex items-center gap-3">
          @if (status() && !showAddModal()) {
            <p
              [class]="
                'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ' +
                (statusType() === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700')
              "
            >
              {{ status() }}
            </p>
          }
          @if (canManageContacts()) {
            <button
              type="button"
              (click)="openAddModal()"
              class="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-caption font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
            >
              <span class="material-symbols-outlined text-[16px]">add</span>
              Agregar contacto
            </button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (item of skeletonItems; track item) {
            <div [class]="getCardShellClass()">
              <div class="mb-4 flex items-start gap-3">
                <app-skeleton class="h-10 w-10 rounded-xl" />
                <div class="space-y-2">
                  <app-skeleton class="h-4 w-28 rounded-full" />
                  <app-skeleton class="h-3 w-20 rounded-full" />
                </div>
              </div>
              <div class="space-y-2.5">
                <app-skeleton class="h-10 w-full rounded-xl" />
                <app-skeleton class="h-10 w-full rounded-xl" />
                <app-skeleton class="h-10 w-full rounded-xl" />
              </div>
            </div>
          }
        </div>
      } @else if (contacts().length > 0) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (contact of contacts(); track contact.id) {
            <article [class]="getContactCardClass() + ' group relative'">
              @if (canManageContacts()) {
                <button
                  type="button"
                  (click)="deleteContact(contact)"
                  class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 opacity-0 transition-all duration-150 hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100"
                  aria-label="Eliminar contacto"
                >
                  <span class="material-symbols-outlined text-[16px]">delete</span>
                </button>
              }

              <div class="mb-4 flex min-w-0 items-center gap-3 pr-8">
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0dafbd] to-[#0899a5] text-[11px] font-semibold text-white shadow-sm"
                >
                  {{ getContactInitials(contact) }}
                </div>

                <div class="min-w-0">
                  <h4 class="truncate text-[14px] font-semibold text-slate-800">
                    {{ fullContactName(contact) }}
                  </h4>
                  <p class="truncate text-[11px] font-semibold text-primary-container">
                    {{ contact.tipo_contacto }}
                  </p>
                </div>
              </div>

              <div class="space-y-2.5">
                <div
                  class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[17px] text-primary-container">
                    badge
                  </span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Cargo
                    </p>
                    <p class="break-words text-[13px] font-semibold text-slate-700">
                      {{ contact.cargo }}
                    </p>
                  </div>
                </div>

                <div
                  class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[17px] text-primary-container">
                    call
                  </span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Telefono
                    </p>
                    <p class="break-words text-[13px] font-semibold text-slate-700">
                      {{ contact.telefono || 'Sin telefono registrado' }}
                    </p>
                  </div>
                </div>

                <div
                  class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[17px] text-primary-container">
                    mail
                  </span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Correo
                    </p>
                    <p class="break-all text-[13px] font-semibold text-slate-700">
                      {{ contact.email || 'Sin correo registrado' }}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          }
        </div>
      } @else {
        <div [class]="getEmptyStateClass()">
          <span class="material-symbols-outlined mb-4 text-5xl text-slate-300">contact_phone</span>
          <p class="text-body-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Sin contactos operativos
          </p>
          <p class="mx-auto mt-2 max-w-md text-body-sm text-slate-400">
            Agrega responsables DGA, emergencias o personas clave para
            {{ selectedLabel || 'esta division' }}.
          </p>
        </div>
      }

      @if (showAddModal()) {
        <div
          class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-contact-title"
        >
          <form
            (submit)="saveContact($event)"
            class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
          >
            <div class="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div class="min-w-0">
                <h3 id="add-contact-title" class="text-h6 font-bold text-slate-900">
                  Agregar contacto
                </h3>
                <p class="mt-1 text-body-sm text-slate-500">
                  Usuario registrado o contacto externo sin acceso.
                </p>
              </div>
              <button
                type="button"
                (click)="closeAddModal()"
                [disabled]="saving()"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            @if (status() && statusType() === 'error') {
              <div
                class="mx-6 mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-caption font-semibold text-rose-700"
              >
                {{ status() }}
              </div>
            }

            <div class="grid grid-cols-1 gap-3 px-6 py-5 md:grid-cols-2">
              <label class="block md:col-span-2">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Usuario vinculado
                </span>
                <select
                  [(ngModel)]="form.usuario_id"
                  name="usuario_id"
                  (ngModelChange)="onUserSelected($event)"
                  class="h-10 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-body-sm font-semibold text-[#1E293B] outline-none focus:border-primary-tint-40 focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                >
                  <option value="">Contacto externo / sin cuenta</option>
                  @for (user of availableUsers(); track user.id) {
                    <option [value]="user.id">{{ userLabel(user) }}</option>
                  }
                </select>
              </label>

              <label class="block">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Tipo
                </span>
                <select
                  required
                  [(ngModel)]="form.tipo_contacto"
                  name="tipo_contacto"
                  class="h-10 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-body-sm font-semibold text-[#1E293B] outline-none focus:border-primary-tint-40 focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                >
                  @for (type of contactTypes; track type) {
                    <option [value]="type">{{ type }}</option>
                  }
                </select>
              </label>

              <label class="block">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Telefono
                </span>
                <div
                  class="flex h-10 overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] focus-within:border-primary-tint-40 focus-within:bg-white focus-within:ring-2 focus-within:ring-primary-tint-20"
                >
                  <span
                    class="flex w-16 items-center justify-center border-r border-[#E2E8F0] bg-white text-body-sm font-bold text-primary-container"
                  >
                    +56
                  </span>
                  <input
                    required
                    [ngModel]="form.telefonoDigits"
                    (ngModelChange)="updatePhoneDigits($event)"
                    name="telefonoDigits"
                    inputmode="numeric"
                    maxlength="9"
                    pattern="[0-9]{9}"
                    class="h-full min-w-0 flex-1 bg-transparent px-3 text-body-sm font-semibold text-[#1E293B] outline-none"
                    placeholder="9 digitos"
                  />
                </div>
              </label>

              <label class="block">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Nombre
                </span>
                <input
                  required
                  [(ngModel)]="form.nombre"
                  name="nombre"
                  maxlength="12"
                  class="h-10 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-body-sm font-semibold text-[#1E293B] outline-none focus:border-primary-tint-40 focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                  placeholder="Nombre"
                />
              </label>

              <label class="block">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Apellido
                </span>
                <input
                  required
                  [(ngModel)]="form.apellido"
                  name="apellido"
                  maxlength="12"
                  class="h-10 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-body-sm font-semibold text-[#1E293B] outline-none focus:border-primary-tint-40 focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                  placeholder="Apellido"
                />
              </label>

              <label class="block md:col-span-2">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Correo
                </span>
                <input
                  [(ngModel)]="form.email"
                  name="email"
                  type="email"
                  maxlength="35"
                  class="h-10 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-body-sm font-semibold text-[#1E293B] outline-none focus:border-primary-tint-40 focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                  placeholder="contacto@empresa.cl"
                />
              </label>

              <label class="block md:col-span-2">
                <span
                  class="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"
                >
                  Cargo / responsabilidad
                </span>
                <input
                  required
                  [(ngModel)]="form.cargo"
                  name="cargo"
                  maxlength="35"
                  class="h-10 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-body-sm font-semibold text-[#1E293B] outline-none focus:border-primary-tint-40 focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                  placeholder="Ej. Responsable de reportes DGA"
                />
              </label>
            </div>

            <div class="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                (click)="closeAddModal()"
                [disabled]="saving()"
                class="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-caption font-bold uppercase tracking-wide text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                [disabled]="saving()"
                class="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-caption font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                <span class="material-symbols-outlined text-[16px]">add_call</span>
                {{ saving() ? 'Guardando...' : 'Guardar contacto' }}
              </button>
            </div>
          </form>
        </div>
      }

      @if (pendingDeleteContact()) {
        <div
          class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-contact-title"
        >
          <div
            class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
          >
            <div class="flex items-start gap-4">
              <div
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"
              >
                <span class="material-symbols-outlined text-[22px]">delete</span>
              </div>
              <div class="min-w-0 flex-1">
                <h3 id="delete-contact-title" class="text-h6 font-bold text-slate-900">
                  Eliminar contacto
                </h3>
                <p class="mt-1 text-body-sm leading-5 text-slate-500">
                  Se eliminara el registro operativo de
                  <span class="font-bold text-slate-800">
                    {{ fullContactName(pendingDeleteContact()!) }}
                  </span>
                  en {{ selectedLabel || 'esta division' }}.
                </p>
              </div>
            </div>

            <div
              class="mt-5 rounded-xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-caption font-semibold text-rose-700"
            >
              Esta accion no elimina usuarios registrados, solo este contacto operativo.
            </div>

            <div class="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                (click)="cancelDeleteContact()"
                [disabled]="deleting()"
                class="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-caption font-bold uppercase tracking-wide text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="confirmDeleteContact()"
                [disabled]="deleting()"
                class="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-4 text-caption font-bold uppercase tracking-wide text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <span class="material-symbols-outlined text-[16px]">delete</span>
                {{ deleting() ? 'Eliminando...' : 'Eliminar contacto' }}
              </button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
})
export class CompaniesContactsPanelComponent implements OnChanges {
  private readonly userService = inject(UserService);
  private readonly companyService = inject(CompanyService);
  private readonly auth = inject(AuthService);

  @Input() empresaId = '';
  @Input() subEmpresaId = '';
  @Input() selectedLabel = '';
  @Input() variant: 'default' | 'superadmin' = 'default';

  @Output() contactsCountChange = new EventEmitter<number>();

  readonly contacts = signal<OperationalContact[]>([]);
  readonly availableUsers = signal<User[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly status = signal('');
  readonly statusType = signal<'success' | 'error'>('success');
  readonly pendingDeleteContact = signal<OperationalContact | null>(null);
  readonly showAddModal = signal(false);
  readonly skeletonItems = Array.from({ length: 3 }, (_, index) => index);
  readonly contactTypes = CONTACT_TYPES;

  form: ContactForm = this.emptyForm();

  ngOnChanges(): void {
    this.loadContacts();
    this.loadAvailableUsers();
  }

  canManageContacts(): boolean {
    return !this.auth.isCliente();
  }

  loadContacts(): void {
    if (!this.empresaId) {
      this.contacts.set([]);
      this.contactsCountChange.emit(0);
      return;
    }

    this.loading.set(true);
    this.companyService
      .getOperationalContacts({
        empresa_id: this.empresaId,
        sub_empresa_id: this.subEmpresaId,
      })
      .subscribe({
        next: (res: ApiResponse<OperationalContact[]>) => {
          const contacts = res.ok ? (res.data ?? []) : [];
          this.contacts.set(contacts);
          this.contactsCountChange.emit(contacts.length);
          this.loading.set(false);
        },
        error: () => {
          this.contacts.set([]);
          this.contactsCountChange.emit(0);
          this.loading.set(false);
        },
      });
  }

  loadAvailableUsers(): void {
    if (!this.empresaId || !this.canManageContacts()) {
      this.availableUsers.set([]);
      return;
    }

    this.userService.getUsers({ empresa_id: this.empresaId }).subscribe({
      next: (res) => {
        const users = res.ok ? (res.data ?? []) : [];
        this.availableUsers.set(this.filterUsersForScope(users));
      },
      error: () => this.availableUsers.set([]),
    });
  }

  openAddModal(): void {
    if (!this.canManageContacts()) return;
    this.form = this.emptyForm();
    this.status.set('');
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    if (this.saving()) return;
    this.showAddModal.set(false);
  }

  onUserSelected(userId: string): void {
    const user = this.availableUsers().find((item) => item.id === userId);
    if (!user) {
      this.form.usuario_id = '';
      return;
    }

    this.form.nombre = (user.nombre || '').slice(0, 12);
    this.form.apellido = (user.apellido || '').slice(0, 12);
    this.form.email = (user.email || '').slice(0, 35);
    this.form.telefonoDigits = this.extractPhoneDigits(user.telefono || '');
    this.form.cargo = (user.cargo || this.form.cargo).slice(0, 35);
  }

  updatePhoneDigits(value: string): void {
    this.form.telefonoDigits = value.replace(/\D/g, '').slice(0, 9);
  }

  saveContact(event: Event): void {
    event.preventDefault();
    if (!this.canManageContacts()) return;
    if (!/^\d{9}$/.test(this.form.telefonoDigits)) {
      this.setStatus('El telefono debe tener 9 digitos despues de +56', 'error');
      return;
    }
    if (this.form.email.trim().length > 35 || this.form.cargo.trim().length > 35) {
      this.setStatus('Correo y cargo deben tener maximo 35 caracteres', 'error');
      return;
    }

    const payload: CreateOperationalContactPayload = {
      empresa_id: this.empresaId,
      sub_empresa_id: this.subEmpresaId,
      usuario_id: this.form.usuario_id || null,
      nombre: this.form.nombre.trim(),
      apellido: this.form.apellido.trim(),
      email: this.form.email.trim() || null,
      telefono: this.form.telefonoDigits ? `+56 ${this.form.telefonoDigits}` : null,
      cargo: this.form.cargo.trim(),
      tipo_contacto: this.form.tipo_contacto,
      notas: this.form.notas.trim() || null,
    };

    this.saving.set(true);
    this.companyService.createOperationalContact(payload).subscribe({
      next: (res) => {
        if (res.ok) {
          this.form = this.emptyForm();
          this.showAddModal.set(false);
          this.setStatus('Contacto correctamente agregado', 'success');
          this.loadContacts();
        } else {
          this.setStatus(res.error || 'No se pudo guardar', 'error');
        }
        this.saving.set(false);
      },
      error: (err) => {
        this.setStatus(err?.error?.error || 'No se pudo guardar', 'error');
        this.saving.set(false);
      },
    });
  }

  deleteContact(contact: OperationalContact): void {
    if (!this.canManageContacts()) return;
    this.pendingDeleteContact.set(contact);
  }

  cancelDeleteContact(): void {
    if (this.deleting()) return;
    this.pendingDeleteContact.set(null);
  }

  confirmDeleteContact(): void {
    const contact = this.pendingDeleteContact();
    if (!contact || !this.canManageContacts()) return;

    this.deleting.set(true);
    this.companyService.deleteOperationalContact(contact.id).subscribe({
      next: () => {
        this.pendingDeleteContact.set(null);
        this.setStatus('Contacto eliminado correctamente', 'success');
        this.loadContacts();
        this.deleting.set(false);
      },
      error: () => {
        this.setStatus('No se pudo eliminar', 'error');
        this.deleting.set(false);
      },
    });
  }

  userLabel(user: User): string {
    const name = `${user.nombre || ''} ${user.apellido || ''}`.trim() || user.email;
    return `${name} - ${user.tipo}`;
  }

  getContactInitials(contact: OperationalContact): string {
    const parts = this.fullContactName(contact).split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '') || 'C').toUpperCase();
  }

  fullContactName(contact: OperationalContact): string {
    return `${contact.nombre || ''} ${contact.apellido || ''}`.trim() || 'Sin nombre';
  }

  getContactCardClass(): string {
    if (this.variant === 'superadmin') {
      return 'rounded-3xl border border-slate-200/90 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.05)]';
    }

    return 'rounded-3xl border border-slate-200 bg-white p-4 shadow-sm';
  }

  getCardShellClass(): string {
    if (this.variant === 'superadmin') {
      return 'rounded-3xl border border-slate-200/90 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.05)]';
    }

    return 'rounded-3xl border border-slate-200 bg-white p-4 shadow-sm';
  }

  getEmptyStateClass(): string {
    if (this.variant === 'superadmin') {
      return 'rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-16 text-center shadow-[0_8px_30px_rgba(15,23,42,0.05)]';
    }

    return 'rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center';
  }

  private filterUsersForScope(users: User[]): User[] {
    if (!this.subEmpresaId) return users;

    return users.filter(
      (user) => user.sub_empresa_id === this.subEmpresaId || !user.sub_empresa_id,
    );
  }

  private setStatus(message: string, type: 'success' | 'error'): void {
    this.status.set(message);
    this.statusType.set(type);
  }

  private emptyForm(): ContactForm {
    return {
      usuario_id: '',
      tipo_contacto: 'Reporte DGA',
      nombre: '',
      apellido: '',
      email: '',
      telefonoDigits: '',
      cargo: '',
      notas: '',
    };
  }

  private extractPhoneDigits(value: string): string {
    const digits = value.replace(/\D/g, '');
    return digits.startsWith('56') ? digits.slice(2, 11) : digits.slice(0, 9);
  }
}
