const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Question = require('../models/Question');
const Result = require('../models/Result');
const Exam = require('../models/Exam');
const ExamSession = require('../models/ExamSession');

const generateAdminToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is missing.');
  }
  return jwt.sign(
    { id: user._id, username: user.username, role: 'admin' },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
};

// @desc    Admin authentication
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

    let admin = await User.findOne({ username: String(id).trim(), role: 'admin' });

    const envAdminId = process.env.ADMIN_ID;
    const envAdminPass = process.env.ADMIN_PASSWORD;

    if (!admin && envAdminId && envAdminPass && String(id).trim() === envAdminId && password === envAdminPass) {
      admin = await User.create({
        fullName: 'System Administrator',
        username: envAdminId,
        email: 'admin@quizbuilder.edu',
        password: envAdminPass,
        role: 'admin'
      });
    }

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Admin ID or Password.'
      });
    }

    const isMatch = await admin.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Admin ID or Password.'
      });
    }

    const token = generateAdminToken(admin);

    res.status(200).json({
      success: true,
      message: 'Admin authenticated successfully',
      token,
      user: {
        id: admin._id,
        fullName: admin.fullName,
        username: admin.username,
        role: 'admin'
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

    res.status(200).json({
      success: true,
      count: enrichedStudents.length,
      students: enrichedStudents
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

// @desc    Delete a student account
// @route   DELETE /api/admin/students/:id
// @access  Protected Admin
exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    await User.findByIdAndDelete(req.params.id);
    await ExamSession.deleteMany({ student: student._id });

    res.status(200).json({
      success: true,
      message: `Student ${student.fullName} (${student.username}) has been deleted.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete student.' });
  }
};

// @desc    Clear all exam results
// @route   DELETE /api/admin/results
// @access  Protected Admin
exports.clearAllResults = async (req, res) => {
  try {
    await Result.deleteMany({});
    await ExamSession.deleteMany({});

    const resultsPath = path.join(__dirname, '..', 'data', 'results.json');
    if (fs.existsSync(resultsPath)) {
      fs.writeFileSync(resultsPath, '[]', 'utf8');
    }

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

    res.status(200).json({
      success: true,
      count: combinedActivity.length,
      activity: combinedActivity
    });
  } catch (error) {
    console.error('Exam activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve exam activity.'
    });
  }
};
