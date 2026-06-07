import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AlarmMetric,
  AlarmOp,
  AlarmRule,
  AlarmSeverity,
  AlarmTargetKind,
  ColdRoomAlarmRulesService,
} from '../../../services/cold-room-alarm-rules.service';
import { ColdRoomService } from '../../../services/cold-room.service';

interface DraftRule {
  name: string;
  metric: AlarmMetric;
  op: AlarmOp;
  threshold: number;
  targetKind: AlarmTargetKind;
  targetValue: string;
  sustainedMin: number;
  severity: AlarmSeverity;
  notifyUi: boolean;
  recipientUserIds: string[];
  enabled: boolean;
}

const DEFAULT_DRAFT: DraftRule = {
  name: '',
  metric: 'temperatura',
  op: '>',
  threshold: 10,
  targetKind: 'all',
  targetValue: '',
  sustainedMin: 5,
  severity: 'warn',
  notifyUi: true,
  recipientUserIds: [],
  enabled: true,
};

@Component({
  selector: 'app-companies-alarm-rules-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ar-page">
      <div class="ar-head">
        <div>
          <h2 class="ar-title">Reglas de alarma</h2>
          <p class="ar-sub">
            Configura condiciones personalizadas (temperatura, humedad, sin transmitir) por sala o
            sensor. Las reglas activas se evalúan continuamente y aparecen en la pestaña Alarmas
            de cada sitio.
          </p>
        </div>
        <button
          type="button"
          class="ar-btn ar-btn--primary"
          (click)="openCreate()"
          [disabled]="formOpen()"
        >
          <span class="material-symbols-outlined text-[16px]">add</span>
          Nueva regla
        </button>
      </div>

      @if (formOpen()) {
        <div class="ar-form-card">
          <div class="ar-form-head">
            <div class="ar-form-title">{{ editingId() ? 'Editar regla' : 'Nueva regla' }}</div>
            <button type="button" class="ar-form-close" (click)="closeForm()">
              <span class="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          <div class="ar-form-body">
            <label class="ar-field ar-field--full">
              <span>Nombre</span>
              <input
                type="text"
                [(ngModel)]="draft.name"
                placeholder="Ej. Temperatura alta Matanza"
              />
            </label>

            <label class="ar-field">
              <span>Métrica</span>
              <select [(ngModel)]="draft.metric" (change)="onMetricChange()">
                <option value="temperatura">Temperatura</option>
                <option value="humedad">Humedad relativa</option>
                <option value="transmision">Sin transmitir</option>
              </select>
            </label>

            <label class="ar-field">
              <span>Operador</span>
              <select [(ngModel)]="draft.op">
                <option value=">">Mayor que (&gt;)</option>
                <option value=">=">Mayor o igual (&ge;)</option>
                <option value="<">Menor que (&lt;)</option>
                <option value="<=">Menor o igual (&le;)</option>
              </select>
            </label>

            <label class="ar-field">
              <span>{{ thresholdLabel() }}</span>
              <input
                type="number"
                step="0.1"
                [(ngModel)]="draft.threshold"
              />
            </label>

            <label class="ar-field">
              <span>Sostenida (min)</span>
              <input
                type="number"
                min="0"
                step="1"
                [(ngModel)]="draft.sustainedMin"
                [title]="
                  '0 = dispara inmediato. > 0 = la condición debe mantenerse N minutos antes de disparar.'
                "
              />
            </label>

            <label class="ar-field">
              <span>Objetivo</span>
              <select [(ngModel)]="draft.targetKind" (change)="onTargetKindChange()">
                <option value="all">Todos los sensores</option>
                <option value="sala">Sala específica</option>
                <option value="sensor">Sensor específico</option>
              </select>
            </label>

            @if (draft.targetKind === 'sala') {
              <label class="ar-field">
                <span>Sala</span>
                <select [(ngModel)]="draft.targetValue">
                  <option value="">— Selecciona sala —</option>
                  @for (s of availableSalas(); track s.slug) {
                    <option [value]="s.slug">{{ s.area }} ({{ s.sensorCount }} sensores)</option>
                  }
                </select>
                @if (availableSalas().length === 0) {
                  <small class="ar-hint">Cargando salas… si no aparecen, no hay sitios cold-room.</small>
                }
              </label>
            }
            @if (draft.targetKind === 'sensor') {
              <label class="ar-field">
                <span>Sensor</span>
                <select [(ngModel)]="draft.targetValue">
                  <option value="">— Selecciona sensor —</option>
                  @for (s of availableSensors(); track s.id) {
                    <option [value]="s.id">{{ s.id }} · {{ s.area }} · {{ s.tap }}</option>
                  }
                </select>
                @if (availableSensors().length === 0) {
                  <small class="ar-hint">Cargando sensores…</small>
                }
              </label>
            }

            <label class="ar-field">
              <span>Severidad</span>
              <select [(ngModel)]="draft.severity">
                <option value="info">Info</option>
                <option value="warn">Advertencia</option>
                <option value="crit">Crítica</option>
              </select>
            </label>

            <div class="ar-field ar-field--full">
              <span>¿A quién avisamos por email?</span>
              @if (eligibleUsers().length === 0) {
                <div class="ar-empty-inline">
                  No hay usuarios asignados a esta instalación. Agrega usuarios en
                  <strong>Gestión Usuarios</strong> para poder elegirlos como destinatarios.
                </div>
              } @else {
                <div class="ar-recipient-picker">
                  @for (u of eligibleUsers(); track u.id) {
                    <label class="ar-recipient-check">
                      <input
                        type="checkbox"
                        [checked]="isDraftUser(u.id)"
                        (change)="toggleDraftUser(u.id)"
                      />
                      <span class="ar-recipient-check-info">
                        <span class="ar-recipient-check-email">{{ userLabel(u) }}</span>
                        <span class="ar-recipient-check-name">
                          {{ u.email }}
                          @if (u.cargo) {
                            · {{ u.cargo }}
                          }
                        </span>
                      </span>
                    </label>
                  }
                </div>
                <small class="ar-hint">
                  Si no marcas a nadie, esta regla sólo aparecerá en UI (sin enviar email).
                </small>
              }
            </div>

            <label class="ar-field ar-field--full">
              <span>Estado</span>
              <label class="ar-check">
                <input type="checkbox" [(ngModel)]="draft.enabled" />
                Activa
              </label>
            </label>

            @if (formError(); as err) {
              <div class="ar-error">
                <span class="material-symbols-outlined text-[14px]">error</span>
                {{ err }}
              </div>
            }
          </div>
          <div class="ar-form-foot">
            <button type="button" class="ar-btn" (click)="closeForm()">Cancelar</button>
            <button
              type="button"
              class="ar-btn ar-btn--primary"
              (click)="saveRule()"
            >
              <span class="material-symbols-outlined text-[14px]">save</span>
              {{ editingId() ? 'Guardar cambios' : 'Crear regla' }}
            </button>
          </div>
        </div>
      }

      <div class="ar-list">
        @if (rules().length === 0) {
          <div class="ar-empty">
            <span class="material-symbols-outlined text-[36px] text-slate-300">notifications_off</span>
            <div class="ar-empty-title">Sin reglas configuradas</div>
            <div class="ar-empty-sub">
              Crea la primera para empezar a recibir alarmas personalizadas.
            </div>
          </div>
        } @else {
          @for (r of rules(); track r.id) {
            <article class="ar-card" [class.ar-card--disabled]="!r.enabled">
              <div class="ar-card-head">
                <div class="ar-card-icon" [attr.data-severity]="r.severity">
                  <span class="material-symbols-outlined">{{
                    r.metric === 'temperatura'
                      ? 'thermostat'
                      : r.metric === 'humedad'
                        ? 'water_drop'
                        : 'signal_disconnected'
                  }}</span>
                </div>
                <div class="ar-card-body">
                  <div class="ar-card-title">
                    {{ r.name }}
                    @if (!r.enabled) {
                      <span class="ar-card-tag ar-card-tag--off">Inactiva</span>
                    }
                    <span class="ar-card-sev" [attr.data-severity]="r.severity">
                      {{
                        r.severity === 'crit'
                          ? 'Crítica'
                          : r.severity === 'warn'
                            ? 'Advertencia'
                            : 'Info'
                      }}
                    </span>
                  </div>
                  <div class="ar-card-cond">{{ describe(r) }}</div>
                  <div class="ar-card-meta">
                    <span class="ar-meta-tag">
                      @if (r.notifyUi) {
                        <span class="material-symbols-outlined text-[11px]">notifications_active</span>
                        UI
                      }
                    </span>
                    @if (r.notifyEmail) {
                      <span class="ar-meta-tag">
                        <span class="material-symbols-outlined text-[11px]">mail</span>
                        Email
                      </span>
                    }
                    <span class="ar-meta-tag">
                      <span class="material-symbols-outlined text-[11px]">schedule</span>
                      Actualizada {{ fmtAgo(r.updatedAt) }}
                    </span>
                  </div>
                </div>
                <div class="ar-card-actions">
                  <button
                    type="button"
                    class="ar-icon-btn"
                    (click)="toggle(r.id)"
                    [title]="r.enabled ? 'Desactivar' : 'Activar'"
                  >
                    <span class="material-symbols-outlined text-[16px]">
                      {{ r.enabled ? 'toggle_on' : 'toggle_off' }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="ar-icon-btn"
                    (click)="openEdit(r)"
                    title="Editar"
                  >
                    <span class="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    type="button"
                    class="ar-icon-btn ar-icon-btn--danger"
                    (click)="remove(r.id)"
                    title="Eliminar"
                  >
                    <span class="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            </article>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ar-page {
        padding: 16px;
        background: #f0f2f5;
        min-height: 100%;
      }
      .ar-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .ar-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 18px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .ar-sub {
        margin-top: 4px;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #64748b;
        max-width: 640px;
        line-height: 1.4;
      }
      .ar-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 7px 14px;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 500;
      }
      .ar-btn:hover:not(:disabled) {
        background: #f1f5f9;
      }
      .ar-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .ar-btn--primary {
        background: #0d99a5;
        color: #ffffff;
        border-color: #0d99a5;
      }
      .ar-btn--primary:hover:not(:disabled) {
        background: #0c8b96;
      }

      .ar-form-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        margin-bottom: 16px;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
      }
      .ar-form-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .ar-form-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }
      .ar-form-close {
        background: transparent;
        border: none;
        color: #64748b;
        padding: 4px;
      }
      .ar-form-body {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
        padding: 16px;
      }
      .ar-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #475569;
      }
      .ar-field--full {
        grid-column: 1 / -1;
      }
      .ar-field input,
      .ar-field select {
        padding: 7px 9px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #1e293b;
        background: #ffffff;
        outline: none;
      }
      .ar-field input:focus,
      .ar-field select:focus {
        border-color: #0d99a5;
      }
      .ar-checks {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .ar-check {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #1e293b;
      }
      .ar-hint {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        font-style: italic;
        margin-top: 2px;
      }
      .ar-tag-soon {
        margin-left: 4px;
        padding: 1px 6px;
        background: rgba(148, 163, 184, 0.18);
        color: #64748b;
        border-radius: 999px;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .ar-error {
        grid-column: 1 / -1;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 7px 10px;
        background: rgba(239, 68, 68, 0.10);
        color: #b91c1c;
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 11.5px;
      }
      .ar-form-foot {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        border-radius: 0 0 12px 12px;
      }

      .ar-recipients {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px 16px;
        margin-bottom: 16px;
      }
      .ar-recipients-head {
        margin-bottom: 10px;
      }
      .ar-recipients-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }
      .ar-recipients-meta {
        display: block;
        margin-top: 2px;
        font-family: var(--font-dm);
        font-size: 11px;
        color: #64748b;
      }
      .ar-recipients-add {
        display: grid;
        grid-template-columns: 2fr 1.4fr auto;
        gap: 6px;
        margin-bottom: 10px;
      }
      .ar-recipient-picker {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 6px;
        margin-top: 4px;
      }
      .ar-recipient-check {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }
      .ar-recipient-check:hover {
        border-color: rgba(13, 175, 189, 0.30);
        background: rgba(13, 175, 189, 0.04);
      }
      .ar-recipient-check--off {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .ar-recipient-check input {
        accent-color: #0d99a5;
      }
      .ar-recipient-check-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .ar-recipient-check-email {
        font-family: var(--font-mono);
        font-size: 12px;
        color: #1e293b;
      }
      .ar-recipient-check-name {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #64748b;
        margin-top: 1px;
      }
      .ar-empty-inline {
        padding: 10px;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #94a3b8;
        font-style: italic;
      }
      .ar-recipients-add input,
      .ar-recipients-add select {
        padding: 7px 9px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #1e293b;
        background: #ffffff;
      }
      .ar-recipients-empty {
        padding: 14px;
        text-align: center;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 8px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #94a3b8;
        font-style: italic;
      }
      .ar-recipients-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ar-recipient-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
      }
      .ar-recipient-info {
        flex: 1;
        min-width: 0;
      }
      .ar-recipient-email {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-family: var(--font-mono);
        font-size: 12px;
        color: #1e293b;
        font-weight: 500;
      }
      .ar-recipient-name {
        font-family: var(--font-dm);
        font-size: 11px;
        color: #64748b;
        margin-top: 1px;
      }
      .ar-recipient-sev {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 2px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .ar-recipient-sev strong {
        color: #0d99a5;
      }

      .ar-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ar-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 60px 20px;
        background: #ffffff;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        text-align: center;
      }
      .ar-empty-title {
        font-family: var(--font-dm);
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }
      .ar-empty-sub {
        font-family: var(--font-dm);
        font-size: 12px;
        color: #64748b;
      }
      .ar-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 12px 14px;
        transition: opacity 0.15s, box-shadow 0.15s;
      }
      .ar-card:hover {
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
      }
      .ar-card--disabled {
        opacity: 0.55;
      }
      .ar-card-head {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .ar-card-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 9px;
        flex-shrink: 0;
        background: rgba(13, 175, 189, 0.10);
        color: #0d99a5;
      }
      .ar-card-icon[data-severity='crit'] {
        background: rgba(239, 68, 68, 0.10);
        color: #dc2626;
      }
      .ar-card-icon[data-severity='warn'] {
        background: rgba(245, 158, 11, 0.10);
        color: #d97706;
      }
      .ar-card-icon .material-symbols-outlined {
        font-size: 18px;
      }
      .ar-card-body {
        flex: 1;
        min-width: 0;
      }
      .ar-card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-dm);
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
      }
      .ar-card-sev {
        padding: 1px 7px;
        border-radius: 999px;
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .ar-card-sev[data-severity='crit'] {
        background: rgba(239, 68, 68, 0.12);
        color: #b91c1c;
      }
      .ar-card-sev[data-severity='warn'] {
        background: rgba(245, 158, 11, 0.12);
        color: #b45309;
      }
      .ar-card-sev[data-severity='info'] {
        background: rgba(13, 175, 189, 0.12);
        color: #0d99a5;
      }
      .ar-card-tag {
        padding: 1px 7px;
        border-radius: 999px;
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .ar-card-tag--off {
        background: #f1f5f9;
        color: #64748b;
      }
      .ar-card-cond {
        margin-top: 3px;
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: #475569;
      }
      .ar-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 6px;
      }
      .ar-meta-tag {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #64748b;
      }
      .ar-card-actions {
        display: flex;
        gap: 4px;
        align-self: center;
        flex-shrink: 0;
      }
      .ar-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #64748b;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
      }
      .ar-icon-btn:hover {
        color: #0d99a5;
        border-color: rgba(13, 175, 189, 0.30);
        background: rgba(13, 175, 189, 0.04);
      }
      .ar-icon-btn--danger:hover {
        color: #dc2626;
        border-color: rgba(239, 68, 68, 0.30);
        background: rgba(239, 68, 68, 0.05);
      }
    `,
  ],
})
export class CompaniesAlarmRulesPanelComponent implements OnChanges {
  private readonly svc = inject(ColdRoomAlarmRulesService);
  private readonly coldRoom = inject(ColdRoomService);

  @Input() coldRoomSiteIds: string[] = [];
  @Input() siteId: string = '';

  readonly rules = this.svc.rules;
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly availableSalas = signal<{ slug: string; area: string; sensorCount: number }[]>([]);
  readonly availableSensors = signal<{ id: string; area: string; tap: string }[]>([]);
  draft: DraftRule = { ...DEFAULT_DRAFT };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['coldRoomSiteIds']) this.fetchSensors();
    if (changes['siteId'] && this.siteId) this.svc.setSiteId(this.siteId);
  }

  readonly eligibleUsers = this.svc.eligibleUsers;

  userLabel(u: { nombre: string; apellido: string; email: string }): string {
    const name = `${u.nombre} ${u.apellido}`.trim();
    return name || u.email;
  }

  userById(id: string) {
    return this.eligibleUsers().find((u) => u.id === id);
  }

  private fetchSensors(): void {
    if (this.coldRoomSiteIds.length === 0) return;
    const primary = this.coldRoomSiteIds[0];
    this.coldRoom.getSensors(primary, null, '24h', this.coldRoomSiteIds).subscribe({
      next: (res) => {
        if (!res.ok) return;
        const sensors = (res.data || []).filter((s) => !s.defective);
        // Derivar salas únicas con count.
        const byArea = new Map<string, { area: string; count: number }>();
        for (const s of sensors) {
          const slug = this.slugify(s.area);
          const cur = byArea.get(slug);
          if (cur) cur.count++;
          else byArea.set(slug, { area: s.area, count: 1 });
        }
        const salas = Array.from(byArea.entries())
          .map(([slug, v]) => ({ slug, area: v.area, sensorCount: v.count }))
          .sort((a, b) => a.area.localeCompare(b.area));
        this.availableSalas.set(salas);
        this.availableSensors.set(
          sensors
            .map((s) => ({ id: s.id, area: s.area, tap: s.tap }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        );
      },
    });
  }

  private slugify(area: string): string {
    return (area || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  readonly thresholdLabel = computed(() => {
    switch (this.draft.metric) {
      case 'temperatura':
        return 'Umbral (°C)';
      case 'humedad':
        return 'Umbral (%)';
      case 'transmision':
        return 'Umbral (min sin transmitir)';
    }
  });

  openCreate(): void {
    this.draft = { ...DEFAULT_DRAFT };
    this.editingId.set(null);
    this.formError.set(null);
    this.formOpen.set(true);
  }

  openEdit(r: AlarmRule): void {
    this.draft = {
      name: r.name,
      metric: r.metric,
      op: r.op,
      threshold: r.threshold,
      targetKind: r.targetKind,
      targetValue: r.targetValue ?? '',
      sustainedMin: r.sustainedMin,
      severity: r.severity,
      notifyUi: r.notifyUi,
      recipientUserIds: [...(r.recipientUserIds || [])],
      enabled: r.enabled,
    };
    this.editingId.set(r.id);
    this.formError.set(null);
    this.formOpen.set(true);
  }

  toggleDraftUser(userId: string): void {
    const cur = new Set(this.draft.recipientUserIds);
    if (cur.has(userId)) cur.delete(userId);
    else cur.add(userId);
    this.draft.recipientUserIds = [...cur];
  }

  isDraftUser(userId: string): boolean {
    return this.draft.recipientUserIds.includes(userId);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.formError.set(null);
  }

  onMetricChange(): void {
    if (this.draft.metric === 'transmision') {
      this.draft.op = '>';
      if (this.draft.threshold < 1) this.draft.threshold = 15;
    }
  }

  onTargetKindChange(): void {
    if (this.draft.targetKind === 'all') {
      this.draft.targetValue = '';
    }
  }

  saveRule(): void {
    this.formError.set(null);
    if (!this.draft.name.trim()) {
      this.formError.set('El nombre es obligatorio.');
      return;
    }
    if (!Number.isFinite(this.draft.threshold)) {
      this.formError.set('Umbral inválido.');
      return;
    }
    if (this.draft.targetKind !== 'all' && !this.draft.targetValue.trim()) {
      this.formError.set('Selecciona un objetivo válido.');
      return;
    }
    if (this.draft.sustainedMin < 0) {
      this.formError.set('Duración sostenida debe ser ≥ 0.');
      return;
    }

    const payload: Omit<AlarmRule, 'id' | 'createdAt' | 'updatedAt'> = {
      name: this.draft.name.trim(),
      enabled: this.draft.enabled,
      metric: this.draft.metric,
      op: this.draft.op,
      threshold: this.draft.threshold,
      targetKind: this.draft.targetKind,
      targetValue:
        this.draft.targetKind === 'all' ? null : this.draft.targetValue.trim(),
      sustainedMin: this.draft.sustainedMin,
      severity: this.draft.severity,
      notifyEmail: this.draft.recipientUserIds.length > 0,
      notifyUi: this.draft.notifyUi,
      recipientUserIds: this.draft.recipientUserIds,
    };

    const editId = this.editingId();
    if (editId) {
      this.svc.update(editId, payload);
    } else {
      this.svc.add(payload);
    }
    this.closeForm();
  }

  toggle(id: string): void {
    this.svc.toggle(id);
  }

  remove(id: string): void {
    if (!confirm('¿Eliminar esta regla?')) return;
    this.svc.remove(id);
  }

  describe(r: AlarmRule): string {
    return this.svc.describeRule(r);
  }

  fmtAgo(iso: string): string {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    if (diff < 60_000) return 'recién';
    if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
    return `hace ${Math.floor(diff / 86_400_000)}d`;
  }
}
