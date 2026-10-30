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
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Exam', examSchema);

