import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

/**
 * 2FA step-up para acciones destructivas. El interceptor detecta el 403
 * TWOFA_REQUIRED, llama a open() (que pide un código por email y muestra el
 * diálogo) y reintenta la acción con el código.
 */
@Injectable({ providedIn: 'root' })
export class TwoFactorService {
  private readonly http = inject(HttpClient);

  readonly visible = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly canViewCodeSent = computed(() => !this.sending() && !this.error());

  private resolver: ((code: string | null) => void) | null = null;

  /** Pide un código (email) y abre el diálogo. Resuelve con el código o null (cancelar). */
  open(): Promise<string | null> {
    this.error.set(null);
    this.sending.set(true);
    this.visible.set(true);
    this.http.post('/api/2fa/request', {}).subscribe({
      next: () => this.sending.set(false),
      error: () => {
        this.sending.set(false);
        this.error.set('No se pudo enviar el código por email. Reintentá.');
      },
    });
    return new Promise<string | null>((resolve) => {
      this.resolver = resolve;
    });
  }

  submit(code: string): void {
    const r = this.resolver;
    this.resolver = null;
    this.visible.set(false);
    if (r) r((code || '').trim());
  }

  cancel(): void {
    const r = this.resolver;
    this.resolver = null;
    this.visible.set(false);
    if (r) r(null);
  }
}
