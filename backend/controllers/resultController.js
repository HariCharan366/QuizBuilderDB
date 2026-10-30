const Result = require('../models/Result');
const Question = require('../models/Question');
const ExamSession = require('../models/ExamSession');
const Exam = require('../models/Exam');
const User = require('../models/User');

function formatDuration(totalSeconds) {
  const s = totalSeconds || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

// @desc    SUBMIT EXAM SESSION & CALCULATE MARKS ON THE BACKEND USING ORIGINAL QUESTIONS
// @route   POST /api/results
// @access  Protected Student
exports.submitExam = async (req, res) => {
  try {
    const { sessionId, answers, warnings, timeTakenSeconds, id } = req.body;

    // 1. Require Authenticated Student
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required to submit examination.' });
    }

    // 2. Require Valid Examination Session (Direct client score submissions are strictly prohibited)
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Valid examination sessionId is required. Direct score submissions are not permitted.'
      });
    }

    const session = await ExamSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Examination session not found.' });
    }

    // 3. Verify Session Ownership
    if (session.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied: Session belongs to another student.' });
    }

    // 4. Idempotent Retry: Return existing result if this session was already successfully recorded
    const existingResult = await Result.findOne({ session: session._id });
    if (existingResult) {
      if (session.status !== 'submitted') {
        session.status = 'submitted';
        await session.save().catch(() => {});
      }
      return res.status(200).json({
        success: true,
        message: 'Exam already submitted. Returning existing certified result.',
        isExisting: true,
        result: existingResult
      });
    }

    // 5. Prevent Duplicate Submissions for sessions marked submitted without matching result
    if (session.status === 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Examination session has already been submitted.'
      });
    }

    // 6. Prevent Submission After Allowed Examination Time Has Expired
    const now = new Date();
    const gracePeriodMs = 60 * 1000; // 60-second network latency grace period
    if (session.expiresAt && now.getTime() > (new Date(session.expiresAt).getTime() + gracePeriodMs)) {
      session.status = 'expired';
      await session.save();
      return res.status(400).json({
        success: false,
        message: 'Examination time has expired. Submissions are no longer accepted.'
      });
    }

    // 7. Validate Submitted Answers Against Session Question IDs (Ignore unauthorized question IDs)
    const validQuestionIdSet = new Set(session.questionIds ? session.questionIds.map(id => id.toString()) : []);
    const userAnswers = {};

    if (session.answers) {
      for (let [qId, optIdx] of session.answers) {
        if (validQuestionIdSet.has(String(qId))) {
          const numIdx = Number(optIdx);
          if (Number.isInteger(numIdx) && numIdx >= 0 && numIdx <= 3) {
            userAnswers[String(qId)] = numIdx;
          }
        }
      }
    }

    if (answers && typeof answers === 'object') {
      for (let [qId, optIdx] of Object.entries(answers)) {
        if (validQuestionIdSet.has(String(qId))) {
          if (optIdx !== null && optIdx !== undefined && optIdx !== '') {
            const numIdx = Number(optIdx);
            if (Number.isInteger(numIdx) && numIdx >= 0 && numIdx <= 3) {
              userAnswers[String(qId)] = numIdx;
            }
          }
        }
      }
    }

    // 8. Calculate Exam Scores on Backend Using Original Database Questions & Answers
    const originalQuestions = await Question.find({
      _id: { $in: session.questionIds }
    }).select('+correct');

    let correct = 0;
    let wrong = 0;
    let unanswered = 0;
    const total = originalQuestions.length || (session.questionIds ? session.questionIds.length : 40);

    const answerReview = originalQuestions.map((q) => {
      const qId = q._id.toString();
      const selectedIndex = userAnswers[qId] !== undefined ? userAnswers[qId] : null;
      const isAnswered = selectedIndex !== null && !isNaN(selectedIndex);

      let isCorrect = false;
      if (!isAnswered) {
        unanswered++;
      } else if (selectedIndex === q.correct) {
        correct++;
        isCorrect = true;
      } else {
        wrong++;
      }

      return {
        question: q.question,
        options: [q.optionA, q.optionB, q.optionC, q.optionD],
        selectedIndex: isAnswered ? selectedIndex : null,
        correctIndex: q.correct,
        isCorrect
      };
    });

    let examTitle = 'Programming Fundamentals Examination';
    let passingPercentage = 50;
    const dbExam = await Exam.findById(session.exam);
    if (dbExam) {
      if (dbExam.title) examTitle = dbExam.title;
      if (typeof dbExam.passingPercentage === 'number') passingPercentage = dbExam.passingPercentage;
    }

    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
    const status = percentage >= passingPercentage ? 'Passed' : 'Failed';
    const durationSeconds = timeTakenSeconds
      ? Math.min(session.durationMinutes * 60, Math.max(0, Number(timeTakenSeconds)))
      : Math.round((Date.now() - new Date(session.startTime)) / 1000);
    const timeTaken = formatDuration(durationSeconds);
    const submittedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const resultId = id || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));

    // Anti-tamper: strictly use warnings recorded on the session, never trust client-supplied warnings
    const actualWarnings = session.warnings || 0;

    let studentEmail = `${session.username}@student.quizbuilder.edu`;
    const dbStudent = await User.findById(session.student);
    if (dbStudent && dbStudent.email) {
      studentEmail = dbStudent.email;
    }

    // 9. Safe Atomic Strategy: create Result document in MongoDB FIRST
    let newResult;
    try {
      newResult = await Result.create({
        id: resultId,
        student: session.student,
        studentName: session.studentName,
        username: session.username,
        email: studentEmail,
        exam: session.exam,
        examTitle,
        session: session._id,
        score: correct,
        total,
        percentage,
        correct,
        wrong,
        unanswered,
        timeTaken,
        timeTakenSeconds: durationSeconds,
        submittedAt,
        dateTime: new Date(),
        status,
        warnings: actualWarnings,
        answers: answerReview
      });
    } catch (createErr) {
      // If concurrent submission attempt hit unique constraint (code 11000), return the recorded result
      if (createErr.code === 11000) {
        const dupResult = await Result.findOne({ session: session._id });
        if (dupResult) {
          session.status = 'submitted';
          await session.save().catch(() => {});
          return res.status(200).json({
            success: true,
            message: 'Exam already submitted. Returning certified result.',
            isExisting: true,
            result: dupResult
          });
        }
      }
      // If error was a transient database failure, session.status remains active, allowing the student to retry safely!
      throw createErr;
    }

    // 10. Mark session as submitted ONLY after Result is safely created in MongoDB
    session.status = 'submitted';
    session.submittedAt = new Date();
    await session.save();

    return res.status(201).json({
      success: true,
      message: 'Exam evaluated successfully on the server.',
      result: newResult
    });
  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error while calculating exam result.' });
  }
};

// @desc    GET ALL RESULTS WITH ADVANCED SEARCH, FILTERING & ANALYTICS
// @route   GET /api/results
// @access  Public / Admin
exports.getAllResults = async (req, res) => {
  try {
    const { search, status, export: exportType } = req.query;
    let query = {};

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ studentName: regex }, { username: regex }, { email: regex }];
    }

    if (status && (status === 'Passed' || status === 'Failed')) {
      query.status = status;
    }

    const results = await Result.find(query).sort({ createdAt: -1 });

    // Handle CSV Export
    if (exportType === 'csv') {
      const headers = ['ID', 'Candidate Name', 'Username', 'Score', 'Total', 'Percentage', 'Status', 'Time Taken', 'Warnings', 'Submitted At'];
      const rows = results.map(r => [
        r.id,
        `"${r.studentName.replace(/"/g, '""')}"`,
        r.username,
        r.score,
        r.total,
        `${r.percentage}%`,
        r.status,
        r.timeTaken,
        r.warnings,
        r.submittedAt
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=QuizBuilder_Results_${new Date().toISOString().slice(0, 10)}.csv`);
      return res.status(200).send(csvContent);
    }

    // Analytics summary
    let highestScore = 0;
    let lowestScore = results.length > 0 ? results[0].score : 0;
    let totalScore = 0;
    let passedCount = 0;

    results.forEach(r => {
      totalScore += r.score;
      if (r.score > highestScore) highestScore = r.score;
      if (r.score < lowestScore) lowestScore = r.score;
      if (r.status === 'Passed') passedCount++;
    });

    const averageScore = results.length > 0 ? Math.round((totalScore / results.length) * 10) / 10 : 0;
    const passRate = results.length > 0 ? Math.round((passedCount / results.length) * 100) : 0;

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve results.' });
  }
};

// @desc    Get result by ID (Protected: Admins can access any result; students can only access their own)
// @route   GET /api/results/:id
// @access  Protected Student / Admin
exports.getResultById = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const query = [
      { id: req.params.id }
    ];
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      query.push({ _id: req.params.id });
    }

    const result = await Result.findOne({ $or: query });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Result not found.' });
    }

    // Role-based Privacy: Admin can view any result; students can ONLY view their own
    if (req.user && req.user.role !== 'admin') {
      const isOwner = (result.student && req.user._id && result.student.toString() === req.user._id.toString()) ||
                      (result.username && req.user.username && result.username.toLowerCase() === req.user.username.toLowerCase());
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only access your own examination results.'
        });
      }
    }

    res.status(200).json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error retrieving result.' });
  }
};

// @desc    Get student's own examination history
// @route   GET /api/results/my-results or /api/results/student/:username
// @access  Protected Student / Admin
exports.getMyResults = async (req, res) => {
  try {
    const targetUsername = (req.params.username || (req.user && req.user.username) || '').toLowerCase();

    // Role-based protection: Students can only view their own results; admins can view any student's
    if (req.user && req.user.role !== 'admin' && req.user.username.toLowerCase() !== targetUsername) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only access your own examination records.'
      });
    }

    const results = await Result.find({ username: targetUsername }).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve student history.' });
  }
};

// @desc    Admin clears all results and examination sessions
// @route   DELETE /api/results
// @access  Protected Admin
exports.clearAllResults = async (req, res) => {
  try {
    await Result.deleteMany({});
    await ExamSession.deleteMany({});
    res.status(200).json({
      success: true,
      message: 'All examination results and sessions cleared from MongoDB.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear results.'
    });
  }
};
