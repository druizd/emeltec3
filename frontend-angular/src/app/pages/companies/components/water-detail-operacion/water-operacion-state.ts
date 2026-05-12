import { Injectable, signal } from '@angular/core';

export interface TurnoConfig {
  nombre: string;
  inicio: string;
  fin: string;
}

export type OperacionPreset = '7d' | '30d' | '90d';

@Injectable()
export class WaterOperacionStateService {
  readonly numTurnos = signal<2 | 3>(3);
  readonly turnosConfig = signal<TurnoConfig[]>([
    { nombre: 'Turno 1', inicio: '07:00', fin: '14:59' },
    { nombre: 'Turno 2', inicio: '15:00', fin: '22:59' },
    { nombre: 'Turno 3', inicio: '23:00', fin: '06:59' },
  ]);

  readonly jornadaInicio = signal('07:00');
  readonly jornadaFin = signal('07:00');

  readonly diaOffset = signal(0);

  readonly preset = signal<OperacionPreset>('30d');
  readonly fechaDesde = signal('2026-04-10');
  readonly fechaHasta = signal('2026-05-10');

  updateTurnoConfig(index: number, field: keyof TurnoConfig, value: string): void {
    this.turnosConfig.update((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  setPreset(p: OperacionPreset): void {
    this.preset.set(p);
    const hasta = new Date(2026, 4, 10);
    const dias = p === '7d' ? 7 : p === '30d' ? 30 : 90;
    const desde = new Date(hasta);
    desde.setDate(desde.getDate() - dias);
    this.fechaDesde.set(desde.toISOString().slice(0, 10));
    this.fechaHasta.set(hasta.toISOString().slice(0, 10));
  }

  onFechaChange(campo: 'desde' | 'hasta', val: string): void {
    if (campo === 'desde') this.fechaDesde.set(val);
    else this.fechaHasta.set(val);
    this.preset.set('30d');
  }
}
