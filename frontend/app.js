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
const ARTIFACT_MIN_LENGTH = 700;
const ARTIFACT_MIN_LINES = 18;
const MAX_CHAT_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const NOTIFICATION_STORAGE_KEY = 'devai_notifications_enabled';
const APP_VERSION = '20260502';

const messageStore = new Map();
let messageStoreCounter = 0;
let activeArtifactId = null;
let pendingChatImage = null;
let serviceWorkerRegistration = null;

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
  pendingVerificationEmail: '',
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
    state.pendingVerificationEmail = data.email || em;
    showVerificationPanel(state.pendingVerificationEmail, 'Un code de vérification a été envoyé.');
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
    if (e.status === 403 && e.payload?.verificationRequired) {
      state.pendingVerificationEmail = e.payload.email || em;
      showVerificationPanel(state.pendingVerificationEmail, e.message);
      const btn = document.querySelector('#panel-login .btn-primary');
      setBtn(btn, false, 'Se connecter');
      return;
    }
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
    setBtn(btn, false, 'Envoyer le code');
    window.location.href = `/reset-password?email=${encodeURIComponent(em)}`;
  } catch (e) {
    showError(err, e.message);
    const btn = document.querySelector('#panel-forgot .btn-primary');
    setBtn(btn, false, 'Envoyer le code');
  }
}

async function verifyEmailOtp() {
  const email = state.pendingVerificationEmail || $('reg-email').value.trim() || $('login-email').value.trim();
  const otp = $('verify-otp').value.trim();
  const err = $('verify-error');
  const suc = $('verify-success');
  err.textContent = '';
  suc.textContent = '';

  if (!isValidEmail(email)) return showError(err, 'Adresse e-mail invalide.');
  if (!otp) return showError(err, 'Le code OTP est requis.');

  try {
    const btn = $('btn-verify-email');
    setBtn(btn, true, 'Vérification…');
    const data = await api('POST', '/auth/verify-email', { email, otp });
    state.pendingVerificationEmail = '';
    beginSession(data.user, data.token);
    state.currentUser = data.user;
    if (!data.user.onboardingCompleted) {
      startOnboarding({
        preferredName: data.user.preferredName || data.user.firstname || '',
        birthDate: formatDateInputValue(data.user.birthDate),
      });
    } else {
      await finishOnboarding();
    }
    setBtn(btn, false, 'Vérifier le code');
  } catch (e) {
    showError(err, e.message);
    setBtn($('btn-verify-email'), false, 'Vérifier le code');
  }
}

async function resendVerificationOtp() {
  const email = state.pendingVerificationEmail || $('reg-email').value.trim() || $('login-email').value.trim();
  const err = $('verify-error');
  const suc = $('verify-success');
  err.textContent = '';
  suc.textContent = '';

  if (!isValidEmail(email)) return showError(err, 'Adresse e-mail invalide.');

  try {
    const btn = $('btn-verify-email');
    setBtn(btn, true, 'Envoi…');
    await api('POST', '/auth/resend-verification-otp', { email });
    state.pendingVerificationEmail = email;
    $('verify-email-target').textContent = email;
    suc.textContent = 'Un nouveau code a été envoyé.';
    setBtn(btn, false, 'Vérifier le code');
  } catch (e) {
    showError(err, e.message);
    setBtn($('btn-verify-email'), false, 'Vérifier le code');
  }
}

function doLogout() {
  localStorage.removeItem('devai_token');
  state = { currentUser: null, token: null, conversations: [], activeConvId: null, currentMode: 'standard', onboardingDraft: null, lastReplyMeta: null, usage: null, paymentPlans: [], pendingVerificationEmail: '' };
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

function showVerificationPanel(email, message = '') {
  resetUiState();
  $('auth-overlay').style.display = 'flex';
  $('app').classList.add('hidden');
  $('verify-email-target').textContent = email || 'ton adresse';
  $('verify-otp').value = '';
  $('verify-error').textContent = '';
  $('verify-success').textContent = message;
  showPanel('panel-verify-email');
  setTimeout(() => $('verify-otp')?.focus(), 0);
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
    const registration = await navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`);
    serviceWorkerRegistration = registration;
    registration.update().catch(() => {});
  } catch (error) {
    console.warn('Service worker indisponible:', error.message);
  }
}

function areReplyNotificationsEnabled() {
  const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
  return stored !== 'off';
}

function disableReplyNotifications() {
  localStorage.setItem(NOTIFICATION_STORAGE_KEY, 'off');
}

function isChatInBackground() {
  return document.hidden || !document.hasFocus();
}

async function ensureReplyNotificationPermission() {
  if (!areReplyNotificationsEnabled()) return false;
  if (!('Notification' in window) || !serviceWorkerRegistration) return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    disableReplyNotifications();
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'denied') {
      disableReplyNotifications();
      return false;
    }
    if (permission !== 'granted') {
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Permission notification refusée:', error.message);
    return false;
  }
}

function summarizeNotificationReply(reply) {
  const compact = String(reply || '')
    .replace(/```[\s\S]*?```/g, 'Code disponible dans le chat.')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) return 'La reponse est prete dans DevAI.';
  if (compact.length <= 140) return compact;
  return `${compact.slice(0, 137)}…`;
}

function buildReplyNotificationPayload({ conversationId, title, question, reply }) {
  return {
    type: 'SHOW_CHAT_REPLY_NOTIFICATION',
    payload: {
      title: title || 'Reponse DevAI prete',
      body: summarizeNotificationReply(reply),
      conversationId,
      url: conversationId ? `/app?conversation=${encodeURIComponent(conversationId)}` : '/app',
      question: String(question || '').slice(0, 180),
      icon: '/favicon.svg?v=20260426',
      badge: '/favicon.svg?v=20260426',
      tag: `devai-reply-${conversationId || 'latest'}`,
    },
  };
}

async function notifyReplyIfNeeded({ conversationId, title, question, reply }) {
  if (!isChatInBackground()) return;
  const hasPermission = await ensureReplyNotificationPermission();
  if (!hasPermission) return;

  const message = buildReplyNotificationPayload({ conversationId, title, question, reply });
  const activeWorker = serviceWorkerRegistration?.active || serviceWorkerRegistration?.waiting || serviceWorkerRegistration?.installing;

  if (activeWorker) {
    activeWorker.postMessage(message);
    return;
  }

  await serviceWorkerRegistration.showNotification(message.payload.title, {
    body: message.payload.body,
    icon: message.payload.icon,
    badge: message.payload.badge,
    tag: message.payload.tag,
    renotify: true,
    requireInteraction: false,
    data: {
      conversationId: message.payload.conversationId,
      url: message.payload.url,
      question: message.payload.question,
    },
  });
}

function handleNotificationNavigation(conversationId) {
  if (!conversationId) return;

  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('conversation', conversationId);
  window.history.replaceState({}, '', currentUrl.toString());

  if (state.activeConvId === conversationId) return;
  switchConv(conversationId).catch((error) => {
    console.warn('Impossible d’ouvrir la conversation depuis la notification:', error.message);
  });
}

function syncConversationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const conversationId = params.get('conversation');
  if (!conversationId) return null;
  return conversationId;
}

// ──────────────────────────────────────
// 5. CONVERSATIONS (depuis le backend)
// ──────────────────────────────────────
async function loadConversations() {
  try {
    const data = await api('GET', '/conversations');
    state.conversations = data.conversations || [];
    renderConvList();
    const requestedConversationId = syncConversationFromUrl();

    if (requestedConversationId) {
      const match = state.conversations.find((conversation) => conversation._id === requestedConversationId);
      if (match) {
        await switchConv(match._id);
        return;
      }
    }

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
    attachment: m.attachment || null,
  }));
  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content, options = {}) {
  const { scroll = true, createdAt = new Date().toISOString(), meta = null, attachment = null } = options;
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
  const display = role === 'ai'
    ? buildAiDisplay(content)
    : { html: wrapPlainText(content), artifact: null };
  const messageId = role === 'ai' ? storeMessageContent(content) : null;
  const metaHtml = buildMessageMetaHtml(createdAt, meta, role);

  div.innerHTML = `
    <div class="msg-avatar">${initials}</div>
    <div class="msg-content">
      <div class="msg-head">
        <div class="msg-role">${roleName}</div>
        <div class="msg-head-actions">
          <span class="msg-time">${formatMessageTime(createdAt)}</span>
          ${role === 'ai' ? buildAiActionButtons({ messageId, artifact: display.artifact }) : ''}
        </div>
      </div>
      ${attachment?.kind === 'image' && attachment?.dataUrl ? `<div class="msg-attachment"><img src="${escapeAttr(attachment.dataUrl)}" alt="${escapeAttr(attachment.originalName || 'Image jointe')}" /></div>` : ''}
      <div class="msg-text">${display.html}</div>
      ${metaHtml}
    </div>`;
  container.appendChild(div);
  if (role === 'ai') typesetMath(div);
  if (scroll) container.scrollTop = container.scrollHeight;
  return div;
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
  if ((!text && !pendingChatImage) || !state.activeConvId) return;

  const normalizedText = text.length > MESSAGE_MAX_LENGTH
    ? `${text.slice(0, MESSAGE_MAX_LENGTH - 1)}…`
    : text;
  const attachment = pendingChatImage;

  input.value = '';
  input.style.height = 'auto';
  clearChatImage();
  updateComposerMeta();
  setLoading(true);
  appendMessage('user', normalizedText || '[Image envoyée pour analyse]', { attachment });
  const streamMessage = createStreamingMessage();

  try {
    ensureReplyNotificationPermission().catch(() => {});
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
      },
      body: JSON.stringify({
        conversationId: state.activeConvId,
        message: normalizedText || '[Image envoyée pour analyse]',
        mode: state.currentMode,
        imageDataUrl: attachment?.dataUrl || null,
        imageOriginalName: attachment?.originalName || '',
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const error = new Error(errorPayload.error || `Erreur ${response.status}`);
      error.status = response.status;
      error.payload = errorPayload;
      throw error;
    }

    const data = await consumeChatStream(response, streamMessage);
    const replyMeta = {
      mode: data.mode,
      intent: data.intent,
      researchPlan: data.researchPlan || [],
      webResearch: data.webResearch || { performed: false, sources: [] },
    };
    state.lastReplyMeta = replyMeta;
    renderConversationMeta(replyMeta);
    if (data.usage) applyUsageData(data.usage);

    // Mettre à jour le titre si généré automatiquement
    const conv = state.conversations.find(c => c._id === state.activeConvId);
    let resolvedTitle = data.title || 'Reponse DevAI prete';
    if (conv) {
      conv.messages = conv.messages || [];
      conv.messages.push(
        { role: 'user', content: normalizedText || '[Image envoyée pour analyse]', attachment, createdAt: new Date().toISOString() },
        { role: 'ai', content: data.reply, createdAt: new Date().toISOString() },
      );
      conv.mode = data.mode || conv.mode;
      conv.lastIntent = data.intent || conv.lastIntent;
      conv.lastResearchPlan = data.researchPlan || conv.lastResearchPlan || [];
      conv.lastResearchSources = data.webResearch?.sources || conv.lastResearchSources || [];
      if (data.title) {
        conv.title = data.title;
        $('chat-title').textContent = data.title;
      }
      resolvedTitle = conv.title || resolvedTitle;
      renderConvList();
    }

    await notifyReplyIfNeeded({
      conversationId: state.activeConvId,
      title: resolvedTitle,
      question: normalizedText || attachment?.originalName || '',
      reply: data.reply,
    });
  } catch (e) {
    removeStreamingMessage(streamMessage);
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
  $('chat-image-input').disabled = v || Boolean(state.usage?.blocked);
}

function openChatImagePicker() {
  const input = $('chat-image-input');
  if (!input || input.disabled) return;
  input.value = '';
  if (typeof input.showPicker === 'function') {
    input.showPicker();
    return;
  }
  input.click();
}

function handleChatImageSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
    appendMessage('ai', "⚠️ Format d'image non supporté. Utilise PNG, JPG ou WEBP.");
    clearChatImage();
    return;
  }

  if (file.size > MAX_CHAT_IMAGE_SIZE_BYTES) {
    appendMessage('ai', "⚠️ L'image dépasse 2 MB.");
    clearChatImage();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingChatImage = {
      kind: 'image',
      dataUrl: String(reader.result || ''),
      originalName: file.name || 'image',
      mimeType: file.type,
    };
    $('chat-image-preview').src = pendingChatImage.dataUrl;
    $('chat-image-name').textContent = pendingChatImage.originalName;
    $('chat-image-preview-wrap').classList.remove('hidden');
  };
  reader.onerror = () => {
    appendMessage('ai', "⚠️ Impossible de lire l'image.");
    clearChatImage();
  };
  reader.readAsDataURL(file);
}

function clearChatImage() {
  pendingChatImage = null;
  $('chat-image-input').value = '';
  $('chat-image-preview').removeAttribute('src');
  $('chat-image-name').textContent = 'image';
  $('chat-image-preview-wrap').classList.add('hidden');
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
    $('prof-password').value = '';
    updateSidebarUser();
    updateProfileDisplay();
    suc.textContent = pw ? '✓ Profil mis à jour. Nouveau mot de passe enregistré.' : '✓ Profil mis à jour avec succès.';
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
  window.location.href = '/payment';
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

function storeMessageContent(text) {
  const id = `msg-${++messageStoreCounter}`;
  messageStore.set(id, String(text || ''));
  return id;
}

function readStoredMessage(messageId) {
  return messageStore.get(messageId) || '';
}

function containsCodeFence(text) {
  return /```[\s\S]*?```/.test(String(text || ''));
}

function shouldCreateArtifact(text) {
  const value = String(text || '');
  return containsCodeFence(value)
    && (
      value.length >= ARTIFACT_MIN_LENGTH
      || value.split('\n').length >= ARTIFACT_MIN_LINES
    );
}

function buildArtifact(content) {
  if (!shouldCreateArtifact(content)) return null;

  const codeFenceMatches = [...String(content || '').matchAll(/```(\w+)?\n?([\s\S]*?)```/g)];
  const firstLanguage = (codeFenceMatches[0]?.[1] || '').toLowerCase();

  return {
    title: 'Artifact code',
    kind: 'code',
    language: firstLanguage || null,
    summary: 'Code long déplacé dans un artifact pour garder la conversation lisible.',
  };
}

function buildAiDisplay(content) {
  const artifact = buildArtifact(content);
  if (!artifact) {
    return { html: parseMarkdown(content), artifact: null };
  }

  return {
    artifact,
    html: `
      <div class="artifact-preview">
        <div class="artifact-preview-label">${artifact.kind === 'code' ? 'Artifact code' : 'Artifact texte long'}</div>
        <p>${escHtml(artifact.summary)}</p>
      </div>
    `,
  };
}

function buildAiActionButtons({ messageId, artifact }) {
  const buttons = [
    `<button class="msg-action-btn" type="button" onclick="copyMessage(this)" data-message-id="${escapeAttr(messageId)}">Copier</button>`,
  ];

  if (artifact) {
    buttons.push(`
      <button
        class="msg-action-btn"
        type="button"
        onclick="openArtifactFromButton(this)"
        data-message-id="${escapeAttr(messageId)}"
        data-artifact-title="${escapeAttr(artifact.title)}"
        data-artifact-kind="${escapeAttr(artifact.kind)}"
        data-artifact-language="${escapeAttr(artifact.language || '')}"
      >
        Ouvrir l'artifact
      </button>
    `);
  }

  return buttons.join('');
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
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/\\n/g, '<br>');
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

  const blocks = splitMarkdownBlocks(escaped);
  const html = blocks.map((block) => {
    if (/^__CODE_BLOCK_\d+__$/.test(block)) return block;

    const lines = block.split('\n');
    if (isMarkdownTable(lines)) {
      return renderMarkdownTable(lines);
    }

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

function isMarkdownTable(lines) {
  if (lines.length < 2) return false;
  if (!lines[0].includes('|') || !lines[1].includes('|')) return false;

  const separatorCells = splitMarkdownTableRow(lines[1]);
  if (!separatorCells.length) return false;

  return separatorCells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line) {
  const raw = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;
  let inCode = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '`') {
      inCode = !inCode;
      current += char;
      continue;
    }

    if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function renderMarkdownTable(lines) {
  const header = splitMarkdownTableRow(lines[0]);
  const align = splitMarkdownTableRow(lines[1]).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
  const bodyRows = lines.slice(2).map(splitMarkdownTableRow).filter(row => row.length);

  const headHtml = `<thead><tr>${header.map((cell, index) => `<th class="align-${align[index] || 'left'}">${formatInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`;
  const bodyHtml = bodyRows.length
    ? `<tbody>${bodyRows.map(row => `<tr>${header.map((_, index) => `<td class="align-${align[index] || 'left'}">${formatInlineMarkdown(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';

  return `<div class="table-wrap"><table>${headHtml}${bodyHtml}</table></div>`;
}

function appendMarkdownTableContinuation(row, text) {
  const trimmedRow = String(row || '').trimEnd();
  const continuation = String(text || '').trim();
  if (!trimmedRow || !continuation) return trimmedRow;
  if (trimmedRow.endsWith('|')) {
    return `${trimmedRow.slice(0, -1)} <br> ${continuation} |`;
  }
  return `${trimmedRow} <br> ${continuation}`;
}

function splitMarkdownBlocks(source) {
  const lines = String(source || '').split('\n');
  const blocks = [];
  let buffer = [];

  const flush = () => {
    const block = buffer.join('\n').trim();
    if (block) blocks.push(block);
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^__CODE_BLOCK_\d+__$/.test(trimmed)) {
      flush();
      blocks.push(trimmed);
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    if (looksLikeMarkdownTableStart(lines, index)) {
      flush();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length) {
        const row = lines[index];
        const rowTrimmed = row.trim();
        if (!rowTrimmed) {
          index -= 1;
          break;
        }
        if (!row.includes('|')) {
          tableLines[tableLines.length - 1] = appendMarkdownTableContinuation(
            tableLines[tableLines.length - 1],
            rowTrimmed,
          );
          index += 1;
          continue;
        }
        tableLines.push(row);
        index += 1;
      }
      blocks.push(tableLines.join('\n').trim());
      continue;
    }

    buffer.push(line);
  }

  flush();
  return blocks;
}

function looksLikeMarkdownTableStart(lines, index) {
  const first = String(lines[index] || '').trim();
  const second = String(lines[index + 1] || '').trim();
  if (!first.includes('|') || !second.includes('|')) return false;
  return isMarkdownTable([first, second]);
}

function createStreamingMessage() {
  const node = appendMessage('ai', '', { scroll: true, meta: null });
  node.classList.add('streaming');
  const textNode = node.querySelector('.msg-text');
  const actionsNode = node.querySelector('.msg-head-actions');
  const metaNode = node.querySelector('.msg-meta');
  if (actionsNode) {
    const buttons = actionsNode.querySelectorAll('.msg-action-btn');
    buttons.forEach(button => button.remove());
  }
  if (metaNode) metaNode.remove();
  if (textNode) textNode.innerHTML = '<div class="streaming-placeholder">Réponse en cours…</div>';

  return {
    node,
    textNode,
    queue: [],
    rawText: '',
    renderTimer: null,
    createdAt: new Date().toISOString(),
  };
}

function splitStreamingText(text) {
  return String(text || '').match(/\S+\s*|\n/g) || [];
}

function drainStreamingQueue(streamMessage) {
  if (!streamMessage?.textNode) return;
  if (streamMessage.renderTimer) return;

  const renderNext = () => {
    if (!streamMessage.queue.length) {
      streamMessage.renderTimer = null;
      return;
    }

    streamMessage.rawText += streamMessage.queue.shift();
    streamMessage.textNode.innerHTML = wrapPlainText(streamMessage.rawText);
    scrollMessagesToBottom();
    streamMessage.renderTimer = window.setTimeout(renderNext, 24);
  };

  renderNext();
}

function updateStreamingMessage(streamMessage, deltaText) {
  if (!streamMessage?.textNode) return;
  streamMessage.queue.push(...splitStreamingText(deltaText));
  drainStreamingQueue(streamMessage);
}

function waitForStreamingQueue(streamMessage) {
  if (!streamMessage) return Promise.resolve();

  return new Promise((resolve) => {
    const check = () => {
      if (!streamMessage.queue.length && !streamMessage.renderTimer) {
        resolve();
        return;
      }
      window.setTimeout(check, 20);
    };
    check();
  });
}

function finalizeStreamingMessage(streamMessage, content, meta) {
  if (!streamMessage?.node || !streamMessage.textNode) return;
  window.clearTimeout(streamMessage.renderTimer);
  streamMessage.renderTimer = null;
  streamMessage.rawText = String(content || '');
  const display = buildAiDisplay(content);
  const messageId = storeMessageContent(content);
  streamMessage.node.classList.remove('streaming');
  streamMessage.textNode.innerHTML = display.html;

  const actionsNode = streamMessage.node.querySelector('.msg-head-actions');
  if (actionsNode) {
    const timeNode = actionsNode.querySelector('.msg-time');
    actionsNode.innerHTML = `${timeNode ? timeNode.outerHTML : ''}${buildAiActionButtons({ messageId, artifact: display.artifact })}`;
  }

  const contentNode = streamMessage.node.querySelector('.msg-content');
  if (contentNode) {
    const oldMetaNode = contentNode.querySelector('.msg-meta');
    if (oldMetaNode) oldMetaNode.remove();
    const metaHtml = buildMessageMetaHtml(streamMessage.createdAt, meta, 'ai');
    if (metaHtml) contentNode.insertAdjacentHTML('beforeend', metaHtml);
  }

  typesetMath(streamMessage.node);
  scrollMessagesToBottom();
}

function removeStreamingMessage(streamMessage) {
  if (!streamMessage) return;
  window.clearTimeout(streamMessage.renderTimer);
  streamMessage.node?.remove();
}

async function consumeChatStream(response, streamMessage) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    return response.json();
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let meta = null;
  let donePayload = null;

  const processEventBlock = async (rawEvent) => {
    const event = parseBrowserSseEvent(rawEvent);
    if (!event?.data) return;
    const payload = JSON.parse(event.data);

    if (event.event === 'meta') {
      meta = payload;
      return;
    }

    if (event.event === 'delta') {
      updateStreamingMessage(streamMessage, payload.text || '');
      return;
    }

    if (event.event === 'error') {
      throw Object.assign(new Error(payload.error || 'Erreur de streaming IA.'), { payload });
    }

    if (event.event === 'done') {
      donePayload = payload;
    }
  };

  while (reader) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');

    while (buffer.includes('\n\n')) {
      const boundaryIndex = buffer.indexOf('\n\n');
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      await processEventBlock(rawEvent);
    }

    if (done) break;
  }

  if (buffer.trim()) {
    await processEventBlock(buffer.trim());
  }

  await waitForStreamingQueue(streamMessage);

  const finalPayload = donePayload || meta;
  if (!finalPayload?.reply) {
    throw new Error('La réponse IA est incomplète.');
  }

  finalizeStreamingMessage(streamMessage, finalPayload.reply, {
    mode: finalPayload.mode,
    intent: finalPayload.intent,
    researchPlan: finalPayload.researchPlan || [],
    webResearch: finalPayload.webResearch || { performed: false, sources: [] },
  });

  return finalPayload;
}

function parseBrowserSseEvent(rawEvent) {
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
    memory_control: 'Contrôle mémoire',
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
  const text = readStoredMessage(button?.dataset?.messageId);
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

function openArtifactFromButton(button) {
  const messageId = button?.dataset?.messageId;
  const content = readStoredMessage(messageId);
  if (!content) return;

  activeArtifactId = messageId;
  $('artifact-title').textContent = button.dataset.artifactTitle || 'Artifact';
  $('artifact-meta').textContent = button.dataset.artifactLanguage
    ? `${button.dataset.artifactKind || 'text'} • ${button.dataset.artifactLanguage}`
    : (button.dataset.artifactKind || 'text');
  $('artifact-download-btn').dataset.artifactLanguage = button.dataset.artifactLanguage || '';
  $('artifact-download-btn').dataset.artifactKind = button.dataset.artifactKind || 'text';
  $('artifact-body').innerHTML = parseMarkdown(content);
  $('artifact-modal').classList.remove('hidden');
  typesetMath($('artifact-body'));
}

function closeArtifact() {
  activeArtifactId = null;
  $('artifact-modal').classList.add('hidden');
}

async function copyArtifact() {
  const text = readStoredMessage(activeArtifactId);
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const button = $('artifact-copy-btn');
    const previous = button.textContent;
    button.textContent = 'Copié';
    setTimeout(() => {
      button.textContent = previous;
    }, 1200);
  } catch (error) {
    console.warn('Copie artifact impossible:', error.message);
  }
}

function buildArtifactFilename(language, kind = 'text') {
  const normalized = String(language || '').trim().toLowerCase();
  const extensionMap = {
    javascript: 'js',
    js: 'js',
    typescript: 'ts',
    ts: 'ts',
    jsx: 'jsx',
    tsx: 'tsx',
    python: 'py',
    py: 'py',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    csharp: 'cs',
    'c#': 'cs',
    php: 'php',
    ruby: 'rb',
    go: 'go',
    rust: 'rs',
    swift: 'swift',
    kotlin: 'kt',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    json: 'json',
    yaml: 'yml',
    yml: 'yml',
    xml: 'xml',
    sql: 'sql',
    shell: 'sh',
    bash: 'sh',
    sh: 'sh',
    markdown: 'md',
    md: 'md',
    text: 'txt',
  };

  const extension = extensionMap[normalized] || (kind === 'code' ? 'txt' : 'txt');
  return `artifact-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
}

function downloadArtifact() {
  const text = readStoredMessage(activeArtifactId);
  if (!text) return;

  const button = $('artifact-download-btn');
  const language = button?.dataset?.artifactLanguage || '';
  const kind = button?.dataset?.artifactKind || 'text';
  const filename = buildArtifactFilename(language, kind);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
  const artifactModal = $('artifact-modal');
  if (menu?.classList.contains('open') && !menu.contains(e.target) && !pill?.contains(e.target)) {
    closeProfileMenu();
  }
  if (modal && !modal.classList.contains('hidden') && e.target === modal) {
    closeProfile();
  }
  if (artifactModal && !artifactModal.classList.contains('hidden') && e.target === artifactModal) {
    closeArtifact();
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

navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'OPEN_CONVERSATION_FROM_NOTIFICATION') {
    handleNotificationNavigation(event.data.conversationId);
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
    closeArtifact();
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
