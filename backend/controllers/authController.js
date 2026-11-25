const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

// Helper to validate password policy: minimum 8 characters, at least 1 letter, at least 1 number
const validatePasswordPolicy = (password) => {
  if (!password || typeof password !== 'string') return false;
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);
};

// Generate JWT token with tokenVersion and 2-hour expiration
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is missing.');
  }
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion || 0
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
  );
};

// Helper to configure email transporter for password resets
const createMailTransporter = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return null;
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

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = email ? String(email).trim().toLowerCase() : undefined;

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters long.'
      });
    }

    // Enforce Password Policy (minimum 8 chars, 1 letter, 1 number)
    if (!validatePasswordPolicy(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain at least one letter and one number.'
      });
    }

    // 1. Check duplicate username (usernames must remain unique)
    const usernameExists = await User.findOne({ username: cleanUsername });
    if (usernameExists) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken. Please choose another username.'
      });
    }

    // Multiple accounts can be registered with the same email address
    const student = await User.create({
      fullName: String(fullName).trim(),
      username: cleanUsername,
      email: cleanEmail || `${cleanUsername}@student.quizbuilder.edu`,
      password: password,
      role: 'student',
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockUntil: null,
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

// @desc    Student login with account lockout and anti-enumeration protections
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

    const cleanIdentifier = String(username).trim().toLowerCase();

    // Query student account (prefer exact username lookup so multiple accounts sharing an email don't conflict)
    let student = await User.findOne({ username: cleanIdentifier, role: 'student' });
    if (!student) {
      student = await User.findOne({ email: cleanIdentifier, role: 'student' });
    }

    // 1. Account Lockout Check
    if (student && student.isAccountLocked()) {
      const remainingMinutes = Math.ceil((student.lockUntil.getTime() - Date.now()) / (60 * 1000));
      return res.status(423).json({
        success: false,
        message: `Account is temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s).`
      });
    }

    // 2. Blocked Student Check
    if (student && student.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact the administrator.'
      });
    }

    // 3. Password Verification (Prevent username enumeration: return generic 'Invalid credentials.')
    const isMatch = student ? await student.matchPassword(String(password)) : false;

    if (!student || !isMatch) {
      if (student) {
        student.failedLoginAttempts = (student.failedLoginAttempts || 0) + 1;
        // Lock account after 5 consecutive failed login attempts for 15 minutes
        if (student.failedLoginAttempts >= 5) {
          student.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        }
        await student.save();
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
      });
    }

    // 4. Successful Login: Reset failed attempts & unlock counter
    student.failedLoginAttempts = 0;
    student.lockUntil = null;
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

// @desc    Student logout (Invalidates current session tokens server-side)
// @route   POST /api/auth/logout
// @access  Public / Protected
exports.logoutStudent = async (req, res) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.id) {
          await User.findByIdAndUpdate(decoded.id, { $inc: { tokenVersion: 1 } });
        }
      } catch (e) {}
    }
    if (req.user && req.user._id) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
    }
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  }
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

    if (!validatePasswordPolicy(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long and contain at least one letter and one number.'
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
    // Invalidate existing sessions on password change
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully! Please log in again with your new password.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to change password.'
    });
  }
};

// @desc    Forgot password (request reset token via email with SHA-256 hashing)
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const rawIdentifier = req.body.identifier || req.body.emailOrUsername;

    if (!rawIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your registered username or email.'
      });
    }

    const clean = String(rawIdentifier).trim().toLowerCase();

    // Security requirement: Only students can use this reset flow. Admin password recovery is strictly prohibited.
    const user = await User.findOne({
      $or: [{ username: clean }, { email: clean }],
      role: 'student'
    });

    // Security best practice: Return identical generic message whether or not account exists (prevents account enumeration)
    const genericResponse = {
      success: true,
      message: 'If an account exists with this username or email, password reset instructions have been dispatched.'
    };

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    // Generate cryptographically secure random token (32 bytes = 64 hex characters)
    const rawResetToken = crypto.randomBytes(32).toString('hex');

    // Store ONLY SHA-256 hash in database
    const hashedResetToken = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    user.resetPasswordToken = hashedResetToken;
    // Token expiry set strictly to 15 minutes
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    // Send email via Nodemailer if SMTP configured
    const transporter = createMailTransporter();
    if (transporter && user.email) {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/index.html?token=${rawResetToken}#reset`;
      const mailOptions = {
        from: process.env.SMTP_FROM || '"QuizBuilder Security" <noreply@quizbuilder.edu>',
        to: user.email,
        subject: 'QuizBuilder — Password Reset Request',
        html: `
          <h3>QuizBuilder Password Reset</h3>
          <p>Hello ${user.fullName},</p>
          <p>You requested a password reset for your QuizBuilder account (@${user.username}).</p>
          <p>Please use the following reset token within 15 minutes to reset your password:</p>
          <p><strong>${rawResetToken}</strong></p>
          <p>Or click this link: <a href="${resetUrl}">${resetUrl}</a></p>
          <p>If you did not request this, please ignore this email.</p>
        `
      };
      transporter.sendMail(mailOptions).catch(err => {
        console.warn('[Mail Warning] Failed to send reset email:', err.message);
      });
    }

    // NEVER return raw or hashed token in the API response
    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing password reset request.'
    });
  }
};

// @desc    Reset password using single-use token
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const resetToken = req.body.resetToken || req.body.token;
    const { newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide reset token and new password.'
      });
    }

    if (!validatePasswordPolicy(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long and contain at least one letter and one number.'
      });
    }

    // Hash the supplied token to compare with the SHA-256 hash stored in MongoDB
    const hashedToken = crypto.createHash('sha256').update(String(resetToken).trim()).digest('hex');

    // Find student with matching unexpired hashed token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
      role: 'student'
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.'
      });
    }

    // Update password
    user.password = newPassword;
    // Single-use token: invalidate immediately
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    // Invalidate any existing sessions
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    // Reset lockout counters
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful! You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password.'
    });
  }
};

module.exports.validatePasswordPolicy = validatePasswordPolicy;
