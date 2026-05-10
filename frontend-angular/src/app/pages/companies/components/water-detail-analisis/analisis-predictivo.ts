import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-analisis-predictivo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- Banner "próximamente" -->
      <div class="relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-6 shadow-sm">
        <div class="relative z-10">
          <div class="flex items-center gap-3">
            <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
              <span class="material-symbols-outlined text-[28px]">psychology</span>
            </span>
            <div>
              <p class="text-[10px] font-black uppercase tracking-widest text-violet-400">Próximamente</p>
              <h2 class="text-xl font-black text-violet-900">Análisis predictivo con IA</h2>
            </div>
          </div>
          <p class="mt-4 text-[14px] text-violet-700 leading-relaxed max-w-xl">
            Emeltec Cloud incorporará modelos de predicción entrenados con el historial de cada sitio para anticipar fallas, optimizar mantenciones y proyectar consumos antes de que ocurran.
          </p>
          <div class="mt-5 flex flex-wrap gap-2">
            <button type="button" class="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-violet-700 transition-colors">
              <span class="material-symbols-outlined text-[16px]">notifications</span>
              Notificarme cuando esté disponible
            </button>
            <button type="button" class="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-[13px] font-bold text-violet-700 hover:bg-violet-50 transition-colors">
              <span class="material-symbols-outlined text-[16px]">open_in_new</span>
              Ver roadmap
            </button>
          </div>
        </div>
        <!-- Decoración -->
        <div class="pointer-events-none absolute right-0 top-0 h-full w-64 opacity-10">
          <span class="material-symbols-outlined absolute right-4 top-4 text-[120px] text-violet-600">auto_graph</span>
        </div>
      </div>

      <!-- Preview de capacidades -->
      <h3 class="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Lo que estamos construyendo</h3>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        @for (cap of capacidades; track cap.titulo) {
          <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-500">
              <span class="material-symbols-outlined text-[20px]">{{ cap.icon }}</span>
            </span>
            <p class="mt-3 font-black text-slate-800 text-sm">{{ cap.titulo }}</p>
            <p class="mt-0.5 text-[12px] text-slate-400 leading-relaxed">{{ cap.descripcion }}</p>
            <div class="mt-3">
              <div class="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-violet-300" [style.width]="cap.progreso + '%'"></div>
              </div>
              <p class="mt-1 text-[10px] text-slate-400">{{ cap.progreso }}% completado</p>
            </div>
          </div>
        }
      </div>

      <!-- Simulación de predicción (mockup visual) -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center gap-2">
          <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">Vista previa — predicción de nivel freático</h3>
          <span class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-600">Demo</span>
        </div>

        <!-- Gráfico placeholder -->
        <div class="relative h-40 w-full overflow-hidden rounded-xl bg-slate-50">
          <svg viewBox="0 0 600 160" class="h-full w-full" preserveAspectRatio="none">
            <!-- Eje X -->
            <line x1="0" y1="150" x2="600" y2="150" stroke="#e2e8f0" stroke-width="1"/>

            <!-- Datos históricos (trazo sólido teal) -->
            <polyline
              points="0,90 60,85 120,80 180,88 240,92 300,78 360,82"
              fill="none"
              stroke="#0DAFBD"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />

            <!-- Zona predicción (relleno semitransparente) -->
            <polygon
              points="360,65 420,58 480,50 540,62 600,55 600,105 540,100 480,95 420,100 360,95"
              fill="rgba(139,92,246,0.08)"
            />

            <!-- Línea predicción (discontinua violet) -->
            <polyline
              points="360,82 420,75 480,68 540,78 600,72"
              fill="none"
              stroke="#7C3AED"
              stroke-width="2"
              stroke-dasharray="6 3"
              stroke-linecap="round"
            />

            <!-- Separador histórico/predicción -->
            <line x1="360" y1="10" x2="360" y2="150" stroke="#c4b5fd" stroke-width="1" stroke-dasharray="4 3"/>

            <!-- Etiquetas -->
            <text x="170" y="20" fill="#94a3b8" font-size="10" font-family="monospace" text-anchor="middle">Histórico</text>
            <text x="480" y="20" fill="#7c3aed" font-size="10" font-family="monospace" text-anchor="middle">Predicción IA</text>
          </svg>

          <!-- Blur overlay indicando que es simulación -->
          <div class="absolute inset-0 flex items-center justify-center backdrop-blur-[1px]">
            <div class="flex items-center gap-2 rounded-xl border border-violet-200 bg-white/90 px-4 py-2 shadow-sm">
              <span class="material-symbols-outlined text-[16px] text-violet-500">lock</span>
              <p class="text-[12px] font-bold text-violet-700">Disponible en la próxima versión</p>
            </div>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-0.5 w-5 rounded-full bg-cyan-500"></span>
            Datos históricos reales
          </span>
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-0.5 w-5 rounded-full border-t-2 border-dashed border-violet-500"></span>
            Proyección predictiva
          </span>
        </div>
      </section>

    </div>
  `,
})
export class AnalisisPredictivoComponent {
  readonly capacidades = [
    { titulo: 'Predicción de nivel freático', descripcion: 'Proyección a 30 días basada en histórico de extracción, lluvia y estación.', icon: 'water_drop', progreso: 70 },
    { titulo: 'Detección de anomalías', descripcion: 'Identifica comportamientos fuera del patrón antes de que disparen alertas.', icon: 'troubleshoot', progreso: 55 },
    { titulo: 'Mantenimiento predictivo', descripcion: 'Estima cuándo una bomba o sensor necesitará mantenimiento según desgaste.', icon: 'build', progreso: 35 },
    { titulo: 'Optimización de caudal', descripcion: 'Sugiere ajustes de operación para reducir consumo energético.', icon: 'speed', progreso: 20 },
    { titulo: 'Pronóstico de vencimientos', descripcion: 'Anticipa riesgos de vencimiento de DGA, contratos y acreditaciones.', icon: 'event_busy', progreso: 80 },
    { titulo: 'Informe automático narrativo', descripcion: 'Genera resúmenes en lenguaje natural para el cliente final.', icon: 'description', progreso: 40 },
  ];
}
