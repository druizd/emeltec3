// Cálculo del totalizador acumulado (volumen total consumido por el medidor).
// Combina dos registros Modbus de 16 bits (d1=word alta, d2=word baja) en un uint32.
import { registrosModbusAUInt32 } from './ieee754';

export interface TotalizadorParams {
  d1: number; // Word alta (más significativa).
  d2: number; // Word baja (menos significativa).
  wordSwap?: boolean; // Invierte d1/d2 si el PLC entrega las words al revés.
}

export function calcularTotalizador({ d1, d2, wordSwap = false }: TotalizadorParams): number {
  return registrosModbusAUInt32(d1, d2, wordSwap).valor;
}
