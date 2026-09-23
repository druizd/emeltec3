/**
 * Tests de los filtros de la cola de revisión DGA.
 *
 * El foco está en la conversión de fecha. El <input type="date"> entrega
 * 'YYYY-MM-DD' sin zona, pero el backend compara contra un timestamptz: si el
 * día no se expande al rango correcto en hora de Chile, un "hasta el 17" deja
 * fuera las últimas horas del 17 y el usuario ve menos de lo que hay.
 *
 * La zona es UTC-4 FIJA (`Etc/GMT+4`), no el reloj de pared: `dato_dga` genera
 * `fecha`/`hora` en esa zona y es lo que se declara a SNIA, así que el filtro
 * tiene que recortar los mismos días que muestra la tabla. Seguir el reloj de
 * pared dejaba el corte 1 h adentro del día vecino durante el horario de
 * verano, y en invierno los dos criterios coinciden — por eso el caso de enero
 * de más abajo es el único que detecta la regresión.
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DgaReviewComponent } from './dga-review';
import {
  DgaReviewActionPayload,
  DgaReviewBulkPayload,
  DgaReviewFilters,
  DgaReviewQueuePage,
  DgaReviewSlot,
  DgaService,
} from '../../services/dga.service';

const PAGINA_VACIA = { slots: [], total: 0, sitios: [] };

describe('DgaReviewComponent — filtros', () => {
  let capturado: DgaReviewFilters[];
  let dga: Partial<DgaService>;
  /** Se completa ANTES de `crear()`: el componente los lee en el constructor. */
  let queryParams: Record<string, string>;

  beforeEach(() => {
    capturado = [];
    queryParams = {};
    dga = {
      listReviewQueue: (filters: DgaReviewFilters = {}) => {
        capturado.push(filters);
        return of(PAGINA_VACIA as DgaReviewQueuePage);
      },
    };
    TestBed.configureTestingModule({
      imports: [DgaReviewComponent],
      providers: [
        { provide: DgaService, useValue: dga },
        {
          // Getter y no un objeto fijo: el mapa se arma cuando el componente
          // inyecta la ruta, que es después de que el test setee queryParams.
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { queryParamMap: convertToParamMap(queryParams) };
            },
          },
        },
      ],
    });
  });

  function crear(): DgaReviewComponent {
    return TestBed.createComponent(DgaReviewComponent).componentInstance;
  }

  it('no manda fechas cuando no hay filtros', () => {
    crear();
    expect(capturado.length).toBe(1);
    expect(capturado[0]!.desde).toBeUndefined();
    expect(capturado[0]!.hasta).toBeUndefined();
    expect(capturado[0]!.siteId).toBeUndefined();
  });

  // ---- Deep link desde el estado "Revisar" de un pozo ----
  //
  // Es el único camino directo entre la pantalla que avisa y la que resuelve.
  // Sin esto había que entrar por el sidebar y volver a buscar el slot a mano,
  // y la cola no se vaciaba: S105 llegó a 128 slots en cinco días.

  it('aplica obra y rango desde la URL en la PRIMERA carga', () => {
    queryParams = { site: 'S105', desde: '2026-09-18', hasta: '2026-09-18' };
    const c = crear();
    expect(c.filterSite()).toBe('S105');
    expect(c.filterDesde()).toBe('2026-09-18');
    // Una sola llamada: los filtros se aplican ANTES del reload, no después.
    expect(capturado.length).toBe(1);
    expect(capturado[0]!.siteId).toBe('S105');
    expect(capturado[0]!.desde).toBe('2026-09-18T04:00:00.000Z');
  });

  it('filtra solo por obra cuando la URL no trae fechas', () => {
    queryParams = { site: 'S119' };
    crear();
    expect(capturado[0]!.siteId).toBe('S119');
    expect(capturado[0]!.desde).toBeUndefined();
  });

  it('ignora una fecha con formato inválido en vez de romper el input', () => {
    queryParams = { site: 'S105', desde: 'ayer', hasta: '18-09-2026' };
    const c = crear();
    expect(c.filterSite()).toBe('S105');
    expect(c.filterDesde()).toBe('');
    expect(c.filterHasta()).toBe('');
    expect(capturado[0]!.desde).toBeUndefined();
  });

  it('sin query params se comporta como antes', () => {
    const c = crear();
    expect(c.filterSite()).toBe('');
    expect(c.hasFilters()).toBe(false);
  });

  it('expande "desde" al inicio del día en hora de Chile (UTC-4 en invierno)', () => {
    const c = crear();
    c.onFilterChange(c.filterDesde, '2026-07-01');
    // 00:00 del 1-jul en Chile = 04:00 UTC del mismo día.
    expect(capturado.at(-1)!.desde).toBe('2026-07-01T04:00:00.000Z');
  });

  it('expande "hasta" al FIN del día, no a su medianoche', () => {
    const c = crear();
    c.onFilterChange(c.filterHasta, '2026-07-17');
    // 23:59:59.999 del 17-jul en Chile = 03:59:59.999 UTC del 18.
    // Si diera '2026-07-17T23:59:59.999Z' estaríamos perdiendo 4 horas del 17.
    expect(capturado.at(-1)!.hasta).toBe('2026-07-18T03:59:59.999Z');
  });

  it('mantiene UTC-4 fijo en pleno horario de verano, no sigue el reloj de pared', () => {
    const c = crear();
    c.onFilterChange(c.filterDesde, '2026-01-15');
    // El 15-ene el reloj chileno va en UTC-3, pero la tabla muestra los días
    // tal como `dato_dga` los genera (Etc/GMT+4) y como salen a SNIA. Si esto
    // volviera a dar '...T03:00:00.000Z', el filtro y la tabla discreparían en
    // una hora justo en el período en que se está declarando.
    expect(capturado.at(-1)!.desde).toBe('2026-01-15T04:00:00.000Z');
  });

  it('manda el site_id elegido', () => {
    const c = crear();
    c.onFilterChange(c.filterSite, 'S127');
    expect(capturado.at(-1)!.siteId).toBe('S127');
  });

  /**
   * Regresión encontrada en el navegador, no acá: el <input type="date"> emite
   * en cada tecla y rellena el año con ceros, así que escribir "2026" pasa por
   * 0002, 0020 y 0202. Con esos años 'sv-SE' no rellena con ceros ("2-06-30"),
   * reparsearlo daba Invalid Date y toISOString tiraba RangeError, abortando
   * el reload y dejando la lista sin refrescar.
   */
  it('no consulta ni revienta con los años parciales que emite el input', () => {
    const c = crear();
    const antes = capturado.length;
    for (const parcial of ['0002-07-01', '0020-07-01', '0202-07-01']) {
      expect(() => c.onFilterChange(c.filterDesde, parcial)).not.toThrow();
    }
    expect(capturado.length).toBe(antes);

    // Recién con el año completo se consulta, y con la fecha bien convertida.
    c.onFilterChange(c.filterDesde, '2026-07-01');
    expect(capturado.length).toBe(antes + 1);
    expect(capturado.at(-1)!.desde).toBe('2026-07-01T04:00:00.000Z');
  });

  it('un año parcial en "hasta" tampoco arrastra al filtro de obra', () => {
    const c = crear();
    c.onFilterChange(c.filterSite, 'S127');
    const antes = capturado.length;
    c.onFilterChange(c.filterHasta, '0002-07-01');
    expect(capturado.length).toBe(antes);
    c.onFilterChange(c.filterHasta, '2026-07-17');
    expect(capturado.at(-1)!.siteId).toBe('S127');
    expect(capturado.at(-1)!.hasta).toBe('2026-07-18T03:59:59.999Z');
  });

  it('hasFilters distingue vacío de filtrado', () => {
    const c = crear();
    expect(c.hasFilters()).toBe(false);
    c.onFilterChange(c.filterDesde, '2026-07-01');
    expect(c.hasFilters()).toBe(true);
    c.clearFilters();
    expect(c.hasFilters()).toBe(false);
    expect(capturado.at(-1)!.desde).toBeUndefined();
  });

  it('truncado avisa solo cuando el total supera lo mostrado', () => {
    const c = crear();
    c.slots.set([{ site_id: 'S1', ts: 'x' } as never]);
    c.total.set(1);
    expect(c.truncado()).toBe(false);
    c.total.set(340);
    expect(c.truncado()).toBe(true);
  });
});

/**
 * Selección múltiple y acciones en bloque.
 *
 * El caso que lo motivó: 73 mediciones retenidas de un mismo pozo por exceder
 * el derecho de caudal. Aceptarlas de a una no es viable, y aceptarlas por SQL
 * salta la nota y el autor que exige la auditoría.
 */
describe('DgaReviewComponent — selección múltiple', () => {
  let aplicadas: DgaReviewActionPayload[];
  let lotes: DgaReviewBulkPayload[];
  let fallarEn: string | null;

  function slot(siteId: string, ts: string, code: string): DgaReviewSlot {
    return {
      site_id: siteId,
      ts,
      obra: 'OB-TEST',
      codigo_obra: 'OB-TEST',
      referencia_informante: siteId,
      caudal_instantaneo: '77.90',
      flujo_acumulado: '1234',
      nivel_freatico: '32.20',
      validation_warnings: [{ code }],
    } as unknown as DgaReviewSlot;
  }

  const SLOTS = [
    slot('S129', '2026-09-10T12:00:00.000Z', 'flow_exceeds_water_right'),
    slot('S129', '2026-09-10T13:00:00.000Z', 'flow_exceeds_water_right'),
    slot('S130', '2026-09-10T14:00:00.000Z', 'no_data_stale'),
  ];

  beforeEach(() => {
    aplicadas = [];
    lotes = [];
    fallarEn = null;
    const dga: Partial<DgaService> = {
      listReviewQueue: () =>
        of({ slots: SLOTS, total: SLOTS.length, sitios: [] } as unknown as DgaReviewQueuePage),
      applyReviewDecision: (payload: DgaReviewActionPayload) => {
        aplicadas.push(payload);
        if (fallarEn && payload.ts === fallarEn) {
          return throwError(() => new Error('boom')) as never;
        }
        return of({ ok: true }) as never;
      },
      // UNA llamada por lote: es lo que hace que el 2FA se pida una sola vez.
      // El backend aplica ítem por ítem y devuelve cuáles no pudo.
      applyReviewDecisionBulk: (payload: DgaReviewBulkPayload) => {
        lotes.push(payload);
        const fallidos = payload.items
          .filter((i) => fallarEn && i.ts === fallarEn)
          .map((i) => ({ site_id: i.site_id, ts: i.ts, error: 'boom' }));
        return of({
          aplicados: payload.items.length - fallidos.length,
          fallidos,
        }) as never;
      },
    };
    TestBed.configureTestingModule({
      imports: [DgaReviewComponent],
      providers: [
        { provide: DgaService, useValue: dga },
        // Sin query params: esta tanda no prueba el deep link, pero el
        // componente inyecta la ruta igual.
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
  });

  function crear(): DgaReviewComponent {
    return TestBed.createComponent(DgaReviewComponent).componentInstance;
  }

  it('marca y desmarca un slot', () => {
    const c = crear();
    expect(c.seleccionados()).toBe(0);
    c.alternarMarca(SLOTS[0]!);
    expect(c.seleccionados()).toBe(1);
    expect(c.estaMarcado(SLOTS[0]!)).toBe(true);
    c.alternarMarca(SLOTS[0]!);
    expect(c.seleccionados()).toBe(0);
  });

  it('el chip de anomalía acota la tabla sin perder las demás opciones', () => {
    const c = crear();
    expect(c.visibles().length).toBe(3);
    c.setFilterCodigo('flow_exceeds_water_right');
    expect(c.visibles().length).toBe(2);
    // Los chips se calculan sobre la página completa: si se calcularan sobre
    // lo visible, al elegir uno desaparecerían los otros y no habría vuelta.
    expect(c.codigosPresentes().length).toBe(2);
    c.setFilterCodigo('flow_exceeds_water_right');
    expect(c.visibles().length).toBe(3);
  });

  it('marcar todo respeta el chip activo', () => {
    const c = crear();
    c.setFilterCodigo('flow_exceeds_water_right');
    c.alternarTodosVisibles();
    expect(c.seleccionados()).toBe(2);
    expect(c.estaMarcado(SLOTS[2]!)).toBe(false);
  });

  it('la selección sobrevive al cambio de chip', () => {
    const c = crear();
    c.setFilterCodigo('flow_exceeds_water_right');
    c.alternarTodosVisibles();
    c.setFilterCodigo('no_data_stale');
    c.alternarTodosVisibles();
    expect(c.seleccionados()).toBe(3);
  });

  it('exige nota de al menos 5 caracteres antes de actuar', () => {
    const c = crear();
    c.alternarMarca(SLOTS[0]!);
    c.bulkNote.set('ok');
    c.aceptarSeleccionados();
    expect(aplicadas.length).toBe(0);
    expect(c.error()).toContain('nota admin');
  });

  /**
   * El invariante que importa: UNA petición por lote, no una por slot.
   *
   * El código 2FA es de un solo uso, así que abanicar N peticiones hacía que el
   * interceptor pidiera N códigos y mandara N correos. Si alguien vuelve a
   * meter un bucle acá, este test lo caza.
   */
  it('manda UNA sola petición para todo el lote', () => {
    const c = crear();
    c.alternarMarca(SLOTS[0]!);
    c.alternarMarca(SLOTS[1]!);
    c.bulkNote.set('Caudal verificado contra el totalizador');
    c.aceptarSeleccionados();

    expect(lotes.length).toBe(1);
    expect(lotes[0]!.items.length).toBe(2);
    // El endpoint de a uno no se toca en el flujo en bloque.
    expect(aplicadas.length).toBe(0);
  });

  it('aplica la misma nota a todos los marcados y los saca de la cola', () => {
    const c = crear();
    c.alternarMarca(SLOTS[0]!);
    c.alternarMarca(SLOTS[1]!);
    c.bulkNote.set('Caudal verificado contra el totalizador');
    c.aceptarSeleccionados();

    expect(lotes[0]!.action).toBe('accept');
    expect(lotes[0]!.admin_note).toBe('Caudal verificado contra el totalizador');
    // Se declaran los valores tal como venían del sensor.
    expect(lotes[0]!.items[0]!.values?.caudal_instantaneo).toBe(77.9);
    expect(c.slots().length).toBe(1);
    expect(c.seleccionados()).toBe(0);
    expect(c.bulkProgress()).toBeNull();
  });

  it('descartar en bloque no manda valores', () => {
    const c = crear();
    c.alternarMarca(SLOTS[0]!);
    c.bulkNote.set('Sin dato crudo declarable');
    c.descartarSeleccionados();
    expect(lotes[0]!.action).toBe('discard');
    expect(lotes[0]!.items[0]!.values).toBeUndefined();
  });

  it('un slot que falla no aborta el lote y queda en la cola', () => {
    const c = crear();
    fallarEn = '2026-09-10T12:00:00.000Z';
    c.alternarMarca(SLOTS[0]!);
    c.alternarMarca(SLOTS[1]!);
    c.bulkNote.set('Nota de prueba suficiente');
    c.aceptarSeleccionados();

    // Los dos viajaron en el mismo lote; el backend informa cuál no pudo.
    expect(lotes[0]!.items.length).toBe(2);
    // El que falló sigue en la lista y sigue marcado, listo para reintentar.
    expect(c.slots().length).toBe(2);
    expect(c.slots().some((s) => s.ts === fallarEn)).toBe(true);
    expect(c.estaMarcado(SLOTS[0]!)).toBe(true);
    expect(c.error()).toContain('1 medición(es) fallaron');
  });
});
