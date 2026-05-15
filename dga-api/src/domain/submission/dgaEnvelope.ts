import type { DgaReport } from '../reports/report.types';

export interface DgaInformante {
  rut: string; // rutUsuario
  clave: string;
  rutEmpresa: string; // RUT Centro de Control (Emeltec)
}

export interface DgaSubmissionPayload {
  informante: DgaInformante;
  obraDga: string;
  report: DgaReport;
}

export interface DgaSubmissionResponse {
  url: string;
  estatus: 'enviado' | 'rechazado';
  comprobante?: string;
  raw: unknown;
}

// Chile continental = UTC-4 sin DST (Etc/GMT+4).
function toChile(ts: Date) {
  const offsetMs = -4 * 60 * 60 * 1000;
  const local = new Date(ts.getTime() + offsetMs);
  const iso = local.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  return {
    fecha: iso.slice(0, 10), // "2023-09-07"
    hora: iso.slice(11, 19), // "10:00:00"
    headerTs: `${iso.slice(0, 19)}-04:00`, // "2023-09-07T10:00:00-04:00"
  };
}

function fmt2(n: number | null): string {
  return n == null ? '0.00' : n.toFixed(2);
}

function fmtTotalizador(n: number | null): string {
  return n == null ? '0' : Math.round(n).toString();
}

export function buildDgaPayload(args: DgaSubmissionPayload): {
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const { fecha, hora, headerTs } = toChile(args.report.timestamp);

  const headers = {
    codigoObra: args.obraDga,
    timeStampOrigen: headerTs,
  };

  const body = {
    autenticacion: {
      password: args.informante.clave,
      rutEmpresa: args.informante.rutEmpresa,
      rutUsuario: args.informante.rut,
    },
    medicionSubterranea: {
      caudal: fmt2(args.report.caudal),
      fechaMedicion: fecha,
      horaMedicion: hora,
      nivelFreaticoDelPozo: fmt2(args.report.nivelFreatico),
      totalizador: fmtTotalizador(args.report.totalizado),
    },
  };

  return { headers, body };
}
