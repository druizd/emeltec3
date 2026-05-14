import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-3xl px-6 py-10 text-slate-700" style="font-family: 'DM Sans';">
      <a
        routerLink="/"
        class="mb-6 inline-flex items-center gap-1 text-[12px] font-medium text-cyan-600 hover:underline"
      >
        <span class="material-symbols-outlined text-[14px]">arrow_back</span>
        Volver
      </a>

      <h1
        class="mb-2 text-slate-900"
        style="font-family: 'Josefin Sans'; font-size: 28px; font-weight: 700; letter-spacing: 0.02em;"
      >
        Términos de servicio
      </h1>
      <p class="mb-6 text-[12px] text-slate-400">Última actualización: 14 de mayo de 2026</p>

      <section class="space-y-4 text-[14px] leading-relaxed">
        <h2 class="text-[18px] font-bold text-slate-900">1. Objeto</h2>
        <p>
          Emeltec SpA provee una plataforma SaaS de monitoreo industrial y cumplimiento regulatorio
          (DGA). Estos términos regulan el uso del servicio por parte de los usuarios autorizados
          por la empresa contratante.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">2. Cuentas y credenciales</h2>
        <p>
          El uso de la plataforma requiere una cuenta nominal. Las credenciales son personales e
          intransferibles. El usuario es responsable de mantener su contraseña confidencial y de
          notificar de inmediato cualquier sospecha de uso indebido a
          <strong>seguridad&#64;emeltec.cl</strong>.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">3. Uso permitido</h2>
        <ul class="list-disc space-y-1 pl-6">
          <li>Visualizar telemetría industrial autorizada para tu empresa o sub-empresa.</li>
          <li>Configurar alertas y reportes de cumplimiento.</li>
          <li>Descargar datos para uso interno de tu organización.</li>
        </ul>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">4. Uso prohibido</h2>
        <ul class="list-disc space-y-1 pl-6">
          <li>Intentar acceder a datos de empresas distintas a la propia.</li>
          <li>
            Realizar ingeniería inversa, pruebas de penetración no autorizadas o scraping masivo.
          </li>
          <li>Compartir credenciales con terceros.</li>
          <li>Eludir mecanismos de autenticación, autorización o bitácora.</li>
        </ul>
        <p>
          Estas conductas pueden derivar en suspensión del acceso y acciones legales conforme a la
          <strong>Ley 21.459</strong> sobre delitos informáticos.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">5. Disponibilidad</h2>
        <p>
          Emeltec procurará una disponibilidad razonable del servicio pero no garantiza operación
          ininterrumpida. Las ventanas de mantenimiento se comunican con anticipación.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">6. Privacidad</h2>
        <p>
          El tratamiento de datos personales se rige por nuestra
          <a routerLink="/privacidad" class="text-cyan-700 underline">Política de privacidad</a> y
          la legislación chilena vigente.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">7. Propiedad intelectual</h2>
        <p>
          La plataforma, su código, diseños y marcas son propiedad de Emeltec SpA. Los datos
          industriales propios de cada cliente permanecen de su propiedad; Emeltec actúa como
          encargado de tratamiento.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">8. Reporte de vulnerabilidades</h2>
        <p>
          Bienvenidos los reportes responsables de problemas de seguridad. Canal:
          <a class="text-cyan-700 underline" href="/.well-known/security.txt">security.txt</a>.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">9. Modificaciones</h2>
        <p>
          Podemos actualizar estos términos. Cambios sustantivos se notificarán a usuarios activos
          con 15 días de anticipación.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">10. Legislación aplicable</h2>
        <p>
          Estos términos se rigen por las leyes de la República de Chile. Cualquier controversia se
          someterá a la jurisdicción de los tribunales ordinarios de Santiago.
        </p>
      </section>
    </main>
  `,
})
export class TermsComponent {}
