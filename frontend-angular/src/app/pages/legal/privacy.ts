import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
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
        Política de privacidad
      </h1>
      <p class="mb-6 text-[12px] text-slate-400">Última actualización: 14 de mayo de 2026</p>

      <section class="space-y-4 text-[14px] leading-relaxed">
        <p>
          Emeltec SpA ("Emeltec", "nosotros") opera la plataforma de monitoreo industrial disponible
          en <code class="text-cyan-700">cloud.emeltec.cl</code>. Esta política describe qué datos
          personales tratamos, con qué finalidad y cómo puedes ejercer tus derechos. Se aplica
          conforme a la <strong>Ley 21.719</strong> sobre protección de datos personales y la
          <strong>Ley 21.663</strong> Marco de Ciberseguridad.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">1. Datos que tratamos</h2>
        <ul class="list-disc space-y-1 pl-6">
          <li>
            <strong>Identificación:</strong> nombre, apellido, correo electrónico, teléfono, cargo.
          </li>
          <li>
            <strong>Autenticación:</strong> hash de contraseña, códigos OTP cifrados, IP y agente
            del navegador en cada inicio de sesión.
          </li>
          <li>
            <strong>Operación:</strong> registros de acciones realizadas en la plataforma (bitácora
            de auditoría).
          </li>
          <li>
            <strong>Telemetría industrial:</strong> datos de sensores y equipos (temperatura,
            humedad, caudal, etc.). Estos no son datos personales salvo que se asocien a un operador
            identificable.
          </li>
        </ul>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">2. Finalidades</h2>
        <ul class="list-disc space-y-1 pl-6">
          <li>Prestar el servicio de monitoreo contratado por tu empresa.</li>
          <li>Autenticar tus accesos y proteger la plataforma frente a accesos no autorizados.</li>
          <li>
            Cumplir obligaciones legales: bitácoras de seguridad (Ley 21.663) y reporte regulatorio
            (DGA).
          </li>
          <li>Notificar alertas relevantes mediante correo electrónico.</li>
        </ul>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">3. Base de licitud</h2>
        <p>
          Tratamos tus datos en virtud del contrato suscrito entre Emeltec y la empresa empleadora,
          de obligaciones legales aplicables y, en lo que corresponda, de tu consentimiento.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">4. Plazos de conservación</h2>
        <ul class="list-disc space-y-1 pl-6">
          <li>Datos de cuenta: mientras tu usuario esté activo y hasta 12 meses tras su baja.</li>
          <li>Bitácora de auditoría: 12 meses mínimo (conforme Ley 21.663).</li>
          <li>Telemetría industrial: definido por la empresa cliente; por defecto 24 meses.</li>
          <li>Backups cifrados: 90 días.</li>
        </ul>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">5. Tus derechos (ARCOP)</h2>
        <p>
          Conforme a la Ley 21.719 puedes ejercer los derechos de Acceso, Rectificación,
          Cancelación, Oposición y Portabilidad enviando una solicitud a
          <a class="text-cyan-700 underline" href="mailto:privacidad@emeltec.cl"
            >privacidad&#64;emeltec.cl</a
          >. Responderemos en un plazo máximo de 30 días corridos.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">6. Encargados de tratamiento</h2>
        <p>
          Compartimos datos mínimos necesarios con proveedores que actúan bajo nuestras
          instrucciones: hospedaje en la nube (Microsoft Azure), envío de correos transaccionales
          (Resend), y respaldo cifrado. Todos cumplen estándares ISO 27001.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">7. Seguridad</h2>
        <p>
          Aplicamos cifrado en tránsito (TLS 1.2+), hash bcrypt para credenciales, bitácora
          inmutable de acciones, control de acceso por roles, rate-limit y bloqueo automático tras
          intentos fallidos. Reportamos incidentes graves a la
          <strong>Agencia Nacional de Ciberseguridad (ANCI)</strong> en un plazo de 72 horas.
        </p>

        <h2 class="mt-6 text-[18px] font-bold text-slate-900">8. Contacto</h2>
        <p>
          Encargado de Privacidad de Datos: <strong>privacidad&#64;emeltec.cl</strong><br />
          Reportes de seguridad: <strong>seguridad&#64;emeltec.cl</strong> ·
          <a class="text-cyan-700 underline" href="/.well-known/security.txt">security.txt</a>
        </p>

        <p class="mt-8 text-[12px] text-slate-400">
          Este documento es una versión vigente al momento de su publicación y puede ser
          actualizado. Cambios sustantivos se comunicarán por correo a los usuarios activos.
        </p>
      </section>
    </main>
  `,
})
export class PrivacyComponent {}
