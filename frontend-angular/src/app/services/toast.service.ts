import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

/**
 * Notificaciones efímeras (toasts) a nivel de app. Se muestran tras completar
 * una acción — típicamente al cerrar un modal de mutación: "Guardado
 * satisfactoriamente". Se auto-descartan; los errores duran más y se pueden
 * cerrar a mano.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  private push(message: string, type: ToastType, durationMs: number): void {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { id, type, message }]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  success(message: string, durationMs = 3500): void {
    this.push(message, 'success', durationMs);
  }

  error(message: string, durationMs = 6000): void {
    this.push(message, 'error', durationMs);
  }

  info(message: string, durationMs = 3500): void {
    this.push(message, 'info', durationMs);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
