const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const PaymentRequest = require('../models/PaymentRequest');
const User = require('../models/User');
const {
  applyApprovedPlan,
  buildUsageSnapshot,
} = require('../services/billingService');
const {
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
} = require('../utils/email');

const router = express.Router();

function queueEmail(task, label) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[DevAI] ${label}:`, error.message);
    });
}

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim();
}

function signAdminToken() {
  return jwt.sign(
    { scope: 'admin' },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function adminAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification admin requise.' });
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
    if (payload.scope !== 'admin') {
      return res.status(403).json({ error: 'Accès admin refusé.' });
    }

    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session admin invalide ou expirée.' });
  }
}

router.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD non configuré sur le serveur.' });
  }

  if (password !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe admin incorrect.' });
  }

  res.json({ token: signAdminToken() });
});

router.get('/overview', adminAuth, async (req, res, next) => {
  try {
    const [pendingCount, approvedCount, rejectedCount, usersCount] = await Promise.all([
      PaymentRequest.countDocuments({ status: 'pending' }),
      PaymentRequest.countDocuments({ status: 'approved' }),
      PaymentRequest.countDocuments({ status: 'rejected' }),
      User.countDocuments({}),
    ]);

    res.json({
      counts: {
        pendingCount,
        approvedCount,
        rejectedCount,
        usersCount,
      },
    });
  } catch (err) { next(err); }
});

router.get('/payment-requests', adminAuth, async (req, res, next) => {
  try {
    const paymentRequests = await PaymentRequest.find({})
      .populate('user', 'firstname lastname email usage')
      .sort({ createdAt: -1 });

    res.json({ paymentRequests });
  } catch (err) { next(err); }
});

router.get('/payment-requests/:id/proof', adminAuth, async (req, res, next) => {
  try {
    const paymentRequest = await PaymentRequest.findById(req.params.id).select('+proofData');
    if (!paymentRequest) {
      return res.status(404).json({ error: 'Demande introuvable.' });
    }

    if (paymentRequest.proofData?.length) {
      res.setHeader('Content-Type', paymentRequest.proofMimeType);
      res.setHeader('Content-Disposition', `inline; filename="${paymentRequest.proofOriginalName}"`);
      return res.send(paymentRequest.proofData);
    }

    if (paymentRequest.proofPath) {
      const resolvedPath = path.resolve(paymentRequest.proofPath);
      if (fs.existsSync(resolvedPath)) {
        return res.sendFile(resolvedPath, {
          headers: {
            'Content-Type': paymentRequest.proofMimeType,
            'Content-Disposition': `inline; filename="${paymentRequest.proofOriginalName}"`,
          },
        });
      }
    }

    return res.status(410).json({
      error: 'La preuve enregistrée n’est plus disponible sur le serveur. Les nouvelles preuves sont désormais stockées en base.',
    });
  } catch (err) { next(err); }
});

router.post('/payment-requests/:id/approve', adminAuth, async (req, res, next) => {
  try {
    const paymentRequest = await PaymentRequest.findById(req.params.id);
    if (!paymentRequest) {
      return res.status(404).json({ error: 'Demande introuvable.' });
    }
    if (paymentRequest.status !== 'pending') {
      return res.status(409).json({ error: 'Cette demande a déjà été traitée.' });
    }

    const user = await User.findById(paymentRequest.user);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const approvedPlan = applyApprovedPlan(user, paymentRequest.planCode);
    await user.save({ validateBeforeSave: false });

    paymentRequest.status = 'approved';
    paymentRequest.reviewedAt = new Date();
    paymentRequest.reviewedBy = 'admin';
    paymentRequest.adminNote = String(req.body.adminNote || '').trim();
    await paymentRequest.save();

    queueEmail(() => sendPaymentApprovedEmail({
        to: user.email,
        firstname: user.firstname,
        planLabel: paymentRequest.planLabel,
        usage: buildUsageSnapshot(user),
      }), 'Payment approved email error');

    res.json({
      message: 'Paiement approuvé et crédits appliqués.',
      plan: approvedPlan,
      usage: buildUsageSnapshot(user),
    });
  } catch (err) { next(err); }
});

router.post('/payment-requests/:id/reject', adminAuth, async (req, res, next) => {
  try {
    const paymentRequest = await PaymentRequest.findById(req.params.id).populate('user', 'firstname email');
    if (!paymentRequest) {
      return res.status(404).json({ error: 'Demande introuvable.' });
    }
    if (paymentRequest.status !== 'pending') {
      return res.status(409).json({ error: 'Cette demande a déjà été traitée.' });
    }

    paymentRequest.status = 'rejected';
    paymentRequest.reviewedAt = new Date();
    paymentRequest.reviewedBy = 'admin';
    paymentRequest.adminNote = String(req.body.adminNote || '').trim();
    await paymentRequest.save();

    queueEmail(() => sendPaymentRejectedEmail({
        to: paymentRequest.user.email,
        firstname: paymentRequest.user.firstname,
        planLabel: paymentRequest.planLabel,
        adminNote: paymentRequest.adminNote,
      }), 'Payment rejected email error');

    res.json({ message: 'Demande rejetée.' });
  } catch (err) { next(err); }
});

module.exports = router;
