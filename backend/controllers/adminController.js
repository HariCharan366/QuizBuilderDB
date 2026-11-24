const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const User = require('../models/User');
const Question = require('../models/Question');
const Result = require('../models/Result');
const Exam = require('../models/Exam');
const ExamSession = require('../models/ExamSession');
const AuditLog = require('../models/AuditLog');

// Secondary admin password confirmation helper for destructive actions
async function verifyAdminPassword(req) {
  const adminPassword = req.body?.adminPassword || req.headers['x-admin-password'];
  if (!adminPassword) {
    return { ok: false, message: 'Administrative password confirmation required for this dangerous operation.' };
  }
  if (!req.user) {
    return { ok: false, message: 'Authentication required.' };
  }
  const admin = await User.findById(req.user._id);
  if (!admin) {
    return { ok: false, message: 'Admin account not found.' };
  }
  const isMatch = await admin.matchPassword(adminPassword);
  if (!isMatch) {
    return { ok: false, message: 'Invalid admin confirmation password.' };
  }
  return { ok: true, admin };
}

const generateAdminToken = (user) => {
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

// @desc    Admin authentication with lockout & security hardening
// @route   POST /api/admin/login
// @access  Public
exports.loginAdmin = async (req, res) => {
  try {
    const { id, password } = req.body;

    if (!id || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide Admin ID and Password.'
      });
    }

    const cleanId = String(id).trim();

    let admin = await User.findOne({
      username: cleanId,
      role: { $in: ['admin', 'superadmin', 'invigilator', 'viewer'] }
    });

    const envAdminId = process.env.ADMIN_ID;
    const envAdminPass = process.env.ADMIN_PASSWORD;

    if (!admin && envAdminId && envAdminPass && cleanId === envAdminId && password === envAdminPass) {
      admin = await User.create({
        fullName: 'System Administrator',
        username: envAdminId,
        email: 'admin@quizbuilder.edu',
        password: envAdminPass,
        role: 'superadmin',
        tokenVersion: 0,
        failedLoginAttempts: 0,
        lockUntil: null
      });
    }

    // 1. Account Lockout Check
    if (admin && admin.isAccountLocked()) {
      const remainingMinutes = Math.ceil((admin.lockUntil.getTime() - Date.now()) / (60 * 1000));
      return res.status(423).json({
        success: false,
        message: `Administrative account is temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s).`
      });
    }

    const isMatch = admin ? await admin.matchPassword(password) : false;

    if (!admin || !isMatch) {
      if (admin) {
        admin.failedLoginAttempts = (admin.failedLoginAttempts || 0) + 1;
        if (admin.failedLoginAttempts >= 5) {
          admin.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15-minute lockout
        }
        await admin.save();
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid Admin ID or Password.'
      });
    }

    // 2. Successful Login: reset failed attempts
    admin.failedLoginAttempts = 0;
    admin.lockUntil = null;
    admin.lastLoginAt = new Date();
    admin.loginCount = (admin.loginCount || 0) + 1;
    await admin.save();

    const token = generateAdminToken(admin);

    res.status(200).json({
      success: true,
      message: 'Admin authenticated successfully',
      token,
      user: {
        id: admin._id,
        fullName: admin.fullName,
        username: admin.username,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during admin login.'
    });
  }
};

// @desc    Get comprehensive dynamic dashboard statistics
// @route   GET /api/admin/stats
// @access  Protected Admin
exports.getAdminStats = async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalQuestions = await Question.countDocuments();
    const totalExams = await Exam.countDocuments();
    const totalAttempts = await Result.countDocuments();
    const totalExamsStarted = await ExamSession.countDocuments();
    const totalExamsSubmitted = await Result.countDocuments();
    const currentlyActiveExams = await ExamSession.countDocuments({ status: 'active', expiresAt: { $gt: new Date() } });
    const passedAttempts = await Result.countDocuments({ status: 'Passed' });
    const failedAttempts = await Result.countDocuments({ status: 'Failed' });

    // Calculate average score & percentage
    const avgStats = await Result.aggregate([
      {
        $group: {
          _id: null,
          avgPercentage: { $avg: '$percentage' },
          avgScore: { $avg: '$score' },
          highestScore: { $max: '$score' },
          lowestScore: { $min: '$score' }
        }
      }
    ]);

    const activeExam = await Exam.findOne({ isActive: true });

    // Recent 5 registrations
    const recentStudents = await User.find({ role: 'student' })
      .select('fullName username email createdAt isBlocked')
      .sort({ createdAt: -1 })
      .limit(5);

    // Recent 5 submissions
    const recentResults = await Result.find()
      .select('studentName username score total percentage status timeTaken submittedAt')
      .sort({ createdAt: -1 })
      .limit(5);

    const statsData = {
      totalStudents,
      totalExamsStarted,
      totalExamsSubmitted,
      currentlyActiveExams,
      averageScore: avgStats.length > 0 ? Math.round(avgStats[0].avgPercentage || 0) : 0,
      totalQuestions,
      totalExams: totalExams || 1,
      totalAttempts,
      completedExams: totalAttempts,
      passedAttempts,
      failedAttempts,
      passRate: totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0,
      avgPercentage: avgStats.length > 0 ? Math.round(avgStats[0].avgPercentage || 0) : 0,
      avgScore: avgStats.length > 0 ? Math.round((avgStats[0].avgScore || 0) * 10) / 10 : 0,
      highestScore: avgStats.length > 0 ? avgStats[0].highestScore : 0,
      lowestScore: avgStats.length > 0 ? avgStats[0].lowestScore : 0,
      examDuration: activeExam ? activeExam.durationMinutes : 15,
      recentStudents,
      recentResults
    };

    res.status(200).json({
      success: true,
      stats: statsData,
      // Direct access properties:
      totalStudents,
      totalExams: statsData.totalExams,
      totalExamsStarted,
      totalExamsSubmitted,
      currentlyActiveExams,
      averageScore: statsData.averageScore,
      totalQuestions,
      totalAttempts,
      passedAttempts,
      failedAttempts,
      passRate: statsData.passRate,
      examDuration: statsData.examDuration
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dynamic stats.'
    });
  }
};

// @desc    Get registered student roster with search functionality and attempt metrics
// @route   GET /api/admin/students
// @access  Protected Admin
exports.getStudentsList = async (req, res) => {
  try {
    const { search } = req.query;
    let query = { role: 'student' };

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { fullName: regex },
        { username: regex },
        { email: regex }
      ];
    }

    const students = await User.find(query)
      .select('fullName username email isBlocked createdAt lastLoginAt loginCount')
      .sort({ createdAt: -1 })
      .lean();

    const studentIds = students.map(s => s._id);
    const usernames = students.map(s => (s.username || '').toLowerCase());

    const sessionCounts = await ExamSession.aggregate([
      {
        $match: {
          $or: [
            { student: { $in: studentIds } },
            { username: { $in: usernames } }
          ]
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $ifNull: ['$student', false] },
              { $toString: '$student' },
              { $toLower: '$username' }
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const resultCounts = await Result.aggregate([
      {
        $match: {
          $or: [
            { student: { $in: studentIds } },
            { username: { $in: usernames } }
          ]
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $ifNull: ['$student', false] },
              { $toString: '$student' },
              { $toLower: '$username' }
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const sessionCountMap = new Map();
    sessionCounts.forEach(item => {
      if (item._id) sessionCountMap.set(String(item._id).toLowerCase(), item.count);
    });

    const resultCountMap = new Map();
    resultCounts.forEach(item => {
      if (item._id) resultCountMap.set(String(item._id).toLowerCase(), item.count);
    });

    const enrichedStudents = students.map(s => {
      const sId = s._id.toString().toLowerCase();
      const sUser = (s.username || '').toLowerCase();
      const attempts = sessionCountMap.get(sId) || sessionCountMap.get(sUser) || 0;
      const completed = resultCountMap.get(sId) || resultCountMap.get(sUser) || 0;

      return {
        ...s,
        totalAttempts: Math.max(attempts, completed),
        completedExams: completed
      };
    });

    let paginatedStudents = enrichedStudents;
    const page = req.query.page ? parseInt(req.query.page, 10) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    if (page && page > 0) {
      const skip = (page - 1) * limit;
      paginatedStudents = enrichedStudents.slice(skip, skip + limit);
    }

    res.status(200).json({
      success: true,
      count: paginatedStudents.length,
      total: enrichedStudents.length,
      page: page || 1,
      totalPages: page ? Math.ceil(enrichedStudents.length / limit) : 1,
      students: paginatedStudents
    });
  } catch (error) {
    console.error('Students list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve students list.'
    });
  }
};

// @desc    View individual student profile and exam history
// @route   GET /api/admin/students/:id
// @access  Protected Admin
exports.getStudentProfile = async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select('-password');
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const studentUsername = (student.username || '').toLowerCase();

    // 1. Fetch completed results matching student ID or username
    const results = await Result.find({
      $or: [
        { student: student._id },
        { username: studentUsername },
        { username: student.username }
      ]
    }).sort({ createdAt: -1 });

    // 2. Fetch active sessions matching student ID or username
    const activeSessions = await ExamSession.find({
      $or: [
        { student: student._id },
        { username: studentUsername },
        { username: student.username }
      ],
      status: 'active',
      expiresAt: { $gt: new Date() }
    }).sort({ startTime: -1 });

    // Format active sessions into unified history entries with live question/answers data
    const activeHistory = activeSessions.map(s => {
      const answeredCount = s.answers ? (s.answers instanceof Map ? s.answers.size : Object.keys(s.answers).length) : 0;
      const totalQ = (s.questionsData && s.questionsData.length) || 40;
      const sessionAnswers = (s.questionsData || []).map((q, qIdx) => {
        const qIdStr = q.questionId ? q.questionId.toString() : String(qIdx);
        let selectedIndex = null;
        if (s.answers) {
          if (s.answers instanceof Map && s.answers.has(qIdStr)) {
            selectedIndex = s.answers.get(qIdStr);
          } else if (typeof s.answers === 'object' && s.answers[qIdStr] !== undefined) {
            selectedIndex = s.answers[qIdStr];
          }
        }
        return {
          questionId: q.questionId,
          question: q.question,
          options: q.options || [],
          selectedIndex: selectedIndex !== null && selectedIndex !== undefined ? Number(selectedIndex) : null,
          correctIndex: null,
          isCorrect: null,
          isMarkedForReview: s.markedForReview ? (s.markedForReview instanceof Map ? !!s.markedForReview.get(qIdStr) : !!s.markedForReview[qIdStr]) : false
        };
      });

      return {
        id: s.sessionId,
        sessionId: s.sessionId,
        examTitle: 'Programming Fundamentals Examination',
        score: 'In Progress ⏳',
        rawScore: null,
        total: totalQ,
        totalQuestions: totalQ,
        percentage: 0,
        correct: 0,
        wrong: 0,
        unanswered: Math.max(0, totalQ - answeredCount),
        questionsAttempted: answeredCount,
        questionsAnswered: answeredCount,
        questionsUnanswered: Math.max(0, totalQ - answeredCount),
        status: 'In Progress',
        submittedAt: null,
        dateTime: s.startTime,
        timeTaken: 'Active',
        warnings: s.warnings || 0,
        isActive: true,
        answers: sessionAnswers
      };
    });

    // Format completed results with explicit attempted, answered, and unanswered metrics
    const completedHistory = results.map(r => {
      const attempted = (r.correct || 0) + (r.wrong || 0);
      const totalQ = r.total || 40;
      const unans = r.unanswered !== undefined ? r.unanswered : Math.max(0, totalQ - attempted);

      return {
        id: r.id,
        _id: r._id,
        examTitle: r.examTitle || 'Programming Fundamentals Examination',
        score: r.score,
        total: totalQ,
        totalQuestions: totalQ,
        percentage: r.percentage,
        correct: r.correct,
        wrong: r.wrong,
        unanswered: unans,
        questionsAttempted: attempted,
        questionsAnswered: attempted,
        questionsUnanswered: unans,
        status: r.status,
        submittedAt: r.submittedAt,
        dateTime: r.dateTime || r.createdAt,
        timeTaken: r.timeTaken,
        warnings: r.warnings || 0,
        isActive: false,
        answers: r.answers || []
      };
    });

    const combinedHistory = [...activeHistory, ...completedHistory];

    res.status(200).json({
      success: true,
      student,
      examHistory: combinedHistory,
      results: combinedHistory
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve student profile.' });
  }
};

// @desc    Block or unblock a student account
// @route   PUT /api/admin/students/:id/toggle-block
// @access  Protected Admin
exports.toggleBlockStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    student.isBlocked = !student.isBlocked;
    // When blocking an account, immediately revoke all active JWT session tokens
    if (student.isBlocked) {
      student.tokenVersion = (student.tokenVersion || 0) + 1;
    }
    await student.save();

    res.status(200).json({
      success: true,
      message: `Student account ${student.isBlocked ? 'blocked' : 'unblocked'} successfully.`,
      isBlocked: student.isBlocked
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update student status.' });
  }
};

// @desc    Delete a student account (requires secondary password confirmation)
// @route   DELETE /api/admin/students/:id
// @access  Protected Admin
exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Secondary password verification for destructive action
    const verification = await verifyAdminPassword(req);
    if (!verification.ok) {
      return res.status(401).json({ success: false, message: verification.message, requirePassword: true });
    }

    await User.findByIdAndDelete(req.params.id);
    await ExamSession.deleteMany({ student: student._id });

    // Record in AuditLog
    await AuditLog.create({
      action: 'DELETE_STUDENT',
      performedBy: req.user._id,
      adminUsername: req.user.username,
      targetType: 'User',
      targetId: student._id.toString(),
      details: { deletedUsername: student.username, fullName: student.fullName },
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(e => console.warn('AuditLog error:', e.message));

    res.status(200).json({
      success: true,
      message: `Student ${student.fullName} (${student.username}) has been deleted.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete student.' });
  }
};

// @desc    Clear all exam results (requires secondary password confirmation)
// @route   DELETE /api/admin/results
// @access  Protected Admin
exports.clearAllResults = async (req, res) => {
  try {
    // Secondary password verification for destructive action
    const verification = await verifyAdminPassword(req);
    if (!verification.ok) {
      return res.status(401).json({ success: false, message: verification.message, requirePassword: true });
    }

    const resultsCount = await Result.countDocuments();
    const sessionsCount = await ExamSession.countDocuments();

    await Result.deleteMany({});
    await ExamSession.deleteMany({});

    const resultsPath = path.join(__dirname, '..', 'data', 'results.json');
    if (fs.existsSync(resultsPath)) {
      fs.writeFileSync(resultsPath, '[]', 'utf8');
    }

    // Record in AuditLog
    await AuditLog.create({
      action: 'CLEAR_ALL_RESULTS',
      performedBy: req.user._id,
      adminUsername: req.user.username,
      targetType: 'Result',
      details: { deletedResults: resultsCount, deletedSessions: sessionsCount },
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(e => console.warn('AuditLog error:', e.message));

    res.status(200).json({
      success: true,
      message: 'All examination attempts and sessions have been cleared.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear results.'
    });
  }
};

// @desc    Get student-wise exam history and live exam activity from all devices
// @route   GET /api/admin/exam-activity
// @access  Protected Admin
exports.getExamActivity = async (req, res) => {
  try {
    const { search, status } = req.query;

    // 1. Completed exam results query
    let resultQuery = {};
    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      resultQuery.$or = [
        { studentName: regex },
        { username: regex },
        { email: regex },
        { examTitle: regex }
      ];
    }
    if (status && status !== 'all' && (status === 'Passed' || status === 'Failed')) {
      resultQuery.status = status;
    }

    const results = await Result.find(resultQuery).sort({ createdAt: -1 });

    // 2. Active exam sessions query
    let sessionQuery = { status: 'active', expiresAt: { $gt: new Date() } };
    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      sessionQuery.$or = [
        { studentName: regex },
        { username: regex }
      ];
    }

    let activeSessions = [];
    if (!status || status === 'all' || status === 'Active') {
      activeSessions = await ExamSession.find(sessionQuery)
        .populate('student', 'email')
        .populate('exam', 'title')
        .sort({ startTime: -1 });
    }

    // Format active sessions with live tracking indicators and live questions data
    const inProgressItems = activeSessions.map(s => {
      const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(s.startTime)) / 1000));
      const m = Math.floor(elapsedSeconds / 60);
      const sec = elapsedSeconds % 60;
      const timeElapsedFormatted = m + ':' + String(sec).padStart(2, '0');

      const answeredCount = s.answers ? (s.answers instanceof Map ? s.answers.size : Object.keys(s.answers).length) : 0;
      const totalQ = (s.questionsData && s.questionsData.length) || 40;
      const unansweredCount = Math.max(0, totalQ - answeredCount);
      const remainingSeconds = Math.max(0, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 1000));
      const remM = Math.floor(remainingSeconds / 60);
      const remSec = remainingSeconds % 60;
      const timeRemainingFormatted = remM + ':' + String(remSec).padStart(2, '0');

      const sessionAnswers = (s.questionsData || []).map((q, qIdx) => {
        const qIdStr = q.questionId ? q.questionId.toString() : String(qIdx);
        let selectedIndex = null;
        if (s.answers) {
          if (s.answers instanceof Map && s.answers.has(qIdStr)) {
            selectedIndex = s.answers.get(qIdStr);
          } else if (typeof s.answers === 'object' && s.answers[qIdStr] !== undefined) {
            selectedIndex = s.answers[qIdStr];
          }
        }
        return {
          questionId: q.questionId,
          question: q.question,
          options: q.options || [],
          selectedIndex: selectedIndex !== null && selectedIndex !== undefined ? Number(selectedIndex) : null,
          correctIndex: null,
          isCorrect: null,
          isMarkedForReview: s.markedForReview ? (s.markedForReview instanceof Map ? !!s.markedForReview.get(qIdStr) : !!s.markedForReview[qIdStr]) : false
        };
      });

      return {
        id: s.sessionId,
        sessionId: s.sessionId,
        isSession: true,
        studentName: s.studentName,
        username: s.username,
        email: (s.student && s.student.email) || `${s.username}@student.quizbuilder.edu`,
        examName: (s.exam && s.exam.title) || 'Programming Fundamentals Examination',
        score: 'In Progress ⏳',
        rawScore: null,
        totalQuestions: totalQ,
        questionsAnswered: answeredCount,
        questionsUnanswered: unansweredCount,
        percentage: null,
        submissionStatus: 'Active',
        status: 'In Progress',
        startTime: s.startTime,
        dateTime: s.startTime,
        timeTaken: timeElapsedFormatted,
        timeRemaining: timeRemainingFormatted,
        timeRemainingSeconds: remainingSeconds,
        warnings: s.warnings || 0,
        answers: sessionAnswers
      };
    });

    // Format completed results with full question metrics
    const completedItems = results.map(r => ({
      id: r.id,
      isSession: false,
      studentName: r.studentName,
      username: r.username,
      email: r.email || `${r.username}@student.quizbuilder.edu`,
      examName: r.examTitle || 'Programming Fundamentals Examination',
      score: `${r.score}/${r.total} (${r.percentage}%)`,
      rawScore: r.score,
      totalQuestions: r.total,
      correct: r.correct,
      wrong: r.wrong,
      unanswered: r.unanswered,
      questionsAnswered: r.correct + r.wrong,
      questionsUnanswered: r.unanswered,
      percentage: r.percentage,
      submissionStatus: r.status,
      status: r.status,
      startTime: r.dateTime || r.createdAt,
      submittedAt: r.submittedAt || r.dateTime || r.createdAt,
      dateTime: r.dateTime || r.createdAt,
      timeTaken: r.timeTaken,
      timeRemaining: '0:00',
      warnings: r.warnings || 0,
      answers: r.answers || []
    }));

    let combinedActivity = [];
    if (status === 'Active') {
      combinedActivity = inProgressItems;
    } else if (status === 'Passed' || status === 'Failed') {
      combinedActivity = completedItems;
    } else {
      combinedActivity = [...inProgressItems, ...completedItems];
    }

    let paginatedActivity = combinedActivity;
    const page = req.query.page ? parseInt(req.query.page, 10) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    if (page && page > 0) {
      const skip = (page - 1) * limit;
      paginatedActivity = combinedActivity.slice(skip, skip + limit);
    }

    res.status(200).json({
      success: true,
      count: paginatedActivity.length,
      total: combinedActivity.length,
      page: page || 1,
      totalPages: page ? Math.ceil(combinedActivity.length / limit) : 1,
      activity: paginatedActivity
    });
  } catch (error) {
    console.error('Exam activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve exam activity.'
    });
  }
};

// @desc    Get audit trail logs with filtering & pagination
// @route   GET /api/admin/audit-logs
// @access  Protected Admin
exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.action && req.query.action !== 'all') {
      query.action = req.query.action;
    }
    if (req.query.targetType && req.query.targetType !== 'all') {
      query.targetType = req.query.targetType;
    }
    if (req.query.search && req.query.search.trim()) {
      const regex = new RegExp(req.query.search.trim(), 'i');
      query.$or = [
        { action: regex },
        { adminUsername: regex },
        { targetId: regex }
      ];
    }

    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      total,
      count: logs.length,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      logs
    });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve audit logs.' });
  }
};

// @desc    Get comprehensive exam analytics (score distribution, difficulty, pass/fail)
// @route   GET /api/admin/analytics
// @access  Protected Admin
exports.getAnalytics = async (req, res) => {
  try {
    const totalResults = await Result.countDocuments();
    const passedResults = await Result.countDocuments({ status: 'Passed' });
    const failedResults = await Result.countDocuments({ status: 'Failed' });

    // Score distribution buckets
    const distribution = {
      fail: await Result.countDocuments({ percentage: { $lt: 50 } }),
      pass: await Result.countDocuments({ percentage: { $gte: 50, $lt: 70 } }),
      good: await Result.countDocuments({ percentage: { $gte: 70, $lt: 90 } }),
      distinction: await Result.countDocuments({ percentage: { $gte: 90 } })
    };

    // Averages & High/Low metrics
    const agg = await Result.aggregate([
      {
        $group: {
          _id: null,
          avgPercentage: { $avg: '$percentage' },
          avgScore: { $avg: '$score' },
          highestScore: { $max: '$score' },
          lowestScore: { $min: '$score' },
          avgWarnings: { $avg: '$warnings' }
        }
      }
    ]);

    const stats = agg.length > 0 ? agg[0] : {
      avgPercentage: 0,
      avgScore: 0,
      highestScore: 0,
      lowestScore: 0,
      avgWarnings: 0
    };

    // Hardest & easiest questions calculation from recorded answers
    const recentSampleResults = await Result.find({ 'answers.0': { $exists: true } })
      .select('answers')
      .limit(200)
      .lean();

    const qStats = {};
    recentSampleResults.forEach(r => {
      (r.answers || []).forEach(a => {
        const qId = a.questionId ? a.questionId.toString() : null;
        if (!qId) return;
        if (!qStats[qId]) {
          qStats[qId] = {
            questionId: qId,
            question: a.question || ('Question ID: ' + qId),
            correct: 0,
            wrong: 0,
            totalAttempts: 0
          };
        }
        qStats[qId].totalAttempts++;
        if (a.isCorrect) {
          qStats[qId].correct++;
        } else {
          qStats[qId].wrong++;
        }
      });
    });

    const qList = Object.values(qStats).filter(q => q.totalAttempts > 0);
    const hardestQuestions = [...qList]
      .sort((a, b) => (b.wrong / b.totalAttempts) - (a.wrong / a.totalAttempts))
      .slice(0, 5)
      .map(q => ({
        ...q,
        wrongRate: Math.round((q.wrong / q.totalAttempts) * 100)
      }));

    const easiestQuestions = [...qList]
      .sort((a, b) => (b.correct / b.totalAttempts) - (a.correct / a.totalAttempts))
      .slice(0, 5)
      .map(q => ({
        ...q,
        correctRate: Math.round((q.correct / q.totalAttempts) * 100)
      }));

    res.status(200).json({
      success: true,
      analytics: {
        totalResults,
        passedResults,
        failedResults,
        passRate: totalResults > 0 ? Math.round((passedResults / totalResults) * 100) : 0,
        avgPercentage: Math.round(stats.avgPercentage || 0),
        avgScore: Math.round((stats.avgScore || 0) * 10) / 10,
        highestScore: stats.highestScore || 0,
        lowestScore: stats.lowestScore || 0,
        avgWarnings: Math.round((stats.avgWarnings || 0) * 10) / 10,
        distribution,
        hardestQuestions,
        easiestQuestions
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate analytics.' });
  }
};

// @desc    Get examination leaderboard with deterministic tie-breaking
// @route   GET /api/admin/exams/:id/leaderboard or GET /api/admin/leaderboard
// @access  Protected Admin
exports.getLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;
    let examId = id;
    if (!examId || examId === 'active') {
      const activeExam = await Exam.findOne({ isActive: true });
      if (activeExam) examId = activeExam._id;
    }

    const query = {};
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      query.exam = examId;
    }

    // Leaderboard sorted by score desc, percentage desc, createdAt asc
    const results = await Result.find(query)
      .select('studentName username email score total percentage status timeTaken submittedAt createdAt')
      .sort({ score: -1, percentage: -1, createdAt: 1 })
      .limit(100)
      .lean();

    const leaderboard = results.map((r, index) => ({
      rank: index + 1,
      id: r._id,
      studentName: r.studentName,
      username: r.username,
      score: r.score,
      total: r.total,
      percentage: r.percentage,
      status: r.status,
      timeTaken: r.timeTaken,
      submittedAt: r.submittedAt || r.createdAt
    }));

    res.status(200).json({
      success: true,
      count: leaderboard.length,
      leaderboard
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve leaderboard.' });
  }
};

// @desc    Export results as genuine Excel .xlsx with formula injection protection
// @route   GET /api/admin/export/excel
// @access  Protected Admin
exports.exportResultsExcel = async (req, res) => {
  try {
    const { examId } = req.query;
    const query = {};
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      query.exam = examId;
    }

    const results = await Result.find(query).sort({ createdAt: -1 }).lean();

    // Sanitize string to prevent Excel CSV / Spreadsheet Formula Injection
    const sanitizeCell = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (/^[=+\-@\t\r]/.test(str)) {
        return "'" + str;
      }
      return str;
    };

    const rows = results.map((r, idx) => ({
      'S.No': idx + 1,
      'Result ID': sanitizeCell(r.id || r._id),
      'Student Name': sanitizeCell(r.studentName),
      'Username': sanitizeCell(r.username),
      'Email': sanitizeCell(r.email || `${r.username}@student.quizbuilder.edu`),
      'Exam Title': sanitizeCell(r.examTitle),
      'Score': r.score !== undefined ? r.score : 0,
      'Total Questions': r.total !== undefined ? r.total : 40,
      'Percentage (%)': r.percentage !== undefined ? r.percentage : 0,
      'Status': sanitizeCell(r.status),
      'Time Taken': sanitizeCell(r.timeTaken),
      'Warnings': r.warnings || 0,
      'Submitted At': r.submittedAt ? new Date(r.submittedAt).toISOString() : new Date(r.createdAt).toISOString()
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Exam Results');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const filename = `QuizBuilder_Results_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ success: false, message: 'Failed to export results to Excel.' });
  }
};

// @desc    List all administrative accounts
// @route   GET /api/admin/accounts
// @access  Protected Admin (superadmin or admin)
exports.getAdminAccounts = async (req, res) => {
  try {
    const admins = await User.find({
      role: { $in: ['admin', 'superadmin', 'invigilator', 'viewer'] }
    })
      .select('fullName username email role isBlocked failedLoginAttempts lockUntil lastLoginAt loginCount createdAt')
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: admins.length,
      admins
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve admin accounts.' });
  }
};

// @desc    Create a new administrative account
// @route   POST /api/admin/accounts
// @access  Protected Superadmin
exports.createAdminAccount = async (req, res) => {
  try {
    const { fullName, username, email, password, role } = req.body;

    if (!fullName || !username || !password) {
      return res.status(400).json({ success: false, message: 'Full name, username, and password are required.' });
    }

    if (password.length < 12) {
      return res.status(400).json({ success: false, message: 'Administrative password must be at least 12 characters long.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this username already exists.' });
    }

    const validRoles = ['admin', 'invigilator', 'viewer', 'superadmin'];
    const chosenRole = validRoles.includes(role) ? role : 'invigilator';

    const newAdmin = await User.create({
      fullName: fullName.trim(),
      username: cleanUsername,
      email: email ? email.trim().toLowerCase() : `${cleanUsername}@admin.quizbuilder.edu`,
      password,
      role: chosenRole,
      tokenVersion: 0
    });

    await AuditLog.create({
      action: 'CREATE_ADMIN_ACCOUNT',
      performedBy: req.user._id,
      adminUsername: req.user.username,
      targetType: 'User',
      targetId: newAdmin._id.toString(),
      details: { username: cleanUsername, role: chosenRole },
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: `Admin user '${cleanUsername}' with role '${chosenRole}' created successfully.`,
      user: {
        id: newAdmin._id,
        fullName: newAdmin.fullName,
        username: newAdmin.username,
        role: newAdmin.role
      }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, message: 'Failed to create admin account.' });
  }
};

// @desc    Update an administrative account's role or status
// @route   PUT /api/admin/accounts/:id
// @access  Protected Superadmin
exports.updateAdminAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, isBlocked } = req.body;

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Admin account not found.' });
    }

    if (targetUser._id.toString() === req.user._id.toString() && isBlocked === true) {
      return res.status(400).json({ success: false, message: 'You cannot block your own administrative account.' });
    }

    if (role) {
      const validRoles = ['admin', 'invigilator', 'viewer', 'superadmin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role.' });
      }
      if (targetUser.role === 'superadmin' && role !== 'superadmin') {
        const superadminCount = await User.countDocuments({ role: 'superadmin', isBlocked: false });
        if (superadminCount <= 1) {
          return res.status(400).json({ success: false, message: 'Cannot demote the last active superadmin.' });
        }
      }
      targetUser.role = role;
    }

    if (isBlocked !== undefined) {
      if (targetUser.role === 'superadmin' && isBlocked === true) {
        const superadminCount = await User.countDocuments({ role: 'superadmin', isBlocked: false });
        if (superadminCount <= 1) {
          return res.status(400).json({ success: false, message: 'Cannot block the last active superadmin.' });
        }
      }
      targetUser.isBlocked = Boolean(isBlocked);
      if (targetUser.isBlocked) {
        targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
      }
    }

    await targetUser.save();

    res.status(200).json({
      success: true,
      message: `Admin account '${targetUser.username}' updated successfully.`,
      user: {
        id: targetUser._id,
        username: targetUser.username,
        role: targetUser.role,
        isBlocked: targetUser.isBlocked
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update admin account.' });
  }
};

// @desc    Delete an administrative account
// @route   DELETE /api/admin/accounts/:id
// @access  Protected Superadmin
exports.deleteAdminAccount = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Admin account not found.' });
    }

    if (targetUser.role === 'superadmin') {
      const superadminCount = await User.countDocuments({ role: 'superadmin' });
      if (superadminCount <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot delete the last remaining superadmin.' });
      }
    }

    await User.findByIdAndDelete(id);

    await AuditLog.create({
      action: 'DELETE_ADMIN_ACCOUNT',
      performedBy: req.user._id,
      adminUsername: req.user.username,
      targetType: 'User',
      targetId: id,
      details: { deletedUsername: targetUser.username },
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: `Admin account '${targetUser.username}' deleted successfully.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete admin account.' });
  }
};

module.exports.verifyAdminPassword = verifyAdminPassword;
