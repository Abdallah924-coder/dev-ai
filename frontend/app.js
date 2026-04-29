/* ═══════════════════════════════════════
   DEVAI — WORLDIFYAI  |  app.js (frontend)
   Auteur : DEVOUE LI
   Version : 2.0 — connecté au backend
═══════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────
// 1. CONFIG — Détection automatique de l'URL du backend
// ──────────────────────────────────────
const API_URL = resolveApiUrl();
const INSIGHTS_AUTO_HIDE_MS = 8000;
const MESSAGE_MAX_LENGTH = 1500;

function resolveApiUrl() {
  if (window.DEVAI_API_URL) return stripTrailingSlash(window.DEVAI_API_URL);

  const { protocol, hostname, origin } = window.location;
  if (protocol === 'file:') {
    return 'http://localhost:5000/api';
  }

  if (isLocalHostname(hostname)) {
    return `${protocol}//${hostname}:5000/api`;
  }

  return `${origin}/api`;
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0';
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, '');
}

// ──────────────────────────────────────
// 2. STATE
// ──────────────────────────────────────
let state = {
  currentUser:   null,
  token:         null,
  conversations: [],
  activeConvId:  null,
  currentMode:   'standard',
  onboardingDraft: null,
  lastReplyMeta: null,
  usage: null,
  paymentPlans: [],
};
let insightsHideTimer = null;

function resetUiState() {
  $('profile-modal')?.classList.add('hidden');
  $('profile-menu')?.classList.remove('open');
  $('sidebar-backdrop')?.classList.add('hidden');
  $('auth-overlay')?.style.removeProperty('display');
}

// ──────────────────────────────────────
// 3. API HELPER
// ──────────────────────────────────────
async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const isAuthSessionRequest = res.status === 401
      && Boolean(state.token)
      && !path.startsWith('/auth/login')
      && !path.startsWith('/auth/register')
      && !path.startsWith('/auth/forgot-password')
      && !path.startsWith('/auth/reset-password');

    if (isAuthSessionRequest) {
      doLogout();
      throw new Error('Session expirée. Veuillez vous reconnecter.');
    }
    const error = new Error(data.error || `Erreur ${res.status}`);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}

// ──────────────────────────────────────
// 4. AUTH
// ──────────────────────────────────────
async function doRegister() {
  const fn  = $('reg-firstname').value.trim();
  const ln  = $('reg-lastname').value.trim();
  const em  = $('reg-email').value.trim();
  const pw  = $('reg-password').value;
  const cpw = $('reg-confirm').value;
  const err = $('reg-error');
  err.textContent = '';

  if (!fn || !ln) return showError(err, 'Prénom et nom requis.');
  if (!isValidEmail(em)) return showError(err, 'Adresse e-mail invalide.');
  if (pw.length < 6) return showError(err, 'Mot de passe : 6 caractères minimum.');
  if (pw !== cpw) return showError(err, 'Les mots de passe ne correspondent pas.');

  try {
    const btn = document.querySelector('#panel-register .btn-primary');
    setBtn(btn, true, 'Inscription…');
    const data = await api('POST', '/auth/register', { firstname: fn, lastname: ln, email: em, password: pw });
    beginSession(data.user, data.token);
    startOnboarding({
      preferredName: fn,
      birthDate: '',
    });
    setBtn(btn, false, "S'inscrire");
  } catch (e) {
    showError(err, e.message);
    const btn = document.querySelector('#panel-register .btn-primary');
    setBtn(btn, false, "S'inscrire");
  }
}

async function doLogin() {
  const em  = $('login-email').value.trim();
  const pw  = $('login-password').value;
  const err = $('login-error');
  err.textContent = '';

  if (!em || !pw) return showError(err, 'Veuillez remplir tous les champs.');

  try {
    const btn = document.querySelector('#panel-login .btn-primary');
    setBtn(btn, true, 'Connexion…');
    const data = await api('POST', '/auth/login', { email: em, password: pw });
    loginUser(data.user, data.token);
  } catch (e) {
    showError(err, e.message);
    const btn = document.querySelector('#panel-login .btn-primary');
    setBtn(btn, false, 'Se connecter');
  }
}

async function doForgot() {
  const em  = $('forgot-email').value.trim();
  const err = $('forgot-error');
  const suc = $('forgot-success');
  err.textContent = ''; suc.textContent = '';

  if (!isValidEmail(em)) return showError(err, 'Adresse e-mail invalide.');

  try {
    const btn = document.querySelector('#panel-forgot .btn-primary');
    setBtn(btn, true, 'Envoi…');
    await api('POST', '/auth/forgot-password', { email: em });
    suc.textContent = `✓ Si ce compte existe, un email a été envoyé à ${em}.`;
    setBtn(btn, false, 'Envoyer le lien');
  } catch (e) {
    showError(err, e.message);
    const btn = document.querySelector('#panel-forgot .btn-primary');
    setBtn(btn, false, 'Envoyer le lien');
  }
}

function doLogout() {
  localStorage.removeItem('devai_token');
  state = { currentUser: null, token: null, conversations: [], activeConvId: null, currentMode: 'standard', onboardingDraft: null, lastReplyMeta: null, usage: null, paymentPlans: [] };
  resetUiState();
  $('app').classList.add('hidden');
  $('auth-overlay').style.display = 'flex';
  showPanel('panel-login');
  closeProfileMenu();
  renderUsageState();
}

function beginSession(user, token) {
  state.currentUser = user;
  state.token       = token;
  localStorage.setItem('devai_token', token);
}

function getDisplayName() {
  const user = state.currentUser || {};
  return user.preferredName || user.firstname || 'Vous';
}

async function loginUser(user, token) {
  beginSession(user, token);
  state.currentUser = user;
  state.usage = user.usage || null;
  resetUiState();

  if (!user.onboardingCompleted) {
    startOnboarding({
      preferredName: user.preferredName || user.firstname || '',
      birthDate: formatDateInputValue(user.birthDate),
    });
    return;
  }

  $('auth-overlay').style.display = 'none';
  $('app').classList.remove('hidden');
  updateSidebarUser();
  setChatMode(state.currentMode || 'standard');
  await loadConversations();
  await refreshUsageStatus();
}

function startOnboarding(prefill = {}) {
  state.onboardingDraft = {
    preferredName: prefill.preferredName || '',
    birthDate: prefill.birthDate || '',
  };
  resetUiState();
  $('auth-overlay').style.display = 'flex';
  $('app').classList.add('hidden');
  $('onboard-name').value = state.onboardingDraft.preferredName;
  $('onboard-birthdate').value = state.onboardingDraft.birthDate;
  $('onboard-name-error').textContent = '';
  $('onboard-birth-error').textContent = '';
  updateOnboardingWelcomeName();
  showPanel('panel-onboarding-name');
}

function goToOnboardingBirth() {
  const preferredName = $('onboard-name').value.trim();
  if (!preferredName) {
    return showError($('onboard-name-error'), 'Dis-moi au moins comment tu veux que je t’appelle.');
  }

  state.onboardingDraft = {
    ...(state.onboardingDraft || {}),
    preferredName,
  };
  $('onboard-name-error').textContent = '';
  updateOnboardingWelcomeName();
  showPanel('panel-onboarding-birth');
}

async function completeOnboarding() {
  const preferredName = $('onboard-name').value.trim();
  const birthDate = $('onboard-birthdate').value;

  if (!preferredName) {
    showPanel('panel-onboarding-name');
    return showError($('onboard-name-error'), 'Le prénom ou surnom est requis.');
  }
  if (!birthDate) {
    return showError($('onboard-birth-error'), 'Choisis ta date de naissance.');
  }

  try {
    const btn = $('btn-onboard-birth');
    setBtn(btn, true, 'Enregistrement…');
    const data = await api('PUT', '/auth/onboarding', { preferredName, birthDate });
    state.currentUser = data.user;
    state.onboardingDraft = { preferredName, birthDate };
    updateOnboardingWelcomeName();
    $('onboard-birth-error').textContent = '';
    setBtn(btn, false, 'Suivant');
    showPanel('panel-onboarding-welcome');
  } catch (e) {
    showError($('onboard-birth-error'), e.message);
    setBtn($('btn-onboard-birth'), false, 'Suivant');
  }
}

async function finishOnboarding() {
  resetUiState();
  $('auth-overlay').style.display = 'none';
  $('app').classList.remove('hidden');
  updateSidebarUser();
  setChatMode(state.currentMode || 'standard');
  await loadConversations();
  await refreshUsageStatus();
}

function updateOnboardingWelcomeName() {
  const name = $('onboard-name')?.value.trim() || state.onboardingDraft?.preferredName || 'ami';
  $('onboard-welcome-name').textContent = name;
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js?v=20260426');
    registration.update().catch(() => {});
  } catch (error) {
    console.warn('Service worker indisponible:', error.message);
  }
}

// ──────────────────────────────────────
// 5. CONVERSATIONS (depuis le backend)
// ──────────────────────────────────────
async function loadConversations() {
  try {
    const data = await api('GET', '/conversations');
    state.conversations = data.conversations || [];
    renderConvList();

    if (state.conversations.length > 0) {
      const first = state.conversations.find(c => !c.hidden);
      if (first) await switchConv(first._id);
      else await newConversation();
    } else {
      await newConversation();
    }
  } catch (e) {
    console.error('Erreur chargement conversations:', e.message);
    showWelcome();
  }
}

async function newConversation() {
  try {
    const data = await api('POST', '/conversations', { title: 'Nouvelle discussion' });
    const conv = data.conversation;
    state.conversations.unshift(conv);
    state.activeConvId = conv._id;
    state.lastReplyMeta = null;
    renderConvList();
    showWelcome();
    $('chat-title').textContent = conv.title;
    closeSidebar();
  } catch (e) {
    console.error('Erreur création conversation:', e.message);
  }
}

async function switchConv(id) {
  try {
    const data = await api('GET', `/conversations/${id}`);
    const conv = data.conversation;
    const idx  = state.conversations.findIndex(c => c._id === id);
    if (idx !== -1) state.conversations[idx] = conv;
    state.activeConvId = id;
    state.lastReplyMeta = buildConversationMeta(conv);
    renderConvList();
    renderMessages(conv);
    $('chat-title').textContent = conv.title;
    closeSidebar();
  } catch (e) {
    console.error('Erreur chargement conversation:', e.message);
  }
}

async function deleteConv(id) {
  try {
    await api('DELETE', `/conversations/${id}`);
    state.conversations = state.conversations.filter(c => c._id !== id);
    if (state.activeConvId === id) {
      const next = state.conversations.find(c => !c.hidden);
      if (next) await switchConv(next._id);
      else await newConversation();
    } else {
      renderConvList();
    }
  } catch (e) {
    console.error('Erreur suppression:', e.message);
  }
}

async function toggleHideConv(id) {
  const conv = state.conversations.find(c => c._id === id);
  if (!conv) return;
  try {
    await api('PATCH', `/conversations/${id}`, { hidden: !conv.hidden });
    conv.hidden = !conv.hidden;
    renderConvList();
  } catch (e) {
    console.error('Erreur masquage:', e.message);
  }
}

function renderConvList() {
  const list = $('conv-list');
  list.innerHTML = '';
  state.conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = `conv-item${conv._id === state.activeConvId ? ' active' : ''}${conv.hidden ? ' hidden-conv' : ''}`;
    item.innerHTML = `
      <div class="conv-item-title" onclick="switchConv('${conv._id}')">${escHtml(conv.title)}</div>
      <div class="conv-actions">
        <button class="conv-action-btn" title="${conv.hidden ? 'Afficher' : 'Masquer'}" onclick="event.stopPropagation(); toggleHideConv('${conv._id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${conv.hidden
              ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
              : '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'}
          </svg>
        </button>
        <button class="conv-action-btn danger" title="Supprimer" onclick="event.stopPropagation(); deleteConv('${conv._id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>`;
    list.appendChild(item);
  });
}

// ──────────────────────────────────────
// 6. MESSAGES & RENDERING
// ──────────────────────────────────────
function showWelcome() {
  $('messages').style.display   = 'none';
  $('messages').innerHTML       = '';
  $('welcome-screen').style.display = 'flex';
  $('welcome-name').textContent = getDisplayName();
  renderConversationMeta(null);
}

function renderMessages(conv) {
  if (!conv || !conv.messages || conv.messages.length === 0) {
    showWelcome();
    return;
  }
  $('welcome-screen').style.display = 'none';
  const container = $('messages');
  container.innerHTML = '';
  container.style.display = 'flex';
  renderConversationMeta(buildConversationMeta(conv));
  conv.messages.forEach(m => appendMessage(m.role, m.content, {
    scroll: false,
    createdAt: m.createdAt,
  }));
  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content, options = {}) {
  const { scroll = true, createdAt = new Date().toISOString(), meta = null } = options;
  $('welcome-screen').style.display = 'none';
  const container = $('messages');
  container.style.display = 'flex';

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const initials = role === 'user'
    ? (getDisplayName()?.[0]?.toUpperCase() || 'U')
    : 'D';
  const roleName = role === 'user'
    ? getDisplayName()
    : 'DevAI';
  const safeHtml = role === 'ai'
    ? parseMarkdown(content)
    : wrapPlainText(content);
  const metaHtml = buildMessageMetaHtml(createdAt, meta, role);

  div.innerHTML = `
    <div class="msg-avatar">${initials}</div>
    <div class="msg-content">
      <div class="msg-head">
        <div class="msg-role">${roleName}</div>
        <div class="msg-head-actions">
          <span class="msg-time">${formatMessageTime(createdAt)}</span>
          ${role === 'ai' ? `<button class="msg-action-btn" type="button" onclick="copyMessage(this)" data-copy="${escapeAttr(content)}">Copier</button>` : ''}
        </div>
      </div>
      <div class="msg-text">${safeHtml}</div>
      ${metaHtml}
    </div>`;
  container.appendChild(div);
  if (role === 'ai') typesetMath(div);
  if (scroll) container.scrollTop = container.scrollHeight;
}

function showTyping() {
  $('welcome-screen').style.display = 'none';
  const container = $('messages');
  container.style.display = 'flex';
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.id = 'typing-msg';
  div.innerHTML = `
    <div class="msg-avatar">D</div>
    <div class="msg-content">
      <div class="msg-role">DevAI</div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const t = $('typing-msg');
  if (t) t.remove();
}

// ──────────────────────────────────────
// 7. ENVOI DE MESSAGE
// ──────────────────────────────────────
let isLoading = false;

async function sendMessage() {
  if (isLoading) return;
  const input = $('chat-input');
  if (state.usage?.blocked) {
    updateQuotaBanner();
    return;
  }
  const text  = String(input.value || '').trim();
  if (!text || !state.activeConvId) return;

  const normalizedText = text.length > MESSAGE_MAX_LENGTH
    ? `${text.slice(0, MESSAGE_MAX_LENGTH - 1)}…`
    : text;

  input.value = '';
  input.style.height = 'auto';
  updateComposerMeta();
  setLoading(true);
  appendMessage('user', normalizedText);
  showTyping();

  try {
    const data = await api('POST', '/chat', {
      conversationId: state.activeConvId,
      message: normalizedText,
      mode: state.currentMode,
    });
    removeTyping();
    const replyMeta = {
      mode: data.mode,
      intent: data.intent,
      researchPlan: data.researchPlan || [],
      webResearch: data.webResearch || { performed: false, sources: [] },
    };
    appendMessage('ai', data.reply, { meta: replyMeta });
    state.lastReplyMeta = replyMeta;
    renderConversationMeta(replyMeta);
    if (data.usage) applyUsageData(data.usage);

    // Mettre à jour le titre si généré automatiquement
    const conv = state.conversations.find(c => c._id === state.activeConvId);
    if (conv) {
      conv.mode = data.mode || conv.mode;
      conv.lastIntent = data.intent || conv.lastIntent;
      conv.lastResearchPlan = data.researchPlan || conv.lastResearchPlan || [];
      conv.lastResearchSources = data.webResearch?.sources || conv.lastResearchSources || [];
      if (data.title) {
        conv.title = data.title;
        $('chat-title').textContent = data.title;
      }
      renderConvList();
    }
  } catch (e) {
    removeTyping();
    if (e.payload?.usage) applyUsageData(e.payload.usage);
    appendMessage('ai', `⚠️ ${e.message}`, {
      meta: {
        mode: state.currentMode,
        intent: 'incident',
        researchPlan: [],
        webResearch: { performed: false, sources: [], error: e.message },
      },
    });
  } finally {
    setLoading(false);
  }
}

function sendSuggestion(text) {
  $('chat-input').value = text;
  sendMessage();
}

function setLoading(v) {
  isLoading = v;
  $('send-btn').disabled = v;
  $('chat-input').disabled = v || Boolean(state.usage?.blocked);
}

// ──────────────────────────────────────
// 8. PROFIL
// ──────────────────────────────────────
function openProfile() {
  closeProfileMenu();
  const u = state.currentUser;
  $('prof-firstname').value = u.firstname || '';
  $('prof-lastname').value  = u.lastname  || '';
  $('prof-preferred-name').value = u.preferredName || '';
  $('prof-birthdate').value = formatDateInputValue(u.birthDate);
  $('prof-email').value     = u.email     || '';
  $('prof-password').value  = '';
  $('profile-error').textContent   = '';
  $('profile-success').textContent = '';
  updateProfileDisplay();
  $('profile-modal').classList.remove('hidden');
}

function closeProfile() {
  $('profile-modal').classList.add('hidden');
}

function updateProfileDisplay() {
  const u = state.currentUser;
  if (!u) return;
  $('profile-avatar-big').textContent = (getDisplayName()?.[0] || 'U').toUpperCase();
  $('profile-full-name').textContent  = `${getDisplayName()}${u.lastname ? ` ${u.lastname}` : ''}`;
  $('profile-email-display').textContent = u.email;
}

async function saveProfile() {
  const fn  = $('prof-firstname').value.trim();
  const ln  = $('prof-lastname').value.trim();
  const preferredName = $('prof-preferred-name').value.trim();
  const birthDate = $('prof-birthdate').value;
  const em  = $('prof-email').value.trim();
  const pw  = $('prof-password').value;
  const err = $('profile-error');
  const suc = $('profile-success');
  err.textContent = ''; suc.textContent = '';

  if (!fn || !ln) return showError(err, 'Prénom et nom requis.');
  if (!isValidEmail(em)) return showError(err, 'E-mail invalide.');
  if (pw && pw.length < 6) return showError(err, 'Mot de passe : 6 caractères minimum.');

  try {
    const btn = document.querySelector('#profile-modal .btn-primary');
    setBtn(btn, true, 'Enregistrement…');
    const body = { firstname: fn, lastname: ln, preferredName, birthDate: birthDate || null, email: em };
    if (pw) body.password = pw;
    const data = await api('PUT', '/auth/profile', body);
    state.currentUser = data.user;
    updateSidebarUser();
    updateProfileDisplay();
    suc.textContent = '✓ Profil mis à jour avec succès.';
    setBtn(btn, false, 'Enregistrer les modifications');
  } catch (e) {
    showError(err, e.message);
    const btn = document.querySelector('#profile-modal .btn-primary');
    setBtn(btn, false, 'Enregistrer les modifications');
  }
}

function updateSidebarUser() {
  const u = state.currentUser;
  if (!u) return;
  $('sidebar-avatar').textContent = (getDisplayName()?.[0] || 'U').toUpperCase();
  $('sidebar-name').textContent   = `${getDisplayName()}${u.lastname ? ` ${u.lastname}` : ''}`;
}

function applyUsageData(usage) {
  state.usage = usage || null;
  if (state.currentUser) state.currentUser.usage = usage || null;
  renderUsageState();
}

function renderUsageState() {
  const usage = state.usage;
  if (!usage) {
    $('usage-free-remaining').textContent = '20';
    $('usage-paid-remaining').textContent = '0';
    $('usage-minute-remaining').textContent = '5';
    $('usage-reset-note').textContent = 'Réinitialisation gratuite toutes les 5 heures.';
    $('quota-banner')?.classList.add('hidden');
    $('chat-input').disabled = false;
    $('send-btn').disabled = false;
    return;
  }

  $('usage-free-remaining').textContent = String(usage.freeMessagesRemaining ?? 0);
  $('usage-paid-remaining').textContent = String(usage.totalPaidCreditsRemaining ?? 0);
  $('usage-minute-remaining').textContent = String(usage.minuteMessagesRemaining ?? 0);
  $('usage-reset-note').textContent = usage.subscription?.expiresAt
    ? `Abonnement actif jusqu’au ${new Date(usage.subscription.expiresAt).toLocaleDateString()}.`
    : `Réinitialisation gratuite vers ${formatResetTime(usage.freeWindowResetAt)}.`;

  updateQuotaBanner();
  $('chat-input').disabled = Boolean(usage.blocked);
  $('send-btn').disabled = Boolean(isLoading || usage.blocked);
}

function updateQuotaBanner() {
  const banner = $('quota-banner');
  if (!banner) return;
  const usage = state.usage;

  if (!usage?.blocked) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  $('quota-banner-title').textContent = 'Messages épuisés';
  $('quota-banner-text').textContent = `Attendez la réinitialisation vers ${formatResetTime(usage.freeWindowResetAt)} ou rechargez votre compte.`;
}

async function refreshUsageStatus() {
  if (!state.token) return;
  try {
    const data = await api('GET', '/billing/status');
    applyUsageData(data.usage);
    state.paymentPlans = data.paymentPlans || [];
  } catch (error) {
    console.error('Erreur état quota:', error.message);
  }
}

function goToPaymentPage() {
  window.location.href = 'payment.html';
}

function formatResetTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'bientôt';
  return date.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function setChatMode(mode) {
  state.currentMode = mode || 'standard';
  if ($('chat-mode')) $('chat-mode').value = state.currentMode;
  $('input-hint').textContent = state.currentMode === 'deep_research'
    ? 'Mode Deep Research actif: détaillez le contexte pour une réponse plus riche.'
    : 'Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne.';
}

// ──────────────────────────────────────
// 9. UI HELPERS
// ──────────────────────────────────────
function showPanel(id) {
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  $(id).classList.add('active');
}
function isMobileView() {
  return window.matchMedia('(max-width: 680px)').matches;
}
function openSidebar() {
  const sidebar = $('sidebar');
  const backdrop = $('sidebar-backdrop');
  if (!sidebar) return;

  if (isMobileView()) {
    sidebar.classList.add('open');
    sidebar.classList.remove('collapsed');
    backdrop?.classList.remove('hidden');
    return;
  }

  sidebar.classList.remove('collapsed');
}
function closeSidebar() {
  const sidebar = $('sidebar');
  const backdrop = $('sidebar-backdrop');
  if (!sidebar) return;

  if (isMobileView()) {
    sidebar.classList.remove('open');
    sidebar.classList.add('collapsed');
    backdrop?.classList.add('hidden');
    return;
  }

  sidebar.classList.add('collapsed');
}
function toggleSidebar() {
  const sidebar = $('sidebar');
  if (!sidebar) return;

  if (isMobileView()) {
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
    return;
  }

  sidebar.classList.toggle('collapsed');
}
function syncSidebarState() {
  const sidebar = $('sidebar');
  const backdrop = $('sidebar-backdrop');
  if (!sidebar) return;

  if (isMobileView()) {
    sidebar.classList.remove('open');
    sidebar.classList.add('collapsed');
    backdrop?.classList.add('hidden');
    return;
  }

  sidebar.classList.remove('open', 'collapsed');
  backdrop?.classList.add('hidden');
}
function toggleProfileMenu(){ $('profile-menu').classList.toggle('open'); }
function closeProfileMenu() { $('profile-menu').classList.remove('open'); }
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
function autoResize(el) {
  if (el.value.length > MESSAGE_MAX_LENGTH) {
    el.value = `${el.value.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
  }
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  updateComposerMeta();
}
function showError(el, msg) { el.textContent = msg; }
function setBtn(btn, loading, label) {
  if (!btn) return;
  btn.disabled     = loading;
  btn.textContent  = label;
}
function $(id)           { return document.getElementById(id); }
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function formatDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
function escHtml(t) {
  return String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escHtml(value).replace(/'/g, '&#39;');
}

function wrapPlainText(text) {
  return escHtml(text).replace(/\n/g, '<br>');
}

function sanitizeHref(url) {
  const value = String(url || '').trim();
  if (!value) return '#';

  try {
    const parsed = new URL(value, window.location.origin);
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    return '#';
  }

  return '#';
}

function formatInlineMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeHref(href);
      return `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener">${label}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function parseMarkdown(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const codeBlocks = [];
  const escaped = escHtml(source).replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const token = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(
      `<pre><code class="lang-${escapeAttr((lang || '').toLowerCase())}">${code.trim()}</code></pre>`
    );
    return token;
  });

  const blocks = escaped.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  const html = blocks.map((block) => {
    if (/^__CODE_BLOCK_\d+__$/.test(block)) return block;

    const lines = block.split('\n');
    if (lines.every(line => /^\s*[-*] /.test(line))) {
      const items = lines
        .map(line => `<li>${formatInlineMarkdown(line.replace(/^\s*[-*] /, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    if (lines.every(line => /^\s*\d+\. /.test(line))) {
      const items = lines
        .map(line => `<li>${formatInlineMarkdown(line.replace(/^\s*\d+\. /, ''))}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }

    const raw = lines.join('<br>');
    if (raw.startsWith('### ')) return `<h3>${formatInlineMarkdown(raw.slice(4))}</h3>`;
    if (raw.startsWith('## ')) return `<h2>${formatInlineMarkdown(raw.slice(3))}</h2>`;
    if (raw.startsWith('# ')) return `<h1>${formatInlineMarkdown(raw.slice(2))}</h1>`;
    return `<p>${formatInlineMarkdown(raw)}</p>`;
  }).join('');

  return html.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[Number(index)] || '');
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatModeLabel(mode) {
  const labels = {
    standard: 'Mode standard',
    code: 'Mode code',
    math: 'Mode math',
    deep_research: 'Deep Research',
  };
  return labels[mode] || 'Mode standard';
}

function formatIntentLabel(intent) {
  const labels = {
    programming: 'Intention programmation',
    math: 'Intention math',
    debug: 'Intention debug',
    explanation: 'Intention explication',
    general: 'Intention générale',
    incident: 'Réponse de secours',
  };
  return labels[intent] || 'Intention générale';
}

function buildMessageMetaHtml(createdAt, meta, role) {
  if (role !== 'ai' || !meta) return '';

  const pills = [
    `<span class="meta-pill">${formatModeLabel(meta.mode)}</span>`,
    `<span class="meta-pill">${formatIntentLabel(meta.intent)}</span>`,
  ];

  if (meta.webResearch?.performed) {
    pills.push(`<span class="meta-pill">${(meta.webResearch.sources || []).length} source${(meta.webResearch.sources || []).length > 1 ? 's' : ''}</span>`);
  }

  return `<div class="msg-meta">${pills.join('')}</div>`;
}

function buildConversationMeta(conv) {
  if (!conv) return null;
  return {
    mode: conv.mode || state.currentMode,
    intent: conv.lastIntent || 'general',
    researchPlan: conv.lastResearchPlan || [],
    webResearch: {
      performed: Array.isArray(conv.lastResearchSources) && conv.lastResearchSources.length > 0,
      sources: conv.lastResearchSources || [],
    },
  };
}

function renderConversationMeta(meta) {
  const panel = $('chat-insights');
  const toggle = $('insights-toggle-btn');
  if (!panel) return;

  if (!meta) {
    state.lastReplyMeta = null;
    clearInsightsAutoHide();
    panel.classList.add('hidden');
    toggle?.classList.add('hidden');
    $('research-plan').innerHTML = '';
    $('research-sources').innerHTML = '';
    return;
  }

  state.lastReplyMeta = meta;
  panel.classList.remove('hidden');
  toggle?.classList.remove('hidden');
  $('insight-mode').textContent = formatModeLabel(meta.mode);
  $('insight-intent').textContent = formatIntentLabel(meta.intent);

  const sources = meta.webResearch?.sources || [];
  $('insight-sources-count').textContent = `${sources.length} source${sources.length > 1 ? 's' : ''}`;

  $('research-plan').innerHTML = (meta.researchPlan || []).length
    ? meta.researchPlan.map(step => `<div class="insight-item">${escHtml(step)}</div>`).join('')
    : '<div class="insight-empty">Aucun plan spécial pour cette conversation.</div>';

  $('research-sources').innerHTML = sources.length
    ? sources.map((source) => {
      const href = sanitizeHref(source.url);
      const title = escHtml(source.title || 'Source');
      const snippet = escHtml(source.snippet || 'Aucun extrait disponible.');
      return `
        <a class="insight-source" href="${escapeAttr(href)}" target="_blank" rel="noopener">
          <strong>${title}</strong>
          <span>${snippet}</span>
        </a>`;
    }).join('')
    : '<div class="insight-empty">Aucune source web associée.</div>';

  scheduleInsightsAutoHide();
}

function clearInsightsAutoHide() {
  if (insightsHideTimer) {
    clearTimeout(insightsHideTimer);
    insightsHideTimer = null;
  }
}

function scheduleInsightsAutoHide() {
  clearInsightsAutoHide();
  insightsHideTimer = window.setTimeout(() => {
    hideInsights();
  }, INSIGHTS_AUTO_HIDE_MS);
}

function hideInsights() {
  clearInsightsAutoHide();
  $('chat-insights')?.classList.add('hidden');
}

function showInsights() {
  if (!state.lastReplyMeta) return;
  renderConversationMeta(state.lastReplyMeta);
}

function toggleInsights() {
  const panel = $('chat-insights');
  if (!panel || !state.lastReplyMeta) return;

  if (panel.classList.contains('hidden')) {
    showInsights();
    return;
  }

  hideInsights();
}

async function copyMessage(button) {
  const text = button?.dataset?.copy || '';
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const previous = button.textContent;
    button.textContent = 'Copié';
    setTimeout(() => {
      button.textContent = previous;
    }, 1200);
  } catch (error) {
    console.warn('Copie impossible:', error.message);
  }
}

function scrollMessagesToBottom() {
  const container = $('messages');
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

function updateComposerMeta() {
  const input = $('chat-input');
  if (!input) return;
  if (input.value.length > MESSAGE_MAX_LENGTH) {
    input.value = `${input.value.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
  }
  const value = input.value || '';
  const count = value.length;
  $('char-counter').textContent = `${count}/${MESSAGE_MAX_LENGTH}`;
}

function typesetMath(target) {
  if (typeof window.renderMathInElement !== 'function' || !target) return;

  window.renderMathInElement(target, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
    strict: 'ignore',
  });
}

document.addEventListener('click', (e) => {
  const menu  = $('profile-menu');
  const pill  = document.querySelector('.user-pill');
  const modal = $('profile-modal');
  if (menu?.classList.contains('open') && !menu.contains(e.target) && !pill?.contains(e.target)) {
    closeProfileMenu();
  }
  if (modal && !modal.classList.contains('hidden') && e.target === modal) {
    closeProfile();
  }
});

document.addEventListener('input', (e) => {
  if (e.target?.id === 'onboard-name') {
    updateOnboardingWelcomeName();
  }
  if (e.target?.id === 'chat-input') {
    updateComposerMeta();
  }
});

$('chat-insights')?.addEventListener('mouseenter', clearInsightsAutoHide);
$('chat-insights')?.addEventListener('mouseleave', scheduleInsightsAutoHide);
$('chat-insights')?.addEventListener('focusin', clearInsightsAutoHide);
$('chat-insights')?.addEventListener('focusout', scheduleInsightsAutoHide);

window.addEventListener('resize', syncSidebarState);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSidebar();
    closeProfileMenu();
  }
});

// ──────────────────────────────────────
// 10. BOOTSTRAP — auto-login si token existant
// ──────────────────────────────────────
(async function init() {
  resetUiState();
  syncSidebarState();
  setupServiceWorker();
  renderUsageState();
  updateComposerMeta();
  setChatMode(state.currentMode);
  const token = localStorage.getItem('devai_token');
  if (!token) {
    $('auth-overlay').style.display = 'flex';
    return;
  }
  state.token = token;
  try {
    const data = await api('GET', '/auth/me');
    await loginUser(data.user, token);
  } catch {
    localStorage.removeItem('devai_token');
    $('auth-overlay').style.display = 'flex';
  }
})();
