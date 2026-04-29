const mongoose = require('mongoose');

const paymentRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  planCode: {
    type: String,
    required: true,
    enum: [
      'pack_100',
      'pack_300',
      'pack_1000',
      'sub_500',
      'sub_1500',
    ],
  },
  planLabel: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  amountUsd: {
    type: Number,
    required: true,
    min: 0,
  },
  amountFcfa: {
    type: Number,
    required: true,
    min: 0,
  },
  credits: {
    type: Number,
    required: true,
    min: 0,
  },
  isSubscription: {
    type: Boolean,
    default: false,
  },
  payerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  payerPhone: {
    type: String,
    required: true,
    trim: true,
    maxlength: 40,
  },
  paymentReference: {
    type: String,
    default: '',
    trim: true,
    maxlength: 120,
  },
  note: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1200,
  },
  proofData: {
    type: Buffer,
    default: null,
    select: false,
  },
  proofPath: {
    type: String,
    default: '',
    trim: true,
    maxlength: 260,
  },
  proofMimeType: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80,
  },
  proofOriginalName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  adminNote: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1200,
  },
  reviewedAt: {
    type: Date,
    default: null,
  },
  reviewedBy: {
    type: String,
    default: '',
    trim: true,
    maxlength: 80,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('PaymentRequest', paymentRequestSchema);
