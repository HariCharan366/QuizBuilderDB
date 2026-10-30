const express = require('express');
const router = express.Router();
const resultController = require('../controllers/resultController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.post('/', protect, resultController.submitExam);
router.get('/', protect, adminOnly, resultController.getAllResults);
router.get('/my-results', protect, resultController.getMyResults);
router.get('/student/:username', protect, resultController.getMyResults);
router.get('/:id', protect, resultController.getResultById);
router.delete('/', protect, adminOnly, resultController.clearAllResults);

module.exports = router;

