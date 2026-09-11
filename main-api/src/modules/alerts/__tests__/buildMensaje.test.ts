/**
 * El texto de una alerta nombra el sitio como lo reconoce un operador
 * ("CCU · Quilicura · Pozo 10 · OB-1306-98"), no por el serial del equipo.
 *
 * Caso real: S119 (CCU, Pozo 10) el 04-09-2026 disparó "Sin datos en Pozo 10.
 * Equipo 151.20.47.22 no reporta..." y el operador no tenía cómo saber de qué
 * planta ni de qué obra DGA se trataba.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/dbHelpers', () => ({
  getClient: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../config/appConfig', () => ({ config: { alerts: {} } }));
vi.mock('../../../services/emailService.js', () => ({ sendAlertEmail: vi.fn() }));

import { buildMensaje, etiquetaSitio } from '../worker';

const s119 = {
  id: 23,
  nombre: 'Sin comunicación del equipo',
  empresa_id: 'E102',
  sub_empresa_id: 'SE103',
  sitio_id: 'S119',
  creado_por: 'u1',
  variable_key: '',
  condicion: 'sin_datos',
  umbral_bajo: null,
  umbral_alto: null,
  severidad: 'critica',
  cooldown_minutos: 60,
  dias_activos: null,
  id_serial: '151.20.47.22',
  sitio_desc: 'Pozo 10',
  tipo_sitio: 'pozo',
  empresa_nombre: 'CCU',
  sub_empresa_nombre: 'Quilicura',
  obra_dga: 'OB-1306-98',
} as unknown as Parameters<typeof buildMensaje>[0];

describe('alertas · etiqueta del sitio en el mensaje', () => {
  it('nombra empresa, sub-empresa, sitio y obra DGA, sin el serial', () => {
    const msg = buildMensaje(s119, null);
    expect(msg).toBe(
      '[CRITICA] Sin datos en CCU · Quilicura · Pozo 10 · OB-1306-98. ' +
        'El equipo no reporta información hace más de 60 minutos.',
    );
    expect(msg).not.toContain('151.20.47.22');
  });

  it('omite la sub-empresa cuando repite el nombre de la empresa', () => {
    expect(
      etiquetaSitio({
        sitio_id: 'S149',
        sitio_desc: 'Piloto',
        empresa_nombre: 'Kross',
        sub_empresa_nombre: 'Kross',
        obra_dga: null,
      }),
    ).toBe('Kross · Piloto');
  });

  it('sin empresa ni obra cae a la descripción, y sin descripción al id', () => {
    expect(etiquetaSitio({ sitio_id: 'S1', sitio_desc: 'Pozo A' })).toBe('Pozo A');
    expect(etiquetaSitio({ sitio_id: 'S1', sitio_desc: null })).toBe('S1');
  });

  it('las demás condiciones también usan la etiqueta completa', () => {
    const msg = buildMensaje(
      { ...s119, condicion: 'sobre_derecho_dga', umbral_bajo: 30, severidad: 'alta' },
      35.5,
    );
    expect(msg.startsWith('[ALTA] CCU · Quilicura · Pozo 10 · OB-1306-98. Caudal 35.5')).toBe(true);
  });
});
