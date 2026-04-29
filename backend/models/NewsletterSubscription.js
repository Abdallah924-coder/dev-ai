const mongoose = require('mongoose');

const newsletterSubscriptionSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Adresse e-mail invalide.'],
  },
  source: {
    type: String,
    default: 'website',
    maxlength: 40,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('NewsletterSubscription', newsletterSubscriptionSchema);
