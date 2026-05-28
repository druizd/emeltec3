import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, forkJoin, interval, of, startWith } from 'rxjs';
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
import type { ConcentratorState, Sensor, SensorBackup, TapKey } from './ventisqueros-data';
import { TAPS } from './ventisqueros-data';

export interface SitePollSpec {
  siteId: string;
  tap: TapKey | null;
}

const POLL_MS = 30_000;
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
  private backupSubject = new BehaviorSubject<SensorBackup[]>([]);
  private concentratorSubject = new BehaviorSubject<ConcentratorState>({
    alerted: false,
    lastSeen: null,
  });
  private lastUpdateSubject = new BehaviorSubject<Date | null>(null);
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new BehaviorSubject<string | null>(null);

  readonly sensors$: Observable<Sensor[]> = this.sensorsSubject.asObservable();
  readonly backup$: Observable<SensorBackup[]> = this.backupSubject.asObservable();
  readonly concentrator$: Observable<ConcentratorState> = this.concentratorSubject.asObservable();
  readonly lastUpdate$: Observable<Date | null> = this.lastUpdateSubject.asObservable();
  readonly loading$: Observable<boolean> = this.loadingSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();

  private pollSub: Subscription | null = null;
  private currentKey: string | null = null;
  private currentSites: SitePollSpec[] = [];
  private mappingsBySite = new Map<string, VariableMapping[]>();

  startPolling(sites: SitePollSpec[] | string): void {
    const normalized: SitePollSpec[] = Array.isArray(sites)
      ? sites
      : [{ siteId: sites, tap: null }];
    const key = normalized.map((s) => `${s.siteId}:${s.tap ?? ''}`).sort().join('|');
    if (this.currentKey === key && this.pollSub) return;
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
    this.pollSub = interval(POLL_MS)
      .pipe(startWith(0))
      .subscribe(() => this.fetchDashboards(sites));
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
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.currentKey = null;
    this.currentSites = [];
  }

  refresh(): void {
    if (this.currentSites.length > 0) this.fetchDashboards(this.currentSites);
  }

  private fetchDashboards(sites: SitePollSpec[]): void {
    this.loadingSubject.next(true);
    const reqs = sites.map((s) =>
      this.companyService
        .getSiteDashboardData(s.siteId)
        .pipe(
          catchError(() =>
            of<ApiResponse<SiteDashboardData>>({ ok: false, data: {} as SiteDashboardData }),
          ),
        ),
    );

    forkJoin(reqs).subscribe({
      next: (results) => {
        const sensors: Sensor[] = [];
        const backup: SensorBackup[] = [];
        let lastSeen: string | null = null;
        let anyAlerta = false;

        results.forEach((res, i) => {
          const spec = sites[i];
          if (!res.ok || !res.data) return;
          const variables = res.data.variables || [];
          const mappings = this.mappingsBySite.get(spec.siteId) || [];
          const mappingByAlias = new Map<string, VariableMapping>();
          mappings.forEach((m) => mappingByAlias.set(m.alias.toUpperCase(), m));

          if (spec.tap === 'TAP 1') {
            // TAP 1 envía T/H + ALERTA boolean por sensor (canal redundante).
            const backupBySensor = this.groupVariables(variables, mappingByAlias);
            for (const [sensorId, entry] of backupBySensor) {
              backup.push({
                id: sensorId,
                area: entry.area,
                t: entry.t ?? 0,
                h: entry.h ?? 0,
                alertaFisica: entry.alerta,
                hist: [],
              });
              if (entry.alerta) anyAlerta = true;
            }
            const ls =
              res.data.ultima_lectura?.timestamp_completo ||
              res.data.ultima_lectura?.time ||
              null;
            if (ls) lastSeen = ls;
          } else {
            // TAPs 2-4: sensores THM con coordenadas en plano.
            const grouped = this.groupVariables(variables, mappingByAlias);
            for (const [sensorId, entry] of grouped) {
              if (entry.t === null && entry.h === null) continue;
              sensors.push({
                id: sensorId,
                tap: spec.tap ?? 'TAP 2',
                area: entry.area,
                cx: entry.cx,
                cy: entry.cy,
                r: entry.r,
                t: entry.t ?? 0,
                h: entry.h ?? 0,
                alerted: false,
                hist: [],
              });
            }
          }
        });

        this.sensorsSubject.next(sensors);
        this.backupSubject.next(backup);
        this.concentratorSubject.next({ alerted: anyAlerta, lastSeen });
        this.lastUpdateSubject.next(new Date());
        this.errorSubject.next(null);
        this.loadingSubject.next(false);
      },
      error: (err) => {
        this.errorSubject.next(err?.message ?? 'Error al cargar lecturas cold-room');
        this.loadingSubject.next(false);
      },
    });
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

// Re-export para uso interno donde sea necesario.
export const VENTISQUEROS_TAPS = TAPS;
