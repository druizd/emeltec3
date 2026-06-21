import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { inject } from '@angular/core';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="grid min-h-dvh place-items-center bg-background px-6 py-12 text-on-surface"
      role="main"
    >
      <section class="w-full max-w-md text-center">
        <div
          class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary-tint-20 bg-primary-tint-08 text-primary-container"
        >
          <span class="material-symbols-outlined text-[32px]">travel_explore</span>
        </div>

        <p
          class="font-josefin text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-container"
        >
          Error 404
        </p>
        <h1
          class="mt-2 font-josefin text-h3 font-semibold tracking-[-0.01em] text-on-surface"
          style="text-wrap: balance;"
        >
          Página no encontrada
        </h1>
        <p class="mt-3 text-[14px] leading-6 text-on-surface-variant">
          La ruta que buscas no existe o cambió de lugar. Vuelve al panel principal o usa los menús
          de navegación.
        </p>

        <div class="mt-7 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
          <a
            routerLink="/dashboard"
            class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-semibold text-white transition-all hover:bg-primary-container hover:shadow-primary-cta active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span class="material-symbols-outlined text-[18px]">grid_view</span>
            Ir al dashboard
          </a>
          <button
            type="button"
            (click)="goBack()"
            class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-surface-container bg-white px-5 text-[13px] font-semibold text-on-surface-variant transition-all hover:border-primary-tint-30 hover:text-primary-container active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>
            Volver
          </button>
        </div>
      </section>
    </main>
  `,
})
export class NotFoundComponent {
  private readonly router = inject(Router);

  goBack(): void {
    if (history.length > 1) {
      history.back();
      return;
    }
    this.router.navigateByUrl('/dashboard');
  }
}
