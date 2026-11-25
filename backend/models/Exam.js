const mongoose = require('mongoose');

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      default: 'Programming Fundamentals Examination'
    },
    code: {
      type: String,
      unique: true,
      default: 'CS-EXAM-01'
    },
    description: {
      type: String,
      default: 'Standard online secure examination assessing programming proficiency.'
    },
    durationMinutes: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
      max: 180
    },
    totalQuestions: {
      type: Number,
      default: 40
    },
    maxWarnings: {
      type: Number,
      default: 3
    },
    passingPercentage: {
      type: Number,
      default: 50
    },
    isActive: {
      type: Boolean,
      default: true
    },
    randomizeQuestions: {
      type: Boolean,
      default: true
    },
    maxAttempts: {
      type: Number,
      default: 1,
      min: 1
    },
    showAnswersAfterSubmit: {
      type: Boolean,
      default: true
    },
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    },
    retakesGranted: [
      {
        student: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        attemptsAllowed: {
          type: Number,
          default: 1
        },
        attemptsUsed: {
          type: Number,
          default: 0
        },
        grantedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        grantedAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Exam', examSchema);

