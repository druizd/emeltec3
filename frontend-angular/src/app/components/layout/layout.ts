import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header/header';
import { SidebarComponent } from './sidebar/sidebar';
import { LayoutUiService } from './layout-ui.service';
import { ViewAsBannerComponent } from './view-as-banner/view-as-banner';
import { ShortcutPaletteComponent } from '../ui/shortcut-palette';
import { SessionExpiryWarningComponent } from '../ui/session-expiry-warning';
import { ToastContainerComponent } from '../ui/toast-container';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    HeaderComponent,
    SidebarComponent,
    ViewAsBannerComponent,
    ShortcutPaletteComponent,
    SessionExpiryWarningComponent,
    ToastContainerComponent,
  ],
  template: `
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:flex focus:items-center focus:gap-2 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-white focus:shadow-primary-focus focus:outline-none focus:ring-2 focus:ring-white"
    >
      <span class="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_downward</span>
      Saltar al contenido
    </a>

    <div
      class="fixed inset-0 flex overflow-hidden bg-[#f0f2f5]"
      style="font-family: 'DM Sans', 'Josefin Sans', sans-serif;"
    >
      <!-- Backdrop del drawer (solo mobile/tablet <lg). Click cierra. -->
      @if (ui.mobileNavOpen()) {
        <div
          (click)="ui.closeMobileNav()"
          class="anim-backdrop fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[1px] lg:hidden"
          animate.leave="anim-overlay-out"
          aria-hidden="true"
        ></div>
      }

      <app-sidebar></app-sidebar>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <app-view-as-banner></app-view-as-banner>
        <app-header></app-header>
        <main
          id="main-content"
          tabindex="-1"
          class="min-w-0 flex-1 overflow-y-auto bg-[#f0f2f5] focus:outline-none"
        >
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>

    <!-- Toasts globales (feedback de acciones) -->
    <app-toast-container />

    <!-- ── Chatbot flotante ── -->
    @if (chatOpen()) {
      <!-- Ancho cap a viewport en mobile. Dock por translateX relativo al
           ANCHO propio (100% - 44px del pull-tab) → funciona a cualquier ancho,
           a diferencia del offset right:-356px hardcoded para 400px. -->
      <div
        class="fixed bottom-[110px] right-3 z-50 w-[min(400px,calc(100vw-1.5rem))] sm:right-6"
        animate.leave="anim-overlay-out"
        style="transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);"
        [style.transform]="chatDocked() ? 'translateX(calc(100% - 44px))' : 'none'"
      >
        <!-- Pull tab (solo visible cuando está oculto al costado) -->
        @if (chatDocked()) {
          <button
            (click)="chatDocked.set(false)"
            class="absolute left-0 top-1/2 z-20 flex h-20 w-11 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-l-2xl hover:brightness-110 active:brightness-95 active:scale-95"
            style="background: linear-gradient(180deg, #0dafbd 0%, #04606a 100%); box-shadow: -4px 0 16px rgba(13,175,189,0.35);"
            aria-label="Expandir chat"
          >
            <span class="material-symbols-outlined text-[20px] text-white" aria-hidden="true"
              >chevron_left</span
            >
            <span class="text-[9px] font-bold tracking-[0.12em] text-white/75">AI</span>
          </button>
        }

        <!-- Panel principal. Escala desde abajo-derecha: ahí vive el bubble
             que lo abre (consistencia espacial). -->
        <div
          class="anim-panel flex origin-bottom-right flex-col overflow-hidden rounded-2xl bg-white"
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
              class="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white active:scale-95"
              aria-label="Ocultar chat al costado"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                >last_page</span
              >
            </button>
            <button
              (click)="chatOpen.set(false); chatDocked.set(false)"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white active:scale-95"
              aria-label="Cerrar chat"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
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
              aria-label="Escribe un mensaje"
              class="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700 outline-none transition placeholder:text-slate-500 focus:border-primary/40 focus:bg-white"
              disabled
            />
            <button
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
              style="background: linear-gradient(135deg, #0dafbd, #04606a);"
              aria-label="Enviar mensaje"
            >
              <span class="material-symbols-outlined text-[17px] text-white" aria-hidden="true"
                >send</span
              >
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
          class="absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-600 opacity-0 transition-opacity group-hover:opacity-100 active:scale-95"
          aria-label="Ocultar burbuja de chat"
        >
          <span class="material-symbols-outlined text-[11px] text-white" aria-hidden="true"
            >close</span
          >
        </button>
      }

      <button
        (click)="bubbleHidden() ? bubbleHidden.set(false) : toggleChat()"
        class="h-[72px] w-[72px] overflow-hidden rounded-full p-0 transition-transform hover:scale-105 active:scale-95"
        style="box-shadow: 0 8px 28px rgba(13,175,189,0.40), 0 2px 8px rgba(15,23,42,0.15);"
        aria-label="Abrir chat Emeltec AI"
      >
        <img src="/images/emeltechuman.png" alt="Chat" class="h-full w-full object-cover" />
      </button>
    </div>

    <!-- ── Paleta de atajos de teclado (? / ⌘K) ── -->
    <app-shortcut-palette />

    <!-- ── Aviso de sesión por expirar (31s antes del auto-logout) ── -->
    <app-session-expiry-warning />
  `,
})
export class LayoutComponent {
  readonly ui = inject(LayoutUiService);

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
}
