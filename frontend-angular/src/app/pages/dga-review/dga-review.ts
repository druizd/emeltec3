/**
 * Admin DGA — cola de revisión manual de slots `requires_review`.
 *
 * Solo SuperAdmin/Admin acceden (gateado por route + backend authorizeRoles).
 * Acciones destructivas (aceptar/descartar slot) requieren 2FA email-OTP:
 *   1. Botón "Solicitar código" → backend manda OTP al admin email.
 *   2. Admin pega el código en el input + ejecuta acción.
 *   3. Backend valida y, si OK, aplica la acción.
 *
 * El código es single-use y vence en 5 min. Si vence o falla, repetir flujo.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DgaReviewActionPayload,
  DgaReviewSlot,
  DgaService,
} from '../../services/dga.service';

interface RowEdit {
  caudal: string;
  totalizador: string;
  nivel: string;
  note: string;
}

@Component({
  selector: 'app-dga-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl p-6 space-y-4">
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-slate-800">Cola de revisión DGA</h1>
          <p class="text-[12px] text-slate-500">
            Slots con anomalías detectadas en validación. Requieren decisión admin
            antes de enviar a SNIA.
          </p>
        </div>
        <button
          type="button"
          (click)="reload()"
          [disabled]="loading()"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Recargar
        </button>
      </header>

      <!-- 2FA panel -->
      <section
        class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 space-y-2"
      >
        <div class="flex items-center gap-2 text-sm font-bold">
          <span class="material-symbols-outlined text-[18px]">verified_user</span>
          Verificación 2FA (requerida para aceptar/descartar)
        </div>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            (click)="requestCode()"
            [disabled]="requestingCode()"
            class="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {{ requestingCode() ? 'Enviando…' : 'Solicitar código' }}
          </button>
          <span class="text-[11px] text-amber-700">
            Se enviará al email admin (MONITOR_PRIMARY_EMAIL). Vence en 5 min.
          </span>
          <label class="ml-auto flex items-center gap-2 text-[12px]">
            Código:
            <input
              type="text"
              inputmode="numeric"
              maxlength="6"
              [value]="twoFactorCode()"
              (input)="twoFactorCode.set($any($event.target).value.replace(/\\D/g, ''))"
              placeholder="000000"
              class="h-9 w-24 rounded-lg border border-amber-300 bg-white px-2 font-mono text-center text-[14px] font-bold tracking-widest text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
            />
          </label>
        </div>
        @if (codeMessage()) {
          <div class="text-[11px] text-amber-800">{{ codeMessage() }}</div>
        }
      </section>

      <!-- Errores -->
      @if (error()) {
        <div
          class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800"
        >
          <span class="material-symbols-outlined text-[18px]">error</span>
          <span>{{ error() }}</span>
        </div>
      }

      <!-- Tabla -->
      @if (loading()) {
        <div class="text-sm text-slate-500">Cargando…</div>
      } @else if (slots().length === 0) {
        <div
          class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-emerald-800"
        >
          <span class="material-symbols-outlined text-[24px]">check_circle</span>
          <p class="mt-1 text-sm font-semibold">Sin slots en revisión.</p>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table class="min-w-full text-[12px]">
            <thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th class="px-3 py-2 text-left">Obra</th>
                <th class="px-3 py-2 text-left">Slot</th>
                <th class="px-3 py-2 text-left">Anomalías</th>
                <th class="px-3 py-2 text-left">Caudal (L/s)</th>
                <th class="px-3 py-2 text-left">Totalizador (m³)</th>
                <th class="px-3 py-2 text-left">Nivel (m)</th>
                <th class="px-3 py-2 text-left">Nota admin</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (s of slots(); track slotKey(s)) {
                <tr class="hover:bg-slate-50">
                  <td class="px-3 py-2 align-top">
                    <div class="font-semibold text-slate-700">{{ s.codigo_obra || s.obra }}</div>
                    <div class="text-[10px] text-slate-500">{{ s.referencia_informante || s.site_id }}</div>
                  </td>
                  <td class="px-3 py-2 align-top font-mono text-[11px] text-slate-600">
                    {{ s.ts }}
                  </td>
                  <td class="px-3 py-2 align-top">
                    <ul class="space-y-0.5">
                      @for (w of s.validation_warnings; track w.code) {
                        <li>
                          <span
                            class="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
                            >{{ w.code }}</span
                          >
                          @if (w.suggested != null) {
                            <span class="ml-1 text-[10px] text-slate-500"
                              >sugerido: {{ w.suggested }}</span
                            >
                          }
                        </li>
                      }
                    </ul>
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      [value]="edit(s).caudal"
                      (input)="setEdit(s, 'caudal', $any($event.target).value)"
                      class="h-8 w-24 rounded border border-slate-200 bg-white px-2 font-mono text-[11px] outline-none focus:border-violet-300"
                    />
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="1"
                      [value]="edit(s).totalizador"
                      (input)="setEdit(s, 'totalizador', $any($event.target).value)"
                      class="h-8 w-32 rounded border border-slate-200 bg-white px-2 font-mono text-[11px] outline-none focus:border-violet-300"
                    />
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      [value]="edit(s).nivel"
                      (input)="setEdit(s, 'nivel', $any($event.target).value)"
                      class="h-8 w-24 rounded border border-slate-200 bg-white px-2 font-mono text-[11px] outline-none focus:border-violet-300"
                    />
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="text"
                      [value]="edit(s).note"
                      (input)="setEdit(s, 'note', $any($event.target).value)"
                      maxlength="500"
                      placeholder="Razón del cambio…"
                      class="h-8 w-48 rounded border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-violet-300"
                    />
                  </td>
                  <td class="px-3 py-2 align-top space-y-1">
                    <button
                      type="button"
                      (click)="accept(s)"
                      [disabled]="acting() === slotKey(s)"
                      class="block w-full rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Aceptar → enviar
                    </button>
                    <button
                      type="button"
                      (click)="discard(s)"
                      [disabled]="acting() === slotKey(s)"
                      class="block w-full rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Descartar
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class DgaReviewComponent {
  private readonly dga = inject(DgaService);

  slots = signal<DgaReviewSlot[]>([]);
  loading = signal<boolean>(false);
  error = signal<string>('');
  requestingCode = signal<boolean>(false);
  codeMessage = signal<string>('');
  twoFactorCode = signal<string>('');
  /** key del slot cuya acción está en vuelo (deshabilita botones). */
  acting = signal<string>('');

  /** Edits por slot (caudal/totalizador/nivel/nota). Map serializable. */
  private edits = signal<Record<string, RowEdit>>({});

  constructor() {
    this.reload();
  }

  slotKey(s: DgaReviewSlot): string {
    return `${s.site_id}::${s.ts}`;
  }

  edit(s: DgaReviewSlot): RowEdit {
    const key = this.slotKey(s);
    const e = this.edits()[key];
    if (e) return e;
    // Inicializa con valores actuales o sugeridos.
    const suggestedTot = s.validation_warnings.find((w) => w.code === 'totalizator_zero')?.suggested;
    const initial: RowEdit = {
      caudal: s.caudal_instantaneo ?? '',
      totalizador:
        s.flujo_acumulado != null && s.flujo_acumulado !== ''
          ? s.flujo_acumulado
          : suggestedTot != null
            ? String(Math.trunc(suggestedTot))
            : '',
      nivel: s.nivel_freatico ?? '',
      note: '',
    };
    this.edits.update((m) => ({ ...m, [key]: initial }));
    return initial;
  }

  setEdit(s: DgaReviewSlot, field: keyof RowEdit, value: string): void {
    const key = this.slotKey(s);
    this.edits.update((m) => ({
      ...m,
      [key]: { ...this.edit(s), [field]: value },
    }));
  }

  reload(): void {
    this.loading.set(true);
    this.error.set('');
    this.dga.listReviewQueue().subscribe({
      next: (list) => {
        this.slots.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('No se pudo cargar la cola: ' + (err?.error?.error?.message ?? err?.message ?? ''));
        this.loading.set(false);
      },
    });
  }

  requestCode(): void {
    this.requestingCode.set(true);
    this.codeMessage.set('');
    this.dga.request2faCode().subscribe({
      next: () => {
        this.requestingCode.set(false);
        this.codeMessage.set('Código enviado al email admin. Vence en 5 min.');
      },
      error: (err) => {
        this.requestingCode.set(false);
        this.codeMessage.set(
          'No se pudo enviar el código: ' + (err?.error?.error?.message ?? err?.message ?? ''),
        );
      },
    });
  }

  private numOrNull(s: string): number | null {
    const t = (s ?? '').trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  accept(s: DgaReviewSlot): void {
    if (!this.requireCode()) return;
    const e = this.edit(s);
    if (!e.note.trim()) {
      this.error.set('Nota admin requerida para aceptar.');
      return;
    }
    const payload: DgaReviewActionPayload = {
      site_id: s.site_id,
      ts: s.ts,
      action: 'accept',
      values: {
        caudal_instantaneo: this.numOrNull(e.caudal),
        flujo_acumulado: this.numOrNull(e.totalizador),
        nivel_freatico: this.numOrNull(e.nivel),
      },
      admin_note: e.note.trim(),
    };
    this.executeAction(s, payload);
  }

  discard(s: DgaReviewSlot): void {
    if (!this.requireCode()) return;
    const e = this.edit(s);
    if (!e.note.trim()) {
      this.error.set('Nota admin requerida para descartar.');
      return;
    }
    const payload: DgaReviewActionPayload = {
      site_id: s.site_id,
      ts: s.ts,
      action: 'discard',
      admin_note: e.note.trim(),
    };
    this.executeAction(s, payload);
  }

  private requireCode(): boolean {
    if (this.twoFactorCode().length !== 6) {
      this.error.set('Ingresa el código 2FA de 6 dígitos.');
      return false;
    }
    return true;
  }

  private executeAction(s: DgaReviewSlot, payload: DgaReviewActionPayload): void {
    const key = this.slotKey(s);
    this.acting.set(key);
    this.error.set('');
    this.dga.applyReviewDecision(payload, this.twoFactorCode()).subscribe({
      next: () => {
        // Single-use: el código quedó consumido en backend.
        this.twoFactorCode.set('');
        // Quita el slot de la lista localmente y limpia su edit.
        this.slots.update((list) => list.filter((x) => this.slotKey(x) !== key));
        this.edits.update((m) => {
          const copy = { ...m };
          delete copy[key];
          return copy;
        });
        this.acting.set('');
      },
      error: (err) => {
        this.acting.set('');
        const code = err?.error?.error?.code;
        if (code === 'DGA_2FA_INVALID' || code === 'DGA_2FA_REQUIRED') {
          this.error.set(
            'Código 2FA inválido o expirado. Solicita uno nuevo y vuelve a intentar.',
          );
          this.twoFactorCode.set('');
        } else {
          this.error.set(
            'No se pudo aplicar la acción: ' +
              (err?.error?.error?.message ?? err?.message ?? ''),
          );
        }
      },
    });
  }
}
