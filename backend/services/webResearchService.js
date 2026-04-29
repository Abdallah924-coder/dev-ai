const fetch = require('node-fetch');

const DEFAULT_PROVIDER = 'tavily';
const MAX_RESULTS = 5;
const MAX_SNIPPET_LENGTH = 1100;

function isWebResearchEnabled() {
  return String(process.env.WEB_RESEARCH_ENABLED || 'false').toLowerCase() === 'true';
}

function getWebResearchProvider() {
  return String(process.env.WEB_RESEARCH_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
}

function getTavilyApiKey() {
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim();
  if (!apiKey || apiKey.includes('votre_')) return '';
  return apiKey;
}

function canUseWebResearch() {
  return isWebResearchEnabled() && getWebResearchProvider() === 'tavily' && Boolean(getTavilyApiKey());
}

function normalizeUrl(url) {
  return String(url || '').trim();
}

function cleanSnippet(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= MAX_SNIPPET_LENGTH) return value;
  return `${value.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
}

async function searchWithTavily(query, options = {}) {
  const apiKey = getTavilyApiKey();
  if (!apiKey) return { performed: false, provider: 'tavily', results: [], error: 'TAVILY_API_KEY manquante.' };

  const maxResults = Math.min(Number(options.maxResults) || MAX_RESULTS, MAX_RESULTS);

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: options.searchDepth || 'advanced',
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      topic: options.topic || 'general',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData?.detail || errorData?.error || `Erreur Tavily (${response.status})`;
    return {
      performed: false,
      provider: 'tavily',
      results: [],
      error: message,
    };
  }

  const data = await response.json();
  const results = Array.isArray(data.results)
    ? data.results.map((item, index) => ({
        rank: index + 1,
        title: String(item.title || 'Source sans titre').trim(),
        url: normalizeUrl(item.url),
        snippet: cleanSnippet(item.content),
      }))
    : [];

  return {
    performed: true,
    provider: 'tavily',
    results,
    error: null,
  };
}

async function performWebResearch({ query, mode, intent }) {
  if (!canUseWebResearch()) {
    return {
      performed: false,
      provider: getWebResearchProvider(),
      results: [],
      error: isWebResearchEnabled()
        ? 'Recherche web activée mais non configurée correctement.'
        : null,
    };
  }

  const topic = intent === 'programming' ? 'general' : 'general';
  const searchDepth = mode === 'deep_research' ? 'advanced' : 'basic';

  return searchWithTavily(query, {
    topic,
    searchDepth,
    maxResults: MAX_RESULTS,
  });
}

function formatWebResearchForPrompt(research) {
  if (!research?.performed || !research.results?.length) return '';

  const lines = research.results.map(result => {
    const title = result.title || 'Source';
    const url = result.url || 'URL inconnue';
    const snippet = result.snippet || 'Aucun extrait disponible.';
    return `- ${title}\n  URL: ${url}\n  Extrait: ${snippet}`;
  });

  return `Résultats de recherche web récents:\n${lines.join('\n')}`;
}

module.exports = {
  isWebResearchEnabled,
  canUseWebResearch,
  performWebResearch,
  formatWebResearchForPrompt,
};
