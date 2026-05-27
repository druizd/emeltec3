const express = require('express');
const router = express.Router();
const { getStatus } = require('../controllers/statusController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

router.get('/', protect, authorizeRoles('SuperAdmin', 'Admin'), getStatus);

module.exports = router;
