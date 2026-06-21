import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TwoFactorService } from '../../services/two-factor.service';

/**
 * Diálogo global de verificación 2FA. Se monta una vez (app root). El servicio
 * lo abre cuando una acción destructiva exige step-up.
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
        <p class="tf-text">
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
          [disabled]="twoFactor.sending()"
        />
        <div class="tf-foot">
          <button type="button" class="tf-btn" (click)="cancel()">Cancelar</button>
          <button
            type="button"
            class="tf-btn tf-btn--primary"
            [disabled]="code().length < 4 || twoFactor.sending()"
            (click)="confirm()"
          >
            Confirmar
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
        width: min(360px, 92vw);
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
      .tf-foot {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
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

  confirm(): void {
    if (this.code().length < 4) return;
    const c = this.code();
    this.code.set('');
    this.twoFactor.submit(c);
  }

  cancel(): void {
    this.code.set('');
    this.twoFactor.cancel();
  }
}
