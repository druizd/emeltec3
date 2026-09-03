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
  tap,
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

  // Snapshot serializado de lo que el backend tiene guardado. null = todavia
  // no hidratamos, no se salva nada.
  //
  // Antes esto era un booleano `configHydrated` que se ponia en true dentro
  // del subscribe del GET, justo despues de setear los signals. Los effects de
  // Angular son ASINCRONOS: para cuando el effect corria, el flag ya estaba en
  // true, veia los signals cambiados y disparaba un PUT con exactamente lo que
  // acababa de leer. De ahi el `PUT /operacion-config` en cada carga de sitio.
  // Comparar contra el snapshot no depende del timing del effect.
  private lastPersistedConfig: string | null = null;
  // Trigger de PUT: cada cambio en los signals empuja al subject; con debounce
  // hacemos un solo PUT por rafaga.
  private readonly configSaveTrigger$ = new Subject<void>();

  // Effect en constructor (inject context): cada cambio en los 4 signals
  // dispara el subject si ya hidratamos. El subject (debounced) hace el PUT.
  private readonly configSaveEffect = effect(() => {
    // serializeConfig() lee los 4 signals → registra la dependencia.
    const snapshot = this.serializeConfig();
    if (this.lastPersistedConfig === null || !this.activeSiteId) return;
    if (snapshot === this.lastPersistedConfig) return;
    this.configSaveTrigger$.next();
  });

  /** Forma canonica de la config, para comparar borrador vs persistido. */
  private serializeConfig(): string {
    return JSON.stringify({
      num_turnos: this.numTurnos(),
      turnos: this.turnosConfig().slice(0, 3),
      jornada_inicio: this.jornadaInicio(),
      jornada_fin: this.jornadaFin(),
    });
  }

  readonly diaOffset = signal(0);

  // Preset puede ser null cuando el operador edita fechas manuales que no
  // matchean ninguno de los 3 presets canónicos (7d, 30d, 90d ending hoy).
  // El UI dejá de resaltar cualquier botón cuando preset === null.
  readonly preset = signal<OperacionPreset | null>('30d');
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
  private countersSiteId: string | null = null;

  // toObservable solo se permite en contexto de inyeccion — captura en field init.
  private readonly jornadaInicio$ = toObservable(this.jornadaInicio);
  private readonly jornadaFin$ = toObservable(this.jornadaFin);

  // Ventana de contadores que piden los gráficos de flujo. El diario nunca
  // baja de 90 días (el Resumen por Período los necesita para su preset 90d)
  // y el API tope en 120; el mensual admite 12/24/36 (tope del API: 36).
  readonly diasContadores = signal(90);
  readonly mesesContadores = signal(12);
  private readonly diasContadores$ = toObservable(this.diasContadores);
  private readonly mesesContadores$ = toObservable(this.mesesContadores);

  /**
   * Arranca polling de config + turnos. Liviano: 1 GET inicial + save loop on
   * change. SIEMPRE necesario en Operacion (incluso para la tab Hoy que usa
   * los horarios de turno para calcular las cards). Idempotente por siteId.
   */
  startCountersPolling(siteId: string): void {
    if (!siteId || this.activeSiteId === siteId) return;
    this.stopCountersPolling();
    this.activeSiteId = siteId;

    this.hydrateOperacionConfig(siteId);
    this.startConfigSaveLoop(siteId);
  }

  /**
   * Arranca polling de contadores mensual/diario/jornada. Cold path pesado
   * (~1s c/u sin cache). Solo se necesita cuando el operador está en la tab
   * Resumen por Periodo o Gráficos Históricos — la tab Hoy no los usa. Por
   * eso disparamos lazy desde el componente cuando cambia modo. Idempotente
   * por siteId: re-llamar no re-fetchea.
   */
  ensureContadoresPolling(siteId: string): void {
    if (!siteId || this.countersSiteId === siteId) return;
    this.stopContadoresPolling();
    this.countersSiteId = siteId;

    this.monthlyCountersLoading.set(true);
    this.monthlySub = combineLatest([timer(0, 10 * 60_000), this.mesesContadores$])
      .pipe(
        switchMap(([, meses]) => {
          this.monthlyCountersLoading.set(true);
          return this.companyService
            .getSiteMonthlyCounters(siteId, {
              rol: 'totalizador',
              meses: Math.min(Math.max(meses, 1), 36),
            })
            .pipe(catchError(() => of(null)));
        }),
      )
      .subscribe((res) => {
        this.monthlyCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.monthlyCountersData.set(res.data ?? []);
      });

    this.dailyCountersLoading.set(true);
    // Minimo 90 dias: cubre el preset 90d del Resumen por Periodo. Los
    // graficos de flujo piden mas cuando el usuario elige un rango mas largo
    // (tope del API: 120). Sub-componentes filtran client-side al rango que
    // necesitan.
    this.dailySub = combineLatest([timer(0, 10 * 60_000), this.diasContadores$])
      .pipe(
        switchMap(([, dias]) => {
          this.dailyCountersLoading.set(true);
          return this.companyService
            .getSiteDailyCounters(siteId, {
              rol: 'totalizador',
              dias: Math.min(Math.max(dias, 90), 120),
            })
            .pipe(catchError(() => of(null)));
        }),
      )
      .subscribe((res) => {
        this.dailyCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.dailyCountersData.set(res.data ?? []);
      });

    this.jornadaCountersLoading.set(true);
    this.jornadaSub = combineLatest([timer(0, 10 * 60_000), this.jornadaInicio$, this.jornadaFin$])
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

  private stopContadoresPolling(): void {
    this.monthlySub?.unsubscribe();
    this.dailySub?.unsubscribe();
    this.jornadaSub?.unsubscribe();
    this.monthlySub = null;
    this.dailySub = null;
    this.jornadaSub = null;
    this.countersSiteId = null;
  }

  stopCountersPolling(): void {
    this.stopContadoresPolling();
    this.activeSiteId = null;
    this.lastPersistedConfig = null;
  }

  /**
   * Carga config persistida del sitio. Si no existe fila, el backend devuelve
   * defaults; los aplicamos igual para mantener un comportamiento consistente.
   */
  private hydrateOperacionConfig(siteId: string): void {
    this.lastPersistedConfig = null;
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
        // Con datos o con error, lo que quedo en pantalla es lo que el
        // backend tiene: ese es el snapshot base.
        this.lastPersistedConfig = this.serializeConfig();
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
          const payload = {
            num_turnos: this.numTurnos(),
            turnos,
            jornada_inicio: this.jornadaInicio(),
            jornada_fin: this.jornadaFin(),
          };
          const sent = JSON.stringify(payload);
          return this.companyService.updateSiteOperacionConfig(activeId, payload).pipe(
            // Guardado OK → eso es lo persistido. Sin esto, volver a un valor
            // ya guardado dispararia otro PUT identico.
            tap(() => (this.lastPersistedConfig = sent)),
            catchError(() => of(null)),
          );
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

  /**
   * Detecta si las fechas actuales coinciden con un preset canónico. Útil
   * para auto-deseleccionar el botón de preset cuando el operador edita
   * fechas manualmente.
   *
   * Reglas:
   *   - fechaHasta debe ser hoy.
   *   - fechaDesde debe coincidir con hoy - N donde N ∈ {7, 30, 90}.
   *   - Cualquier otra combinación → null (custom).
   */
  private detectPresetFromDates(): OperacionPreset | null {
    if (this.fechaHasta() !== this.isoTodayMinus(0)) return null;
    const desde = this.fechaDesde();
    if (desde === this.isoTodayMinus(7)) return '7d';
    if (desde === this.isoTodayMinus(30)) return '30d';
    if (desde === this.isoTodayMinus(90)) return '90d';
    return null;
  }

  onFechaChange(campo: 'desde' | 'hasta', val: string): void {
    if (campo === 'desde') this.fechaDesde.set(val);
    else this.fechaHasta.set(val);
    // Re-detectar preset: si las nuevas fechas matchean alguno de los 3
    // presets canónicos, lo activamos. Si no, queda null (custom range).
    this.preset.set(this.detectPresetFromDates());
  }
}
