/**
 * Seed de datos de prueba para Emeltec Platform
 * Ejecutar desde la raíz: node scripts/seed.js
 */
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME     || 'telemetry_platform',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'admin_password',
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 0. Columnas de auth que faltan en usuario ──────────────────────
    await client.query(`
      ALTER TABLE usuario
        ADD COLUMN IF NOT EXISTS password_hash  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS otp_hash       VARCHAR(255),
        ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
    `);
    console.log('✓ Columnas de auth verificadas');

    // ── 1. Empresas ────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO empresa (id, nombre, rut, sitios, tipo_empresa) VALUES
        ('E001', 'Acero del Sur SpA',      '76.111.111-1', 3, 'Industrial'),
        ('E002', 'AquaTech Ltda',          '76.222.222-2', 2, 'Sanitario'),
        ('E003', 'Energía Patagonia S.A.', '76.333.333-3', 1, 'Energía')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('✓ Empresas insertadas');

    // ── 2. Sub-empresas ────────────────────────────────────────────────
    await client.query(`
      INSERT INTO sub_empresa (id, nombre, rut, sitios, empresa_id) VALUES
        ('SE01', 'Planta Norte - Acero del Sur',   '76.111.111-2', 2, 'E001'),
        ('SE02', 'Planta Sur - Acero del Sur',     '76.111.111-3', 1, 'E001'),
        ('SE03', 'División Riego - AquaTech',      '76.222.222-3', 2, 'E002')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('✓ Sub-empresas insertadas');

    // ── 3. Usuarios (password = "Test1234" para todos) ─────────────────
    const passHash = await bcrypt.hash('Test1234', 10);

    const usuarios = [
      // SuperAdmin — sin empresa
      { id: 'U001', nombre: 'Carlos',   apellido: 'Ramírez',  email: 'superadmin@emeltec.cl',  telefono: '+56912345001', cargo: 'Super Administrador', tipo: 'SuperAdmin', empresa_id: null,  sub_empresa_id: null  },
      // Admin de E001
      { id: 'U002', nombre: 'Alejandra', apellido: 'Muñoz',   email: 'admin.acero@emeltec.cl',  telefono: '+56912345002', cargo: 'Administrador',        tipo: 'Admin',      empresa_id: 'E001', sub_empresa_id: null  },
      // Admin de E002
      { id: 'U003', nombre: 'Pedro',    apellido: 'Soto',     email: 'admin.aqua@emeltec.cl',   telefono: '+56912345003', cargo: 'Administrador',        tipo: 'Admin',      empresa_id: 'E002', sub_empresa_id: null  },
      // Gerente de SE01
      { id: 'U004', nombre: 'Valentina', apellido: 'Lagos',   email: 'gerente.norte@emeltec.cl', telefono: '+56912345004', cargo: 'Gerente de Planta',   tipo: 'Gerente',    empresa_id: 'E001', sub_empresa_id: 'SE01' },
      // Cliente de SE01
      { id: 'U005', nombre: 'Rodrigo',  apellido: 'Vega',     email: 'cliente.norte@emeltec.cl', telefono: '+56912345005', cargo: 'Operador',            tipo: 'Cliente',    empresa_id: 'E001', sub_empresa_id: 'SE01' },
      // Cliente de SE03
      { id: 'U006', nombre: 'Sofía',    apellido: 'Herrera',  email: 'cliente.riego@emeltec.cl', telefono: '+56912345006', cargo: 'Técnico de Campo',    tipo: 'Cliente',    empresa_id: 'E002', sub_empresa_id: 'SE03' },
    ];

    for (const u of usuarios) {
      await client.query(`
        INSERT INTO usuario (id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id, password_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;
      `, [u.id, u.nombre, u.apellido, u.email, u.telefono, u.cargo, u.tipo, u.empresa_id, u.sub_empresa_id, passHash]);
    }
    console.log('✓ Usuarios insertados (password: Test1234)');

    // ── 4. Sitios ──────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO sitio (id, descripcion, id_serial, empresa_id, ubicacion) VALUES
        ('S001', 'Línea de Producción A',     'SN-001-ACE', 'E001', 'Talcahuano, Biobío'),
        ('S002', 'Línea de Producción B',     'SN-002-ACE', 'E001', 'Talcahuano, Biobío'),
        ('S003', 'Estación de Bombeo Norte',  'SN-003-ACE', 'E001', 'Concepción, Biobío'),
        ('S004', 'Planta Tratamiento Aguas',  'SN-004-AQT', 'E002', 'Santiago, RM'),
        ('S005', 'Sistema Riego Sector 1',    'SN-005-AQT', 'E002', 'Rancagua, O''Higgins'),
        ('S006', 'Parque Eólico Patagonia',   'SN-006-ENP', 'E003', 'Punta Arenas, Magallanes')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('✓ Sitios insertados');

    // ── 5. Registros (reg_map) ─────────────────────────────────────────
    await client.query(`
      INSERT INTO reg_map (id, alias, d1, d2, tipo_dato, unidad, sitio_id) VALUES
        ('SN-001-ACE', 'Temperatura Horno',      'REG1', 'REG2', 'FLOAT', '°C',  'S001'),
        ('SN-002-ACE', 'Presión Hidráulica',     'REG1', NULL,   'FLOAT', 'bar', 'S002'),
        ('SN-003-ACE', 'Caudal Bomba',           'REG1', NULL,   'FLOAT', 'L/s', 'S003'),
        ('SN-004-AQT', 'pH Agua',                'REG1', NULL,   'FLOAT', 'pH',  'S004'),
        ('SN-005-AQT', 'Nivel Estanque',         'REG1', NULL,   'FLOAT', 'm',   'S005'),
        ('SN-006-ENP', 'Velocidad Viento',       'REG1', NULL,   'FLOAT', 'm/s', 'S006')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('✓ Registros (reg_map) insertados');

    // ── 6. Datos de telemetría (últimas 24h) ───────────────────────────
    const serials = [
      { id: 'SN-001-ACE', base: { REG1: 850, REG2: 860 }, variance: 30 },
      { id: 'SN-002-ACE', base: { REG1: 6.5 },            variance: 1.5 },
      { id: 'SN-003-ACE', base: { REG1: 45 },             variance: 10 },
      { id: 'SN-004-AQT', base: { REG1: 7.2 },            variance: 0.5 },
      { id: 'SN-005-AQT', base: { REG1: 3.8 },            variance: 0.8 },
      { id: 'SN-006-ENP', base: { REG1: 12.5 },           variance: 5 },
    ];

    let telemetryCount = 0;
    for (const s of serials) {
      for (let h = 24; h >= 0; h--) {
        const data = {};
        for (const [key, val] of Object.entries(s.base)) {
          data[key] = parseFloat((val + (Math.random() - 0.5) * 2 * s.variance).toFixed(2));
        }
        await client.query(
          `INSERT INTO equipo (time, id_serial, data) VALUES (NOW() - INTERVAL '${h} hours', $1, $2)`,
          [s.id, JSON.stringify(data)]
        );
        telemetryCount++;
      }
    }
    console.log(`✓ ${telemetryCount} registros de telemetría insertados`);

    // ── 7. Alertas ─────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO alertas (nombre, descripcion, sitio_id, empresa_id, sub_empresa_id, variable_key, condicion, umbral_alto, severidad, activa, creado_por) VALUES
        ('Temperatura Crítica Horno',  'Alerta si temperatura supera 900°C', 'S001', 'E001', 'SE01', 'REG1', 'mayor_que', 900,  'critica', TRUE, 'U002'),
        ('Presión Baja Hidráulica',    'Presión por debajo de 5 bar',        'S002', 'E001', 'SE01', 'REG1', 'menor_que', 5,    'alta',    TRUE, 'U002'),
        ('pH Fuera de Rango',          'pH fuera del rango 6.5 - 8.5',       'S004', 'E002', 'SE03', 'REG1', 'fuera_rango', NULL, 'media', TRUE, 'U003')
      ON CONFLICT DO NOTHING;
    `);
    console.log('✓ Alertas insertadas');

    await client.query('COMMIT');
    console.log('\n========================================');
    console.log('Seed completado exitosamente');
    console.log('========================================');
    console.log('\nUsuarios de prueba (password: Test1234):');
    console.log('  superadmin@emeltec.cl  → SuperAdmin');
    console.log('  admin.acero@emeltec.cl → Admin (Acero del Sur)');
    console.log('  admin.aqua@emeltec.cl  → Admin (AquaTech)');
    console.log('  gerente.norte@emeltec.cl → Gerente (Planta Norte)');
    console.log('  cliente.norte@emeltec.cl → Cliente (Planta Norte)');
    console.log('  cliente.riego@emeltec.cl → Cliente (División Riego)');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en seed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
