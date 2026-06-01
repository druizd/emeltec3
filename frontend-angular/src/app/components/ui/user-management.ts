import {
  Component,
  inject,
  Input,
  OnInit,
  signal,
  OnChanges,
  SimpleChanges,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../services/user.service';
import { CompanyService } from '../../services/company.service';
import { AuthService } from '../../services/auth.service';
import type { ApiResponse, CreateUserPayload, User } from '@emeltec/shared';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6 animate-in fade-in duration-300">
      <!-- ═══════════════════════════════════════════════════ -->
      <!-- Formulario de registro: solo si NO es readOnly -->
      <!-- ═══════════════════════════════════════════════════ -->
      @if (!readOnly) {
        <div class="bg-white border border-slate-200 rounded-3xl shadow-sm p-8">
          <div class="flex items-center gap-3 mb-8">
            <div class="w-10 h-10 bg-primary-tint-10 rounded-xl flex items-center justify-center">
              <span class="material-symbols-outlined text-primary-container">person_add</span>
            </div>
            <div>
              <h2 class="text-h6 font-bold text-slate-800">Registrar nuevo miembro</h2>
              <p class="text-[10px] text-slate-400 font-semibold uppercase tracking-widest mt-1">
                Jerarquía Real: {{ companyName() }} / {{ subName() }}
              </p>
            </div>
          </div>

          @if (status().msg) {
            <div
              [class]="
                'p-4 rounded-xl mb-6 flex items-start gap-3 transition-all ' +
                (status().type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200')
              "
              role="status"
              [attr.aria-live]="status().type === 'error' ? 'assertive' : 'polite'"
            >
              <span class="material-symbols-outlined mt-0.5">{{
                status().type === 'success' ? 'check_circle' : 'error'
              }}</span>
              <div class="flex-1 min-w-0">
                <p
                  class="font-bold text-caption uppercase tracking-widest"
                  [class.text-emerald-700]="status().type === 'success'"
                  [class.text-red-700]="status().type === 'error'"
                >
                  {{ status().type === 'success' ? 'Registro confirmado' : 'No se pudo registrar' }}
                </p>
                <p class="mt-1 text-body-sm font-semibold break-words">{{ status().msg }}</p>
                @if (status().type === 'error') {
                  <p class="mt-1 text-caption text-red-600">
                    Revisa los datos e intenta nuevamente.
                  </p>
                }
              </div>
              <button
                type="button"
                (click)="dismissStatus()"
                class="shrink-0 rounded-md p-1 text-current/70 hover:bg-black/5 transition-colors"
                aria-label="Cerrar mensaje"
              >
                <span class="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          }

          <form (submit)="saveUser($event)" class="space-y-8">
            <div class="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
              <div class="space-y-1.5">
                <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                  >1. Seleccione el Perfil de Acceso *</label
                >
                <select
                  required
                  [(ngModel)]="newUser.tipo"
                  name="tipo"
                  class="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm font-semibold text-primary"
                >
                  @if (auth.isAdmin() || auth.isSuperAdmin()) {
                    <option value="Admin">Administrador (Control Total {{ companyName() }})</option>
                  }
                  <option value="Gerente">Gerente (Encargado {{ subName() }})</option>
                  <option value="Cliente">Cliente (Lectura {{ subName() }})</option>
                </select>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-1.5 opacity-80">
                  <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                    >Empresa Asignada</label
                  >
                  <div
                    class="px-4 py-3 bg-white border border-slate-200 rounded-xl text-body-sm font-semibold text-slate-600 flex items-center gap-2 shadow-sm"
                  >
                    <span class="material-symbols-outlined text-primary-container text-sm"
                      >domain</span
                    >
                    {{ companyName() }}
                  </div>
                </div>

                <div class="space-y-1.5" [class.opacity-40]="newUser.tipo === 'Admin'">
                  <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                    >División Asignada</label
                  >
                  <div
                    class="px-4 py-3 bg-white border border-slate-200 rounded-xl text-body-sm font-semibold flex items-center gap-2 shadow-sm"
                    [class.text-slate-400]="newUser.tipo === 'Admin'"
                    [class.text-primary-container]="newUser.tipo !== 'Admin'"
                  >
                    <span class="material-symbols-outlined text-sm">factory</span>
                    {{ newUser.tipo === 'Admin' ? 'Toda la Empresa' : subName() }}
                  </div>
                </div>
              </div>
            </div>

            <!-- DATOS PERSONALES -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-1.5">
                <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                  >Nombre *</label
                >
                <input
                  required
                  [(ngModel)]="newUser.nombre"
                  name="nombre"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm"
                  placeholder="Ej. Roberto"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                  >Apellido *</label
                >
                <input
                  required
                  [(ngModel)]="newUser.apellido"
                  name="apellido"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm"
                  placeholder="Ej. Sánchez"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                  >Teléfono *</label
                >
                <input
                  required
                  [(ngModel)]="newUser.telefono"
                  name="telefono"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm"
                  placeholder="+56 9 ..."
                />
              </div>
              <div class="space-y-1.5 md:col-span-2">
                <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                  >Correo Electrónico *</label
                >
                <input
                  required
                  type="email"
                  [(ngModel)]="newUser.email"
                  name="email"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm font-bold"
                  placeholder="usuario@correo.com"
                />
              </div>
              <div class="space-y-1.5 md:col-span-2">
                <label class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest"
                  >Cargo *</label
                >
                <input
                  required
                  [(ngModel)]="newUser.cargo"
                  name="cargo"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm"
                  placeholder="Ej. Encargado de sector de aguas"
                />
              </div>
            </div>

            <div class="pt-6 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                [disabled]="loading()"
                class="px-8 py-4 bg-primary-container text-white font-semibold rounded-xl transition-all shadow-primary-cta hover:opacity-90 active:scale-95 disabled:opacity-50 uppercase text-caption tracking-widest flex items-center gap-2"
              >
                <span class="material-symbols-outlined text-lg">person_add</span>
                {{ loading() ? 'Guardando...' : 'Crear usuario' }}
              </button>
            </div>
          </form>
        </div>
      }

      <!-- ═══════════════════════════════════════════════════ -->
      <!-- Tabla de usuarios: siempre visible                 -->
      <!-- ═══════════════════════════════════════════════════ -->
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div
          class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-5"
        >
          <div class="min-w-[240px] flex-1">
            <h3 class="text-caption font-semibold text-primary uppercase tracking-widest">
              {{ readOnly ? 'Equipo de ' + subName() : 'Usuarios en ' + subName() }}
            </h3>
            <label class="mt-3 block max-w-sm">
              <span class="sr-only">Buscar usuario por nombre, correo o alcance</span>
              <span class="relative block">
                <span
                  class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-slate-300"
                  >search</span
                >
                <input
                  type="search"
                  [ngModel]="userSearch()"
                  (ngModelChange)="setUserSearch($event)"
                  placeholder="Buscar nombre, correo o empresa..."
                  class="h-9 w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-caption font-semibold text-[#1E293B] outline-none transition-colors placeholder:text-slate-400 focus:border-primary-tint-40 focus:ring-2 focus:ring-primary-tint-20"
                />
              </span>
            </label>
          </div>
          <span
            class="shrink-0 rounded-full bg-primary-tint-14 px-3 py-1 text-[10px] font-semibold text-primary-container"
            >{{ filteredUsers().length }} Usuarios</span
          >
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-body-sm">
            <thead class="bg-slate-50/50 border-b border-slate-100">
              <tr>
                <th
                  class="px-6 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
                >
                  Nombre
                </th>
                <th
                  class="px-6 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
                >
                  Email
                </th>
                <th
                  class="px-6 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
                >
                  Rol
                </th>
                <th
                  class="px-6 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
                >
                  Alcance
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (user of paginatedUsers(); track user.id) {
                <tr class="hover:bg-slate-50/30 transition-colors">
                  <td class="px-6 py-4 font-bold text-slate-700">
                    {{ user.nombre }} {{ user.apellido }}
                  </td>
                  <td class="px-6 py-4 text-slate-500">{{ user.email }}</td>
                  <td class="px-6 py-4">
                    <span
                      [class]="
                        'px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-tight ' +
                        getRoleBadge(user.tipo)
                      "
                    >
                      {{ user.tipo }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-slate-500">
                    <span class="block text-caption font-semibold text-slate-700">
                      {{ getUserScopeLabel(user) }}
                    </span>
                  </td>
                </tr>
              }

              @if (filteredUsers().length === 0) {
                <tr>
                  <td colspan="4" class="px-6 py-10 text-center">
                    <span class="material-symbols-outlined text-slate-300 text-4xl mb-2"
                      >group_off</span
                    >
                    <p class="text-slate-400 font-bold text-body-sm">Sin usuarios registrados</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (filteredUsers().length > pageSize) {
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4"
          >
            <p class="text-caption font-semibold text-slate-500">
              Mostrando {{ pageRange().start }}-{{ pageRange().end }} de
              {{ filteredUsers().length }} usuarios
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="previousUserPage()"
                [disabled]="userPage() === 1"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary-tint-40 hover:text-primary-container disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Pagina anterior"
              >
                <span class="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <span class="min-w-16 text-center text-caption font-bold text-slate-600">
                {{ userPage() }} / {{ totalUserPages() }}
              </span>
              <button
                type="button"
                (click)="nextUserPage()"
                [disabled]="userPage() === totalUserPages()"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary-tint-40 hover:text-primary-container disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Pagina siguiente"
              >
                <span class="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class UserManagementComponent implements OnInit, OnChanges {
  userService = inject(UserService);
  companyService = inject(CompanyService);
  auth = inject(AuthService);

  @Input() subEmpresaId = '';
  @Input() empresaId = '';
  @Input() readOnly = false;

  inputEmpresaId = signal('');
  inputSubEmpresaId = signal('');

  users = signal<User[]>([]);
  userSearch = signal('');
  userPage = signal(1);
  loading = signal(false);
  status = signal({ type: '', msg: '' });
  readonly pageSize = 10;

  filteredUsers = computed(() => {
    const query = this.normalizeSearch(this.userSearch());
    const users = this.sortUsersByRole(this.users());

    if (!query) return users;

    return users.filter((user) => this.getUserSearchText(user).includes(query));
  });

  totalUserPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredUsers().length / this.pageSize)),
  );

  paginatedUsers = computed(() => {
    const page = Math.min(this.userPage(), this.totalUserPages());
    const start = (page - 1) * this.pageSize;
    return this.filteredUsers().slice(start, start + this.pageSize);
  });

  pageRange = computed(() => {
    const total = this.filteredUsers().length;
    if (total === 0) return { start: 0, end: 0 };

    const page = Math.min(this.userPage(), this.totalUserPages());
    const start = (page - 1) * this.pageSize + 1;
    const end = Math.min(start + this.pageSize - 1, total);
    return { start, end };
  });

  companyName = computed(() => {
    const tree = this.companyService.hierarchy();
    const id = this.inputEmpresaId();
    if (!id || tree.length === 0) return 'Buscando Empresa...';
    const emp = tree.find((e) => e.id === id);
    return emp?.nombre || 'Desconocida';
  });

  subName = computed(() => {
    const tree = this.companyService.hierarchy();
    const id = this.inputSubEmpresaId();
    const parentId = this.inputEmpresaId();
    if (!id || tree.length === 0) return 'Buscando División...';

    const emp = tree.find((e) => e.id === parentId);
    const sub = emp?.subCompanies?.find((s) => s.id === id);
    return sub?.nombre || 'Desconocida';
  });

  newUser: CreateUserPayload = {
    nombre: '',
    apellido: '',
    rut_usuario: '',
    email: '',
    telefono: '',
    cargo: '',
    tipo: 'Gerente',
    empresa_id: '',
    sub_empresa_id: '',
  };

  ngOnInit() {
    this.updateInputs();
    this.resetForm();
    this.loadUsers();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['subEmpresaId'] || changes['empresaId']) {
      this.updateInputs();
      this.resetForm();
      this.userSearch.set('');
      this.userPage.set(1);
      this.loadUsers();
    }
  }

  updateInputs() {
    this.inputEmpresaId.set(this.empresaId);
    this.inputSubEmpresaId.set(this.subEmpresaId);
  }

  clearForm() {
    this.newUser = {
      nombre: '',
      apellido: '',
      rut_usuario: '',
      email: '',
      telefono: '',
      cargo: '',
      tipo: 'Gerente',
      empresa_id: this.empresaId,
      sub_empresa_id: this.subEmpresaId,
    };
  }

  resetForm() {
    this.clearForm();
    this.status.set({ type: '', msg: '' });
  }

  setUserSearch(value: string) {
    this.userSearch.set(value || '');
    this.userPage.set(1);
  }

  loadUsers() {
    if (this.empresaId) {
      this.userService.getUsers({ empresa_id: this.empresaId }).subscribe({
        next: (res) => {
          const users = res.ok ? (res.data ?? []) : [];
          this.users.set(this.filterUsersForCurrentScope(users));
          this.userPage.set(1);
        },
        error: () => this.users.set([]),
      });
      return;
    }

    this.users.set([]);
    this.userPage.set(1);
  }

  saveUser(event?: Event) {
    event?.preventDefault();
    if (this.readOnly) return; // Double protection

    this.loading.set(true);
    this.status.set({ type: '', msg: '' });
    const submittedEmail = this.newUser.email.trim();

    const data = {
      ...this.newUser,
      empresa_id: this.empresaId,
      sub_empresa_id:
        this.newUser.tipo === 'Admin' && !this.auth.isGerente() ? '' : this.subEmpresaId,
    };

    this.userService.createUser(data).subscribe({
      next: (res: ApiResponse<User>) => {
        if (res.ok) {
          this.clearForm();
          this.status.set({
            type: 'success',
            msg: `Usuario creado correctamente para ${submittedEmail}.`,
          });
          this.loadUsers();
        } else {
          this.status.set({
            type: 'error',
            msg: res.error || 'No fue posible registrar al usuario.',
          });
        }
        this.loading.set(false);
      },
      error: (err) => {
        const detail =
          err?.error?.error ||
          err?.error?.message ||
          err?.message ||
          'No se pudo crear el usuario. Verifica tu conexion e intenta nuevamente.';
        this.status.set({ type: 'error', msg: detail });
        this.loading.set(false);
      },
    });
  }

  dismissStatus() {
    this.status.set({ type: '', msg: '' });
  }

  previousUserPage() {
    this.userPage.set(Math.max(1, this.userPage() - 1));
  }

  nextUserPage() {
    this.userPage.set(Math.min(this.totalUserPages(), this.userPage() + 1));
  }

  deleteUser(id: string) {
    if (this.readOnly) return; // Double protection

    if (confirm('¿Eliminar este usuario?')) {
      this.userService.deleteUser(id).subscribe(() => this.loadUsers());
    }
  }

  getRoleBadge(tipo: string): string {
    switch (tipo) {
      case 'SuperAdmin':
        return 'bg-purple-100 text-purple-700';
      case 'Admin':
        return 'bg-primary-tint-14 text-primary-container';
      case 'Gerente':
        return 'bg-emerald-100 text-emerald-700';
      case 'Cliente':
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }

  getUserScopeLabel(user: User): string {
    if (user.tipo === 'SuperAdmin') return 'Toda la plataforma';
    const company = user.empresa_nombre || this.companyName();
    const subCompany = user.sub_empresa_nombre || (user.sub_empresa_id ? this.subName() : '');
    return subCompany ? `${company} / ${subCompany}` : company;
  }

  private filterUsersForCurrentScope(users: User[]): User[] {
    if (!this.subEmpresaId) return users;

    return users.filter((user) => {
      if (user.tipo === 'Admin' && user.empresa_id === this.empresaId) return true;
      return user.sub_empresa_id === this.subEmpresaId;
    });
  }

  private sortUsersByRole(users: User[]): User[] {
    const order: Record<string, number> = {
      SuperAdmin: 0,
      Admin: 1,
      Gerente: 2,
      Cliente: 3,
    };

    return [...users].sort((a, b) => {
      const byRole = (order[a.tipo] ?? 99) - (order[b.tipo] ?? 99);
      if (byRole !== 0) return byRole;
      return `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`, 'es');
    });
  }

  private getUserSearchText(user: User): string {
    return this.normalizeSearch(
      [
        user.nombre,
        user.apellido,
        user.email,
        user.tipo,
        user.cargo,
        user.empresa_nombre,
        user.sub_empresa_nombre,
        this.getUserScopeLabel(user),
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  private normalizeSearch(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
