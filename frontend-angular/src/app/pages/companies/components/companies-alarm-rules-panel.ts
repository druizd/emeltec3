import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  effect,
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
      <div class="ar-hero">
        <div class="ar-hero-icon">
          <span class="material-symbols-outlined">notifications_active</span>
        </div>
        <div class="ar-hero-text">
          <h2 class="ar-title">Configurar alarmas</h2>
          <p class="ar-sub">
            Configura avisos por temperatura, humedad o pérdida de transmisión. Notifica por email
            a usuarios seleccionados.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="ar-btn"
            (click)="sendTestEmail()"
            [disabled]="testEmailLoading()"
            title="Envía un email de prueba a tu correo para verificar el formato"
          >
            @if (testEmailLoading()) {
              <span class="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              Enviando…
            } @else {
              <span class="material-symbols-outlined text-[14px]">mail</span>
              Test email
            }
          </button>
          <button
            type="button"
            class="ar-btn ar-btn--primary ar-btn--big"
            (click)="openCreate()"
            [disabled]="formOpen()"
          >
            <span class="material-symbols-outlined text-[18px]">add_alert</span>
            Crear alarma
          </button>
        </div>
      </div>
      @if (testEmailMsg(); as msg) {
        <div class="ar-test-msg" [class.ar-test-msg--err]="testEmailError()">{{ msg }}</div>
      }

      @if (!formOpen() && rules().length === 0) {
        <div class="ar-templates">
          <div class="ar-templates-title">Plantillas</div>
          <div class="ar-templates-grid">
            <button type="button" class="ar-template-card" (click)="useTemplate('temp-alta')">
              <span class="material-symbols-outlined text-[22px] text-rose-500">thermostat</span>
              <div class="ar-template-name">Temperatura alta</div>
              <div class="ar-template-desc">Sensor supera su umbral máximo.</div>
            </button>
            <button type="button" class="ar-template-card" (click)="useTemplate('temp-baja')">
              <span class="material-symbols-outlined text-[22px] text-sky-500">ac_unit</span>
              <div class="ar-template-name">Temperatura baja</div>
              <div class="ar-template-desc">Riesgo de congelación o sobre-frío.</div>
            </button>
            <button type="button" class="ar-template-card" (click)="useTemplate('hr-alta')">
              <span class="material-symbols-outlined text-[22px] text-blue-500">water_drop</span>
              <div class="ar-template-name">Humedad alta</div>
              <div class="ar-template-desc">HR sobre el límite tolerado.</div>
            </button>
            <button type="button" class="ar-template-card" (click)="useTemplate('sin-transmitir')">
              <span class="material-symbols-outlined text-[22px] text-amber-500">signal_disconnected</span>
              <div class="ar-template-name">Sin transmitir</div>
              <div class="ar-template-desc">Sensor sin lectura por minutos.</div>
            </button>
          </div>
        </div>
      }

      @if (formOpen()) {
        <div class="ar-form-card">
          <div class="ar-form-head">
            <div class="ar-form-title">
              <span class="material-symbols-outlined text-[18px]">edit_notifications</span>
              {{ editingId() ? 'Editar alarma' : 'Nueva alarma' }}
            </div>
            <div class="ar-form-head-actions">
              <label class="ar-toggle ar-toggle--compact">
                <input type="checkbox" [(ngModel)]="draft.enabled" />
                <span class="ar-toggle-track"></span>
                <span class="ar-toggle-label">
                  {{ draft.enabled ? 'Activa' : 'Pausada' }}
                </span>
              </label>
              <button type="button" class="ar-form-close" (click)="closeForm()" title="Cerrar">
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          </div>

          <div class="ar-form-body">
            <!-- STEP 1: Nombre -->
            <section class="ar-step">
              <div class="ar-step-head">
                <span class="ar-step-num">1</span>
                <div>
                  <div class="ar-step-title">Nombre</div>
                </div>
              </div>
              <input
                type="text"
                class="ar-input-big"
                [(ngModel)]="draft.name"
                placeholder="Ej. Temperatura alta en Cámara Primaria"
              />
            </section>

            <!-- STEP 2: Qué medir -->
            <section class="ar-step">
              <div class="ar-step-head">
                <span class="ar-step-num">2</span>
                <div>
                  <div class="ar-step-title">Métrica</div>
                </div>
              </div>
              <div class="ar-choice-row">
                <button
                  type="button"
                  class="ar-choice"
                  [class.ar-choice--active]="draft.metric === 'temperatura'"
                  (click)="setMetric('temperatura')"
                >
                  <span class="material-symbols-outlined text-[20px]">thermostat</span>
                  Temperatura
                </button>
                <button
                  type="button"
                  class="ar-choice"
                  [class.ar-choice--active]="draft.metric === 'humedad'"
                  (click)="setMetric('humedad')"
                >
                  <span class="material-symbols-outlined text-[20px]">water_drop</span>
                  Humedad
                </button>
                <button
                  type="button"
                  class="ar-choice"
                  [class.ar-choice--active]="draft.metric === 'transmision'"
                  (click)="setMetric('transmision')"
                >
                  <span class="material-symbols-outlined text-[20px]">signal_disconnected</span>
                  Sin transmitir
                </button>
              </div>
            </section>

            <!-- STEP 3: Condición -->
            <section class="ar-step">
              <div class="ar-step-head">
                <span class="ar-step-num">3</span>
                <div>
                  <div class="ar-step-title">Condición</div>
                </div>
              </div>
              <div class="ar-cond-row">
                <span class="ar-cond-lbl">Si el valor es</span>
                <select class="ar-cond-select" [(ngModel)]="draft.op">
                  <option value=">">mayor que</option>
                  <option value=">=">mayor o igual a</option>
                  <option value="<">menor que</option>
                  <option value="<=">menor o igual a</option>
                </select>
                <input
                  type="number"
                  step="0.1"
                  class="ar-cond-input"
                  [(ngModel)]="draft.threshold"
                />
                <span class="ar-cond-unit">{{ thresholdUnit() }}</span>
              </div>
              <div class="ar-sustained">
                <label class="ar-check">
                  <input
                    type="checkbox"
                    [checked]="draft.sustainedMin > 0"
                    (change)="toggleSustained()"
                  />
                  Solo si se mantiene por
                </label>
                @if (draft.sustainedMin > 0) {
                  <input
                    type="number"
                    min="1"
                    class="ar-cond-input ar-cond-input--small"
                    [(ngModel)]="draft.sustainedMin"
                  />
                  <span class="ar-cond-unit">minutos</span>
                }
                @if (draft.sustainedMin === 0) {
                  <span class="ar-sustained-hint">dispara apenas se detecta</span>
                }
              </div>
            </section>

            <!-- STEP 4: Dónde -->
            <section class="ar-step">
              <div class="ar-step-head">
                <span class="ar-step-num">4</span>
                <div>
                  <div class="ar-step-title">Alcance</div>
                </div>
              </div>
              <div class="ar-choice-row">
                <button
                  type="button"
                  class="ar-choice"
                  [class.ar-choice--active]="draft.targetKind === 'all'"
                  (click)="setTargetKind('all')"
                >
                  <span class="material-symbols-outlined text-[18px]">select_all</span>
                  Todos los sensores
                </button>
                <button
                  type="button"
                  class="ar-choice"
                  [class.ar-choice--active]="draft.targetKind === 'sala'"
                  (click)="setTargetKind('sala')"
                >
                  <span class="material-symbols-outlined text-[18px]">meeting_room</span>
                  Una sala
                </button>
                <button
                  type="button"
                  class="ar-choice"
                  [class.ar-choice--active]="draft.targetKind === 'sensor'"
                  (click)="setTargetKind('sensor')"
                >
                  <span class="material-symbols-outlined text-[18px]">sensors</span>
                  Un sensor
                </button>
              </div>
              @if (draft.targetKind === 'sala') {
                <select class="ar-input-big" [(ngModel)]="draft.targetValue">
                  <option value="">Selecciona una sala</option>
                  @for (s of availableSalas(); track s.slug) {
                    <option [value]="s.slug">{{ s.area }} ({{ s.sensorCount }} sensores)</option>
                  }
                </select>
              }
              @if (draft.targetKind === 'sensor') {
                <select class="ar-input-big" [(ngModel)]="draft.targetValue">
                  <option value="">Selecciona un sensor</option>
                  @for (s of availableSensors(); track s.id) {
                    <option [value]="s.id">{{ s.id }} · {{ s.area }} · {{ s.tap }}</option>
                  }
                </select>
              }
            </section>

            <!-- STEP 5: Prioridad -->
            <section class="ar-step">
              <div class="ar-step-head">
                <span class="ar-step-num">5</span>
                <div>
                  <div class="ar-step-title">Severidad</div>
                </div>
              </div>
              <div class="ar-choice-row">
                <button
                  type="button"
                  class="ar-choice ar-choice--info"
                  [class.ar-choice--active]="draft.severity === 'info'"
                  (click)="setSeverity('info')"
                >
                  <span class="material-symbols-outlined text-[18px]">info</span>
                  Info
                </button>
                <button
                  type="button"
                  class="ar-choice ar-choice--warn"
                  [class.ar-choice--active]="draft.severity === 'warn'"
                  (click)="setSeverity('warn')"
                >
                  <span class="material-symbols-outlined text-[18px]">warning</span>
                  Advertencia
                </button>
                <button
                  type="button"
                  class="ar-choice ar-choice--crit"
                  [class.ar-choice--active]="draft.severity === 'crit'"
                  (click)="setSeverity('crit')"
                >
                  <span class="material-symbols-outlined text-[18px]">error</span>
                  Crítica
                </button>
              </div>
            </section>

            <!-- STEP 6: A quién -->
            <section class="ar-step">
              <div class="ar-step-head">
                <span class="ar-step-num">6</span>
                <div>
                  <div class="ar-step-title">Destinatarios</div>
                  <div class="ar-step-hint">Sin destinatarios, la alarma solo aparece en la UI.</div>
                </div>
              </div>
              @if (!usersLoaded()) {
                <div class="ar-recipient-picker">
                  @for (i of [1, 2, 3]; track i) {
                    <div class="ar-user-card ar-user-card--skel">
                      <div class="ar-skel ar-skel--avatar"></div>
                      <div class="ar-user-info">
                        <div class="ar-skel ar-skel--line" style="width: 70%; height: 12px"></div>
                        <div class="ar-skel ar-skel--line" style="width: 90%; height: 9px; margin-top: 4px"></div>
                        <div class="ar-skel ar-skel--line" style="width: 40%; height: 9px; margin-top: 4px"></div>
                      </div>
                    </div>
                  }
                </div>
              } @else if (eligibleUsers().length === 0) {
                <div class="ar-empty-inline">
                  No hay usuarios disponibles. Agrega usuarios en
                  <strong>Gestión Usuarios</strong> primero.
                </div>
              } @else {
                <div class="ar-recipient-picker">
                  @for (u of eligibleUsers(); track u.id) {
                    <label
                      class="ar-user-card"
                      [class.ar-user-card--active]="isDraftUser(u.id)"
                      (click)="toggleDraftUser(u.id)"
                    >
                      @if (isDraftUser(u.id)) {
                        <span class="ar-user-check-overlay">
                          <span class="material-symbols-outlined text-[16px]">check</span>
                        </span>
                      }
                      <span class="ar-user-avatar" [style.background]="avatarColor(u.id)">
                        {{ userInitials(u) }}
                      </span>
                      <span class="ar-user-info">
                        <span class="ar-user-name">{{ userLabel(u) }}</span>
                        <span class="ar-user-email">{{ u.email }}</span>
                        <span class="ar-user-tags">
                          @if (u.tipo && u.tipo !== 'Cliente') {
                            <span class="ar-user-tag ar-user-tag--{{ u.tipo.toLowerCase() }}">
                              {{ u.tipo }}
                            </span>
                          }
                          @if (u.cargo) {
                            <span class="ar-user-tag">{{ u.cargo }}</span>
                          }
                        </span>
                      </span>
                    </label>
                  }
                </div>
              }
            </section>

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
              <span class="material-symbols-outlined text-[14px]">check</span>
              {{ editingId() ? 'Guardar cambios' : 'Crear alarma' }}
            </button>
          </div>
        </div>
      }

      <div class="ar-list">
        @if (!rulesLoaded()) {
          @for (i of [1, 2, 3]; track i) {
            <article class="ar-card ar-card--skel">
              <div class="ar-card-head">
                <div class="ar-skel ar-skel--icon"></div>
                <div class="ar-card-body">
                  <div class="ar-skel ar-skel--line" style="width: 50%; height: 14px"></div>
                  <div class="ar-skel ar-skel--line" style="width: 80%; height: 10px; margin-top: 6px"></div>
                  <div class="ar-skel ar-skel--line" style="width: 40%; height: 10px; margin-top: 6px"></div>
                </div>
                <div class="ar-card-actions">
                  <div class="ar-skel ar-skel--btn"></div>
                  <div class="ar-skel ar-skel--btn"></div>
                  <div class="ar-skel ar-skel--btn"></div>
                </div>
              </div>
            </article>
          }
        } @else if (rules().length === 0) {
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
      .ar-hero {
        display: flex;
        align-items: center;
        gap: 20px;
        padding: 24px 28px;
        background: var(--color-surface);
        border: 1px solid var(--color-outline-variant);
        border-radius: 12px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
        margin-bottom: 20px;
      }
      .ar-hero-icon {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: var(--color-primary-tint-10);
        color: var(--color-primary);
      }
      .ar-hero-icon .material-symbols-outlined {
        font-size: 24px;
      }
      .ar-hero-text {
        flex: 1;
        min-width: 0;
      }
      .ar-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 20px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .ar-sub {
        margin-top: 4px;
        font-family: var(--font-dm);
        font-size: 12.5px;
        color: #64748b;
        max-width: 720px;
        line-height: 1.45;
      }

      .ar-test-msg {
        margin-bottom: 12px;
        padding: 8px 12px;
        background: var(--color-primary-tint-10);
        color: var(--color-primary-container);
        border: 1px solid var(--color-primary-tint-30);
        border-radius: 8px;
        font-family: var(--font-body);
        font-size: 12px;
      }
      .ar-test-msg--err {
        background: rgba(239, 68, 68, 0.10);
        color: #b91c1c;
        border-color: rgba(239, 68, 68, 0.25);
      }
      .ar-templates {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
      }
      .ar-templates-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 10px;
        color: #94a3b8;
        margin-bottom: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .ar-templates-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 8px;
      }
      .ar-template-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        padding: 12px 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        text-align: left;
        transition: border-color 0.15s, background 0.15s;
      }
      .ar-template-card:hover {
        border-color: var(--color-primary-tint-40);
        background: var(--color-primary-tint-04);
      }
      .ar-template-name {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
      }
      .ar-template-desc {
        font-family: var(--font-dm);
        font-size: 11px;
        color: #64748b;
        line-height: 1.3;
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
        background: var(--color-primary);
        color: #ffffff;
        border-color: var(--color-primary);
      }
      .ar-btn--primary:hover:not(:disabled) {
        background: var(--color-primary-container);
      }
      .ar-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--color-primary-tint-25);
      }

      @media (prefers-reduced-motion: reduce) {
        .ar-choice,
        .ar-template-card,
        .ar-user-card,
        .ar-toggle-track,
        .ar-toggle-track::after {
          transition: none;
        }
      }
      .ar-btn--big {
        padding: 10px 18px;
        font-size: 13px;
        font-weight: 600;
      }

      /* Steps */
      .ar-step {
        padding: 16px;
        border-bottom: 1px solid #f1f5f9;
      }
      .ar-step:last-child {
        border-bottom: none;
      }
      .ar-step--final {
        background: #f8fafc;
        border-radius: 0 0 12px 12px;
      }
      .ar-step-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      .ar-step-num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        background: transparent;
        color: var(--color-on-surface-muted);
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        flex-shrink: 0;
        border: 1px solid var(--color-outline-variant);
      }
      .ar-step-title {
        font-family: var(--font-josefin);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-on-surface);
        letter-spacing: 0.01em;
      }
      .ar-step-hint {
        font-family: var(--font-body);
        font-size: 12px;
        color: var(--color-on-surface-variant);
        margin-top: 2px;
      }

      .ar-input-big {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-family: var(--font-dm);
        font-size: 13px;
        color: #1e293b;
        background: #ffffff;
        outline: none;
      }
      .ar-step .ar-input-big + .ar-input-big,
      .ar-choice-row + .ar-input-big {
        margin-top: 8px;
      }
      .ar-input-big:focus-visible {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-tint-25);
      }

      .ar-choice-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .ar-choice {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 16px;
        background: var(--color-surface);
        border: 1px solid var(--color-outline-variant);
        border-radius: 9px;
        color: var(--color-on-surface-variant);
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition:
          color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
          border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
          background 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .ar-choice:hover {
        border-color: var(--color-primary-tint-30);
        color: var(--color-primary);
      }
      .ar-choice:focus-visible {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-tint-25);
      }
      .ar-choice--active {
        background: var(--color-primary-tint-10);
        border-color: var(--color-primary);
        color: var(--color-primary);
        font-weight: 600;
      }
      .ar-choice--warn.ar-choice--active {
        background: rgba(245, 158, 11, 0.10);
        border-color: #d97706;
        color: #d97706;
      }
      .ar-choice--crit.ar-choice--active {
        background: rgba(239, 68, 68, 0.10);
        border-color: #dc2626;
        color: #dc2626;
      }
      .ar-choice--info.ar-choice--active {
        background: var(--color-primary-tint-10);
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .ar-cond-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .ar-cond-lbl {
        font-family: var(--font-dm);
        font-size: 12.5px;
        color: #475569;
      }
      .ar-cond-select {
        padding: 7px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 12.5px;
        color: #1e293b;
        background: #ffffff;
        outline: none;
      }
      .ar-cond-input {
        width: 90px;
        padding: 7px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
        background: #ffffff;
        outline: none;
        text-align: right;
      }
      .ar-cond-input--small {
        width: 70px;
      }
      .ar-cond-input:focus-visible,
      .ar-cond-select:focus-visible {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-tint-25);
      }
      .ar-cond-unit {
        font-family: var(--font-mono);
        font-size: 12.5px;
        color: #64748b;
        font-weight: 600;
      }
      .ar-sustained {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }
      .ar-sustained-hint {
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #94a3b8;
        font-style: italic;
      }

      /* User cards (recipients) — horizontal scrollable list */
      .ar-recipient-picker {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        overflow-y: visible;
        padding: 8px 16px 12px 4px;
        margin-right: -16px;
        scroll-snap-type: x mandatory;
        scrollbar-width: thin;
        scrollbar-color: #cbd5e1 transparent;
      }
      .ar-recipient-picker::-webkit-scrollbar {
        height: 8px;
      }
      .ar-recipient-picker::-webkit-scrollbar-track {
        background: transparent;
      }
      .ar-recipient-picker::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 999px;
      }
      .ar-recipient-picker::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }
      .ar-user-card {
        position: relative;
        flex: 0 0 280px;
        min-width: 280px;
        max-width: 280px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.15s;
        scroll-snap-align: start;
      }
      .ar-user-check-overlay {
        position: absolute;
        top: -8px;
        right: -8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--color-success);
        color: var(--color-surface);
        box-shadow: 0 1px 4px rgba(34, 197, 94, 0.40);
      }
      .ar-user-card:hover {
        border-color: var(--color-primary-tint-40);
        background: var(--color-primary-tint-04);
      }
      .ar-user-card--active {
        border-color: var(--color-primary);
        background: var(--color-primary-tint-08);
        box-shadow: 0 0 0 2px var(--color-primary-tint-15);
      }
      .ar-user-avatar {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: #ffffff;
        font-family: 'Josefin Sans', sans-serif;
        font-size: 13px;
        font-weight: 700;
      }
      .ar-user-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ar-user-name {
        font-family: var(--font-dm);
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
      }
      .ar-user-email {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #64748b;
      }
      .ar-user-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 3px;
      }
      .ar-user-tag {
        padding: 1px 7px;
        border-radius: 999px;
        background: #f1f5f9;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .ar-user-tag--superadmin {
        background: rgba(124, 58, 237, 0.12);
        color: var(--color-accent-container);
      }
      .ar-user-tag--admin {
        background: var(--color-primary-tint-15);
        color: var(--color-primary);
      }
      .ar-user-tag--gerente {
        background: rgba(245, 158, 11, 0.12);
        color: #b45309;
      }
      /* Toggle (enabled switch) */
      .ar-toggle {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
      }
      .ar-toggle--compact .ar-toggle-track {
        width: 32px;
        height: 18px;
      }
      .ar-toggle--compact .ar-toggle-track::after {
        width: 14px;
        height: 14px;
      }
      .ar-toggle--compact input:checked + .ar-toggle-track::after {
        transform: translateX(14px);
      }
      .ar-toggle--compact .ar-toggle-label {
        font-size: 11.5px;
        color: #475569;
      }
      .ar-toggle input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .ar-toggle-track {
        position: relative;
        display: inline-block;
        width: 38px;
        height: 22px;
        background: #cbd5e1;
        border-radius: 999px;
        transition: background 0.18s;
      }
      .ar-toggle-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        background: #ffffff;
        border-radius: 50%;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.20);
        transition: transform 0.18s;
      }
      .ar-toggle input:checked + .ar-toggle-track {
        background: var(--color-primary);
      }
      .ar-toggle input:checked + .ar-toggle-track::after {
        transform: translateX(16px);
      }
      .ar-toggle-label {
        font-family: var(--font-dm);
        font-size: 12.5px;
        font-weight: 500;
        color: #1e293b;
      }

      .ar-form-card {
        background: var(--color-surface);
        border: 1px solid var(--color-outline-variant);
        border-radius: 12px;
        margin-bottom: 16px;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 160px);
      }
      .ar-form-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .ar-form-head-actions {
        display: flex;
        align-items: center;
        gap: 12px;
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
        overflow-y: auto;
        flex: 1 1 auto;
        min-height: 0;
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
        border-color: var(--color-primary);
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
        padding: 16px;
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
        border-color: var(--color-primary-tint-30);
        background: var(--color-primary-tint-04);
      }
      .ar-recipient-check--off {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .ar-recipient-check input {
        accent-color: var(--color-primary);
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
        color: var(--color-primary);
      }

      .ar-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Skeleton */
      @keyframes arSkelShimmer {
        0% { background-position: -200px 0; }
        100% { background-position: calc(200px + 100%) 0; }
      }
      .ar-skel {
        background: linear-gradient(
          90deg,
          #f1f5f9 0px,
          #e2e8f0 80px,
          #f1f5f9 160px
        );
        background-size: 200px 100%;
        background-repeat: no-repeat;
        animation: arSkelShimmer 1.4s linear infinite;
        border-radius: 4px;
      }
      .ar-skel--line {
        width: 100%;
        height: 12px;
      }
      .ar-skel--icon {
        width: 36px;
        height: 36px;
        border-radius: 9px;
        flex-shrink: 0;
      }
      .ar-skel--avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .ar-skel--btn {
        width: 30px;
        height: 30px;
        border-radius: 7px;
      }
      .ar-card--skel,
      .ar-user-card--skel {
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .ar-skel {
          animation: none;
        }
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
        background: var(--color-primary-tint-10);
        color: var(--color-primary);
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
        background: var(--color-primary-tint-15);
        color: var(--color-primary);
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
        color: var(--color-primary);
        border-color: var(--color-primary-tint-30);
        background: var(--color-primary-tint-04);
      }
      .ar-icon-btn--danger:hover {
        color: #dc2626;
        border-color: rgba(239, 68, 68, 0.30);
        background: rgba(239, 68, 68, 0.05);
      }
    `,
  ],
})
export class CompaniesAlarmRulesPanelComponent {
  private readonly svc = inject(ColdRoomAlarmRulesService);
  private readonly coldRoom = inject(ColdRoomService);
  private readonly http = inject(HttpClient);

  readonly testEmailLoading = signal<boolean>(false);
  readonly testEmailMsg = signal<string | null>(null);
  readonly testEmailError = signal<boolean>(false);

  sendTestEmail(): void {
    const sid = this._siteId();
    if (!sid) {
      this.testEmailMsg.set('Sin sitio seleccionado.');
      this.testEmailError.set(true);
      return;
    }
    this.testEmailLoading.set(true);
    this.testEmailMsg.set(null);
    this.testEmailError.set(false);
    this.http
      .post<{ ok: boolean; sentTo?: string; error?: string }>(
        `/api/cold-room/${encodeURIComponent(sid)}/alarm-test-email`,
        {},
      )
      .subscribe({
        next: (res) => {
          this.testEmailLoading.set(false);
          if (res.ok) {
            this.testEmailMsg.set(`Email de prueba enviado a ${res.sentTo}`);
            this.testEmailError.set(false);
            setTimeout(() => this.testEmailMsg.set(null), 6000);
          } else {
            this.testEmailMsg.set(res.error || 'Error al enviar.');
            this.testEmailError.set(true);
          }
        },
        error: (err) => {
          this.testEmailLoading.set(false);
          this.testEmailMsg.set('Error: ' + (err?.error?.error || err?.message || 'desconocido'));
          this.testEmailError.set(true);
        },
      });
  }

  private readonly _coldRoomSiteIds = signal<string[]>([]);
  private readonly _siteId = signal<string>('');

  @Input() set coldRoomSiteIds(v: string[]) {
    this._coldRoomSiteIds.set(v || []);
  }
  get coldRoomSiteIds(): string[] {
    return this._coldRoomSiteIds();
  }
  @Input() set siteId(v: string) {
    this._siteId.set(v || '');
  }
  get siteId(): string {
    return this._siteId();
  }

  constructor() {
    effect(() => {
      const sid = this._siteId();
      if (sid) this.svc.setSiteId(sid);
    });
    effect(() => {
      const ids = this._coldRoomSiteIds();
      if (ids.length > 0) this.fetchSensorsFromIds(ids);
    });
  }

  readonly rules = this.svc.rules;
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly availableSalas = signal<{ slug: string; area: string; sensorCount: number }[]>([]);
  readonly availableSensors = signal<{ id: string; area: string; tap: string }[]>([]);
  draft: DraftRule = { ...DEFAULT_DRAFT };

  readonly eligibleUsers = this.svc.eligibleUsers;
  readonly rulesLoaded = this.svc.rulesLoaded;
  readonly usersLoaded = this.svc.usersLoaded;

  userLabel(u: { nombre: string; apellido: string; email: string }): string {
    const name = `${u.nombre} ${u.apellido}`.trim();
    return name || u.email;
  }

  userInitials(u: { nombre: string; apellido: string; email: string }): string {
    const n = (u.nombre || '').trim();
    const a = (u.apellido || '').trim();
    if (n && a) return (n[0] + a[0]).toUpperCase();
    if (n) return n.slice(0, 2).toUpperCase();
    if (u.email) return u.email.slice(0, 2).toUpperCase();
    return '??';
  }

  avatarColor(id: string): string {
    // Genera color HSL determinista desde el id para consistencia.
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 55%)`;
  }

  userById(id: string) {
    return this.eligibleUsers().find((u) => u.id === id);
  }

  setMetric(m: AlarmMetric): void {
    this.draft.metric = m;
    this.onMetricChange();
  }

  setTargetKind(k: AlarmTargetKind): void {
    this.draft.targetKind = k;
    this.onTargetKindChange();
  }

  setSeverity(s: AlarmSeverity): void {
    this.draft.severity = s;
  }

  toggleSustained(): void {
    this.draft.sustainedMin = this.draft.sustainedMin > 0 ? 0 : 5;
  }

  thresholdUnit(): string {
    if (this.draft.metric === 'temperatura') return '°C';
    if (this.draft.metric === 'humedad') return '%';
    return 'min';
  }

  useTemplate(key: 'temp-alta' | 'temp-baja' | 'hr-alta' | 'sin-transmitir'): void {
    this.openCreate();
    switch (key) {
      case 'temp-alta':
        this.draft.name = 'Temperatura alta';
        this.draft.metric = 'temperatura';
        this.draft.op = '>';
        this.draft.threshold = 10;
        this.draft.severity = 'warn';
        this.draft.sustainedMin = 5;
        break;
      case 'temp-baja':
        this.draft.name = 'Temperatura baja';
        this.draft.metric = 'temperatura';
        this.draft.op = '<';
        this.draft.threshold = -25;
        this.draft.severity = 'warn';
        this.draft.sustainedMin = 5;
        break;
      case 'hr-alta':
        this.draft.name = 'Humedad alta';
        this.draft.metric = 'humedad';
        this.draft.op = '>';
        this.draft.threshold = 85;
        this.draft.severity = 'info';
        this.draft.sustainedMin = 0;
        break;
      case 'sin-transmitir':
        this.draft.name = 'Sensor sin transmitir';
        this.draft.metric = 'transmision';
        this.draft.op = '>';
        this.draft.threshold = 15;
        this.draft.severity = 'crit';
        this.draft.sustainedMin = 0;
        break;
    }
  }

  private fetchSensorsFromIds(ids: string[]): void {
    if (ids.length === 0) return;
    const primary = ids[0];
    this.coldRoom.getSensors(primary, null, '24h', ids).subscribe({
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
