import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CompanyService } from '../../services/company.service';
import { AuthService } from '../../services/auth.service';
import type { ApiResponse, CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';

const WELCOME_DISMISSED_KEY = 'emeltec-welcome-dismissed';

interface InstallationCard {
  id: string;
  name: string;
  companyName: string;
  subCompanyName: string;
  type: string;
  location: string;
  /** Minutos desde última lectura, o null si no hay timestamp. */
  ageMinutes: number | null;
  status: 'online' | 'recent' | 'offline' | 'pending';
}

/** Chunk de items por tick para lazy loading incremental. */
const LAZY_CHUNK_SIZE = 24;
const LAZY_CHUNK_MS = 50;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private companyService = inject(CompanyService);
  private router = inject(Router);
  private auth = inject(AuthService);

  /** Total de instalaciones cargadas desde el backend (puede ser grande). */
  installations = signal<InstallationCard[]>([]);
  loading = signal(true);

  /**
   * First-session welcome banner. Shows on first visit until the user
   * dismisses it. Persisted in localStorage so we don't nag returning users.
   * Hidden entirely when the hierarchy is empty — the empty-state card
   * already greets them.
   */
  welcomeBannerVisible = signal(false);
  userFirstName = computed(() => {
    const full = this.auth.user()?.nombre?.trim() ?? '';
    return full ? full.split(/\s+/)[0] : '';
  });

  /**
   * Lazy loading: cuántas mostrar actualmente. Se incrementa en chunks
   * de LAZY_CHUNK_SIZE cada LAZY_CHUNK_MS hasta cubrir todo el array.
   * Evita freeze del render cuando hay 100+ instalaciones (rol admin).
   */
  visibleCount = signal(0);
  visibleInstallations = computed(() => this.installations().slice(0, this.visibleCount()));

  private lazyTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.loadInstallations();
    // Read once on mount. localStorage may throw in incognito / sandboxed
    // frames — fall back to "show" so the user still gets the experience.
    try {
      this.welcomeBannerVisible.set(localStorage.getItem(WELCOME_DISMISSED_KEY) !== 'true');
    } catch {
      this.welcomeBannerVisible.set(true);
    }
  }

  dismissWelcomeBanner(): void {
    this.welcomeBannerVisible.set(false);
    try {
      localStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
    } catch {
      // localStorage unavailable — banner stays dismissed for this session
      // only, which is acceptable.
    }
  }

  ngOnDestroy(): void {
    this.stopLazyRender();
  }

  loadInstallations(): void {
    this.loading.set(true);
    this.stopLazyRender();
    this.visibleCount.set(0);

    this.companyService.fetchHierarchy().subscribe({
      next: (res: ApiResponse<CompanyNode[]>) => {
        const list = res.ok ? this.flattenInstallations(res.data || []) : [];
        this.installations.set(list);
        this.loading.set(false);
        // Primer chunk visible inmediatamente para que el usuario vea algo.
        this.visibleCount.set(Math.min(LAZY_CHUNK_SIZE, list.length));
        if (list.length > LAZY_CHUNK_SIZE) {
          this.scheduleNextChunk();
        }
      },
      error: () => {
        this.installations.set([]);
        this.loading.set(false);
      },
    });
  }

  private scheduleNextChunk(): void {
    this.lazyTimer = setTimeout(() => {
      const total = this.installations().length;
      const next = Math.min(this.visibleCount() + LAZY_CHUNK_SIZE, total);
      this.visibleCount.set(next);
      if (next < total) {
        this.scheduleNextChunk();
      } else {
        this.lazyTimer = null;
      }
    }, LAZY_CHUNK_MS);
  }

  private stopLazyRender(): void {
    if (this.lazyTimer) {
      clearTimeout(this.lazyTimer);
      this.lazyTimer = null;
    }
  }

  openInstallation(installation: InstallationCard): void {
    if (!installation.id) return;
    this.router.navigate(['/companies', installation.id, 'water']);
  }

  getStatusLabel(status: InstallationCard['status']): string {
    if (status === 'online') return 'En vivo';
    if (status === 'recent') return 'Con datos';
    if (status === 'offline') return 'Sin datos';
    return 'Sin datos';
  }

  getStatusColor(status: InstallationCard['status']): string {
    if (status === 'online') return '#22c55e';
    if (status === 'recent') return '#0891b2';
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
        (subCompany.sites || []).map((site: SiteRecord) => {
          const ageMin = this.ageMinutesFromSite(site);
          return {
            id: site.id,
            name: this.composeName(site),
            companyName: company.nombre || 'Empresa sin nombre',
            subCompanyName: subCompany.nombre || 'División sin nombre',
            type: company.tipo_empresa || 'Instalación',
            location:
              this.pickFirst(site, ['ubicacion', 'sector', 'alias', 'nombre_corto', 'site_code']) ||
              subCompany.nombre ||
              'Sin referencia',
            ageMinutes: ageMin,
            status: this.statusFromAge(ageMin),
          };
        }),
      ),
    );
  }

  /** Nombre + " · OB-XXXX-XXX" si el pozo tiene obra_dga. */
  private composeName(site: SiteRecord): string {
    const base = this.pickFirst(site, ['descripcion', 'nombre', 'name', 'codigo']) || 'Instalación';
    const obra = site.pozo_config?.obra_dga?.trim();
    return obra ? `${base} · ${obra}` : base;
  }

  /** Minutos desde la última lectura, o null si backend no manda timestamp. */
  private ageMinutesFromSite(site: SiteRecord): number | null {
    const raw = site.last_seen_at;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 60_000));
  }

  /** Mapea edad → estado para colorear punto de conexión. */
  private statusFromAge(ageMin: number | null): InstallationCard['status'] {
    if (ageMin === null) return 'pending';
    if (ageMin < 60) return 'online';
    if (ageMin < 24 * 60) return 'recent';
    return 'offline';
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
