/**
 * Bitácora — Ficha del sitio.
 * Conectado a /api/v2/sites/:siteId/bitacora/ficha.
 *
 * Vista admin: editable (contactos, acreditaciones, riesgos, pin crítico).
 * Vista cliente: solo lectura.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import type { OperationalContact, User } from '@emeltec/shared';
import { AuthService } from '../../../../services/auth.service';
import { CompanyService } from '../../../../services/company.service';
import { UserService } from '../../../../services/user.service';
import {
  BitacoraSitioService,
  type FichaAcreditacion,
  type FichaContacto,
  type FichaRiesgo,
  type FichaSitio,
} from '../../../../services/bitacora-sitio.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../../../components/ui/confirm-dialog';

@Component({
  selector: 'app-bitacora-ficha-sitio',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  template: `
    <div class="space-y-3">
      <!-- Pin crítico -->
      @if (isInternal() || ficha().pin_critico) {
        <div
          class="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <span class="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-amber-600"
            >warning</span
          >
          <div class="min-w-0 flex-1">
            <p class="text-caption-xs font-semibold uppercase tracking-widest text-amber-600">
              Atención
            </p>
            @if (isInternal()) {
              <input
                type="text"
                [ngModel]="ficha().pin_critico"
                (ngModelChange)="updatePin($event)"
                placeholder="Mensaje crítico (ej. Acceso requiere permiso DGA)"
                aria-label="Mensaje crítico del sitio"
                class="mt-0.5 w-full bg-transparent text-body-sm font-semibold text-amber-900 placeholder:text-amber-400 focus:outline-none"
              />
            } @else {
              <p class="mt-0.5 text-body-sm font-semibold text-amber-900">
                {{ ficha().pin_critico }}
              </p>
            }
          </div>
        </div>
      }

      <div class="grid gap-3 xl:grid-cols-2">
        <!-- Contactos -->
        <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Contactos técnicos
            </h3>
            @if (isInternal()) {
              <button
                type="button"
                (click)="addContacto()"
                title="Agregar contacto manual"
                aria-label="Agregar contacto manual"
                class="rounded p-1 text-primary-container transition-colors hover:bg-primary-tint-08 active:scale-95"
              >
                <span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
              </button>
            }
          </div>

          <!-- Dropdown agregar desde agenda + equipo Emeltec. El value usa
               prefijo c: para OperationalContact y u: para User para
               distinguir el origen en el handler. -->
          @if (isInternal() && availableContacts().length + availableUsuariosCliente().length > 0) {
            <div class="mb-3 flex items-center gap-2">
              <!-- Usamos (change) + template ref en lugar de [(ngModel)] para
                   evitar race condition de Angular signal vs DOM: después de
                   agregar, reseteamos el value directamente en el elemento. -->
              <select
                #pickerEl
                (change)="onContactoPickerChange(pickerEl)"
                class="flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-caption text-slate-700 outline-none focus:border-primary-tint-35"
              >
                <option value="">+ Agregar desde agenda…</option>
                @if (availableContacts().length > 0) {
                  <optgroup label="Agenda del sitio">
                    @for (c of availableContacts(); track c.id) {
                      <option [value]="'c:' + c.id">
                        {{ c.nombre }}{{ c.apellido ? ' ' + c.apellido : '' }}
                        @if (c.cargo) {
                          · {{ c.cargo }}
                        }
                      </option>
                    }
                  </optgroup>
                }
                @if (availableUsuariosCliente().length > 0) {
                  <optgroup label="Usuarios de la planta">
                    @for (u of availableUsuariosCliente(); track u.id) {
                      <option [value]="'u:' + u.id">
                        {{ u.nombre }}{{ u.apellido ? ' ' + u.apellido : '' }} · {{ u.tipo }}
                      </option>
                    }
                  </optgroup>
                }
              </select>
            </div>
          }
          @if (ficha().contactos.length === 0) {
            <p class="text-caption italic text-slate-500">Sin contactos registrados.</p>
          } @else {
            <ul class="space-y-2">
              @for (c of ficha().contactos; track $index) {
                <li class="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                  @if (isInternal() && editingContactoIdx() === $index) {
                    <div class="grid grid-cols-2 gap-2 text-caption">
                      <input
                        type="text"
                        maxlength="40"
                        [ngModel]="c.nombre"
                        (ngModelChange)="updateContacto($index, 'nombre', $event)"
                        placeholder="Nombre"
                        aria-label="Nombre del contacto"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-primary-tint-35"
                      />
                      <select
                        [ngModel]="c.rol"
                        (ngModelChange)="updateContacto($index, 'rol', $event)"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-primary-tint-35"
                      >
                        <option value="Responsable">Responsable</option>
                        <option value="Operador">Operador</option>
                      </select>
                      <div
                        class="flex items-stretch overflow-hidden rounded border border-slate-200 focus-within:border-primary-tint-35"
                      >
                        <span
                          class="flex items-center bg-slate-100 px-2 font-mono text-caption text-slate-500"
                          >+56</span
                        >
                        <input
                          type="tel"
                          inputmode="numeric"
                          maxlength="9"
                          [ngModel]="c.telefono"
                          (ngModelChange)="updateTelefono($index, $event)"
                          placeholder="9 1234 5678"
                          aria-label="Teléfono del contacto"
                          class="w-full px-2 py-1 font-mono outline-none"
                        />
                      </div>
                      <input
                        type="email"
                        maxlength="25"
                        [ngModel]="c.email"
                        (ngModelChange)="updateContacto($index, 'email', $event)"
                        placeholder="Email"
                        aria-label="Email del contacto"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-primary-tint-35"
                      />
                    </div>
                    <div class="mt-1 flex justify-end">
                      <button
                        type="button"
                        (click)="editingContactoIdx.set(null)"
                        class="inline-flex items-center gap-1 rounded border border-primary-tint-25 bg-primary-tint-08 px-2 py-1 text-caption-xs font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
                      >
                        <span class="material-symbols-outlined text-[14px]">check</span>
                        Listo
                      </button>
                    </div>
                  } @else if (isInternal()) {
                    <p class="text-body-sm font-semibold text-slate-700">
                      {{ c.nombre || 'Sin nombre' }}
                    </p>
                    <p class="text-caption-xs text-slate-500">
                      {{ c.rol }} · {{ c.telefono ? '+56 ' + c.telefono : '—' }} ·
                      {{ c.email || '—' }}
                    </p>
                    <div class="mt-1 flex gap-3">
                      <button
                        type="button"
                        (click)="pedirEditarContacto($index)"
                        class="inline-flex items-center gap-1 text-caption-xs font-semibold text-primary-container transition-colors hover:underline active:scale-95"
                      >
                        <span class="material-symbols-outlined text-[14px]">edit</span>
                        Editar
                      </button>
                      <button
                        type="button"
                        (click)="pedirEliminarContacto($index)"
                        class="inline-flex items-center gap-1 text-caption-xs font-semibold text-rose-500 transition-colors hover:underline active:scale-95"
                      >
                        <span class="material-symbols-outlined text-[14px]">delete</span>
                        Eliminar
                      </button>
                    </div>
                  } @else {
                    <p class="text-body-sm font-semibold text-slate-700">{{ c.nombre }}</p>
                    <p class="text-caption-xs text-slate-500">
                      {{ c.rol }} · {{ c.telefono ? '+56 ' + c.telefono : '—' }} ·
                      {{ c.email || '—' }}
                    </p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <!-- Acreditados (técnicos Emeltec con credenciales vigentes) -->
        <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Acreditados
            </h3>
            @if (isInternal()) {
              <button
                type="button"
                (click)="addAcreditacion()"
                aria-label="Agregar acreditación"
                class="rounded p-1 text-primary-container transition-colors hover:bg-primary-tint-08 active:scale-95"
              >
                <span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
              </button>
            }
          </div>
          @if (ficha().acreditaciones.length === 0) {
            <p class="text-caption italic text-slate-500">Sin acreditaciones registradas.</p>
          } @else {
            <ul class="space-y-2">
              @for (a of ficha().acreditaciones; track $index) {
                <li class="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-caption">
                  @if (isInternal()) {
                    <div class="grid grid-cols-3 gap-2">
                      <!-- Persona: dropdown SOLO técnicos Emeltec con tipo
                           SuperAdmin (los que portan acreditaciones reales en
                           terreno). Si la persona ya está seteada y no
                           matchea, queda visible como primera opción.
                           Usa template ref para evitar race signal/DOM. -->
                      @if (availableAcreditadores().length > 0) {
                        <select
                          #acrePicker
                          (change)="onAcreditadorPickerChange($index, acrePicker)"
                          class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-primary-tint-35"
                          title="Seleccionar técnico Emeltec acreditado"
                        >
                          <option value="" [selected]="!findTecnicoIdByName(a.persona)">
                            {{ a.persona || 'Seleccionar persona…' }}
                          </option>
                          @for (u of availableAcreditadores(); track u.id) {
                            <option
                              [value]="u.id"
                              [selected]="findTecnicoIdByName(a.persona) === u.id"
                            >
                              {{ u.nombre }}{{ u.apellido ? ' ' + u.apellido : '' }}
                            </option>
                          }
                        </select>
                      } @else {
                        <input
                          type="text"
                          [ngModel]="a.persona"
                          (ngModelChange)="updateAcreditacion($index, 'persona', $event)"
                          placeholder="Persona"
                          aria-label="Persona acreditada"
                          class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-primary-tint-35"
                        />
                      }
                      <input
                        type="text"
                        [ngModel]="a.tipo"
                        (ngModelChange)="updateAcreditacion($index, 'tipo', $event)"
                        placeholder="Tipo (DGA, etc)"
                        aria-label="Tipo de acreditación"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-primary-tint-35"
                      />
                      <input
                        type="date"
                        min="2000-01-01"
                        [ngModel]="a.vigencia_hasta"
                        (ngModelChange)="updateAcreditacion($index, 'vigencia_hasta', $event)"
                        class="rounded border border-slate-200 px-2 py-1 font-mono outline-none focus:border-primary-tint-35"
                      />
                    </div>
                    <button
                      type="button"
                      (click)="removeAcreditacion($index)"
                      class="mt-1 text-caption-xs font-semibold text-rose-500 transition-colors hover:underline active:scale-95"
                    >
                      Eliminar
                    </button>
                  } @else {
                    <p class="font-semibold text-slate-700">{{ a.persona }} · {{ a.tipo }}</p>
                    <p [class]="vigenciaClass(a.vigencia_hasta)">
                      {{ a.vigencia_hasta ? 'Vigente hasta ' + a.vigencia_hasta : 'Sin vigencia' }}
                    </p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <!-- Riesgos: matriz IPER chileno (Probabilidad × Severidad) con
             niveles Trivial / Tolerable / Moderado / Importante / Intolerable
             según práctica SST común (Ley 16.744 / D.S. 40 / Mutual). -->
        <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
          <div class="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
                Matriz IPER — Probabilidad × Severidad
              </h3>
              <p class="mt-0.5 text-caption-xs text-slate-500">
                Prepará la salida a terreno antes de viajar. En sitio, marcá "Verificado" para
                confirmar el riesgo al llegar.
              </p>
            </div>
            @if (isInternal()) {
              <div class="flex items-center gap-1">
                <!-- Atajos de riesgos comunes en pozos -->
                <select
                  [ngModel]="''"
                  (ngModelChange)="addRiesgoFromPreset($event)"
                  class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-caption-xs text-slate-600 outline-none focus:border-primary-tint-35"
                >
                  <option value="">+ Riesgo común…</option>
                  @for (p of presetRiesgos; track p.descripcion) {
                    <option [value]="p.descripcion">{{ p.descripcion }}</option>
                  }
                </select>
                <button
                  type="button"
                  (click)="addRiesgo()"
                  title="Agregar riesgo manual"
                  aria-label="Agregar riesgo manual"
                  class="rounded p-1 text-primary-container transition-colors hover:bg-primary-tint-08 active:scale-95"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                </button>
              </div>
            }
          </div>

          <!-- Matriz 5×5: Probabilidad (Y, descendente) × Severidad (X).
               Etiquetas SST chilenas. Cada celda muestra cantidad de
               riesgos plotted ahí + el valor numérico al hover. -->
          <div class="mb-4 overflow-x-auto">
            <div
              class="grid min-w-[560px] grid-cols-[100px_repeat(5,minmax(0,1fr))] gap-1 text-caption-xs"
            >
              <span></span>
              @for (i of [1, 2, 3, 4, 5]; track i) {
                <span class="text-center font-bold text-slate-500">
                  {{ severidadLabel(i) }}
                </span>
              }
              @for (p of [5, 4, 3, 2, 1]; track p) {
                <span class="flex items-center justify-end pr-1 font-bold text-slate-500">
                  {{ probabilidadLabel(p) }}
                </span>
                @for (i of [1, 2, 3, 4, 5]; track i) {
                  <div
                    class="flex h-12 flex-col items-center justify-center rounded font-bold"
                    [class]="matrizCellClass(p * i)"
                    [title]="nivelLabel(p * i) + ' · ' + p * i"
                  >
                    <span class="text-[10px] font-bold opacity-60">{{ p * i }}</span>
                    @if (matrizCount(p, i) > 0) {
                      <span class="text-body-sm">{{ matrizCount(p, i) }}</span>
                    }
                  </div>
                }
              }
            </div>
          </div>

          <!-- Leyenda IPER chileno -->
          <div class="mb-3 flex flex-wrap items-center gap-2 text-caption-xs">
            <span class="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
              Trivial (1-2)
            </span>
            <span class="rounded bg-lime-100 px-2 py-0.5 font-bold text-lime-700">
              Tolerable (3-4)
            </span>
            <span class="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-700">
              Moderado (5-8)
            </span>
            <span class="rounded bg-orange-200 px-2 py-0.5 font-bold text-orange-800">
              Importante (9-12)
            </span>
            <span class="rounded bg-rose-200 px-2 py-0.5 font-bold text-rose-800">
              Intolerable (13-25)
            </span>
            <span class="ml-auto text-slate-500">
              {{ ficha().riesgos.length }} riesgo(s) · {{ riesgosVerificados() }} verificado(s) en
              terreno
            </span>
          </div>

          @if (ficha().riesgos.length === 0) {
            <p class="text-caption italic text-slate-500">Sin riesgos registrados.</p>
          } @else {
            <ul class="space-y-2">
              @for (r of ficha().riesgos; track $index) {
                <li
                  class="rounded-lg border p-3 text-caption"
                  [class]="riesgoCardClass(nivelRiesgo(r))"
                >
                  @if (isInternal()) {
                    <div class="grid gap-2 md:grid-cols-[2fr_auto_auto_2fr_auto]">
                      <input
                        type="text"
                        [ngModel]="r.descripcion"
                        (ngModelChange)="updateRiesgo($index, 'descripcion', $event)"
                        placeholder="Descripción del riesgo"
                        aria-label="Descripción del riesgo"
                        class="rounded border border-slate-200 bg-white px-2 py-1 outline-none focus:border-primary-tint-35"
                      />
                      <label
                        class="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1"
                      >
                        <span class="text-caption-xs font-bold text-slate-400">P</span>
                        <select
                          [ngModel]="r.probabilidad"
                          (ngModelChange)="updateRiesgo($index, 'probabilidad', +$event)"
                          class="w-12 bg-transparent text-center font-mono outline-none"
                        >
                          <option [ngValue]="null">—</option>
                          @for (n of [1, 2, 3, 4, 5]; track n) {
                            <option [ngValue]="n">{{ n }}</option>
                          }
                        </select>
                      </label>
                      <label
                        class="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1"
                      >
                        <span class="text-caption-xs font-bold text-slate-400">I</span>
                        <select
                          [ngModel]="r.impacto"
                          (ngModelChange)="updateRiesgo($index, 'impacto', +$event)"
                          class="w-12 bg-transparent text-center font-mono outline-none"
                        >
                          <option [ngValue]="null">—</option>
                          @for (n of [1, 2, 3, 4, 5]; track n) {
                            <option [ngValue]="n">{{ n }}</option>
                          }
                        </select>
                      </label>
                      <input
                        type="text"
                        [ngModel]="r.mitigacion"
                        (ngModelChange)="updateRiesgo($index, 'mitigacion', $event)"
                        placeholder="Mitigación / control"
                        aria-label="Mitigación o control del riesgo"
                        class="rounded border border-slate-200 bg-white px-2 py-1 outline-none focus:border-primary-tint-35"
                      />
                      <span
                        class="flex flex-col items-center justify-center rounded px-2 py-1 font-bold"
                        [class]="nivelBadgeClass(nivelRiesgo(r))"
                        [title]="'Nivel calculado: ' + (nivelRiesgo(r) ?? '—')"
                      >
                        <span class="text-caption-xs uppercase">{{
                          nivelLabel(nivelRiesgo(r))
                        }}</span>
                        <span class="font-mono text-[10px] opacity-60">{{
                          nivelRiesgo(r) ?? '—'
                        }}</span>
                      </span>
                    </div>
                    <input
                      type="text"
                      [ngModel]="r.epp_requerido"
                      (ngModelChange)="updateRiesgo($index, 'epp_requerido', $event)"
                      placeholder="EPP requerido (casco, arnés, guantes…)"
                      aria-label="EPP requerido"
                      class="mt-2 w-full rounded border border-slate-200 bg-white px-2 py-1 outline-none focus:border-primary-tint-35"
                    />
                    <div class="mt-2 flex items-center justify-between gap-2">
                      <label
                        class="inline-flex items-center gap-1.5 text-caption-xs font-semibold text-slate-600"
                      >
                        <input
                          type="checkbox"
                          [ngModel]="r.evaluado_terreno"
                          (ngModelChange)="updateRiesgo($index, 'evaluado_terreno', $event)"
                          class="accent-primary"
                        />
                        Verificado en terreno
                      </label>
                      <button
                        type="button"
                        (click)="removeRiesgo($index)"
                        class="text-caption-xs font-semibold text-rose-500 transition-colors hover:underline active:scale-95"
                      >
                        Eliminar
                      </button>
                    </div>
                  } @else {
                    <div class="flex items-start justify-between gap-2">
                      <p class="font-semibold text-slate-700">{{ r.descripcion }}</p>
                      <span
                        class="rounded px-2 py-0.5 font-bold"
                        [class]="nivelBadgeClass(nivelRiesgo(r))"
                      >
                        {{ nivelLabel(nivelRiesgo(r)) }}
                      </span>
                    </div>
                    <p class="mt-1 text-slate-500">
                      P: {{ r.probabilidad ?? '—' }} · I: {{ r.impacto ?? '—' }} · Mitigación:
                      {{ r.mitigacion || '—' }}
                    </p>
                    @if (r.epp_requerido) {
                      <p class="mt-1 text-slate-500"><strong>EPP:</strong> {{ r.epp_requerido }}</p>
                    }
                    @if (r.evaluado_terreno) {
                      <p class="mt-1 text-caption-xs font-bold text-emerald-600">
                        ✓ Verificado en terreno
                      </p>
                    }
                  }
                </li>
              }
            </ul>
          }
        </section>
      </div>

      @if (isInternal()) {
        <!-- Barra de acciones sticky cuando hay cambios pendientes. Avisa al
             operador que las modificaciones quedan solo en memoria hasta
             clickear "Guardar cambios". Sin esto, al refrescar la página
             todo lo agregado se pierde — comportamiento esperado pero
             confuso. -->
        <div
          class="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 rounded-xl border bg-white/95 px-3 py-2 shadow-md backdrop-blur"
          [class.border-amber-300]="dirty() && !saving()"
          [class.border-slate-200]="!dirty() || saving()"
        >
          @if (dirty() && !saving()) {
            <span
              class="mr-auto inline-flex items-center gap-1 text-caption-xs font-semibold text-amber-700"
            >
              <span class="material-symbols-outlined text-[14px]">edit_note</span>
              Cambios sin guardar
            </span>
          }
          @if (saveMsg()) {
            <span class="text-caption-xs font-semibold text-emerald-600">{{ saveMsg() }}</span>
          }
          @if (error()) {
            <span class="text-caption-xs font-semibold text-rose-600">{{ error() }}</span>
          }
          <button
            type="button"
            (click)="save()"
            [disabled]="saving() || !dirty()"
            class="rounded-lg bg-primary px-4 py-2 text-body-sm font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:opacity-40"
          >
            {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      }
    </div>

    <app-confirm-dialog
      [data]="confirmData()"
      (accept)="onConfirmAccept()"
      (dismiss)="onConfirmCancel()"
    />
  `,
})
export class BitacoraFichaSitioComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(BitacoraSitioService);
  private readonly companyService = inject(CompanyService);
  private readonly userService = inject(UserService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly isInternal = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly ficha = signal<FichaSitio>({
    pin_critico: null,
    contactos: [],
    acreditaciones: [],
    riesgos: [],
  });
  private original = JSON.stringify(this.ficha());

  readonly saving = signal<boolean>(false);
  readonly saveMsg = signal<string>('');
  readonly error = signal<string>('');
  readonly dirty = computed(() => JSON.stringify(this.ficha()) !== this.original);

  // Índice del contacto en modo edición (null = todos read-only). Editar un
  // contacto existente requiere desbloquear con confirmación.
  readonly editingContactoIdx = signal<number | null>(null);

  // Confirmación con modal del proyecto (reemplaza confirm() nativo).
  readonly confirmData = signal<ConfirmDialogData | null>(null);
  private pendingConfirm: (() => void) | null = null;

  private askConfirm(data: ConfirmDialogData, action: () => void): void {
    this.pendingConfirm = action;
    this.confirmData.set(data);
  }

  onConfirmAccept(): void {
    const action = this.pendingConfirm;
    this.pendingConfirm = null;
    this.confirmData.set(null);
    action?.();
  }

  onConfirmCancel(): void {
    this.pendingConfirm = null;
    this.confirmData.set(null);
  }

  /** Pide confirmación antes de desbloquear un contacto existente para editar. */
  pedirEditarContacto(idx: number): void {
    const c = this.ficha().contactos[idx];
    this.askConfirm(
      {
        title: 'Editar contacto',
        message: `¿Querés editar el contacto "${c?.nombre || 'sin nombre'}"?`,
        confirmText: 'Editar',
        tone: 'primary',
        icon: 'edit',
      },
      () => this.editingContactoIdx.set(idx),
    );
  }

  /** Pide confirmación antes de eliminar un contacto. */
  pedirEliminarContacto(idx: number): void {
    const c = this.ficha().contactos[idx];
    this.askConfirm(
      {
        title: 'Eliminar contacto',
        message: `¿Eliminar el contacto "${c?.nombre || 'sin nombre'}"? Recordá guardar los cambios para confirmarlo.`,
        confirmText: 'Eliminar',
        tone: 'danger',
        icon: 'delete',
      },
      () => {
        this.removeContacto(idx);
        this.editingContactoIdx.set(null);
      },
    );
  }

  // -------- Catálogos externos para dropdowns --------
  // Contactos operativos asociados al sitio o a la empresa (sin sitio).
  readonly availableContacts = signal<OperationalContact[]>([]);
  // Lista raw de usuarios visibles para el caller (filtrada client-side
  // según el destino: contactos vs acreditaciones tienen criterios distintos).
  private readonly availableUsers = signal<User[]>([]);

  /**
   * Usuarios de la MISMA empresa del sitio (excluye SuperAdmin/Admin de
   * Emeltec). Pensado para listar gerentes de planta, jefes operacionales,
   * etc. del cliente — los que efectivamente trabajan en el sitio.
   * Si un User tiene empresa_id distinto al del sitio, queda fuera.
   */
  readonly availableUsuariosCliente = computed(() => {
    const empId = this.empresaId();
    if (!empId) return [];
    return this.availableUsers().filter(
      (u) => u.empresa_id === empId && u.tipo !== 'SuperAdmin' && u.tipo !== 'Admin',
    );
  });

  /**
   * Personas elegibles como titulares de acreditaciones: solo SuperAdmin
   * (equipo técnico Emeltec). Admin/Gerente quedan fuera porque no son
   * los que portan las acreditaciones operativas en terreno.
   */
  readonly availableAcreditadores = computed(() =>
    this.availableUsers().filter((u) => u.tipo === 'SuperAdmin'),
  );
  // Estado temporal para el selector "Agregar contacto desde agenda".
  readonly contactPickerId = signal<string>('');
  readonly acreditacionPickerIdx = signal<number | null>(null);

  // Effect: fetcha catálogos cuando cambian empresaId / sitioId. Solo dispara
  // en contexto de inyección.
  private readonly catalogFetchEffect = effect(() => {
    const empId = this.empresaId();
    const sId = this.sitioId();
    if (!sId) return;

    // Operational contacts: filtramos client-side a los que apliquen al sitio
    // (sitio_id === sId o sitio_id === null = aplica a toda empresa).
    if (empId) {
      this.companyService
        .getOperationalContacts({ empresa_id: empId })
        .pipe(catchError(() => of({ ok: false, data: [] as OperationalContact[] })))
        .subscribe((res) => {
          const all = res.ok ? res.data : [];
          this.availableContacts.set(all.filter((c) => !c.sitio_id || c.sitio_id === sId));
        });
    }

    // Lista raw de usuarios. Filtros (Contactos vs Acreditaciones) se
    // aplican en computeds derivados — necesitamos toda la lista en memoria.
    this.userService
      .getUsers()
      .pipe(catchError(() => of({ ok: false, data: [] as User[] })))
      .subscribe((res) => {
        this.availableUsers.set(res.ok ? res.data : []);
      });
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.error.set('');
    this.api.getFicha(this.sitioId()).subscribe({
      next: (f) => {
        const norm = this.fichaWithLocalPhones(f);
        this.ficha.set(norm);
        this.original = JSON.stringify(norm);
      },
      error: (err) =>
        this.error.set(
          'No se pudo cargar ficha: ' + (err?.error?.error?.message ?? err?.message ?? ''),
        ),
    });
  }

  save(): void {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.saveMsg.set('');
    this.api.patchFicha(this.sitioId(), this.fichaForSave(this.ficha())).subscribe({
      next: (f) => {
        const norm = this.fichaWithLocalPhones(f);
        this.ficha.set(norm);
        this.original = JSON.stringify(norm);
        this.saving.set(false);
        this.saveMsg.set('Guardado.');
        setTimeout(() => this.saveMsg.set(''), 3000);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set('No se pudo guardar: ' + (err?.error?.error?.message ?? err?.message ?? ''));
      },
    });
  }

  // -------- Pin --------
  updatePin(v: string): void {
    this.ficha.update((f) => ({ ...f, pin_critico: v || null }));
  }

  // -------- Contactos --------
  addContacto(): void {
    const next: FichaContacto = { nombre: '', rol: 'Responsable', telefono: '', email: '' };
    const newIdx = this.ficha().contactos.length;
    this.ficha.update((f) => ({ ...f, contactos: [...f.contactos, next] }));
    // Un contacto recién agregado queda editable para poder llenarlo.
    this.editingContactoIdx.set(newIdx);
  }
  removeContacto(idx: number): void {
    this.ficha.update((f) => ({
      ...f,
      contactos: f.contactos.filter((_, i) => i !== idx),
    }));
  }
  updateContacto(idx: number, field: keyof FichaContacto, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      contactos: f.contactos.map((c, i) => (i === idx ? { ...c, [field]: value as never } : c)),
    }));
  }

  /**
   * Parte local (9 dígitos) del teléfono, sin el código país +56. El +56 se
   * muestra fijo en el template, así el usuario solo escribe los 9 dígitos
   * del móvil chileno.
   */
  /**
   * En memoria el teléfono se guarda como SOLO los 9 dígitos locales (sin +56).
   * El +56 se muestra fijo en el template y se antepone únicamente al guardar.
   * Así el usuario escribe/borra libre y el +56 nunca se mete en el input.
   */
  updateTelefono(idx: number, raw: string): void {
    const digits = String(raw ?? '')
      .replace(/\D/g, '')
      .slice(0, 9);
    this.updateContacto(idx, 'telefono', digits);
  }

  /** Quita el prefijo +56 y cualquier no-dígito; deja los 9 dígitos locales. */
  private toLocalPhone(tel: string | null | undefined): string {
    return String(tel ?? '')
      .replace(/^\+?56\s*/, '')
      .replace(/\D/g, '')
      .slice(0, 9);
  }

  /** Ficha con teléfonos normalizados a dígitos locales (para editar/mostrar). */
  private fichaWithLocalPhones(f: FichaSitio): FichaSitio {
    return {
      ...f,
      contactos: f.contactos.map((c) => ({ ...c, telefono: this.toLocalPhone(c.telefono) })),
    };
  }

  /**
   * Ficha lista para enviar al backend:
   *  - antepone +56 a los teléfonos no vacíos,
   *  - descarta filas incompletas (el backend exige nombre/persona/tipo/
   *    descripción no vacíos; una fila en blanco recién agregada daría 422).
   */
  private fichaForSave(f: FichaSitio): FichaSitio {
    return {
      ...f,
      contactos: f.contactos
        .filter((c) => (c.nombre ?? '').trim().length > 0)
        .map((c) => {
          const local = this.toLocalPhone(c.telefono);
          return { ...c, telefono: local ? `+56 ${local}` : '' };
        }),
      acreditaciones: f.acreditaciones.filter(
        (a) => (a.persona ?? '').trim().length > 0 && (a.tipo ?? '').trim().length > 0,
      ),
      riesgos: f.riesgos.filter((r) => (r.descripcion ?? '').trim().length > 0),
    };
  }

  /**
   * Handler del cambio del <select> de contactos. Usa template ref para
   * leer el value y resetear el control directamente en el DOM, evitando
   * race conditions entre el signal y la actualización del elemento.
   */
  onContactoPickerChange(el: HTMLSelectElement): void {
    const value = el.value;
    el.value = '';
    this.addContactoFromAgenda(value);
  }

  /**
   * Selecciona un contacto desde la agenda (OperationalContact) O desde
   * usuarios de la misma planta (User cliente), y lo agrega a la ficha.
   * El valor del dropdown es un id prefijado: `c:<contactId>` para
   * OperationalContact o `u:<userId>` para User cliente.
   */
  addContactoFromAgenda(prefixedId: string): void {
    if (!prefixedId) return;
    const [kind, id] = prefixedId.split(':');
    let next: FichaContacto | null = null;
    if (kind === 'c') {
      const found = this.availableContacts().find((c) => c.id === id);
      if (found) {
        const nombre = [found.nombre, found.apellido].filter(Boolean).join(' ').trim();
        next = {
          nombre: nombre || found.nombre,
          rol: found.cargo || found.tipo_contacto || 'Responsable',
          telefono: this.toLocalPhone(found.telefono),
          email: found.email || '',
        };
      }
    } else if (kind === 'u') {
      const found = this.availableUsuariosCliente().find((u) => u.id === id);
      if (found) {
        const nombre = [found.nombre, found.apellido].filter(Boolean).join(' ').trim();
        next = {
          nombre: nombre || found.email || 'Usuario',
          rol: found.tipo,
          telefono: this.toLocalPhone(found.telefono),
          email: found.email || '',
        };
      }
    }
    if (next) {
      const newIdx = this.ficha().contactos.length;
      this.ficha.update((f) => ({ ...f, contactos: [...f.contactos, next!] }));
      this.editingContactoIdx.set(newIdx);
    }
    this.contactPickerId.set('');
  }

  // -------- Acreditaciones --------
  addAcreditacion(): void {
    const next: FichaAcreditacion = { persona: '', tipo: '', vigencia_hasta: null };
    this.ficha.update((f) => ({ ...f, acreditaciones: [...f.acreditaciones, next] }));
  }
  /**
   * Resuelve el id del técnico cuyo nombre completo coincide con `persona`.
   * Sirve para que el `<select>` muestre la opción correcta cuando la ficha
   * ya tiene una persona seteada. Si no matchea ningún técnico → ''.
   */
  findTecnicoIdByName(persona: string | null | undefined): string {
    if (!persona) return '';
    const target = persona.trim().toLowerCase();
    return (
      this.availableAcreditadores().find((u) => {
        const full = [u.nombre, u.apellido].filter(Boolean).join(' ').trim().toLowerCase();
        return full === target;
      })?.id ?? ''
    );
  }

  /**
   * Handler del <select> de acreditados. Lee value del DOM via template
   * ref, asigna al acreditado, evitando race condition de Angular ngModel
   * con signals. La selección queda persistente porque [selected] en el
   * template binding refleja `findTecnicoIdByName(a.persona)` que ya
   * incluye el cambio recién aplicado.
   */
  onAcreditadorPickerChange(idx: number, el: HTMLSelectElement): void {
    this.asignarTecnico(idx, el.value);
  }

  /**
   * Asigna el nombre completo de un técnico Emeltec (SuperAdmin) a una
   * acreditación existente. Usa `nombre + apellido` o cae al email si no
   * hay nombre. El idx debe ser el índice de la acreditación a modificar.
   */
  asignarTecnico(idx: number, userId: string): void {
    if (!userId) {
      this.updateAcreditacion(idx, 'persona', '');
      return;
    }
    const found = this.availableAcreditadores().find((u) => u.id === userId);
    if (!found) return;
    const nombre =
      [found.nombre, found.apellido].filter(Boolean).join(' ').trim() || found.email || '';
    this.updateAcreditacion(idx, 'persona', nombre);
  }
  removeAcreditacion(idx: number): void {
    this.ficha.update((f) => ({
      ...f,
      acreditaciones: f.acreditaciones.filter((_, i) => i !== idx),
    }));
  }
  updateAcreditacion(idx: number, field: keyof FichaAcreditacion, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      acreditaciones: f.acreditaciones.map((a, i) =>
        i === idx ? { ...a, [field]: value as never } : a,
      ),
    }));
  }

  // -------- Riesgos --------

  /**
   * Catálogo de riesgos típicos en sitios de pozos. El operador elige uno
   * del dropdown y se pre-rellenan probabilidad/impacto/mitigación/EPP
   * según el preset. Luego puede ajustar manualmente.
   */
  readonly presetRiesgos: FichaRiesgo[] = [
    {
      descripcion: 'Trabajo en altura (sobre cabezal de pozo, escalera o estructura)',
      categoria: 'altura',
      probabilidad: 3,
      impacto: 5,
      mitigacion: 'Arnés con doble cabo, punto de anclaje certificado, supervisión',
      epp_requerido: 'Casco con barbiquejo, arnés de cuerpo completo, calzado antideslizante',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Riesgo eléctrico (tablero, variador, cables expuestos)',
      categoria: 'electrico',
      probabilidad: 3,
      impacto: 5,
      mitigacion: 'Bloqueo + tarjeteo (LOTO), verificación con multímetro antes de tocar',
      epp_requerido: 'Guantes dieléctricos, casco clase E, calzado dieléctrico',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Espacio confinado (cámara de pozo profundo o tanque)',
      categoria: 'confinado',
      probabilidad: 2,
      impacto: 5,
      mitigacion: 'Medición de gases pre-ingreso, ventilación forzada, vigía externo',
      epp_requerido: 'Detector multi-gas, arnés con cuerda de rescate, radio',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Exposición a químicos (cloración / dosificación)',
      categoria: 'quimico',
      probabilidad: 2,
      impacto: 4,
      mitigacion: 'Ventilación, MSDS disponible, ducha de emergencia identificada',
      epp_requerido: 'Mascarilla full-face, guantes nitrilo, lentes protección',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Riesgo mecánico (bomba, motor, válvulas en operación)',
      categoria: 'mecanico',
      probabilidad: 3,
      impacto: 4,
      mitigacion: 'Detener equipo antes de intervenir, bloqueo de válvulas',
      epp_requerido: 'Guantes anti-corte, lentes, calzado punta acero',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Caída a distinto nivel (acceso al cabezal sin baranda)',
      categoria: 'altura',
      probabilidad: 4,
      impacto: 4,
      mitigacion: 'Instalar baranda temporal o línea de vida',
      epp_requerido: 'Arnés, casco, calzado de seguridad',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Exposición a sol/calor extremo (sitio rural sin sombra)',
      categoria: 'ambiental',
      probabilidad: 4,
      impacto: 3,
      mitigacion: 'Hidratación frecuente, sombrillas, no trabajar al mediodía',
      epp_requerido: 'Sombrero, bloqueador solar SPF50+, ropa manga larga clara',
      evaluado_terreno: false,
    },
    {
      descripcion: 'Acceso remoto / sin comunicación (zona sin señal)',
      categoria: 'comunicacion',
      probabilidad: 3,
      impacto: 4,
      mitigacion: 'Plan de comunicación con horarios, radio satelital o handheld',
      epp_requerido: 'Radio satelital, botiquín, agua extra',
      evaluado_terreno: false,
    },
  ];

  addRiesgo(): void {
    const next: FichaRiesgo = {
      descripcion: '',
      probabilidad: null,
      impacto: null,
      mitigacion: '',
      categoria: null,
      epp_requerido: null,
      evaluado_terreno: false,
    };
    this.ficha.update((f) => ({ ...f, riesgos: [...f.riesgos, next] }));
  }

  /**
   * Agrega un riesgo desde el catálogo preset, copiando todos sus campos.
   * Reset del dropdown manejado por el `[ngModel]=''` en el template.
   */
  addRiesgoFromPreset(descripcion: string): void {
    if (!descripcion) return;
    const preset = this.presetRiesgos.find((p) => p.descripcion === descripcion);
    if (!preset) return;
    this.ficha.update((f) => ({ ...f, riesgos: [...f.riesgos, { ...preset }] }));
  }

  removeRiesgo(idx: number): void {
    this.ficha.update((f) => ({
      ...f,
      riesgos: f.riesgos.filter((_, i) => i !== idx),
    }));
  }
  updateRiesgo(idx: number, field: keyof FichaRiesgo, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      riesgos: f.riesgos.map((r, i) => (i === idx ? { ...r, [field]: value as never } : r)),
    }));
  }

  /**
   * Nivel de riesgo = probabilidad × impacto. Retorna null si falta P o I.
   */
  nivelRiesgo(r: FichaRiesgo): number | null {
    const p = Number(r.probabilidad);
    const i = Number(r.impacto);
    if (!Number.isFinite(p) || !Number.isFinite(i) || p <= 0 || i <= 0) return null;
    return p * i;
  }

  /**
   * Clase Tailwind para colorear celdas de la matriz según el nivel IPER.
   * Trivial (1-2) verde · Tolerable (3-4) lima · Moderado (5-8) ámbar ·
   * Importante (9-12) naranja · Intolerable (13-25) rojo.
   */
  matrizCellClass(nivel: number): string {
    if (nivel <= 2) return 'bg-emerald-100 text-emerald-700';
    if (nivel <= 4) return 'bg-lime-100 text-lime-700';
    if (nivel <= 8) return 'bg-amber-100 text-amber-700';
    if (nivel <= 12) return 'bg-orange-200 text-orange-800';
    return 'bg-rose-200 text-rose-800';
  }

  /**
   * Etiqueta SST chilena para probabilidad (1-5).
   */
  probabilidadLabel(p: number): string {
    return ['Raro', 'Improbable', 'Posible', 'Probable', 'Casi seguro'][p - 1] ?? String(p);
  }

  /**
   * Etiqueta SST chilena para severidad/consecuencia (1-5).
   */
  severidadLabel(s: number): string {
    return ['Insignificante', 'Menor', 'Moderada', 'Mayor', 'Catastrófica'][s - 1] ?? String(s);
  }

  /**
   * Etiqueta del nivel calculado según matriz IPER chileno.
   */
  nivelLabel(nivel: number | null): string {
    if (nivel === null || !Number.isFinite(nivel)) return '—';
    if (nivel <= 2) return 'Trivial';
    if (nivel <= 4) return 'Tolerable';
    if (nivel <= 8) return 'Moderado';
    if (nivel <= 12) return 'Importante';
    return 'Intolerable';
  }

  /**
   * Cuenta cuántos riesgos están plotted en una celda (p, i) específica.
   */
  matrizCount(p: number, i: number): number {
    return this.ficha().riesgos.filter((r) => r.probabilidad === p && r.impacto === i).length;
  }

  /**
   * Borde de la card del riesgo según su nivel IPER chileno.
   */
  riesgoCardClass(nivel: number | null): string {
    if (nivel === null) return 'border-slate-200 bg-slate-50/60';
    if (nivel <= 2) return 'border-emerald-200 bg-emerald-50/40';
    if (nivel <= 4) return 'border-lime-200 bg-lime-50/40';
    if (nivel <= 8) return 'border-amber-200 bg-amber-50/40';
    if (nivel <= 12) return 'border-orange-300 bg-orange-50/40';
    return 'border-rose-300 bg-rose-50/40';
  }

  /**
   * Badge del nivel calculado (mismo color scheme que la matriz).
   */
  nivelBadgeClass(nivel: number | null): string {
    if (nivel === null) return 'bg-slate-100 text-slate-400';
    return this.matrizCellClass(nivel);
  }

  /**
   * Cuenta riesgos ya verificados en terreno (checkbox marcado).
   */
  riesgosVerificados(): number {
    return this.ficha().riesgos.filter((r) => r.evaluado_terreno === true).length;
  }

  vigenciaClass(fecha: string | null | undefined): string {
    if (!fecha) return 'text-slate-400';
    const t = new Date(fecha).getTime();
    if (!Number.isFinite(t)) return 'text-slate-400';
    const dias = Math.ceil((t - Date.now()) / 86400000);
    if (dias < 0) return 'text-rose-500 font-semibold';
    if (dias <= 30) return 'text-amber-600 font-semibold';
    return 'text-emerald-600';
  }
}
