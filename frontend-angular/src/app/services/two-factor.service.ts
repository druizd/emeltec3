import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

/**
 * 2FA step-up para acciones destructivas. El interceptor detecta el 403
 * TWOFA_REQUIRED/INVALID y orquesta el flujo:
 *   - begin(): primer desafío → pide un código por email y abre el diálogo.
 *   - again(): código incorrecto → mantiene el diálogo abierto, muestra error y
 *     deja reintentar con el MISMO código (no pide uno nuevo; sigue válido 5min).
 *   - resend(): el usuario pide reenviar (si venció o no llegó).
 *   - close(): éxito → cierra.
 */
@Injectable({ providedIn: 'root' })
export class TwoFactorService {
  private readonly http = inject(HttpClient);

  readonly visible = signal(false);
  readonly sending = signal(false); // enviando un código por email
  readonly validating = signal(false); // verificando el código ingresado
  readonly error = signal<string | null>(null);

  private resolver: ((code: string | null) => void) | null = null;

  /** Primer desafío: pide código + abre diálogo. */
  begin(): Promise<string | null> {
    this.error.set(null);
    this.visible.set(true);
    this.requestCode();
    return this.awaitInput();
  }

  /** Código incorrecto: NO pide uno nuevo, deja reintentar el mismo. */
  again(): Promise<string | null> {
    this.validating.set(false);
    this.error.set('Código incorrecto o vencido. Reintentá o reenviá uno nuevo.');
    this.visible.set(true);
    return this.awaitInput();
  }

  /** Reenvía un código nuevo a pedido del usuario. */
  resend(): void {
    this.error.set(null);
    this.requestCode();
  }

  submit(code: string): void {
    this.validating.set(true);
    this.error.set(null);
    const r = this.resolver;
    this.resolver = null;
    if (r) r((code || '').trim());
  }

  cancel(): void {
    const r = this.resolver;
    this.resolver = null;
    this.close();
    if (r) r(null);
  }

  close(): void {
    this.visible.set(false);
    this.validating.set(false);
    this.sending.set(false);
    this.error.set(null);
  }

  private requestCode(): void {
    this.sending.set(true);
    this.http.post('/api/2fa/request', {}).subscribe({
      next: () => this.sending.set(false),
      error: () => {
        this.sending.set(false);
        this.error.set('No se pudo enviar el código por email. Reintentá.');
      },
    });
  }

  private awaitInput(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.resolver = resolve;
    });
  }
}
