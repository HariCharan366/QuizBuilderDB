const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Student & Public Exam Access
router.get('/', examController.getAvailableExams);
router.post('/start-session', protect, examController.startExamSession);
router.post('/save-progress', protect, examController.saveAnswerProgress);
router.post('/record-warning', protect, examController.recordWarning);

// Admin Question & Exam Management
router.post('/', protect, adminOnly, examController.createExam);
router.put('/:id', protect, adminOnly, examController.updateExam);
router.delete('/:id', protect, adminOnly, examController.deleteExam);
router.get('/admin/questions', protect, adminOnly, examController.getAllQuestions);
router.post('/questions', protect, adminOnly, examController.createQuestion);
router.put('/questions/:id', protect, adminOnly, examController.updateQuestion);
router.delete('/questions/:id', protect, adminOnly, examController.deleteQuestion);
router.post('/reset-defaults', protect, adminOnly, examController.resetDefaultQuestions);
router.post('/import-csv', protect, adminOnly, examController.importQuestionsCSV);
router.put('/settings', protect, adminOnly, examController.updateExamSettings);

module.exports = router;
