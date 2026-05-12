import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
} from '@angular/core';
import { UserService } from '../../../services/user.service';
import type { ApiResponse, User } from '@emeltec/shared';

@Component({
  selector: 'app-companies-contacts-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      [class]="
        variant === 'superadmin'
          ? 'animate-in fade-in duration-500'
          : 'animate-in fade-in duration-500 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm'
      "
    >
      @if (variant !== 'superadmin') {
        <div class="mb-8">
          <h3
            class="mb-2 border-l-4 border-primary-container pl-4 text-sm font-black uppercase tracking-widest text-primary"
          >
            Contactos
          </h3>
          <p class="pl-4 text-sm text-slate-400">
            Personal asociado a {{ selectedLabel || 'la division seleccionada' }}
          </p>
        </div>
      }

      @if (loading()) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (item of skeletonItems; track item) {
            <div [class]="getCardShellClass()">
              <div class="mb-4 flex items-start gap-3">
                <div class="skeleton h-10 w-10 rounded-xl"></div>
                <div class="space-y-2">
                  <div class="skeleton h-4 w-28 rounded-full"></div>
                  <div class="skeleton h-3 w-20 rounded-full"></div>
                </div>
              </div>
              <div class="space-y-2.5">
                <div class="skeleton h-10 w-full rounded-xl"></div>
                <div class="skeleton h-10 w-full rounded-xl"></div>
                <div class="skeleton h-10 w-full rounded-xl"></div>
              </div>
            </div>
          }
        </div>
      } @else if (contacts().length > 0) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (contact of contacts(); track contact.id ?? contact.email) {
            <article [class]="getContactCardClass()">
              <div class="mb-4 flex items-start gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 text-[11px] font-black text-white shadow-sm"
                  >
                    {{ getContactInitials(contact) }}
                  </div>

                  <div class="min-w-0">
                    <h4 class="truncate text-[14px] font-black text-slate-800">
                      {{ getContactName(contact) }}
                    </h4>
                    <p class="truncate text-[11px] font-semibold text-cyan-700">
                      {{ getContactRole(contact) }}
                    </p>
                  </div>
                </div>
              </div>

              <div class="space-y-2.5">
                <div
                  class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[17px] text-cyan-600"
                    >badge</span
                  >
                  <div class="min-w-0">
                    <p class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                      Cargo
                    </p>
                    <p class="break-words text-[13px] font-semibold text-slate-700">
                      {{ getContactPosition(contact) }}
                    </p>
                  </div>
                </div>

                <div
                  class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[17px] text-cyan-600"
                    >call</span
                  >
                  <div class="min-w-0">
                    <p class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                      Teléfono
                    </p>
                    <p class="break-words text-[13px] font-semibold text-slate-700">
                      {{ getContactPhone(contact) }}
                    </p>
                  </div>
                </div>

                <div
                  class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[17px] text-cyan-600"
                    >mail</span
                  >
                  <div class="min-w-0">
                    <p class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                      Correo
                    </p>
                    <p class="break-all text-[13px] font-semibold text-slate-700">
                      {{ getContactEmail(contact) }}
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
          <p class="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Sin contactos registrados
          </p>
          <p class="mt-2 max-w-md text-sm text-slate-400">
            No hay personas asociadas a {{ selectedLabel || 'esta division' }} por ahora.
          </p>
        </div>
      }
    </section>
  `,
})
export class CompaniesContactsPanelComponent implements OnChanges {
  private readonly userService = inject(UserService);

  @Input() empresaId = '';
  @Input() subEmpresaId = '';
  @Input() selectedLabel = '';
  @Input() variant: 'default' | 'superadmin' = 'default';

  @Output() contactsCountChange = new EventEmitter<number>();

  readonly contacts = signal<User[]>([]);
  readonly loading = signal(false);
  readonly skeletonItems = Array.from({ length: 3 }, (_, index) => index);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['empresaId'] || changes['subEmpresaId']) {
      this.loadContacts();
    }
  }

  loadContacts(): void {
    const filters = this.empresaId ? { empresa_id: this.empresaId } : null;

    if (!filters) {
      this.contacts.set([]);
      this.contactsCountChange.emit(0);
      return;
    }

    this.loading.set(true);
    this.userService.getUsers(filters).subscribe({
      next: (res: ApiResponse<User[]>) => {
        const users: User[] = res?.ok ? (res.data ?? []) : [];
        const filteredUsers = this.subEmpresaId
          ? users.filter(
              (user) => user.sub_empresa_id === this.subEmpresaId || !user.sub_empresa_id,
            )
          : users;

        this.contacts.set(filteredUsers);
        this.contactsCountChange.emit(filteredUsers.length);
        this.loading.set(false);
      },
      error: () => {
        this.contacts.set([]);
        this.contactsCountChange.emit(0);
        this.loading.set(false);
      },
    });
  }

  getContactName(contact: User): string {
    const firstName = contact?.nombre?.trim?.() || '';
    const lastName = contact?.apellido?.trim?.() || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || 'Sin nombre';
  }

  getContactPosition(contact: User): string {
    return contact?.cargo?.trim?.() || 'Cargo no asignado';
  }

  getContactPhone(contact: User): string {
    return contact?.telefono?.trim?.() || 'Sin numero registrado';
  }

  getContactEmail(contact: User): string {
    return contact?.email?.trim?.() || 'Sin correo registrado';
  }

  getContactRole(contact: User): string {
    return contact?.tipo?.trim?.() || 'Usuario';
  }

  getContactInitials(contact: User): string {
    const first = contact?.nombre?.charAt?.(0) ?? '';
    const last = contact?.apellido?.charAt?.(0) ?? '';
    const initials = `${first}${last}`.trim();

    return (initials || first || 'U').toUpperCase();
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
}
