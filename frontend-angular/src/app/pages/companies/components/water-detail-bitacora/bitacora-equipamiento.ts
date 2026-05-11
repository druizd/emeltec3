import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

type EquipoEstado = 'operativo' | 'en_mantencion' | 'fuera_de_servicio';

interface Equipo {
  id: string;
  nombre: string;
  modelo: string;
  fabricante: string;
  serie: string;
  fechaCompra: string;
  garantiaHasta: string;
  estado: EquipoEstado;
}

@Component({
  selector: 'app-bitacora-equipamiento',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-semibold text-slate-400">{{ equipos.length }} equipos registrados</p>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[12px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[16px]">add</span>
          Registrar equipo
        </button>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Equipo</th>
                <th class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Fabricante / Modelo</th>
                <th class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">N° Serie</th>
                <th class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Compra</th>
                <th class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Garantía</th>
                <th class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Estado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (eq of equipos; track eq.id) {
                <tr class="group hover:bg-slate-50/60">
                  <td class="px-4 py-3 font-semibold text-slate-800">{{ eq.nombre }}</td>
                  <td class="px-4 py-3 text-slate-600">
                    <span class="font-semibold">{{ eq.fabricante }}</span>
                    <span class="block text-[11px] text-slate-400">{{ eq.modelo }}</span>
                  </td>
                  <td class="px-4 py-3 font-mono text-[12px] text-slate-600">{{ eq.serie }}</td>
                  <td class="px-4 py-3 font-mono text-[12px] text-slate-600">{{ eq.fechaCompra }}</td>
                  <td class="px-4 py-3">
                    <span [class]="garantiaClass(eq.garantiaHasta)" class="font-mono text-[12px]">
                      {{ eq.garantiaHasta }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span [class]="estadoClass(eq.estado)" class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold">
                      <span [class]="estadoDotClass(eq.estado)" class="h-1.5 w-1.5 rounded-full"></span>
                      {{ estadoLabel(eq.estado) }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

    </div>
  `,
})
export class BitacoraEquipamientoComponent {
  readonly equipos: Equipo[] = [
    { id: '1', nombre: 'Bomba sumergible principal', modelo: 'SP17-10N', fabricante: 'Grundfos', serie: 'GF-2021-0047', fechaCompra: '15/03/2021', garantiaHasta: '15/03/2024', estado: 'operativo' },
    { id: '2', nombre: 'Sensor de nivel freático', modelo: 'VEGAPULS 64', fabricante: 'VEGA', serie: 'VP64-2023-A892', fechaCompra: '08/06/2023', garantiaHasta: '08/06/2025', estado: 'operativo' },
    { id: '3', nombre: 'Caudalímetro electromagnético', modelo: 'MAG 5100W', fabricante: 'Endress+Hauser', serie: 'EH-2022-0311', fechaCompra: '22/11/2022', garantiaHasta: '22/11/2024', estado: 'en_mantencion' },
    { id: '4', nombre: 'Panel de control PLC', modelo: 'XG5000-S', fabricante: 'LS Electric', serie: 'LS-2020-1102', fechaCompra: '10/01/2020', garantiaHasta: '10/01/2022', estado: 'operativo' },
    { id: '5', nombre: 'UPS de respaldo 3kVA', modelo: 'Smart-UPS 3000', fabricante: 'APC', serie: 'APC-2023-5578', fechaCompra: '05/09/2023', garantiaHasta: '05/09/2026', estado: 'operativo' },
  ];

  private diasParaVencimientoGarantia(fecha: string): number {
    const partes = fecha.split('/');
    const d = new Date(+partes[2], +partes[1] - 1, +partes[0]);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  }

  garantiaClass(fecha: string): string {
    const dias = this.diasParaVencimientoGarantia(fecha);
    if (dias < 0) return 'text-slate-400 line-through';
    if (dias <= 90) return 'text-amber-600 font-semibold';
    return 'text-slate-600';
  }

  estadoLabel(estado: EquipoEstado): string {
    const map: Record<EquipoEstado, string> = {
      operativo: 'Operativo', en_mantencion: 'En mantención', fuera_de_servicio: 'Fuera de servicio',
    };
    return map[estado];
  }

  estadoClass(estado: EquipoEstado): string {
    const map: Record<EquipoEstado, string> = {
      operativo: 'bg-emerald-50 text-emerald-600',
      en_mantencion: 'bg-amber-50 text-amber-600',
      fuera_de_servicio: 'bg-rose-50 text-rose-600',
    };
    return map[estado];
  }

  estadoDotClass(estado: EquipoEstado): string {
    const map: Record<EquipoEstado, string> = {
      operativo: 'bg-emerald-500', en_mantencion: 'bg-amber-500', fuera_de_servicio: 'bg-rose-500',
    };
    return map[estado];
  }
}
