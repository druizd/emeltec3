import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-view-as-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (auth.isViewingAs()) {
      <div
        class="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-amber-300/60 px-5 text-[12px] font-medium text-amber-900"
        style="background: linear-gradient(90deg, #FEF3C7 0%, #FDE68A 100%);"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px] text-amber-700">visibility</span>
          <span>
            Viendo como
            <strong class="font-bold uppercase tracking-wide">{{ auth.viewAsRole() }}</strong>
            &middot;
            <span class="text-amber-800/80">
              Tu rol real es <strong>{{ auth.realRole() }}</strong>
            </span>
          </span>
        </div>
        <button
          type="button"
          (click)="auth.clearViewAs()"
          class="flex items-center gap-1.5 rounded-md border border-amber-700/40 bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          <span class="material-symbols-outlined text-[14px]">undo</span>
          Volver a {{ auth.realRole() }}
        </button>
      </div>
    }
  `,
})
export class ViewAsBannerComponent {
  readonly auth = inject(AuthService);
}
