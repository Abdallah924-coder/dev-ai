'use strict';

const API_URL = resolveApiUrl();
const token = localStorage.getItem('devai_token');
let selectedPlan = null;
let plans = [];
let proofDataUrl = '';

if (!token) {
  window.location.href = '/app';
}

function resolveApiUrl() {
  if (window.DEVAI_API_URL) return stripTrailingSlash(window.DEVAI_API_URL);

  const { protocol, hostname, origin } = window.location;
  if (protocol === 'file:') return 'http://localhost:5000/api';
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return `${protocol}//${hostname}:5000/api`;
  }
  return `${origin}/api`;
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, '');
}

// La page paiement doit pouvoir défiler sur desktop et mobile.
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';
document.body.style.minHeight = '100vh';

async function api(method, path, body = null) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function formatReset(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderPlans() {
  const grid = document.getElementById('plan-grid');
  grid.innerHTML = plans.map((plan) => `
    <button type="button" class="plan-card${selectedPlan?.code === plan.code ? ' active' : ''}" data-code="${plan.code}">
      <strong>${plan.label}</strong>
      <span>${plan.isSubscription ? 'Abonnement mensuel' : 'Pack de messages'}</span>
      <em>${plan.credits} messages</em>
    </button>
  `).join('');

  grid.querySelectorAll('.plan-card').forEach((button) => {
    button.addEventListener('click', () => {
      selectedPlan = plans.find((plan) => plan.code === button.dataset.code) || null;
      document.getElementById('selected-plan-code').value = selectedPlan?.code || '';
      renderPlans();
    });
  });
}

function renderUsage(data) {
  document.getElementById('payment-free').textContent = String(data.usage?.freeMessagesRemaining ?? 0);
  document.getElementById('payment-paid').textContent = String(data.usage?.totalPaidCreditsRemaining ?? 0);
  document.getElementById('payment-reset').textContent = formatReset(data.usage?.freeWindowResetAt);
  document.getElementById('payee-phone').textContent = data.payee.phone;
  document.getElementById('payee-name').textContent = data.payee.name;
}

function renderRequests(requests) {
  const container = document.getElementById('payment-requests-list');
  if (!requests.length) {
    container.innerHTML = '<div class="portal-empty">Aucune demande envoyée pour le moment.</div>';
    return;
  }

  container.innerHTML = requests.map((request) => `
    <article class="portal-list-item">
      <strong>${request.planLabel}</strong>
      <span>Statut: ${request.status}</span>
      <span>Soumis le ${new Date(request.createdAt).toLocaleString()}</span>
      ${request.adminNote ? `<p>${request.adminNote}</p>` : ''}
    </article>
  `).join('');
}

function setFeedback(error = '', success = '') {
  document.getElementById('payment-error').textContent = error;
  document.getElementById('payment-success').textContent = success;
}

function previewProof(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire la preuve de paiement.'));
    reader.readAsDataURL(file);
  });
}

async function loadPaymentPage() {
  const data = await api('GET', '/billing/status');
  plans = data.paymentPlans || [];
  selectedPlan = selectedPlan || plans[0] || null;
  document.getElementById('selected-plan-code').value = selectedPlan?.code || '';
  renderPlans();
  renderUsage(data);
  renderRequests(data.paymentRequests || []);
}

document.getElementById('payment-proof').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    proofDataUrl = await previewProof(file);
    document.getElementById('proof-preview').src = proofDataUrl;
    document.getElementById('proof-preview-wrap').classList.remove('hidden');
  } catch (error) {
    setFeedback(error.message, '');
  }
});

document.getElementById('payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setFeedback('', '');

  if (!selectedPlan) {
    setFeedback('Choisissez un plan avant de soumettre.', '');
    return;
  }

  if (!proofDataUrl) {
    setFeedback('Ajoutez une preuve de paiement avant de soumettre.', '');
    return;
  }

  const file = document.getElementById('payment-proof').files?.[0];
  const button = document.getElementById('payment-submit-btn');
  button.disabled = true;
  button.textContent = 'Envoi…';

  try {
    await api('POST', '/billing/payment-requests', {
      planCode: selectedPlan.code,
      payerName: document.getElementById('payer-name').value.trim(),
      payerPhone: document.getElementById('payer-phone').value.trim(),
      paymentReference: document.getElementById('payment-reference').value.trim(),
      note: document.getElementById('payment-note').value.trim(),
      proofDataUrl,
      proofOriginalName: file?.name || 'preuve',
    });

    setFeedback('', 'Demande envoyée. Vous recevrez une validation après vérification.');
    document.getElementById('payment-form').reset();
    document.getElementById('proof-preview-wrap').classList.add('hidden');
    proofDataUrl = '';
    await loadPaymentPage();
  } catch (error) {
    setFeedback(error.message, '');
  } finally {
    button.disabled = false;
    button.textContent = 'Soumettre la demande';
  }
});

loadPaymentPage().catch((error) => {
  setFeedback(error.message, '');
});
