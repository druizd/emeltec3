import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import type {
  BoilerUnitData,
  PasteurProcessDiagramData,
  PasteurizerUnitData,
  ProcessPumpData,
  ProcessStatus,
  ProcessSummaryData,
  ProcessTankData,
  ProcessValveData,
} from './pasteurizador-dashboard.models';

@Component({
  selector: 'app-process-tank',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="process-tank" [ngClass]="'tone-' + tank.tone">
      <p class="unit-label">{{ tank.title }}</p>
      <div class="tank-wrap">
        <div class="tank-shell" [style.--tank-level]="levelPercent()">
          <span class="tank-cap"></span>
          <span class="tank-rim tank-rim--top"></span>
          <span class="tank-rim tank-rim--bottom"></span>
          <span class="tank-liquid">
            <span class="liquid-wave liquid-wave--a"></span>
            <span class="liquid-wave liquid-wave--b"></span>
          </span>
          <span class="tank-shine"></span>
          <div class="tank-readout">
            <span>{{ tank.label }}</span>
            <strong>{{ tank.value }}</strong>
          </div>
        </div>
      </div>
      <div class="level-badge">
        <span>Nivel</span>
        <strong>{{ tank.level }}%</strong>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 152px;
      }

      .process-tank {
        display: grid;
        justify-items: center;
        gap: 10px;
      }

      .unit-label {
        color: #0f172a;
        font-size: 12px;
        font-weight: 900;
        text-align: center;
        text-transform: uppercase;
      }

      .tank-wrap {
        position: relative;
      }

      .tank-shell {
        --liquid: #e9c96a;
        --liquid-soft: rgba(255, 246, 213, 0.68);
        --liquid-ink: #ca8a04;
        position: relative;
        z-index: 1;
        height: 224px;
        width: 136px;
        overflow: hidden;
        border: 2px solid #a9b3c1;
        border-radius: 54px 54px 22px 22px / 24px 24px 20px 20px;
        background:
          linear-gradient(
            90deg,
            rgba(15, 23, 42, 0.16),
            transparent 17%,
            transparent 78%,
            rgba(15, 23, 42, 0.18)
          ),
          linear-gradient(180deg, #f8fafc 0%, #cfd7df 18%, #f8fafc 46%, #aab4bf 100%);
        box-shadow:
          inset 12px 0 20px rgba(255, 255, 255, 0.72),
          inset -16px 0 18px rgba(15, 23, 42, 0.14),
          0 15px 28px rgba(15, 23, 42, 0.13);
      }

      .tone-green .tank-shell {
        --liquid: #d7a72e;
        --liquid-soft: rgba(250, 228, 144, 0.48);
        --liquid-ink: #a16207;
      }

      .tank-cap {
        position: absolute;
        top: -5px;
        left: 50%;
        z-index: 4;
        height: 14px;
        width: 34px;
        transform: translateX(-50%);
        border: 2px solid #8e98a6;
        border-bottom: 0;
        border-radius: 8px 8px 0 0;
        background: linear-gradient(180deg, #f8fafc, #b8c0ca);
      }

      .tank-rim {
        position: absolute;
        left: 9px;
        right: 9px;
        z-index: 3;
        height: 22px;
        border: 2px solid rgba(100, 116, 139, 0.72);
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.38);
      }

      .tank-rim--top {
        top: 14px;
      }

      .tank-rim--bottom {
        bottom: -8px;
        opacity: 0.65;
      }

      .tank-liquid {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        height: var(--tank-level);
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 22%),
          linear-gradient(180deg, var(--liquid-soft), var(--liquid));
        transition: height 280ms ease;
      }

      .liquid-wave {
        position: absolute;
        top: -12px;
        left: -18px;
        width: 172px;
        height: 28px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.48);
        animation: tank-wave 4.5s ease-in-out infinite;
      }

      .liquid-wave--b {
        top: -8px;
        opacity: 0.4;
        animation-delay: -1.7s;
        animation-duration: 5.7s;
      }

      .tank-shine {
        position: absolute;
        top: 28px;
        bottom: 18px;
        left: 16px;
        width: 16px;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), transparent);
        opacity: 0.75;
      }

      .tank-readout {
        position: absolute;
        right: 18px;
        bottom: 28px;
        left: 18px;
        z-index: 5;
        display: grid;
        gap: 4px;
        border: 1px solid rgba(148, 163, 184, 0.34);
        border-radius: 12px;
        background: rgba(248, 250, 252, 0.94);
        padding: 12px 10px;
        text-align: center;
        box-shadow: 0 8px 16px rgba(15, 23, 42, 0.09);
      }

      .tank-readout span,
      .level-badge span {
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .tank-readout strong,
      .level-badge strong {
        color: var(--liquid-ink);
        font-family: var(--font-mono);
        font-size: 20px;
        font-weight: 900;
      }

      .level-badge {
        display: grid;
        min-width: 82px;
        gap: 2px;
        border: 1px solid rgba(148, 163, 184, 0.26);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        padding: 9px 12px;
        text-align: center;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .level-badge span {
        color: #64748b;
      }

      @keyframes tank-wave {
        0%,
        100% {
          transform: translateX(-8px) scaleX(1);
        }
        50% {
          transform: translateX(8px) scaleX(1.08);
        }
      }
    `,
  ],
})
export class ProcessTankComponent {
  @Input({ required: true }) tank!: ProcessTankData;

  levelPercent(): string {
    return `${Math.max(0, Math.min(100, this.tank.level))}%`;
  }
}

@Component({
  selector: 'app-pipe-flow',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="pipe"
      [ngClass]="{
        'pipe--heat': tone === 'heat',
        'pipe--inactive': !active,
        'pipe--vertical': vertical,
      }"
      aria-hidden="true"
    >
      <span class="pipe-line"></span>
      @if (active) {
        <span class="pipe-bubbles"></span>
      }
      @if (!active) {
        <span class="pipe-stop"></span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 76px;
      }

      .pipe {
        --flow: #e9c96a;
        --flow-strong: #d7a72e;
        position: relative;
        height: 36px;
        min-width: 86px;
      }

      .pipe--heat {
        --flow: #f97316;
        --flow-strong: #ef4444;
      }

      .pipe--vertical {
        height: 156px;
        min-width: 30px;
        width: 30px;
      }

      .pipe-line {
        position: absolute;
        top: 50%;
        right: -8px;
        left: -8px;
        height: 18px;
        transform: translateY(-50%);
        border: 1px solid rgba(202, 138, 4, 0.34);
        border-radius: 999px;
        background:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.88),
            rgba(255, 255, 255, 0.18) 38%,
            rgba(15, 23, 42, 0.28)
          ),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.22) 0 2px, transparent 2px 24px),
          linear-gradient(
            90deg,
            rgba(255, 246, 213, 0.92),
            rgba(233, 201, 106, 0.96),
            rgba(215, 167, 46, 0.9)
          );
        box-shadow:
          inset 0 -3px 5px rgba(15, 23, 42, 0.22),
          0 0 0 3px rgba(202, 138, 4, 0.08),
          0 0 18px rgba(202, 138, 4, 0.18);
      }

      .pipe-line::before,
      .pipe-line::after {
        content: '';
        display: none;
        position: absolute;
        top: 50%;
        z-index: 2;
        height: 26px;
        width: 12px;
        transform: translateY(-50%);
        border: 1px solid rgba(100, 116, 139, 0.52);
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.72),
          rgba(100, 116, 139, 0.84),
          rgba(255, 255, 255, 0.42)
        );
        box-shadow:
          inset 0 -3px 5px rgba(15, 23, 42, 0.18),
          0 4px 8px rgba(15, 23, 42, 0.13);
      }

      .pipe-line::before {
        left: 0;
        border-radius: 999px 0 0 999px;
      }

      .pipe-line::after {
        right: 0;
        border-radius: 0 999px 999px 0;
      }

      .pipe--vertical .pipe-line {
        top: -44px;
        bottom: -20px;
        left: 50%;
        right: auto;
        width: 18px;
        height: auto;
        transform: translateX(-50%);
      }

      .pipe--vertical .pipe-line::before,
      .pipe--vertical .pipe-line::after {
        top: auto;
        left: 50%;
        height: 12px;
        width: 26px;
        transform: translateX(-50%);
      }

      .pipe--vertical .pipe-line::before {
        top: 0;
        border-radius: 999px 999px 0 0;
      }

      .pipe--vertical .pipe-line::after {
        bottom: 0;
        border-radius: 0 0 999px 999px;
      }

      .pipe--heat .pipe-line {
        border-color: rgba(249, 115, 22, 0.42);
        background:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.66),
            transparent 42%,
            rgba(127, 29, 29, 0.28)
          ),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.2) 0 2px, transparent 2px 22px),
          linear-gradient(90deg, rgba(249, 115, 22, 0.92), rgba(239, 68, 68, 0.96));
        box-shadow:
          inset 0 -2px 4px rgba(15, 23, 42, 0.14),
          0 0 0 3px rgba(249, 115, 22, 0.1),
          0 0 18px rgba(249, 115, 22, 0.34);
      }

      .pipe-bubbles {
        position: absolute;
        top: 50%;
        right: 0;
        left: 0;
        height: 26px;
        transform: translateY(-50%);
        border-radius: 999px;
        overflow: hidden;
        filter: drop-shadow(0 0 5px rgba(202, 138, 4, 0.42));
      }

      .pipe--heat .pipe-bubbles {
        filter: drop-shadow(0 0 4px rgba(249, 115, 22, 0.58));
      }

      .pipe-bubbles::before,
      .pipe-bubbles::after {
        content: '';
        position: absolute;
        top: 50%;
        left: -52px;
        height: 7px;
        width: 7px;
        transform: translateY(-50%);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow:
          20px -3px 0 rgba(255, 255, 255, 0.8),
          42px 3px 0 rgba(255, 255, 255, 0.92),
          66px -1px 0 rgba(255, 255, 255, 0.72);
        animation: pipe-bubble-flow 2.35s linear infinite;
      }

      .pipe-bubbles::after {
        animation-delay: -1.18s;
        opacity: 0.78;
      }

      .pipe--vertical .pipe-bubbles {
        inset: -40px 0 -20px;
        width: 26px;
        height: auto;
        transform: none;
      }

      .pipe--heat .pipe-bubbles::before,
      .pipe--heat .pipe-bubbles::after {
        background: rgba(255, 247, 237, 0.98);
        box-shadow:
          18px -3px 0 rgba(254, 215, 170, 0.84),
          37px 3px 0 rgba(255, 255, 255, 0.92),
          58px -1px 0 rgba(254, 215, 170, 0.7);
      }

      .pipe--vertical .pipe-bubbles::before,
      .pipe--vertical .pipe-bubbles::after {
        top: auto;
        bottom: -52px;
        left: 50%;
        transform: translateX(-50%);
        box-shadow:
          -3px -18px 0 rgba(254, 215, 170, 0.84),
          3px -37px 0 rgba(255, 255, 255, 0.92),
          -1px -58px 0 rgba(254, 215, 170, 0.7);
        animation-name: pipe-bubble-flow-vertical;
      }

      .pipe-stop {
        position: absolute;
        top: 50%;
        right: 0;
        height: 32px;
        width: 32px;
        transform: translateY(-50%);
        border-radius: 999px;
        background:
          linear-gradient(45deg, transparent 42%, #ef4444 42% 58%, transparent 58%),
          linear-gradient(-45deg, transparent 42%, #ef4444 42% 58%, transparent 58%),
          rgba(254, 242, 242, 0.95);
        box-shadow:
          0 0 0 4px rgba(239, 68, 68, 0.16),
          0 0 16px rgba(239, 68, 68, 0.32);
      }

      .pipe--inactive .pipe-line {
        background:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.86),
            transparent 44%,
            rgba(120, 53, 15, 0.12)
          ),
          linear-gradient(90deg, rgba(255, 246, 213, 0.78), rgba(233, 201, 106, 0.54));
        border-color: rgba(202, 138, 4, 0.22);
        box-shadow:
          inset 0 -2px 4px rgba(120, 53, 15, 0.08),
          0 0 0 3px rgba(202, 138, 4, 0.04);
      }

      @media (prefers-reduced-motion: reduce) {
        .pipe-bubbles::before,
        .pipe-bubbles::after {
          animation-duration: 7s;
        }
      }

      @keyframes pipe-bubble-flow {
        to {
          left: calc(100% + 52px);
        }
      }

      @keyframes pipe-bubble-flow-vertical {
        to {
          bottom: calc(100% + 52px);
        }
      }
    `,
  ],
})
export class PipeFlowComponent {
  @Input() active = true;
  @Input() tone: 'milk' | 'heat' = 'milk';
  @Input() vertical = false;
}

@Component({
  selector: 'app-process-pump',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="pump" [class.is-active]="pump.state === 'active'">
      <p class="unit-label">{{ pump.title }}</p>
      <div class="pump-body">
        <span class="pump-nozzle pump-nozzle--left"></span>
        <span class="pump-nozzle pump-nozzle--right"></span>
        <span class="pump-motor"></span>
        <span class="pump-ring">
          <span class="pump-rotor"></span>
        </span>
        <span class="pump-base"></span>
      </div>
      <div class="state-box">
        <span>Estado</span>
        <strong>{{ pump.state === 'active' ? 'ACTIVA' : 'INACTIVA' }}</strong>
        <small>{{ pump.helper }}</small>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 144px;
      }

      .pump {
        display: grid;
        justify-items: center;
        gap: 10px;
      }

      .unit-label {
        color: #0f172a;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .pump-body {
        position: relative;
        width: 118px;
        height: 104px;
      }

      .pump-motor,
      .pump-ring,
      .pump-nozzle,
      .pump-base {
        position: absolute;
        border: 2px solid #607084;
        background: linear-gradient(145deg, #d9f4ff, #2284b5 48%, #1d5c82);
        box-shadow:
          inset 8px 6px 12px rgba(255, 255, 255, 0.42),
          inset -6px -7px 12px rgba(15, 23, 42, 0.28),
          0 10px 18px rgba(15, 23, 42, 0.16);
      }

      .pump-motor {
        left: 18px;
        top: 34px;
        height: 46px;
        width: 80px;
        border-radius: 16px;
      }

      .pump-ring {
        left: 35px;
        top: 22px;
        display: grid;
        height: 58px;
        width: 58px;
        place-items: center;
        border-radius: 999px;
      }

      .pump-rotor {
        display: block;
        height: 32px;
        width: 32px;
        border: 3px solid rgba(255, 255, 255, 0.76);
        border-left-color: rgba(15, 23, 42, 0.36);
        border-radius: 999px;
      }

      .is-active .pump-rotor {
        animation: pump-rotate 1.1s linear infinite;
      }

      .is-active .pump-ring {
        animation: pump-pulse 1.8s ease-in-out infinite;
      }

      .pump-nozzle {
        top: 46px;
        height: 20px;
        width: 24px;
        border-radius: 8px;
      }

      .pump-nozzle--left {
        left: 0;
      }

      .pump-nozzle--right {
        right: 0;
      }

      .pump-base {
        left: 22px;
        bottom: 5px;
        height: 12px;
        width: 74px;
        border-radius: 5px 5px 0 0;
        background: linear-gradient(180deg, #64748b, #334155);
      }

      .state-box {
        display: grid;
        min-width: 136px;
        grid-template-columns: 1fr auto;
        gap: 4px 14px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        padding: 10px 12px;
        box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
      }

      .state-box span,
      .state-box small {
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .state-box strong {
        color: #16a34a;
        font-size: 13px;
        font-weight: 900;
      }

      .state-box small {
        grid-column: 1 / -1;
      }

      @keyframes pump-rotate {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes pump-pulse {
        0%,
        100% {
          box-shadow:
            inset 8px 6px 12px rgba(255, 255, 255, 0.42),
            inset -6px -7px 12px rgba(15, 23, 42, 0.28),
            0 10px 18px rgba(15, 23, 42, 0.16);
        }
        50% {
          box-shadow:
            inset 8px 6px 12px rgba(255, 255, 255, 0.42),
            inset -6px -7px 12px rgba(15, 23, 42, 0.28),
            0 0 0 6px rgba(13, 175, 189, 0.1),
            0 12px 20px rgba(15, 23, 42, 0.18);
        }
      }
    `,
  ],
})
export class ProcessPumpComponent {
  @Input({ required: true }) pump!: ProcessPumpData;
}

@Component({
  selector: 'app-pasteurizer-unit',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="pasteurizer" [ngClass]="'status-' + unit.status">
      <p class="unit-label">{{ unit.title }}</p>
      <div class="machine">
        <span class="machine-port machine-port--left"></span>
        <span class="machine-port machine-port--right"></span>
        <span class="tube tube--top"></span>
        <span class="tube tube--mid"></span>
        <span class="tube tube--bottom"></span>
        <span class="plate plate--left"></span>
        <span class="plate plate--right"></span>
        <span class="bolt bolt--a"></span>
        <span class="bolt bolt--b"></span>
        <span class="bolt bolt--c"></span>
        <span class="bolt bolt--d"></span>
        <span class="thermo">
          <span class="material-symbols-outlined">device_thermostat</span>
        </span>
        <span class="steam-port"></span>
        <div class="main-readout">
          <span>{{ unit.label }}</span>
          <strong>{{ unit.value }}</strong>
          <small>{{ unit.helper }}</small>
        </div>
      </div>
      <div class="status-pill">
        <span>Estado</span>
        <strong>{{ statusLabel(unit.status) }}</strong>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 310px;
      }

      .pasteurizer {
        --status: #22c55e;
        display: grid;
        justify-items: center;
        gap: 10px;
      }

      .status-warning {
        --status: #f97316;
      }

      .status-critical {
        --status: #ef4444;
      }

      .unit-label {
        color: #0f172a;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .machine {
        position: relative;
        width: min(360px, 100%);
        height: 226px;
      }

      .tube {
        position: absolute;
        left: 50px;
        right: 50px;
        height: 42px;
        border: 2px solid #8c96a5;
        border-radius: 999px;
        background:
          repeating-linear-gradient(90deg, rgba(15, 23, 42, 0.08) 0 3px, transparent 3px 7px),
          linear-gradient(180deg, #f8fafc 0%, #aeb8c4 48%, #eef2f7 100%);
        box-shadow:
          inset 0 8px 12px rgba(255, 255, 255, 0.65),
          inset 0 -10px 14px rgba(15, 23, 42, 0.18),
          0 10px 18px rgba(15, 23, 42, 0.12);
      }

      .machine-port {
        position: absolute;
        top: 104px;
        z-index: 2;
        height: 22px;
        width: 38px;
        border: 1px solid rgba(202, 138, 4, 0.32);
        background:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.78),
            transparent 48%,
            rgba(120, 53, 15, 0.18)
          ),
          linear-gradient(90deg, #fff6d5, #e9c96a 62%, #d7a72e);
        box-shadow:
          inset 0 -2px 4px rgba(120, 53, 15, 0.12),
          0 8px 14px rgba(202, 138, 4, 0.12);
      }

      .machine-port--left {
        left: 8px;
        border-radius: 999px 0 0 999px;
      }

      .machine-port--right {
        right: 8px;
        border-radius: 0 999px 999px 0;
      }

      .tube--top {
        top: 44px;
      }

      .tube--mid {
        top: 91px;
      }

      .tube--bottom {
        top: 138px;
      }

      .plate {
        position: absolute;
        top: 34px;
        bottom: 30px;
        width: 30px;
        border: 2px solid #7b8796;
        border-radius: 11px;
        background: linear-gradient(90deg, #f8fafc, #9ba6b5 50%, #e5e7eb);
        box-shadow: inset -5px 0 8px rgba(15, 23, 42, 0.18);
      }

      .plate--left {
        left: 34px;
      }

      .plate--right {
        right: 34px;
      }

      .bolt {
        position: absolute;
        height: 13px;
        width: 13px;
        border: 2px solid #64748b;
        border-radius: 999px;
        background: #f8fafc;
      }

      .bolt--a {
        top: 40px;
        left: 26px;
      }

      .bolt--b {
        right: 26px;
        top: 40px;
      }

      .bolt--c {
        bottom: 36px;
        left: 26px;
      }

      .bolt--d {
        right: 26px;
        bottom: 36px;
      }

      .thermo {
        position: absolute;
        top: 6px;
        left: 50%;
        display: grid;
        height: 34px;
        width: 34px;
        place-items: center;
        transform: translateX(-50%);
        border: 1px solid rgba(100, 116, 139, 0.36);
        border-radius: 999px;
        background: #ffffff;
        color: var(--status);
        box-shadow: 0 6px 14px rgba(15, 23, 42, 0.1);
      }

      .thermo .material-symbols-outlined {
        font-size: 21px;
      }

      .steam-port {
        position: absolute;
        bottom: 12px;
        left: 50%;
        z-index: 4;
        height: 30px;
        width: 30px;
        transform: translateX(-50%);
        border: 2px solid rgba(248, 113, 113, 0.82);
        border-radius: 999px;
        background:
          radial-gradient(circle at 50% 38%, rgba(255, 247, 237, 0.95) 0 4px, transparent 5px),
          linear-gradient(180deg, #f97316, #dc2626);
        box-shadow:
          0 0 0 4px rgba(248, 113, 113, 0.16),
          0 0 18px rgba(249, 115, 22, 0.42);
      }

      .main-readout {
        position: absolute;
        top: 78px;
        left: 50%;
        z-index: 3;
        display: grid;
        min-width: 150px;
        gap: 4px;
        transform: translateX(-50%);
        border: 1px solid rgba(167, 139, 250, 0.38);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.95);
        padding: 15px 18px;
        text-align: center;
        box-shadow:
          0 0 0 5px rgba(139, 92, 246, 0.08),
          0 12px 24px rgba(15, 23, 42, 0.1);
      }

      .main-readout span,
      .main-readout small,
      .status-pill span {
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .main-readout strong {
        color: #8b5cf6;
        font-family: var(--font-mono);
        font-size: 25px;
        font-weight: 900;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        padding: 8px 12px;
      }

      .status-pill strong {
        color: var(--status);
        font-size: 12px;
        font-weight: 900;
      }
    `,
  ],
})
export class PasteurizerUnitComponent {
  @Input({ required: true }) unit!: PasteurizerUnitData;

  statusLabel(status: ProcessStatus): string {
    if (status === 'critical') return 'CRITICO';
    if (status === 'warning') return 'ADVERTENCIA';
    return 'NORMAL';
  }
}

@Component({
  selector: 'app-process-valve',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="valve" [ngClass]="'state-' + valve.state">
      <p class="unit-label">{{ valve.title }}</p>
      <div class="valve-body">
        <span class="wheel"></span>
        <span class="stem"></span>
        <span class="neck"></span>
        <span class="body-core"></span>
        <span class="flange flange--left"></span>
        <span class="flange flange--right"></span>
        <span class="valve-gate"></span>
      </div>
      <div class="valve-readout">
        <span>{{ valve.label }}</span>
        <strong>{{ valve.state === 'open' ? 'ABIERTA' : 'CERRADA' }}</strong>
        <small>{{ valve.value }}</small>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 142px;
      }

      .valve {
        --valve: #ef4444;
        display: grid;
        justify-items: center;
        gap: 10px;
      }

      .state-open {
        --valve: #22c55e;
      }

      .unit-label {
        color: #0f172a;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .valve-body {
        position: relative;
        height: 116px;
        width: 132px;
      }

      .wheel {
        position: absolute;
        top: 2px;
        left: 50%;
        width: 54px;
        height: 54px;
        transform: translateX(-50%);
        border: 5px solid var(--valve);
        border-radius: 999px;
        background:
          linear-gradient(var(--valve), var(--valve)) center / 72% 5px no-repeat,
          linear-gradient(90deg, var(--valve), var(--valve)) center / 5px 72% no-repeat,
          radial-gradient(circle, rgba(255, 255, 255, 0.9) 0 5px, transparent 6px),
          rgba(255, 255, 255, 0.96);
        box-shadow:
          0 0 0 4px rgba(239, 68, 68, 0.1),
          0 10px 18px rgba(0, 0, 0, 0.22);
      }

      .state-open .wheel {
        animation: valve-turn 2.6s linear infinite;
      }

      .stem {
        position: absolute;
        top: 52px;
        left: 50%;
        width: 8px;
        height: 30px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: linear-gradient(90deg, #8b98a8, #f8fafc, #718096);
      }

      .neck {
        position: absolute;
        top: 76px;
        left: 50%;
        height: 16px;
        width: 34px;
        transform: translateX(-50%);
        border: 2px solid #7b8796;
        border-radius: 8px 8px 4px 4px;
        background: linear-gradient(180deg, #e5e7eb, #94a3b8);
      }

      .body-core,
      .flange {
        position: absolute;
        border: 1px solid rgba(120, 53, 15, 0.34);
        background:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.62),
            transparent 44%,
            rgba(120, 53, 15, 0.2)
          ),
          linear-gradient(135deg, #fff7df, #e9c96a 48%, #b9851e);
        box-shadow:
          inset 5px 5px 8px rgba(255, 255, 255, 0.44),
          inset -4px -6px 8px rgba(120, 53, 15, 0.18),
          0 8px 16px rgba(202, 138, 4, 0.1);
      }

      .body-core {
        left: 35px;
        top: 86px;
        height: 30px;
        width: 62px;
        border-radius: 13px;
      }

      .body-core::after {
        content: '';
        position: absolute;
        inset: 7px 23px;
        border-radius: 999px;
        background: var(--valve);
        opacity: 0.88;
      }

      .flange {
        top: 89px;
        height: 24px;
        width: 26px;
        border-radius: 7px;
      }

      .flange--left {
        left: 10px;
      }

      .flange--right {
        right: 10px;
      }

      .valve-gate {
        position: absolute;
        top: 92px;
        left: 50%;
        z-index: 3;
        height: 18px;
        width: 18px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: var(--valve);
        box-shadow:
          inset 0 2px 4px rgba(255, 255, 255, 0.3),
          0 0 12px color-mix(in srgb, var(--valve), transparent 40%);
      }

      .valve-readout {
        display: grid;
        min-width: 116px;
        gap: 4px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        padding: 10px 12px;
        text-align: center;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .valve-readout span,
      .valve-readout small {
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .valve-readout strong {
        color: var(--valve);
        font-size: 16px;
        font-weight: 900;
      }

      @keyframes valve-turn {
        to {
          transform: translateX(-50%) rotate(360deg);
        }
      }
    `,
  ],
})
export class ProcessValveComponent {
  @Input({ required: true }) valve!: ProcessValveData;
}

@Component({
  selector: 'app-boiler-unit',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="boiler" [class.is-active]="boiler.active">
      <div class="boiler-machine">
        <span class="chimney chimney--a"></span>
        <span class="chimney chimney--b"></span>
        <span class="boiler-tank"></span>
        <span class="boiler-door"></span>
        <span class="flame"></span>
        <span class="boiler-base"></span>
      </div>
      <div class="boiler-data">
        <p>{{ boiler.title }}</p>
        <div class="boiler-metrics">
          @for (metric of boiler.metrics; track metric.label) {
            <span>
              <small>{{ metric.label }}</small>
              <strong>{{ metric.value }}</strong>
            </span>
          }
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      .boiler {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(220px, 1fr);
        align-items: end;
        gap: 18px;
        width: min(520px, 100%);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 16px;
        background:
          radial-gradient(circle at 28% 38%, rgba(249, 115, 22, 0.08), transparent 8rem),
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.98));
        padding: 18px;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.86),
          0 12px 24px rgba(15, 23, 42, 0.08);
      }

      .boiler-machine {
        position: relative;
        width: 150px;
        height: 122px;
      }

      .boiler-tank {
        position: absolute;
        left: 18px;
        right: 6px;
        bottom: 22px;
        height: 68px;
        border: 2px solid #475569;
        border-radius: 32px 14px 14px 32px;
        background:
          radial-gradient(circle at 21% 50%, rgba(255, 255, 255, 0.28), transparent 24px),
          linear-gradient(135deg, #64748b, #1f2937 55%, #111827);
        box-shadow:
          inset 10px 5px 12px rgba(255, 255, 255, 0.16),
          inset -10px -8px 16px rgba(0, 0, 0, 0.36),
          0 10px 16px rgba(15, 23, 42, 0.18);
      }

      .chimney {
        position: absolute;
        z-index: 2;
        bottom: 83px;
        width: 16px;
        height: 40px;
        border: 2px solid #475569;
        border-radius: 8px 8px 2px 2px;
        background: linear-gradient(90deg, #e5e7eb, #64748b);
      }

      .chimney--a {
        left: 52px;
      }

      .chimney--b {
        left: 82px;
        height: 34px;
      }

      .boiler-door {
        position: absolute;
        left: 66px;
        bottom: 30px;
        z-index: 3;
        width: 40px;
        height: 35px;
        border-radius: 14px 14px 6px 6px;
        background: #1f2937;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.08);
      }

      .flame {
        position: absolute;
        left: 79px;
        bottom: 35px;
        z-index: 4;
        width: 22px;
        height: 30px;
        border-radius: 50% 50% 45% 45%;
        background: linear-gradient(180deg, #fef3c7 0%, #f97316 48%, #ef4444 100%);
        clip-path: polygon(50% 0, 72% 34%, 94% 62%, 78% 100%, 50% 86%, 22% 100%, 6% 62%, 30% 34%);
        animation: flame-flicker 1.15s ease-in-out infinite;
      }

      .boiler-base {
        position: absolute;
        right: 2px;
        bottom: 14px;
        left: 22px;
        height: 10px;
        border-radius: 4px;
        background: #334155;
      }

      .boiler-data {
        display: grid;
        gap: 12px;
        min-width: 0;
      }

      .boiler-data p {
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
        text-align: center;
        text-transform: uppercase;
      }

      .boiler-metrics {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .boiler-metrics span {
        display: grid;
        gap: 4px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        padding: 12px;
        text-align: center;
      }

      .boiler-metrics small {
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .boiler-metrics strong {
        color: #f97316;
        font-family: var(--font-mono);
        font-size: 18px;
        font-weight: 900;
      }

      @keyframes flame-flicker {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.92;
        }
        50% {
          transform: scale(1.08, 0.94);
          opacity: 1;
        }
      }

      @media (max-width: 680px) {
        .boiler {
          grid-template-columns: 1fr;
          justify-items: center;
        }
      }
    `,
  ],
})
export class BoilerUnitComponent {
  @Input({ required: true }) boiler!: BoilerUnitData;
}

@Component({
  selector: 'app-process-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="summary">
      <div class="summary-head">
        <span class="material-symbols-outlined">fact_check</span>
        <h3>{{ summary.title }}</h3>
      </div>

      <div class="summary-list">
        @for (metric of summary.metrics; track metric.label) {
          <div class="summary-row" [ngClass]="'tone-' + (metric.tone || 'neutral')">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </div>
        }
      </div>
    </aside>
  `,
  styles: [
    `
      .summary {
        display: grid;
        gap: 14px;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        background: #ffffff;
        padding: 14px;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.055);
      }

      .summary-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .summary-head .material-symbols-outlined {
        display: grid;
        height: 36px;
        width: 36px;
        place-items: center;
        border-radius: 12px;
        background: rgba(13, 175, 189, 0.1);
        color: #0899a5;
        font-size: 21px;
      }

      .summary-head h3 {
        color: #0f172a;
        font-size: 15px;
        font-weight: 900;
      }

      .summary-list {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(5, minmax(150px, 1fr));
      }

      .summary-row {
        display: grid;
        min-height: 74px;
        align-content: center;
        gap: 7px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: linear-gradient(180deg, #ffffff, #f8fafc), #ffffff;
        padding: 12px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
      }

      .summary-row span {
        color: #475569;
        font-size: 11px;
        font-weight: 800;
      }

      .summary-row strong {
        color: #0f172a;
        font-family: var(--font-mono);
        font-size: 16px;
        font-weight: 900;
      }

      .summary-row.tone-green strong {
        color: #16a34a;
      }

      .summary-row.tone-blue strong {
        color: #0dafbd;
      }

      .summary-row.tone-orange strong {
        color: #f97316;
      }

      .summary-row.tone-red strong {
        color: #ef4444;
      }

      .summary-row.tone-purple strong {
        color: #8b5cf6;
      }

      @media (max-width: 1120px) {
        .summary-list {
          grid-template-columns: repeat(3, minmax(150px, 1fr));
        }
      }

      @media (max-width: 640px) {
        .summary-list {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ProcessSummaryComponent {
  @Input({ required: true }) summary!: ProcessSummaryData;
}

@Component({
  selector: 'app-pasteurizador-process-diagram',
  standalone: true,
  imports: [
    CommonModule,
    ProcessTankComponent,
    PipeFlowComponent,
    ProcessPumpComponent,
    PasteurizerUnitComponent,
    ProcessValveComponent,
    BoilerUnitComponent,
    ProcessSummaryComponent,
  ],
  template: `
    <section class="process-diagram-card">
      <header class="diagram-header">
        <div>
          <p>Monitoreo</p>
          <h2>Diagrama de Proceso</h2>
          <span>Sistema de pasteurizacion con caldera de vapor</span>
        </div>
        <div class="status-chip" [ngClass]="'status-' + data.pasteurizer.status">
          <span></span>
          {{ statusChipLabel(data.pasteurizer.status) }}
        </div>
      </header>

      <div class="diagram-layout">
        <div class="diagram-stage">
          <div class="steam-run" aria-hidden="true">
            <span class="steam-pipe"></span>
            <span class="steam-flow"></span>
            <span class="steam-label">Vapor</span>
          </div>

          <div class="flow-row">
            <app-process-tank [tank]="data.inputTank" />
            <app-pipe-flow [active]="data.pump.state === 'active'" />
            <app-process-pump [pump]="data.pump" />
            <app-pipe-flow [active]="data.pump.state === 'active'" />
            <app-pasteurizer-unit [unit]="data.pasteurizer" />
            <app-pipe-flow [active]="data.pump.state === 'active'" />
            <app-process-valve [valve]="data.valve" />
            <app-pipe-flow [active]="data.pump.state === 'active' && data.valve.state === 'open'" />
            <app-process-tank [tank]="data.outputTank" />
          </div>

          <div class="heat-zone">
            <app-boiler-unit [boiler]="data.boiler" />
          </div>
        </div>
      </div>

      <div class="summary-strip">
        <app-process-summary [summary]="data.summary" />
      </div>
    </section>
  `,
  styles: [
    `
      .process-diagram-card {
        overflow: hidden;
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
      }

      .diagram-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 1px solid #edf2f7;
        padding: 18px 20px;
      }

      .diagram-header p {
        margin-bottom: 4px;
        color: #94a3b8;
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .diagram-header h2 {
        color: #0f172a;
        font-size: 23px;
        font-weight: 900;
        line-height: 1.1;
      }

      .diagram-header span {
        color: #64748b;
        font-size: 13px;
        font-weight: 700;
      }

      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(34, 197, 94, 0.28);
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.08);
        padding: 9px 12px;
        color: #16a34a;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .status-chip span {
        height: 8px;
        width: 8px;
        border-radius: 999px;
        background: currentColor;
      }

      .status-chip.status-warning {
        border-color: rgba(249, 115, 22, 0.28);
        background: rgba(249, 115, 22, 0.08);
        color: #ea580c;
      }

      .status-chip.status-critical {
        border-color: rgba(239, 68, 68, 0.28);
        background: rgba(239, 68, 68, 0.08);
        color: #dc2626;
      }

      .diagram-layout {
        padding: 18px;
        background:
          linear-gradient(180deg, rgba(248, 250, 252, 0.74), rgba(241, 245, 249, 0.9)), #f8fafc;
      }

      .diagram-stage {
        display: grid;
        position: relative;
        gap: 0;
        overflow-x: auto;
        overflow-y: hidden;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 16px;
        background:
          radial-gradient(circle at 17% 26%, rgba(13, 175, 189, 0.11), transparent 20rem),
          radial-gradient(circle at 72% 18%, rgba(139, 92, 246, 0.08), transparent 22rem),
          linear-gradient(90deg, rgba(15, 23, 42, 0.045) 0 1px, transparent 1px 84px),
          linear-gradient(180deg, rgba(15, 23, 42, 0.035) 0 1px, transparent 1px 74px),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 48%, #eef3f8 100%);
        background-size:
          auto,
          auto,
          84px 100%,
          100% 74px,
          auto;
        padding: 22px 30px 24px;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.9),
          inset 0 -1px 0 rgba(148, 163, 184, 0.22);
        scrollbar-color: rgba(13, 175, 189, 0.34) transparent;
      }

      .steam-run {
        position: absolute;
        top: 247px;
        left: 50%;
        z-index: 2;
        width: 38px;
        height: 292px;
        transform: translateX(-50%);
        pointer-events: none;
      }

      .steam-pipe {
        position: absolute;
        top: -4px;
        bottom: 0;
        left: 50%;
        width: 18px;
        transform: translateX(-50%);
        border: 1px solid rgba(249, 115, 22, 0.42);
        border-radius: 999px;
        background:
          linear-gradient(
            90deg,
            rgba(255, 247, 237, 0.68),
            transparent 42%,
            rgba(127, 29, 29, 0.2)
          ),
          linear-gradient(180deg, #fdba74 0%, #fb923c 48%, #ef4444 100%);
        box-shadow:
          inset 0 2px 6px rgba(255, 255, 255, 0.38),
          inset 0 -8px 12px rgba(127, 29, 29, 0.2),
          0 0 0 4px rgba(249, 115, 22, 0.1),
          0 0 18px rgba(249, 115, 22, 0.28);
      }

      .steam-pipe::before {
        content: '';
        position: absolute;
        top: -7px;
        left: 50%;
        width: 28px;
        height: 12px;
        transform: translateX(-50%);
        border: 1px solid rgba(249, 115, 22, 0.38);
        border-radius: 999px 999px 4px 4px;
        background: linear-gradient(180deg, rgba(255, 247, 237, 0.9), #fb923c);
      }

      .steam-flow {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border-radius: 999px;
        filter: drop-shadow(0 0 5px rgba(255, 247, 237, 0.58));
      }

      .steam-flow::before,
      .steam-flow::after {
        content: '';
        position: absolute;
        bottom: -44px;
        left: 50%;
        width: 7px;
        height: 7px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: rgba(255, 247, 237, 0.96);
        box-shadow:
          -2px -28px 0 rgba(254, 215, 170, 0.76),
          3px -55px 0 rgba(255, 247, 237, 0.92),
          -1px -82px 0 rgba(254, 215, 170, 0.72);
        animation: steam-run-flow 2.2s linear infinite;
      }

      .steam-flow::after {
        animation-delay: -1.1s;
        opacity: 0.72;
      }

      .steam-label {
        position: absolute;
        top: 86px;
        left: 30px;
        border: 1px solid rgba(248, 113, 113, 0.32);
        border-radius: 999px;
        background: rgba(127, 29, 29, 0.72);
        padding: 4px 9px;
        color: #fed7aa;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
        white-space: nowrap;
      }

      @keyframes steam-run-flow {
        to {
          bottom: calc(100% + 44px);
        }
      }

      .flow-row {
        display: grid;
        position: relative;
        align-items: start;
        grid-template-columns:
          minmax(142px, auto)
          minmax(82px, 0.44fr)
          minmax(128px, auto)
          minmax(82px, 0.44fr)
          minmax(300px, 1fr)
          minmax(82px, 0.44fr)
          minmax(128px, auto)
          minmax(82px, 0.44fr)
          minmax(142px, auto);
        gap: 0;
        min-width: 1180px;
      }

      .flow-row::before {
        content: '';
        position: absolute;
        top: 126px;
        right: 68px;
        left: 68px;
        z-index: 0;
        height: 18px;
        border: 1px solid rgba(14, 116, 144, 0.18);
        border-radius: 999px;
        background:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.82),
            transparent 42%,
            rgba(15, 23, 42, 0.18)
          ),
          linear-gradient(
            90deg,
            rgba(148, 163, 184, 0.2),
            rgba(233, 201, 106, 0.34),
            rgba(148, 163, 184, 0.2)
          );
        box-shadow:
          inset 0 -3px 5px rgba(15, 23, 42, 0.12),
          0 0 0 3px rgba(202, 138, 4, 0.05);
      }

      .flow-row app-process-tank,
      .flow-row app-process-pump,
      .flow-row app-pasteurizer-unit,
      .flow-row app-process-valve {
        position: relative;
        z-index: 3;
      }

      .flow-row app-pipe-flow {
        position: relative;
        z-index: 1;
        align-self: start;
        min-width: 106px;
        margin-top: 117px;
        margin-inline: -22px;
      }

      .flow-row app-process-pump {
        margin-top: 49px;
      }

      .flow-row app-pasteurizer-unit {
        margin-top: -9px;
      }

      .flow-row app-process-valve {
        margin-top: 5px;
      }

      .heat-zone {
        display: grid;
        position: relative;
        grid-template-columns: 1fr minmax(300px, 520px) 1fr;
        align-items: start;
        justify-items: center;
        min-width: 1180px;
        margin-top: 74px;
      }

      .heat-zone app-boiler-unit {
        grid-column: 2;
        position: relative;
        z-index: 3;
        margin-top: -2px;
      }

      .summary-strip {
        padding: 0 18px 18px;
        background: linear-gradient(180deg, rgba(241, 245, 249, 0.9), #f8fafc);
      }

      @media (max-width: 1320px) {
        .flow-row,
        .heat-zone {
          min-width: 1120px;
        }
      }

      @media (max-width: 760px) {
        .diagram-header {
          align-items: flex-start;
          flex-direction: column;
        }

        .diagram-layout {
          padding: 12px;
        }

        .diagram-stage {
          padding: 14px;
        }

        .summary-strip {
          padding: 0 12px 12px;
        }
      }
    `,
  ],
})
export class PasteurizadorProcessDiagramComponent {
  @Input({ required: true }) data!: PasteurProcessDiagramData;

  statusChipLabel(status: ProcessStatus): string {
    if (status === 'critical') return 'Proceso critico';
    if (status === 'warning') return 'Proceso en advertencia';
    return 'Proceso normal';
  }
}
