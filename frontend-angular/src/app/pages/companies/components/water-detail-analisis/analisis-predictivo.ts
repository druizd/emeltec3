/**
 * Análisis — Predictivo (pendiente).
 */
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-analisis-predictivo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"
    >
      <span class="material-symbols-outlined text-[36px] text-slate-300">auto_awesome</span>
      <h3 class="text-base font-black text-slate-700">Predictivo en diseño</h3>
      <p class="max-w-md text-[13px] text-slate-500">
        Forecast de caudal, nivel freático y vencimiento de garantías. Requiere
        evaluación de modelos (regresión simple para series cortas, ARIMA / LSTM para
        históricos largos). Pendiente decisión técnica.
      </p>
    </div>
  `,
})
export class AnalisisPredictivoComponent {}
