import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { AuthService } from '../../services/auth.service';

/**
 * Aviso modal que aparece cuando faltan ≤31s para el cierre automático de
 * sesión. Muestra un countdown mm:ss en vivo. Como no hay refresh token, no
 * se puede "extender": el usuario puede cerrar sesión ya o seguir trabajando
 * hasta que el timer llegue a 0 (auto-logout).
 *
 * Se monta una vez en el layout; se autogestiona leyendo señales del
 * AuthService.
 */
@Component({
  selector: 'app-session-expiry-warning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule],
  template: `
    @if (auth.sessionExpiringSoon()) {
      <div
        class="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
      >
        <section
          class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]"
          role="alertdialog"
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          aria-modal="true"
          aria-labelledby="session-expiry-title"
        >
          <div class="flex gap-4 border-b border-slate-100 px-5 py-5">
            <span
              class="material-symbols-outlined grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-[24px] text-amber-600"
              aria-hidden="true"
              >schedule</span
            >
            <div class="min-w-0">
              <h3 id="session-expiry-title" class="text-h6 font-semibold text-slate-900">
                Tu sesión está por expirar
              </h3>
              <p class="mt-1 text-body-sm leading-6 text-slate-500">
                La sesión se cerrará automáticamente en
                <span class="font-mono font-bold text-amber-600">{{ countdown() }}</span> por
                política de seguridad.
              </p>
            </div>
          </div>
          <div class="flex flex-col-reverse gap-2 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              (click)="auth.logout()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-[0.98]"
            >
              Cerrar sesión ahora
            </button>
            <button
              type="button"
              (click)="auth.dismissExpiryWarning()"
              class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98]"
            >
              <span class="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>
              Entendido
            </button>
          </div>
        </section>
      </div>
    }
  `,
})
export class SessionExpiryWarningComponent {
  readonly auth = inject(AuthService);

  /** Formatea los segundos restantes como mm:ss. */
  readonly countdown = computed(() => {
    const total = this.auth.secondsUntilLogout() ?? 0;
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  });
}
