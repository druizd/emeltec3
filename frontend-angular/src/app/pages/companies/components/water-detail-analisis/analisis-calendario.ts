import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type EventoTipo = 'mantencion' | 'vencimiento_dga' | 'vencimiento_contrato' | 'vencimiento_acreditacion' | 'reunion';

interface EventoCalendario {
  id: string;
  titulo: string;
  tipo: EventoTipo;
  fecha: string;
  hora?: string;
  descripcion?: string;
}

@Component({
  selector: 'app-analisis-calendario',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- Controles de semana -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button type="button" (click)="semanaAnterior()" class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <span class="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
          <span class="min-w-[180px] text-center text-sm font-black text-slate-800">{{ tituloSemana() }}</span>
          <button type="button" (click)="semanaSiguiente()" class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <span class="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
          <button type="button" (click)="irHoy()" class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
            Hoy
          </button>
        </div>
        <button type="button" class="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] font-bold text-violet-700 hover:bg-violet-100">
          <span class="material-symbols-outlined text-[16px]">calendar_add_on</span>
          Exportar .ics
        </button>
      </div>

      <!-- Vista semana -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <!-- Header días -->
        <div class="grid grid-cols-7 border-b border-slate-100">
          @for (dia of diasSemana(); track dia.fecha) {
            <div class="px-2 py-3 text-center" [class]="dia.esHoy ? 'bg-cyan-50' : ''">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ dia.nombreCorto }}</p>
              <p class="mt-0.5 text-lg font-black" [class]="dia.esHoy ? 'text-cyan-700' : 'text-slate-700'">
                {{ dia.numeroDia }}
              </p>
              @if (dia.esHoy) {
                <span class="mx-auto mt-0.5 block h-1.5 w-1.5 rounded-full bg-cyan-500"></span>
              }
            </div>
          }
        </div>

        <!-- Cuerpo: eventos por día -->
        <div class="grid grid-cols-7 min-h-[220px] divide-x divide-slate-100">
          @for (dia of diasSemana(); track dia.fecha) {
            <div class="p-1.5 space-y-1" [class]="dia.esHoy ? 'bg-cyan-50/40' : ''">
              @for (evento of eventosDelDia(dia.fecha); track evento.id) {
                <div [class]="eventoClass(evento.tipo)" class="rounded-lg px-2 py-1.5 cursor-pointer hover:opacity-90 transition-opacity">
                  <p class="text-[10px] font-black leading-tight truncate">{{ evento.titulo }}</p>
                  @if (evento.hora) {
                    <p class="text-[9px] mt-0.5 opacity-80">{{ evento.hora }}</p>
                  }
                </div>
              }
            </div>
          }
        </div>
      </section>

      <!-- Próximos eventos (lista) -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <span class="material-symbols-outlined text-[16px]">event_upcoming</span>
          Próximos 30 días
        </h3>
        <div class="space-y-2">
          @for (evento of proximosEventos(); track evento.id) {
            <div class="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <span [class]="eventoIconClass(evento.tipo)" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <span class="material-symbols-outlined text-[16px]">{{ eventoIcon(evento.tipo) }}</span>
              </span>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-slate-800 text-sm">{{ evento.titulo }}</p>
                @if (evento.descripcion) {
                  <p class="text-[11px] text-slate-400">{{ evento.descripcion }}</p>
                }
              </div>
              <div class="shrink-0 text-right">
                <p class="font-mono text-[12px] font-bold text-slate-600">{{ evento.fecha }}</p>
                @if (evento.hora) {
                  <p class="text-[11px] text-slate-400">{{ evento.hora }}</p>
                }
              </div>
            </div>
          } @empty {
            <p class="text-sm text-slate-400 text-center py-4">Sin eventos próximos</p>
          }
        </div>
        <div class="mt-4 flex justify-end">
          <button type="button" class="inline-flex items-center gap-1 text-[12px] font-bold text-violet-700 hover:underline">
            <span class="material-symbols-outlined text-[14px]">mail</span>
            Enviar al correo
          </button>
        </div>
      </section>

      <!-- Leyenda -->
      <div class="flex flex-wrap gap-3">
        @for (tipo of tiposEvento; track tipo.key) {
          <span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span [class]="tipo.dotClass" class="h-2.5 w-2.5 rounded-sm"></span>
            {{ tipo.label }}
          </span>
        }
      </div>

    </div>
  `,
})
export class AnalisisCalendarioComponent {
  private readonly HOY = new Date(2026, 4, 6); // 06/05/2026 (mock)
  private readonly semanaOffset = signal(0);

  readonly tiposEvento = [
    { key: 'mantencion', label: 'Mantención', dotClass: 'bg-cyan-500 rounded' },
    { key: 'vencimiento_dga', label: 'Vencimiento DGA', dotClass: 'bg-rose-400 rounded' },
    { key: 'reunion', label: 'Reunión', dotClass: 'bg-violet-400 rounded' },
    { key: 'vencimiento_contrato', label: 'Vencimiento contrato', dotClass: 'bg-amber-400 rounded' },
    { key: 'vencimiento_acreditacion', label: 'Acreditación', dotClass: 'bg-slate-400 rounded' },
  ];

  readonly eventos: EventoCalendario[] = [
    { id: '1', titulo: 'Mantención mensual', tipo: 'mantencion', fecha: '2026-05-08', hora: '09:00', descripcion: 'Revisión preventiva sensores y bomba' },
    { id: '2', titulo: 'Reunión de seguimiento', tipo: 'reunion', fecha: '2026-05-09', hora: '10:30', descripcion: 'Revisión operacional con cliente' },
    { id: '3', titulo: 'Vencimiento DGA — May', tipo: 'vencimiento_dga', fecha: '2026-05-10', descripcion: 'Envío reporte mensual a DGA' },
    { id: '4', titulo: 'Cert. calibración vence', tipo: 'vencimiento_acreditacion', fecha: '2026-05-14', descripcion: 'Caudalímetro MAG 5100W' },
    { id: '5', titulo: 'Mantención bomba', tipo: 'mantencion', fecha: '2026-05-20', hora: '08:00', descripcion: 'Cambio filtro + calibración caudal' },
    { id: '6', titulo: 'Contrato vence', tipo: 'vencimiento_contrato', fecha: '2026-09-15', descripcion: 'Renovar antes de agosto' },
  ];

  readonly diasSemana = computed(() => {
    const offset = this.semanaOffset();
    const lunes = new Date(this.HOY);
    const dia = lunes.getDay() === 0 ? 6 : lunes.getDay() - 1;
    lunes.setDate(lunes.getDate() - dia + offset * 7);
    const nombres = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      return {
        fecha: d.toISOString().slice(0, 10),
        nombreCorto: nombres[i],
        numeroDia: d.getDate(),
        esHoy: d.toDateString() === this.HOY.toDateString(),
      };
    });
  });

  readonly tituloSemana = computed(() => {
    const dias = this.diasSemana();
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    const desde = new Date(dias[0].fecha).toLocaleDateString('es-CL', opts);
    const hasta = new Date(dias[6].fecha).toLocaleDateString('es-CL', opts);
    return `${desde} — ${hasta}`;
  });

  readonly proximosEventos = computed(() => {
    const hoy = this.HOY.toISOString().slice(0, 10);
    const limite = new Date(this.HOY);
    limite.setDate(limite.getDate() + 30);
    const limStr = limite.toISOString().slice(0, 10);
    return this.eventos
      .filter((e) => e.fecha >= hoy && e.fecha <= limStr)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  eventosDelDia(fecha: string): EventoCalendario[] {
    return this.eventos.filter((e) => e.fecha === fecha);
  }

  semanaAnterior(): void { this.semanaOffset.update((v) => v - 1); }
  semanaSiguiente(): void { this.semanaOffset.update((v) => v + 1); }
  irHoy(): void { this.semanaOffset.set(0); }

  eventoClass(tipo: EventoTipo): string {
    const map: Record<EventoTipo, string> = {
      mantencion: 'bg-cyan-100 text-cyan-800',
      vencimiento_dga: 'bg-rose-100 text-rose-800',
      vencimiento_contrato: 'bg-amber-100 text-amber-800',
      vencimiento_acreditacion: 'bg-slate-200 text-slate-700',
      reunion: 'bg-violet-100 text-violet-800',
    };
    return map[tipo];
  }

  eventoIcon(tipo: EventoTipo): string {
    const map: Record<EventoTipo, string> = {
      mantencion: 'build', vencimiento_dga: 'shield', vencimiento_contrato: 'contract',
      vencimiento_acreditacion: 'verified_user', reunion: 'groups',
    };
    return map[tipo];
  }

  eventoIconClass(tipo: EventoTipo): string {
    const map: Record<EventoTipo, string> = {
      mantencion: 'bg-cyan-50 text-cyan-600', vencimiento_dga: 'bg-rose-50 text-rose-600',
      vencimiento_contrato: 'bg-amber-50 text-amber-600', vencimiento_acreditacion: 'bg-slate-100 text-slate-600',
      reunion: 'bg-violet-50 text-violet-600',
    };
    return map[tipo];
  }
}
