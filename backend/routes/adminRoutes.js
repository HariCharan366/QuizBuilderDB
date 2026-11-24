const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const examController = require('../controllers/examController');
const { protect, adminOnly, superadminOnly, loginLimiter } = require('../middleware/authMiddleware');

router.post('/login', loginLimiter, adminController.loginAdmin);
router.get('/stats', protect, adminOnly, adminController.getAdminStats);
router.get('/exam-activity', protect, adminOnly, adminController.getExamActivity);
router.get('/activity', protect, adminOnly, adminController.getExamActivity);
router.get('/students', protect, adminOnly, adminController.getStudentsList);
router.get('/students/:id', protect, adminOnly, adminController.getStudentProfile);
router.get('/students/:id/history', protect, adminOnly, adminController.getStudentProfile);
router.put('/students/:id/toggle-block', protect, adminOnly, adminController.toggleBlockStudent);
router.delete('/students/:id', protect, adminOnly, adminController.deleteStudent);
router.delete('/results', protect, adminOnly, adminController.clearAllResults);

// Advanced Analytics, Leaderboard & Audit Trails
router.get('/audit-logs', protect, adminOnly, adminController.getAuditLogs);
router.get('/analytics', protect, adminOnly, adminController.getAnalytics);
router.get('/leaderboard', protect, adminOnly, adminController.getLeaderboard);
router.get('/exams/:id/leaderboard', protect, adminOnly, adminController.getLeaderboard);
router.get('/export/excel', protect, adminOnly, adminController.exportResultsExcel);

// Admin Account Management (RBAC)
router.get('/accounts', protect, adminOnly, adminController.getAdminAccounts);
router.post('/accounts', protect, superadminOnly, adminController.createAdminAccount);
router.put('/accounts/:id', protect, superadminOnly, adminController.updateAdminAccount);
router.delete('/accounts/:id', protect, superadminOnly, adminController.deleteAdminAccount);

// Protected Question Bank Endpoints
router.get('/questions', protect, adminOnly, examController.getAllQuestions);
router.post('/questions', protect, adminOnly, examController.createQuestion);
router.put('/questions/:id', protect, adminOnly, examController.updateQuestion);
router.delete('/questions/:id', protect, adminOnly, examController.deleteQuestion);
router.post('/reset-defaults', protect, adminOnly, examController.resetDefaultQuestions);
router.post('/import-csv', protect, adminOnly, examController.importQuestionsCSV);

module.exports = router;
