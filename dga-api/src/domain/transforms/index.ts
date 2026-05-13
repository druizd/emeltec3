// Barrel del paquete `transforms`: expone funciones puras de cálculo/decodificación
// que la capa de aplicación usa para convertir telemetría cruda en valores reportables a DGA.
export { m3hToLps } from './caudal';
export { calcularNivelFreatico } from './nivelFreatico';
export { calcularTotalizador } from './totalizador';
export {
  parseIEEE754,
  registrosModbusAFloat32,
  registrosModbusAUInt32,
} from './ieee754';
export type { ByteOrder, NumericFormat, ParseOptions, RegistersResult } from './ieee754';
