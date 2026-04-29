const express = require('express');
const rateLimit = require('express-rate-limit');
const NewsletterSubscription = require('../models/NewsletterSubscription');
const {
  sendContactEmail,
  sendNewsletterNotificationEmail,
  sendNewsletterSubscriberEmail,
} = require('../utils/email');

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Trop de messages envoyés. Réessayez plus tard.' },
});

const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: { error: 'Trop de tentatives d’inscription. Réessayez plus tard.' },
});

function queueEmail(task, label) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[DevAI] ${label}:`, error.message);
    });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

router.post('/contact', contactLimiter, async (req, res, next) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Tous les champs du formulaire sont requis.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }

    if (String(name).trim().length > 100 || String(subject).trim().length > 180 || String(message).trim().length > 4000) {
      return res.status(400).json({ error: 'Le contenu du formulaire est trop long.' });
    }

    await sendContactEmail({
      name: String(name).trim(),
      email: String(email).trim(),
      subject: String(subject).trim(),
      message: String(message).trim(),
    });

    res.status(201).json({ message: 'Message envoyé avec succès.' });
  } catch (err) { next(err); }
});

router.post('/newsletter', newsletterLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Votre e-mail est requis.' });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }

    const existing = await NewsletterSubscription.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(200).json({ message: 'Cet e-mail est déjà inscrit à la newsletter.' });
    }

    await NewsletterSubscription.create({
      email: cleanEmail,
      source: 'website',
    });

    await sendNewsletterNotificationEmail({ email: cleanEmail });
    queueEmail(() => sendNewsletterSubscriberEmail({ email: cleanEmail }), 'Newsletter subscriber email error');

    res.status(201).json({ message: 'Inscription newsletter enregistrée.' });
  } catch (err) { next(err); }
});

module.exports = router;
