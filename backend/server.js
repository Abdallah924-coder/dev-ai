// ═══════════════════════════════════════════
// DEVAI — WORLDIFYAI  |  server.js
// Auteur : DEVOUE LI
// ═══════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const authRoutes  = require('./routes/auth');
const chatRoutes  = require('./routes/chat');
const convRoutes  = require('./routes/conversations');
const publicRoutes = require('./routes/public');
const billingRoutes = require('./routes/billing');
const adminRoutes = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Render met l'app derrière un proxy inverse.
// Sans ça, express-rate-limit voit X-Forwarded-For comme suspect.
app.set('trust proxy', 1);

// ── Sécurité ──
app.use(helmet());

// ── CORS ──
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqué pour l'origine : ${origin}`));
  },
  credentials: true,
}));

// ── Body parser ──
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));

// ── Rate limiting global ──
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
}));

// ── Rate limiting strict pour l'auth ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

// ── Routes ──
app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/chat',          chatRoutes);
app.use('/api/conversations', convRoutes);
app.use('/api/public',        publicRoutes);
app.use('/api/billing',       billingRoutes);
app.use('/api/admin',         adminRoutes);

// ── Sanity check ──
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  service: 'DevAI Backend',
  company: 'WORLDIFYAI',
  author: 'DEVOUE LI',
  timestamp: new Date().toISOString(),
}));

// ── 404 handler ──
app.use((_, res) => res.status(404).json({ error: 'Route introuvable.' }));

// ── Global error handler ──
app.use((err, req, res, next) => {
  console.error('[DevAI Error]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Erreur serveur interne.' });
});

if (!MONGODB_URI) {
  console.error('❌ Variable manquante : MONGODB_URI');
  process.exit(1);
}

// ── Connexion MongoDB & démarrage ──
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connecté');
    app.listen(PORT, () => console.log(`🚀 DevAI backend démarré sur le port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Erreur MongoDB :', err.message);
    process.exit(1);
  });

module.exports = app;
