// routes/auth.js

const express  = require('express');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const User     = require('../models/User');
const authMW   = require('../middleware/auth');
const { sendResetEmail, sendWelcomeEmail } = require('../utils/email');
const { refreshUsage, buildUsageSnapshot, listPaymentPlans } = require('../services/billingService');

const router = express.Router();

function getFrontendUrl(req) {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/+$/, '');
  }

  const origin = req.get('origin');
  if (origin) return origin.replace(/\/+$/, '');

  return 'http://localhost:3000';
}

// ── Générer un JWT ──
function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

function serializeUser(user) {
  refreshUsage(user);
  return {
    id: user._id,
    firstname: user.firstname,
    lastname: user.lastname,
    preferredName: user.preferredName || '',
    birthDate: user.birthDate,
    onboardingCompleted: Boolean(user.onboardingCompleted),
    email: user.email,
    usage: buildUsageSnapshot(user),
  };
}

function queueEmail(task, label) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[DevAI] ${label}:`, error.message);
    });
}

// ══════════════════════════════════════
// POST /api/auth/register
// ══════════════════════════════════════
router.post('/register', async (req, res, next) => {
  try {
    const { firstname, lastname, email, password } = req.body;

    if (!firstname || !lastname || !email || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
    }

    const user = await User.create({ firstname, lastname, email, password });
    const token = signToken(user._id);
    const frontendUrl = getFrontendUrl(req);

    queueEmail(() => sendWelcomeEmail({
        to: user.email,
        firstname: user.firstname,
        loginUrl: `${frontendUrl}/app.html`,
      }), 'Welcome email error');

    res.status(201).json({
      message: 'Compte créé avec succès.',
      token,
      user: serializeUser(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Cet e-mail est déjà utilisé.' });
    }
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map(e => e.message).join(' ');
      return res.status(400).json({ error: msg });
    }
    next(err);
  }
});

// ══════════════════════════════════════
// POST /api/auth/login
// ══════════════════════════════════════
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail et mot de passe requis.' });
    }

    // Sélectionner le password (exclu par défaut)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    }

    user.lastLoginAt = Date.now();
    User.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: user.lastLoginAt } },
      { runValidators: false }
    ).catch((error) => {
      console.error('[DevAI] Last login update error:', error.message);
    });

    const token = signToken(user._id);

    res.json({
      message: 'Connexion réussie.',
      token,
      user: serializeUser(user),
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// POST /api/auth/forgot-password
// ══════════════════════════════════════
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail requis.' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+resetPasswordToken +resetPasswordExpires');

    // Répondre toujours OK (sécurité : ne pas révéler si le compte existe)
    if (!user) {
      return res.json({ message: 'Si ce compte existe, un email a été envoyé.' });
    }

    // Générer un token sécurisé
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken   = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 heure
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${getFrontendUrl(req)}/reset-password.html?token=${resetToken}`;

    try {
      await sendResetEmail({
        to: user.email,
        firstname: user.firstname,
        resetUrl,
      });
    } catch (emailErr) {
      // Annuler le token si l'email échoue
      user.resetPasswordToken   = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email. Réessayez.' });
    }

    res.json({ message: 'Si ce compte existe, un email a été envoyé.' });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// POST /api/auth/reset-password
// ══════════════════════════════════════
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token et nouveau mot de passe requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum).' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken:   hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({ error: 'Lien invalide ou expiré. Faites une nouvelle demande.' });
    }

    user.password             = password;
    user.resetPasswordToken   = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    const newToken = signToken(user._id);
    res.json({ message: 'Mot de passe réinitialisé avec succès.', token: newToken });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// GET /api/auth/me  (profil courant)
// ══════════════════════════════════════
router.get('/me', authMW, (req, res) => {
  res.json({
    user: serializeUser(req.user),
    paymentPlans: listPaymentPlans(),
  });
});

router.put('/onboarding', authMW, async (req, res, next) => {
  try {
    const { preferredName, birthDate } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const cleanPreferredName = String(preferredName || '').trim();
    if (!cleanPreferredName) {
      return res.status(400).json({ error: 'Le prénom ou surnom est requis.' });
    }

    if (!birthDate) {
      return res.status(400).json({ error: 'La date de naissance est requise.' });
    }

    const parsedBirthDate = new Date(birthDate);
    if (Number.isNaN(parsedBirthDate.getTime())) {
      return res.status(400).json({ error: 'Date de naissance invalide.' });
    }

    const now = new Date();
    if (parsedBirthDate > now) {
      return res.status(400).json({ error: 'La date de naissance ne peut pas être dans le futur.' });
    }

    user.preferredName = cleanPreferredName;
    user.birthDate = parsedBirthDate;
    user.onboardingCompleted = true;
    await user.save({ validateBeforeSave: false });

    res.json({
      message: 'Onboarding enregistré avec succès.',
      user: serializeUser(user),
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// PUT /api/auth/profile  (modifier le profil)
// ══════════════════════════════════════
router.put('/profile', authMW, async (req, res, next) => {
  try {
    const { firstname, lastname, preferredName, birthDate, email, password } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (firstname) user.firstname = firstname.trim();
    if (lastname)  user.lastname  = lastname.trim();
    if (preferredName !== undefined) user.preferredName = String(preferredName || '').trim();

    if (birthDate !== undefined) {
      if (!birthDate) {
        user.birthDate = null;
      } else {
        const parsedBirthDate = new Date(birthDate);
        if (Number.isNaN(parsedBirthDate.getTime())) {
          return res.status(400).json({ error: 'Date de naissance invalide.' });
        }
        if (parsedBirthDate > new Date()) {
          return res.status(400).json({ error: 'La date de naissance ne peut pas être dans le futur.' });
        }
        user.birthDate = parsedBirthDate;
      }
    }

    if (email && email.toLowerCase() !== user.email) {
      const conflict = await User.findOne({ email: email.toLowerCase() });
      if (conflict) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé.' });
      user.email = email.toLowerCase().trim();
    }

    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court.' });
      user.password = password;
    }

    await user.save();

    res.json({
      message: 'Profil mis à jour avec succès.',
      user: serializeUser(user),
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map(e => e.message).join(' ');
      return res.status(400).json({ error: msg });
    }
    next(err);
  }
});

module.exports = router;
