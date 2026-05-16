import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  Subject,
  Subscription,
  catchError,
  combineLatest,
  debounceTime,
  of,
  switchMap,
  timer,
} from 'rxjs';
import {
  CompanyService,
  type ContadorDiarioPoint,
  type ContadorJornadaPoint,
  type ContadorMensualPoint,
  type SiteOperacionTurno,
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
  private readonly destroyRef = inject(DestroyRef);

  readonly numTurnos = signal<2 | 3>(3);
  readonly turnosConfig = signal<TurnoConfig[]>([
    { nombre: 'Turno 1', inicio: '07:00', fin: '14:59' },
    { nombre: 'Turno 2', inicio: '15:00', fin: '22:59' },
    { nombre: 'Turno 3', inicio: '23:00', fin: '06:59' },
  ]);

  readonly jornadaInicio = signal('07:00');
  readonly jornadaFin = signal('07:00');

  // Flag para no salvar durante el load inicial: cuando el GET completa,
  // setea los signals → effect() veria un cambio y haria PUT redundante.
  private configHydrated = false;
  // Trigger de PUT: cada cambio en los signals empuja al subject; con debounce
  // hacemos un solo PUT por rafaga.
  private readonly configSaveTrigger$ = new Subject<void>();

  // Effect en constructor (inject context): cada cambio en los 4 signals
  // dispara el subject si ya hidratamos. El subject (debounced) hace el PUT.
  private readonly configSaveEffect = effect(() => {
    // Tocar signals para registrar dependencia.
    void this.numTurnos();
    void this.turnosConfig();
    void this.jornadaInicio();
    void this.jornadaFin();
    if (!this.configHydrated || !this.activeSiteId) return;
    this.configSaveTrigger$.next();
  });

  readonly diaOffset = signal(0);

  readonly preset = signal<OperacionPreset>('30d');
  readonly fechaDesde = signal(this.isoTodayMinus(30));
  readonly fechaHasta = signal(this.isoTodayMinus(0));

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
  private configSaveSub: Subscription | null = null;
  private activeSiteId: string | null = null;

  // toObservable solo se permite en contexto de inyeccion — captura en field init.
  private readonly jornadaInicio$ = toObservable(this.jornadaInicio);
  private readonly jornadaFin$ = toObservable(this.jornadaFin);

  startCountersPolling(siteId: string): void {
    if (!siteId || this.activeSiteId === siteId) return;
    this.stopCountersPolling();
    this.activeSiteId = siteId;

    this.hydrateOperacionConfig(siteId);
    this.startConfigSaveLoop(siteId);

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
    // 90 dias: cubre el chart de 30 dias + el preset 90d del Resumen por
    // Periodo. Sub-componentes filtran client-side al rango que necesitan.
    this.dailySub = timer(0, 10 * 60_000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getSiteDailyCounters(siteId, { rol: 'totalizador', dias: 90 })
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
    this.configHydrated = false;
  }

  /**
   * Carga config persistida del sitio. Si no existe fila, el backend devuelve
   * defaults; los aplicamos igual para mantener un comportamiento consistente.
   */
  private hydrateOperacionConfig(siteId: string): void {
    this.configHydrated = false;
    this.companyService
      .getSiteOperacionConfig(siteId)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (res && res.ok && res.data) {
          const cfg = res.data;
          this.numTurnos.set(cfg.num_turnos === 2 ? 2 : 3);
          // Aseguramos 3 entradas: si la DB trae menos, completar con defaults.
          const turnosDb = cfg.turnos ?? [];
          const filled: TurnoConfig[] = [0, 1, 2].map(
            (i) =>
              turnosDb[i] ?? {
                nombre: `Turno ${i + 1}`,
                inicio: ['07:00', '15:00', '23:00'][i]!,
                fin: ['14:59', '22:59', '06:59'][i]!,
              },
          );
          this.turnosConfig.set(filled);
          this.jornadaInicio.set(cfg.jornada_inicio);
          this.jornadaFin.set(cfg.jornada_fin);
        }
        this.configHydrated = true;
      });
  }

  /**
   * Subscribe al subject de save (creado en field init). Cuando dispare, hace
   * PUT debounced al sitio activo. Solo se monta una vez por instancia del
   * service (parent componente).
   */
  private startConfigSaveLoop(siteId: string): void {
    if (this.configSaveSub) return;
    this.configSaveSub = this.configSaveTrigger$
      .pipe(
        debounceTime(500),
        switchMap(() => {
          const activeId = this.activeSiteId;
          if (!activeId) return of(null);
          const turnos: SiteOperacionTurno[] = this.turnosConfig().slice(0, 3);
          return this.companyService
            .updateSiteOperacionConfig(activeId, {
              num_turnos: this.numTurnos(),
              turnos,
              jornada_inicio: this.jornadaInicio(),
              jornada_fin: this.jornadaFin(),
            })
            .pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
    // siteId esta capturado por activeSiteId al startCountersPolling.
    void siteId;
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
    const dias = p === '7d' ? 7 : p === '30d' ? 30 : 90;
    this.fechaDesde.set(this.isoTodayMinus(dias));
    this.fechaHasta.set(this.isoTodayMinus(0));
  }

  private isoTodayMinus(daysAgo: number): string {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  }

  onFechaChange(campo: 'desde' | 'hasta', val: string): void {
    if (campo === 'desde') this.fechaDesde.set(val);
    else this.fechaHasta.set(val);
    this.preset.set('30d');
  }
}
