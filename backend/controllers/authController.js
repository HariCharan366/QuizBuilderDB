const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is missing.');
  }
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
};

// @desc    Register a new student
// @route   POST /api/auth/register
// @access  Public
exports.registerStudent = async (req, res) => {
  try {
    const { fullName, username, email, password } = req.body;

    if (!fullName || !username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide full name, username, and password.'
      });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email ? email.trim().toLowerCase() : undefined;

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters long.'
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters long.'
      });
    }

    // 1. Check duplicate username
    const usernameExists = await User.findOne({ username: cleanUsername });
    if (usernameExists) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken. Please choose another username.'
      });
    }

    // 2. Check duplicate email if provided
    if (cleanEmail) {
      const emailExists = await User.findOne({ email: cleanEmail });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'An account with this email address already exists.'
        });
      }
    }

    const student = await User.create({
      fullName: fullName.trim(),
      username: cleanUsername,
      email: cleanEmail || `${cleanUsername}@student.quizbuilder.edu`,
      password: password,
      role: 'student',
      lastLoginAt: new Date(),
      loginCount: 1
    });

    const token = generateToken(student);

    res.status(201).json({
      success: true,
      message: 'Account created successfully! You can now login.',
      token,
      user: {
        id: student._id,
        fullName: student.fullName,
        username: student.username,
        email: student.email,
        role: student.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during registration.'
    });
  }
};

// @desc    Student login
// @route   POST /api/auth/login
// @access  Public
exports.loginStudent = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password.'
      });
    }

    const cleanIdentifier = username.trim().toLowerCase();

    // Support logging in via username or email
    const student = await User.findOne({
      $or: [{ username: cleanIdentifier }, { email: cleanIdentifier }],
      role: 'student'
    });

    if (!student) {
      return res.status(400).json({
        success: false,
        message: 'Username or email not found.'
      });
    }

    // Check if account is blocked by Admin
    if (student.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact the administrator.'
      });
    }

    const isMatch = await student.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect password.'
      });
    }

    student.lastLoginAt = new Date();
    student.loginCount = (student.loginCount || 0) + 1;
    await student.save();

    const token = generateToken(student);

    res.status(200).json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id: student._id,
        fullName: student.fullName,
        username: student.username,
        email: student.email,
        role: student.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login.'
    });
  }
};

// @desc    Student logout
// @route   POST /api/auth/logout
// @access  Public
exports.logoutStudent = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully.'
  });
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Protected
exports.getCurrentUser = async (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      fullName: req.user.fullName,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      isBlocked: req.user.isBlocked,
      createdAt: req.user.createdAt
    }
  });
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Protected
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both current and new password.'
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 4 characters long.'
      });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password does not match.'
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully!'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to change password.'
    });
  }
};

// @desc    Forgot password (request reset token)
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { identifier } = req.body; // username or email

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your registered username or email.'
      });
    }

    const clean = identifier.trim().toLowerCase();
    const user = await User.findOne({
      $or: [{ username: clean }, { email: clean }]
    });

    if (!user) {
      // Security best practice: don't reveal if account exists
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this username/email, a password reset token has been generated.'
      });
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(24).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset code generated successfully. Use this code to reset your password.',
      resetToken: resetToken // Returned for student verification
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating password reset token.'
    });
  }
};

// @desc    Reset password using token
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide reset token and new password.'
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 4 characters long.'
      });
    }

    const user = await User.findOne({
      resetPasswordToken: resetToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.'
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful! You can now log in with your new password.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error resetting password.'
    });
  }
};
