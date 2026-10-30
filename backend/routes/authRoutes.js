const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, authLimiter } = require('../middleware/authMiddleware');

router.post('/register', authLimiter, authController.registerStudent);
router.post('/login', authLimiter, authController.loginStudent);
router.post('/logout', authController.logoutStudent);
router.get('/me', protect, authController.getCurrentUser);
router.put('/change-password', protect, authController.changePassword);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);

module.exports = router;
