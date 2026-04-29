// middleware/auth.js

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    // Récupérer le token depuis le header Authorization: Bearer <token>
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise. Token manquant.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Vérifier que l'utilisateur existe toujours
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Utilisateur introuvable. Reconnectez-vous.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token invalide.' });
    }
    next(err);
  }
};