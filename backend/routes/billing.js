const express = require('express');
const fs = require('fs');
const path = require('path');
const authMW = require('../middleware/auth');
const PaymentRequest = require('../models/PaymentRequest');
const {
  buildUsageSnapshot,
  getPaymentPlan,
  listPaymentPlans,
} = require('../services/billingService');
const {
  sendPaymentRequestAdminEmail,
  sendPaymentRequestUserEmail,
} = require('../utils/email');

const router = express.Router();
const PROOF_DIR = path.join(__dirname, '..', 'uploads', 'payment-proofs');
const MAX_PROOF_SIZE_BYTES = 2 * 1024 * 1024;

router.use(authMW);

function ensureProofDir() {
  fs.mkdirSync(PROOF_DIR, { recursive: true });
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) {
    const error = new Error('La preuve doit être une image PNG, JPG ou WEBP.');
    error.status = 400;
    throw error;
  }

  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');

  if (!buffer.length || buffer.length > MAX_PROOF_SIZE_BYTES) {
    const error = new Error('La preuve de paiement dépasse la taille maximale autorisée (2 MB).');
    error.status = 400;
    throw error;
  }

  return { mimeType, buffer };
}

function getFileExtension(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function saveProofImage({ userId, proofDataUrl, originalName }) {
  ensureProofDir();
  const { mimeType, buffer } = parseDataUrl(proofDataUrl);
  const extension = getFileExtension(mimeType);
  const fileName = `${userId}-${Date.now()}.${extension}`;
  const absolutePath = path.join(PROOF_DIR, fileName);
  fs.writeFileSync(absolutePath, buffer);

  return {
    proofPath: absolutePath,
    proofMimeType: mimeType,
    proofOriginalName: String(originalName || `preuve.${extension}`).slice(0, 180),
  };
}

router.get('/status', async (req, res, next) => {
  try {
    const latestRequests = await PaymentRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('planCode planLabel amountUsd amountFcfa credits isSubscription status createdAt reviewedAt adminNote');

    res.json({
      usage: buildUsageSnapshot(req.user),
      paymentPlans: listPaymentPlans(),
      paymentRequests: latestRequests,
      payee: {
        phone: '+242 06 668 94 48',
        name: 'MICHY MAGELLAN DEVOUE LI-MBOUITY',
      },
    });
  } catch (err) { next(err); }
});

router.post('/payment-requests', async (req, res, next) => {
  try {
    const {
      planCode,
      payerName,
      payerPhone,
      paymentReference,
      note,
      proofDataUrl,
      proofOriginalName,
    } = req.body;

    const plan = getPaymentPlan(planCode);
    if (!plan) {
      return res.status(400).json({ error: 'Plan de paiement invalide.' });
    }

    if (!payerName || !payerPhone || !proofDataUrl) {
      return res.status(400).json({ error: 'Nom, téléphone et preuve de paiement sont requis.' });
    }

    const latestPending = await PaymentRequest.findOne({
      user: req.user._id,
      status: 'pending',
    }).sort({ createdAt: -1 });

    if (latestPending) {
      return res.status(409).json({ error: 'Une demande de paiement est déjà en attente de validation.' });
    }

    const proof = saveProofImage({
      userId: req.user._id,
      proofDataUrl,
      originalName: proofOriginalName,
    });

    const paymentRequest = await PaymentRequest.create({
      user: req.user._id,
      planCode: plan.code,
      planLabel: plan.label,
      amountUsd: plan.amountUsd,
      amountFcfa: plan.amountFcfa,
      credits: plan.credits,
      isSubscription: plan.isSubscription,
      payerName: String(payerName).trim(),
      payerPhone: String(payerPhone).trim(),
      paymentReference: String(paymentReference || '').trim(),
      note: String(note || '').trim(),
      ...proof,
    });

    try {
      await sendPaymentRequestAdminEmail({
        requestId: paymentRequest._id,
        userEmail: req.user.email,
        userName: `${req.user.firstname} ${req.user.lastname}`.trim(),
        planLabel: paymentRequest.planLabel,
        payerName: paymentRequest.payerName,
        payerPhone: paymentRequest.payerPhone,
        paymentReference: paymentRequest.paymentReference,
        note: paymentRequest.note,
      });
    } catch (emailErr) {
      console.error('[DevAI] Payment admin email error:', emailErr.message);
    }

    try {
      await sendPaymentRequestUserEmail({
        to: req.user.email,
        firstname: req.user.firstname,
        planLabel: paymentRequest.planLabel,
      });
    } catch (emailErr) {
      console.error('[DevAI] Payment user email error:', emailErr.message);
    }

    res.status(201).json({
      message: 'Demande de paiement envoyée. Elle sera validée manuellement.',
      paymentRequest: paymentRequest.toJSON(),
      usage: buildUsageSnapshot(req.user),
    });
  } catch (err) { next(err); }
});

module.exports = router;
