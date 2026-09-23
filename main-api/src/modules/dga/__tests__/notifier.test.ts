/**
 * El notificador DGA tiene que poder CARGAR el emailService.
 *
 * Parece obvio, y por eso se rompió sin que nadie lo notara: `loadMailService`
 * apuntaba a `/app/src/services/emailService.js`, la copia que el Dockerfile
 * metía en la imagen, que no se podía cargar (hace
 * `require('../utils/timezone')` y `src/utils` no se copiaba). Los dos paths
 * candidatos daban al mismo árbol roto, el `try/catch` se tragaba el
 * MODULE_NOT_FOUND y la función devolvía `null` con un warn.
 *
 * Resultado: `sendDgaAdminAlert` —las anomalías del reconciler— no mandó un
 * solo correo en producción, y el reconciler siguió corriendo en verde.
 *
 * El test es deliberadamente romo: verifica que el correo SALE.
 *
 * Y una advertencia para quien lo lea después: **este test NO habría detectado
 * el bug.** En el repo, `src/services/emailService.js` y `src/utils/` conviven,
 * así que el path viejo resolvía perfecto en dev y en CI; solo fallaba dentro
 * de la imagen, donde el Dockerfile copiaba uno y no el otro. Lo que impide la
 * regresión de verdad es haber sacado ese `COPY src/services` del Dockerfile:
 * ahora `/app/src/services` no existe, y apuntar ahí revienta fuerte en vez de
 * degradar a un warn silencioso.
 *
 * emailService se sustituye vía `require.cache` y no con `vi.mock`: el notifier
 * lo carga con `require()`, que pasa por el loader de Node y vitest no parchea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Solo tipos: se borran al compilar, así que no alteran el orden de carga que
// `vi.hoisted` necesita.
import type * as NodeModule from 'node:module';
import type * as NodePath from 'node:path';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/appConfig', () => ({
  config: { monitor: { primaryEmail: 'monitoreo@emeltec.cl' } },
}));

/** Corre ANTES de los imports: el notifier resuelve el módulo al primer uso. */
const enviados = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodePath = require('node:path') as typeof NodePath;
  const { createRequire } = require('node:module') as typeof NodeModule;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const req = createRequire(nodePath.join(process.cwd(), 'vitest-require-root.js'));
  const ruta = req.resolve('./src/services/emailService');
  const salidas: Array<Record<string, unknown>> = [];
  req.cache[ruta] = {
    id: ruta,
    filename: ruta,
    loaded: true,
    exports: {
      sendAdminPlainEmail: async (input: Record<string, unknown>) => {
        salidas.push(input);
      },
      renderAdminShell: ({ contentHtml }: { contentHtml: string }) =>
        `<shell>${contentHtml}</shell>`,
    },
  } as NodeJS.Module;
  return salidas;
});

import { sendDgaAdminAlert, renderAdminShell } from '../notifier';

beforeEach(() => {
  enviados.length = 0;
});

describe('sendDgaAdminAlert', () => {
  it('manda el correo: el emailService se resuelve de verdad', async () => {
    await sendDgaAdminAlert({ subject: 'Slot sin audit', body: 'Revisar S127.' });

    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      to: 'monitoreo@emeltec.cl',
      subject: 'Slot sin audit',
      text: 'Revisar S127.',
    });
  });

  it('pasa el html cuando viene, y lo omite cuando no', async () => {
    await sendDgaAdminAlert({ subject: 'Con html', body: 'texto', html: '<p>x</p>' });
    expect(enviados[0]!.html).toBe('<p>x</p>');

    enviados.length = 0;
    await sendDgaAdminAlert({ subject: 'Sin html', body: 'texto' });
    expect(enviados[0]).not.toHaveProperty('html');
  });

  it('renderAdminShell también resuelve el módulo, no devuelve undefined', () => {
    expect(renderAdminShell({ title: 'T', contentHtml: '<tr></tr>' })).toBe(
      '<shell><tr></tr></shell>',
    );
  });
});
