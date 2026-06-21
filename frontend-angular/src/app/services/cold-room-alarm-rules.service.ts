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
  recipientUserIds: string[];
  /** Visibilidad: si true, la ve todo el sitio; si false, solo viewerUserIds. */
  visibleToAll: boolean;
  viewerUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EligibleUser {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  cargo: string | null;
  tipo: string;
}

@Injectable({ providedIn: 'root' })
export class ColdRoomAlarmRulesService {
  private readonly http = inject(HttpClient);
  private readonly rulesSignal = signal<AlarmRule[]>([]);
  private readonly usersSignal = signal<EligibleUser[]>([]);
  private readonly rulesLoadedSignal = signal<boolean>(false);
  private readonly usersLoadedSignal = signal<boolean>(false);
  private currentSiteId: string | null = null;

  readonly rules = computed(() => this.rulesSignal());
  readonly eligibleUsers = computed(() => this.usersSignal());
  readonly rulesLoaded = computed(() => this.rulesLoadedSignal());
  readonly usersLoaded = computed(() => this.usersLoadedSignal());

  setSiteId(siteId: string): void {
    this.currentSiteId = siteId;
    if (!siteId) return;
    this.refresh();
    this.refreshEligibleUsers();
  }

  refresh(): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .get<{
        ok: boolean;
        data: AlarmRule[];
      }>(`/api/cold-room/${encodeURIComponent(sid)}/alarm-rules`)
      .subscribe({
        next: (res) => {
          if (res.ok) this.rulesSignal.set(res.data || []);
          this.rulesLoadedSignal.set(true);
        },
        error: () => this.rulesLoadedSignal.set(true),
      });
  }

  refreshEligibleUsers(): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .get<{
        ok: boolean;
        data: EligibleUser[];
      }>(`/api/cold-room/${encodeURIComponent(sid)}/alarm-eligible-users`)
      .subscribe({
        next: (res) => {
          if (res.ok) this.usersSignal.set(res.data || []);
          this.usersLoadedSignal.set(true);
        },
        error: () => this.usersLoadedSignal.set(true),
      });
  }

  add(rule: Omit<AlarmRule, 'id' | 'createdAt' | 'updatedAt'>): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .post<{ ok: boolean }>(`/api/cold-room/${encodeURIComponent(sid)}/alarm-rules`, rule)
      .subscribe({ next: () => this.refresh() });
  }

  update(id: string, patch: Partial<Omit<AlarmRule, 'id' | 'createdAt'>>): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    const cur = this.rulesSignal().find((r) => r.id === id);
    if (!cur) return;
    const merged = { ...cur, ...patch };
    this.http
      .put<{
        ok: boolean;
      }>(`/api/cold-room/${encodeURIComponent(sid)}/alarm-rules/${encodeURIComponent(id)}`, merged)
      .subscribe({ next: () => this.refresh() });
  }

  remove(id: string): void {
    const sid = this.currentSiteId;
    if (!sid) return;
    this.http
      .delete<{
        ok: boolean;
      }>(`/api/cold-room/${encodeURIComponent(sid)}/alarm-rules/${encodeURIComponent(id)}`)
      .subscribe({ next: () => this.refresh() });
  }

  toggle(id: string): void {
    const cur = this.rulesSignal().find((r) => r.id === id);
    if (!cur) return;
    this.update(id, { enabled: !cur.enabled });
  }

  describeRule(rule: AlarmRule): string {
    const metricLabel: Record<AlarmMetric, string> = {
      temperatura: 'Temperatura',
      humedad: 'Humedad',
      transmision: 'Sin transmitir (min)',
    };
    const unit = rule.metric === 'temperatura' ? '°C' : rule.metric === 'humedad' ? '%' : 'min';
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
