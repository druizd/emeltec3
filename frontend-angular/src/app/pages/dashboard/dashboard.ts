import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CompanyService } from '../../services/company.service';
import type { ApiResponse, CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';

interface InstallationCard {
  id: string;
  name: string;
  companyName: string;
  subCompanyName: string;
  type: string;
  location: string;
  depth: string | null;
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
      next: (res: ApiResponse<CompanyNode[]>) => {
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
    if (!installation.id) return;
    this.router.navigate(['/companies', installation.id, 'water']);
  }

  getStatusLabel(status: InstallationCard['status']): string {
    if (status === 'online') return 'En vivo';
    if (status === 'offline') return 'Sin datos';
    return 'Sin datos';
  }

  getStatusColor(status: InstallationCard['status']): string {
    if (status === 'online') return '#22c55e';
    return '#94a3b8';
  }

  getTypeIcon(type: string): string {
    const normalized = (type || '').toLowerCase();
    if (normalized.includes('agua')) return 'water_drop';
    if (normalized.includes('elect')) return 'bolt';
    if (normalized.includes('ril')) return 'waves';
    if (normalized.includes('proceso')) return 'memory';
    return 'sensors';
  }

  private flattenInstallations(tree: CompanyNode[]): InstallationCard[] {
    return tree.flatMap((company: CompanyNode) =>
      (company.subCompanies || []).flatMap((subCompany: SubCompanyNode) =>
        (subCompany.sites || []).map((site: SiteRecord) => ({
          id: site.id,
          name: this.pickFirst(site, ['descripcion', 'nombre', 'name', 'codigo']) || 'Instalacion',
          companyName: company.nombre || 'Empresa sin nombre',
          subCompanyName: subCompany.nombre || 'Division sin nombre',
          type: company.tipo_empresa || 'Instalacion',
          location:
            this.pickFirst(site, ['ubicacion', 'sector', 'alias', 'nombre_corto', 'site_code']) ||
            subCompany.nombre ||
            'Sin referencia',
          depth: this.pickFirst(site, [
            'profundidad',
            'profundidad_m',
            'prof_total',
            'depth',
            'profundidad_pozo',
          ]),
          status: 'pending' as const,
        })),
      ),
    );
  }

  private pickFirst(source: object, keys: string[]): string | null {
    for (const key of keys) {
      const value = (source as Record<string, unknown>)?.[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') {
        return `${value}`;
      }
    }

    return null;
  }
}
