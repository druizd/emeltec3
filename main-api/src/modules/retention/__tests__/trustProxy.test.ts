import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

/**
 * Verifica la semántica de `trust proxy` con la topología real de producción:
 * cliente → nginx host (VM) → nginx contenedor → API (DOS hops).
 *
 * Bug auditoría 17-07-2026: con `trust proxy = 1`, req.ip devolvía la IP del
 * nginx del host ("la del servidor") y el audit_log no guardaba la IP real
 * del cliente. El valor correcto para dos proxies confiables es 2
 * (env TRUST_PROXY_HOPS, default en src/app.js).
 */

let server: Server | null = null;

function levantarApp(trustHops: number): Promise<number> {
  const app = express();
  app.set('trust proxy', trustHops);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

async function pedirIp(port: number, xff: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/ip`, {
    headers: { 'X-Forwarded-For': xff },
  });
  const body = (await res.json()) as { ip: string };
  return body.ip;
}

describe('trust proxy — resolución de IP del cliente tras dos proxies', () => {
  afterEach(() => {
    server?.close();
    server = null;
  });

  // XFF simulando la cadena real: [ip_cliente, ip_nginx_host]; el socket
  // (127.0.0.1) representa al nginx del contenedor.
  const CADENA_PROD = '203.0.113.9, 10.20.0.5';

  it('con 2 hops (valor de producción) req.ip es la IP real del cliente', async () => {
    const port = await levantarApp(2);
    expect(await pedirIp(port, CADENA_PROD)).toBe('203.0.113.9');
  });

  it('con 1 hop (el bug) req.ip era la IP del proxy anterior, no la del cliente', async () => {
    const port = await levantarApp(1);
    expect(await pedirIp(port, CADENA_PROD)).toBe('10.20.0.5');
  });

  it('un cliente que inyecta XFF falso no logra suplantar la IP (queda fuera de los hops confiables)', async () => {
    const port = await levantarApp(2);
    // El atacante antepone una IP falsa; los proxies reales appendean las suyas.
    const conSpoof = '198.51.100.66, 203.0.113.9, 10.20.0.5';
    expect(await pedirIp(port, conSpoof)).toBe('203.0.113.9');
  });
});
