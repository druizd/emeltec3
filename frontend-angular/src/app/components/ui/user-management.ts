import { Component, inject, Input, OnInit, signal, OnChanges, SimpleChanges, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../services/user.service';
import { CompanyService } from '../../services/company.service';
import { AuthService } from '../../services/auth.service';

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
            <div class="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <span class="material-symbols-outlined text-blue-600">person_add</span>
            </div>
            <div>
              <h2 class="text-lg font-bold text-slate-800">Invitar a un Nuevo Miembro</h2>
              <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                Jerarquía Real: {{ companyName() }} / {{ subName() }}
              </p>
            </div>
          </div>

          @if (status().msg) {
            <div [class]="'p-4 rounded-xl mb-6 flex items-center gap-3 font-bold text-xs uppercase tracking-widest transition-all ' + (status().type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200')">
              <span class="material-symbols-outlined">{{ status().type === 'success' ? 'check_circle' : 'error' }}</span>
              <span>{{ status().msg }}</span>
            </div>
          }

          <form (submit)="saveUser()" class="space-y-8">

            <div class="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
              <div class="space-y-1.5">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Seleccione el Perfil de Acceso *</label>
                <select required [(ngModel)]="newUser.tipo" name="tipo" class="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm font-black text-primary">
                  @if (auth.isAdmin() || auth.isSuperAdmin()) {
                    <option value="Admin">Administrador (Control Total {{ companyName() }})</option>
                  }
                  <option value="Gerente">Gerente (Encargado {{ subName() }})</option>
                  <option value="Cliente">Cliente (Lectura {{ subName() }})</option>
                </select>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-1.5 opacity-80">
                  <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Empresa Asignada</label>
                  <div class="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-600 flex items-center gap-2 shadow-sm">
                    <span class="material-symbols-outlined text-blue-500 text-sm">domain</span>
                    {{ companyName() }}
                  </div>
                </div>

                <div class="space-y-1.5" [class.opacity-40]="newUser.tipo === 'Admin'">
                  <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">División Asignada</label>
                  <div class="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-black flex items-center gap-2 shadow-sm"
                       [class.text-slate-400]="newUser.tipo === 'Admin'"
                       [class.text-primary-container]="newUser.tipo !== 'Admin'">
                    <span class="material-symbols-outlined text-sm">factory</span>
                    {{ newUser.tipo === 'Admin' ? 'Toda la Empresa' : subName() }}
                  </div>
                </div>
              </div>
            </div>

            <!-- DATOS PERSONALES -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-1.5">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nombre *</label>
                <input required [(ngModel)]="newUser.nombre" name="nombre" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm" placeholder="Ej. Roberto" />
              </div>
              <div class="space-y-1.5">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Apellido *</label>
                <input required [(ngModel)]="newUser.apellido" name="apellido" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm" placeholder="Ej. Sánchez" />
              </div>
              <div class="space-y-1.5">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">RUT del Usuario *</label>
                <input required [(ngModel)]="newUser.rut_usuario" name="rut_usuario" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm" placeholder="12.345.678-9" />
              </div>
              <div class="space-y-1.5">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Teléfono *</label>
                <input required [(ngModel)]="newUser.telefono" name="telefono" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm" placeholder="+56 9 ..." />
              </div>
              <div class="space-y-1.5 md:col-span-2">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Correo Electrónico *</label>
                <input required type="email" [(ngModel)]="newUser.email" name="email" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm font-bold" placeholder="usuario@correo.com" />
              </div>
              <div class="space-y-1.5 md:col-span-2">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cargo *</label>
                <input required [(ngModel)]="newUser.cargo" name="cargo" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-container/20 outline-none transition-all text-sm" placeholder="Ej. Encargado de sector de aguas" />
              </div>
            </div>

            <div class="pt-6 border-t border-slate-100 flex justify-end">
              <button type="submit" [disabled]="loading()" class="px-8 py-4 bg-primary-container text-white font-black rounded-xl transition-all shadow-xl shadow-blue-900/20 hover:opacity-90 active:scale-95 disabled:opacity-50 uppercase text-xs tracking-widest flex items-center gap-2">
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
      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden" [class.mt-8]="!readOnly">
        <div class="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 class="text-xs font-black text-primary uppercase tracking-widest">
            {{ readOnly ? 'Equipo de ' + subName() : 'Usuarios en ' + subName() }}
          </h3>
          <span class="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black">{{ users().length }} Usuarios</span>
        </div>
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50/50 border-b border-slate-100">
            <tr>
              <th class="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Nombre</th>
              <th class="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Email</th>
              <th class="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Rol</th>
              @if (!readOnly) {
                <th class="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Acción</th>
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
                  <span [class]="'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight ' + getRoleBadge(user.tipo)">
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
                  <span class="material-symbols-outlined text-slate-300 text-4xl mb-2">group_off</span>
                  <p class="text-slate-400 font-bold text-sm">Sin usuarios registrados</p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `
})
export class UserManagementComponent implements OnInit, OnChanges {
  userService = inject(UserService);
  companyService = inject(CompanyService);
  auth = inject(AuthService);

  @Input() subEmpresaId: string = '';
  @Input() empresaId: string = '';
  @Input() readOnly: boolean = false;

  inputEmpresaId = signal('');
  inputSubEmpresaId = signal('');

  users = this.userService.users;
  loading = signal(false);
  status = signal({ type: '', msg: '' });

  companyName = computed(() => {
    const tree = this.companyService.hierarchy();
    const id = this.inputEmpresaId();
    if (!id || tree.length === 0) return 'Buscando Empresa...';
    const emp = tree.find(e => e.id === id);
    return emp?.nombre || 'Desconocida';
  });

  subName = computed(() => {
    const tree = this.companyService.hierarchy();
    const id = this.inputSubEmpresaId();
    const parentId = this.inputEmpresaId();
    if (!id || tree.length === 0) return 'Buscando División...';

    const emp = tree.find(e => e.id === parentId);
    const sub = emp?.subCompanies?.find((s: any) => s.id === id);
    return sub?.nombre || 'Desconocida';
  });

  newUser: any = {
    nombre: '', apellido: '', rut_usuario: '', email: '',
    telefono: '', cargo: '', tipo: 'Gerente',
    empresa_id: '', sub_empresa_id: ''
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

  resetForm() {
    this.newUser = {
      nombre: '', apellido: '', rut_usuario: '', email: '',
      telefono: '', cargo: '', tipo: 'Gerente',
      empresa_id: this.empresaId,
      sub_empresa_id: this.subEmpresaId
    };
    this.status.set({ type: '', msg: '' });
  }

  loadUsers() {
    if (this.subEmpresaId) {
      this.userService.fetchUsers({ sub_empresa_id: this.subEmpresaId }).subscribe();
    }
  }

  saveUser() {
    if (this.readOnly) return; // Double protection

    this.loading.set(true);
    const data = {
      ...this.newUser,
      empresa_id: this.empresaId,
      sub_empresa_id: (this.newUser.tipo === 'Admin' && !this.auth.isGerente()) ? '' : this.subEmpresaId,
      password: Math.random().toString(36).slice(-8)
    };

    this.userService.createUser(data).subscribe({
      next: (res: any) => {
        if (res.ok) {
          this.status.set({ type: 'success', msg: 'Invitación enviada.' });
          this.loadUsers();
          this.resetForm();
        }
        this.loading.set(false);
      },
      error: () => {
        this.status.set({ type: 'error', msg: 'Error al crear.' });
        this.loading.set(false);
      }
    });
  }

  deleteUser(id: string) {
    if (this.readOnly) return; // Double protection

    if (confirm('¿Eliminar este usuario?')) {
      this.userService.deleteUser(id).subscribe(() => this.loadUsers());
    }
  }

  getRoleBadge(tipo: string): string {
    switch (tipo) {
      case 'SuperAdmin': return 'bg-purple-100 text-purple-700';
      case 'Admin': return 'bg-blue-100 text-blue-700';
      case 'Gerente': return 'bg-emerald-100 text-emerald-700';
      case 'Cliente': return 'bg-slate-100 text-slate-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  }
}
