/**
 * Bitácora — Ficha del sitio.
 * Conectado a /api/v2/sites/:siteId/bitacora/ficha.
 *
 * Vista admin: editable (contactos, acreditaciones, pin crítico).
 * Vista cliente: solo lectura.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { catchError, of } from 'rxjs';
import type { OperationalContact, User } from '@emeltec/shared';
import { AuthService } from '../../../../services/auth.service';
import { CompanyService } from '../../../../services/company.service';
import { UserService } from '../../../../services/user.service';
import {
  BitacoraSitioService,
  type FichaAcreditacion,
  type FichaContacto,
  type FichaSitio,
} from '../../../../services/bitacora-sitio.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../../../components/ui/confirm-dialog';
import { BitacoraEquipamientoComponent } from './bitacora-equipamiento';

@Component({
  selector: 'app-bitacora-ficha-sitio',
  standalone: true,
  imports: [CommonModule, FormsModule, A11yModule, ConfirmDialogComponent, BitacoraEquipamientoComponent],
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
                (blur)="save()"
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
              Contactos de acceso a planta
            </h3>
            @if (isInternal()) {
              <button
                type="button"
                (click)="openContactoModal()"
                class="inline-flex items-center gap-1 rounded-lg border border-primary-tint-25 bg-primary-tint-08 px-2.5 py-1 text-caption-xs font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                Agregar
              </button>
            }
          </div>

          @if (ficha().contactos.length === 0) {
            <p class="text-caption italic text-slate-500">Sin contactos registrados.</p>
          } @else {
            <ul class="space-y-2">
              @for (c of ficha().contactos; track $index) {
                <li class="group relative rounded-xl border border-slate-100 bg-slate-50/60">
                  @if (isInternal()) {
                    <button
                      type="button"
                      (click)="openContactoModal($index)"
                      class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100 active:scale-[0.99]"
                      [attr.aria-label]="'Editar contacto ' + (c.nombre || '')"
                    >
                      <span
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint-08 text-caption-xs font-bold text-primary-container"
                        aria-hidden="true"
                        >{{ iniciales(c.nombre) }}</span
                      >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <p class="truncate text-body-sm font-semibold text-slate-700">
                            {{ c.nombre || 'Sin nombre' }}
                          </p>
                          <span
                            [class]="
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ' +
                              rolBadgeClass(c.rol)
                            "
                            >{{ c.rol }}</span
                          >
                        </div>
                        <p class="truncate text-caption-xs text-slate-500">{{ contactoLinea(c) }}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      (click)="pedirEliminarContacto($index)"
                      class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 active:scale-90 group-hover:opacity-100"
                      aria-label="Eliminar contacto"
                    >
                      <span class="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  } @else {
                    <div class="flex items-center gap-3 px-3 py-2">
                      <span
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint-08 text-caption-xs font-bold text-primary-container"
                        aria-hidden="true"
                        >{{ iniciales(c.nombre) }}</span
                      >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <p class="truncate text-body-sm font-semibold text-slate-700">
                            {{ c.nombre || 'Sin nombre' }}
                          </p>
                          <span
                            [class]="
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ' +
                              rolBadgeClass(c.rol)
                            "
                            >{{ c.rol }}</span
                          >
                        </div>
                        @if (revelados()[$index]; as rev) {
                          <p class="truncate text-caption-xs text-slate-600">
                            {{ rev.telefono ? '+56 ' + rev.telefono : 'Sin teléfono' }} ·
                            {{ rev.email || 'Sin email' }}
                          </p>
                        } @else if (c.datos_ocultos) {
                          <div class="mt-0.5 flex items-center gap-2">
                            <span class="font-mono text-caption-xs tracking-widest text-slate-400"
                              >•••••• · ••••</span
                            >
                            <button
                              type="button"
                              (click)="revelar($index)"
                              [disabled]="revelando() !== null"
                              class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 active:scale-95 disabled:opacity-50"
                            >
                              <span
                                class="material-symbols-outlined text-[12px]"
                                [class.animate-spin]="revelando() === $index"
                                aria-hidden="true"
                                >{{ revelando() === $index ? 'progress_activity' : 'lock_open' }}</span
                              >
                              Revelar
                            </button>
                          </div>
                        } @else {
                          <p class="truncate text-caption-xs text-slate-500">
                            {{ contactoLinea(c) }}
                          </p>
                        }
                      </div>
                    </div>
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
                (click)="openAcreModal()"
                class="inline-flex items-center gap-1 rounded-lg border border-primary-tint-25 bg-primary-tint-08 px-2.5 py-1 text-caption-xs font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                Agregar
              </button>
            }
          </div>
          @if (ficha().acreditaciones.length === 0) {
            <p class="text-caption italic text-slate-500">Sin acreditaciones registradas.</p>
          } @else {
            <ul class="space-y-2">
              @for (a of ficha().acreditaciones; track $index) {
                <li class="group relative rounded-xl border border-slate-100 bg-slate-50/60">
                  <button
                    type="button"
                    [disabled]="!isInternal()"
                    (click)="openAcreModal($index)"
                    class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors enabled:hover:bg-slate-100 enabled:active:scale-[0.99] disabled:cursor-default"
                    [attr.aria-label]="isInternal() ? 'Editar acreditación de ' + (a.persona || '') : null"
                  >
                    <span
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint-08 text-primary-container"
                      aria-hidden="true"
                    >
                      <span class="material-symbols-outlined text-[16px]">workspace_premium</span>
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p class="truncate text-body-sm font-semibold text-slate-700">
                          {{ a.persona || 'Sin persona' }}
                        </p>
                        <span
                          class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"
                          >{{ a.tipo || '—' }}</span
                        >
                      </div>
                      <p class="truncate text-caption-xs" [class]="vigenciaClass(a.vigencia_hasta)">
                        {{ a.vigencia_hasta ? 'Vigente hasta ' + a.vigencia_hasta : 'Sin vigencia' }}
                      </p>
                    </div>
                  </button>
                  @if (isInternal()) {
                    <button
                      type="button"
                      (click)="removeAcreditacion($index)"
                      class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 active:scale-90 group-hover:opacity-100"
                      aria-label="Eliminar acreditación"
                    >
                      <span class="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  }
                </li>
              }
            </ul>
          }
        </section>

      </div>

      @if (isInternal()) {
        <!-- Equipamiento del sitio (fusionado en Ficha: es data de referencia
             del pozo, no una sección aparte). Guarda con su propio CRUD. -->
        <app-bitacora-equipamiento [sitioId]="sitioId()" />
      }

      <!-- Los cambios (pin, contactos, acreditaciones) se guardan solos al
           confirmar/borrar. Este status es solo feedback transiente. -->
      @if (isInternal() && (saving() || saveMsg() || error())) {
        <p
          class="flex items-center justify-end gap-1 text-caption-xs font-semibold"
          [class.text-slate-500]="saving()"
          [class.text-emerald-600]="!saving() && saveMsg()"
          [class.text-rose-600]="!saving() && error()"
          role="status"
          aria-live="polite"
        >
          @if (saving()) {
            <span class="material-symbols-outlined animate-spin text-[14px]" aria-hidden="true"
              >progress_activity</span
            >
            Guardando…
          } @else if (error()) {
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">error</span>
            {{ error() }}
          } @else if (saveMsg()) {
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">check_circle</span>
            {{ saveMsg() }}
          }
        </p>
      }
    </div>

    @if (contactoModalOpen()) {
      <div
        class="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
        animate.leave="anim-overlay-out"
        role="dialog"
        cdkTrapFocus
        cdkTrapFocusAutoCapture
        aria-modal="true"
        aria-labelledby="contacto-modal-title"
        (click)="onContactoModalBackdrop($event)"
        (keydown.escape)="closeContactoModal()"
      >
        <div
          class="anim-panel relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 id="contacto-modal-title" class="text-h6 font-semibold text-slate-800">
              {{ contactoEditIdx() !== null ? 'Editar contacto' : 'Nuevo contacto' }}
            </h2>
            <button
              type="button"
              (click)="closeContactoModal()"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div class="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            @if (
              contactoEditIdx() === null &&
              availableContacts().length + availableUsuariosCliente().length > 0
            ) {
              <div>
                <label
                  class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >Cargar desde la agenda (opcional)</label
                >
                <select
                  #cpick
                  (change)="onContactoDraftPicker(cpick)"
                  class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
                >
                  <option value="">Elegir contacto existente…</option>
                  @if (availableContacts().length > 0) {
                    <optgroup label="Agenda del sitio">
                      @for (c of availableContacts(); track c.id) {
                        <option [value]="'c:' + c.id">
                          {{ c.nombre }}{{ c.apellido ? ' ' + c.apellido : '' }}
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
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Nombre</label
              >
              <input
                type="text"
                maxlength="40"
                [(ngModel)]="contactoDraft.nombre"
                placeholder="Nombre y apellido"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
              />
            </div>
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Rol</label
              >
              <select
                [(ngModel)]="contactoDraft.rol"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm font-semibold text-slate-700 outline-none focus:border-primary-tint-35"
              >
                <option value="Responsable">Responsable</option>
                <option value="Operador">Operador</option>
              </select>
            </div>
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Teléfono</label
              >
              <div
                class="flex items-stretch overflow-hidden rounded-xl border border-slate-200 focus-within:border-primary-tint-35"
              >
                <span class="flex items-center bg-slate-100 px-3 font-mono text-body-sm text-slate-500"
                  >+56</span
                >
                <input
                  type="tel"
                  inputmode="numeric"
                  maxlength="9"
                  [ngModel]="contactoDraft.telefono"
                  (ngModelChange)="onContactoDraftTelefono($event)"
                  placeholder="9 1234 5678"
                  class="w-full bg-white px-3 py-2 font-mono text-body-sm text-slate-700 outline-none"
                />
              </div>
            </div>
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Email</label
              >
              <input
                type="email"
                maxlength="35"
                [(ngModel)]="contactoDraft.email"
                placeholder="contacto@empresa.cl"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
              />
            </div>
          </div>

          <div
            class="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-4"
          >
            <button
              type="button"
              (click)="closeContactoModal()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-[0.98]"
            >
              Cancelar
            </button>
            <button
              type="button"
              [disabled]="!contactoDraft.nombre.trim()"
              (click)="saveContactoModal()"
              class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-[16px]">check</span>
              {{ contactoEditIdx() !== null ? 'Guardar' : 'Agregar' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (acreModalOpen()) {
      <div
        class="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
        animate.leave="anim-overlay-out"
        role="dialog"
        cdkTrapFocus
        cdkTrapFocusAutoCapture
        aria-modal="true"
        aria-labelledby="acre-modal-title"
        (click)="onAcreModalBackdrop($event)"
        (keydown.escape)="closeAcreModal()"
      >
        <div
          class="anim-panel relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 id="acre-modal-title" class="text-h6 font-semibold text-slate-800">
              {{ acreEditIdx() !== null ? 'Editar acreditación' : 'Nueva acreditación' }}
            </h2>
            <button
              type="button"
              (click)="closeAcreModal()"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div class="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            @if (acreEditIdx() === null && availableAcreditadores().length > 0) {
              <div>
                <label
                  class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >Cargar técnico Emeltec (opcional)</label
                >
                <select
                  #apick
                  (change)="onAcreDraftPicker(apick)"
                  class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
                >
                  <option value="">Elegir técnico…</option>
                  @for (u of availableAcreditadores(); track u.id) {
                    <option [value]="u.id">
                      {{ u.nombre }}{{ u.apellido ? ' ' + u.apellido : '' }}
                    </option>
                  }
                </select>
              </div>
            }
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Persona</label
              >
              <input
                type="text"
                maxlength="60"
                [(ngModel)]="acreDraft.persona"
                placeholder="Nombre de la persona acreditada"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
              />
            </div>
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Tipo</label
              >
              <input
                type="text"
                maxlength="40"
                [(ngModel)]="acreDraft.tipo"
                placeholder="DGA, altura, espacio confinado…"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
              />
            </div>
            <div>
              <label
                class="mb-1 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Vigente hasta (opcional)</label
              >
              <input
                type="date"
                min="2000-01-01"
                [(ngModel)]="acreDraft.vigencia_hasta"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 outline-none focus:border-primary-tint-35"
              />
            </div>
          </div>

          <div
            class="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-4"
          >
            <button
              type="button"
              (click)="closeAcreModal()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-[0.98]"
            >
              Cancelar
            </button>
            <button
              type="button"
              [disabled]="!acreDraft.persona.trim() || !acreDraft.tipo.trim()"
              (click)="saveAcreModal()"
              class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-[16px]">check</span>
              {{ acreEditIdx() !== null ? 'Guardar' : 'Agregar' }}
            </button>
          </div>
        </div>
      </div>
    }

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
    this.save();
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

  // -------- Modal contacto (agregar / editar) --------
  readonly contactoModalOpen = signal(false);
  readonly contactoEditIdx = signal<number | null>(null);
  contactoDraft: FichaContacto = { nombre: '', rol: 'Responsable', telefono: '', email: '' };

  openContactoModal(idx?: number): void {
    if (idx != null && this.ficha().contactos[idx]) {
      this.contactoEditIdx.set(idx);
      this.contactoDraft = { ...this.ficha().contactos[idx] };
    } else {
      this.contactoEditIdx.set(null);
      this.contactoDraft = { nombre: '', rol: 'Responsable', telefono: '', email: '' };
    }
    this.contactoModalOpen.set(true);
  }
  closeContactoModal(): void {
    this.contactoModalOpen.set(false);
  }
  onContactoModalBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.contactoModalOpen.set(false);
  }
  onContactoDraftTelefono(raw: string): void {
    this.contactoDraft.telefono = String(raw ?? '')
      .replace(/\D/g, '')
      .slice(0, 9);
  }
  onContactoDraftPicker(el: HTMLSelectElement): void {
    const built = this.buildContactoFromAgenda(el.value);
    el.value = '';
    if (built) this.contactoDraft = built;
  }
  saveContactoModal(): void {
    const draft: FichaContacto = {
      ...this.contactoDraft,
      nombre: (this.contactoDraft.nombre || '').trim(),
    };
    if (!draft.nombre) return;
    const idx = this.contactoEditIdx();
    this.ficha.update((f) => ({
      ...f,
      contactos:
        idx != null ? f.contactos.map((c, i) => (i === idx ? draft : c)) : [...f.contactos, draft],
    }));
    this.contactoModalOpen.set(false);
    this.save();
  }

  /** Construye un FichaContacto desde la agenda/usuarios (sin agregarlo). */
  private buildContactoFromAgenda(prefixedId: string): FichaContacto | null {
    if (!prefixedId) return null;
    const [kind, id] = prefixedId.split(':');
    if (kind === 'c') {
      const found = this.availableContacts().find((c) => c.id === id);
      if (found) {
        const nombre = [found.nombre, found.apellido].filter(Boolean).join(' ').trim();
        return {
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
        return {
          nombre: nombre || found.email || 'Usuario',
          rol: found.tipo,
          telefono: this.toLocalPhone(found.telefono),
          email: found.email || '',
        };
      }
    }
    return null;
  }

  // -------- Acreditaciones --------
  addAcreditacion(): void {
    const next: FichaAcreditacion = { persona: '', tipo: '', vigencia_hasta: null };
    this.ficha.update((f) => ({ ...f, acreditaciones: [...f.acreditaciones, next] }));
  }

  // -------- Modal acreditación (agregar / editar) --------
  readonly acreModalOpen = signal(false);
  readonly acreEditIdx = signal<number | null>(null);
  acreDraft: FichaAcreditacion = { persona: '', tipo: '', vigencia_hasta: null };

  openAcreModal(idx?: number): void {
    if (idx != null && this.ficha().acreditaciones[idx]) {
      this.acreEditIdx.set(idx);
      this.acreDraft = { ...this.ficha().acreditaciones[idx] };
    } else {
      this.acreEditIdx.set(null);
      this.acreDraft = { persona: '', tipo: '', vigencia_hasta: null };
    }
    this.acreModalOpen.set(true);
  }
  closeAcreModal(): void {
    this.acreModalOpen.set(false);
  }
  onAcreModalBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.acreModalOpen.set(false);
  }
  onAcreDraftPicker(el: HTMLSelectElement): void {
    const found = this.availableAcreditadores().find((u) => u.id === el.value);
    if (found) {
      this.acreDraft.persona =
        [found.nombre, found.apellido].filter(Boolean).join(' ').trim() || found.email || '';
    }
  }
  saveAcreModal(): void {
    const draft: FichaAcreditacion = {
      ...this.acreDraft,
      persona: (this.acreDraft.persona || '').trim(),
      tipo: (this.acreDraft.tipo || '').trim(),
    };
    if (!draft.persona || !draft.tipo) return;
    const idx = this.acreEditIdx();
    this.ficha.update((f) => ({
      ...f,
      acreditaciones:
        idx != null
          ? f.acreditaciones.map((a, i) => (i === idx ? draft : a))
          : [...f.acreditaciones, draft],
    }));
    this.acreModalOpen.set(false);
    this.save();
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
    this.save();
  }
  updateAcreditacion(idx: number, field: keyof FichaAcreditacion, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      acreditaciones: f.acreditaciones.map((a, i) =>
        i === idx ? { ...a, [field]: value as never } : a,
      ),
    }));
  }

  // -------- Revelado de datos de contacto (cliente, con 2FA) --------
  readonly revelados = signal<Record<number, { telefono: string | null; email: string | null }>>(
    {},
  );
  readonly revelando = signal<number | null>(null);

  revelar(idx: number): void {
    if (this.revelando() !== null) return;
    this.revelando.set(idx);
    this.api.revealContacto(this.sitioId(), idx).subscribe({
      next: (data) => {
        this.revelados.update((m) => ({ ...m, [idx]: data }));
        this.revelando.set(null);
      },
      error: () => this.revelando.set(null),
    });
  }

  contactoLinea(c: FichaContacto): string {
    const tel = c.telefono ? '+56 ' + c.telefono : 'Sin teléfono';
    return `${tel} · ${c.email || 'Sin email'}`;
  }

  /** Responsable se destaca con color de marca; Operador queda neutral. */
  rolBadgeClass(rol: string | null | undefined): string {
    return rol === 'Responsable'
      ? 'bg-primary-tint-14 text-primary-container ring-1 ring-primary-tint-25'
      : 'bg-slate-100 text-slate-500';
  }

  iniciales(nombre: string | null | undefined): string {
    const parts = (nombre || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '—';
    return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase();
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
