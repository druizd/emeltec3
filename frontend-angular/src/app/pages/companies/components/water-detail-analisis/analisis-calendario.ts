/**
 * Análisis — Calendario de eventos (pendiente).
 */
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-analisis-calendario',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"
    >
      <span class="material-symbols-outlined text-[36px] text-slate-300">calendar_month</span>
      <h3 class="text-base font-black text-slate-700">Calendario en construcción</h3>
      <p class="max-w-md text-[13px] text-slate-500">
        Consolidará en un solo timeline: envíos DGA, alertas disparadas, mantenciones e
        incidencias. Pendiente definir prioridades de fuentes y agrupación.
      </p>
      <p class="text-[11px] italic text-slate-400">
        Mientras tanto, cada fuente está disponible por separado en Bitácora.
      </p>
    </div>
  `,
})
export class AnalisisCalendarioComponent {}
