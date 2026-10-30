const mongoose = require('mongoose');
const path = require('path');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const ExamSession = require('../models/ExamSession');
const User = require('../models/User');
const { DEFAULT_QUESTIONS } = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'questions'));

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

    const REQUIRED_QUESTIONS = exam.totalQuestions || 40;

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

      return res.status(200).json({
        success: true,
        message: 'Resuming active examination session.',
        isResume: true,
        session: {
          sessionId: existingSession.sessionId,
          examTitle: exam.title,
          totalQuestions: existingSession.questionsData.length,
          questions: existingSession.questionsData,
          savedAnswers: existingSession.answers || {},
          markedForReview: existingSession.markedForReview || {},
          warnings: existingSession.warnings || 0,
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

    // 3. BACKEND RANDOM SELECTION OF EXACTLY 40 UNIQUE QUESTIONS FROM THIS EXAMINATION:
    // Uses MongoDB $sample aggregation matching only this exam's question bank (never mixes questions)
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

    // 4. SANITIZE & SHUFFLE OPTIONS (CORRECT ANSWERS ARE NEVER EXPOSED TO STUDENTS)
    const formattedQuestions = randomQuestions.map((q, idx) => {
      const baseOptions = [q.optionA, q.optionB, q.optionC, q.optionD];
      return {
        questionId: q._id,
        index: idx + 1,
        question: q.question,
        options: baseOptions // Sent in standard A, B, C, D order without correct answer
      };
    });

    const sessionId = 'SES-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const durationMinutes = exam.durationMinutes || 15;
    const expiresAt = new Date(Date.now() + (durationMinutes * 60 * 1000));

    // 5. STORE SESSION IN MONGODB DATABASE
    const newSession = await ExamSession.create({
      sessionId,
      student: studentId,
      username: studentUsername,
      studentName: studentFullName,
      exam: exam._id,
      questionIds: randomQuestions.map(q => q._id),
      questionsData: formattedQuestions,
      answers: {},
      markedForReview: {},
      durationMinutes,
      startTime: new Date(),
      expiresAt,
      status: 'active',
      warnings: 0
    });

    res.status(201).json({
      success: true,
      message: 'Examination session initialized successfully.',
      isResume: false,
      session: {
        sessionId: newSession.sessionId,
        examTitle: exam.title,
        totalQuestions: formattedQuestions.length,
        questions: formattedQuestions,
        savedAnswers: {},
        markedForReview: {},
        warnings: 0,
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

    session.warnings = (session.warnings || 0) + 1;
    await session.save();

    res.status(200).json({
      success: true,
      warnings: session.warnings,
      autoSubmit: session.warnings >= 3
    });
  } catch (error) {
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

// @desc    Admin resets question bank to 75 default questions
// @route   POST /api/exams/reset-defaults
// @access  Protected Admin
exports.resetDefaultQuestions = async (req, res) => {
  try {
    await Question.deleteMany({});
    const formatted = DEFAULT_QUESTIONS.map(q => ({
      question: q.question,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      correct: q.correct,
      isDefault: true
    }));

    await Question.insertMany(formatted);

    res.status(200).json({
      success: true,
      message: 'Question bank reset to default 75 questions successfully.',
      count: formatted.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reset default questions.' });
  }
};

// @desc    Admin imports questions via CSV data
// @route   POST /api/exams/import-csv
// @access  Protected Admin
exports.importQuestionsCSV = async (req, res) => {
  try {
    const { csvData } = req.body;

    if (!csvData || typeof csvData !== 'string') {
      return res.status(400).json({ success: false, message: 'CSV text data required.' });
    }

    const lines = csvData.trim().split(/\r?\n/);
    if (lines.length < 2) {
      return res.status(400).json({ success: false, message: 'CSV must have a header row and at least 1 data row.' });
    }

    const imported = [];
    // Format: Question,OptionA,OptionB,OptionC,OptionD,CorrectOption(0-3),Domain
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (row.length >= 6 && row[0]) {
        const correctVal = parseInt(row[5], 10);
        imported.push({
          question: row[0],
          optionA: row[1],
          optionB: row[2],
          optionC: row[3],
          optionD: row[4],
          correct: isNaN(correctVal) ? 0 : Math.min(3, Math.max(0, correctVal)),
          domain: row[6] || 'General',
          isDefault: false
        });
      }
    }

    if (imported.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid questions could be parsed from the CSV data.' });
    }

    await Question.insertMany(imported);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${imported.length} questions into the examination bank.`,
      count: imported.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to import CSV.' });
  }
};

// @desc    Admin updates exam settings (duration)
// @route   PUT /api/exams/settings
// @access  Protected Admin
exports.updateExamSettings = async (req, res) => {
  try {
    const { minutes } = req.body;
    const duration = parseInt(minutes, 10);

    if (!duration || duration < 1 || duration > 180) {
      return res.status(400).json({
        success: false,
        message: 'Exam duration must be between 1 and 180 minutes.'
      });
    }

    const updated = await Exam.findOneAndUpdate(
      {},
      { durationMinutes: duration },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: `Exam duration updated to ${duration} minutes.`,
      exam: updated
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update duration.' });
  }
};
