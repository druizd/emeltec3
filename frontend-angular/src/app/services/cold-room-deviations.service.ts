import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ColdRoomThresholdsService,
  type AlertLevel,
} from './cold-room-thresholds.service';
import { ColdRoomDefrostService } from './cold-room-defrost.service';
import { ColdRoomAuditService } from './cold-room-audit.service';
import type { ColdRoomSensor } from './cold-room.service';

/**
 * Desviación HACCP de temperatura.
 * Terminología oficial Chile: SERNAPESCA Res. Ex. 3160/2016 (Programa Sanitario
 * Específico Productos Pesqueros) — "desviación de límite crítico".
 * También compatible con Codex Alimentarius CAC/RCP 1-1969.
 */
export interface Deviation {
  /** Stable id derived from sensorId + startTs. */
  id: string;
  sensorId: string;
  area: string;
  tap: string;
  startTs: string;
  endTs: string | null;
  durationMin: number;
  peakT: number;
  thresholdMax: number;
  level: AlertLevel;
  ongoing: boolean;
  /** True if the deviation falls within a scheduled defrost window. */
  defrost: boolean;
  /** Overlap minutes with defrost windows (subtractable from HACCP totals). */
  defrostOverlapMin: number;
  /** Effective sustained minutes after subtracting defrost overlap. */
  effectiveMin: number;
}

/**
 * Causa documentada de una desviación. Requisito HACCP: cada incidente debe
 * tener causa registrada para auditoría SERNAPESCA.
 */
export type DeviationCause =
  | 'defrost'
  | 'door-open'
  | 'load-unload'
  | 'cleaning'
  | 'other';

/**
 * Source: 'auto' = sistema clasificó por schedule defrost.
 *         'manual' = operario marcó causa explícitamente.
 */
export type DeviationCauseSource = 'auto' | 'manual';

export interface DeviationCauseMeta {
  label: string;
  /** Si true, la causa es esperada → no requiere ack/resolve para cerrar. */
  expected: boolean;
  icon: string;
}

export const DEVIATION_CAUSES: Record<DeviationCause, DeviationCauseMeta> = {
  defrost: { label: 'Defrost', expected: true, icon: 'ac_unit' },
  'door-open': { label: 'Apertura puerta', expected: false, icon: 'door_open' },
  'load-unload': { label: 'Carga/descarga', expected: false, icon: 'pallet' },
  cleaning: { label: 'Limpieza/mantención', expected: false, icon: 'cleaning_services' },
  other: { label: 'Otra', expected: false, icon: 'help' },
};

export interface DeviationAck {
  acknowledged: boolean;
  ackedAt?: string;
  ackedBy?: string;
  note?: string;
  resolved?: boolean;
  resolvedAt?: string;
  cause?: DeviationCause;
  causeSource?: DeviationCauseSource;
  causeBy?: string;
  causeAt?: string;
  causeNote?: string;
}

type AckMap = Record<string, DeviationAck>;

const ACK_STORAGE_KEY = 'coldroom:deviation-acks:v1';

@Injectable({ providedIn: 'root' })
export class ColdRoomDeviationsService {
  private readonly thresholds = inject(ColdRoomThresholdsService);
  private readonly defrost = inject(ColdRoomDefrostService);
  private readonly audit = inject(ColdRoomAuditService);
  private readonly acks = signal<AckMap>(this.loadAcks());

  readonly ackMap = computed(() => this.acks());

  /**
   * Build deviation list across all sensors using their histPoints + thresholds.
   * Returns most-recent-first.
   */
  detect(sensors: ColdRoomSensor[]): Deviation[] {
    // Touch schedules signal so detection recomputes when windows change.
    this.defrost.schedules();
    const out: Deviation[] = [];
    for (const s of sensors) {
      const th = this.thresholds.get(s.area);
      if (!th || !s.histPoints || s.histPoints.length === 0) continue;
      const intervals = this.thresholds.detectDeviations(s.area, s.histPoints);
      for (const itv of intervals) {
        const defrostOverlap = this.defrost.defrostOverlapMin(s.area, itv.startTs, itv.endTs);
        const effectiveMin = Math.max(0, itv.durationMin - defrostOverlap);
        const isFullyDefrost = defrostOverlap >= itv.durationMin - 1;
        const level = this.classifyLevel(s.area, effectiveMin, isFullyDefrost);
        out.push({
          id: this.deviationId(s.id, itv.startTs),
          sensorId: s.id,
          area: s.area,
          tap: s.tap,
          startTs: itv.startTs,
          endTs: itv.endTs,
          durationMin: itv.durationMin,
          peakT: itv.peakT,
          thresholdMax: th.tMax,
          level,
          ongoing: itv.endTs === null,
          defrost: isFullyDefrost,
          defrostOverlapMin: defrostOverlap,
          effectiveMin,
        });
      }
    }
    out.sort((a, b) => new Date(b.startTs).getTime() - new Date(a.startTs).getTime());
    return out;
  }

  /**
   * Classifies severity using effective minutes (post-defrost subtraction).
   * If fully within defrost window → 'info' (esperada).
   */
  private classifyLevel(area: string, effectiveMin: number, fullyDefrost: boolean): AlertLevel {
    if (fullyDefrost) return 'info';
    const th = this.thresholds.get(area);
    if (!th) return 'warn';
    // Re-use threshold service multi-level rules.
    const sustained = th.sustainedMin ?? 5;
    const severe = th.severeMin ?? 30;
    if (effectiveMin >= severe) return 'severe';
    if (effectiveMin >= sustained) return 'crit';
    return 'warn';
  }

  deviationId(sensorId: string, startTs: string): string {
    return `${sensorId}@${startTs}`;
  }

  getAck(id: string): DeviationAck | null {
    return this.acks()[id] || null;
  }

  acknowledge(id: string, by = 'operator', note?: string): void {
    const prev = this.acks()[id];
    const next: AckMap = {
      ...this.acks(),
      [id]: {
        ...(prev || {}),
        acknowledged: true,
        ackedAt: new Date().toISOString(),
        ackedBy: by,
        note,
      },
    };
    this.acks.set(next);
    this.persist(next);
    this.audit.record('deviation', 'ack', id, prev, { acknowledged: true }, note);
  }

  resolve(id: string, note?: string): void {
    const cur = this.acks()[id];
    const next: AckMap = {
      ...this.acks(),
      [id]: {
        ...(cur || {}),
        acknowledged: cur?.acknowledged ?? true,
        ackedAt: cur?.ackedAt ?? new Date().toISOString(),
        ackedBy: cur?.ackedBy ?? 'operator',
        resolved: true,
        resolvedAt: new Date().toISOString(),
        note: note ?? cur?.note,
      },
    };
    this.acks.set(next);
    this.persist(next);
    this.audit.record('deviation', 'resolve', id, cur, { resolved: true }, note);
  }

  setNote(id: string, note: string): void {
    const cur = this.acks()[id];
    const next: AckMap = {
      ...this.acks(),
      [id]: { ...(cur || { acknowledged: false }), note },
    };
    this.acks.set(next);
    this.persist(next);
    this.audit.record('deviation', 'note', id, cur?.note, note);
  }

  /**
   * Operator-driven cause classification. Records who/when for audit log.
   * If cause has expected=true, deviation is considered closed (no further ack needed).
   */
  setCause(
    id: string,
    cause: DeviationCause,
    source: DeviationCauseSource = 'manual',
    by = 'operator',
    note?: string,
  ): void {
    const cur = this.acks()[id];
    const meta = DEVIATION_CAUSES[cause];
    const nowIso = new Date().toISOString();
    const next: AckMap = {
      ...this.acks(),
      [id]: {
        ...(cur || { acknowledged: false }),
        cause,
        causeSource: source,
        causeBy: by,
        causeAt: nowIso,
        causeNote: note ?? cur?.causeNote,
        // Expected causes auto-acknowledge + resolve to close the workflow.
        acknowledged: meta.expected ? true : cur?.acknowledged ?? false,
        ackedAt: meta.expected ? cur?.ackedAt ?? nowIso : cur?.ackedAt,
        ackedBy: meta.expected ? cur?.ackedBy ?? by : cur?.ackedBy,
      },
    };
    this.acks.set(next);
    this.persist(next);
    this.audit.record(
      'deviation',
      'classify-cause',
      id,
      cur?.cause,
      { cause, source },
      note,
    );
  }

  clearCause(id: string): void {
    const cur = this.acks()[id];
    if (!cur) return;
    const { cause: _c, causeSource: _s, causeBy: _b, causeAt: _a, causeNote: _n, ...rest } = cur;
    const next: AckMap = { ...this.acks(), [id]: rest };
    this.acks.set(next);
    this.persist(next);
    this.audit.record('deviation', 'clear-cause', id, cur.cause, undefined);
  }

  /**
   * Returns the effective cause: prefers ack.cause; falls back to 'defrost'
   * with source='auto' if defrost flag is true on the Deviation.
   */
  effectiveCause(d: Deviation): { cause: DeviationCause; source: DeviationCauseSource } | null {
    const ack = this.getAck(d.id);
    if (ack?.cause) {
      return { cause: ack.cause, source: ack.causeSource ?? 'manual' };
    }
    if (d.defrost) return { cause: 'defrost', source: 'auto' };
    return null;
  }

  /**
   * Open = ongoing OR (not expected-cause AND not fully acked/resolved).
   * Expected causes (defrost auto/manual) auto-close.
   */
  isOpen(d: Deviation): boolean {
    if (d.ongoing) return true;
    const eff = this.effectiveCause(d);
    if (eff && DEVIATION_CAUSES[eff.cause].expected) return false;
    const ack = this.getAck(d.id);
    if (!ack) return true;
    if (!ack.acknowledged) return true;
    if (!ack.resolved) return true;
    return false;
  }

  private loadAcks(): AckMap {
    try {
      const raw = localStorage.getItem(ACK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AckMap;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  private persist(map: AckMap): void {
    try {
      localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
