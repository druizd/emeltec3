/**
 * Análisis — Sugerencias automáticas (pendiente).
 */
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-analisis-sugerencias',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"
    >
      <span class="material-symbols-outlined text-[36px] text-slate-300">lightbulb</span>
      <h3 class="text-base font-black text-slate-700">Sugerencias en diseño</h3>
      <p class="max-w-md text-[13px] text-slate-500">
        Motor de recomendaciones (mantenciones preventivas, optimización energética,
        ajustes de operación). Requiere definir reglas de negocio o entrenar modelo
        sobre histórico del sitio.
      </p>
    </div>
  `,
})
export class AnalisisSugerenciasComponent {}
