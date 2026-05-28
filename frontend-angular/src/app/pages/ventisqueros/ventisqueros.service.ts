import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import type {
  ApiResponse,
  DashboardVariable,
  SiteDashboardData,
  SiteVariablesPayload,
  VariableMapping,
} from '@emeltec/shared';
import { AdministrationService } from '../../services/administration.service';
import { CompanyService } from '../../services/company.service';
import type { Sensor, TapKey } from './ventisqueros-data';
import { tapKeyFor } from './ventisqueros-data';

export interface SitePollSpec {
  siteId: string;
  tap: TapKey | null;
}

const POLL_MS = 30_000;
const MAX_BACKOFF_MULTIPLIER = 8;
const DEFAULT_AREA = 'Sensor';
const DEFAULT_CX = 533;
const DEFAULT_CY = 400;
const DEFAULT_R = 60;

interface AliasParts {
  sensorId: string;
  kind: 'T' | 'H' | 'ALERTA' | null;
}

function parseAlias(alias: string | null | undefined): AliasParts | null {
  if (!alias) return null;
  const trimmed = alias.trim().toUpperCase();
  // Match patterns: STH-01.T, STH-01.H, STH-01.ALERTA
  const match = trimmed.match(/^([A-Z]+-\d+)\.(T|H|ALERTA)$/);
  if (!match) return null;
  const kind = match[2] as 'T' | 'H' | 'ALERTA';
  return { sensorId: match[1], kind };
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'on' || v === 'alerta';
  }
  return false;
}

function getCoord(mapping: VariableMapping | undefined, key: 'cx' | 'cy' | 'r', fallback: number): number {
  const params = (mapping?.parametros || {}) as Record<string, unknown>;
  const n = readNumber(params[key]);
  return n ?? fallback;
}

function getArea(mapping: VariableMapping | undefined): string {
  const params = (mapping?.parametros || {}) as Record<string, unknown>;
  const a = params['area'];
  if (typeof a === 'string' && a.trim()) return a.trim();
  return DEFAULT_AREA;
}

@Injectable({ providedIn: 'root' })
export class VentisquerosService {
  private companyService = inject(CompanyService);
  private adminService = inject(AdministrationService);

  private sensorsSubject = new BehaviorSubject<Sensor[]>([]);
  private lastUpdateSubject = new BehaviorSubject<Date | null>(null);
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new BehaviorSubject<string | null>(null);

  readonly sensors$: Observable<Sensor[]> = this.sensorsSubject.asObservable();
  readonly lastUpdate$: Observable<Date | null> = this.lastUpdateSubject.asObservable();
  readonly loading$: Observable<boolean> = this.loadingSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();

  private currentKey: string | null = null;
  private currentSites: SitePollSpec[] = [];
  private mappingsBySite = new Map<string, VariableMapping[]>();
  private consecutiveErrors = 0;
  private nextPollTimer: ReturnType<typeof setTimeout> | null = null;

  startPolling(sites: SitePollSpec[] | string): void {
    const normalized: SitePollSpec[] = Array.isArray(sites)
      ? sites
      : [{ siteId: sites, tap: null }];
    const key = normalized.map((s) => `${s.siteId}:${s.tap ?? ''}`).sort().join('|');
    if (this.currentKey === key && this.currentSites.length > 0) return;
    this.stopPolling();
    this.currentKey = key;
    this.currentSites = normalized;
    if (normalized.length === 0) return;

    // Cargar mappings 1 vez al iniciar (define coords/areas).
    this.loadMappings(normalized).subscribe({
      next: () => this.startInterval(normalized),
      error: () => this.startInterval(normalized),
    });
  }

  private startInterval(sites: SitePollSpec[]): void {
    this.consecutiveErrors = 0;
    this.scheduleNextPoll(sites, 0);
  }

  private scheduleNextPoll(sites: SitePollSpec[], delayMs: number): void {
    if (this.nextPollTimer) clearTimeout(this.nextPollTimer);
    this.nextPollTimer = setTimeout(() => this.fetchDashboards(sites), delayMs);
  }

  private nextPollDelay(): number {
    if (this.consecutiveErrors === 0) return POLL_MS;
    const multiplier = Math.min(2 ** this.consecutiveErrors, MAX_BACKOFF_MULTIPLIER);
    return POLL_MS * multiplier;
  }

  private loadMappings(sites: SitePollSpec[]): Observable<void> {
    const reqs = sites.map((s) =>
      this.adminService.getSiteVariables(s.siteId).pipe(
        catchError(() => of<ApiResponse<SiteVariablesPayload>>({ ok: false, data: null as never })),
      ),
    );
    return forkJoin(reqs).pipe(
      switchMap((results) => {
        results.forEach((res, i) => {
          if (res.ok && res.data) {
            this.mappingsBySite.set(sites[i].siteId, res.data.mappings || []);
          }
        });
        return of(undefined);
      }),
    );
  }

  stopPolling(): void {
    if (this.nextPollTimer) {
      clearTimeout(this.nextPollTimer);
      this.nextPollTimer = null;
    }
    this.currentKey = null;
    this.currentSites = [];
    this.consecutiveErrors = 0;
  }

  refreshNow(): void {
    if (this.currentSites.length === 0) return;
    this.consecutiveErrors = 0;
    this.scheduleNextPoll(this.currentSites, 0);
  }

  refresh(): void {
    this.refreshNow();
  }

  private fetchDashboards(sites: SitePollSpec[]): void {
    this.loadingSubject.next(true);
    let authFailed = false;
    const reqs = sites.map((s) =>
      this.companyService.getSiteDashboardData(s.siteId).pipe(
        catchError((err: HttpErrorResponse) => {
          if (err?.status === 401) authFailed = true;
          return of<ApiResponse<SiteDashboardData>>({
            ok: false,
            data: {} as SiteDashboardData,
            error: this.describeHttpError(err),
          } as ApiResponse<SiteDashboardData>);
        }),
      ),
    );

    forkJoin(reqs).subscribe({
      next: (results) => {
        if (authFailed) {
          this.errorSubject.next('Sesión expirada. Iniciá sesión nuevamente.');
          this.loadingSubject.next(false);
          this.stopPolling();
          return;
        }
        const sensors: Sensor[] = [];

        results.forEach((res, i) => {
          const spec = sites[i];
          if (!res.ok || !res.data) return;
          const variables = res.data.variables || [];
          const mappings = this.mappingsBySite.get(spec.siteId) || [];
          const mappingByAlias = new Map<string, VariableMapping>();
          mappings.forEach((m) => mappingByAlias.set(m.alias.toUpperCase(), m));

          const tapLabel: TapKey = spec.tap ?? tapKeyFor(i);
          const grouped = this.groupVariables(variables, mappingByAlias);
          for (const [sensorId, entry] of grouped) {
            if (entry.t === null && entry.h === null) continue;
            sensors.push({
              id: sensorId,
              tap: tapLabel,
              area: entry.area,
              cx: entry.cx,
              cy: entry.cy,
              r: entry.r,
              t: entry.t ?? 0,
              h: entry.h ?? 0,
              alerted: entry.alerta,
              hist: [],
            });
          }
        });

        const anyFailed = results.some((r) => !r.ok);
        if (anyFailed && results.every((r) => !r.ok)) {
          this.consecutiveErrors++;
          const firstError = results.find((r) => !r.ok)?.error;
          this.errorSubject.next(
            firstError || 'No se pudo cargar la lectura. Reintentando con backoff.',
          );
        } else {
          this.consecutiveErrors = 0;
          this.errorSubject.next(null);
          this.sensorsSubject.next(sensors);
          this.lastUpdateSubject.next(new Date());
        }
        this.loadingSubject.next(false);

        if (this.currentSites.length > 0) {
          this.scheduleNextPoll(this.currentSites, this.nextPollDelay());
        }
      },
      error: (err) => {
        this.consecutiveErrors++;
        this.errorSubject.next(this.describeHttpError(err));
        this.loadingSubject.next(false);
        if (this.currentSites.length > 0) {
          this.scheduleNextPoll(this.currentSites, this.nextPollDelay());
        }
      },
    });
  }

  private describeHttpError(err: unknown): string {
    if (err && typeof err === 'object') {
      const status = (err as { status?: number }).status;
      if (status === 401) return 'Sesión expirada. Iniciá sesión nuevamente.';
      if (status === 403) return 'Sin permisos para ver este sitio.';
      if (status === 404) return 'Sitio no encontrado.';
      if (status === 429) return 'Demasiadas solicitudes. Reintentando con backoff.';
      if (typeof status === 'number' && status >= 500) {
        return 'Servidor no disponible. Reintentando con backoff.';
      }
      const message = (err as { message?: string }).message;
      if (message) return message;
    }
    return 'Sin conexión con el servidor.';
  }

  private groupVariables(
    variables: DashboardVariable[],
    mappingByAlias: Map<string, VariableMapping>,
  ): Map<
    string,
    { t: number | null; h: number | null; alerta: boolean; area: string; cx: number; cy: number; r: number }
  > {
    const out = new Map<
      string,
      { t: number | null; h: number | null; alerta: boolean; area: string; cx: number; cy: number; r: number }
    >();
    for (const v of variables) {
      const parts = parseAlias(v.alias);
      if (!parts) continue;
      const mapping = mappingByAlias.get((v.alias || '').toUpperCase());
      const entry = out.get(parts.sensorId) || {
        t: null,
        h: null,
        alerta: false,
        area: getArea(mapping),
        cx: getCoord(mapping, 'cx', DEFAULT_CX),
        cy: getCoord(mapping, 'cy', DEFAULT_CY),
        r: getCoord(mapping, 'r', DEFAULT_R),
      };
      if (parts.kind === 'T') entry.t = readNumber(v.valor);
      else if (parts.kind === 'H') entry.h = readNumber(v.valor);
      else if (parts.kind === 'ALERTA') entry.alerta = readBoolean(v.valor);
      // Coords/area: usar mapping del primer match si está disponible.
      if (mapping && entry.area === DEFAULT_AREA) entry.area = getArea(mapping);
      out.set(parts.sensorId, entry);
    }
    return out;
  }
}
