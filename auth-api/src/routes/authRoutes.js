const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/authController');

router.post('/login',        authController.login);
router.post('/request-code', authController.requestCode);

module.exports = router;
