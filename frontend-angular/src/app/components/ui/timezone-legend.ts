import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { chileSummerTimeOffsetHours } from '../../shared/timezone';

/**
 * Leyenda que explica por qué las horas de una pantalla pueden no coincidir con
 * el reloj del usuario: la plataforma declara y muestra en UTC-4 fijo, mientras
 * que Chile corre el reloj una hora entre septiembre y abril.
 *
 * La frase del desfase aparece SOLO mientras el horario de verano está vigente
 * (`chileSummerTimeOffsetHours`), así que en invierno la leyenda no afirma una
 * diferencia que no existe.
 *
 * Usar únicamente en pantallas que efectivamente renderizan en
 * `CHILE_TIME_ZONE`. En una pantalla que todavía formatea con
 * `America/Santiago` la leyenda sería falsa.
 */
@Component({
  selector: 'app-timezone-legend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      [class]="
        variant() === 'plain'
          ? 'flex items-start gap-2 text-caption-xs text-slate-500'
          : 'flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-caption text-slate-600'
      "
    >
      <!-- El tamaño va en font-size inline: la hoja de Google Fonts define
           .material-symbols-outlined con más especificidad que una utilidad de
           Tailwind, así que un text-[16px] acá no haría nada y el icono
           quedaría en 24px. -->
      <span
        class="material-symbols-outlined mt-px shrink-0 text-slate-400"
        style="font-size: 16px"
        aria-hidden="true"
        >schedule</span
      >
      <p class="leading-relaxed">
        Fechas y horas en
        <strong class="font-semibold text-slate-700"
          >hora oficial de Chile continental, UTC-4 fija y sin horario de verano</strong
        >, que es el formato en que se declara a la DGA.
        @if (summerOffset > 0) {
          <span class="text-slate-700">
            Mientras rige el horario de verano son
            {{ summerOffset }} hora{{ summerOffset === 1 ? '' : 's' }} menos que el reloj de tu
            computador.
          </span>
        }
        <span class="mt-1 block text-slate-500"> Fuente: Manual Técnico DGA 1/2025. </span>
      </p>
    </aside>
  `,
})
export class TimezoneLegendComponent {
  /** `card` (default) va en cuerpo de página; `plain` en modales angostos. */
  variant = input<'card' | 'plain'>('card');

  /**
   * Se evalúa una vez al construir: el horario de verano cambia dos veces al
   * año, no dentro de una sesión, y así el template no recalcula en cada CD.
   */
  protected readonly summerOffset = chileSummerTimeOffsetHours();
}
