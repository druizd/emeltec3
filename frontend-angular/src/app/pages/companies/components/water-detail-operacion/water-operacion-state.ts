import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  debounceTime,
  of,
  Subscription,
  switchMap,
  timer,
} from 'rxjs';
import {
  CompanyService,
  type ContadorDiarioPoint,
  type ContadorJornadaPoint,
  type ContadorMensualPoint,
} from '../../../../services/company.service';

export interface TurnoConfig {
  nombre: string;
  inicio: string;
  fin: string;
}

export type OperacionPreset = '7d' | '30d' | '90d';

export interface HistoricalRow {
  timestampMs: number | null;
  caudal: number | null;
  nivel: number | null;
  totalizador: number | null;
  nivelFreatico: number | null;
}

@Injectable()
export class WaterOperacionStateService {
  private readonly companyService = inject(CompanyService);

  readonly numTurnos = signal<2 | 3>(3);
  readonly turnosConfig = signal<TurnoConfig[]>([
    { nombre: 'Turno 1', inicio: '07:00', fin: '14:59' },
    { nombre: 'Turno 2', inicio: '15:00', fin: '22:59' },
    { nombre: 'Turno 3', inicio: '23:00', fin: '06:59' },
  ]);

  readonly jornadaInicio = signal('07:00');
  readonly jornadaFin = signal('07:00');

  readonly diaOffset = signal(0);

  readonly preset = signal<OperacionPreset>('30d');
  readonly fechaDesde = signal('2026-04-10');
  readonly fechaHasta = signal('2026-05-10');

  // Telemetria historica compartida entre las pestañas de Operacion (Hoy /
  // Graficos historicos). El parent fetches; los hijos consumen.
  readonly historyRows = signal<HistoricalRow[]>([]);
  readonly historyLoading = signal(false);

  // Contadores (mensual / diario / jornada) compartidos entre tabs: la
  // poll-suscription vive con el parent componente, asi que switching tabs
  // no re-fetchea (sub-components solo leen estos signals).
  readonly monthlyCountersData = signal<ContadorMensualPoint[]>([]);
  readonly monthlyCountersLoading = signal(false);
  readonly dailyCountersData = signal<ContadorDiarioPoint[]>([]);
  readonly dailyCountersLoading = signal(false);
  readonly jornadaCountersData = signal<ContadorJornadaPoint[]>([]);
  readonly jornadaCountersLoading = signal(false);

  private monthlySub: Subscription | null = null;
  private dailySub: Subscription | null = null;
  private jornadaSub: Subscription | null = null;
  private activeSiteId: string | null = null;

  // toObservable solo se permite en contexto de inyeccion — captura en field init.
  private readonly jornadaInicio$ = toObservable(this.jornadaInicio);
  private readonly jornadaFin$ = toObservable(this.jornadaFin);

  startCountersPolling(siteId: string): void {
    if (!siteId || this.activeSiteId === siteId) return;
    this.stopCountersPolling();
    this.activeSiteId = siteId;

    this.monthlyCountersLoading.set(true);
    this.monthlySub = timer(0, 10 * 60_000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getSiteMonthlyCounters(siteId, { rol: 'totalizador', meses: 12 })
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((res) => {
        this.monthlyCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.monthlyCountersData.set(res.data ?? []);
      });

    this.dailyCountersLoading.set(true);
    this.dailySub = timer(0, 10 * 60_000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getSiteDailyCounters(siteId, { rol: 'totalizador', dias: 30 })
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((res) => {
        this.dailyCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.dailyCountersData.set(res.data ?? []);
      });

    this.jornadaCountersLoading.set(true);
    this.jornadaSub = combineLatest([
      timer(0, 10 * 60_000),
      this.jornadaInicio$,
      this.jornadaFin$,
    ])
      .pipe(
        debounceTime(300),
        switchMap(([, inicio, fin]) =>
          this.companyService
            .getSiteJornadaCounters(siteId, { rol: 'totalizador', dias: 30, inicio, fin })
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((res) => {
        this.jornadaCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.jornadaCountersData.set(res.data ?? []);
      });
  }

  stopCountersPolling(): void {
    this.monthlySub?.unsubscribe();
    this.dailySub?.unsubscribe();
    this.jornadaSub?.unsubscribe();
    this.monthlySub = null;
    this.dailySub = null;
    this.jornadaSub = null;
    this.activeSiteId = null;
  }

  updateTurnoConfig(index: number, field: keyof TurnoConfig, value: string): void {
    this.turnosConfig.update((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  setPreset(p: OperacionPreset): void {
    this.preset.set(p);
    const hasta = new Date(2026, 4, 10);
    const dias = p === '7d' ? 7 : p === '30d' ? 30 : 90;
    const desde = new Date(hasta);
    desde.setDate(desde.getDate() - dias);
    this.fechaDesde.set(desde.toISOString().slice(0, 10));
    this.fechaHasta.set(hasta.toISOString().slice(0, 10));
  }

  onFechaChange(campo: 'desde' | 'hasta', val: string): void {
    if (campo === 'desde') this.fechaDesde.set(val);
    else this.fechaHasta.set(val);
    this.preset.set('30d');
  }
}
