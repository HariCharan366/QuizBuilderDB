const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    adminUsername: {
      type: String,
      default: 'system'
    },
    targetType: {
      type: String,
      enum: ['User', 'Exam', 'Question', 'Result', 'ExamSession', 'System', 'Auth'],
      default: 'System'
    },
    targetId: {
      type: String,
      default: null
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ip: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ adminUsername: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
