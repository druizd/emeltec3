/**
 * seed_full.js — Datos de prueba completos para Emeltec Platform
 *
 * Crea: 4 empresas, 6 sub-empresas, 8 sitios, 12 reg_maps,
 *       15 usuarios (SuperAdmin/Admin/Cliente), 8 alertas,
 *       ~130 registros de telemetría en 3 sitios.
 *
 * Idempotente: se puede ejecutar varias veces sin duplicar datos.
 * Password de todos los usuarios de prueba: Test1234
 *
 * Uso: node src/seed_full.js
 */

const db = require('./config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const PASSWORD = 'Test1234';
const SALT_ROUNDS = 10;

function uid() {
  return 'U' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function rand(min, max, decimals = 0) {
  const v = min + Math.random() * (max - min);
  return decimals > 0 ? parseFloat(v.toFixed(decimals)) : Math.round(v);
}

async function insertTelemetry(rows) {
  if (!rows.length) return;
  const placeholders = rows
    .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
    .join(', ');
  const params = rows.flatMap(([time, serial, data]) => [time, serial, JSON.stringify(data)]);
  await db.query(`INSERT INTO equipo (time, id_serial, data) VALUES ${placeholders}`, params);
}

async function seed() {
  const now = new Date();

  try {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  EMELTEC — Seed de datos de prueba       ║');
    console.log('╚══════════════════════════════════════════╝\n');

    await db.query(`ALTER TABLE usuario ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);

    const hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    // ─────────────────────────────────────────────
    // 1. EMPRESAS
    // ─────────────────────────────────────────────
    console.log('[1/7] Empresas...');
    await db.query(`
      INSERT INTO empresa (id, nombre, rut, sitios, tipo_empresa) VALUES
        ('E100', 'Empresa Demo SpA',         '76.123.456-7', 2, 'Industrial'),
        ('E200', 'Minera Los Andes Ltda',    '77.234.567-8', 3, 'Minería'),
        ('E300', 'Acuícola del Sur S.A.',    '78.345.678-9', 2, 'Acuicultura'),
        ('E400', 'Agropecuaria Valle Verde', '79.456.789-0', 1, 'Agroindustria')
      ON CONFLICT (id) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        tipo_empresa = EXCLUDED.tipo_empresa,
        updated_at = NOW()
    `);

    // ─────────────────────────────────────────────
    // 2. SUB-EMPRESAS
    // ─────────────────────────────────────────────
    console.log('[2/7] Sub-empresas...');
    await db.query(`
      INSERT INTO sub_empresa (id, nombre, rut, sitios, empresa_id) VALUES
        ('SE101', 'División Norte',        '76.123.456-1', 1, 'E100'),
        ('SE102', 'División Sur',          '76.123.456-2', 1, 'E100'),
        ('SE201', 'Faena Atacama',         '77.234.567-1', 2, 'E200'),
        ('SE202', 'Planta Procesamiento',  '77.234.567-2', 1, 'E200'),
        ('SE301', 'Centro Cultivo Norte',  '78.345.678-1', 1, 'E300'),
        ('SE302', 'Centro Cultivo Sur',    '78.345.678-2', 1, 'E300'),
        ('SE401', 'Operacion Valle Verde', '79.456.789-1', 1, 'E400')
      ON CONFLICT (id) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        updated_at = NOW()
    `);

    // ─────────────────────────────────────────────
    // 3. SITIOS
    // ─────────────────────────────────────────────
    console.log('[3/7] Sitios...');
    await db.query(`
      INSERT INTO sitio (id, descripcion, id_serial, empresa_id, sub_empresa_id, ubicacion) VALUES
        ('S100', 'Planta Principal — Temperatura',  '151.65.22.2',  'E100', 'SE101', 'Santiago, Región Metropolitana'),
        ('S101', 'Subestación Norte — Energía',     '151.65.22.3',  'E100', 'SE102', 'Santiago Norte, R.M.'),
        ('S200', 'Mina Nivel 1 — Ventilación',      '192.168.10.5', 'E200', 'SE201', 'Copiapó, Atacama'),
        ('S201', 'Planta Procesadora — Molienda',   '192.168.10.6', 'E200', 'SE202', 'Copiapó, Atacama'),
        ('S202', 'Campamento — Energía',             '192.168.10.7', 'E200', 'SE201', 'Copiapó, Atacama'),
        ('S300', 'Estanques Norte — Oxigenación',   '10.0.1.20',    'E300', 'SE301', 'Puerto Montt, Los Lagos'),
        ('S301', 'Estanques Sur — pH',              '10.0.1.21',    'E300', 'SE302', 'Puerto Montt, Los Lagos'),
        ('S400', 'Bodega Central — Temperatura',    '172.16.0.50',  'E400', 'SE401', 'Rancagua, O''Higgins')
      ON CONFLICT (id) DO UPDATE SET
        descripcion = EXCLUDED.descripcion,
        empresa_id = EXCLUDED.empresa_id,
        sub_empresa_id = EXCLUDED.sub_empresa_id,
        ubicacion = EXCLUDED.ubicacion,
        updated_at = NOW()
    `);

    // ─────────────────────────────────────────────
    // 4. REG_MAP (mapas de registros)
    // ─────────────────────────────────────────────
    console.log('[4/7] Reg maps...');
    await db.query(`
      INSERT INTO reg_map (id, alias, d1, d2, tipo_dato, unidad, sitio_id) VALUES
        ('R-S100-T',   'Temperatura Ambiente',      'REG1', NULL,  'FLOAT', 'T°',   'S100'),
        ('R-S100-V',   'Voltaje Red',               'REG4', NULL,  'FLOAT', 'V',    'S100'),
        ('R-S101-kW',  'Potencia Activa',           'PWR1', NULL,  'FLOAT', 'kW',   'S101'),
        ('R-S101-kWh', 'Energía Consumida',         'ENR1', NULL,  'FLOAT', 'kWh',  'S101'),
        ('R-S200-O2',  'Oxígeno Mina',              'OXY1', NULL,  'FLOAT', '%',    'S200'),
        ('R-S200-CO',  'Monóxido de Carbono',       'CO1',  NULL,  'FLOAT', 'ppm',  'S200'),
        ('R-S201-RPM', 'RPM Molino',                'RPM1', NULL,  'FLOAT', 'rpm',  'S201'),
        ('R-S201-VIB', 'Vibración Molino',          'VIB1', NULL,  'FLOAT', 'mm/s', 'S201'),
        ('R-S300-O2',  'Oxígeno Estanque',          'OXY2', NULL,  'FLOAT', 'mg/L', 'S300'),
        ('R-S300-T',   'Temperatura Agua Norte',    'TMP1', NULL,  'FLOAT', 'T°',   'S300'),
        ('R-S301-PH',  'pH Agua',                   'PH1',  NULL,  'FLOAT', 'pH',   'S301'),
        ('R-S400-T',   'Temperatura Bodega',        'TMP2', NULL,  'FLOAT', 'T°',   'S400')
      ON CONFLICT (id) DO UPDATE SET
        alias = EXCLUDED.alias,
        unidad = EXCLUDED.unidad,
        updated_at = NOW()
    `);

    // ─────────────────────────────────────────────
    // 5. USUARIOS
    // ─────────────────────────────────────────────
    console.log('[5/7] Usuarios...');

    const users = [
      // ── SuperAdmin ──────────────────────────────────────────────────────
      {
        email: 'superadmin@gmail.com',
        nombre: 'Jefe',
        apellido: 'Maestro',
        tipo: 'SuperAdmin',
        empresa: null,
        sub: null,
        cargo: 'Super Administrador',
        tel: '+56912345678',
      },
      {
        email: 'nicolas@emeltec.cl',
        nombre: 'Nicolás',
        apellido: 'Garrido',
        tipo: 'SuperAdmin',
        empresa: null,
        sub: null,
        cargo: 'CTO Emeltec',
        tel: '+56911111111',
      },
      // ── Admin ────────────────────────────────────────────────────────────
      {
        email: 'admin@gmail.com',
        nombre: 'Administrador',
        apellido: 'Empresarial',
        tipo: 'Admin',
        empresa: 'E100',
        sub: null,
        cargo: 'Jefe de Planta',
        tel: '+56922222222',
      },
      {
        email: 'andrea.gonzalez@demo.cl',
        nombre: 'Andrea',
        apellido: 'González',
        tipo: 'Admin',
        empresa: 'E100',
        sub: null,
        cargo: 'Jefa de Operaciones',
        tel: '+56933333333',
      },
      {
        email: 'roberto.morales@minera.cl',
        nombre: 'Roberto',
        apellido: 'Morales',
        tipo: 'Admin',
        empresa: 'E200',
        sub: null,
        cargo: 'Gerente de Mina',
        tel: '+56944444444',
      },
      {
        email: 'carmen.vidal@acuicola.cl',
        nombre: 'Carmen',
        apellido: 'Vidal',
        tipo: 'Admin',
        empresa: 'E300',
        sub: null,
        cargo: 'Directora Técnica',
        tel: '+56955555555',
      },
      {
        email: 'pablo.rojas@agro.cl',
        nombre: 'Pablo',
        apellido: 'Rojas',
        tipo: 'Admin',
        empresa: 'E400',
        sub: null,
        cargo: 'Administrador General',
        tel: '+56966666666',
      },
      // ── Cliente / Operador ───────────────────────────────────────────────
      {
        email: 'cliente@gmail.com',
        nombre: 'Observador',
        apellido: 'Visual',
        tipo: 'Cliente',
        empresa: 'E100',
        sub: 'SE101',
        cargo: 'Operador Turno',
        tel: '+56977777777',
      },
      {
        email: 'juan.perez@demo.cl',
        nombre: 'Juan',
        apellido: 'Pérez',
        tipo: 'Cliente',
        empresa: 'E100',
        sub: 'SE101',
        cargo: 'Técnico Eléctrico',
        tel: '+56988888888',
      },
      {
        email: 'maria.silva@demo.cl',
        nombre: 'María',
        apellido: 'Silva',
        tipo: 'Cliente',
        empresa: 'E100',
        sub: 'SE102',
        cargo: 'Supervisora de Turno',
        tel: '+56999999999',
      },
      {
        email: 'felipe.castro@minera.cl',
        nombre: 'Felipe',
        apellido: 'Castro',
        tipo: 'Cliente',
        empresa: 'E200',
        sub: 'SE201',
        cargo: 'Operador Mina',
        tel: '+56900000001',
      },
      {
        email: 'diego.fuentes@minera.cl',
        nombre: 'Diego',
        apellido: 'Fuentes',
        tipo: 'Cliente',
        empresa: 'E200',
        sub: 'SE202',
        cargo: 'Operador Planta',
        tel: '+56900000003',
      },
      {
        email: 'valentina.rios@acuicola.cl',
        nombre: 'Valentina',
        apellido: 'Ríos',
        tipo: 'Cliente',
        empresa: 'E300',
        sub: 'SE301',
        cargo: 'Técnica Acuicultura',
        tel: '+56900000002',
      },
      {
        email: 'carlos.mendoza@acuicola.cl',
        nombre: 'Carlos',
        apellido: 'Mendoza',
        tipo: 'Cliente',
        empresa: 'E300',
        sub: 'SE302',
        cargo: 'Buzo Técnico',
        tel: '+56900000005',
      },
      {
        email: 'patricia.herrera@agro.cl',
        nombre: 'Patricia',
        apellido: 'Herrera',
        tipo: 'Cliente',
        empresa: 'E400',
        sub: 'SE401',
        cargo: 'Supervisora General',
        tel: '+56900000004',
      },
    ];

    for (const u of users) {
      await db.query(
        `
        INSERT INTO usuario (id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id, password_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (email) DO UPDATE SET
          nombre = EXCLUDED.nombre, apellido = EXCLUDED.apellido,
          telefono = EXCLUDED.telefono, cargo = EXCLUDED.cargo,
          tipo = EXCLUDED.tipo, empresa_id = EXCLUDED.empresa_id,
          sub_empresa_id = EXCLUDED.sub_empresa_id,
          password_hash = EXCLUDED.password_hash,
          updated_at = NOW()
      `,
        [uid(), u.nombre, u.apellido, u.email, u.tel, u.cargo, u.tipo, u.empresa, u.sub, hash],
      );
    }

    // ─────────────────────────────────────────────
    // 6. ALERTAS
    // ─────────────────────────────────────────────
    console.log('[6/7] Alertas...');

    // Borrar alertas previas del seed para mantener idempotencia
    await db.query(`DELETE FROM alertas WHERE nombre IN (
      'Temperatura Alta Planta','Voltaje Bajo Red','Oxígeno Bajo Mina',
      'CO Peligroso','Vibración Excesiva Molino','O2 Bajo Estanques',
      'pH Fuera de Rango','Temperatura Bodega Alta'
    )`);

    await db.query(`
      INSERT INTO alertas (nombre, descripcion, sitio_id, empresa_id, sub_empresa_id, variable_key, condicion, umbral_bajo, umbral_alto, severidad, activa, cooldown_minutos) VALUES
        ('Temperatura Alta Planta',   'Temperatura de planta supera 30°C (REG1>3000)',        'S100','E100','SE101','REG1','mayor_que', NULL, 3000, 'alta',    true, 10),
        ('Voltaje Bajo Red',          'Voltaje de red cae bajo 200V',                         'S100','E100','SE101','REG4','menor_que', 200,  NULL, 'critica', true, 5),
        ('Oxígeno Bajo Mina',         'Nivel de oxígeno en mina bajo el 19.5% mínimo seguro', 'S200','E200','SE201','OXY1','menor_que', 19.5, NULL, 'critica', true, 5),
        ('CO Peligroso',              'Monóxido de carbono sobre 25 ppm en zona de trabajo',  'S200','E200','SE201','CO1', 'mayor_que', NULL, 25,   'critica', true, 5),
        ('Vibración Excesiva Molino', 'Vibración del molino supera 10 mm/s',                  'S201','E200','SE202','VIB1','mayor_que', NULL, 10,   'alta',    true, 15),
        ('O2 Bajo Estanques',         'Oxígeno disuelto en estanques bajo 6 mg/L',            'S300','E300','SE301','OXY2','menor_que', 6.0,  NULL, 'alta',    true, 10),
        ('pH Fuera de Rango',         'pH del agua fuera del rango óptimo acuícola 6.5–8.5',  'S301','E300','SE302','PH1', 'fuera_rango', 6.5, 8.5,'media',   true, 20),
        ('Temperatura Bodega Alta',   'Temperatura de bodega supera 25°C',                    'S400','E400','SE401','TMP2','mayor_que', NULL, 25,   'media',   true, 30)
    `);

    // ─────────────────────────────────────────────
    // 7. TELEMETRÍA
    // ─────────────────────────────────────────────
    console.log('[7/7] Telemetría...');

    const telemetry = [];

    // S100 — Planta Demo: temperatura + voltaje (48h, cada 30min → 97 puntos)
    for (let i = 96; i >= 0; i--) {
      const t = new Date(now - i * 30 * 60 * 1000);
      const reg1 = rand(1350, 1650);
      const reg4 = rand(205, 235);
      telemetry.push([
        t,
        '151.65.22.2',
        { REG1: reg1, REG4: reg4, IR1: reg4 < 210 ? 'WARN' : 'OK' },
      ]);
    }

    // S200 — Mina: oxígeno + CO (24h, cada 15min → 97 puntos)
    for (let i = 96; i >= 0; i--) {
      const t = new Date(now - i * 15 * 60 * 1000);
      const oxy = rand(19.0, 21.0, 2);
      const co = rand(3, 28, 1);
      telemetry.push([t, '192.168.10.5', { OXY1: oxy, CO1: co }]);
    }

    // S300 — Estanques: O2 + temperatura agua (12h, cada 10min → 73 puntos)
    for (let i = 72; i >= 0; i--) {
      const t = new Date(now - i * 10 * 60 * 1000);
      const oxy = rand(5.5, 9.0, 2);
      const tmp = rand(11, 16, 1);
      telemetry.push([t, '10.0.1.20', { OXY2: oxy, TMP1: tmp }]);
    }

    // S301 — Estanques pH (12h, cada 10min → 73 puntos)
    for (let i = 72; i >= 0; i--) {
      const t = new Date(now - i * 10 * 60 * 1000);
      const ph = rand(6.2, 8.8, 2);
      telemetry.push([t, '10.0.1.21', { PH1: ph }]);
    }

    await insertTelemetry(telemetry);

    // ─────────────────────────────────────────────
    // RESUMEN
    // ─────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  ✓ Seed completado exitosamente          ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('\nEMPRESAS creadas:');
    console.log('  E100 — Empresa Demo SpA          (Industrial)');
    console.log('  E200 — Minera Los Andes Ltda      (Minería)');
    console.log('  E300 — Acuícola del Sur S.A.       (Acuicultura)');
    console.log('  E400 — Agropecuaria Valle Verde    (Agroindustria)');
    console.log('\nSUB-EMPRESAS: SE101, SE102 (E100) | SE201, SE202 (E200) | SE301, SE302 (E300)');
    console.log(
      '\nSITIOS: S100–S101 (Demo) | S200–S202 (Minera) | S300–S301 (Acuícola) | S400 (Agro)',
    );
    console.log('\nUSUARIOS — password: Test1234');
    console.log('  SuperAdmin:');
    console.log('    superadmin@gmail.com       → sin empresa');
    console.log('    nicolas@emeltec.cl         → sin empresa');
    console.log('  Admin:');
    console.log('    admin@gmail.com            → E100');
    console.log('    andrea.gonzalez@demo.cl    → E100');
    console.log('    roberto.morales@minera.cl  → E200');
    console.log('    carmen.vidal@acuicola.cl   → E300');
    console.log('    pablo.rojas@agro.cl        → E400');
    console.log('  Cliente:');
    console.log('    cliente@gmail.com          → E100 / SE101');
    console.log('    juan.perez@demo.cl         → E100 / SE101');
    console.log('    maria.silva@demo.cl        → E100 / SE102');
    console.log('    felipe.castro@minera.cl    → E200 / SE201');
    console.log('    diego.fuentes@minera.cl    → E200 / SE202');
    console.log('    valentina.rios@acuicola.cl → E300 / SE301');
    console.log('    carlos.mendoza@acuicola.cl → E300 / SE302');
    console.log('    patricia.herrera@agro.cl   → E400');
    console.log(`\nTELEMETRÍA: ${telemetry.length} registros en 4 sitios`);
    console.log('ALERTAS: 8 configuradas\n');
  } catch (err) {
    console.error('\n[ERROR] Seed falló:', err.message);
    console.error(err.stack);
  } finally {
    process.exit(0);
  }
}

seed();
