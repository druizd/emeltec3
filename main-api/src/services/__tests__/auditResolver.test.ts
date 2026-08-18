import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditResolver } = require('../auditResolver.js') as {
  auditResolver: (req: { originalUrl: string; method: string; body?: unknown }) => {
    action: string;
    targetType: string | null;
    targetId: string | null;
  };
};

const req = (method: string, originalUrl: string, body?: unknown) => ({
  method,
  originalUrl,
  body,
});

describe('auditResolver — identificación del recurso', () => {
  it('extrae el id desde la URL, no desde req.params', () => {
    // El middleware corre antes del router: req.params está vacío en ese punto.
    expect(auditResolver(req('PUT', '/api/alertas/3', { nombre: 'x' }))).toMatchObject({
      targetType: 'alerta',
      targetId: '3',
      action: 'alerta.update',
    });
  });

  it('ignora el query string al extraer el id', () => {
    expect(auditResolver(req('DELETE', '/api/alertas/12?force=1')).targetId).toBe('12');
  });

  it('deja targetId null cuando la mutación es sobre la colección', () => {
    expect(auditResolver(req('POST', '/api/alertas', { nombre: 'x' }))).toMatchObject({
      targetType: 'alerta',
      targetId: null,
      action: 'alerta.create',
    });
  });

  it('separa sitios de empresas dentro de /api/companies', () => {
    expect(auditResolver(req('PUT', '/api/companies/sites/S106', {}))).toMatchObject({
      targetType: 'sitio',
      targetId: 'S106',
    });
    expect(auditResolver(req('PUT', '/api/companies/E101', {}))).toMatchObject({
      targetType: 'empresa',
      targetId: 'E101',
    });
  });

  it('atribuye los sub-recursos del sitio al sitio', () => {
    expect(auditResolver(req('POST', '/api/companies/sites/S106/variables', {}))).toMatchObject({
      targetType: 'sitio',
      targetId: 'S106',
    });
  });

  it('marca como unknown lo que no es un recurso auditado', () => {
    expect(auditResolver(req('POST', '/api/otra-cosa', {})).action).toBe('post.unknown');
  });
});

describe('auditResolver — activar/desactivar', () => {
  it('distingue activar de una edición normal', () => {
    expect(auditResolver(req('PUT', '/api/alertas/3', { activa: true })).action).toBe(
      'alerta.enable',
    );
  });

  it('distingue desactivar', () => {
    expect(auditResolver(req('PUT', '/api/alertas/3', { activa: false })).action).toBe(
      'alerta.disable',
    );
  });

  it('una edición que además toca `activa` sigue siendo update', () => {
    // Solo el toggle manda `activa` sola; si viene con otros campos es una
    // edición de verdad y no debe disfrazarse de toggle.
    expect(
      auditResolver(req('PUT', '/api/alertas/3', { activa: true, umbral_bajo: 60 })).action,
    ).toBe('alerta.update');
  });

  it('no refina el verbo en create ni en delete', () => {
    expect(auditResolver(req('POST', '/api/alertas', { activa: true })).action).toBe(
      'alerta.create',
    );
    expect(auditResolver(req('DELETE', '/api/alertas/3', { activa: true })).action).toBe(
      'alerta.delete',
    );
  });

  it('tolera body ausente', () => {
    expect(auditResolver(req('DELETE', '/api/alertas/3')).action).toBe('alerta.delete');
  });
});

describe('auditResolver — sub-acciones de evento', () => {
  it('distingue reconocer de una edicion cualquiera', () => {
    // Reconocer es la accion que silencia los avisos de esa alerta hasta que
    // la condicion se normalice: la bitacora tiene que poder identificarla.
    expect(auditResolver(req('PUT', '/api/eventos/12/reconocer')).action).toBe(
      'evento.acknowledge',
    );
  });

  it('distingue resolver, asignar y vincular incidencia', () => {
    expect(auditResolver(req('PUT', '/api/eventos/12/resolver')).action).toBe('evento.resolve');
    expect(auditResolver(req('PUT', '/api/eventos/12/asignar')).action).toBe('evento.assign');
    expect(auditResolver(req('PUT', '/api/eventos/12/incidencia')).action).toBe(
      'evento.link_incident',
    );
  });

  it('conserva el id del evento como target', () => {
    expect(auditResolver(req('PUT', '/api/eventos/99/reconocer'))).toMatchObject({
      targetType: 'evento',
      targetId: '99',
    });
  });

  it('una sub-accion desconocida cae al verbo normal', () => {
    expect(auditResolver(req('PUT', '/api/eventos/12/inventada')).action).toBe('evento.update');
  });

  it('no confunde rutas de otros recursos con sub-acciones', () => {
    expect(auditResolver(req('PUT', '/api/alertas/12/reconocer')).action).toBe('alerta.update');
  });
});
