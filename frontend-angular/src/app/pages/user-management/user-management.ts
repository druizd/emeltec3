import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.html'
})
export class UserManagementComponent implements OnInit {
  private http = inject(HttpClient);
  auth = inject(AuthService);

  empresas = signal<any[]>([]);
  loading = signal(false);
  status = signal<{ type: string; msg: string }>({ type: '', msg: '' });
  formData = signal({
    nombre: '', apellido: '', email: '', telefono: '',
    cargo: '', tipo: 'Cliente', empresa_id: '', sub_empresa_id: ''
  });

  get user() { return this.auth.user(); }

  get selectedEmpresaSubEmpresas(): any[] {
    const emp = this.empresas().find(e => e.id === this.formData().empresa_id);
    return emp?.sub_empresas || [];
  }

  ngOnInit(): void {
    this.http.get<any>('/api/users/empresas').subscribe({
      next: (res) => { if (res.ok) this.empresas.set(res.data); }
    });
  }

  updateFormField(field: string, value: string): void {
    this.formData.update(f => ({ ...f, [field]: value }));
  }

  updateEmpresaId(value: string): void {
    this.formData.update(f => ({ ...f, empresa_id: value, sub_empresa_id: '' }));
  }

  handleSubmit(event: Event): void {
    event.preventDefault();
    this.loading.set(true);
    this.status.set({ type: '', msg: '' });

    this.http.post<any>('/api/users', this.formData()).subscribe({
      next: (res) => {
        if (res.ok) {
          this.status.set({ type: 'success', msg: res.message });
          this.formData.update(f => ({ ...f, nombre: '', apellido: '', email: '', telefono: '', cargo: '' }));
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.status.set({ type: 'error', msg: err.error?.error || 'Error al crear el usuario.' });
        this.loading.set(false);
      }
    });
  }
}
