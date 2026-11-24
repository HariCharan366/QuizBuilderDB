const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');

// Protect route with JWT verification and tokenVersion validation
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied: Authentication token required.'
    });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is missing.');
    }
    const decoded = jwt.verify(token, secret);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Account belonging to this session token no longer exists.'
      });
    }

    // Reject blocked accounts immediately
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact the administrator.'
      });
    }

    // Verify tokenVersion: invalidates tokens upon logout, password change, or admin revoke
    if (decoded.tokenVersion !== undefined && user.tokenVersion !== undefined) {
      if (Number(decoded.tokenVersion) !== Number(user.tokenVersion)) {
        return res.status(401).json({
          success: false,
          message: 'Session has been invalidated. Please log in again.'
        });
      }
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Session expired or invalid token.'
    });
  }
};

// Generic Role-based access control guard
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied: Role '${req.user.role}' is not authorized to access this resource.`
      });
    }
    next();
  };
};

// Admin-only role guard (superadmin or admin)
const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied: Administrator privileges required.'
  });
};

// Superadmin-only guard
const superadminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied: Superadmin privileges required.'
  });
};

// Invigilator or Above guard
const invigilatorOrAbove = (req, res, next) => {
  if (req.user && ['superadmin', 'admin', 'invigilator'].includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied: Invigilator or higher privileges required.'
  });
};

// Viewer or Above guard
const viewerOrAbove = (req, res, next) => {
  if (req.user && ['superadmin', 'admin', 'invigilator', 'viewer'].includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied: Elevated privileges required.'
  });
};

// Stricter Rate limiter for login endpoints (max 15 attempts per 15 minutes per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for authentication attempts (e.g. registration, forgot password)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    message: 'Too many authentication requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// General API Rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  protect,
  adminOnly,
  superadminOnly,
  invigilatorOrAbove,
  viewerOrAbove,
  authorizeRoles,
  loginLimiter,
  authLimiter,
  apiLimiter
};

