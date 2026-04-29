// routes/auth.js

const express  = require('express');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const User     = require('../models/User');
const authMW   = require('../middleware/auth');
const {
  sendWelcomeEmail,
  sendVerificationOtpEmail,
  sendPasswordResetOtpEmail,
} = require('../utils/email');
const { refreshUsage, buildUsageSnapshot, listPaymentPlans } = require('../services/billingService');

const router = express.Router();
const OTP_TTL_MINUTES = parseInt(process.env.EMAIL_OTP_TTL_MINUTES, 10) || 10;
const OTP_LENGTH = parseInt(process.env.EMAIL_OTP_LENGTH, 10) || 6;

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
    emailVerified: user.emailVerified !== false,
    email: user.email,
    usage: buildUsageSnapshot(user),
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp(length = OTP_LENGTH) {
  const digits = Math.max(4, Math.min(8, parseInt(length, 10) || 6));
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

function hashOtp({ purpose, email, otp }) {
  return crypto
    .createHash('sha256')
    .update(`${purpose}:${normalizeEmail(email)}:${String(otp).trim()}`)
    .digest('hex');
}

function buildOtpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

function queueEmail(task, label) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[DevAI] ${label}:`, error.message);
    });
}

async function loadUserByEmail(email, projection = '') {
  return User.findOne({ email: normalizeEmail(email) }).select(projection);
}

function setVerificationOtp(user, otp) {
  user.emailVerificationOtpHash = hashOtp({
    purpose: 'verify-email',
    email: user.email,
    otp,
  });
  user.emailVerificationOtpExpiresAt = buildOtpExpiry();
}

function clearVerificationOtp(user) {
  user.emailVerificationOtpHash = '';
  user.emailVerificationOtpExpiresAt = null;
}

function setPasswordResetOtp(user, otp) {
  user.passwordResetOtpHash = hashOtp({
    purpose: 'reset-password',
    email: user.email,
    otp,
  });
  user.passwordResetOtpExpiresAt = buildOtpExpiry();
}

function clearPasswordResetOtp(user) {
  user.passwordResetOtpHash = '';
  user.passwordResetOtpExpiresAt = null;
}

function isOtpExpired(expiresAt) {
  return !expiresAt || new Date(expiresAt).getTime() <= Date.now();
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

    const cleanEmail = normalizeEmail(email);
    const exists = await User.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
    }

    const user = await User.create({
      firstname,
      lastname,
      email: cleanEmail,
      password,
      emailVerified: false,
    });
    const otp = generateOtp();
    setVerificationOtp(user, otp);
    await user.save({ validateBeforeSave: false });

    try {
      await sendVerificationOtpEmail({
        to: user.email,
        firstname: user.firstname,
        otp,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
    } catch (emailErr) {
      await User.deleteOne({ _id: user._id });
      console.error('[DevAI] Verification email error:', emailErr.message);
      return res.status(502).json({ error: 'Impossible d’envoyer le code de vérification. Réessayez.' });
    }

    res.status(201).json({
      message: 'Compte créé. Un code de vérification a été envoyé par e-mail.',
      verificationRequired: true,
      email: user.email,
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
    const user = await User.findOne({ email: normalizeEmail(email) }).select('+password +emailVerificationOtpHash +emailVerificationOtpExpiresAt');
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    }

    if (user.emailVerified === false) {
      return res.status(403).json({
        error: 'Veuillez vérifier votre adresse e-mail avant de vous connecter.',
        verificationRequired: true,
        email: user.email,
      });
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

router.post('/resend-verification-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await loadUserByEmail(email, '+emailVerificationOtpHash +emailVerificationOtpExpiresAt');
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
    if (user.emailVerified !== false) {
      return res.status(409).json({ error: 'Ce compte est déjà vérifié.' });
    }

    const otp = generateOtp();
    setVerificationOtp(user, otp);
    await user.save({ validateBeforeSave: false });

    try {
      await sendVerificationOtpEmail({
        to: user.email,
        firstname: user.firstname,
        otp,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
    } catch (emailErr) {
      console.error('[DevAI] Verification resend email error:', emailErr.message);
      return res.status(502).json({ error: 'Impossible de renvoyer le code. Réessayez.' });
    }

    res.json({ message: 'Un nouveau code de vérification a été envoyé.' });
  } catch (err) { next(err); }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const cleanEmail = normalizeEmail(email);
    const cleanOtp = String(otp || '').trim();

    if (!cleanEmail || !cleanOtp) {
      return res.status(400).json({ error: 'E-mail et code OTP requis.' });
    }

    const user = await User.findOne({ email: cleanEmail }).select('+emailVerificationOtpHash +emailVerificationOtpExpiresAt');
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
    if (user.emailVerified !== false) {
      return res.json({
        message: 'Compte déjà vérifié.',
        token: signToken(user._id),
        user: serializeUser(user),
      });
    }
    if (isOtpExpired(user.emailVerificationOtpExpiresAt)) {
      return res.status(400).json({ error: 'Code expiré. Demandez un nouveau code.' });
    }

    const expectedHash = hashOtp({
      purpose: 'verify-email',
      email: user.email,
      otp: cleanOtp,
    });
    if (user.emailVerificationOtpHash !== expectedHash) {
      return res.status(400).json({ error: 'Code OTP invalide.' });
    }

    user.emailVerified = true;
    clearVerificationOtp(user);
    await user.save({ validateBeforeSave: false });

    queueEmail(() => sendWelcomeEmail({
      to: user.email,
      firstname: user.firstname,
      loginUrl: `${getFrontendUrl(req)}/app.html`,
    }), 'Welcome email error');

    const token = signToken(user._id);
    res.json({
      message: 'Adresse e-mail vérifiée avec succès.',
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
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return res.status(400).json({ error: 'E-mail requis.' });

    const user = await User.findOne({ email: cleanEmail }).select('+passwordResetOtpHash +passwordResetOtpExpiresAt');

    // Répondre toujours OK (sécurité : ne pas révéler si le compte existe)
    if (!user) {
      return res.json({ message: 'Si ce compte existe, un code a été envoyé.' });
    }

    const otp = generateOtp();
    setPasswordResetOtp(user, otp);
    await user.save({ validateBeforeSave: false });

    try {
      await sendPasswordResetOtpEmail({
        to: user.email,
        firstname: user.firstname,
        otp,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
    } catch (emailErr) {
      clearPasswordResetOtp(user);
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email. Réessayez.' });
    }

    res.json({ message: 'Si ce compte existe, un code a été envoyé.' });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// POST /api/auth/reset-password
// ══════════════════════════════════════
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, otp, password } = req.body;
    const cleanEmail = normalizeEmail(email);
    const cleanOtp = String(otp || '').trim();

    if (!cleanEmail || !cleanOtp || !password) {
      return res.status(400).json({ error: 'E-mail, code OTP et nouveau mot de passe requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum).' });
    }

    const user = await User.findOne({ email: cleanEmail }).select('+passwordResetOtpHash +passwordResetOtpExpiresAt');

    if (!user) {
      return res.status(400).json({ error: 'Code invalide ou expiré. Faites une nouvelle demande.' });
    }

    if (isOtpExpired(user.passwordResetOtpExpiresAt)) {
      return res.status(400).json({ error: 'Code expiré. Faites une nouvelle demande.' });
    }

    const expectedHash = hashOtp({
      purpose: 'reset-password',
      email: user.email,
      otp: cleanOtp,
    });

    if (user.passwordResetOtpHash !== expectedHash) {
      return res.status(400).json({ error: 'Code OTP invalide.' });
    }

    user.password             = password;
    clearPasswordResetOtp(user);
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
