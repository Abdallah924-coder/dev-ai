// routes/chat.js
// Proxy sécurisé vers l'API Anthropic — la clé reste côté serveur

const express      = require('express');
const fetch        = require('node-fetch');
const authMW       = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const rateLimit    = require('express-rate-limit');
const {
  updateMemoryFromMessage,
  getOrCreateUserMemory,
} = require('../services/memoryService');
const {
  inferIntent,
  shouldUseWebResearch,
  resolveMode,
  buildResearchPlan,
  buildSystemPrompt,
  buildApiMessages,
  buildConversationSummaryAfterReply,
  getRequestConfig,
} = require('../services/chatOrchestrator');
const { performWebResearch } = require('../services/webResearchService');
const {
  enforceUserCanSendMessage,
  consumeOneMessage,
  normalizeOutgoingMessage,
  buildUsageSnapshot,
  MESSAGE_MAX_LENGTH,
} = require('../services/billingService');

const router = express.Router();
router.use(authMW);

// Rate limiting spécifique au chat (protège votre quota Anthropic)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 30,               // 30 messages par minute max par IP
  message: { error: 'Trop de messages envoyés. Attendez un moment.' },
});

function sendStreamEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function parseSseEvent(rawEvent) {
  const lines = String(rawEvent || '').split('\n');
  let event = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return {
    event,
    data: dataLines.join('\n'),
  };
}

function getApiKey() {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey || apiKey === 'sk-ant-...' || apiKey.includes('votre_')) {
    const error = new Error("ANTHROPIC_API_KEY manquante ou invalide.");
    error.status = 503;
    throw error;
  }
  return apiKey;
}

// ══════════════════════════════════════
// POST /api/chat
// Corps : { conversationId, message, mode? }
// ══════════════════════════════════════
router.post('/', chatLimiter, async (req, res, next) => {
  try {
    const { conversationId, message, mode } = req.body;

    if (!conversationId || !message?.trim()) {
      return res.status(400).json({ error: 'conversationId et message sont requis.' });
    }

    enforceUserCanSendMessage(req.user);
    const normalizedMessage = normalizeOutgoingMessage(message);

    // Récupérer la conversation (vérifie que l'utilisateur en est le propriétaire)
    const conv = await Conversation.findOne({
      _id: conversationId,
      user: req.user._id,
    });
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });

    const trimmedMessage = normalizedMessage.text;
    const intent = inferIntent(trimmedMessage);
    const resolvedMode = resolveMode(mode, intent);
    const billingResult = consumeOneMessage(req.user);
    await req.user.save({ validateBeforeSave: false });

    // Ajouter le message utilisateur
    conv.messages.push({ role: 'user', content: trimmedMessage });
    conv.mode = resolvedMode;
    conv.lastIntent = intent;
    conv.lastResearchPlan = resolvedMode === 'deep_research'
      ? buildResearchPlan(trimmedMessage, intent)
      : [];
    conv.lastResearchSources = [];

    // Générer le titre automatiquement au 1er message
    if (conv.messages.length === 1) {
      const shortTitle = trimmedMessage.length > 60
        ? trimmedMessage.substring(0, 60) + '…'
        : trimmedMessage;
      conv.title = shortTitle;
    }

    await conv.save();

    let memory = await getOrCreateUserMemory(req.user._id);
    try {
      memory = await updateMemoryFromMessage({
        userId: req.user._id,
        message: trimmedMessage,
      });
    } catch (memoryError) {
      console.error('[DevAI] Memory update error:', memoryError.message);
    }
    const shouldRunWebResearch = shouldUseWebResearch(trimmedMessage, resolvedMode);
    const webResearch = shouldRunWebResearch
      ? await performWebResearch({ query: trimmedMessage, mode: resolvedMode, intent })
      : { performed: false, results: [], error: null };
    conv.lastResearchSources = webResearch.results || [];

    // Construire le prompt et l'historique pour l'API
    const systemPrompt = buildSystemPrompt({
      memory,
      conversation: conv,
      mode: resolvedMode,
      intent,
      webResearch,
    });
    const apiMessages = buildApiMessages(conv);
    const requestConfig = getRequestConfig(resolvedMode);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: requestConfig.model,
        max_tokens: requestConfig.max_tokens,
        system: systemPrompt,
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!anthropicRes.ok) {
      const errData = await anthropicRes.json().catch(() => ({}));
      const errMsg  = errData?.error?.message || `Erreur API (${anthropicRes.status})`;
      console.error('[DevAI] Anthropic API error:', errMsg);
      return res.status(502).json({ error: `Erreur de l'IA : ${errMsg}` });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sendStreamEvent(res, 'meta', {
      conversationId: conv._id,
      title: conv.title,
      mode: conv.mode,
      intent: conv.lastIntent,
      researchPlan: conv.lastResearchPlan,
      webResearch: {
        performed: webResearch.performed,
        provider: webResearch.provider || null,
        error: webResearch.error || null,
        sources: webResearch.results || [],
      },
      usage: billingResult.usage,
      billingSource: billingResult.source,
      messageWasTrimmed: normalizedMessage.wasTrimmed,
      maxMessageLength: MESSAGE_MAX_LENGTH,
    });

    let aiText = '';
    let sseBuffer = '';

    await new Promise((resolve, reject) => {
      anthropicRes.body.on('data', (chunk) => {
        sseBuffer += chunk.toString('utf8').replace(/\r\n/g, '\n');

        while (sseBuffer.includes('\n\n')) {
          const boundaryIndex = sseBuffer.indexOf('\n\n');
          const rawEvent = sseBuffer.slice(0, boundaryIndex);
          sseBuffer = sseBuffer.slice(boundaryIndex + 2);

          const parsed = parseSseEvent(rawEvent);
          if (!parsed.data || parsed.data === '[DONE]') continue;

          let payload;
          try {
            payload = JSON.parse(parsed.data);
          } catch (parseError) {
            continue;
          }

          if (parsed.event === 'content_block_delta' && payload?.delta?.type === 'text_delta') {
            const deltaText = payload.delta.text || '';
            if (!deltaText) continue;
            aiText += deltaText;
            sendStreamEvent(res, 'delta', { text: deltaText });
          }
        }
      });

      anthropicRes.body.on('end', () => {
        if (sseBuffer.trim()) {
          const parsed = parseSseEvent(sseBuffer.trim());
          if (parsed.data && parsed.data !== '[DONE]') {
            try {
              const payload = JSON.parse(parsed.data);
              if (parsed.event === 'content_block_delta' && payload?.delta?.type === 'text_delta') {
                const deltaText = payload.delta.text || '';
                if (deltaText) {
                  aiText += deltaText;
                  sendStreamEvent(res, 'delta', { text: deltaText });
                }
              }
            } catch (parseError) {
              // Ignore incomplete trailing SSE payloads.
            }
          }
        }
        resolve();
      });
      anthropicRes.body.on('error', reject);
    });

    conv.messages.push({ role: 'ai', content: aiText });
    conv.summary = buildConversationSummaryAfterReply(conv);
    await conv.save();

    sendStreamEvent(res, 'done', {
      reply: aiText,
      conversationId: conv._id,
      title: conv.title,
      mode: conv.mode,
      intent: conv.lastIntent,
      researchPlan: conv.lastResearchPlan,
      webResearch: {
        performed: webResearch.performed,
        provider: webResearch.provider || null,
        error: webResearch.error || null,
        sources: webResearch.results || [],
      },
      usage: billingResult.usage,
      billingSource: billingResult.source,
      messageWasTrimmed: normalizedMessage.wasTrimmed,
      maxMessageLength: MESSAGE_MAX_LENGTH,
    });
    res.end();

  } catch (err) {
    if (res.headersSent) {
      sendStreamEvent(res, 'error', {
        error: err.message || 'Erreur de streaming IA.',
      });
      return res.end();
    }
    if (err.usage) {
      return res.status(err.status || 400).json({ error: err.message, usage: err.usage });
    }
    next(err);
  }
});

router.get('/memory', async (req, res, next) => {
  try {
    const memory = await getOrCreateUserMemory(req.user._id);
    res.json({ memory, usage: buildUsageSnapshot(req.user) });
  } catch (err) { next(err); }
});

module.exports = router;
