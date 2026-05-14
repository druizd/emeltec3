import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  ViewChild,
  computed,
  input,
  signal,
} from '@angular/core';
import { MetricKey, PLANO_H, PLANO_W, Sensor, humColor, tempColor } from './ventisqueros-data';

interface LegendStop {
  color: string;
  label: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.25;

@Component({
  selector: 'app-ventisqueros-floor-map',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #wrap
      class="relative h-full w-full select-none overflow-hidden"
      [class.vs-alert-frame]="hasAlerts()"
      style="
        border-radius: 14px;
        background: radial-gradient(120% 80% at 50% 0%, rgba(13,175,189,0.04), transparent 60%), #FBFCFD;
        border: 1px solid #E2E8F0;
        box-shadow: 0 1px 4px rgba(0,0,0,0.04), inset 0 0 0 1px rgba(255,255,255,0.6);
        touch-action: none;
      "
      (wheel)="onWheel($event)"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (pointerleave)="onPointerUp($event)"
      [style.cursor]="dragging() ? 'grabbing' : 'grab'"
    >
      <svg
        [attr.viewBox]="viewBoxStr()"
        preserveAspectRatio="xMidYMid meet"
        style="position: absolute; inset: 0; width: 100%; height: 100%; display: block;"
      >
        <defs>
          @for (s of visibleSensors(); track s.id) {
            <radialGradient [attr.id]="'halo-' + s.id" cx="50%" cy="50%" r="50%">
              <stop
                offset="0%"
                [attr.stop-color]="colorFor(s)"
                [attr.stop-opacity]="s.alerted ? 0.55 : 0.4"
              />
              <stop
                offset="55%"
                [attr.stop-color]="colorFor(s)"
                [attr.stop-opacity]="s.alerted ? 0.22 : 0.12"
              />
              <stop offset="100%" [attr.stop-color]="colorFor(s)" stop-opacity="0" />
            </radialGradient>
          }
        </defs>

        <image
          href="/images/plano_ventisqueros.svg"
          x="0"
          y="0"
          [attr.width]="PLANO_W"
          [attr.height]="PLANO_H"
          style="filter: grayscale(35%) brightness(1.08) contrast(0.95) opacity(0.85); mix-blend-mode: multiply;"
        />

        <g style="mix-blend-mode: multiply;">
          @for (s of visibleSensors(); track s.id) {
            <circle
              [attr.cx]="s.cx"
              [attr.cy]="s.cy"
              [attr.r]="s.r"
              [attr.fill]="'url(#halo-' + s.id + ')'"
            />
          }
        </g>

        @for (s of visibleAlertedSensors(); track s.id) {
          <g>
            <circle
              [attr.cx]="s.cx"
              [attr.cy]="s.cy"
              r="14"
              fill="none"
              stroke="#EF4444"
              stroke-width="0.8"
              opacity="0.9"
            >
              <animate attributeName="r" from="10" to="42" dur="1.8s" repeatCount="indefinite" />
              <animate
                attributeName="opacity"
                from="0.85"
                to="0"
                dur="1.8s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              [attr.cx]="s.cx"
              [attr.cy]="s.cy"
              r="20"
              fill="none"
              stroke="#EF4444"
              stroke-width="0.6"
              opacity="0.6"
            >
              <animate
                attributeName="r"
                from="14"
                to="55"
                dur="1.8s"
                begin="0.6s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.65"
                to="0"
                dur="1.8s"
                begin="0.6s"
                repeatCount="indefinite"
              />
            </circle>
          </g>
        }

        @for (s of visibleSensors(); track s.id) {
          <g
            style="cursor: pointer;"
            (mouseenter)="hoverId.set(s.id)"
            (mouseleave)="hoverId.set(null)"
            (click)="selectSensor.emit(s.id); $event.stopPropagation()"
          >
            <circle
              [attr.cx]="s.cx"
              [attr.cy]="s.cy"
              [attr.r]="hoverId() === s.id || selectedId() === s.id ? 7.5 : 6"
              fill="#FFFFFF"
              [attr.stroke]="strokeFor(s)"
              stroke-width="1.4"
              style="transition: r 0.15s;"
            />
            <circle [attr.cx]="s.cx" [attr.cy]="s.cy" r="3.4" [attr.fill]="colorFor(s)" />
          </g>
        }
      </svg>

      @for (s of visibleSensors(); track s.id) {
        <div
          (click)="selectSensor.emit(s.id); $event.stopPropagation()"
          (mouseenter)="hoverId.set(s.id)"
          (mouseleave)="hoverId.set(null)"
          (pointerdown)="$event.stopPropagation()"
          [style.left]="chipLeftPct(s) + '%'"
          [style.top]="chipTopPct(s) + '%'"
          [style.transform]="isTop(s) ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'"
          [style.display]="chipVisible(s) ? 'block' : 'none'"
          [style.background-image]="chipBg(s)"
          [style.border]="
            '1px solid ' +
            (s.alerted
              ? 'rgba(239,68,68,0.55)'
              : isHighlighted(s)
                ? 'rgba(13,175,189,0.5)'
                : '#E2E8F0')
          "
          [style.box-shadow]="
            isHighlighted(s)
              ? '0 6px 18px rgba(15,23,42,0.18), 0 0 0 1px rgba(13,175,189,0.25)'
              : '0 1px 3px rgba(15,23,42,0.10)'
          "
          [style.z-index]="isHighlighted(s) ? 20 : s.alerted ? 15 : 10"
          style="
            position: absolute;
            background: #FFFFFF;
            border-radius: 8px;
            padding: 4px 8px 5px;
            cursor: pointer;
            user-select: none;
            transition: box-shadow 0.12s ease, border-color 0.12s;
            min-width: 64px;
            text-align: center;
            font-family: 'DM Sans', sans-serif;
            line-height: 1.05;
          "
        >
          <div
            class="flex items-center justify-center gap-1"
            style="font-size: 9px; font-weight: 700; color: #64748B; letter-spacing: 0.08em; text-transform: uppercase;"
          >
            @if (s.alerted) {
              <span
                style="width: 6px; height: 6px; border-radius: 50%; background: #EF4444; box-shadow: 0 0 0 2px rgba(239,68,68,0.25);"
              ></span>
            }
            {{ s.id }}
          </div>
          <div
            style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; margin-top: 1px;"
            [style.color]="s.alerted ? '#B91C1C' : '#1E293B'"
          >
            {{ chipPrimary(s) }}
          </div>
          <div
            style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #94A3B8; margin-top: 1px;"
          >
            {{ chipSecondary(s) }}
          </div>
        </div>
      }

      <!-- Zoom controls -->
      <div
        class="absolute flex flex-col gap-1"
        style="top: 14px; right: 14px; background: rgba(255,255,255,0.92); backdrop-filter: blur(6px); border: 1px solid #E2E8F0; border-radius: 10px; padding: 4px; box-shadow: 0 4px 14px rgba(15,23,42,0.08);"
        (pointerdown)="$event.stopPropagation()"
        (wheel)="$event.stopPropagation()"
      >
        <button
          (click)="zoomIn()"
          [disabled]="zoom() >= ZOOM_MAX"
          class="flex h-7 w-7 items-center justify-center rounded-md"
          style="background: #FFFFFF; border: 1px solid #E2E8F0; color: #475569; cursor: pointer;"
          [style.opacity]="zoom() >= ZOOM_MAX ? 0.4 : 1"
          title="Zoom in"
        >
          <span class="material-symbols-outlined text-[15px]">add</span>
        </button>
        <button
          (click)="zoomOut()"
          [disabled]="zoom() <= ZOOM_MIN"
          class="flex h-7 w-7 items-center justify-center rounded-md"
          style="background: #FFFFFF; border: 1px solid #E2E8F0; color: #475569; cursor: pointer;"
          [style.opacity]="zoom() <= ZOOM_MIN ? 0.4 : 1"
          title="Zoom out"
        >
          <span class="material-symbols-outlined text-[15px]">remove</span>
        </button>
        <button
          (click)="resetZoom()"
          class="flex h-7 w-7 items-center justify-center rounded-md"
          style="background: #FFFFFF; border: 1px solid #E2E8F0; color: #475569; cursor: pointer;"
          title="Restablecer zoom (0)"
        >
          <span class="material-symbols-outlined text-[15px]">center_focus_strong</span>
        </button>
        <button
          (click)="toggleFullscreen()"
          class="flex h-7 w-7 items-center justify-center rounded-md"
          [style.background]="fullscreen() ? '#0DAFBD' : '#FFFFFF'"
          [style.color]="fullscreen() ? '#FFFFFF' : '#475569'"
          style="border: 1px solid #E2E8F0; cursor: pointer;"
          [title]="fullscreen() ? 'Salir pantalla completa (Esc)' : 'Pantalla completa (F)'"
        >
          <span class="material-symbols-outlined text-[15px]">{{
            fullscreen() ? 'fullscreen_exit' : 'fullscreen'
          }}</span>
        </button>
        <div
          style="font-family: 'JetBrains Mono'; font-size: 9px; color: #94A3B8; text-align: center; padding-top: 2px;"
        >
          {{ zoomPercent() }}%
        </div>
      </div>

      <!-- Legend -->
      <div
        style="
          position: absolute; right: 14px; bottom: 14px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(6px);
          border: 1px solid #E2E8F0;
          border-radius: 10px;
          padding: 8px 12px;
          font-family: 'DM Sans';
          box-shadow: 0 4px 14px rgba(15,23,42,0.08);
        "
      >
        <div
          style="font-size: 9px; font-weight: 700; color: #94A3B8; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px;"
        >
          {{ legendTitle() }}
        </div>
        @if (metric() === 'A') {
          <div class="flex items-center">
            @for (s of legendStops(); track $index) {
              <div class="mr-3 flex items-center gap-[5px]">
                <span
                  style="width: 9px; height: 9px; border-radius: 50%;"
                  [style.background]="s.color"
                  [style.box-shadow]="$index === 1 ? '0 0 0 3px rgba(239,68,68,0.2)' : 'none'"
                ></span>
                <span style="font-size: 11px; color: #475569;">{{ s.label }}</span>
              </div>
            }
          </div>
        } @else {
          <div class="flex items-center">
            <div
              style="height: 8px; width: 200px; border-radius: 999px;"
              [style.background]="legendGradient()"
            ></div>
            <div
              style="display: flex; justify-content: space-between; width: 200px; margin-left: -200px; position: relative; top: 12px;"
            >
              @for (s of legendStops(); track $index) {
                <span style="font-family: 'JetBrains Mono'; font-size: 10px; color: #64748B;">{{
                  s.label
                }}</span>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      @keyframes vsAlertFrame {
        0%,
        100% {
          border-color: rgba(239, 68, 68, 0.95);
          box-shadow:
            0 0 0 2px rgba(239, 68, 68, 0.45),
            0 0 32px rgba(239, 68, 68, 0.55),
            inset 0 0 24px rgba(239, 68, 68, 0.18);
        }
        50% {
          border-color: rgba(239, 68, 68, 0.35);
          box-shadow:
            0 0 0 1px rgba(239, 68, 68, 0.15),
            0 0 8px rgba(239, 68, 68, 0.15),
            inset 0 0 4px rgba(239, 68, 68, 0.05);
        }
      }
      .vs-alert-frame {
        border-width: 2px !important;
        animation: vsAlertFrame 1.2s ease-in-out infinite;
      }
    `,
  ],
})
export class VentisquerosFloorMapComponent {
  readonly PLANO_W = PLANO_W;
  readonly PLANO_H = PLANO_H;
  readonly ZOOM_MIN = ZOOM_MIN;
  readonly ZOOM_MAX = ZOOM_MAX;

  readonly sensors = input.required<Sensor[]>();
  readonly metric = input<MetricKey>('T');
  readonly selectedId = input<string | null>(null);
  readonly hiddenSensors = input<Set<string>>(new Set());
  readonly hasAlerts = input<boolean>(false);

  @Output() selectSensor = new EventEmitter<string>();

  @ViewChild('wrap') wrap?: ElementRef<HTMLElement>;

  readonly hoverId = signal<string | null>(null);
  readonly zoom = signal(1);
  // Pan offset in svg-units (top-left of the visible viewBox)
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly dragging = signal(false);
  readonly fullscreen = signal(false);
  private dragStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private pointerId: number | null = null;

  readonly visibleSensors = computed(() =>
    this.sensors().filter((s) => !this.hiddenSensors().has(s.id)),
  );

  readonly visibleAlertedSensors = computed(() => this.visibleSensors().filter((s) => s.alerted));

  readonly viewBoxStr = computed(
    () => `${this.panX()} ${this.panY()} ${PLANO_W / this.zoom()} ${PLANO_H / this.zoom()}`,
  );

  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  readonly legendTitle = computed(() =>
    this.metric() === 'A' ? 'Estado' : this.metric() === 'H' ? 'Humedad relativa' : 'Temperatura',
  );

  readonly legendStops = computed<LegendStop[]>(() => {
    if (this.metric() === 'A') {
      return [
        { color: '#94A3B8', label: 'Normal' },
        { color: '#EF4444', label: 'En alerta' },
      ];
    }
    if (this.metric() === 'H') {
      return [40, 60, 75, 88, 100].map((h) => ({ color: humColor(h), label: `${h}%` }));
    }
    return [-40, -30, -20, -10, 0, 10, 20, 28].map((t) => ({
      color: tempColor(t),
      label: `${t}°`,
    }));
  });

  readonly legendGradient = computed(
    () =>
      `linear-gradient(90deg, ${this.legendStops()
        .map((s) => s.color)
        .join(', ')})`,
  );

  colorFor(s: Sensor): string {
    if (this.metric() === 'H') return humColor(s.h);
    if (this.metric() === 'A') return s.alerted ? '#EF4444' : 'rgb(148,163,184)';
    return tempColor(s.t);
  }

  strokeFor(s: Sensor): string {
    if (s.alerted) return '#EF4444';
    if (this.selectedId() === s.id) return '#0DAFBD';
    return '#FFFFFF';
  }

  chipLeftPct(s: Sensor): number {
    return this.screenXPct(s.cx);
  }

  chipTopPct(s: Sensor): number {
    return this.screenYPct(s.cy);
  }

  screenXPct(svgX: number): number {
    const visibleW = PLANO_W / this.zoom();
    return ((svgX - this.panX()) / visibleW) * 100;
  }

  screenYPct(svgY: number): number {
    const visibleH = PLANO_H / this.zoom();
    return ((svgY - this.panY()) / visibleH) * 100;
  }

  isTop(s: Sensor): boolean {
    return this.screenYPct(s.cy) < 30;
  }

  isHighlighted(s: Sensor): boolean {
    return this.hoverId() === s.id || this.selectedId() === s.id;
  }

  chipVisible(s: Sensor): boolean {
    const x = this.screenXPct(s.cx);
    const y = this.screenYPct(s.cy);
    return x >= -10 && x <= 110 && y >= -10 && y <= 110;
  }

  chipBg(s: Sensor): string {
    const color =
      this.metric() === 'H'
        ? humColor(s.h)
        : this.metric() === 'A'
          ? s.alerted
            ? '#EF4444'
            : '#94A3B8'
          : tempColor(s.t);
    return `linear-gradient(135deg, ${color}1A 0%, rgba(255,255,255,0.92) 70%)`;
  }

  chipPrimary(s: Sensor): string {
    return this.metric() === 'H' ? `${s.h}%` : `${s.t.toFixed(1)}°C`;
  }

  chipSecondary(s: Sensor): string {
    return this.metric() === 'H' ? `${s.t.toFixed(1)}°C` : `${s.h}%`;
  }

  // ── Zoom / Pan ───────────────────────────────────────────────────
  zoomIn(): void {
    this.setZoom(this.zoom() * ZOOM_STEP);
  }

  zoomOut(): void {
    this.setZoom(this.zoom() / ZOOM_STEP);
  }

  resetZoom(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  private setZoom(next: number, focal?: { svgX: number; svgY: number }): void {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (z === this.zoom()) return;
    if (focal) {
      // keep focal point steady
      const visibleWNew = PLANO_W / z;
      const visibleHNew = PLANO_H / z;
      const visibleWOld = PLANO_W / this.zoom();
      const visibleHOld = PLANO_H / this.zoom();
      const fxRel = (focal.svgX - this.panX()) / visibleWOld;
      const fyRel = (focal.svgY - this.panY()) / visibleHOld;
      this.panX.set(this.clampPanX(focal.svgX - fxRel * visibleWNew, z));
      this.panY.set(this.clampPanY(focal.svgY - fyRel * visibleHNew, z));
    } else {
      this.panX.set(this.clampPanX(this.panX(), z));
      this.panY.set(this.clampPanY(this.panY(), z));
    }
    this.zoom.set(z);
  }

  private clampPanX(x: number, zoom: number): number {
    const visibleW = PLANO_W / zoom;
    return Math.min(PLANO_W - visibleW, Math.max(0, x));
  }

  private clampPanY(y: number, zoom: number): number {
    const visibleH = PLANO_H / zoom;
    return Math.min(PLANO_H - visibleH, Math.max(0, y));
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const focal = this.eventToSvg(event);
    const delta = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.setZoom(this.zoom() * delta, focal);
  }

  onPointerDown(event: PointerEvent): void {
    if (this.zoom() <= ZOOM_MIN) return;
    this.dragging.set(true);
    this.pointerId = event.pointerId;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      panX: this.panX(),
      panY: this.panY(),
    };
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging() || !this.dragStart || event.pointerId !== this.pointerId) return;
    const wrapEl = this.wrap?.nativeElement;
    if (!wrapEl) return;
    const rect = wrapEl.getBoundingClientRect();
    const dxScreen = event.clientX - this.dragStart.x;
    const dyScreen = event.clientY - this.dragStart.y;
    const visibleW = PLANO_W / this.zoom();
    const visibleH = PLANO_H / this.zoom();
    const dxSvg = (dxScreen / rect.width) * visibleW;
    const dySvg = (dyScreen / rect.height) * visibleH;
    this.panX.set(this.clampPanX(this.dragStart.panX - dxSvg, this.zoom()));
    this.panY.set(this.clampPanY(this.dragStart.panY - dySvg, this.zoom()));
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.dragging.set(false);
    this.dragStart = null;
    this.pointerId = null;
  }

  private eventToSvg(event: WheelEvent | PointerEvent): { svgX: number; svgY: number } {
    const wrapEl = this.wrap?.nativeElement;
    if (!wrapEl) return { svgX: PLANO_W / 2, svgY: PLANO_H / 2 };
    const rect = wrapEl.getBoundingClientRect();
    const visibleW = PLANO_W / this.zoom();
    const visibleH = PLANO_H / this.zoom();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    return {
      svgX: this.panX() + fx * visibleW,
      svgY: this.panY() + fy * visibleH,
    };
  }

  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.key === '+' || event.key === '=') this.zoomIn();
    else if (event.key === '-') this.zoomOut();
    else if (event.key === '0') this.resetZoom();
    else if (event.key === 'f' || event.key === 'F') this.toggleFullscreen();
    else if (event.key === 'Escape' && this.fullscreen()) {
      // browser handles exit; sync signal in case
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.fullscreen.set(document.fullscreenElement === this.wrap?.nativeElement);
  }

  toggleFullscreen(): void {
    const el = this.wrap?.nativeElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {
        /* permission denied or unsupported */
      });
    } else {
      document.exitFullscreen?.().catch(() => {
        /* noop */
      });
    }
  }
}
