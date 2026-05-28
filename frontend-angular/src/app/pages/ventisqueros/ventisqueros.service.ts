import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription, forkJoin, interval, of, startWith } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type { ConcentratorState, Sensor, SensorBackup, TapKey } from './ventisqueros-data';

export interface SitePollSpec {
  siteId: string;
  tap: TapKey | null;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: string;
}

const POLL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class VentisquerosService {
  private http = inject(HttpClient);

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

  startPolling(sites: SitePollSpec[] | string): void {
    const normalized: SitePollSpec[] = Array.isArray(sites)
      ? sites
      : [{ siteId: sites, tap: null }];
    const key = normalized
      .map((s) => `${s.siteId}:${s.tap ?? ''}`)
      .sort()
      .join('|');
    if (this.currentKey === key && this.pollSub) return;
    this.stopPolling();
    this.currentKey = key;
    this.currentSites = normalized;
    if (normalized.length === 0) return;
    this.pollSub = interval(POLL_MS)
      .pipe(startWith(0))
      .subscribe(() => this.fetchAll(normalized));
  }

  stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.currentKey = null;
    this.currentSites = [];
  }

  refresh(): void {
    if (this.currentSites.length > 0) this.fetchAll(this.currentSites);
  }

  private fetchAll(sites: SitePollSpec[]): void {
    this.loadingSubject.next(true);
    const ts = Date.now();
    const sensorsReqs = sites.map((s) =>
      this.http
        .get<ApiEnvelope<Sensor[]>>(this.url(s, 'sensors', ts))
        .pipe(catchError(() => of<ApiEnvelope<Sensor[]>>({ ok: false, data: [] }))),
    );
    const backupReqs = sites.map((s) =>
      this.http
        .get<ApiEnvelope<SensorBackup[]>>(this.url(s, 'backup', ts))
        .pipe(catchError(() => of<ApiEnvelope<SensorBackup[]>>({ ok: false, data: [] }))),
    );
    const concentratorReqs = sites.map((s) =>
      this.http
        .get<ApiEnvelope<ConcentratorState>>(this.url(s, 'concentrator', ts))
        .pipe(
          catchError(() =>
            of<ApiEnvelope<ConcentratorState>>({
              ok: false,
              data: { alerted: false, lastSeen: null },
            }),
          ),
        ),
    );

    forkJoin([forkJoin(sensorsReqs), forkJoin(backupReqs), forkJoin(concentratorReqs)]).subscribe({
      next: ([sensorsRes, backupRes, concentratorRes]) => {
        const sensors = sensorsRes.flatMap((r) => (r.ok ? r.data : []));
        const backup = backupRes.flatMap((r) => (r.ok ? r.data : []));
        const concentrator =
          concentratorRes
            .map((r) => r.data)
            .find((c) => c.lastSeen !== null) ?? { alerted: false, lastSeen: null };
        const aggAlert = backup.some((b) => b.alertaFisica) || concentrator.alerted;

        this.sensorsSubject.next(sensors);
        this.backupSubject.next(backup);
        this.concentratorSubject.next({ ...concentrator, alerted: aggAlert });
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

  private url(spec: SitePollSpec, resource: 'sensors' | 'backup' | 'concentrator', ts: number): string {
    const tapParam = spec.tap ? `&tap=${encodeURIComponent(spec.tap)}` : '';
    return `/api/cold-room/${spec.siteId}/${resource}?t=${ts}${tapParam}`;
  }
}
