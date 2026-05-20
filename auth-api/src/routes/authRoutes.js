const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/start', authController.startLogin);
router.post('/setup/start', authController.startSetup);
router.post('/setup/complete', authController.completeSetup);
router.post('/login', authController.login);
router.post('/request-code', authController.requestCode);

module.exports = router;
