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
        class="mb-6 inline-flex items-center gap-1 text-[12px] font-medium text-primary-container hover:underline"
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
      <p class="mb-8 text-[12px] text-slate-400">Última actualización: 16 de julio de 2026</p>

      <section class="space-y-8 text-[14px] leading-relaxed">
        <!-- ── 1. Responsable del tratamiento ──────────────────────────── -->
        <div
          class="rounded-[10px] border border-[#E2E8F0] bg-white p-6"
          style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
        >
          <h2
            class="mb-4 text-[16px] font-bold uppercase tracking-wide text-slate-900"
            style="font-family: 'Josefin Sans';"
          >
            1. Responsable del tratamiento
          </h2>
          <p class="mb-4 text-[13px] text-slate-600">
            Conforme al Art. 12 de la Ley 19.628 modificada por la Ley 21.719, el responsable del
            tratamiento de los datos personales recabados a través de la plataforma
            <code class="text-primary-container">cloud.emeltec.cl</code> es:
          </p>
          <table class="w-full text-[13px]">
            <tbody>
              <tr class="border-t border-[#E2E8F0]">
                <td
                  class="py-2 pr-4 font-semibold uppercase text-slate-500"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.05em; width: 42%;"
                >
                  Razón social
                </td>
                <td class="py-2 italic text-slate-400">[PENDIENTE: razón social]</td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td
                  class="py-2 pr-4 font-semibold uppercase text-slate-500"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.05em;"
                >
                  RUT
                </td>
                <td class="py-2 italic text-slate-400">[PENDIENTE]</td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td
                  class="py-2 pr-4 font-semibold uppercase text-slate-500"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.05em;"
                >
                  Domicilio
                </td>
                <td class="py-2 italic text-slate-400">[PENDIENTE]</td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td
                  class="py-2 pr-4 font-semibold uppercase text-slate-500"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.05em;"
                >
                  Plataforma
                </td>
                <td class="py-2 text-slate-700">
                  Emeltec Cloud (<code class="text-primary-container">cloud.emeltec.cl</code>)
                </td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td
                  class="py-2 pr-4 font-semibold uppercase text-slate-500"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.05em;"
                >
                  Contacto para derechos ARCO+
                </td>
                <td class="py-2">
                  <a class="text-primary-container underline" href="mailto:datos@emeltec.cl"
                    >datos&#64;emeltec.cl</a
                  >
                </td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td
                  class="py-2 pr-4 font-semibold uppercase text-slate-500"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.05em;"
                >
                  Delegado de protección de datos
                </td>
                <td class="py-2 text-slate-700">D. Ruiz</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ── 2. Qué datos tratamos y por qué ────────────────────────── -->
        <div>
          <h2
            class="mb-4 text-[16px] font-bold uppercase tracking-wide text-slate-900"
            style="font-family: 'Josefin Sans';"
          >
            2. Qué datos tratamos y por qué
          </h2>
          <p class="mb-4 text-[13px] text-slate-600">
            La plataforma opera principalmente sobre datos industriales (mediciones IIoT: caudales,
            niveles freáticos, temperaturas, consumos eléctricos) que
            <strong>no constituyen datos personales</strong> por sí mismos. Los datos personales que
            tratamos son exclusivamente los asociados a los usuarios de la plataforma y a los
            contactos operacionales de los servicios contratados.
          </p>

          <!-- T1 -->
          <div
            class="mb-3 rounded-[10px] border border-[#E2E8F0] bg-white p-5"
            style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
          >
            <p
              class="mb-3 font-bold uppercase text-slate-400"
              style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
            >
              T1 — Cuentas de usuario
            </p>
            <div class="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Datos
                </p>
                <p class="text-slate-700">
                  Nombre, apellido, correo electrónico, RUT, teléfono, cargo, rol, contraseña (hash
                  bcrypt), configuración 2FA.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Finalidad
                </p>
                <p class="text-slate-700">
                  Autenticación, control de acceso por rol y operación del servicio.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Base legal
                </p>
                <p class="text-slate-700">Ejecución de contrato B2B.</p>
              </div>
            </div>
          </div>

          <!-- T2 -->
          <div
            class="mb-3 rounded-[10px] border border-[#E2E8F0] bg-white p-5"
            style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
          >
            <p
              class="mb-3 font-bold uppercase text-slate-400"
              style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
            >
              T2 — Contactos operacionales del cliente
            </p>
            <div class="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Datos
                </p>
                <p class="text-slate-700">Nombre, cargo, correo electrónico, teléfono.</p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Finalidad
                </p>
                <p class="text-slate-700">Notificación de alertas y eventos operacionales.</p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Base legal
                </p>
                <p class="text-slate-700">
                  Ejecución de contrato B2B / interés legítimo del cliente.
                </p>
              </div>
            </div>
          </div>

          <!-- T3 -->
          <div
            class="mb-3 rounded-[10px] border border-[#E2E8F0] bg-white p-5"
            style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
          >
            <p
              class="mb-3 font-bold uppercase text-slate-400"
              style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
            >
              T3 — Bitácora de auditoría
            </p>
            <div class="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Datos
                </p>
                <p class="text-slate-700">
                  Dirección IP, identificador de usuario, acción realizada, timestamp.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Finalidad
                </p>
                <p class="text-slate-700">
                  Seguridad, trazabilidad y detección de accesos no autorizados.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Base legal
                </p>
                <p class="text-slate-700">
                  Interés legítimo (seguridad) / obligación de medidas del Art. 14 quinquies Ley
                  21.719.
                </p>
              </div>
            </div>
          </div>

          <!-- T4 -->
          <div
            class="mb-3 rounded-[10px] border border-[#E2E8F0] bg-white p-5"
            style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
          >
            <p
              class="mb-3 font-bold uppercase text-slate-400"
              style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
            >
              T4 — Credenciales DGA del informante
            </p>
            <div class="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Datos
                </p>
                <p class="text-slate-700">
                  RUT y contraseña del informante designado por el cliente ante la DGA.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Finalidad
                </p>
                <p class="text-slate-700">
                  Envío de mediciones a la Dirección General de Aguas en nombre del cliente.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Base legal
                </p>
                <p class="text-slate-700">
                  Obligación legal (normativa DGA) + ejecución de contrato.
                </p>
              </div>
            </div>
          </div>

          <!-- T5 -->
          <div
            class="mb-4 rounded-[10px] border border-[#E2E8F0] bg-white p-5"
            style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
          >
            <p
              class="mb-3 font-bold uppercase text-slate-400"
              style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
            >
              T5 — Transferencia a la DGA (organismo público)
            </p>
            <div class="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Datos
                </p>
                <p class="text-slate-700">
                  RUT del informante + mediciones asociadas a la obra hídrica.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Finalidad
                </p>
                <p class="text-slate-700">
                  Cumplimiento regulatorio del cliente ante la Dirección General de Aguas.
                </p>
              </div>
              <div>
                <p
                  class="mb-1 uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 10px; letter-spacing: 0.1em;"
                >
                  Base legal
                </p>
                <p class="text-slate-700">Obligación legal (normativa DGA / MEE).</p>
              </div>
            </div>
          </div>

          <p class="text-[13px] text-slate-500">
            Los datos de telemetría industrial (mediciones de sensores, niveles de pozo, caudales,
            temperaturas, consumo eléctrico) <strong>no son datos personales</strong> y quedan fuera
            del ámbito de esta política.
          </p>
        </div>

        <!-- ── 3. Plazos de retención ───────────────────────────────────── -->
        <div
          class="rounded-[10px] border border-[#E2E8F0] bg-white p-6"
          style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
        >
          <h2
            class="mb-4 text-[16px] font-bold uppercase tracking-wide text-slate-900"
            style="font-family: 'Josefin Sans';"
          >
            3. Plazos de retención
          </h2>
          <table class="w-full text-[13px]">
            <thead>
              <tr class="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th
                  class="py-2 pr-4 text-left uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
                >
                  Tipo de dato
                </th>
                <th
                  class="py-2 text-left uppercase text-slate-400"
                  style="font-family: 'Josefin Sans'; font-size: 11px; letter-spacing: 0.08em;"
                >
                  Plazo
                </th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-[#E2E8F0]">
                <td class="py-3 pr-4 font-medium text-slate-700">
                  Bitácora de auditoría — acciones generales
                </td>
                <td class="py-3 text-slate-600">
                  12 meses identificable; luego anonimización (IP y correo se eliminan; la acción y
                  el rol se conservan).
                </td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td class="py-3 pr-4 font-medium text-slate-700">
                  Bitácora de auditoría — acciones sobre datos reportados a la DGA
                </td>
                <td class="py-3 text-slate-600">
                  36 meses identificable; luego anonimización. Justificación: ventana de revisión
                  DGA de 3 años.
                </td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td class="py-3 pr-4 font-medium text-slate-700">Cuentas de usuario inactivas</td>
                <td class="py-3 text-slate-600">
                  24 meses desde el último acceso, con aviso previo por correo electrónico antes de
                  la supresión.
                </td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td class="py-3 pr-4 font-medium text-slate-700">Mediciones IIoT industriales</td>
                <td class="py-3 text-slate-600">
                  Indefinido (no son datos personales; el plazo lo determina el cliente en su
                  contrato).
                </td>
              </tr>
              <tr class="border-t border-[#E2E8F0]">
                <td class="py-3 pr-4 font-medium text-slate-700">
                  Registro de solicitudes de derechos ARCO+
                </td>
                <td class="py-3 text-slate-600">5 años desde la resolución de la solicitud.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ── 4. Tus derechos (ARCO+) ─────────────────────────────────── -->
        <div>
          <h2
            class="mb-4 text-[16px] font-bold uppercase tracking-wide text-slate-900"
            style="font-family: 'Josefin Sans';"
          >
            4. Tus derechos (ARCO+)
          </h2>
          <p class="mb-4 text-[13px] text-slate-600">
            Conforme a la Ley 19.628 modificada por la Ley 21.719, tienes derecho a:
          </p>

          <div class="space-y-3">
            <div
              class="rounded-[8px] border border-[#E2E8F0] bg-white p-4"
              style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
            >
              <p class="mb-1 text-[13px] font-bold text-slate-900">Acceso</p>
              <p class="text-[13px] text-slate-600">
                Conocer qué datos personales tuyos tratamos y con qué finalidad. Disponible en la
                sección <strong>"Mis datos"</strong> de tu perfil
                <span class="text-slate-400">(funcionalidad en despliegue)</span>.
              </p>
            </div>

            <div
              class="rounded-[8px] border border-[#E2E8F0] bg-white p-4"
              style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
            >
              <p class="mb-1 text-[13px] font-bold text-slate-900">Rectificación</p>
              <p class="text-[13px] text-slate-600">
                Corregir datos inexactos o incompletos. Disponible directamente en
                <strong>Editar perfil</strong> de la plataforma.
              </p>
            </div>

            <div
              class="rounded-[8px] border border-[#E2E8F0] bg-white p-4"
              style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
            >
              <p class="mb-1 text-[13px] font-bold text-slate-900">Cancelación o supresión</p>
              <p class="text-[13px] text-slate-600">
                Solicitar la eliminación de tus datos cuando ya no sean necesarios para la finalidad
                con que fueron recabados. Puedes iniciar este proceso mediante el botón de supresión
                de cuenta en tu perfil
                <span class="text-slate-400">(funcionalidad en despliegue)</span> o escribiendo a
                <a class="text-primary-container underline" href="mailto:datos@emeltec.cl"
                  >datos&#64;emeltec.cl</a
                >.
              </p>
            </div>

            <div
              class="rounded-[8px] border border-[#E2E8F0] bg-white p-4"
              style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
            >
              <p class="mb-1 text-[13px] font-bold text-slate-900">Oposición</p>
              <p class="text-[13px] text-slate-600">
                Oponerte al tratamiento de tus datos para una finalidad específica cuando este se
                base en interés legítimo. Escribe a
                <a class="text-primary-container underline" href="mailto:datos@emeltec.cl"
                  >datos&#64;emeltec.cl</a
                >
                indicando la finalidad concreta.
              </p>
            </div>

            <div
              class="rounded-[8px] border border-[#E2E8F0] bg-white p-4"
              style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
            >
              <p class="mb-1 text-[13px] font-bold text-slate-900">Portabilidad</p>
              <p class="text-[13px] text-slate-600">
                Recibir tus datos personales en formato estructurado para trasladarlos a otro
                proveedor. Disponible en <strong>"Mis datos"</strong> del perfil (exportación
                JSON/CSV) <span class="text-slate-400">(funcionalidad en despliegue)</span>.
              </p>
            </div>

            <div
              class="rounded-[8px] border border-[#E2E8F0] bg-white p-4"
              style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
            >
              <p class="mb-1 text-[13px] font-bold text-slate-900">Bloqueo</p>
              <p class="text-[13px] text-slate-600">
                Solicitar la suspensión temporal del tratamiento mientras se resuelve una solicitud
                de rectificación, cancelación u oposición. Escribe a
                <a class="text-primary-container underline" href="mailto:datos@emeltec.cl"
                  >datos&#64;emeltec.cl</a
                >.
              </p>
            </div>
          </div>

          <div
            class="mt-4 rounded-[8px] border p-4"
            style="border-color: rgba(13,175,189,0.35); background: rgba(13,175,189,0.04); box-shadow: 0 0 0 1px rgba(13,175,189,0.25), 0 2px 8px rgba(13,175,189,0.15);"
          >
            <p class="text-[13px] text-slate-700">
              <strong>Plazo de respuesta:</strong> 30 días corridos desde la recepción de tu
              solicitud. Toda solicitud queda registrada con timestamp conforme a los plazos de
              retención de §3.
            </p>
          </div>
        </div>

        <!-- ── 5. Seguridad ────────────────────────────────────────────── -->
        <div
          class="rounded-[10px] border border-[#E2E8F0] bg-white p-6"
          style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
        >
          <h2
            class="mb-4 text-[16px] font-bold uppercase tracking-wide text-slate-900"
            style="font-family: 'Josefin Sans';"
          >
            5. Seguridad
          </h2>
          <p class="mb-4 text-[13px] text-slate-600">
            Aplicamos medidas técnicas y organizativas orientadas a garantizar la confidencialidad,
            integridad, disponibilidad y resiliencia de los sistemas de tratamiento, conforme al
            Art. 14 quinquies de la Ley 21.719:
          </p>
          <ul class="space-y-2 text-[13px] text-slate-700">
            <li class="flex items-start gap-2">
              <span class="material-symbols-outlined mt-0.5 text-[16px] text-primary-container"
                >check_circle</span
              >
              <span>Cifrado en tránsito (TLS 1.2+) en toda comunicación con la plataforma.</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="material-symbols-outlined mt-0.5 text-[16px] text-primary-container"
                >check_circle</span
              >
              <span
                >Credenciales almacenadas con hash bcrypt; contraseñas nunca en texto plano.</span
              >
            </li>
            <li class="flex items-start gap-2">
              <span class="material-symbols-outlined mt-0.5 text-[16px] text-primary-container"
                >check_circle</span
              >
              <span
                >Control de acceso por rol (SuperAdmin, Admin, Gerente, Cliente, Vendedor).</span
              >
            </li>
            <li class="flex items-start gap-2">
              <span class="material-symbols-outlined mt-0.5 text-[16px] text-primary-container"
                >check_circle</span
              >
              <span>Autenticación de dos factores (2FA) disponible para todos los usuarios.</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="material-symbols-outlined mt-0.5 text-[16px] text-primary-container"
                >check_circle</span
              >
              <span>Bitácora de auditoría de acciones sensibles con retención diferenciada.</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="material-symbols-outlined mt-0.5 text-[16px] text-primary-container"
                >check_circle</span
              >
              <span
                >Minimización de datos: solo se tratan los estrictamente necesarios para cada
                finalidad (Art. 14 quáter).</span
              >
            </li>
          </ul>
          <p class="mt-4 text-[13px] text-slate-600">
            Existe una política de seguridad pública disponible en esta plataforma, conforme al Art.
            14 ter e) de la Ley 21.719. Para reportar vulnerabilidades o incidentes, utiliza el
            canal
            <a class="text-primary-container underline" href="/.well-known/security.txt"
              >security.txt</a
            >
            o escribe a
            <a class="text-primary-container underline" href="mailto:seguridad@emeltec.cl"
              >seguridad&#64;emeltec.cl</a
            >.
          </p>
        </div>

        <!-- ── 6. Autoridad de control ─────────────────────────────────── -->
        <div
          class="rounded-[10px] border border-[#E2E8F0] bg-white p-6"
          style="box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
        >
          <h2
            class="mb-4 text-[16px] font-bold uppercase tracking-wide text-slate-900"
            style="font-family: 'Josefin Sans';"
          >
            6. Autoridad de control
          </h2>
          <p class="text-[13px] text-slate-600">
            Sin perjuicio de tu derecho a ejercer directamente los derechos señalados en §4, tienes
            derecho a presentar un reclamo ante la
            <strong class="text-slate-800">Agencia de Protección de Datos Personales</strong>
            (Chile), organismo autónomo competente para fiscalizar el cumplimiento de la Ley 19.628
            modificada por la Ley 21.719, si consideras que el tratamiento de tus datos personales
            no es conforme a la ley.
          </p>
        </div>

        <!-- ── Nota final ──────────────────────────────────────────────── -->
        <p class="text-[12px] text-slate-400">
          Este documento puede ser actualizado cuando varíen los tratamientos descritos. Los cambios
          sustantivos se comunicarán por correo electrónico a los usuarios activos con antelación
          razonable. La versión vigente siempre estará disponible en esta página.
        </p>
      </section>
    </main>
  `,
})
export class PrivacyComponent {}
