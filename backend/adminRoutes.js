const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const examController = require('../controllers/examController');
const { protect, adminOnly, authLimiter } = require('../middleware/authMiddleware');

router.post('/login', authLimiter, adminController.loginAdmin);
router.get('/stats', protect, adminOnly, adminController.getAdminStats);
router.get('/exam-activity', protect, adminOnly, adminController.getExamActivity);
router.get('/activity', protect, adminOnly, adminController.getExamActivity);
router.get('/students', protect, adminOnly, adminController.getStudentsList);
router.get('/students/:id', protect, adminOnly, adminController.getStudentProfile);
router.get('/students/:id/history', protect, adminOnly, adminController.getStudentProfile);
router.put('/students/:id/toggle-block', protect, adminOnly, adminController.toggleBlockStudent);
router.delete('/students/:id', protect, adminOnly, adminController.deleteStudent);
router.delete('/results', protect, adminOnly, adminController.clearAllResults);

// Protected Question Bank Endpoints
router.get('/questions', protect, adminOnly, examController.getAllQuestions);
router.post('/questions', protect, adminOnly, examController.createQuestion);
router.put('/questions/:id', protect, adminOnly, examController.updateQuestion);
router.delete('/questions/:id', protect, adminOnly, examController.deleteQuestion);
router.post('/reset-defaults', protect, adminOnly, examController.resetDefaultQuestions);
router.post('/import-csv', protect, adminOnly, examController.importQuestionsCSV);

module.exports = router;
