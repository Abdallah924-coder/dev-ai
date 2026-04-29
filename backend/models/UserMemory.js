const mongoose = require('mongoose');

const memoryFactSchema = new mongoose.Schema({
  key:       { type: String, required: true, trim: true, maxlength: 80 },
  value:     { type: String, required: true, trim: true, maxlength: 280 },
  category:  { type: String, enum: ['identity', 'preference', 'skill', 'goal', 'project'], default: 'preference' },
  confidence:{ type: Number, min: 0, max: 1, default: 0.6 },
  source:    { type: String, enum: ['heuristic', 'assistant', 'manual'], default: 'heuristic' },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const userMemorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  profileSummary: { type: String, default: '' },
  preferences: {
    responseStyle: { type: String, default: 'clair, pédagogique et structuré' },
    language:      { type: String, default: 'fr' },
  },
  strengths:   [{ type: String, trim: true, maxlength: 60 }],
  goals:       [{ type: String, trim: true, maxlength: 140 }],
  activeTopics:[{ type: String, trim: true, maxlength: 80 }],
  facts:       [memoryFactSchema],
  lastUpdatedFromMessageAt: { type: Date },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

module.exports = mongoose.model('UserMemory', userMemorySchema);
