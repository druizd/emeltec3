import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header/header';
import { SidebarComponent } from './sidebar/sidebar';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, SidebarComponent],
  template: `
    <div
      class="flex h-screen overflow-hidden bg-[#f0f2f5]"
      style="font-family: 'DM Sans', 'Josefin Sans', sans-serif;"
    >
      <app-sidebar></app-sidebar>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <app-header></app-header>
        <main class="min-w-0 flex-1 overflow-y-auto bg-[#f0f2f5]">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>

    <!-- ── Chatbot flotante ── -->
    @if (chatOpen()) {
      <div
        class="fixed bottom-[110px] z-50 w-[400px]"
        [style]="
          'right:' +
          (chatDocked() ? '-356px' : '24px') +
          '; transition: right 0.35s cubic-bezier(0.4,0,0.2,1)'
        "
      >
        <!-- Pull tab (solo visible cuando está oculto al costado) -->
        @if (chatDocked()) {
          <button
            (click)="chatDocked.set(false)"
            class="absolute left-0 top-1/2 z-20 flex h-20 w-11 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-l-2xl hover:brightness-110 active:brightness-95"
            style="background: linear-gradient(180deg, #0dafbd 0%, #04606a 100%); box-shadow: -4px 0 16px rgba(13,175,189,0.35);"
            aria-label="Expandir chat"
          >
            <span class="material-symbols-outlined text-[20px] text-white">chevron_left</span>
            <span class="text-[9px] font-bold tracking-[0.12em] text-white/75">AI</span>
          </button>
        }

        <!-- Panel principal -->
        <div
          class="flex flex-col overflow-hidden rounded-2xl bg-white"
          style="box-shadow: 0 0 0 1px rgba(13,175,189,0.15), 0 24px 64px rgba(15,23,42,0.14), 0 8px 24px rgba(13,175,189,0.10);"
        >
          <!-- Header -->
          <div
            class="flex items-center gap-3 px-4 py-3"
            style="background: linear-gradient(135deg, #0dafbd 0%, #04606a 100%);"
          >
            <img
              src="/images/emeltechuman.png"
              alt="Emeltec AI"
              class="h-8 w-8 rounded-full object-cover ring-2 ring-white/30"
            />
            <div class="flex-1">
              <p class="text-[13px] font-bold text-white">Emeltec AI</p>
              <div class="flex items-center gap-1.5">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-300"></span>
                <p class="text-[10px] font-semibold text-white/70">En línea</p>
              </div>
            </div>
            <button
              (click)="chatDocked.set(true)"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              aria-label="Ocultar chat al costado"
            >
              <span class="material-symbols-outlined text-[18px]">last_page</span>
            </button>
            <button
              (click)="chatOpen.set(false); chatDocked.set(false)"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              aria-label="Cerrar chat"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <!-- Mensajes -->
          <div
            class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
            style="min-height: 340px; max-height: 480px; background: #f8fafc;"
          >
            <div class="flex items-start gap-2.5">
              <img
                src="/images/emeltechuman.png"
                alt=""
                class="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
              />
              <div
                class="max-w-[280px] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-[13px] leading-5 text-slate-700"
                style="box-shadow: 0 1px 4px rgba(15,23,42,0.08);"
              >
                Hola, soy el asistente de Emeltec. ¿En qué puedo ayudarte hoy?
              </div>
            </div>
          </div>

          <!-- Input -->
          <div class="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-3">
            <input
              type="text"
              placeholder="Escribe un mensaje..."
              class="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700 outline-none transition-all placeholder:text-slate-300 focus:border-[#0dafbd]/40 focus:bg-white"
              disabled
            />
            <button
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
              style="background: linear-gradient(135deg, #0dafbd, #04606a);"
            >
              <span class="material-symbols-outlined text-[17px] text-white">send</span>
            </button>
          </div>
          <p
            class="bg-white pb-2 text-center text-[9px] font-semibold tracking-widest text-slate-300"
          >
            PRÓXIMAMENTE
          </p>
        </div>
      </div>
    }

    <!-- Botón flotante -->
    <div
      class="group fixed bottom-6 z-50"
      [style]="
        'right:' +
        (bubbleHidden() ? '-58px' : '24px') +
        '; transition: right 0.35s cubic-bezier(0.4,0,0.2,1)'
      "
    >
      @if (!bubbleHidden()) {
        <button
          (click)="bubbleHidden.set(true)"
          class="absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-600 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Ocultar burbuja de chat"
        >
          <span class="material-symbols-outlined text-[11px] text-white">close</span>
        </button>
      }

      <button
        (click)="bubbleHidden() ? bubbleHidden.set(false) : toggleChat()"
        class="h-[72px] w-[72px] overflow-hidden rounded-full p-0 transition-all hover:scale-105 active:scale-95"
        style="box-shadow: 0 8px 28px rgba(13,175,189,0.40), 0 2px 8px rgba(15,23,42,0.15);"
        aria-label="Abrir chat Emeltec AI"
      >
        <img src="/images/emeltechuman.png" alt="Chat" class="h-full w-full object-cover" />
      </button>
    </div>
  `,
})
export class LayoutComponent implements OnInit {
  private router = inject(Router);
  chatOpen = signal(false);
  chatDocked = signal(false);
  bubbleHidden = signal(false);

  toggleChat(): void {
    if (this.chatOpen() && this.chatDocked()) {
      this.chatDocked.set(false);
    } else {
      this.chatOpen.set(!this.chatOpen());
      this.chatDocked.set(false);
    }
  }

  ngOnInit(): void {
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;

    if (navigation?.type === 'reload' && this.router.url !== '/dashboard') {
      queueMicrotask(() => {
        this.router.navigate(['/dashboard'], { replaceUrl: true });
      });
    }
  }
}
