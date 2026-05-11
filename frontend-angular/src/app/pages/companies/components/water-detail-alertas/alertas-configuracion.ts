import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Canal = 'in_app' | 'email' | 'sms';
type RolDestinatario = 'SuperAdmin' | 'Admin' | 'Gerente' | 'Cliente';

interface ReglaAlerta {
  id: string;
  variable: string;
  condicion: 'menor_que' | 'mayor_que' | 'fuera_de_rango';
  umbral: number;
  umbralMax?: number;
  unidad: string;
  activa: boolean;
  diasActivos: boolean[];
  horaDesde: string;
  horaHasta: string;
  destinatarios: RolDestinatario[];
  canales: Canal[];
  escalarA: RolDestinatario[];
  escalarMinutos: number;
}

@Component({
  selector: 'app-alertas-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">

      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-semibold text-slate-400">{{ reglas.length }} reglas configuradas</p>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[12px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[16px]">add</span>
          Nueva regla
        </button>
      </div>

      @for (regla of reglas; track regla.id) {
        <article class="rounded-2xl border bg-white shadow-sm transition-all" [class]="regla.activa ? 'border-slate-200' : 'border-slate-100 opacity-60'">
          <div class="flex items-start justify-between gap-3 px-5 py-4">

            <!-- Indicador activo + variable -->
            <div class="flex items-start gap-3">
              <button
                type="button"
                (click)="toggleRegla(regla)"
                [class]="regla.activa ? 'bg-cyan-500' : 'bg-slate-300'"
                class="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
                [attr.aria-label]="regla.activa ? 'Desactivar' : 'Activar'"
              >
                <span
                  [class]="regla.activa ? 'translate-x-4' : 'translate-x-0.5'"
                  class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                ></span>
              </button>
              <div class="min-w-0">
                <p class="font-black text-slate-800">{{ regla.variable }}</p>
                <p class="mt-0.5 text-[12px] text-slate-500">
                  {{ condicionLabel(regla.condicion) }}
                  <span class="font-mono font-bold text-slate-700">{{ regla.umbral }}{{ regla.umbralMax ? '–' + regla.umbralMax : '' }} {{ regla.unidad }}</span>
                </p>
              </div>
            </div>

            <!-- Acciones -->
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                (click)="expandirRegla(regla.id)"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                [attr.aria-label]="reglaExpandida() === regla.id ? 'Colapsar' : 'Editar'"
              >
                <span class="material-symbols-outlined text-[18px]">{{ reglaExpandida() === regla.id ? 'expand_less' : 'edit' }}</span>
              </button>
            </div>
          </div>

          <!-- Resumen cuando está colapsado -->
          @if (reglaExpandida() !== regla.id) {
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-5 py-3">
              <span class="flex items-center gap-1 text-[11px] text-slate-400">
                <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                {{ diasResumen(regla.diasActivos) }}
              </span>
              <span class="flex items-center gap-1 text-[11px] text-slate-400">
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                {{ regla.horaDesde }} – {{ regla.horaHasta }}
              </span>
              <div class="flex gap-1">
                @for (canal of regla.canales; track canal) {
                  <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{{ canalLabel(canal) }}</span>
                }
              </div>
              @if (regla.escalarA.length) {
                <span class="flex items-center gap-1 text-[11px] text-amber-600">
                  <span class="material-symbols-outlined text-[14px]">arrow_upward</span>
                  Escala en {{ regla.escalarMinutos }} min
                </span>
              }
            </div>
          }

          <!-- Detalle editable cuando está expandido -->
          @if (reglaExpandida() === regla.id) {
            <div class="space-y-4 border-t border-slate-100 px-5 py-4">

              <!-- Días activos -->
              <div>
                <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Días activos</p>
                <div class="flex gap-1.5">
                  @for (dia of diasSemana; track $index) {
                    <button
                      type="button"
                      (click)="toggleDia(regla, $index)"
                      [class]="regla.diasActivos[$index]
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                      class="h-8 w-8 rounded-lg text-[11px] font-black transition-colors"
                    >
                      {{ dia }}
                    </button>
                  }
                </div>
              </div>

              <!-- Horario -->
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div class="sm:col-span-2">
                  <p class="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Desde</p>
                  <input
                    type="time"
                    [(ngModel)]="regla.horaDesde"
                    class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-700 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <div class="sm:col-span-2">
                  <p class="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Hasta</p>
                  <input
                    type="time"
                    [(ngModel)]="regla.horaHasta"
                    class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-700 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              <!-- Destinatarios + canales -->
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Notifica a</p>
                  <div class="flex flex-wrap gap-1.5">
                    @for (rol of rolesDisponibles; track rol) {
                      <button
                        type="button"
                        (click)="toggleDestinatario(regla, rol)"
                        [class]="regla.destinatarios.includes(rol)
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                        class="rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors"
                      >
                        {{ rol }}
                      </button>
                    }
                  </div>
                </div>
                <div>
                  <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Por canal</p>
                  <div class="flex flex-wrap gap-1.5">
                    @for (canal of canalesDisponibles; track canal.key) {
                      <button
                        type="button"
                        (click)="toggleCanal(regla, canal.key)"
                        [class]="regla.canales.includes(canal.key)
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors"
                      >
                        <span class="material-symbols-outlined text-[13px]">{{ canal.icon }}</span>
                        {{ canal.label }}
                      </button>
                    }
                  </div>
                </div>
              </div>

              <!-- Escalamiento -->
              <div>
                <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Escalamiento — si nadie reconoce en
                  <input
                    type="number"
                    [(ngModel)]="regla.escalarMinutos"
                    min="5"
                    max="120"
                    class="mx-1 w-14 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-center font-mono text-sm focus:border-cyan-400 focus:outline-none"
                  />
                  min, notificar a:
                </p>
                <div class="flex flex-wrap gap-1.5">
                  @for (rol of rolesEscalamiento; track rol) {
                    <button
                      type="button"
                      (click)="toggleEscalamiento(regla, rol)"
                      [class]="regla.escalarA.includes(rol)
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                      class="rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors"
                    >
                      {{ rol }}
                    </button>
                  }
                </div>
              </div>

              <!-- Guardar -->
              <div class="flex justify-end">
                <button
                  type="button"
                  (click)="reglaExpandida.set(null)"
                  class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700"
                >
                  <span class="material-symbols-outlined text-[16px]">check</span>
                  Guardar regla
                </button>
              </div>
            </div>
          }
        </article>
      }
    </div>
  `,
})
export class AlertasConfiguracionComponent {
  readonly diasSemana = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
  readonly rolesDisponibles: RolDestinatario[] = ['SuperAdmin', 'Admin', 'Gerente', 'Cliente'];
  readonly rolesEscalamiento: RolDestinatario[] = ['SuperAdmin', 'Admin', 'Gerente'];
  readonly canalesDisponibles = [
    { key: 'in_app' as Canal, label: 'In-app', icon: 'notifications' },
    { key: 'email' as Canal, label: 'Email', icon: 'mail' },
    { key: 'sms' as Canal, label: 'SMS', icon: 'sms' },
  ];

  readonly reglaExpandida = signal<string | null>(null);

  reglas: ReglaAlerta[] = [
    {
      id: '1', variable: 'Caudal mínimo', condicion: 'menor_que', umbral: 2.0, unidad: 'L/s',
      activa: true, diasActivos: [true, true, true, true, true, false, false],
      horaDesde: '07:00', horaHasta: '19:00',
      destinatarios: ['SuperAdmin', 'Gerente'], canales: ['in_app', 'email'],
      escalarA: ['Admin'], escalarMinutos: 15,
    },
    {
      id: '2', variable: 'Nivel freático crítico', condicion: 'mayor_que', umbral: 45.0, unidad: 'm',
      activa: true, diasActivos: [true, true, true, true, true, true, true],
      horaDesde: '00:00', horaHasta: '23:59',
      destinatarios: ['SuperAdmin', 'Admin', 'Gerente', 'Cliente'], canales: ['in_app', 'email', 'sms'],
      escalarA: ['Admin', 'SuperAdmin'], escalarMinutos: 10,
    },
    {
      id: '3', variable: 'Sin comunicación', condicion: 'mayor_que', umbral: 60, unidad: 'min',
      activa: false, diasActivos: [true, true, true, true, true, false, false],
      horaDesde: '08:00', horaHasta: '18:00',
      destinatarios: ['SuperAdmin'], canales: ['in_app'],
      escalarA: [], escalarMinutos: 30,
    },
  ];

  toggleRegla(regla: ReglaAlerta): void {
    regla.activa = !regla.activa;
  }

  expandirRegla(id: string): void {
    this.reglaExpandida.set(this.reglaExpandida() === id ? null : id);
  }

  toggleDia(regla: ReglaAlerta, index: number): void {
    regla.diasActivos[index] = !regla.diasActivos[index];
  }

  toggleDestinatario(regla: ReglaAlerta, rol: RolDestinatario): void {
    const idx = regla.destinatarios.indexOf(rol);
    if (idx >= 0) regla.destinatarios.splice(idx, 1);
    else regla.destinatarios.push(rol);
  }

  toggleCanal(regla: ReglaAlerta, canal: Canal): void {
    const idx = regla.canales.indexOf(canal);
    if (idx >= 0) regla.canales.splice(idx, 1);
    else regla.canales.push(canal);
  }

  toggleEscalamiento(regla: ReglaAlerta, rol: RolDestinatario): void {
    const idx = regla.escalarA.indexOf(rol);
    if (idx >= 0) regla.escalarA.splice(idx, 1);
    else regla.escalarA.push(rol);
  }

  condicionLabel(c: ReglaAlerta['condicion']): string {
    return c === 'menor_que' ? 'Menor que' : c === 'mayor_que' ? 'Mayor que' : 'Fuera del rango';
  }

  canalLabel(c: Canal): string {
    return c === 'in_app' ? 'In-app' : c === 'email' ? 'Email' : 'SMS';
  }

  diasResumen(dias: boolean[]): string {
    const nombres = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
    const activos = nombres.filter((_, i) => dias[i]);
    if (activos.length === 7) return 'Todos los días';
    if (activos.length === 5 && !dias[5] && !dias[6]) return 'Lunes a viernes';
    if (activos.length === 2 && dias[5] && dias[6]) return 'Fines de semana';
    return activos.join(', ');
  }
}
