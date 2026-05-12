/**
 * Motor de monitoreo de alertas.
 * Corre como job en background: evalua alertas activas contra los datos
 * mas recientes de equipo y dispara eventos + notificaciones por email.
 *
 * Las condiciones (mayor_que, menor_que, etc.) y umbrales se leen
 * directamente desde la tabla `alertas`.
 *
 * Routing de notificaciones:
 *   SuperAdmin -> recibe TODOS los eventos
 *   Creador de la alerta -> recibe sus propios eventos
 */

const pool = require('../config/db');
const { sendAlertEmail } = require('./emailService');

const POLL_INTERVAL_MS = parseInt(process.env.ALERT_POLL_MS || '60000', 10);
const DIAS_VALIDOS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

let intervalHandle = null;

function evalCondicion(condicion, valorNum, umbralBajo, umbralAlto) {
  switch (condicion) {
    case 'mayor_que':
      return valorNum > umbralBajo;
    case 'menor_que':
      return valorNum < umbralBajo;
    case 'igual_a':
      return valorNum === umbralBajo;
    case 'fuera_rango':
      return valorNum < umbralBajo || valorNum > umbralAlto;
    default:
      return false;
  }
}

function diaActual() {
  const localDate = new Date(
    new Date().toLocaleString('en-US', {
      timeZone: process.env.ALERT_TIMEZONE || 'America/Santiago',
    }),
  );
  return DIAS_VALIDOS[localDate.getDay()];
}

function estaActivoHoy(alerta) {
  if (!Array.isArray(alerta.dias_activos) || alerta.dias_activos.length === 0) return true;
  return alerta.dias_activos.includes(diaActual());
}

function formatValor(valor) {
  return valor === null || valor === undefined ? 'sin dato disponible' : String(valor);
}

function formatCondicion(alerta) {
  switch (alerta.condicion) {
    case 'mayor_que':
      return `debe ser mayor que ${alerta.umbral_bajo}`;
    case 'menor_que':
      return `debe ser menor que ${alerta.umbral_bajo}`;
    case 'igual_a':
      return `debe ser igual a ${alerta.umbral_bajo}`;
    case 'fuera_rango':
      return `debe estar fuera del rango ${alerta.umbral_bajo} - ${alerta.umbral_alto}`;
    case 'sin_datos':
      return `sin datos durante ${alerta.cooldown_minutos} minutos`;
    default:
      return alerta.condicion;
  }
}

function buildMensajeClaro(alerta, valor) {
  const sitio = alerta.sitio_desc || alerta.sitio_id;
  const severidad = alerta.severidad.toUpperCase();
  const valorDetectado = formatValor(valor);
  const condicion = formatCondicion(alerta);

  if (alerta.condicion === 'sin_datos') {
    return `[${severidad}] Sin datos en ${sitio}. Equipo ${alerta.id_serial} no reporta informacion hace mas de ${alerta.cooldown_minutos} minutos.`;
  }

  return `[${severidad}] ${sitio}. Variable ${alerta.variable_key}: valor detectado ${valorDetectado}. Regla: ${condicion}.`;
}

async function evaluarAlerta(client, alerta) {
  if (!estaActivoHoy(alerta)) return;

  const { rows: coolRows } = await client.query(
    `SELECT triggered_at FROM alertas_eventos
     WHERE alerta_id = $1
       AND triggered_at > NOW() - ($2 || ' minutes')::INTERVAL
     ORDER BY triggered_at DESC LIMIT 1`,
    [alerta.id, alerta.cooldown_minutos],
  );
  if (coolRows.length > 0) return;

  if (alerta.condicion === 'sin_datos') {
    const { rows } = await client.query(
      `SELECT received_at FROM equipo
       WHERE id_serial = $1 AND received_at > NOW() - ($2 || ' minutes')::INTERVAL
       LIMIT 1`,
      [alerta.id_serial, alerta.cooldown_minutos],
    );
    if (rows.length === 0) await insertarEvento(client, alerta, null, null);
    return;
  }

  const { rows } = await client.query(
    `SELECT data FROM equipo WHERE id_serial = $1 ORDER BY time DESC LIMIT 1`,
    [alerta.id_serial],
  );
  if (!rows.length) return;

  const rawVal = rows[0].data[alerta.variable_key];
  if (rawVal === undefined) return;

  const valorNum = parseFloat(rawVal);
  const valorTexto = String(rawVal);

  if (
    !isNaN(valorNum) &&
    evalCondicion(alerta.condicion, valorNum, alerta.umbral_bajo, alerta.umbral_alto)
  ) {
    await insertarEvento(client, alerta, valorNum, valorTexto);
  }
}

async function insertarEvento(client, alerta, valorNum, valorTexto) {
  const mensaje = buildMensajeClaro(alerta, valorNum);
  const alertaContext = {
    ...alerta,
    valor_detectado: formatValor(valorNum),
    condicion_texto: formatCondicion(alerta),
  };

  const { rows } = await client.query(
    `INSERT INTO alertas_eventos
       (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key,
        valor_detectado, valor_texto, mensaje, severidad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      alerta.id,
      alerta.empresa_id,
      alerta.sub_empresa_id ?? null,
      alerta.sitio_id,
      alerta.variable_key,
      valorNum,
      valorTexto,
      mensaje,
      alerta.severidad,
    ],
  );

  notificarUsuarios(alertaContext, rows[0].id, mensaje).catch((err) =>
    console.error('[alertaService] Error notificando:', err.message),
  );
}

async function notificarUsuarios(alerta, eventoId, mensaje) {
  const { rows: usuarios } = await pool.query(
    `SELECT DISTINCT id, email, nombre, apellido FROM usuario
     WHERE tipo = 'SuperAdmin' OR id = $1`,
    [alerta.creado_por],
  );

  for (const u of usuarios) {
    await sendAlertEmail(u.email, `${u.nombre} ${u.apellido || ''}`.trim(), mensaje, alerta).catch(
      () => {},
    );
  }

  await pool.query('UPDATE alertas_eventos SET notificado = TRUE WHERE id = $1', [eventoId]);
}

async function runCycle() {
  let client;
  try {
    client = await pool.connect();

    const { rows: alertas } = await client.query(
      `SELECT a.id, a.nombre, a.empresa_id, a.sub_empresa_id, a.sitio_id, a.creado_por,
              a.variable_key, a.condicion, a.umbral_bajo, a.umbral_alto,
              a.severidad, a.cooldown_minutos, a.dias_activos,
              s.id_serial, s.descripcion AS sitio_desc
       FROM alertas a
       JOIN sitio s ON s.id = a.sitio_id
       WHERE a.activa = TRUE`,
    );

    for (const alerta of alertas) {
      await evaluarAlerta(client, alerta).catch((err) =>
        console.error(`[alertaService] Error en alerta ${alerta.id}:`, err.message),
      );
    }
  } catch (err) {
    console.error('[alertaService] Error en ciclo:', err.message);
  } finally {
    if (client) client.release();
  }
}

function start() {
  if (intervalHandle) return;
  console.log(`[alertaService] Iniciando monitoreo (intervalo: ${POLL_INTERVAL_MS}ms)`);
  runCycle();
  intervalHandle = setInterval(runCycle, POLL_INTERVAL_MS);
}

function stop() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  console.log('[alertaService] Monitoreo detenido');
}

module.exports = { start, stop };
