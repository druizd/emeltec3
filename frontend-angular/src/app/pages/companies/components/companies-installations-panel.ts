import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, concatMap, from, map, of } from 'rxjs';
import { SiteCardComponent } from '../../../components/ui/site-card';
import { VentisquerosComponent } from '../../ventisqueros/ventisqueros';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import { CompanyService } from '../../../services/company.service';
import type { SiteRecord } from '@emeltec/shared';

@Component({
  selector: 'app-companies-installations-panel',
  standalone: true,
  imports: [CommonModule, SiteCardComponent, VentisquerosComponent],
  template: `
    @if (coldRoomSite(); as coldSite) {
      <app-ventisqueros
        [siteId]="coldSite.id"
        [siteName]="coldSite.descripcion"
        [companyName]="contextLabel"
        [coldRoomSites]="coldRoomSites()"
        [embedded]="true"
        view="full"
      />
    } @else {
      <div [class]="getGridClass()">
        @for (site of sites; track site.id) {
          <app-site-card
            [site]="site"
            [contextLabel]="contextLabel"
            [variant]="variant"
            [lastSeenAt]="lastSeenMap()[site.id] ?? null"
            (siteSelected)="siteSelected.emit($event)"
          />
        }

        @if (sites.length === 0 && !loading) {
          <div [class]="getEmptyStateClass()">
            <span class="material-symbols-outlined text-slate-300 text-5xl mb-4">inventory_2</span>
            <p
              [class]="
                variant === 'superadmin'
                  ? 'text-slate-500 text-body-sm font-semibold'
                  : 'text-slate-400 font-bold uppercase tracking-widest'
              "
            >
              No hay instalaciones registradas
            </p>
          </div>
        }
      </div>
    }
  `,
})
export class CompaniesInstallationsPanelComponent {
  private readonly companyService = inject(CompanyService);
  private readonly destroyRef = inject(DestroyRef);

  @Input() set sites(value: SiteRecord[]) {
    this._sites.set(value || []);
    this.startFreshnessProbe();
  }
  get sites(): SiteRecord[] {
    return this._sites();
  }
  private _sites = signal<SiteRecord[]>([]);

  /**
   * Última lectura ISO por sitio, resuelta uno-a-uno (ver
   * `startFreshnessProbe`). El card la lee vía [lastSeenAt] y pinta verde
   * "En vivo" si <1h, sino gris "Sin datos".
   */
  readonly lastSeenMap = signal<Record<string, string | null>>({});
  private probeSub?: Subscription;

  @Input() loading = false;
  @Input() contextLabel = '';
  @Input() variant: 'default' | 'superadmin' = 'default';

  @Output() siteSelected = new EventEmitter<SiteRecord>();

  /**
   * Probe de frescura SECUENCIAL (concatMap → un request a la vez) para
   * evitar sobrecargar el backend cuando hay muchas instalaciones. Por cada
   * sitio pide dashboard-data y guarda el timestamp de `ultima_lectura`.
   * Los cards arrancan en "Sin datos" y van pasando a verde a medida que
   * cada respuesta llega. Se reinicia cada vez que cambia `sites`.
   */
  private startFreshnessProbe(): void {
    this.probeSub?.unsubscribe();
    this.lastSeenMap.set({});

    // Vista cold-room renderiza ventisqueros, no cards → no hay nada que probar.
    if (this.coldRoomSite()) return;

    const cards = this._sites().filter((s) => normalizeSiteType(s.tipo_sitio) !== 'camara_frio');
    if (cards.length === 0) return;

    this.probeSub = from(cards)
      .pipe(
        concatMap((site) =>
          this.companyService.getSiteDashboardData(site.id).pipe(
            catchError(() => of(null)),
            map((res) => ({
              id: site.id,
              ts:
                res?.data?.ultima_lectura?.timestamp_completo ??
                res?.data?.ultima_lectura?.time ??
                res?.data?.ultima_lectura?.received_at ??
                null,
            })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ id, ts }) => {
        this.lastSeenMap.update((prev) => ({ ...prev, [id]: ts }));
      });
  }

  readonly coldRoomSites = computed<SiteRecord[]>(() => {
    const list = this._sites();
    return list.filter((s) => normalizeSiteType(s.tipo_sitio) === 'camara_frio');
  });

  readonly coldRoomSite = computed<SiteRecord | null>(() => {
    // Si hay sitios cold-room, mostramos el general AGREGADO de todos los TAPs
    // (coldRoomSites alimenta el bundle). No exigimos que TODOS los sitios sean
    // cold-room: evita forzar la selección de un TAP cuando hay mezcla.
    const cold = this.coldRoomSites();
    return cold.length > 0 ? cold[0] : null;
  });

  getGridClass(): string {
    if (this.variant === 'superadmin') {
      return 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 animate-in fade-in duration-500';
    }

    return 'grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 animate-in fade-in duration-500';
  }

  getEmptyStateClass(): string {
    if (this.variant === 'superadmin') {
      return 'col-span-full rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-20 text-center shadow-[0_8px_30px_rgba(15,23,42,0.05)]';
    }

    return 'col-span-full rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 py-20 text-center';
  }
}
