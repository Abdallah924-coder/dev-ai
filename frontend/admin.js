'use strict';

const API_URL = resolveApiUrl();
const STORAGE_KEY = 'devai_admin_token';
let adminToken = localStorage.getItem(STORAGE_KEY) || '';

function resolveApiUrl() {
  const { protocol, hostname, origin } = window.location;
  if (protocol === 'file:') return 'http://localhost:5000/api';
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return `${protocol}//${hostname}:5000/api`;
  }
  return `${origin}/api`;
}

async function api(method, path, body = null, isBlob = false) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(isBlob ? {} : { 'Content-Type': 'application/json' }),
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body && !isBlob ? JSON.stringify(body) : null,
  });

  if (isBlob) {
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    return res.blob();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function setAdminError(message = '') {
  document.getElementById('admin-error').textContent = message;
}

function setLoggedInState(isLoggedIn) {
  document.getElementById('admin-login-card').classList.toggle('hidden', isLoggedIn);
  document.getElementById('admin-shell').classList.toggle('hidden', !isLoggedIn);
}

async function loadOverview() {
  const data = await api('GET', '/admin/overview');
  document.getElementById('admin-pending-count').textContent = String(data.counts.pendingCount || 0);
  document.getElementById('admin-approved-count').textContent = String(data.counts.approvedCount || 0);
  document.getElementById('admin-users-count').textContent = String(data.counts.usersCount || 0);
}

async function viewProof(requestId) {
  const blob = await api('GET', `/admin/payment-requests/${requestId}/proof`, null, true);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function approveRequest(requestId) {
  const adminNote = window.prompt('Note admin optionnelle pour l’approbation:', '') || '';
  await api('POST', `/admin/payment-requests/${requestId}/approve`, { adminNote });
  await loadAdminData();
}

async function rejectRequest(requestId) {
  const adminNote = window.prompt('Motif du rejet:', '') || '';
  if (!adminNote.trim()) return;
  await api('POST', `/admin/payment-requests/${requestId}/reject`, { adminNote });
  await loadAdminData();
}

function renderRequests(requests) {
  const container = document.getElementById('admin-requests-list');
  if (!requests.length) {
    container.innerHTML = '<div class="portal-empty">Aucune demande de paiement.</div>';
    return;
  }

  container.innerHTML = requests.map((request) => `
    <article class="admin-request-card">
      <div class="admin-request-head">
        <div>
          <strong>${request.planLabel}</strong>
          <p>${request.user?.firstname || ''} ${request.user?.lastname || ''} • ${request.user?.email || ''}</p>
        </div>
        <span class="admin-status status-${request.status}">${request.status}</span>
      </div>
      <div class="admin-request-grid">
        <span>Payeur: ${request.payerName}</span>
        <span>Téléphone: ${request.payerPhone}</span>
        <span>Référence: ${request.paymentReference || 'Non fournie'}</span>
        <span>Crédits: ${request.credits}</span>
      </div>
      ${request.note ? `<p class="admin-note">${request.note}</p>` : ''}
      ${request.adminNote ? `<p class="admin-note">Note admin: ${request.adminNote}</p>` : ''}
      <div class="admin-actions">
        <button class="btn-ghost" type="button" data-proof="${request._id}">Voir la preuve</button>
        ${request.status === 'pending' ? `<button class="btn-ghost" type="button" data-reject="${request._id}">Rejeter</button><button class="btn-primary quota-pay-btn" type="button" data-approve="${request._id}">Approuver</button>` : ''}
      </div>
    </article>
  `).join('');

  container.querySelectorAll('[data-proof]').forEach((button) => {
    button.addEventListener('click', () => viewProof(button.dataset.proof).catch((error) => window.alert(error.message)));
  });
  container.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', () => approveRequest(button.dataset.approve).catch((error) => window.alert(error.message)));
  });
  container.querySelectorAll('[data-reject]').forEach((button) => {
    button.addEventListener('click', () => rejectRequest(button.dataset.reject).catch((error) => window.alert(error.message)));
  });
}

async function loadAdminData() {
  await loadOverview();
  const data = await api('GET', '/admin/payment-requests');
  renderRequests(data.paymentRequests || []);
}

document.getElementById('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setAdminError('');
  const button = document.getElementById('admin-login-btn');
  button.disabled = true;
  button.textContent = 'Connexion…';

  try {
    const data = await api('POST', '/admin/login', {
      password: document.getElementById('admin-password').value,
    });
    adminToken = data.token;
    localStorage.setItem(STORAGE_KEY, adminToken);
    setLoggedInState(true);
    await loadAdminData();
  } catch (error) {
    setAdminError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Se connecter';
  }
});

document.getElementById('admin-refresh-btn').addEventListener('click', () => {
  loadAdminData().catch((error) => window.alert(error.message));
});

if (adminToken) {
  setLoggedInState(true);
  loadAdminData().catch(() => {
    adminToken = '';
    localStorage.removeItem(STORAGE_KEY);
    setLoggedInState(false);
  });
}
