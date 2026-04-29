// models/Conversation.js

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'ai'], required: true },
  content:   { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const researchSourceSchema = new mongoose.Schema({
  title:   { type: String, default: '', maxlength: 220 },
  url:     { type: String, default: '', maxlength: 500 },
  snippet: { type: String, default: '', maxlength: 1200 },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  title:    { type: String, default: 'Nouvelle discussion', maxlength: 120 },
  messages: [messageSchema],
  hidden:   { type: Boolean, default: false },
  mode: {
    type: String,
    enum: ['standard', 'code', 'math', 'deep_research'],
    default: 'standard',
  },
  summary: { type: String, default: '', maxlength: 3000 },
  lastIntent: { type: String, default: 'general', maxlength: 40 },
  lastResearchPlan: [{ type: String, maxlength: 220 }],
  lastResearchSources: [researchSourceSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  toJSON: { virtuals: true },
});

// Mettre à jour updatedAt à chaque modification
conversationSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Conversation', conversationSchema);
