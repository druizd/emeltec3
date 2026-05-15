const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const c = require('../controllers/documentoController');

const MAX_MB = parseInt(process.env.DOCUMENTOS_MAX_MB || '25', 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

router.get('/', protect, c.listarDocumentos);
router.get('/:id', protect, c.obtenerDocumento);
router.get('/:id/download', protect, c.descargarDocumento);
router.post('/', protect, upload.single('file'), c.subirDocumento);
router.put('/:id', protect, c.actualizarDocumento);
router.delete('/:id', protect, c.eliminarDocumento);

// Manejo específico de error multer (e.g. archivo > 25MB).
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: `Archivo supera el límite de ${MAX_MB} MB` });
    }
    return res.status(400).json({ ok: false, error: `Error multer: ${err.code}` });
  }
  return res.status(500).json({ ok: false, error: err.message || 'Error subiendo archivo' });
});

module.exports = router;
