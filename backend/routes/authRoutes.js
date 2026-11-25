const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const authController = require('../controllers/authController');
const { protect, authLimiter, loginLimiter } = require('../middleware/authMiddleware');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};

router.post(
  '/register',
  authLimiter,
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
  ],
  validate,
  authController.registerStudent
);

router.post(
  '/login',
  loginLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  authController.loginStudent
);

router.post('/logout', authController.logoutStudent);
router.get('/me', protect, authController.getCurrentUser);

router.put(
  '/change-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long')
  ],
  validate,
  authController.changePassword
);

router.post(
  '/forgot-password',
  authLimiter,
  (req, res, next) => {
    const val = req.body.identifier || req.body.emailOrUsername;
    if (!val || typeof val !== 'string' || !val.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your registered username or email address'
      });
    }
    req.body.identifier = val.trim();
    req.body.emailOrUsername = val.trim();
    next();
  },
  authController.forgotPassword
);

router.post(
  '/reset-password',
  authLimiter,
  (req, res, next) => {
    const hasDirectCreds = req.body.username && req.body.email;
    const token = req.body.resetToken || req.body.token;

    if (!hasDirectCreds && (!token || typeof token !== 'string' || !token.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token or registered username and email are required'
      });
    }

    if (token) {
      req.body.resetToken = token.trim();
      req.body.token = token.trim();
    }

    if (!req.body.newPassword || typeof req.body.newPassword !== 'string' || req.body.newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }
    next();
  },
  authController.resetPassword
);

module.exports = router;
