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

// Certified Centralized Examination Evaluation Helper (Atomic & Idempotent)
async function evaluateExamSession(session, submittedAnswers = {}, timeTakenSeconds = null, customResultId = null) {
  // 1. Idempotency check: If result already recorded, return it
  const existingResult = await Result.findOne({ session: session._id });
  if (existingResult) {
    if (session.status !== 'submitted') {
      session.status = 'submitted';
      await session.save().catch(() => { });
    }
    const dbExam = await Exam.findById(session.exam);
    return { result: existingResult, isExisting: true, dbExam };
  }

  // 2. Aggregate submitted answers with session saved answers
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

  if (submittedAnswers && typeof submittedAnswers === 'object') {
    for (let [qId, optIdx] of Object.entries(submittedAnswers)) {
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

  // 3. Query original questions with hidden correct answer keys from MongoDB
  const originalQuestions = await Question.find({
    _id: { $in: session.questionIds }
  }).select('+correct');

  const questionMap = new Map();
  originalQuestions.forEach(q => questionMap.set(q._id.toString(), q));

  // Maintain the EXACT sequence of questions the student received at the start
  let orderedList = [];
  if (Array.isArray(session.questionsData) && session.questionsData.length > 0) {
    orderedList = session.questionsData;
  } else if (Array.isArray(session.questionIds) && session.questionIds.length > 0) {
    orderedList = session.questionIds.map((qId, idx) => {
      const q = questionMap.get(qId.toString());
      return {
        questionId: qId,
        index: idx + 1,
        question: q ? q.question : '',
        options: q ? [q.optionA, q.optionB, q.optionC, q.optionD] : []
      };
    });
  } else {
    orderedList = originalQuestions.map((q, idx) => ({
      questionId: q._id,
      index: idx + 1,
      question: q.question,
      options: [q.optionA, q.optionB, q.optionC, q.optionD]
    }));
  }

  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  const total = orderedList.length || 40;

  const answerReview = orderedList.map((sq, idx) => {
    const qIdStr = sq.questionId ? sq.questionId.toString() : '';
    const q = questionMap.get(qIdStr);
    const selectedShuffledIndex = userAnswers[qIdStr] !== undefined ? userAnswers[qIdStr] : null;
    const isAnswered = selectedShuffledIndex !== null && !isNaN(selectedShuffledIndex);

    let originalChosenIndex = selectedShuffledIndex;
    if (isAnswered && sq.optionMapping && Array.isArray(sq.optionMapping) && sq.optionMapping.length === 4) {
      originalChosenIndex = sq.optionMapping[selectedShuffledIndex];
    }

    const correctKey = (q && q.correct !== undefined) ? Number(q.correct) : null;
    let isCorrect = false;
    if (!isAnswered) {
      unanswered++;
    } else if (correctKey !== null && Number(originalChosenIndex) === correctKey) {
      correct++;
      isCorrect = true;
    } else {
      wrong++;
    }

    let correctShuffledIndex = correctKey;
    if (sq.optionMapping && Array.isArray(sq.optionMapping) && correctKey !== null) {
      const mappedIdx = sq.optionMapping.indexOf(correctKey);
      if (mappedIdx !== -1) correctShuffledIndex = mappedIdx;
    }

    const resolvedOptions = (sq.options && Array.isArray(sq.options) && sq.options.length > 0)
      ? sq.options
      : (q ? [q.optionA, q.optionB, q.optionC, q.optionD] : []);

    return {
      questionId: qIdStr || (q ? q._id : null),
      index: sq.index || (idx + 1),
      question: sq.question || (q ? q.question : ''),
      options: resolvedOptions,
      selectedIndex: isAnswered ? Number(selectedShuffledIndex) : null,
      correctIndex: correctShuffledIndex !== null ? Number(correctShuffledIndex) : null,
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

  const resultId = customResultId || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const actualWarnings = session.warnings || 0;

  let studentEmail = `${session.username}@student.quizbuilder.edu`;
  const dbStudent = await User.findById(session.student);
  if (dbStudent && dbStudent.email) {
    studentEmail = dbStudent.email;
  }

  // Safe Atomic Strategy: create Result document in MongoDB
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
      attemptNumber: session.attemptNumber || 1,
      isRetake: session.isRetake || ((session.attemptNumber || 1) > 1),
      answers: answerReview
    });
  } catch (createErr) {
    if (createErr.code === 11000) {
      const dupResult = await Result.findOne({ session: session._id });
      if (dupResult) {
        session.status = 'submitted';
        await session.save().catch(() => { });
        return { result: dupResult, isExisting: true, dbExam };
      }
    }
    throw createErr;
  }

  // Mark session as submitted
  session.status = 'submitted';
  session.submittedAt = new Date();
  await session.save();

  return { result: newResult, isExisting: false, dbExam };
}

// @desc    SUBMIT EXAM SESSION & CALCULATE MARKS ON THE BACKEND
// @route   POST /api/results
// @access  Protected Student
exports.submitExam = async (req, res) => {
  try {
    const { sessionId, answers, timeTakenSeconds, id } = req.body;

    // 1. Require Authenticated Student
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required to submit examination.' });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Valid examination sessionId is required.'
      });
    }

    const session = await ExamSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Examination session not found.' });
    }

    // 2. Verify Session Ownership
    if (session.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied: Session belongs to another student.' });
    }

    // 3. Idempotent check
    const existingResult = await Result.findOne({ session: session._id });
    if (existingResult) {
      if (session.status !== 'submitted') {
        session.status = 'submitted';
        await session.save().catch(() => { });
      }
      const dbExam = await Exam.findById(session.exam);
      let clientResult = existingResult.toObject();
      if (dbExam && dbExam.showAnswersAfterSubmit === false && req.user.role === 'student') {
        delete clientResult.answers;
      }
      return res.status(200).json({
        success: true,
        message: 'Exam already submitted. Returning certified result.',
        isExisting: true,
        result: clientResult
      });
    }

    if (session.status === 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Examination session has already been submitted.'
      });
    }

    // 4. Time Expiry Check (with 60-second grace period)
    const now = new Date();
    const gracePeriodMs = 60 * 1000;
    if (session.expiresAt && now.getTime() > (new Date(session.expiresAt).getTime() + gracePeriodMs)) {
      session.status = 'expired';
      await session.save();
      return res.status(400).json({
        success: false,
        message: 'Examination time has expired. Submissions are no longer accepted.'
      });
    }

    // 5. Evaluate and save result
    const { result, isExisting, dbExam } = await evaluateExamSession(session, answers, timeTakenSeconds, id);

    let clientResult = result.toObject ? result.toObject() : result;
    // Policy check: If showAnswersAfterSubmit is explicitly false, omit answer review from student response
    if (dbExam && dbExam.showAnswersAfterSubmit === false && req.user.role === 'student') {
      delete clientResult.answers;
    }

    return res.status(isExisting ? 200 : 201).json({
      success: true,
      message: 'Exam evaluated successfully on the server.',
      result: clientResult
    });
  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error while calculating exam result.' });
  }
};

// @desc    GET ALL RESULTS WITH ADVANCED SEARCH, FILTERING & SECURE CSV EXPORT
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

    // Handle Secure CSV Export with Formula Injection & Character Escaping Protections
    if (exportType === 'csv') {
      const sanitizeCsvField = (val) => {
        if (val === null || val === undefined) return '""';
        let str = String(val);
        if (/^[=+\-@\t\r]/.test(str)) {
          str = "'" + str;
        }
        return `"${str.replace(/"/g, '""')}"`;
      };

      const headers = ['ID', 'Candidate Name', 'Username', 'Score', 'Total', 'Percentage', 'Status', 'Time Taken', 'Warnings', 'Submitted At'];
      const rows = results.map(r => [
        sanitizeCsvField(r.id),
        sanitizeCsvField(r.studentName),
        sanitizeCsvField(r.username),
        sanitizeCsvField(r.score),
        sanitizeCsvField(r.total),
        sanitizeCsvField(`${r.percentage}%`),
        sanitizeCsvField(r.status),
        sanitizeCsvField(r.timeTaken),
        sanitizeCsvField(r.warnings),
        sanitizeCsvField(r.submittedAt)
      ]);

      const csvContent = '\uFEFF' + [headers.map(sanitizeCsvField).join(','), ...rows.map(row => row.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=QuizBuilder_Results_${new Date().toISOString().slice(0, 10)}.csv`);
      return res.status(200).send(csvContent);
    }

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
    if (req.user && req.user.role === 'student') {
      const isOwner = (result.student && req.user._id && result.student.toString() === req.user._id.toString()) ||
        (result.username && req.user.username && result.username.toLowerCase() === req.user.username.toLowerCase());
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only access your own examination results.'
        });
      }
    }

    let clientResult = result.toObject();
    // Answer Privacy Check: only hide answers if showAnswersAfterSubmit is explicitly false and user is student
    if (req.user && req.user.role === 'student') {
      const exam = await Exam.findById(result.exam);
      if (exam && exam.showAnswersAfterSubmit === false) {
        delete clientResult.answers;
      }
    }

    res.status(200).json({ success: true, result: clientResult });
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
    if (req.user && req.user.role === 'student' && req.user.username.toLowerCase() !== targetUsername) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only access your own examination records.'
      });
    }

    const results = await Result.find({ username: targetUsername }).sort({ createdAt: -1 });

    // Include answers for student results unless explicitly disabled on the active examination
    let sanitizedResults = results;
    if (req.user && req.user.role === 'student') {
      const activeExam = await Exam.findOne({ isActive: true });
      if (activeExam && activeExam.showAnswersAfterSubmit === false) {
        sanitizedResults = results.map(r => {
          const obj = r.toObject();
          delete obj.answers;
          return obj;
        });
      }
    }

    res.status(200).json({
      success: true,
      count: sanitizedResults.length,
      results: sanitizedResults
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

module.exports.evaluateExamSession = evaluateExamSession;
