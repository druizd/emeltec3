import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription, interval, startWith } from 'rxjs';
import type { ConcentratorState, Sensor } from './ventisqueros-data';

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
  private concentratorSubject = new BehaviorSubject<ConcentratorState>({
    alerted: false,
    lastSeen: null,
  });
  private lastUpdateSubject = new BehaviorSubject<Date | null>(null);
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new BehaviorSubject<string | null>(null);

  readonly sensors$: Observable<Sensor[]> = this.sensorsSubject.asObservable();
  readonly concentrator$: Observable<ConcentratorState> = this.concentratorSubject.asObservable();
  readonly lastUpdate$: Observable<Date | null> = this.lastUpdateSubject.asObservable();
  readonly loading$: Observable<boolean> = this.loadingSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();

  private pollSub: Subscription | null = null;
  private currentSiteId: string | null = null;

  startPolling(siteId: string): void {
    if (this.currentSiteId === siteId && this.pollSub) return;
    this.stopPolling();
    this.currentSiteId = siteId;
    this.pollSub = interval(POLL_MS)
      .pipe(startWith(0))
      .subscribe(() => this.fetch(siteId));
  }

  stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.currentSiteId = null;
  }

  refresh(): void {
    if (this.currentSiteId) this.fetch(this.currentSiteId);
  }

  private fetch(_siteId: string): void {
    // TODO: conectar endpoints reales de Emeltec Cloud cuando estén disponibles.
    // Esperado:
    //   GET /api/cold-room/${siteId}/sensors      -> ApiEnvelope<Sensor[]>
    //   GET /api/cold-room/${siteId}/concentrator -> ApiEnvelope<ConcentratorState>
    //
    // this.loadingSubject.next(true);
    // this.http
    //   .get<ApiEnvelope<Sensor[]>>(`/api/cold-room/${_siteId}/sensors?t=${Date.now()}`)
    //   .subscribe({
    //     next: (res) => {
    //       if (res.ok) this.sensorsSubject.next(res.data);
    //       this.lastUpdateSubject.next(new Date());
    //       this.errorSubject.next(null);
    //     },
    //     error: (err) => this.errorSubject.next(err?.message ?? 'Error al cargar sensores'),
    //     complete: () => this.loadingSubject.next(false),
    //   });
    // this.http
    //   .get<ApiEnvelope<ConcentratorState>>(`/api/cold-room/${_siteId}/concentrator?t=${Date.now()}`)
    //   .subscribe({
    //     next: (res) => { if (res.ok) this.concentratorSubject.next(res.data); },
    //   });
  }
}
