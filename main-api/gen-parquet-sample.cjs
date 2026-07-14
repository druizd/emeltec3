const { ParquetSchema, ParquetWriter } = require('@dsnp/parquetjs');
const fs = require('fs');

const schema = new ParquetSchema({
  NOMBRE_PROVEEDOR:      { type: 'UTF8' },
  PLANTA:                { type: 'UTF8' },
  NOMBRE_SENSOR:         { type: 'UTF8' },
  CENTRO_DE_OBRA:        { type: 'UTF8', optional: true },
  FECHA_MEDICION_SENSOR: { type: 'UTF8' },
  VARIABLE:              { type: 'UTF8' },
  VALOR:                 { type: 'UTF8', optional: true },
  FECHA_REPORTE_DGA:     { type: 'UTF8' },
  STATUS_DGA:            { type: 'UTF8', optional: true },
  COMPROBANTE:           { type: 'UTF8', optional: true },
  MENSAJE_DGA:           { type: 'UTF8', optional: true },
  FECHA_HORA_CARGA:      { type: 'UTF8' },
});

// Datos reales de la DB (dga_send_audit + sitios CCU)
const envios = [
  {
    site_id:     '151.20.35.10',
    planta:      'Cachantun coinco',
    obra:        'OB-0601-292',
    fechaMed:    '2026-06-23T20:00:00.000Z',
    fechaRep:    '2026-06-23T20:01:10.000Z',
    comprobante: 'sSwPldChfQGXSFNxkE0lyP9S871VJf7f',
    caudal: '0.0', totalizador: '453242', nivel: '1.2',
  },
  {
    site_id:     '151.20.35.10',
    planta:      'Cachantun coinco',
    obra:        'OB-0601-293',
    fechaMed:    '2026-06-23T20:00:00.000Z',
    fechaRep:    '2026-06-23T20:01:14.000Z',
    comprobante: 'QYndShj8C7upPRfz1qUS9KpKmDoIobAB',
    caudal: '3.5', totalizador: '891023', nivel: '2.8',
  },
  {
    site_id:     '151.20.35.10',
    planta:      'Cachantun coinco',
    obra:        'OB-0601-294',
    fechaMed:    '2026-06-23T20:00:00.000Z',
    fechaRep:    '2026-06-23T20:01:18.000Z',
    comprobante: 'MKROl2EzsiwENRNuqA4NvzPMf8e4Lidj',
    caudal: '1.8', totalizador: '120400', nivel: '4.1',
  },
];

const FECHA_HORA_CARGA = '2026-06-23T21:00:00.000Z';
const OUT = 'C:\\Users\\cidm3\\Downloads\\EMELTEC_20260623200000.parquet';

async function run() {
  const writer = await ParquetWriter.openFile(schema, OUT);

  for (const e of envios) {
    const vars = [
      { variable: 'CAUDAL',         valor: e.caudal },
      { variable: 'TOTALIZADOR',    valor: e.totalizador },
      { variable: 'NIVEL_FREATICO', valor: e.nivel },
    ];
    for (const { variable, valor } of vars) {
      await writer.appendRow({
        NOMBRE_PROVEEDOR:      'EMELTEC',
        PLANTA:                e.planta,
        NOMBRE_SENSOR:         e.site_id,
        CENTRO_DE_OBRA:        e.obra,
        FECHA_MEDICION_SENSOR: e.fechaMed,
        VARIABLE:              variable,
        VALOR:                 valor,
        FECHA_REPORTE_DGA:     e.fechaRep,
        STATUS_DGA:            '00',
        COMPROBANTE:           e.comprobante,
        MENSAJE_DGA:           null,
        FECHA_HORA_CARGA:      FECHA_HORA_CARGA,
      });
    }
  }

  await writer.close();
  console.log('OK ->', OUT);
}

run().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
