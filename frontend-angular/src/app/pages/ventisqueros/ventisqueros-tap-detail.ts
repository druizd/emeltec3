import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  SENSORS_BASE,
  TAP_COLORS,
  TapKey,
  TAPS,
  fmtHum,
  fmtTemp,
  tempColor,
} from './ventisqueros-data';

@Component({
  selector: 'app-ventisqueros-tap-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style="background: #F0F2F5;">
      <!-- Header strip -->
      <div
        class="flex flex-wrap items-center gap-3 border-t border-b border-[#E2E8F0] px-5 py-2.5"
        style="background: #F8FAFC; border-bottom-color: #0DAFBD; border-bottom-width: 2px;"
      >
        <button
          type="button"
          routerLink="/ventisqueros"
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-slate-500 hover:text-cyan-600"
        >
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
        </button>
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
          [style.background]="tapColor() + '1A'"
          [style.border]="'1px solid ' + tapColor() + '40'"
        >
          <span class="material-symbols-outlined text-[18px]" [style.color]="tapColor()"
            >memory</span
          >
        </div>
        <div>
          <div
            class="font-bold text-slate-800"
            style="font-family: 'Josefin Sans'; font-size: 16px; letter-spacing: 0.02em;"
          >
            Ventisqueros · {{ tapId() }}
          </div>
          <div class="mt-0.5 text-[11px] text-slate-400">
            Concentrador · {{ sensors().length }} sensores THM
          </div>
        </div>
        <span
          class="ml-3 flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-600"
        >
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
          En vivo
        </span>
      </div>

      <!-- Content -->
      <div class="min-w-0 flex-1 overflow-y-auto p-5">
        <div
          class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#E2E8F0] bg-white p-12 text-center"
          style="box-shadow: 0 1px 4px rgba(15,23,42,0.04);"
        >
          <div
            class="mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
            [style.background]="tapColor() + '1A'"
            [style.border]="'1px solid ' + tapColor() + '40'"
          >
            <span class="material-symbols-outlined text-[28px]" [style.color]="tapColor()"
              >construction</span
            >
          </div>
          <div
            class="text-slate-800"
            style="font-family: 'Josefin Sans'; font-size: 20px; font-weight: 700; letter-spacing: 0.02em;"
          >
            Vista del concentrador {{ tapId() }}
          </div>
          <div class="mt-2 max-w-md text-[13px] text-slate-500">
            Detalle por TAP — gráficos históricos, alarmas configurables y diagnóstico de equipo.
            Próximamente.
          </div>
          <div class="mt-5 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
            @for (s of sensors(); track s.id) {
              <div
                class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              >
                <div class="flex items-center gap-2.5">
                  <span class="h-2 w-2 rounded-full" [style.background]="tempColor(s.baseT)"></span>
                  <div class="text-left">
                    <div
                      class="font-mono text-[11px] font-semibold text-slate-600"
                      style="font-family: 'JetBrains Mono';"
                    >
                      {{ s.id }}
                    </div>
                    <div class="text-[12px] text-slate-700">{{ s.area }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div
                    class="font-bold text-slate-800"
                    style="font-family: 'JetBrains Mono'; font-size: 13px;"
                  >
                    {{ fmtTemp(s.baseT) }}
                  </div>
                  <div
                    class="text-slate-500"
                    style="font-family: 'JetBrains Mono'; font-size: 10.5px;"
                  >
                    {{ fmtHum(s.baseH) }}
                  </div>
                </div>
              </div>
            }
          </div>
          <button
            type="button"
            routerLink="/ventisqueros"
            class="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <span class="material-symbols-outlined text-[14px]">map</span>
            Volver al plano general
          </button>
        </div>
      </div>
    </div>
  `,
})
export class VentisquerosTapDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  readonly tapId = computed<TapKey>(() => {
    const raw = this.params().get('tapId') || '';
    const decoded = decodeURIComponent(raw).toUpperCase().replace(/-/g, ' ').trim();
    const match = TAPS.find((t) => t === decoded || t.replace(' ', '-') === decoded);
    if (!match) {
      this.router.navigate(['/ventisqueros']);
      return TAPS[0];
    }
    return match;
  });

  readonly tapColor = computed(() => TAP_COLORS[this.tapId()]);

  readonly sensors = computed(() => SENSORS_BASE.filter((s) => s.tap === this.tapId()));

  fmtTemp = fmtTemp;
  fmtHum = fmtHum;
  tempColor = tempColor;
}
