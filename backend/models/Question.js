const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true
    },
    optionA: {
      type: String,
      required: [true, 'Option A is required'],
      trim: true
    },
    optionB: {
      type: String,
      required: [true, 'Option B is required'],
      trim: true
    },
    optionC: {
      type: String,
      required: [true, 'Option C is required'],
      trim: true
    },
    optionD: {
      type: String,
      required: [true, 'Option D is required'],
      trim: true
    },
    correct: {
      type: Number,
      required: [true, 'Correct option index (0, 1, 2, 3) is required'],
      min: 0,
      max: 3,
      // Anti-cheating guard: hidden by default so students cannot inspect network payload
      select: false
    },
    domain: {
      type: String,
      default: 'General'
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      default: null
    },
    isDefault: {
      type: Boolean,
      default: false
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

questionSchema.index({ exam: 1, isDefault: 1 });
questionSchema.index({ domain: 1 });

module.exports = mongoose.model('Question', questionSchema);

