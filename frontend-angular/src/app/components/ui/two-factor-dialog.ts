import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TwoFactorService } from '../../services/two-factor.service';

/**
 * Diálogo global de verificación 2FA. Se monta una vez (app root). El servicio
 * lo abre cuando una acción destructiva exige step-up. Permanece abierto ante
 * un código incorrecto (no fuerza reenvío) y se cierra solo al confirmar OK.
 */
@Component({
  selector: 'app-two-factor-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    @if (twoFactor.visible()) {
      <div class="tf-backdrop" (click)="cancel()" aria-hidden="true"></div>
      <div class="tf-modal" role="dialog" aria-modal="true" aria-label="Verificación 2FA">
        <div class="tf-head">
          <span class="material-symbols-outlined text-[20px] text-primary-container">
            verified_user
          </span>
          <span class="tf-title">Verificación de seguridad</span>
        </div>

        <p class="tf-text" [class.tf-text--err]="!!twoFactor.error()">
          @if (twoFactor.sending()) {
            Enviando un código a tu email…
          } @else if (twoFactor.error(); as err) {
            {{ err }}
          } @else {
            Enviamos un código de 6 dígitos a tu email. Ingresalo para confirmar esta acción.
          }
        </p>

        <input
          class="tf-input"
          type="text"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          placeholder="000000"
          [ngModel]="code()"
          (ngModelChange)="code.set($event)"
          (keyup.enter)="confirm()"
          [disabled]="twoFactor.sending() || twoFactor.validating()"
        />

        <div class="tf-foot">
          <button
            type="button"
            class="tf-link"
            [disabled]="twoFactor.sending()"
            (click)="twoFactor.resend()"
          >
            Reenviar código
          </button>
          <span class="tf-spacer"></span>
          <button type="button" class="tf-btn" (click)="cancel()">Cancelar</button>
          <button
            type="button"
            class="tf-btn tf-btn--primary"
            [disabled]="code().length < 4 || twoFactor.sending() || twoFactor.validating()"
            (click)="confirm()"
          >
            {{ twoFactor.validating() ? 'Validando…' : 'Confirmar' }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .tf-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.5);
        z-index: 100;
      }
      .tf-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(380px, 92vw);
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
        z-index: 101;
        padding: 18px;
      }
      .tf-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .tf-title {
        font-family: var(--font-josefin), sans-serif;
        font-size: 15px;
        font-weight: 600;
        color: #1e293b;
      }
      .tf-text {
        font-family: var(--font-dm), sans-serif;
        font-size: 12.5px;
        color: #64748b;
        margin: 0 0 12px;
        line-height: 1.45;
        min-height: 34px;
      }
      .tf-text--err {
        color: #b91c1c;
      }
      .tf-input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 22px;
        letter-spacing: 0.3em;
        text-align: center;
        color: #1e293b;
        outline: none;
      }
      .tf-input:focus {
        border-color: var(--color-primary);
      }
      .tf-input:disabled {
        background: #f8fafc;
      }
      .tf-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 14px;
      }
      .tf-spacer {
        flex: 1;
      }
      .tf-link {
        font-family: var(--font-dm), sans-serif;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--color-primary-container);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
      }
      .tf-link:hover:not(:disabled) {
        text-decoration: underline;
      }
      .tf-link:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tf-btn {
        padding: 8px 14px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #fff;
        color: #475569;
        font-family: var(--font-dm), sans-serif;
        font-size: 12.5px;
        font-weight: 600;
      }
      .tf-btn--primary {
        background: var(--color-primary);
        color: #fff;
        border-color: var(--color-primary);
      }
      .tf-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class TwoFactorDialogComponent {
  readonly twoFactor = inject(TwoFactorService);
  readonly code = signal('');

  constructor() {
    // Limpia el input cuando el diálogo se cierra (éxito o cancelación).
    effect(() => {
      if (!this.twoFactor.visible()) this.code.set('');
    });
  }

  confirm(): void {
    if (this.code().length < 4) return;
    this.twoFactor.submit(this.code());
  }

  cancel(): void {
    this.twoFactor.cancel();
  }
}
