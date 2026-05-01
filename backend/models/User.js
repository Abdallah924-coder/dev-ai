// models/User.js

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstname: {
    type: String,
    required: [true, 'Le prénom est requis.'],
    trim: true,
    maxlength: [50, 'Prénom trop long.'],
  },
  lastname: {
    type: String,
    required: [true, 'Le nom est requis.'],
    trim: true,
    maxlength: [50, 'Nom trop long.'],
  },
  preferredName: {
    type: String,
    trim: true,
    maxlength: [50, 'Surnom trop long.'],
    default: '',
  },
  birthDate: {
    type: Date,
    default: null,
  },
  onboardingCompleted: {
    type: Boolean,
    default: false,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  email: {
    type: String,
    required: [true, 'L\'e-mail est requis.'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Adresse e-mail invalide.'],
  },
  emailVerificationOtpHash: { type: String, select: false, default: '' },
  emailVerificationOtpExpiresAt: { type: Date, select: false, default: null },
  passwordResetOtpHash: { type: String, select: false, default: '' },
  passwordResetOtpExpiresAt: { type: Date, select: false, default: null },
  password: {
    type: String,
    required: [true, 'Le mot de passe est requis.'],
    minlength: [6, 'Mot de passe trop court (6 caractères minimum).'],
    select: false, // Jamais renvoyé dans les requêtes par défaut
  },
  passwordHistory: {
    type: [String],
    select: false,
    default: [],
  },
  usage: {
    freeMessagesPerWindow: { type: Number, default: 20, min: 0 },
    freeWindowHours: { type: Number, default: 5, min: 1 },
    freeWindowStartedAt: { type: Date, default: Date.now },
    freeMessagesUsedInWindow: { type: Number, default: 0, min: 0 },
    minuteWindowStartedAt: { type: Date, default: Date.now },
    minuteMessagesUsed: { type: Number, default: 0, min: 0 },
    minuteLimit: { type: Number, default: 5, min: 1 },
    packageCredits: { type: Number, default: 0, min: 0 },
    subscriptionPlanCode: { type: String, default: '' },
    subscriptionCreditsRemaining: { type: Number, default: 0, min: 0 },
    subscriptionStartedAt: { type: Date, default: null },
    subscriptionExpiresAt: { type: Date, default: null },
    lastPaymentApprovedAt: { type: Date, default: null },
  },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date },
}, {
  toJSON: {
    transform(_, ret) {
      delete ret.password;
      delete ret.passwordHistory;
      delete ret.emailVerificationOtpHash;
      delete ret.emailVerificationOtpExpiresAt;
      delete ret.passwordResetOtpHash;
      delete ret.passwordResetOtpExpiresAt;
      delete ret.__v;
      return ret;
    }
  }
});

// ── Hash du mot de passe avant sauvegarde ──
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Comparer mot de passe ──
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
