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
    if (!installation.id) return;
    this.router.navigate(['/companies', installation.id, 'water']);
  }

  getStatusLabel(status: InstallationCard['status']): string {
    if (status === 'online') return 'En vivo';
    if (status === 'offline') return 'Sin datos';
    return 'Sin datos';
  }

  getStatusColor(status: InstallationCard['status']): string {
    if (status === 'online') return '#22C55E';
    return '#94A3B8';
  }

  getTypeIcon(type: string): string {
    const n = (type || '').toLowerCase();
    if (n.includes('agua')) return 'water_drop';
    if (n.includes('elect')) return 'bolt';
    if (n.includes('riles')) return 'waves';
    if (n.includes('proceso')) return 'memory';
    return 'sensors';
  }

  onCardHover(event: MouseEvent, inst: InstallationCard, enter: boolean): void {
    const el = event.currentTarget as HTMLElement;
    if (enter) {
      el.style.background = '#F8FAFC';
      el.style.borderColor = inst.status === 'online' ? 'rgba(34,197,94,0.4)' : 'rgba(13,175,189,0.3)';
    } else {
      el.style.background = '#FFFFFF';
      el.style.borderColor = inst.status === 'online' ? 'rgba(34,197,94,0.25)' : '#E2E8F0';
    }
  }

  private flattenInstallations(tree: any[]): InstallationCard[] {
    return tree.flatMap((company: any) =>
      (company.subCompanies || []).flatMap((subCompany: any) =>
        (subCompany.sites || []).map((site: any) => ({
          id: site.id,
          name: this.pickFirst(site, ['descripcion', 'nombre', 'name', 'codigo']) || 'Instalación',
          companyName: company.nombre || 'Empresa sin nombre',
          subCompanyName: subCompany.nombre || 'División sin nombre',
          type: company.tipo_empresa || 'Instalación',
          location: this.pickFirst(site, ['ubicacion', 'sector', 'alias', 'nombre_corto', 'site_code']) || 'Sin referencia',
          status: 'pending' as const,
        }))
      )
    );
  }

  private pickFirst(source: any, keys: string[]): string | null {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') return `${value}`;
    }
    return null;
  }
}
