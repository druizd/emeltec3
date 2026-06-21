import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { CompanyNode, SiteRecord } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import { normalizeSiteType } from '../../shared/site-type-ui';
import { VentisquerosComponent } from './ventisqueros';

/**
 * Página ruteable del general de cámara de frío (mapa + salas + tabs).
 * El VentisquerosComponent es embebido por diseño (recibe siteId por input), así
 * que este wrapper resuelve el contexto desde la jerarquía y lo monta como ruta.
 * Accesible para todos los roles; la pestaña "TAP (técnico)" interna se oculta a
 * no-admin dentro del propio VentisquerosComponent.
 */
@Component({
  selector: 'app-cold-room-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VentisquerosComponent],
  template: `
    @if (ready() && siteId()) {
      <app-ventisqueros
        [siteId]="siteId()"
        [siteName]="siteName()"
        [companyName]="companyName()"
        [coldRoomSites]="coldRoomSites()"
        [embedded]="true"
        view="full"
      />
    }
  `,
})
export class ColdRoomPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly companyService = inject(CompanyService);

  readonly siteId = signal<string>('');
  readonly siteName = signal<string>('');
  readonly companyName = signal<string>('');
  readonly coldRoomSites = signal<SiteRecord[]>([]);
  readonly ready = signal<boolean>(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('siteId') || '';
    if (!id) {
      this.router.navigate(['/companies']);
      return;
    }
    this.siteId.set(id);
    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (res.ok) this.resolveContext(res.data, id);
        this.ready.set(true);
      },
      error: () => this.ready.set(true),
    });
  }

  private resolveContext(tree: CompanyNode[], id: string): void {
    for (const company of tree) {
      for (const sub of company.subCompanies || []) {
        const sites = sub.sites || [];
        const site = sites.find((s) => s.id === id);
        if (site) {
          this.siteName.set(site.descripcion || '');
          this.companyName.set(sub.nombre || company.nombre || '');
          this.coldRoomSites.set(
            sites.filter((s) => normalizeSiteType(s.tipo_sitio) === 'camara_frio'),
          );
          return;
        }
      }
    }
  }
}
