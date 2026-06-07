import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

export type AlarmMetric = 'temperatura' | 'humedad' | 'transmision';
export type AlarmOp = '>' | '>=' | '<' | '<=';
export type AlarmTargetKind = 'all' | 'sala' | 'sensor';
export type AlarmSeverity = 'info' | 'warn' | 'crit';

export interface AlarmRule {
  id: string;
  name: string;
  enabled: boolean;
  metric: AlarmMetric;
  op: AlarmOp;
  threshold: number;
  targetKind: AlarmTargetKind;
  targetValue: string | null;
  sustainedMin: number;
  severity: AlarmSeverity;
  notifyEmail: boolean;
  notifyUi: boolean;
  recipientIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface AlarmRecipient {
  id?: number;
  email: string;
  name?: string | null;
  enabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class ColdRoomAlarmRulesService {
  private readonly http = inject(HttpClient);
  private readonly rulesSignal = signal<AlarmRule[]>([]);
  private readonly recipientsSignal = signal<AlarmRecipient[]>([]);
  private currentSiteId: string | null = null;

  readonly rules = computed(() => this.rulesSignal());
  readonly recipients = computed(() => this.recipientsSignal());

  setSiteId(siteId: string): void {
    if (this.currentSiteId === siteId) return;
    this.currentSiteId = siteId;
    this.refresh();
    this.refreshRecipients();
  }

  refresh(): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .get<{ ok: boolean; data: AlarmRule[] }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-rules`,
      )
      .subscribe({
        next: (res) => {
          if (res.ok) this.rulesSignal.set(res.data || []);
        },
      });
  }

  refreshRecipients(): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .get<{ ok: boolean; data: AlarmRecipient[] }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-recipients`,
      )
      .subscribe({
        next: (res) => {
          if (res.ok) this.recipientsSignal.set(res.data || []);
        },
      });
  }

  add(rule: Omit<AlarmRule, 'id' | 'createdAt' | 'updatedAt'>): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .post<{ ok: boolean }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-rules`,
        rule,
      )
      .subscribe({ next: () => this.refresh() });
  }

  update(id: string, patch: Partial<Omit<AlarmRule, 'id' | 'createdAt'>>): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    const cur = this.rulesSignal().find((r) => r.id === id);
    if (!cur) return;
    const merged = { ...cur, ...patch };
    this.http
      .put<{ ok: boolean }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-rules/${encodeURIComponent(id)}`,
        merged,
      )
      .subscribe({ next: () => this.refresh() });
  }

  remove(id: string): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .delete<{ ok: boolean }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-rules/${encodeURIComponent(id)}`,
      )
      .subscribe({ next: () => this.refresh() });
  }

  toggle(id: string): void {
    const cur = this.rulesSignal().find((r) => r.id === id);
    if (!cur) return;
    this.update(id, { enabled: !cur.enabled });
  }

  addRecipient(payload: { email: string; name?: string; enabled?: boolean }): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .post<{ ok: boolean }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-recipients`,
        payload,
      )
      .subscribe({ next: () => this.refreshRecipients() });
  }

  removeRecipient(id: number): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .delete<{ ok: boolean }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-recipients/${id}`,
      )
      .subscribe({ next: () => this.refreshRecipients() });
  }

  describeRule(rule: AlarmRule): string {
    const metricLabel: Record<AlarmMetric, string> = {
      temperatura: 'Temperatura',
      humedad: 'Humedad',
      transmision: 'Sin transmitir (min)',
    };
    const unit =
      rule.metric === 'temperatura' ? '°C' : rule.metric === 'humedad' ? '%' : 'min';
    const targetLabel =
      rule.targetKind === 'all'
        ? 'Todos los sensores'
        : rule.targetKind === 'sala'
          ? `Sala: ${rule.targetValue || '—'}`
          : `Sensor: ${rule.targetValue || '—'}`;
    const sustained = rule.sustainedMin > 0 ? ` sostenida ${rule.sustainedMin}min` : '';
    return `${metricLabel[rule.metric]} ${rule.op} ${rule.threshold}${unit}${sustained} · ${targetLabel}`;
  }
}
