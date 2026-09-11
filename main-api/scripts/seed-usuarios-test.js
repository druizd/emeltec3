/**
 * ============================================================================
 *  USUARIOS DE PRUEBA — uno por perfil (QA manual de permisos)
 * ============================================================================
 *
 *  Crea siete cuentas, una por cada valor de UserTipo (shared/permissions.ts),
 *  para recorrer la app con cada rol y detectar qué ve y qué puede hacer.
 *
 *  POR QUÉ NO ES UNA MIGRACIÓN
 *  ---------------------------
 *  `scripts/deploy-production.sh` aplica TODOS los .sql de infra-db/migrations
 *  en cada despliegue. Crear cuentas con acceso real en cada deploy, para
 *  siempre y sin que nadie lo pida, sería exactamente lo que no se quiere.
 *  Esto se corre a mano, cuando hace falta, y se revierte con --teardown.
 *
 *  LA CONTRASEÑA NO VIVE ACÁ
 *  -------------------------
 *  Se lee de la variable de entorno TEST_USER_PASSWORD y nunca se imprime ni
 *  se escribe en disco. Un default hardcodeado en el repo (como el '1234' de
 *  src/seed_auth.js) es una credencial publicada: cualquiera con acceso al
 *  código entra a producción. Si la variable falta, el script no corre.
 *
 *  ALCANCE DE LOS DATOS
 *  --------------------
 *  Por defecto los roles con alcance acotado (Admin, Gerente, Cliente,
 *  Empresa, SubEmpresa, Vendedor) se cuelgan de una empresa de prueba creada
 *  para esto, así ninguna cuenta nueva ve datos de clientes reales.
 *
 *  Eso es lo seguro, pero también lo menos revelador: un Cliente sin sitios
 *  muestra pantallas vacías y no prueba gran cosa. Para un QA de verdad,
 *  apuntá a datos existentes con TEST_EMPRESA_ID / TEST_SUB_EMPRESA_ID /
 *  TEST_SITIO_ID. Es una decisión consciente: esas cuentas van a poder leer
 *  esos datos.
 *
 *  USO
 *  ---
 *      # Ver qué haría, sin escribir nada:
 *      TEST_USER_PASSWORD='...' node scripts/seed-usuarios-test.js --dry-run
 *
 *      # Crear (o resetear) las siete cuentas:
 *      TEST_USER_PASSWORD='...' node scripts/seed-usuarios-test.js
 *
 *      # Con datos reales, para un QA representativo:
 *      TEST_USER_PASSWORD='...' TEST_EMPRESA_ID=E100 TEST_SITIO_ID=S127 \
 *        node scripts/seed-usuarios-test.js
 *
 *      # Borrar todo lo que creó (cuentas + empresa de prueba):
 *      node scripts/seed-usuarios-test.js --teardown
 *
 *  Es idempotente: volver a correrlo resetea la contraseña y el rol, no
 *  duplica cuentas (usuario.email es UNIQUE).
 * ============================================================================
 */
const bcrypt = require('bcrypt');
const db = require('../src/config/db');

const BCRYPT_COST = 10;

/** Dominio deliberadamente inexistente: si algo les manda un correo, rebota
 *  en vez de llegarle a una persona real. También los vuelve obvios en la
 *  lista de usuarios. */
const DOMINIO = 'qa.invalid';

const EMPRESA_TEST = { id: 'ETEST', nombre: 'QA — Empresa de prueba', tipo: 'Demo' };
const SUB_EMPRESA_TEST = { id: 'SETEST', nombre: 'QA — Sub empresa de prueba' };

/**
 * `alcance` describe qué se le asigna a cada rol, no es cosmético:
 *   empresa    -> empresa_id
 *   subempresa -> empresa_id + sub_empresa_id
 *   sitio      -> lo anterior + fila en usuario_sitio
 *   global     -> sin alcance (ve todo)
 */
const PERFILES = [
  { tipo: 'SuperAdmin', nombre: 'QA', apellido: 'SuperAdmin', alcance: 'global' },
  { tipo: 'Admin', nombre: 'QA', apellido: 'Admin', alcance: 'empresa' },
  { tipo: 'Gerente', nombre: 'QA', apellido: 'Gerente', alcance: 'subempresa' },
  { tipo: 'Cliente', nombre: 'QA', apellido: 'Cliente', alcance: 'sitio' },
  { tipo: 'Empresa', nombre: 'QA', apellido: 'Empresa', alcance: 'empresa' },
  { tipo: 'SubEmpresa', nombre: 'QA', apellido: 'SubEmpresa', alcance: 'subempresa' },
  { tipo: 'Vendedor', nombre: 'QA', apellido: 'Vendedor', alcance: 'subempresa' },
];

const email = (tipo) => `qa.${tipo.toLowerCase()}@${DOMINIO}`;
/** id estable y reconocible (VARCHAR(10)); sin random, para que sea idempotente. */
const idDe = (tipo) => `UQA${tipo.slice(0, 6).toUpperCase()}`.slice(0, 10);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TEARDOWN = args.includes('--teardown');

function log(...a) {
  console.log('[seed-test]', ...a);
}

async function teardown() {
  log('Borrando usuarios de prueba…');
  const { rowCount } = await db.query(`DELETE FROM usuario WHERE email LIKE $1`, [`%@${DOMINIO}`]);
  log(`  ${rowCount} usuario(s) eliminado(s).`);

  // La empresa de prueba solo se borra si la creamos nosotros y ya no cuelga
  // nadie: si alguien le asocio sitios reales, no es nuestra para borrar.
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM sitio   WHERE empresa_id = $1)::int AS sitios,
            (SELECT COUNT(*) FROM usuario WHERE empresa_id = $1)::int AS usuarios`,
    [EMPRESA_TEST.id],
  );
  const uso = rows[0] ?? { sitios: 0, usuarios: 0 };
  if (uso.sitios === 0 && uso.usuarios === 0) {
    await db.query(`DELETE FROM sub_empresa WHERE id = $1`, [SUB_EMPRESA_TEST.id]);
    await db.query(`DELETE FROM empresa WHERE id = $1`, [EMPRESA_TEST.id]);
    log('  Empresa de prueba eliminada.');
  } else {
    log(
      `  Empresa de prueba CONSERVADA: tiene ${uso.sitios} sitio(s) y ${uso.usuarios} usuario(s) ` +
        'que no son de este script. Revisala a mano.',
    );
  }
}

/** Resuelve el alcance: datos reales si los pasaron, si no la empresa de prueba. */
async function resolverAlcance() {
  const empresaId = process.env.TEST_EMPRESA_ID?.trim();
  const subEmpresaId = process.env.TEST_SUB_EMPRESA_ID?.trim();
  const sitioId = process.env.TEST_SITIO_ID?.trim();

  if (empresaId) {
    const { rows } = await db.query(`SELECT id, nombre FROM empresa WHERE id = $1`, [empresaId]);
    if (rows.length === 0) throw new Error(`TEST_EMPRESA_ID='${empresaId}' no existe.`);

    let sub = subEmpresaId;
    if (sub) {
      const r = await db.query(`SELECT id FROM sub_empresa WHERE id = $1 AND empresa_id = $2`, [
        sub,
        empresaId,
      ]);
      if (r.rows.length === 0) {
        throw new Error(`TEST_SUB_EMPRESA_ID='${sub}' no existe o no es de ${empresaId}.`);
      }
    } else {
      // Sin sub explícita tomamos la primera de la empresa: un Gerente sin
      // sub_empresa_id no tiene alcance y la prueba no muestra nada.
      const r = await db.query(
        `SELECT id FROM sub_empresa WHERE empresa_id = $1 ORDER BY id LIMIT 1`,
        [empresaId],
      );
      sub = r.rows[0]?.id ?? null;
    }

    let sitio = sitioId ?? null;
    if (sitio) {
      const r = await db.query(`SELECT id FROM sitio WHERE id = $1 AND empresa_id = $2`, [
        sitio,
        empresaId,
      ]);
      if (r.rows.length === 0) {
        throw new Error(`TEST_SITIO_ID='${sitio}' no existe o no es de ${empresaId}.`);
      }
    } else if (sub) {
      const r = await db.query(
        `SELECT id FROM sitio WHERE empresa_id = $1 AND sub_empresa_id = $2 ORDER BY id LIMIT 1`,
        [empresaId, sub],
      );
      sitio = r.rows[0]?.id ?? null;
    }

    log(
      `Alcance: DATOS REALES — empresa=${empresaId} sub=${sub ?? '(ninguna)'} sitio=${sitio ?? '(ninguno)'}`,
    );
    log('  Estas cuentas van a poder LEER datos productivos de esa empresa.');
    return { empresaId, subEmpresaId: sub, sitioId: sitio, real: true };
  }

  if (DRY_RUN) {
    log(`Alcance: empresa de prueba ${EMPRESA_TEST.id} (se crearía).`);
    return {
      empresaId: EMPRESA_TEST.id,
      subEmpresaId: SUB_EMPRESA_TEST.id,
      sitioId: null,
      real: false,
    };
  }

  await db.query(
    `INSERT INTO empresa (id, nombre, tipo_empresa) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [EMPRESA_TEST.id, EMPRESA_TEST.nombre, EMPRESA_TEST.tipo],
  );
  await db.query(
    `INSERT INTO sub_empresa (id, nombre, empresa_id) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [SUB_EMPRESA_TEST.id, SUB_EMPRESA_TEST.nombre, EMPRESA_TEST.id],
  );
  log(`Alcance: empresa de prueba ${EMPRESA_TEST.id} (aislada, sin datos reales).`);
  log('  Ojo: sin sitios, las pantallas de los roles acotados van a salir vacías.');
  log('  Para un QA representativo, volvé a correr con TEST_EMPRESA_ID / TEST_SITIO_ID.');
  return {
    empresaId: EMPRESA_TEST.id,
    subEmpresaId: SUB_EMPRESA_TEST.id,
    sitioId: null,
    real: false,
  };
}

async function seed() {
  const password = process.env.TEST_USER_PASSWORD;
  if (!TEARDOWN) {
    if (!password || password.length < 12) {
      throw new Error(
        'Falta TEST_USER_PASSWORD (mínimo 12 caracteres). Son cuentas con acceso real: ' +
          'elegí una contraseña fuerte y no la dejes escrita en ningún archivo del repo.',
      );
    }
  }

  if (TEARDOWN) {
    await teardown();
    return;
  }

  const alcance = await resolverAlcance();
  const hash = DRY_RUN ? null : await bcrypt.hash(password, BCRYPT_COST);

  for (const p of PERFILES) {
    const id = idDe(p.tipo);
    const mail = email(p.tipo);
    const empresa = p.alcance === 'global' ? null : alcance.empresaId;
    const sub = ['subempresa', 'sitio'].includes(p.alcance) ? alcance.subEmpresaId : null;

    if (DRY_RUN) {
      log(
        `[dry-run] ${p.tipo.padEnd(11)} ${mail.padEnd(30)} empresa=${empresa ?? '—'} sub=${sub ?? '—'}`,
      );
      continue;
    }

    await db.query(
      `INSERT INTO usuario (
         id, nombre, apellido, email, cargo, tipo, empresa_id, sub_empresa_id,
         password_hash, auth_mode, password_set_at, activated_at, activo
       )
       VALUES ($1,$2,$3,$4,'Cuenta de prueba QA',$5,$6,$7,$8,'password',NOW(),NOW(),TRUE)
       ON CONFLICT (email) DO UPDATE SET
         tipo            = EXCLUDED.tipo,
         empresa_id      = EXCLUDED.empresa_id,
         sub_empresa_id  = EXCLUDED.sub_empresa_id,
         password_hash   = EXCLUDED.password_hash,
         auth_mode       = 'password',
         activo          = TRUE,
         -- Reset del lockout: si el QA anterior dejó la cuenta bloqueada por
         -- intentos fallidos, volver a sembrar tiene que dejarla usable.
         failed_logins   = 0,
         locked_until    = NULL,
         password_set_at = NOW(),
         updated_at      = NOW()`,
      [id, p.nombre, p.apellido, mail, p.tipo, empresa, sub, hash],
    );

    if (p.alcance === 'sitio' && alcance.sitioId) {
      await db.query(
        `INSERT INTO usuario_sitio (usuario_id, sitio_id)
         SELECT u.id, $2 FROM usuario u WHERE u.email = $1
         ON CONFLICT DO NOTHING`,
        [mail, alcance.sitioId],
      );
    }

    log(`${p.tipo.padEnd(11)} → ${mail}`);
  }

  if (!DRY_RUN) {
    log('');
    log('Listo. Las siete cuentas usan la contraseña que pasaste en TEST_USER_PASSWORD.');
    log('Cuando termines el QA: node scripts/seed-usuarios-test.js --teardown');
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-test] ERROR:', err.message);
    process.exit(1);
  });
