import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../../services/auth.service';

interface ContactoTecnico {
  nombre: string;
  rol: 'Responsable' | 'Operador';
  telefono: string;
  email: string;
}

interface Acreditacion {
  persona: string;
  tipo: string;
  vigenciaHasta: string;
  vencida: boolean;
}

interface RiesgoItem {
  descripcion: string;
  probabilidad: number;
  impacto: number;
  mitigacion: string;
}

@Component({
  selector: 'app-bitacora-ficha-sitio',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <!-- Pin crítico -->
      @if (pinCritico()) {
        <div
          class="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <span class="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-amber-600"
            >warning</span
          >
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-black uppercase tracking-widest text-amber-600">Atención</p>
            <p class="mt-0.5 text-sm font-semibold text-amber-800">{{ pinCritico() }}</p>
          </div>
          @if (isInternal()) {
            <button
              type="button"
              class="shrink-0 text-amber-400 hover:text-amber-700"
              aria-label="Editar pin crítico"
            >
              <span class="material-symbols-outlined text-[18px]">edit</span>
            </button>
          }
        </div>
      }

      <div class="grid gap-3 xl:grid-cols-2">
        <!-- Operativo -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3
            class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
          >
            <span class="material-symbols-outlined text-[16px]">location_on</span>
            Ubicación y accesos
          </h3>
          <dl class="space-y-3">
            <div>
              <dt class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Dirección
              </dt>
              <dd class="mt-0.5 text-sm font-semibold text-slate-700">{{ ficha.direccion }}</dd>
            </div>
            <div>
              <dt class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Coordenadas
              </dt>
              <dd class="mt-0.5 font-mono text-sm text-slate-700">
                {{ ficha.latitud }}, {{ ficha.longitud }}
              </dd>
            </div>
            <div>
              <dt class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Acceso
              </dt>
              <dd class="mt-0.5 text-sm text-slate-700">{{ ficha.acceso }}</dd>
            </div>
            <div>
              <dt class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Horario disponible
              </dt>
              <dd class="mt-0.5 text-sm text-slate-700">{{ ficha.horario }}</dd>
            </div>
          </dl>
        </section>

        <!-- Contactos técnicos -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3
            class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
          >
            <span class="material-symbols-outlined text-[16px]">contacts</span>
            Contactos técnicos
          </h3>
          <div class="space-y-3">
            @for (contacto of contactos; track contacto.email) {
              <div
                class="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[13px] font-black text-cyan-700"
                >
                  {{ iniciales(contacto.nombre) }}
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-black text-slate-800">{{ contacto.nombre }}</p>
                  <p class="text-[11px] font-semibold text-slate-400">{{ contacto.rol }}</p>
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span>{{ contacto.telefono }}</span>
                    <span>{{ contacto.email }}</span>
                  </div>
                </div>
              </div>
            }
          </div>
        </section>
      </div>

      <!-- Acreditaciones -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3
          class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
        >
          <span class="material-symbols-outlined text-[16px]">verified_user</span>
          Personal acreditado para acceder
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Persona
                </th>
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Acreditación
                </th>
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Válida hasta
                </th>
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Estado
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (acr of acreditaciones; track acr.persona + acr.tipo) {
                <tr class="hover:bg-slate-50/60">
                  <td class="px-3 py-2.5 font-semibold text-slate-800">{{ acr.persona }}</td>
                  <td class="px-3 py-2.5 text-slate-600">{{ acr.tipo }}</td>
                  <td class="px-3 py-2.5 font-mono text-slate-600">{{ acr.vigenciaHasta }}</td>
                  <td class="px-3 py-2.5">
                    @if (acr.vencida) {
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600"
                      >
                        <span class="h-1.5 w-1.5 rounded-full bg-rose-500"></span>Vencida
                      </span>
                    } @else {
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600"
                      >
                        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>Vigente
                      </span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Matriz de riesgo -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3
          class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
        >
          <span class="material-symbols-outlined text-[16px]">health_and_safety</span>
          Matriz de riesgo del sitio
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Riesgo
                </th>
                <th
                  class="px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Prob.
                </th>
                <th
                  class="px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Impacto
                </th>
                <th
                  class="px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Score
                </th>
                <th
                  class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Mitigación
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (riesgo of riesgos; track riesgo.descripcion) {
                <tr class="hover:bg-slate-50/60">
                  <td class="px-3 py-2.5 font-semibold text-slate-800">{{ riesgo.descripcion }}</td>
                  <td class="px-3 py-2.5 text-center font-mono text-slate-600">
                    {{ riesgo.probabilidad }}
                  </td>
                  <td class="px-3 py-2.5 text-center font-mono text-slate-600">
                    {{ riesgo.impacto }}
                  </td>
                  <td class="px-3 py-2.5 text-center">
                    <span
                      [class]="scoreClass(riesgo.probabilidad * riesgo.impacto)"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-black"
                    >
                      {{ riesgo.probabilidad * riesgo.impacto }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-[12px] text-slate-500">{{ riesgo.mitigacion }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-[11px] text-slate-400">
          Score 1–5: verde · 6–12: amarillo · 13–25: rojo
        </p>
      </section>

      <!-- Vencimiento de contrato (visible para todos) -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3
          class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"
        >
          <span class="material-symbols-outlined text-[16px]">contract</span>
          Contrato
        </h3>
        <div class="flex items-center gap-4">
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Vencimiento
            </p>
            <p class="mt-0.5 text-xl font-black text-slate-800">{{ ficha.vencimientoContrato }}</p>
          </div>
          <span
            [class]="contratoBadgeClass()"
            class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          >
            <span class="h-1.5 w-1.5 rounded-full" [class]="contratoDotClass()"></span>
            {{ contratoLabel() }}
          </span>
        </div>
      </section>
    </div>
  `,
})
export class BitacoraFichaSitioComponent {
  private auth = inject(AuthService);

  readonly isInternal = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly pinCritico = signal(
    'Acceso solo con llave del encargado Sr. Rojas. Llamar al +56 9 8123 4567 antes de visitar.',
  );

  readonly ficha = {
    direccion: 'Camino Los Álamos 1240, Sector Industrial, Colina, RM',
    latitud: '-33.2041',
    longitud: '-70.6693',
    acceso: 'Portón azul lateral. Llave en administración de la planta.',
    horario: 'Lunes a viernes 08:00–18:00. Fines de semana con coordinación previa.',
    vencimientoContrato: '15/09/2026',
  };

  readonly contactos: ContactoTecnico[] = [
    {
      nombre: 'Carlos Rojas Vega',
      rol: 'Responsable',
      telefono: '+56 9 8123 4567',
      email: 'c.rojas@clienteejemplo.cl',
    },
    {
      nombre: 'Ana Muñoz Soto',
      rol: 'Operador',
      telefono: '+56 9 7654 3210',
      email: 'a.munoz@clienteejemplo.cl',
    },
  ];

  readonly acreditaciones: Acreditacion[] = [
    {
      persona: 'Luis Pérez (Emeltec)',
      tipo: 'Curso seguridad industrial',
      vigenciaHasta: '30/06/2026',
      vencida: false,
    },
    {
      persona: 'María Torres (Emeltec)',
      tipo: 'Curso seguridad industrial',
      vigenciaHasta: '28/02/2025',
      vencida: true,
    },
    {
      persona: 'Carlos Rojas (Cliente)',
      tipo: 'Inducción del sitio',
      vigenciaHasta: '31/12/2026',
      vencida: false,
    },
  ];

  readonly riesgos: RiesgoItem[] = [
    {
      descripcion: 'Caída en zona húmeda',
      probabilidad: 3,
      impacto: 4,
      mitigacion: 'Antideslizante + señalética. EPP obligatorio.',
    },
    {
      descripcion: 'Corte eléctrico en tablero',
      probabilidad: 2,
      impacto: 5,
      mitigacion: 'Lockout/tagout antes de intervenir.',
    },
    {
      descripcion: 'Exposición a gases',
      probabilidad: 1,
      impacto: 3,
      mitigacion: 'Medición previa con detector. Ventilación forzada.',
    },
    {
      descripcion: 'Falla del sensor de nivel',
      probabilidad: 4,
      impacto: 3,
      mitigacion: 'Revisión mensual. Sensor de respaldo instalado.',
    },
  ];

  iniciales(nombre: string): string {
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  }

  scoreClass(score: number): string {
    if (score >= 13) return 'bg-rose-100 text-rose-700';
    if (score >= 6) return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  }

  private diasParaVencimiento(): number {
    const partes = this.ficha.vencimientoContrato.split('/');
    const fecha = new Date(+partes[2], +partes[1] - 1, +partes[0]);
    return Math.ceil((fecha.getTime() - Date.now()) / 86400000);
  }

  contratoLabel(): string {
    const dias = this.diasParaVencimiento();
    if (dias < 0) return 'Vencido';
    if (dias <= 30) return `Vence en ${dias} días`;
    return `Vigente (${dias} días)`;
  }

  contratoBadgeClass(): string {
    const dias = this.diasParaVencimiento();
    if (dias < 0) return 'bg-rose-50 text-rose-700';
    if (dias <= 30) return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
  }

  contratoDotClass(): string {
    const dias = this.diasParaVencimiento();
    if (dias < 0) return 'bg-rose-500';
    if (dias <= 30) return 'bg-amber-500';
    return 'bg-emerald-500';
  }
}
