/**
 * Tests de la plantilla del resumen semanal.
 *
 * Acá sí se verifica el HTML —y no solo el texto como en `emailTemplates`—
 * porque `_renderWeeklyDigestHtml` lo devuelve sin pasar por `enviar()`.
 *
 * Lo que se protege: que las dos secciones nunca se presenten como una sola.
 * Si "normalizadas, pendientes de acuse" se leyera como "activas", el cliente
 * vería como problemas de hoy cosas que ya se resolvieron, y en dos semanas
 * dejaría de abrir el correo.
 */
import { describe, expect, it, vi } from 'vitest';

// emailService lee RESEND_API_KEY al cargar: sin ella `enviar()` queda en modo
// simulado, pero igual no se llama acá — solo se renderiza.
vi.hoisted(() => {
  delete process.env.RESEND_API_KEY;
  process.env.NODE_ENV = 'test';
});

import emailService from '../emailService';

const render = (
  emailService as unknown as {
    _renderWeeklyDigestHtml: (input: {
      nombre?: string;
      generatedAt?: string;
      enFalla: unknown[];
      pendientesAcuse: unknown[];
    }) => string;
  }
)._renderWeeklyDigestHtml;

function fila(over: Record<string, unknown> = {}) {
  return {
    eventoId: 1,
    sitio: 'CCU · Quilicura · Pozo 4 · OB-1306-98',
    siteId: 'S140',
    alerta: 'Caudal alto',
    severidad: 'alta',
    valor: '18,4 L/s',
    dias: 3,
    repeticiones: 2,
    url: 'https://nuevacloud.emeltec.cl/companies/S140/water?tab=alertas',
    ...over,
  };
}

describe('resumen semanal — plantilla', () => {
  it('sin alertas anuncia que no hay nada, en vez de mostrar tablas vacías', () => {
    const html = render({ nombre: 'Dylan Ruiz', enFalla: [], pendientesAcuse: [] });
    expect(html).toContain('Sin alertas activas');
    expect(html).toContain('Ninguna alerta con la condición activa.');
    expect(html).toContain('Ninguna alerta esperando acuse de recibo.');
    // Verde: el acento lo pone lo peor que esté pasando, y no pasa nada.
    expect(html).toContain('#22C55E');
  });

  it('mantiene las dos secciones separadas y con su propio conteo', () => {
    const html = render({
      nombre: 'Dylan Ruiz',
      enFalla: [fila({ eventoId: 1 })],
      pendientesAcuse: [fila({ eventoId: 2, alerta: 'Sin comunicación' }), fila({ eventoId: 3 })],
    });
    expect(html).toContain('En falla ahora');
    expect(html).toContain('Normalizadas, pendientes de acuse');
    // El contador de cada sección, no el total.
    expect(html).toMatch(/En falla ahora[\s\S]{0,200}&middot; 1/);
    expect(html).toMatch(/pendientes de acuse[\s\S]{0,220}&middot; 2/);
  });

  it('pinta el acento con la peor severidad EN FALLA, no con la que espera acuse', () => {
    const html = render({
      enFalla: [fila({ severidad: 'media' })],
      pendientesAcuse: [fila({ severidad: 'critica' })],
    });
    expect(html).toContain('#d97706'); // media
    // El rojo de crítica no puede ser el acento del correo: no está fallando.
    expect(html).not.toMatch(/background-image:linear-gradient\(90deg,#dc2626/);
  });

  it('cuando solo quedan pendientes de acuse el acento es ámbar, no verde', () => {
    const html = render({ enFalla: [], pendientesAcuse: [fila()] });
    expect(html).toContain('#d97706');
    expect(html).not.toContain('Sin alertas activas');
  });

  it('escapa el contenido que viene de la base', () => {
    const html = render({
      nombre: '<script>alert(1)</script>',
      enFalla: [fila({ alerta: '<img src=x onerror=1>' })],
      pendientesAcuse: [],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=1>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('muestra los días abiertos en palabras y el link de la fila', () => {
    const html = render({
      enFalla: [fila({ dias: 0 }), fila({ eventoId: 2, dias: 1 }), fila({ eventoId: 3, dias: 12 })],
      pendientesAcuse: [],
    });
    expect(html).toContain('hoy');
    expect(html).toContain('hace 1 día');
    expect(html).toContain('hace 12 días');
    expect(html).toContain('https://nuevacloud.emeltec.cl/companies/S140/water?tab=alertas');
  });
});
