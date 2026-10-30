const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    studentName: {
      type: String,
      required: true,
      trim: true
    },
    username: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      default: ''
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      default: null
    },
    examTitle: {
      type: String,
      default: 'Programming Fundamentals Examination'
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExamSession',
      default: null
    },
    score: {
      type: Number,
      required: true
    },
    total: {
      type: Number,
      required: true
    },
    percentage: {
      type: Number,
      required: true
    },
    correct: {
      type: Number,
      required: true
    },
    wrong: {
      type: Number,
      required: true
    },
    unanswered: {
      type: Number,
      required: true
    },
    timeTaken: {
      type: String,
      default: '0:00'
    },
    timeTakenSeconds: {
      type: Number,
      default: 0
    },
    submittedAt: {
      type: String,
      default: ''
    },
    dateTime: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['Passed', 'Failed'],
      default: 'Failed'
    },
    warnings: {
      type: Number,
      default: 0
    },
    answers: [
      {
        question: String,
        options: [String],
        selectedIndex: { type: Number, default: null },
        correctIndex: Number,
        isCorrect: Boolean
      }
    ]
  },
  {
    timestamps: true
  }
);

// Atomic uniqueness constraint: A session can produce ONLY one Result document
resultSchema.index({ session: 1 }, { unique: true, sparse: true });
resultSchema.index({ student: 1, createdAt: -1 });
resultSchema.index({ username: 1, createdAt: -1 });
resultSchema.index({ status: 1 });

module.exports = mongoose.model('Result', resultSchema);

