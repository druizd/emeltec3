import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'alerta';

/** Severidad de una alerta de sitio; define el color del toast. */
export type ToastSeveridad = 'baja' | 'media' | 'alta' | 'critica';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  /** Encabezado opcional (nombre de la regla, sitio…). */
  title?: string;
  severidad?: ToastSeveridad;
  /** Si viene, el toast es clickeable y navega al detalle. */
  onClick?: () => void;
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

  private push(message: string, type: ToastType, durationMs: number, extra: Partial<Toast> = {}): void {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { id, type, message, ...extra }]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  /**
   * Popup de alerta de sitio. Dura más que un toast normal y no se auto-cierra
   * si es crítica: una alarma crítica no puede desaparecer sola mientras el
   * operador mira otra pestaña del navegador.
   */
  alerta(opts: {
    title: string;
    message: string;
    severidad: ToastSeveridad;
    onClick?: () => void;
  }): void {
    const duracion = opts.severidad === 'critica' ? 0 : 12_000;
    this.push(opts.message, 'alerta', duracion, {
      title: opts.title,
      severidad: opts.severidad,
      onClick: opts.onClick,
    });
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
