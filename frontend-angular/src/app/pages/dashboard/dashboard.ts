import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CompanyService } from '../../services/company.service';

interface InstallationCard {
  id: string;
  name: string;
  companyName: string;
  subCompanyName: string;
  type: string;
  location: string;
  status: 'pending' | 'online' | 'offline';
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
})
export class DashboardComponent implements OnInit {
  private companyService = inject(CompanyService);
  private router = inject(Router);

  installations = signal<InstallationCard[]>([]);
  loading = signal(true);

  ngOnInit(): void {
    this.loadInstallations();
  }

  loadInstallations(): void {
    this.loading.set(true);

    this.companyService.fetchHierarchy().subscribe({
      next: (res: any) => {
        this.installations.set(res.ok ? this.flattenInstallations(res.data || []) : []);
        this.loading.set(false);
      },
      error: () => {
        this.installations.set([]);
        this.loading.set(false);
      },
    });
  }

  openInstallation(installation: InstallationCard): void {
    if (!installation.id) {
      return;
    }

    this.router.navigate(['/companies', installation.id, 'water']);
  }

  getStatusLabel(status: InstallationCard['status']): string {
    if (status === 'online') return 'En linea';
    if (status === 'offline') return 'Sin senal';
    return 'Pendiente';
  }

  getStatusClass(status: InstallationCard['status']): string {
    if (status === 'online') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (status === 'offline') return 'bg-rose-50 text-rose-700 ring-rose-200';
    return 'bg-slate-100 text-slate-500 ring-slate-200';
  }

  getTypeIcon(type: string): string {
    const normalized = (type || '').toLowerCase();
    if (normalized.includes('agua')) return 'water_drop';
    if (normalized.includes('elect')) return 'bolt';
    return 'sensors';
  }

  private flattenInstallations(tree: any[]): InstallationCard[] {
    return tree.flatMap((company: any) =>
      (company.subCompanies || []).flatMap((subCompany: any) =>
        (subCompany.sites || []).map((site: any) => ({
          id: site.id,
          name: this.pickFirst(site, ['descripcion', 'nombre', 'name', 'codigo']) || 'Instalacion',
          companyName: company.nombre || 'Empresa sin nombre',
          subCompanyName: subCompany.nombre || 'Division sin nombre',
          type: company.tipo_empresa || 'Instalacion',
          location: this.pickFirst(site, ['ubicacion', 'sector', 'alias', 'nombre_corto', 'site_code']) || 'Sin referencia',
          status: 'pending' as const,
        }))
      )
    );
  }

  private pickFirst(source: any, keys: string[]): string | null {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') {
        return `${value}`;
      }
    }

    return null;
  }
}
