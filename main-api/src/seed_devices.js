const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'timescaledb',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'telemetry_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin_password',
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('[DB] Conectado');

    // --- Telemetría S101: Subestación Norte ---
    console.log('[1/5] Telemetría S101 (151.65.22.3) — 48h, cada 30min...');
    for (let n = 2880; n >= 0; n -= 30) {
      const t = new Date(Date.now() - n * 60000);
      await client.query(
        `INSERT INTO equipo (time, id_serial, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [
          t,
          '151.65.22.3',
          {
            REG4: +(220 + Math.sin(n / 60) * 15 + Math.random() * 5).toFixed(1),
            REG5: +(45 + Math.random() * 10).toFixed(1),
            IR1: Math.random() > 0.95 ? 'WARN' : 'OK',
          },
        ],
      );
    }

    // --- Telemetría S201: Planta Procesadora ---
    console.log('[2/5] Telemetría S201 (192.168.10.6) — 24h, cada 20min...');
    for (let n = 1440; n >= 0; n -= 20) {
      const t = new Date(Date.now() - n * 60000);
      await client.query(
        `INSERT INTO equipo (time, id_serial, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [
          t,
          '192.168.10.6',
          {
            VIB1: +(2.5 + Math.random() * 3).toFixed(2),
            RPM1: +(1450 + Math.random() * 100 - 50).toFixed(0),
            TMP2: +(65 + Math.random() * 20).toFixed(1),
          },
        ],
      );
    }

    // --- Telemetría S202: Campamento Energía ---
    console.log('[3/5] Telemetría S202 (192.168.10.7) — 24h, cada 30min...');
    for (let n = 1440; n >= 0; n -= 30) {
      const t = new Date(Date.now() - n * 60000);
      await client.query(
        `INSERT INTO equipo (time, id_serial, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [
          t,
          '192.168.10.7',
          {
            KWH1: +(120 + Math.sin(n / 120) * 80 + Math.random() * 10).toFixed(1),
            BAT1: +(75 + Math.random() * 20).toFixed(1),
            TEMP: +(18 + Math.random() * 8).toFixed(1),
          },
        ],
      );
    }

    // --- Telemetría S400: Bodega Central ---
    console.log('[4/5] Telemetría S400 (172.16.0.50) — 12h, cada 15min...');
    for (let n = 720; n >= 0; n -= 15) {
      const t = new Date(Date.now() - n * 60000);
      await client.query(
        `INSERT INTO equipo (time, id_serial, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [
          t,
          '172.16.0.50',
          {
            TMP2: +(12 + Math.random() * 6).toFixed(1),
            HUM1: +(55 + Math.random() * 25).toFixed(1),
            CO2_: +(400 + Math.random() * 200).toFixed(0),
          },
        ],
      );
    }

    // --- Datos en vivo (últimos 2 min) para TODOS los dispositivos ---
    console.log('[5/5] Datos en vivo para los 8 dispositivos...');
    const liveData = [
      ['151.65.22.2', { REG1: 1523, REG4: 228.4, IR1: 'OK' }],
      ['151.65.22.3', { REG4: 218.7, REG5: 48.2, IR1: 'OK' }],
      ['192.168.10.5', { OXY1: 20.1, CO1: 12, PRES: 1.02 }],
      ['192.168.10.6', { VIB1: 3.8, RPM1: 1487, TMP2: 71.2 }],
      ['192.168.10.7', { KWH1: 145.3, BAT1: 88.5, TEMP: 22.1 }],
      ['10.0.1.20', { OXY2: 7.4, TMP1: 13.2, SAL1: 32.1 }],
      ['10.0.1.21', { PH1: 7.2, TMP1: 13.8, SAL1: 31.8 }],
      ['172.16.0.50', { TMP2: 14.1, HUM1: 67.3, CO2_: 512 }],
    ];
    for (const [serial, data] of liveData) {
      await client.query(`INSERT INTO equipo (time, id_serial, data) VALUES (NOW(), $1, $2)`, [
        serial,
        data,
      ]);
    }

    // --- Eventos de alerta para historial ---
    console.log('[+] Eventos de alerta...');
    const eventos = [
      [
        3,
        'E200',
        'SE201',
        'S200',
        'OXY1',
        17.8,
        'Oxígeno bajo en mina: 17.8% (umbral: 19%)',
        'critica',
        true,
        true,
        new Date(Date.now() - 6 * 3600000),
      ],
      [
        4,
        'E200',
        'SE201',
        'S200',
        'CO1',
        35,
        'CO peligroso en mina: 35 ppm (umbral: 30)',
        'critica',
        true,
        true,
        new Date(Date.now() - 4 * 3600000),
      ],
      [
        1,
        'E100',
        'SE101',
        'S100',
        'REG1',
        3150,
        'Temperatura alta planta: 3150 (umbral: 3000)',
        'alta',
        true,
        false,
        new Date(Date.now() - 2 * 3600000),
      ],
      [
        7,
        'E300',
        'SE301',
        'S301',
        'PH1',
        5.8,
        'pH fuera de rango: 5.8 (rango esperado 6.5–8.5)',
        'media',
        false,
        false,
        new Date(Date.now() - 45 * 60000),
      ],
      [
        6,
        'E300',
        'SE301',
        'S300',
        'OXY2',
        4.9,
        'O₂ disuelto bajo: 4.9 mg/L (umbral mínimo: 5.5)',
        'alta',
        false,
        false,
        new Date(Date.now() - 20 * 60000),
      ],
      [
        2,
        'E100',
        'SE101',
        'S100',
        'REG4',
        195,
        'Voltaje bajo en red: 195V (umbral mínimo: 200V)',
        'critica',
        false,
        false,
        new Date(Date.now() - 5 * 60000),
      ],
    ];
    for (const [
      alerta_id,
      empresa_id,
      sub_empresa_id,
      sitio_id,
      variable_key,
      valor,
      mensaje,
      severidad,
      notificado,
      resuelta,
      triggered_at,
    ] of eventos) {
      await client.query(
        `INSERT INTO alertas_eventos (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key, valor_detectado, mensaje, severidad, notificado, resuelta, triggered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          alerta_id,
          empresa_id,
          sub_empresa_id,
          sitio_id,
          variable_key,
          valor,
          mensaje,
          severidad,
          notificado,
          resuelta,
          triggered_at,
        ],
      );
    }

    // --- Resumen final ---
    const { rows } = await client.query(
      `SELECT id_serial, COUNT(*) as registros, MAX(time) as ultimo FROM equipo GROUP BY id_serial ORDER BY id_serial`,
    );
    const { rows: eventos_total } = await client.query(`SELECT COUNT(*) FROM alertas_eventos`);
    console.log('\n=== RESUMEN ===');
    console.log('Dispositivos con telemetría:');
    rows.forEach((r) =>
      console.log(
        `  ${r.id_serial.padEnd(15)} ${r.registros} registros  último: ${new Date(r.ultimo).toLocaleString('es-CL')}`,
      ),
    );
    console.log(`Eventos de alerta: ${eventos_total[0].count}`);
    console.log('\n✓ Listo — todos los dispositivos tienen datos');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
