const mongoose = require('mongoose');

const examSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    username: {
      type: String,
      required: true
    },
    studentName: {
      type: String,
      required: true
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true
    },
    // The exact 40 unique question IDs chosen on the backend for this session
    questionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
      }
    ],
    // The questions with shuffled options for this student (answers completely excluded)
    questionsData: [
      {
        questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
        question: String,
        options: [String]
      }
    ],
    // Map of questionId -> selectedOptionIndex (0-3)
    answers: {
      type: Map,
      of: Number,
      default: {}
    },
    // Map of questionId -> Boolean (marked for review flag)
    markedForReview: {
      type: Map,
      of: Boolean,
      default: {}
    },
    warnings: {
      type: Number,
      default: 0
    },
    durationMinutes: {
      type: Number,
      default: 15
    },
    startTime: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    },
    submittedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'submitted', 'expired'],
      default: 'active'
    }
  },
  {
    timestamps: true
  }
);

examSessionSchema.index({ student: 1, exam: 1, status: 1 });
examSessionSchema.index({ expiresAt: 1, status: 1 });

module.exports = mongoose.model('ExamSession', examSessionSchema);

