import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import type { CompanyNode, SiteRecord } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import {
  ColdRoomService,
  type ColdRoomConcentratorChannel,
} from '../../services/cold-room.service';
import { TapKey, tapColorFor, tapIndexFromKey, tapKeyFor } from './ventisqueros-data';

type DiagStatus = 'online' | 'degraded' | 'offline' | 'unknown';
type SortKey = 'id' | 'rssi' | 'lastSeen' | 'status';
type SortDir = 'asc' | 'desc';

const POLL_MS = 10_000;
const STALE_MS = 60_000;

@Component({
  selector: 'app-ventisqueros-tap-diag-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style="background:#F0F2F5;">
      <!-- Header -->
      <div class="diag-header flex flex-wrap items-center gap-3 border-t border-b px-5 py-2.5">
        <button
          type="button"
          (click)="goBack()"
          class="diag-icon-btn"
          aria-label="Volver"
        >
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
        </button>
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
          [style.background]="tapColor() + '1A'"
          [style.border]="'1px solid ' + tapColor() + '40'"
        >
          <span class="material-symbols-outlined text-[18px]" [style.color]="tapColor()"
            >memory</span>
        </div>
        <div class="min-w-0">
          <div class="diag-title truncate">{{ siteName() }} · {{ tapId() }}</div>
          <div class="mt-0.5 text-[11px] text-slate-400">Diagnóstico de red · concentrador</div>
        </div>

        <span class="diag-status-pill ml-auto" [attr.data-status]="tapStatus()">
          <span class="diag-status-dot"></span>
          {{ statusLabel() }}
        </span>

        <button
          type="button"
          class="diag-icon-btn"
          [disabled]="isLoading()"
          (click)="refresh()"
          title="Actualizar"
        >
          <span class="material-symbols-outlined text-[16px]" [class.diag-spin]="isLoading()"
            >sync</span>
        </button>

        <button
          type="button"
          class="diag-btn"
          (click)="exportJson()"
          [disabled]="channels().length === 0"
          title="Exportar diagnóstico"
        >
          <span class="material-symbols-outlined text-[16px]">download</span>
          JSON
        </button>
      </div>

      <!-- Content -->
      <div class="diag-content min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
        @if (channels().length === 0 && isLoading()) {
          <div class="empty-block">Cargando diagnóstico…</div>
        } @else if (channels().length === 0) {
          <div class="empty-state">
            <span class="material-symbols-outlined text-[36px] text-slate-300">network_check</span>
            <div class="empty-title">Sin datos de red para {{ tapId() }}</div>
            <div class="empty-sub">
              El concentrador no reportó canales para este TAP. Reintenta o verifica conectividad.
            </div>
          </div>
        } @else {
          <!-- KPI strip -->
          <div class="kpi-strip mb-5">
            <div class="kpi-card">
              <div class="kpi-val" [style.color]="tapStatusColor()">
                {{ onlineCount() }}<span class="kpi-total">/{{ channels().length }}</span>
              </div>
              <div class="kpi-lbl">Canales online</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-val">{{ avgRssi() !== null ? avgRssi() + ' dBm' : '—' }}</div>
              <div class="kpi-lbl">RSSI promedio</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-val" [style.color]="staleCount() > 0 ? '#DC2626' : '#1E293B'">
                {{ staleCount() }}
              </div>
              <div class="kpi-lbl">Canales stale &gt;60s</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-val">{{ relativeMs(oldestSeenMs()) }}</div>
              <div class="kpi-lbl">Último visto (peor canal)</div>
            </div>
          </div>

          <!-- RSSI distribution -->
          <section class="mb-5">
            <h3 class="section-title mb-2">Distribución RSSI</h3>
            <div class="rssi-dist">
              <div class="rssi-dist-track">
                @for (b of rssiBuckets(); track b.range) {
                  <div
                    class="rssi-dist-bucket"
                    [style.flex]="b.count"
                    [style.background]="b.color"
                    [title]="b.range + ' dBm — ' + b.count + ' canales'"
                  >
                    @if (b.count > 0) {
                      <span class="rssi-dist-count">{{ b.count }}</span>
                    }
                  </div>
                }
              </div>
              <div class="rssi-dist-legend">
                @for (b of rssiBuckets(); track b.range) {
                  <span class="rssi-dist-legend-item">
                    <span class="rssi-dist-legend-dot" [style.background]="b.color"></span>
                    {{ b.range }}
                  </span>
                }
              </div>
            </div>
          </section>

          <!-- Toolbar -->
          <div class="diag-toolbar mb-2">
            <div class="diag-filter">
              <span class="diag-filter-lbl">Filtrar</span>
              <button
                type="button"
                class="diag-pill"
                [class.diag-pill--active]="filter() === 'all'"
                (click)="filter.set('all')"
              >
                Todos
              </button>
              <button
                type="button"
                class="diag-pill"
                [class.diag-pill--active]="filter() === 'online'"
                (click)="filter.set('online')"
              >
                Online
              </button>
              <button
                type="button"
                class="diag-pill"
                [class.diag-pill--active]="filter() === 'stale'"
                (click)="filter.set('stale')"
              >
                Stale ({{ staleCount() }})
              </button>
              <button
                type="button"
                class="diag-pill"
                [class.diag-pill--active]="filter() === 'offline'"
                (click)="filter.set('offline')"
              >
                Offline
              </button>
            </div>
            <div class="diag-search">
              <span class="material-symbols-outlined diag-search-icon">search</span>
              <input
                type="search"
                class="diag-search-input"
                placeholder="Buscar canal o área…"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
              />
            </div>
          </div>

          <!-- Channels table -->
          <div class="ch-table" role="table">
            <div class="ch-table-head" role="row">
              <button class="th-btn" (click)="toggleSort('id')">
                Canal {{ sortArrow('id') }}
              </button>
              <span>Área</span>
              <button class="th-btn text-right" (click)="toggleSort('rssi')">
                RSSI {{ sortArrow('rssi') }}
              </button>
              <span>Señal</span>
              <button class="th-btn text-right" (click)="toggleSort('lastSeen')">
                Último visto {{ sortArrow('lastSeen') }}
              </button>
              <button class="th-btn" (click)="toggleSort('status')">
                Estado {{ sortArrow('status') }}
              </button>
            </div>
            @for (c of filteredChannels(); track c.id; let i = $index) {
              <div
                class="ch-row anim-stagger"
                [class.ch-row--stale]="isStale(c)"
                [class.ch-row--offline]="!c.online"
                [style.--i]="i"
                role="row"
              >
                <span class="ch-id">{{ c.id }}</span>
                <span class="ch-area truncate" [title]="c.area">{{ c.area }}</span>
                <span class="ch-rssi text-right">{{ c.rssi }} dBm</span>
                <span class="ch-bar-cell">
                  <span class="ch-bar-track">
                    <span class="ch-bar-fill" [style.width.%]="rssiBarPct(c.rssi)"></span>
                  </span>
                  <span class="ch-bar-label">{{ rssiLabel(c.rssi) }}</span>
                </span>
                <span class="ch-last text-right">{{ relativeIso(c.lastSeen) }}</span>
                <span class="ch-status-pill" [attr.data-status]="channelStatus(c)">
                  <span class="diag-status-dot"></span>
                  {{ channelStatusLabel(c) }}
                </span>
              </div>
            }
            @if (filteredChannels().length === 0) {
              <div class="empty-block">
                Sin canales para el filtro actual.
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; height: 100%; }

      .diag-header {
        background: linear-gradient(180deg, #fbfcfd, #f8fafc);
        border-bottom-width: 2px;
        border-top-color: #e2e8f0;
        border-bottom-color: #6366f1;
      }
      .diag-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 36px;
        width: 36px;
        border-radius: 9px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #64748b;
        transition: color 0.15s ease, background 0.15s ease;
      }
      .diag-icon-btn:hover { color: #6366f1; }
      .diag-icon-btn:disabled { opacity: 0.5; }
      .diag-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 12px;
        border-radius: 9px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 500;
      }
      .diag-btn:hover { color: #6366f1; background: rgba(99, 102, 241, 0.05); }
      .diag-btn:disabled { opacity: 0.5; }
      .diag-spin { animation: diagSpin 0.8s linear infinite; }
      @keyframes diagSpin { to { transform: rotate(360deg); } }

      .diag-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }

      .diag-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-family: 'DM Sans', sans-serif;
        font-size: 11px;
        font-weight: 600;
        background: rgba(34, 197, 94, 0.10);
        color: #15803d;
        border: 1px solid rgba(34, 197, 94, 0.22);
      }
      .diag-status-pill[data-status='degraded'] {
        background: rgba(251, 191, 36, 0.12);
        color: #b45309;
        border-color: rgba(251, 191, 36, 0.30);
      }
      .diag-status-pill[data-status='offline'] {
        background: rgba(239, 68, 68, 0.12);
        color: #b91c1c;
        border-color: rgba(239, 68, 68, 0.30);
      }
      .diag-status-pill[data-status='unknown'] {
        background: #f1f5f9;
        color: #64748b;
        border-color: #e2e8f0;
      }
      .diag-status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .section-title {
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #475569;
        margin: 0;
      }

      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 10px;
      }
      .kpi-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
      }
      .kpi-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 26px;
        font-weight: 600;
        color: #1e293b;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .kpi-total {
        font-size: 16px;
        color: #94a3b8;
        font-weight: 500;
        margin-left: 2px;
      }
      .kpi-lbl {
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        margin-top: 6px;
      }

      /* RSSI distribution */
      .rssi-dist {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px;
      }
      .rssi-dist-track {
        display: flex;
        height: 14px;
        border-radius: 999px;
        overflow: hidden;
        background: #f1f5f9;
      }
      .rssi-dist-bucket {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: flex 0.3s ease;
        min-width: 1px;
      }
      .rssi-dist-count {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 700;
        color: #ffffff;
      }
      .rssi-dist-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 8px;
        font-family: 'DM Sans', sans-serif;
        font-size: 10.5px;
        color: #64748b;
      }
      .rssi-dist-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .rssi-dist-legend-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 2px;
      }

      /* Toolbar */
      .diag-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 14px;
        padding: 8px 10px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      .diag-filter,
      .diag-search {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .diag-filter-lbl {
        font-family: 'DM Sans', sans-serif;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .diag-pill {
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
      }
      .diag-pill:hover { color: #1e293b; }
      .diag-pill--active {
        background: rgba(99, 102, 241, 0.10);
        color: #6366f1;
        border-color: rgba(99, 102, 241, 0.30);
      }
      .diag-search {
        position: relative;
        margin-left: auto;
        min-width: 220px;
      }
      .diag-search-icon {
        position: absolute;
        left: 9px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 16px;
        color: #94a3b8;
        pointer-events: none;
      }
      .diag-search-input {
        width: 100%;
        padding: 6px 10px 6px 30px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
      }
      .diag-search-input:focus {
        border-color: #6366f1;
        outline: none;
      }

      /* Channels table */
      .ch-table {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        margin-top: 10px;
        overflow: hidden;
      }
      .ch-table-head,
      .ch-row {
        display: grid;
        grid-template-columns: 60px minmax(0, 1fr) 80px 160px 80px 92px;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid #f1f5f9;
      }
      .ch-table-head {
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        background: #fafbfc;
      }
      .th-btn {
        background: transparent;
        border: 0;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        text-align: left;
        letter-spacing: 0.08em;
      }
      .th-btn:hover { color: #475569; }
      .ch-row {
        font-family: 'DM Sans', sans-serif;
        font-size: 12.5px;
        color: #1e293b;
      }
      .ch-row--stale {
        background: rgba(251, 191, 36, 0.06);
      }
      .ch-row--offline {
        background: rgba(239, 68, 68, 0.06);
      }
      .ch-id {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 2px 6px;
        color: #475569;
        text-align: center;
      }
      .ch-area {
        color: #475569;
      }
      .ch-rssi,
      .ch-last {
        font-family: 'JetBrains Mono', monospace;
        font-variant-numeric: tabular-nums;
        color: #1e293b;
      }
      .ch-bar-cell {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ch-bar-track {
        flex: 1;
        height: 6px;
        background: #f1f5f9;
        border-radius: 3px;
        overflow: hidden;
      }
      .ch-bar-fill {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #ef4444, #f59e0b 40%, #22c55e 75%);
      }
      .ch-bar-label {
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        min-width: 56px;
        text-align: right;
      }
      .ch-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border-radius: 999px;
        font-family: 'DM Sans', sans-serif;
        font-size: 10.5px;
        font-weight: 600;
        background: rgba(34, 197, 94, 0.10);
        color: #15803d;
        border: 1px solid rgba(34, 197, 94, 0.22);
      }
      .ch-status-pill[data-status='stale'] {
        background: rgba(251, 191, 36, 0.12);
        color: #b45309;
        border-color: rgba(251, 191, 36, 0.30);
      }
      .ch-status-pill[data-status='offline'] {
        background: rgba(239, 68, 68, 0.12);
        color: #b91c1c;
        border-color: rgba(239, 68, 68, 0.30);
      }

      .empty-block {
        text-align: center;
        padding: 28px;
        color: #94a3b8;
        font-size: 12.5px;
      }
      .empty-state {
        text-align: center;
        padding: 60px 24px;
        background: #ffffff;
        border: 1px dashed #e2e8f0;
        border-radius: 14px;
      }
      .empty-title {
        font-family: 'DM Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #475569;
        margin-top: 8px;
      }
      .empty-sub {
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
        color: #94a3b8;
        margin-top: 4px;
      }

      .anim-stagger {
        opacity: 0;
        transform: translateY(3px);
        animation: rowIn 0.28s ease forwards;
        animation-delay: calc(var(--i, 0) * 22ms);
      }
      @keyframes rowIn { to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) {
        .anim-stagger { animation: none; opacity: 1; transform: none; }
        .diag-spin { animation: none; }
      }
    `,
  ],
})
export class VentisquerosTapDiagDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly coldRoom = inject(ColdRoomService);
  private readonly companyService = inject(CompanyService);
  private readonly location = inject(Location);

  goBack(): void {
    this.location.back();
  }

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  readonly siteId = computed(() => this.params().get('siteId') || '');
  readonly tapId = computed<TapKey>(() => {
    const raw = this.params().get('tapId');
    if (raw) {
      const decoded = decodeURIComponent(raw).toUpperCase().replace(/-/g, ' ').trim();
      const match = decoded.match(/TAP\s*(\d+)/);
      if (match) return tapKeyFor(Number(match[1]) - 1);
    }
    return tapKeyFor(0);
  });
  readonly tapColor = computed(() => tapColorFor(tapIndexFromKey(this.tapId())));

  readonly siteRecord = signal<SiteRecord | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly serviceError = signal<string | null>(null);
  readonly now = signal<number>(Date.now());
  readonly allChannels = signal<ColdRoomConcentratorChannel[]>([]);
  readonly filter = signal<'all' | 'online' | 'stale' | 'offline'>('all');
  readonly query = signal<string>('');
  readonly sort = signal<{ key: SortKey; dir: SortDir }>({ key: 'rssi', dir: 'asc' });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private clockId: ReturnType<typeof setInterval> | null = null;

  readonly backLink = computed(() => ['/companies']);
  readonly siteName = computed(() => this.siteRecord()?.descripcion || 'Sitio');

  readonly channels = computed(() =>
    this.allChannels().filter((c) => c.tap === this.tapId()),
  );

  readonly onlineCount = computed(() => this.channels().filter((c) => c.online).length);

  readonly staleCount = computed(() => {
    const now = this.now();
    return this.channels().filter((c) => {
      if (!c.lastSeen) return true;
      return now - new Date(c.lastSeen).getTime() > STALE_MS;
    }).length;
  });

  readonly avgRssi = computed(() => {
    const list = this.channels();
    if (list.length === 0) return null;
    return Math.round(list.reduce((a, b) => a + b.rssi, 0) / list.length);
  });

  readonly oldestSeenMs = computed<number | null>(() => {
    const now = this.now();
    const times = this.channels()
      .map((c) => (c.lastSeen ? new Date(c.lastSeen).getTime() : null))
      .filter((n): n is number => n !== null);
    if (times.length === 0) return null;
    return now - Math.min(...times);
  });

  readonly tapStatus = computed<DiagStatus>(() => {
    const list = this.channels();
    if (list.length === 0) return 'unknown';
    const online = list.filter((c) => c.online).length;
    if (online === 0) return 'offline';
    if (online < list.length || this.staleCount() > 0) return 'degraded';
    return 'online';
  });

  readonly statusLabel = computed(() => {
    switch (this.tapStatus()) {
      case 'online':
        return 'Online';
      case 'degraded':
        return 'Degradado';
      case 'offline':
        return 'Offline';
      default:
        return 'Sin datos';
    }
  });

  readonly tapStatusColor = computed(() => {
    switch (this.tapStatus()) {
      case 'online':
        return '#22C55E';
      case 'degraded':
        return '#F59E0B';
      case 'offline':
        return '#EF4444';
      default:
        return '#94A3B8';
    }
  });

  readonly rssiBuckets = computed(() => {
    const buckets = [
      { range: 'Excelente ≥ -60', min: -60, max: 0, color: '#22C55E', count: 0 },
      { range: 'Bueno -60..-75', min: -75, max: -60, color: '#84CC16', count: 0 },
      { range: 'Regular -75..-85', min: -85, max: -75, color: '#F59E0B', count: 0 },
      { range: 'Pobre < -85', min: -200, max: -85, color: '#EF4444', count: 0 },
    ];
    for (const c of this.channels()) {
      for (const b of buckets) {
        if (c.rssi > b.min && c.rssi <= b.max) {
          b.count++;
          break;
        }
      }
    }
    return buckets;
  });

  readonly filteredChannels = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    const now = this.now();
    let list = this.channels().filter((c) => {
      if (f === 'online') return c.online && !this.isStaleAt(c, now);
      if (f === 'offline') return !c.online;
      if (f === 'stale') return this.isStaleAt(c, now);
      return true;
    });
    if (q) {
      list = list.filter(
        (c) => c.id.toLowerCase().includes(q) || c.area.toLowerCase().includes(q),
      );
    }
    const s = this.sort();
    const dir = s.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (s.key) {
        case 'id':
          return a.id.localeCompare(b.id) * dir;
        case 'rssi':
          return (a.rssi - b.rssi) * dir;
        case 'lastSeen': {
          const aT = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
          const bT = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
          return (aT - bT) * dir;
        }
        case 'status': {
          const aRank = !a.online ? 2 : this.isStaleAt(a, now) ? 1 : 0;
          const bRank = !b.online ? 2 : this.isStaleAt(b, now) ? 1 : 0;
          return (aRank - bRank) * dir;
        }
      }
    });
    return list;
  });

  ngOnInit(): void {
    const id = this.siteId();
    if (!id) {
      this.router.navigate(['/companies']);
      return;
    }
    this.clockId = setInterval(() => this.now.set(Date.now()), 2_000);
    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (res.ok) {
          const site = this.findSite(res.data, id);
          if (site) this.siteRecord.set(site);
        }
        this.fetchData();
      },
      error: () => this.fetchData(),
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    if (this.clockId !== null) clearInterval(this.clockId);
  }

  refresh(): void {
    this.fetchData();
  }

  toggleSort(key: SortKey): void {
    const cur = this.sort();
    if (cur.key === key) {
      this.sort.set({ key, dir: cur.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      this.sort.set({ key, dir: 'asc' });
    }
  }

  sortArrow(key: SortKey): string {
    const cur = this.sort();
    if (cur.key !== key) return '';
    return cur.dir === 'asc' ? '↑' : '↓';
  }

  isStale(c: ColdRoomConcentratorChannel): boolean {
    return this.isStaleAt(c, this.now());
  }

  channelStatus(c: ColdRoomConcentratorChannel): 'online' | 'stale' | 'offline' {
    if (!c.online) return 'offline';
    if (this.isStale(c)) return 'stale';
    return 'online';
  }

  channelStatusLabel(c: ColdRoomConcentratorChannel): string {
    const s = this.channelStatus(c);
    if (s === 'online') return 'Online';
    if (s === 'stale') return 'Stale';
    return 'Offline';
  }

  rssiLabel(rssi: number): string {
    if (rssi > -60) return 'Excelente';
    if (rssi > -75) return 'Bueno';
    if (rssi > -85) return 'Regular';
    return 'Pobre';
  }

  rssiBarPct(rssi: number): number {
    const clamped = Math.max(-100, Math.min(-30, rssi));
    return Math.round(((clamped + 100) / 70) * 100);
  }

  relativeIso(iso: string | null): string {
    if (!iso) return '—';
    const diff = Math.max(0, this.now() - new Date(iso).getTime());
    return this.relativeMs(diff);
  }

  relativeMs(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return 'recién';
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h`;
  }

  exportJson(): void {
    const payload = {
      tap: this.tapId(),
      capturedAt: new Date().toISOString(),
      tapStatus: this.tapStatus(),
      onlineCount: this.onlineCount(),
      total: this.channels().length,
      avgRssi: this.avgRssi(),
      staleCount: this.staleCount(),
      channels: this.channels(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tap-diag-${this.tapId().replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private isStaleAt(c: ColdRoomConcentratorChannel, now: number): boolean {
    if (!c.lastSeen) return true;
    return now - new Date(c.lastSeen).getTime() > STALE_MS;
  }

  private findSite(tree: CompanyNode[], siteId: string): SiteRecord | null {
    for (const c of tree) {
      for (const sub of c.subCompanies || []) {
        const s = (sub.sites || []).find((x) => x.id === siteId);
        if (s) return s;
      }
    }
    return null;
  }

  private fetchData(): void {
    const id = this.siteId();
    if (!id) return;
    this.isLoading.set(true);
    this.coldRoom.getConcentrator(id).subscribe({
      next: (res) => {
        if (res.ok) {
          this.allChannels.set(res.data?.channels || []);
          this.serviceError.set(null);
        } else {
          this.serviceError.set(res.error || 'Sin datos');
        }
        this.isLoading.set(false);
        this.scheduleNextPoll();
      },
      error: () => {
        this.serviceError.set('Error de conexión');
        this.isLoading.set(false);
        this.scheduleNextPoll();
      },
    });
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.fetchData(), POLL_MS);
  }
}
