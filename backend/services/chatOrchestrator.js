const { formatMemoryForPrompt } = require('./memoryService');
const { formatWebResearchForPrompt } = require('./webResearchService');

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const BASE_SYSTEM_PROMPT = `Tu es DevAI, une intelligence artificielle avancée créée par DEVOUE LI et développée par WORLDIFYAI.

Tu es généraliste, mais particulièrement performante en programmation et en mathématiques.

Règles de comportement :
- réponds dans la langue de l'utilisateur, avec préférence pour le français ;
- sois précise, pédagogique, structurée et orientée solution ;
- en programmation, privilégie les explications fiables, le code correct et les étapes actionnables ;
- en mathématiques, explicite les hypothèses, les formules et le raisonnement ;
- si tu n'es pas certaine d'un point, signale l'incertitude au lieu d'inventer ;
- n'évoque jamais un fournisseur tiers ou un modèle spécifique ;
- tu représentes WORLDIFYAI.`;

function truncate(text, maxLength) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function inferIntent(message) {
  const text = String(message || '').toLowerCase();

  if (/(bug|erreur|exception|stack trace|corrige|debug)/.test(text)) return 'debug';
  if (/(code|fonction|api|backend|frontend|javascript|python|node|react)/.test(text)) return 'programming';
  if (/(math|maths|équation|algèbre|intégrale|dérivée|matrice|probabilité)/.test(text)) return 'math';
  if (/(explique|pourquoi|comment)/.test(text)) return 'explanation';
  return 'general';
}

function resolveMode(requestedMode, intent) {
  const allowedModes = new Set(['standard', 'code', 'math', 'deep_research']);
  if (allowedModes.has(requestedMode)) return requestedMode;
  if (intent === 'programming') return 'code';
  if (intent === 'math') return 'math';
  return 'standard';
}

function buildConversationSummary(conversation) {
  if (conversation.summary) return conversation.summary;

  const lastMessages = conversation.messages.slice(-6).map(msg => {
    const speaker = msg.role === 'ai' ? 'IA' : 'Utilisateur';
    return `${speaker}: ${truncate(msg.content, 180)}`;
  });

  return lastMessages.join('\n');
}

function buildModeInstructions(mode, intent) {
  if (mode === 'deep_research') {
    return `Mode actif: Deep Research.
Travaille en profondeur.
- commence par clarifier le problème exact ;
- découpe implicitement la réponse en sous-questions ;
- compare plusieurs approches quand c'est pertinent ;
- explicite limites, hypothèses, pièges et arbitrages ;
- termine par une synthèse et des prochaines étapes concrètes.`;
  }

  if (mode === 'code') {
    return `Mode actif: Code.
- priorise exactitude technique, lisibilité, étapes de débogage et exemples exécutables ;
- si utile, propose une structure de fichiers, des commandes et des tests.`;
  }

  if (mode === 'math') {
    return `Mode actif: Math.
- montre les étapes de résolution ;
- vérifie les hypothèses ;
- distingue clairement intuition, formule et conclusion.`;
  }

  if (intent === 'debug') {
    return `Contexte de débogage:
- identifie la cause probable ;
- propose une méthode de vérification ;
- donne un correctif minimal avant les optimisations.`;
  }

  return 'Mode actif: Standard. Réponds de façon utile, concise et structurée.';
}

function buildResearchPlan(message, intent) {
  if (intent !== 'programming' && intent !== 'math' && intent !== 'general') return [];

  const genericPlan = [
    'Clarifier le besoin réel et les contraintes implicites.',
    'Identifier les concepts, théorèmes, APIs ou composants à mobiliser.',
    'Comparer les approches possibles et choisir la plus adaptée.',
    'Produire une réponse structurée avec vérifications et prochaines étapes.',
  ];

  if (intent === 'programming') {
    return [
      'Identifier le langage, le framework et le comportement attendu.',
      'Repérer les causes possibles ou les architectures adaptées.',
      'Comparer correctif rapide, solution robuste et bonnes pratiques.',
      'Fournir du code ou des étapes de test si nécessaire.',
    ];
  }

  if (intent === 'math') {
    return [
      'Définir les inconnues, hypothèses et objets mathématiques.',
      'Choisir la méthode de résolution la plus adaptée.',
      'Dérouler les étapes de calcul et vérifier le résultat.',
      'Conclure avec interprétation et éventuelle généralisation.',
    ];
  }

  return genericPlan;
}

function buildSystemPrompt({ memory, conversation, mode, intent, webResearch }) {
  const sections = [BASE_SYSTEM_PROMPT];
  const memoryBlock = formatMemoryForPrompt(memory);
  const conversationSummary = buildConversationSummary(conversation);
  const modeInstructions = buildModeInstructions(mode, intent);
  const webResearchBlock = formatWebResearchForPrompt(webResearch);

  if (memoryBlock) {
    sections.push(`Mémoire utilisateur utile:\n${memoryBlock}`);
  }

  if (conversationSummary) {
    sections.push(`Résumé conversationnel:\n${conversationSummary}`);
  }

  if (webResearchBlock) {
    sections.push(webResearchBlock);
  }

  sections.push(modeInstructions);

  if (webResearch?.performed) {
    sections.push(`Consignes pour l'usage des sources:
- appuie-toi d'abord sur les résultats ci-dessus ;
- cite les sources par leur titre ou leur domaine quand c'est utile ;
- si les sources sont insuffisantes ou contradictoires, dis-le clairement.`);
  }

  return sections.join('\n\n');
}

function buildApiMessages(conversation) {
  return conversation.messages.slice(-16).map(message => ({
    role: message.role === 'ai' ? 'assistant' : 'user',
    content: message.content,
  }));
}

function buildConversationSummaryAfterReply(conversation) {
  const lastMessages = conversation.messages.slice(-8);
  const userMessages = lastMessages
    .filter(message => message.role === 'user')
    .map(message => truncate(message.content, 100));
  const aiMessages = lastMessages
    .filter(message => message.role === 'ai')
    .map(message => truncate(message.content, 100));

  const parts = [];
  if (userMessages.length) parts.push(`Demandes récentes: ${userMessages.join(' | ')}`);
  if (aiMessages.length) parts.push(`Réponses récentes: ${aiMessages.join(' | ')}`);
  return parts.join('. ');
}

function getRequestConfig(mode) {
  if (mode === 'deep_research') {
    return { model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: 3200 };
  }

  return { model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: 2048 };
}

module.exports = {
  inferIntent,
  resolveMode,
  buildResearchPlan,
  buildSystemPrompt,
  buildApiMessages,
  buildConversationSummaryAfterReply,
  getRequestConfig,
};
