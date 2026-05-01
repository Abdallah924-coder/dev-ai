'use strict';

const API_URL = resolveApiUrl();

function resolveApiUrl() {
  if (window.DEVAI_API_URL) return stripTrailingSlash(window.DEVAI_API_URL);

  const { protocol, hostname, origin } = window.location;
  if (protocol === 'file:') return 'http://localhost:5000/api';
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

async function postJson(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur serveur.');
  return data;
}

function setFeedback(id, message, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#ff8e8e' : '#c7bca6';
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js?v=20260503');
    registration.update().catch(() => {});
  } catch (error) {
    console.warn('Service worker indisponible:', error.message);
  }
}

document.getElementById('newsletter-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('newsletter-email');
  const email = input?.value.trim();
  if (!email) return;

  try {
    setFeedback('newsletter-feedback', 'Enregistrement en cours...');
    await postJson('/public/newsletter', { email });
    setFeedback('newsletter-feedback', 'Merci. Vous recevrez les prochaines mises à jour de DevAI.');
    input.value = '';
  } catch (error) {
    setFeedback('newsletter-feedback', error.message, true);
  }
});

document.getElementById('contact-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('contact-name')?.value.trim(),
    email: document.getElementById('contact-email')?.value.trim(),
    subject: document.getElementById('contact-subject')?.value.trim(),
    message: document.getElementById('contact-message')?.value.trim(),
  };

  try {
    setFeedback('contact-feedback', 'Envoi du message...');
    await postJson('/public/contact', payload);
    setFeedback('contact-feedback', 'Message envoyé. L’équipe WorldifyAI le recevra par e-mail.');
    event.target.reset();
  } catch (error) {
    setFeedback('contact-feedback', error.message, true);
  }
});

setupServiceWorker();
