import { registrosModbusAUInt32 } from './ieee754';

export interface TotalizadorParams {
  d1: number;
  d2: number;
  wordSwap?: boolean;
}

export function calcularTotalizador({ d1, d2, wordSwap = false }: TotalizadorParams): number {
  return registrosModbusAUInt32(d1, d2, wordSwap).valor;
}
