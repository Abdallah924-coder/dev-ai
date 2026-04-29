// routes/conversations.js

const express      = require('express');
const authMW       = require('../middleware/auth');
const Conversation = require('../models/Conversation');

const router = express.Router();
router.use(authMW); // Toutes les routes nécessitent une authentification

// ══════════════════════════════════════
// GET /api/conversations
// Liste toutes les conversations de l'utilisateur
// ══════════════════════════════════════
router.get('/', async (req, res, next) => {
  try {
    const conversations = await Conversation
      .find({ user: req.user._id })
      .select('title hidden mode lastIntent createdAt updatedAt')  // Ne pas renvoyer les messages (trop lourd)
      .sort({ updatedAt: -1 });

    res.json({ conversations });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// GET /api/conversations/:id
// Récupérer une conversation avec ses messages
// ══════════════════════════════════════
router.get('/:id', async (req, res, next) => {
  try {
    const conv = await Conversation.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
    res.json({ conversation: conv });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// POST /api/conversations
// Créer une nouvelle conversation
// ══════════════════════════════════════
router.post('/', async (req, res, next) => {
  try {
    const { title } = req.body;
    const conv = await Conversation.create({
      user:  req.user._id,
      title: title || 'Nouvelle discussion',
    });

    res.status(201).json({ conversation: conv });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// PATCH /api/conversations/:id
// Modifier titre ou statut hidden
// ══════════════════════════════════════
router.patch('/:id', async (req, res, next) => {
  try {
    const { title, hidden, mode } = req.body;
    const conv = await Conversation.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });

    if (title  !== undefined) conv.title  = title;
    if (hidden !== undefined) conv.hidden = hidden;
    if (mode !== undefined) conv.mode = mode;
    await conv.save();

    res.json({ conversation: conv });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// DELETE /api/conversations/:id
// Supprimer une conversation
// ══════════════════════════════════════
router.delete('/:id', async (req, res, next) => {
  try {
    const conv = await Conversation.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
    res.json({ message: 'Conversation supprimée.' });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════
// DELETE /api/conversations
// Supprimer toutes les conversations
// ══════════════════════════════════════
router.delete('/', async (req, res, next) => {
  try {
    await Conversation.deleteMany({ user: req.user._id });
    res.json({ message: 'Toutes les conversations ont été supprimées.' });
  } catch (err) { next(err); }
});

module.exports = router;
