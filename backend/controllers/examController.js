const mongoose = require('mongoose');
const path = require('path');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const ExamSession = require('../models/ExamSession');
const User = require('../models/User');
const Result = require('../models/Result');
const AuditLog = require('../models/AuditLog');
const { evaluateExamSession } = require('./resultController');
const { DEFAULT_QUESTIONS } = require(path.join(__dirname, '..', 'data', 'seedQuestions'));

// Helper to shuffle array
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// @desc    Get all available active exams
// @route   GET /api/exams
// @access  Public / Student
exports.getAvailableExams = async (req, res) => {
  try {
    let exams = await Exam.find({ isActive: true });
    if (exams.length === 0) {
      const defaultExam = await Exam.create({
        title: 'Programming Fundamentals Examination',
        code: 'CS-EXAM-01',
        description: 'Comprehensive 40-question secure examination assessing multi-language programming proficiency.',
        durationMinutes: 15,
        totalQuestions: 40,
        passingPercentage: 50,
        isActive: true
      });
      exams = [defaultExam];
    }
    res.status(200).json({ success: true, count: exams.length, exams });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch available exams.' });
  }
};

// @desc    Admin creates a new examination
// @route   POST /api/exams
// @access  Protected Admin
exports.createExam = async (req, res) => {
  try {
    const { title, code, description, durationMinutes, totalQuestions, passingPercentage } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Exam title is required.' });
    }

    const examCode = code ? code.trim().toUpperCase() : 'EXAM-' + Date.now().toString().slice(-4);

    const newExam = await Exam.create({
      title: title.trim(),
      code: examCode,
      description: description || '',
      durationMinutes: parseInt(durationMinutes, 10) || 15,
      totalQuestions: parseInt(totalQuestions, 10) || 40,
      passingPercentage: parseInt(passingPercentage, 10) || 50,
      isActive: true
    });

    res.status(201).json({ success: true, message: 'Exam created successfully', exam: newExam });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to create exam.' });
  }
};

// @desc    Admin updates an examination
// @route   PUT /api/exams/:id
// @access  Protected Admin
exports.updateExam = async (req, res) => {
  try {
    const updated = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }
    res.status(200).json({ success: true, message: 'Exam updated successfully', exam: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update exam.' });
  }
};

// @desc    Admin deletes an examination
// @route   DELETE /api/exams/:id
// @access  Protected Admin
exports.deleteExam = async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }
    res.status(200).json({ success: true, message: 'Exam deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete exam.' });
  }
};

// @desc    START OR RESUME A SECURE 40-QUESTION EXAM SESSION
// @route   POST /api/exams/start-session
// @access  Protected Student / Public (with user payload)
exports.startExamSession = async (req, res) => {
  try {
    const { examId } = req.body;

    // Validate student identity strictly from verified JWT
    if (!req.user || req.user.role !== 'student') {
      return res.status(401).json({
        success: false,
        message: 'Student authentication required to start an examination.'
      });
    }

    const studentId = req.user._id;
    const studentUsername = req.user.username;
    const studentFullName = req.user.fullName;

    if (req.user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact administrator.'
      });
    }

    // Resolve exam
    let exam;
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      exam = await Exam.findById(examId);
    } else {
      exam = await Exam.findOne({ isActive: true });
    }

    if (!exam || !exam.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Examination is currently not active or available.'
      });
    }

    // Check Exam Schedule (startDate & endDate)
    const now = new Date();
    if (exam.startDate && now < new Date(exam.startDate)) {
      return res.status(403).json({
        success: false,
        message: `Examination has not started yet. It will open at ${new Date(exam.startDate).toLocaleString()}.`
      });
    }
    if (exam.endDate && now > new Date(exam.endDate)) {
      return res.status(403).json({
        success: false,
        message: `Examination window has closed. It ended at ${new Date(exam.endDate).toLocaleString()}.`
      });
    }

    // Check student attempt limits
    const existingResultsCount = await Result.countDocuments({
      $or: [
        { student: studentId, exam: exam._id },
        { username: studentUsername, exam: exam._id }
      ]
    });

    const retakeDoc = exam.retakesGranted && exam.retakesGranted.find(
      r => r.student && r.student.toString() === studentId.toString()
    );
    const bonusAttempts = retakeDoc ? (retakeDoc.additionalAttempts || 0) : 0;
    const maxAllowedAttempts = (exam.maxAttempts || 1) + bonusAttempts;

    if (existingResultsCount >= maxAllowedAttempts) {
      return res.status(403).json({
        success: false,
        message: `You have reached the maximum number of attempts (${maxAllowedAttempts}) allowed for this examination.`
      });
    }

    const REQUIRED_QUESTIONS = exam.totalQuestions || 40;
    const maxWarnings = exam.maxWarnings || 3;

    // 1. RECONNECTION / PAGE REFRESH CHECK:
    // Check if student already has an active, non-expired session for this exam
    const existingSession = await ExamSession.findOne({
      student: studentId,
      exam: exam._id,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });

    if (existingSession) {
      const remainingSeconds = Math.max(0, Math.round((new Date(existingSession.expiresAt) - Date.now()) / 1000));

      // Sanitize questions to omit optionMapping and correct keys
      const sanitizedQuestions = (existingSession.questionsData || []).map(q => ({
        questionId: q.questionId,
        index: q.index,
        question: q.question,
        options: q.options
      }));

      const attemptNum = existingSession.attemptNumber || 1;
      const isRetake = existingSession.isRetake || attemptNum > 1;

      return res.status(200).json({
        success: true,
        message: 'Resuming active examination session.',
        isResume: true,
        session: {
          sessionId: existingSession.sessionId,
          examTitle: exam.title,
          totalQuestions: sanitizedQuestions.length,
          questions: sanitizedQuestions,
          savedAnswers: existingSession.answers || {},
          markedForReview: existingSession.markedForReview || {},
          warnings: existingSession.warnings || 0,
          maxWarnings: existingSession.maxWarnings || maxWarnings,
          attemptNumber: attemptNum,
          isRetake,
          totalAttemptsAllowed: maxAllowedAttempts,
          remainingSeconds,
          expiresAt: existingSession.expiresAt
        }
      });
    }

    // 2. CHECK ELIGIBLE QUESTIONS COUNT IN QUESTION BANK FOR THIS SPECIFIC EXAM:
    const examQuestionFilter = { exam: exam._id };
    const totalEligible = await Question.countDocuments(examQuestionFilter);
    if (totalEligible < REQUIRED_QUESTIONS) {
      return res.status(400).json({
        success: false,
        message: `Cannot start examination: Question bank contains only ${totalEligible} questions for examination '${exam.title}'. A minimum of ${REQUIRED_QUESTIONS} questions is required to begin.`
      });
    }

    // 3. BACKEND RANDOM SELECTION OF UNIQUE QUESTIONS FROM THIS EXAMINATION:
    const randomQuestions = await Question.aggregate([
      { $match: { exam: exam._id } },
      { $sample: { size: REQUIRED_QUESTIONS } }
    ]);

    if (!randomQuestions || randomQuestions.length < REQUIRED_QUESTIONS) {
      return res.status(400).json({
        success: false,
        message: `Could not retrieve ${REQUIRED_QUESTIONS} unique questions from the exam bank.`
      });
    }

    // 4. SHUFFLE OPTIONS PER QUESTION & STORE MAPPING INTERNALLY
    // Options are shuffled per student session. optionMapping translates shuffled choice back to original.
    const questionsDataForDb = [];
    const sanitizedQuestionsForClient = [];

    randomQuestions.forEach((q, idx) => {
      const baseOptions = [q.optionA, q.optionB, q.optionC, q.optionD];
      const mapping = shuffle([0, 1, 2, 3]);
      const shuffledOptions = mapping.map(origIdx => baseOptions[origIdx]);

      questionsDataForDb.push({
        questionId: q._id,
        index: idx + 1,
        question: q.question,
        options: shuffledOptions,
        optionMapping: mapping
      });

      sanitizedQuestionsForClient.push({
        questionId: q._id,
        index: idx + 1,
        question: q.question,
        options: shuffledOptions
      });
    });

    const sessionId = 'SES-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const durationMinutes = exam.durationMinutes || 15;
    const expiresAt = new Date(Date.now() + (durationMinutes * 60 * 1000));

    const currentAttemptNumber = existingResultsCount + 1;
    const isRetake = currentAttemptNumber > 1;

    // 5. STORE SESSION IN MONGODB DATABASE
    const newSession = await ExamSession.create({
      sessionId,
      student: studentId,
      username: studentUsername,
      studentName: studentFullName,
      exam: exam._id,
      questionIds: randomQuestions.map(q => q._id),
      questionsData: questionsDataForDb,
      answers: {},
      markedForReview: {},
      durationMinutes,
      startTime: new Date(),
      expiresAt,
      status: 'active',
      warnings: 0,
      maxWarnings,
      attemptNumber: currentAttemptNumber,
      isRetake
    });

    res.status(201).json({
      success: true,
      message: 'Examination session initialized successfully.',
      isResume: false,
      session: {
        sessionId: newSession.sessionId,
        examTitle: exam.title,
        totalQuestions: sanitizedQuestionsForClient.length,
        questions: sanitizedQuestionsForClient,
        savedAnswers: {},
        markedForReview: {},
        warnings: 0,
        maxWarnings,
        attemptNumber: currentAttemptNumber,
        isRetake,
        totalAttemptsAllowed: maxAllowedAttempts,
        remainingSeconds: durationMinutes * 60,
        expiresAt: newSession.expiresAt
      }
    });
  } catch (error) {
    console.error('Session start error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while starting examination session.'
    });
  }
};

// @desc    SAVE PROGRESSIVE ANSWER & REVIEW STATE (FOR PAGE REFRESH & DISCONNECT SAFETY)
// @route   POST /api/exams/save-progress
// @access  Protected Student
exports.saveAnswerProgress = async (req, res) => {
  try {
    const { sessionId, questionId, selectedOption, isMarkedForReview } = req.body;

    if (!sessionId || !questionId) {
      return res.status(400).json({ success: false, message: 'Session ID and Question ID required.' });
    }

    // 1. Verify Authenticated Student
    if (!req.user || req.user.role !== 'student') {
      return res.status(401).json({ success: false, message: 'Student authentication required.' });
    }

    // 2. Fetch Session from MongoDB
    const session = await ExamSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Examination session not found.' });
    }

    // 3. Verify Session Ownership
    if (session.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied: Session belongs to another student.' });
    }

    // 4. Verify Session is Active and Not Submitted
    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Examination session is ${session.status} and answers can no longer be modified.`
      });
    }

    // 5. Verify Session Expiry
    if (new Date() > new Date(session.expiresAt)) {
      session.status = 'expired';
      await session.save();
      return res.status(400).json({ success: false, message: 'Examination time has expired. Progress can no longer be recorded.' });
    }

    // 6. Verify Question Belongs to Session's Selected Questions (Never trust unverified IDs)
    const qIdStr = String(questionId);
    const isQuestionInSession = session.questionIds && session.questionIds.some(q => q.toString() === qIdStr);
    if (!isQuestionInSession) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID: Question does not belong to this examination session.'
      });
    }

    // 7. Validate and Update Answer Index (Must be integer 0, 1, 2, or 3)
    if (selectedOption !== undefined && selectedOption !== null) {
      const optNum = Number(selectedOption);
      if (!Number.isInteger(optNum) || optNum < 0 || optNum > 3) {
        return res.status(400).json({
          success: false,
          message: 'Invalid answer index. Option index must be an integer between 0 and 3.'
        });
      }
      session.answers.set(qIdStr, optNum);
    }

    // 8. Validate and Update Marked-for-Review
    if (isMarkedForReview !== undefined) {
      session.markedForReview.set(qIdStr, Boolean(isMarkedForReview));
    }

    await session.save();

    res.status(200).json({
      success: true,
      message: 'Progress recorded successfully.'
    });
  } catch (error) {
    console.error('Save progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to record progress.' });
  }
};

// @desc    RECORD ANTI-CHEAT WARNING ON EXAM SESSION
// @route   POST /api/exams/record-warning
// @access  Public / Protected
exports.recordWarning = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID required.' });
    }

    const session = await ExamSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }

    // Verify session belongs to authenticated student
    if (req.user && session.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const maxAllowed = session.maxWarnings || 3;
    session.warnings = (session.warnings || 0) + 1;

    let autoSubmitted = false;
    let evalResult = null;

    if (session.warnings >= maxAllowed && session.status === 'active') {
      autoSubmitted = true;
      try {
        evalResult = await evaluateExamSession(session);
        session.status = 'submitted';
      } catch (evalErr) {
        console.error('Auto-submit evaluation error:', evalErr);
      }
    }

    await session.save();

    res.status(200).json({
      success: true,
      warnings: session.warnings,
      maxWarnings: maxAllowed,
      autoSubmit: autoSubmitted,
      result: evalResult ? evalResult.result : undefined
    });
  } catch (error) {
    console.error('Record warning error:', error);
    res.status(500).json({ success: false, message: 'Failed to record warning.' });
  }
};

// @desc    Get all questions for Admin (includes correct answers, search and filtering)
// @route   GET /api/exams/admin/questions or GET /api/admin/questions
// @access  Protected Admin
exports.getAllQuestions = async (req, res) => {
  try {
    const { search, domain, exam } = req.query;
    let query = {};

    if (search && search.trim() !== '') {
      query.question = new RegExp(search.trim(), 'i');
    }
    if (domain && domain !== 'all') {
      query.domain = domain;
    }
    if (exam && exam !== 'all') {
      query.exam = exam;
    }

    const questions = await Question.find(query).select('+correct').sort({ createdAt: 1 });
    res.status(200).json(questions);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve questions.' });
  }
};

// @desc    Admin updates/edits an existing question
// @route   PUT /api/admin/questions/:id or PUT /api/exams/questions/:id
// @access  Protected Admin
exports.updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, optionA, optionB, optionC, optionD, correct, domain, exam } = req.body;

    let targetQuestion = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      targetQuestion = await Question.findById(id);
    } else {
      const idx = parseInt(id, 10);
      const all = await Question.find().sort({ createdAt: 1 });
      targetQuestion = all[idx];
    }

    if (!targetQuestion) {
      return res.status(404).json({ success: false, message: 'Question not found.' });
    }

    if (question && question.trim()) targetQuestion.question = question.trim();
    if (optionA && optionA.trim()) targetQuestion.optionA = optionA.trim();
    if (optionB && optionB.trim()) targetQuestion.optionB = optionB.trim();
    if (optionC && optionC.trim()) targetQuestion.optionC = optionC.trim();
    if (optionD && optionD.trim()) targetQuestion.optionD = optionD.trim();

    if (correct !== undefined && correct !== null && correct !== '') {
      const cNum = Number(correct);
      if (Number.isInteger(cNum) && cNum >= 0 && cNum <= 3) {
        targetQuestion.correct = cNum;
      }
    }

    if (domain) targetQuestion.domain = domain.trim();
    if (exam !== undefined) targetQuestion.exam = exam || null;

    await targetQuestion.save();

    res.status(200).json({
      success: true,
      message: 'Question updated successfully in examination bank.',
      question: targetQuestion
    });
  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({ success: false, message: 'Failed to update question.' });
  }
};

// @desc    Admin adds a custom question
// @route   POST /api/exams/questions
// @access  Protected Admin
exports.createQuestion = async (req, res) => {
  try {
    const { question, optionA, optionB, optionC, optionD, correct, domain, exam } = req.body;

    if (!question || !optionA || !optionB || !optionC || !optionD || correct === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Question statement and all 4 options with correct option index are required.'
      });
    }

    let targetExamId = exam;
    if (!targetExamId || !mongoose.Types.ObjectId.isValid(targetExamId)) {
      const activeExam = await Exam.findOne({ isActive: true });
      if (activeExam) targetExamId = activeExam._id;
    }

    const newQuestion = await Question.create({
      question: question.trim(),
      optionA: optionA.trim(),
      optionB: optionB.trim(),
      optionC: optionC.trim(),
      optionD: optionD.trim(),
      correct: parseInt(correct, 10),
      domain: domain ? domain.trim() : 'General',
      exam: targetExamId || null,
      isDefault: false
    });

    res.status(201).json({
      success: true,
      message: 'Question saved to examination bank successfully.',
      question: newQuestion
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create question.' });
  }
};

// @desc    Admin deletes a question
// @route   DELETE /api/exams/questions/:id
// @access  Protected Admin
exports.deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      await Question.findByIdAndDelete(id);
    } else {
      const index = parseInt(id, 10);
      const all = await Question.find().sort({ createdAt: 1 });
      if (all[index]) {
        await Question.findByIdAndDelete(all[index]._id);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Question deleted successfully.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete question.' });
  }
};

// @desc    Admin resets question bank default questions for a specific examination (requires secondary password confirmation)
// @route   POST /api/exams/reset-defaults or POST /api/admin/reset-defaults
// @access  Protected Admin
exports.resetDefaultQuestions = async (req, res) => {
  try {
    const { examId, exam } = req.body;

    // Secondary password verification for destructive action
    const adminPassword = req.body?.adminPassword || req.headers['x-admin-password'];
    if (!adminPassword) {
      return res.status(401).json({
        success: false,
        message: 'Admin password confirmation required to reset question bank.',
        requirePassword: true
      });
    }

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const adminUser = await User.findById(req.user._id);
    if (!adminUser || !(await adminUser.matchPassword(adminPassword))) {
      return res.status(401).json({ success: false, message: 'Invalid admin confirmation password.' });
    }

    // Resolve target examination
    let targetExamId = examId || exam;
    let targetExam = null;

    if (targetExamId) {
      if (!mongoose.Types.ObjectId.isValid(targetExamId)) {
        return res.status(400).json({ success: false, message: 'Invalid examination ID format.' });
      }
      targetExam = await Exam.findById(targetExamId);
      if (!targetExam) {
        return res.status(404).json({ success: false, message: 'Specified examination not found.' });
      }
    } else {
      targetExam = await Exam.findOne({ isActive: true });
      if (!targetExam) {
        return res.status(400).json({ success: false, message: 'No active examination found to reset.' });
      }
      targetExamId = targetExam._id;
    }

    // 1. Delete ONLY existing default questions for this specific exam (NEVER delete custom questions or student records!)
    const deleteFilter = {
      exam: targetExamId,
      isDefault: true
    };
    const deletedResult = await Question.deleteMany(deleteFilter);

    // 2. Insert standard default questions strictly associated with target examination
    const formatted = DEFAULT_QUESTIONS.map(q => ({
      question: q.question,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      correct: q.correct,
      exam: targetExamId,
      isDefault: true
    }));

    await Question.insertMany(formatted);

    // 3. Count preserved custom questions for safety reporting
    const customCount = await Question.countDocuments({
      exam: targetExamId,
      isDefault: false
    });

    // Record in AuditLog
    await AuditLog.create({
      action: 'RESET_DEFAULT_QUESTIONS',
      performedBy: req.user._id,
      adminUsername: req.user.username,
      targetType: 'Exam',
      targetId: targetExamId.toString(),
      details: {
        examTitle: targetExam.title,
        replacedDefaults: deletedResult.deletedCount,
        insertedDefaults: formatted.length,
        preservedCustom: customCount
      },
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(e => console.warn('AuditLog error:', e.message));

    res.status(200).json({
      success: true,
      message: `Default questions reset successfully for examination '${targetExam.title}'. Preserved ${customCount} custom question(s).`,
      replacedDefaultCount: deletedResult.deletedCount,
      insertedDefaultCount: formatted.length,
      preservedCustomCount: customCount,
      examId: targetExamId
    });
  } catch (error) {
    console.error('Reset default questions error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset default questions.' });
  }
};

// RFC 4180 compliant CSV parser supporting quoted strings, commas within values, escaped quotes (""), and multiline entries
function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i += 2;
        continue;
      } else if (char === '"') {
        insideQuotes = false;
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r' && nextChar === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i += 2;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// @desc    Admin imports questions via CSV data with exam ID assignment and strict validation
// @route   POST /api/exams/import-csv or POST /api/admin/import-csv
// @access  Protected Admin
exports.importQuestionsCSV = async (req, res) => {
  try {
    const { csvData, examId, exam } = req.body;

    if (!csvData || typeof csvData !== 'string') {
      return res.status(400).json({ success: false, message: 'CSV text data required.' });
    }

    // Resolve & validate examination ID
    let targetExamId = examId || exam;
    let targetExam = null;

    if (targetExamId) {
      if (!mongoose.Types.ObjectId.isValid(targetExamId)) {
        return res.status(400).json({ success: false, message: 'Invalid examination ID format provided for CSV import.' });
      }
      targetExam = await Exam.findById(targetExamId);
      if (!targetExam) {
        return res.status(404).json({ success: false, message: 'Specified examination not found.' });
      }
    } else {
      targetExam = await Exam.findOne({ isActive: true });
      if (!targetExam) {
        return res.status(400).json({ success: false, message: 'No active examination available to associate imported questions with.' });
      }
      targetExamId = targetExam._id;
    }

    const parsedRows = parseCSV(csvData.trim());
    if (parsedRows.length < 2) {
      return res.status(400).json({ success: false, message: 'CSV must have a header row and at least 1 data row.' });
    }

    const imported = [];
    const invalidRows = [];

    // Format: Question,OptionA,OptionB,OptionC,OptionD,CorrectOption(0-3),Domain
    for (let i = 1; i < parsedRows.length; i++) {
      const lineNum = i + 1;
      const row = parsedRows[i];
      
      const questionText = row[0];
      const optA = row[1];
      const optB = row[2];
      const optC = row[3];
      const optD = row[4];
      const correctStr = row[5];
      const domain = row[6] || 'General';

      // Strict validation: must have question statement, all 4 options, and correct index 0..3
      if (!questionText || !optA || !optB || !optC || !optD || correctStr === undefined || correctStr === '') {
        invalidRows.push({ line: lineNum, reason: 'Missing question text or one of options A-D or correct index' });
        continue;
      }

      const correctVal = Number(correctStr);
      if (!Number.isInteger(correctVal) || correctVal < 0 || correctVal > 3) {
        invalidRows.push({ line: lineNum, reason: `Invalid correct option index: '${correctStr}'. Must be integer 0, 1, 2, or 3.` });
        continue;
      }

      imported.push({
        question: questionText,
        optionA: optA,
        optionB: optB,
        optionC: optC,
        optionD: optD,
        correct: correctVal,
        domain: domain.trim(),
        exam: targetExamId,
        isDefault: false
      });
    }

    if (imported.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid questions could be parsed from the CSV data. All rows contained errors.',
        errors: invalidRows
      });
    }

    const inserted = await Question.insertMany(imported);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${inserted.length} questions into examination '${targetExam.title}'.${invalidRows.length > 0 ? ` (${invalidRows.length} invalid rows skipped)` : ''}`,
      count: inserted.length,
      skippedCount: invalidRows.length,
      errors: invalidRows.length > 0 ? invalidRows : undefined,
      examId: targetExamId,
      examTitle: targetExam.title
    });
  } catch (error) {
    console.error('Import CSV error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to import CSV.' });
  }
};

// @desc    Admin updates exam settings (duration, max attempts, passing %, dates, etc.)
// @route   PUT /api/exams/settings or PUT /api/exams/:id/settings
// @access  Protected Admin
exports.updateExamSettings = async (req, res) => {
  try {
    const {
      examId,
      minutes,
      durationMinutes,
      totalQuestions,
      passingPercentage,
      maxWarnings,
      maxAttempts,
      showAnswersAfterSubmit,
      randomizeQuestions,
      startDate,
      endDate,
      title,
      description,
      isActive
    } = req.body;

    const targetExamId = req.params.id || examId;
    let exam = null;

    if (targetExamId && mongoose.Types.ObjectId.isValid(targetExamId)) {
      exam = await Exam.findById(targetExamId);
    } else {
      exam = await Exam.findOne({ isActive: true });
      if (!exam) {
        exam = await Exam.findOne();
      }
    }

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found to update settings.' });
    }

    const updates = {};

    const durationVal = durationMinutes !== undefined ? durationMinutes : minutes;
    if (durationVal !== undefined && durationVal !== null && durationVal !== '') {
      const dur = parseInt(durationVal, 10);
      if (isNaN(dur) || dur < 1 || dur > 300) {
        return res.status(400).json({ success: false, message: 'Exam duration must be between 1 and 300 minutes.' });
      }
      updates.durationMinutes = dur;
    }

    if (totalQuestions !== undefined && totalQuestions !== null && totalQuestions !== '') {
      const tq = parseInt(totalQuestions, 10);
      if (isNaN(tq) || tq < 1 || tq > 200) {
        return res.status(400).json({ success: false, message: 'Total questions must be between 1 and 200.' });
      }
      updates.totalQuestions = tq;
    }

    if (passingPercentage !== undefined && passingPercentage !== null && passingPercentage !== '') {
      const pp = parseInt(passingPercentage, 10);
      if (isNaN(pp) || pp < 1 || pp > 100) {
        return res.status(400).json({ success: false, message: 'Passing percentage must be between 1 and 100.' });
      }
      updates.passingPercentage = pp;
    }

    if (maxWarnings !== undefined && maxWarnings !== null && maxWarnings !== '') {
      const mw = parseInt(maxWarnings, 10);
      if (isNaN(mw) || mw < 1 || mw > 10) {
        return res.status(400).json({ success: false, message: 'Max warnings must be between 1 and 10.' });
      }
      updates.maxWarnings = mw;
    }

    if (maxAttempts !== undefined && maxAttempts !== null && maxAttempts !== '') {
      const ma = parseInt(maxAttempts, 10);
      if (isNaN(ma) || ma < 1 || ma > 50) {
        return res.status(400).json({ success: false, message: 'Max attempts must be between 1 and 50.' });
      }
      updates.maxAttempts = ma;
    }

    if (showAnswersAfterSubmit !== undefined) {
      updates.showAnswersAfterSubmit = Boolean(showAnswersAfterSubmit);
    }

    if (randomizeQuestions !== undefined) {
      updates.randomizeQuestions = Boolean(randomizeQuestions);
    }

    if (startDate !== undefined) {
      updates.startDate = startDate ? new Date(startDate) : null;
    }

    if (endDate !== undefined) {
      updates.endDate = endDate ? new Date(endDate) : null;
    }

    if (title && typeof title === 'string' && title.trim()) {
      updates.title = title.trim();
    }

    if (description !== undefined && typeof description === 'string') {
      updates.description = description.trim();
    }

    if (isActive !== undefined) {
      updates.isActive = Boolean(isActive);
    }

    const updated = await Exam.findByIdAndUpdate(exam._id, { $set: updates }, { new: true });

    // Record in AuditLog
    await AuditLog.create({
      action: 'UPDATE_EXAM_SETTINGS',
      performedBy: req.user ? req.user._id : null,
      adminUsername: req.user ? req.user.username : 'admin',
      targetType: 'Exam',
      targetId: exam._id.toString(),
      details: updates,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(e => console.warn('AuditLog error:', e.message));

    res.status(200).json({
      success: true,
      message: `Exam settings updated successfully.`,
      exam: updated
    });
  } catch (error) {
    console.error('Update exam settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update exam settings.' });
  }
};

// @desc    Admin grants extra attempt / retake to a student
// @route   POST /api/exams/:id/grant-retake
// @access  Protected Admin
exports.grantRetake = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, username, additionalAttempts, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID.' });
    }

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    let studentDoc = null;
    if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
      studentDoc = await User.findById(studentId);
    } else if (username) {
      studentDoc = await User.findOne({ username: username.trim().toLowerCase(), role: 'student' });
    }

    if (!studentDoc) {
      return res.status(404).json({ success: false, message: 'Student account not found.' });
    }

    const attemptsToAdd = parseInt(additionalAttempts, 10) || 1;

    // Check if retake entry already exists in exam.retakesGranted
    const existingIndex = (exam.retakesGranted || []).findIndex(
      r => r.student && r.student.toString() === studentDoc._id.toString()
    );

    if (existingIndex !== -1) {
      exam.retakesGranted[existingIndex].additionalAttempts += attemptsToAdd;
      exam.retakesGranted[existingIndex].reason = reason || exam.retakesGranted[existingIndex].reason;
      exam.retakesGranted[existingIndex].grantedAt = new Date();
    } else {
      if (!exam.retakesGranted) exam.retakesGranted = [];
      exam.retakesGranted.push({
        student: studentDoc._id,
        additionalAttempts: attemptsToAdd,
        grantedAt: new Date(),
        reason: reason || 'Retake granted by administrator'
      });
    }

    await exam.save();

    // Audit log entry
    await AuditLog.create({
      action: 'GRANT_RETAKE',
      performedBy: req.user ? req.user._id : null,
      adminUsername: req.user ? req.user.username : 'admin',
      targetType: 'Exam',
      targetId: exam._id.toString(),
      details: {
        studentId: studentDoc._id,
        studentUsername: studentDoc.username,
        additionalAttempts: attemptsToAdd,
        reason: reason || 'Retake granted'
      },
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(e => console.warn('AuditLog error:', e.message));

    res.status(200).json({
      success: true,
      message: `Granted ${attemptsToAdd} additional attempt(s) to ${studentDoc.fullName} (${studentDoc.username}) for examination '${exam.title}'.`,
      retakesGranted: exam.retakesGranted
    });
  } catch (error) {
    console.error('Grant retake error:', error);
    res.status(500).json({ success: false, message: 'Failed to grant retake.' });
  }
};
