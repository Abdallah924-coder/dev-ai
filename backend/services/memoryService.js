const UserMemory = require('../models/UserMemory');

const MAX_FACTS = 12;
const MAX_TOPICS = 10;
const MAX_GOALS = 8;

function uniqNormalized(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }

  return result;
}

function inferTopics(message) {
  const text = String(message || '').toLowerCase();
  const dictionary = [
    ['javascript', ['javascript', 'js', 'node', 'node.js', 'express']],
    ['python', ['python', 'django', 'flask', 'fastapi']],
    ['react', ['react', 'frontend', 'jsx']],
    ['mongodb', ['mongodb', 'mongoose', 'nosql']],
    ['api', ['api', 'rest', 'endpoint', 'backend']],
    ['algorithmes', ['algorithme', 'algorithmes', 'complexite', 'big o']],
    ['mathématiques', ['math', 'maths', 'algèbre', 'analyse', 'équation', 'intégrale', 'dérivée']],
    ['ia', ['ia', 'intelligence artificielle', 'llm', 'rag', 'agent']],
    ['authentification', ['auth', 'jwt', 'login', 'inscription', 'mot de passe']],
  ];

  return dictionary
    .filter(([, keywords]) => keywords.some(keyword => text.includes(keyword)))
    .map(([topic]) => topic);
}

function inferFacts(message) {
  const text = String(message || '').trim();
  const lowered = text.toLowerCase();
  const facts = [];

  const patterns = [
    {
      regex: /\bje (?:travaille|bosse) sur (.+?)(?:[.!?]|$)/i,
      key: 'projet_en_cours',
      category: 'project',
      prefix: 'Travaille sur ',
    },
    {
      regex: /\bmon projet (?:s'appelle|est) (.+?)(?:[.!?]|$)/i,
      key: 'nom_du_projet',
      category: 'project',
      prefix: '',
    },
    {
      regex: /\bj(?:e|')utilise (.+?)(?:[.!?]|$)/i,
      key: 'stack_utilisée',
      category: 'skill',
      prefix: 'Utilise ',
    },
    {
      regex: /\bje veux (.+?)(?:[.!?]|$)/i,
      key: 'objectif',
      category: 'goal',
      prefix: '',
    },
    {
      regex: /\bj(?:e|')aime (.+?)(?:[.!?]|$)/i,
      key: 'préférence',
      category: 'preference',
      prefix: 'Aime ',
    },
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    const value = `${pattern.prefix}${match[1].trim()}`.slice(0, 280);
    facts.push({
      key: pattern.key,
      value,
      category: pattern.category,
      confidence: 0.72,
      source: 'heuristic',
      updatedAt: new Date(),
    });
  }

  if (lowered.includes('programmation') || lowered.includes('coder')) {
    facts.push({
      key: 'centre_interet',
      value: 'S’intéresse fortement à la programmation',
      category: 'skill',
      confidence: 0.66,
      source: 'heuristic',
      updatedAt: new Date(),
    });
  }

  if (lowered.includes('math') || lowered.includes('mathématiques')) {
    facts.push({
      key: 'centre_interet_math',
      value: 'S’intéresse fortement aux mathématiques',
      category: 'skill',
      confidence: 0.66,
      source: 'heuristic',
      updatedAt: new Date(),
    });
  }

  return facts;
}

function inferManualFactCategory(text) {
  const value = String(text || '').toLowerCase();
  if (/(projet|application|site|plateforme)/.test(value)) return 'project';
  if (/(objectif|but|je veux|j'aimerais|je souhaite)/.test(value)) return 'goal';
  if (/(j'aime|je préfère|préférence|style|langue)/.test(value)) return 'preference';
  if (/(je sais|je maîtrise|j'utilise|stack|outil|framework|langage)/.test(value)) return 'skill';
  return 'preference';
}

function rebuildMemory(memory) {
  memory.activeTopics = uniqNormalized(memory.activeTopics || []).slice(0, MAX_TOPICS);
  memory.goals = uniqNormalized(memory.goals || []).slice(0, MAX_GOALS);
  memory.facts = mergeFacts([], memory.facts || []);
  memory.profileSummary = buildProfileSummary(memory);
  return memory;
}

function mergeFacts(currentFacts, newFacts) {
  const merged = [...currentFacts];

  for (const fact of newFacts) {
    const existingIndex = merged.findIndex(item => item.key === fact.key);
    if (existingIndex >= 0) {
      merged[existingIndex] = fact;
    } else {
      merged.push(fact);
    }
  }

  return merged
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, MAX_FACTS);
}

function buildProfileSummary(memory) {
  const parts = [];

  if (memory.activeTopics.length) {
    parts.push(`Sujets actifs: ${memory.activeTopics.join(', ')}.`);
  }

  if (memory.goals.length) {
    parts.push(`Objectifs récents: ${memory.goals.join(' ; ')}.`);
  }

  if (memory.facts.length) {
    const snapshot = memory.facts.slice(0, 4).map(fact => fact.value).join(' | ');
    parts.push(`Mémoire utile: ${snapshot}.`);
  }

  return parts.join(' ').trim();
}

async function getOrCreateUserMemory(userId) {
  let memory = await UserMemory.findOne({ user: userId });

  if (!memory) {
    memory = await UserMemory.create({ user: userId });
  }

  return memory;
}

async function updateMemoryFromMessage({ userId, message }) {
  const text = String(message || '').trim();
  if (!text) return getOrCreateUserMemory(userId);

  const memory = await getOrCreateUserMemory(userId);
  const topics = inferTopics(text);
  const facts = inferFacts(text);
  const goals = facts
    .filter(fact => fact.category === 'goal')
    .map(fact => fact.value);

  memory.activeTopics = uniqNormalized([...topics, ...memory.activeTopics]).slice(0, MAX_TOPICS);
  memory.goals = uniqNormalized([...goals, ...memory.goals]).slice(0, MAX_GOALS);
  memory.facts = mergeFacts(memory.facts || [], facts);
  memory.lastUpdatedFromMessageAt = new Date();
  memory.profileSummary = buildProfileSummary(memory);

  await memory.save();
  return memory;
}

function parseMemoryCommand(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const rememberMatch = text.match(/^(?:retiens?|souviens?-toi|mémorise|garde en mémoire)(?:\s+que|\s+ceci\s*:?)?\s+(.+)$/i);
  if (rememberMatch) {
    return { action: 'remember', content: rememberMatch[1].trim() };
  }

  const forgetMatch = text.match(/^(?:oublie|supprime de ta mémoire|efface de ta mémoire|retire de ta mémoire)(?:\s+que|\s+ceci\s*:?)?\s+(.+)$/i);
  if (forgetMatch) {
    return { action: 'forget', content: forgetMatch[1].trim() };
  }

  if (/^(?:que sais-tu de moi|qu'as-tu retenu de moi|montre ma mémoire|affiche ma mémoire|résume ma mémoire)\s*\??$/i.test(text)) {
    return { action: 'show' };
  }

  if (/^(?:efface ma mémoire|vide ma mémoire|oublie tout ce que tu sais sur moi)\s*\??$/i.test(text)) {
    return { action: 'clear' };
  }

  return null;
}

function formatMemorySnapshot(memory) {
  const sections = [];

  if (memory.facts?.length) {
    sections.push(`Faits mémorisés:\n${memory.facts.map((fact) => `- ${fact.value}`).join('\n')}`);
  }

  if (memory.goals?.length) {
    sections.push(`Objectifs:\n${memory.goals.map((goal) => `- ${goal}`).join('\n')}`);
  }

  if (memory.activeTopics?.length) {
    sections.push(`Sujets actifs:\n${memory.activeTopics.map((topic) => `- ${topic}`).join('\n')}`);
  }

  if (!sections.length) {
    return "Je n'ai encore rien mémorisé explicitement à ton sujet.";
  }

  return sections.join('\n\n');
}

async function applyMemoryCommand({ userId, command }) {
  const memory = await getOrCreateUserMemory(userId);

  if (command.action === 'show') {
    return {
      memory,
      reply: formatMemorySnapshot(memory),
    };
  }

  if (command.action === 'clear') {
    memory.profileSummary = '';
    memory.strengths = [];
    memory.goals = [];
    memory.activeTopics = [];
    memory.facts = [];
    memory.lastUpdatedFromMessageAt = new Date();
    await memory.save();
    return {
      memory,
      reply: 'Mémoire effacée. Je repars de zéro pour ce que je retiens sur toi.',
    };
  }

  if (command.action === 'remember') {
    const content = String(command.content || '').trim().slice(0, 280);
    if (!content) {
      return { memory, reply: "Je n'ai rien reçu de précis à mémoriser." };
    }

    const fact = {
      key: `manual_${Date.now()}`,
      value: content,
      category: inferManualFactCategory(content),
      confidence: 1,
      source: 'manual',
      updatedAt: new Date(),
    };

    memory.facts = mergeFacts(memory.facts || [], [fact]);
    if (fact.category === 'goal') {
      memory.goals = uniqNormalized([content, ...(memory.goals || [])]).slice(0, MAX_GOALS);
    }
    memory.activeTopics = uniqNormalized([...(inferTopics(content) || []), ...(memory.activeTopics || [])]).slice(0, MAX_TOPICS);
    memory.lastUpdatedFromMessageAt = new Date();
    rebuildMemory(memory);
    await memory.save();

    return {
      memory,
      reply: `C'est retenu: ${content}`,
    };
  }

  if (command.action === 'forget') {
    const query = String(command.content || '').trim().toLowerCase();
    if (!query) {
      return { memory, reply: "Je n'ai rien reçu de précis à oublier." };
    }

    const beforeFacts = (memory.facts || []).length;
    const beforeGoals = (memory.goals || []).length;
    const beforeTopics = (memory.activeTopics || []).length;

    memory.facts = (memory.facts || []).filter((fact) => !String(fact.value || '').toLowerCase().includes(query));
    memory.goals = (memory.goals || []).filter((goal) => !String(goal || '').toLowerCase().includes(query));
    memory.activeTopics = (memory.activeTopics || []).filter((topic) => !String(topic || '').toLowerCase().includes(query));
    memory.lastUpdatedFromMessageAt = new Date();
    rebuildMemory(memory);
    await memory.save();

    const changed = beforeFacts !== memory.facts.length || beforeGoals !== memory.goals.length || beforeTopics !== memory.activeTopics.length;
    return {
      memory,
      reply: changed
        ? `C'est oublié: ${command.content}`
        : `Je n'avais rien de mémorisé qui corresponde à: ${command.content}`,
    };
  }

  return {
    memory,
    reply: "Commande mémoire non reconnue.",
  };
}

function formatMemoryForPrompt(memory) {
  if (!memory) return '';

  const lines = [];

  if (memory.profileSummary) {
    lines.push(`Profil: ${memory.profileSummary}`);
  }

  if (memory.preferences?.responseStyle) {
    lines.push(`Style préféré: ${memory.preferences.responseStyle}.`);
  }

  if (memory.activeTopics?.length) {
    lines.push(`Sujets actifs: ${memory.activeTopics.join(', ')}.`);
  }

  if (memory.goals?.length) {
    lines.push(`Objectifs: ${memory.goals.join(' ; ')}.`);
  }

  if (memory.facts?.length) {
    const factsText = memory.facts
      .slice(0, 6)
      .map(fact => `- ${fact.value}`)
      .join('\n');
    lines.push(`Faits mémorisés:\n${factsText}`);
  }

  return lines.join('\n');
}

module.exports = {
  getOrCreateUserMemory,
  updateMemoryFromMessage,
  parseMemoryCommand,
  applyMemoryCommand,
  formatMemorySnapshot,
  formatMemoryForPrompt,
};
