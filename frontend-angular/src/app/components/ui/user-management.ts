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
import { formatRutInput } from '../../shared/rut';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6 animate-in fade-in duration-300">
      <!-- ═══════════════════════════════════════════════════ -->
      <!-- Formulario de invitación: solo si NO es readOnly -->
      <!-- ═══════════════════════════════════════════════════ -->
      @if (!readOnly) {
        <div class="bg-white border border-slate-200 rounded-3xl shadow-sm p-8">
          <div class="flex items-center gap-3 mb-8">
            <div class="w-10 h-10 bg-primary-tint-10 rounded-xl flex items-center justify-center">
              <span class="material-symbols-outlined text-primary-container">person_add</span>
            </div>
            <div>
              <h2 class="text-h6 font-bold text-slate-800">Invitar a un Nuevo Miembro</h2>
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

          <form (submit)="saveUser()" class="space-y-8">
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
                  >RUT del Usuario *</label
                >
                <input
                  required
                  [ngModel]="newUser.rut_usuario"
                  (ngModelChange)="updateNewUserRut($event)"
                  name="rut_usuario"
                  inputmode="text"
                  maxlength="12"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-body-sm"
                  placeholder="12.345.678-9"
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
                <span class="material-symbols-outlined text-lg">mail</span>
                {{ loading() ? 'Enviando...' : 'Invitar y Enviar Correo' }}
              </button>
            </div>
          </form>
        </div>
      }

      <!-- ═══════════════════════════════════════════════════ -->
      <!-- Tabla de usuarios: siempre visible                 -->
      <!-- ═══════════════════════════════════════════════════ -->
      <div
        class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
        [class.mt-8]="!readOnly"
      >
        <div
          class="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center"
        >
          <h3 class="text-caption font-semibold text-primary uppercase tracking-widest">
            {{ readOnly ? 'Equipo de ' + subName() : 'Usuarios en ' + subName() }}
          </h3>
          <span
            class="px-3 py-1 bg-primary-tint-14 text-primary-container rounded-full text-[10px] font-semibold"
            >{{ users().length }} Usuarios</span
          >
        </div>
        <table class="w-full text-left text-body-sm">
          <thead class="bg-slate-50/50 border-b border-slate-100">
            <tr>
              <th
                class="px-8 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
              >
                Nombre
              </th>
              <th
                class="px-8 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
              >
                Email
              </th>
              <th
                class="px-8 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px]"
              >
                Rol
              </th>
              @if (!readOnly) {
                <th
                  class="px-8 py-4 font-semibold text-slate-400 uppercase tracking-widest text-[10px] text-right"
                >
                  Acción
                </th>
              }
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            @for (user of users(); track user.id) {
              <tr class="hover:bg-slate-50/30 transition-colors">
                <td class="px-8 py-4 font-bold text-slate-700">
                  {{ user.nombre }} {{ user.apellido }}
                </td>
                <td class="px-8 py-4 text-slate-500">{{ user.email }}</td>
                <td class="px-8 py-4">
                  <span
                    [class]="
                      'px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-tight ' +
                      getRoleBadge(user.tipo)
                    "
                  >
                    {{ user.tipo }}
                  </span>
                </td>
                @if (!readOnly) {
                  <td class="px-8 py-4 text-right text-slate-300">
                    <button (click)="deleteUser(user.id)" class="hover:text-red-500 transition-all">
                      <span class="material-symbols-outlined text-lg">delete</span>
                    </button>
                  </td>
                }
              </tr>
            }

            @if (users().length === 0) {
              <tr>
                <td [attr.colspan]="readOnly ? 3 : 4" class="px-8 py-12 text-center">
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

  users = this.userService.users;
  loading = signal(false);
  status = signal({ type: '', msg: '' });

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

  updateNewUserRut(value: string) {
    this.newUser.rut_usuario = formatRutInput(value);
  }

  loadUsers() {
    if (this.subEmpresaId) {
      this.userService.fetchUsers({ sub_empresa_id: this.subEmpresaId }).subscribe();
    }
  }

  saveUser() {
    if (this.readOnly) return; // Double protection

    this.loading.set(true);
    this.status.set({ type: '', msg: '' });
    const submittedEmail = this.newUser.email.trim();
    const data = {
      ...this.newUser,
      empresa_id: this.empresaId,
      sub_empresa_id:
        this.newUser.tipo === 'Admin' && !this.auth.isGerente() ? '' : this.subEmpresaId,
      password: Math.random().toString(36).slice(-8),
    };

    this.userService.createUser(data).subscribe({
      next: (res: ApiResponse<User>) => {
        if (res.ok) {
          this.clearForm();
          this.status.set({
            type: 'success',
            msg: `Invitación enviada correctamente a ${submittedEmail}.`,
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
          'No se pudo enviar la invitación. Verifica tu conexión e intenta nuevamente.';
        this.status.set({ type: 'error', msg: detail });
        this.loading.set(false);
      },
    });
  }

  dismissStatus() {
    this.status.set({ type: '', msg: '' });
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
}
