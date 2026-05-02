/**
 * Rutas de consulta simplificada sobre datos historicos y ultimo registro.
 */
const express = require("express");
const router = express.Router();

const {
  insertData,
  getData,
  getLatest,
  getByRange,
  getByPreset,
  getAvailableKeys,
  getOnlineValues,
} = require("../controllers/Datacontroller");

router.post("/", insertData);
router.get("/", getData);
router.get("/latest", getLatest);
router.get("/online", getOnlineValues);
router.get("/range", getByRange);
router.get("/preset", getByPreset);
router.get("/keys", getAvailableKeys);

module.exports = router;
