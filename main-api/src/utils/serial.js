/**
 * Resuelve el serial del registro mas reciente disponible en log_records.
 */
async function getLatestSerialId(pool) {
  const { rows } = await pool.query(
    `
    SELECT id_serial
    FROM equipo
    ORDER BY time DESC
    LIMIT 1
    `,
  );

  return rows[0]?.id_serial || null;
}

module.exports = {
  getLatestSerialId,
};
