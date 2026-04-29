const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

function createTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('Configuration email SMTP incomplète.');
  }

  const port = parseInt(process.env.EMAIL_PORT, 10) || 587;
  const secure = process.env.EMAIL_SECURE != null
    ? String(process.env.EMAIL_SECURE).toLowerCase() === 'true'
    : port === 465;

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    requireTLS: !secure,
    connectionTimeout: parseInt(process.env.EMAIL_CONNECTION_TIMEOUT_MS, 10) || 15000,
    greetingTimeout: parseInt(process.env.EMAIL_GREETING_TIMEOUT_MS, 10) || 15000,
    socketTimeout: parseInt(process.env.EMAIL_SOCKET_TIMEOUT_MS, 10) || 20000,
    tls: {
      minVersion: 'TLSv1.2',
    },
  });
}

function getFromAddress() {
  return process.env.EMAIL_FROM || 'DevAI <noreply@worldifyai.com>';
}

function parseMailbox(value) {
  const input = String(value || '').trim();
  const match = input.match(/^(?:"?([^"]*)"?\s)?<([^>]+)>$/);

  if (match) {
    return {
      name: String(match[1] || '').trim(),
      email: String(match[2] || '').trim(),
    };
  }

  return {
    name: '',
    email: input,
  };
}

function getAdminInbox() {
  return process.env.CONTACT_RECEIVER_EMAIL || process.env.EMAIL_USER || parseMailbox(getFromAddress()).email;
}

function getFrontendUrl() {
  return String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function renderLogoSvg() {
  return `
    <svg width="46" height="46" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="21" cy="21" r="21" fill="url(#devai-gradient-email)"/>
      <path d="M12 21H22C24.7614 21 27 18.7614 27 16C27 13.2386 24.7614 11 22 11H12" stroke="#0B0B0D" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M12 31H26C28.7614 31 31 28.7614 31 26C31 23.2386 28.7614 21 26 21H12" stroke="#0B0B0D" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="11" cy="11" r="2.4" fill="#0B0B0D"/>
      <circle cx="11" cy="21" r="2.4" fill="#0B0B0D"/>
      <defs>
        <linearGradient id="devai-gradient-email" x1="6" y1="6" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stop-color="#FFD54A"/>
          <stop offset="1" stop-color="#FF9B1A"/>
        </linearGradient>
      </defs>
    </svg>`;
}

function renderEmailLayout({ eyebrow, title, intro, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  const ctaBlock = ctaLabel && ctaUrl
    ? `<a href="${ctaUrl}" class="btn">${ctaLabel}</a>`
    : '';

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    body { margin:0; padding:0; background:#09090c; font-family:Arial, Helvetica, sans-serif; color:#f7f3ea; }
    table { border-collapse:collapse; }
    .shell { width:100%; padding:32px 14px; background:
      radial-gradient(circle at top left, rgba(242,186,36,0.14), transparent 28%),
      radial-gradient(circle at top right, rgba(255,255,255,0.10), transparent 18%),
      #09090c; }
    .card { max-width:560px; margin:0 auto; background:#101015; border:1px solid rgba(255,255,255,0.08); border-radius:20px; overflow:hidden; }
    .hero { padding:30px 32px 24px; background:linear-gradient(180deg, rgba(242,186,36,0.12), rgba(16,16,21,0)); }
    .brandline { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .badge { width:46px; height:46px; display:flex; align-items:center; justify-content:center; }
    .brand { font-size:24px; font-weight:700; color:#ffffff; }
    .sub { font-size:11px; color:#a9a08f; text-transform:uppercase; letter-spacing:0.18em; margin-top:4px; }
    .eyebrow { color:#ffd86c; font-size:12px; text-transform:uppercase; letter-spacing:0.16em; margin:0 0 12px; }
    h1 { margin:0 0 14px; font-size:30px; line-height:1.08; font-weight:700; color:#fdfcf8; }
    p { margin:0 0 14px; font-size:15px; line-height:1.7; color:#b7ae9e; }
    .body { padding:0 32px 28px; }
    .content-box { padding:20px; border-radius:16px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); margin:18px 0 24px; }
    .btn { display:inline-block; padding:14px 24px; border-radius:999px; text-decoration:none; background:linear-gradient(135deg, #f2ba24, #ff9b1a); color:#131316; font-weight:700; }
    .footer { padding:20px 32px 28px; border-top:1px solid rgba(255,255,255,0.06); color:#746d62; font-size:12px; line-height:1.6; }
    .meta { font-size:13px; color:#8c8475; }
    @media only screen and (max-width: 600px) {
      .hero, .body, .footer { padding-left:22px; padding-right:22px; }
      h1 { font-size:26px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="hero">
        <div class="brandline">
          <div class="badge">${renderLogoSvg()}</div>
          <div>
            <div class="brand">DevAI</div>
            <div class="sub">WORLDIFYAI</div>
          </div>
        </div>
        ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
        <h1>${title}</h1>
        <p>${intro}</p>
      </div>
      <div class="body">
        <div class="content-box">
          ${bodyHtml}
        </div>
        ${ctaBlock}
      </div>
      <div class="footer">
        <div>DevAI est un produit WorldifyAI, orienté intelligence artificielle, cybersécurité, développement logiciel et robotique.</div>
        ${footerNote ? `<div style="margin-top:8px;">${footerNote}</div>` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function getBrevoApiKey() {
  return String(process.env.BREVO_API_KEY || '').trim();
}

async function sendEmailThroughBrevo(mailOptions) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY non configurée.');
  }

  const from = parseMailbox(getFromAddress());
  const to = parseMailbox(mailOptions.to);
  const replyTo = mailOptions.replyTo ? parseMailbox(mailOptions.replyTo) : null;
  const payload = {
    sender: {
      email: from.email,
      ...(from.name ? { name: from.name } : {}),
    },
    to: [
      {
        email: to.email,
        ...(to.name ? { name: to.name } : {}),
      },
    ],
    subject: mailOptions.subject,
    htmlContent: mailOptions.html,
    textContent: mailOptions.text || stripHtml(mailOptions.html),
  };

  if (replyTo?.email) {
    payload.replyTo = {
      email: replyTo.email,
      ...(replyTo.name ? { name: replyTo.name } : {}),
    };
  }

  const response = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = `Brevo HTTP ${response.status}`;

    try {
      const data = JSON.parse(raw);
      message = data.message || data.code || message;
    } catch {
      if (raw) message = raw;
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
}

async function sendEmailThroughSmtp(mailOptions) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: getFromAddress(),
    ...mailOptions,
  });
}

async function sendEmail(mailOptions) {
  if (getBrevoApiKey()) {
    try {
      await sendEmailThroughBrevo(mailOptions);
      return;
    } catch (error) {
      console.error('[DevAI Email] Brevo HTTP error:', {
        status: error.status,
        message: error.message,
      });
      throw error;
    }
  }

  try {
    await sendEmailThroughSmtp(mailOptions);
  } catch (error) {
    console.error('[DevAI Email] SMTP error:', {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT || '587',
      secure: process.env.EMAIL_SECURE != null ? process.env.EMAIL_SECURE : undefined,
      code: error.code,
      message: error.message,
    });
    throw error;
  }
}

async function sendResetEmail({ to, firstname, resetUrl }) {
  await sendEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe DevAI',
    html: renderEmailLayout({
      eyebrow: 'Sécurité du compte',
      title: `Bonjour ${firstname},`,
      intro: 'Vous avez demandé la réinitialisation de votre mot de passe. Nous avons préparé un lien sécurisé pour continuer.',
      bodyHtml: `
        <p>Pour définir un nouveau mot de passe, cliquez sur le bouton ci-dessous.</p>
        <p class="meta">Ce lien est valable pendant 1 heure. Si vous n’êtes pas à l’origine de cette demande, vous pouvez simplement ignorer cet e-mail.</p>
      `,
      ctaLabel: 'Réinitialiser mon mot de passe',
      ctaUrl: resetUrl,
      footerNote: 'DevAI ne vous demandera jamais votre mot de passe par e-mail.',
    }),
  });
}

async function sendWelcomeEmail({ to, firstname, loginUrl }) {
  await sendEmail({
    to,
    subject: 'Bienvenue sur DevAI',
    html: renderEmailLayout({
      eyebrow: 'Bienvenue',
      title: `Bienvenue ${firstname},`,
      intro: 'Votre compte DevAI est prêt. Vous pouvez maintenant accéder à l’assistant et commencer vos échanges.',
      bodyHtml: `
        <p>DevAI a été conçu pour aider plus efficacement en programmation, en mathématiques et dans les flux IA modernes.</p>
        <p class="meta">Votre espace est prêt pour démarrer une nouvelle conversation.</p>
      `,
      ctaLabel: 'Ouvrir DevAI',
      ctaUrl: loginUrl,
      footerNote: 'Merci de faire confiance à WorldifyAI.',
    }),
  });
}

async function sendContactEmail({ name, email, subject, message }) {
  await sendEmail({
    to: getAdminInbox(),
    replyTo: email,
    subject: `[DevAI Contact] ${subject}`,
    html: renderEmailLayout({
      eyebrow: 'Nouveau message site web',
      title: 'Un visiteur a envoyé un message.',
      intro: 'Le formulaire de contact du site DevAI vient d’être utilisé.',
      bodyHtml: `
        <p><strong>Nom :</strong> ${escapeHtml(name)}</p>
        <p><strong>E-mail :</strong> ${escapeHtml(email)}</p>
        <p><strong>Sujet :</strong> ${escapeHtml(subject)}</p>
        <p><strong>Message :</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      `,
      footerNote: 'Vous pouvez répondre directement à cet e-mail pour joindre l’expéditeur.',
    }),
  });
}

async function sendNewsletterNotificationEmail({ email }) {
  await sendEmail({
    to: getAdminInbox(),
    subject: '[DevAI Newsletter] Nouvelle inscription',
    html: renderEmailLayout({
      eyebrow: 'Newsletter',
      title: 'Nouvelle inscription enregistrée.',
      intro: 'Un visiteur s’est inscrit pour recevoir les mises à jour de DevAI.',
      bodyHtml: `<p><strong>E-mail :</strong> ${escapeHtml(email)}</p>`,
      footerNote: 'Cette notification provient du site vitrine DevAI.',
    }),
  });
}

async function sendNewsletterSubscriberEmail({ email }) {
  await sendEmail({
    to: email,
    subject: 'Confirmation de votre inscription a la newsletter DevAI',
    html: renderEmailLayout({
      eyebrow: 'Newsletter DevAI',
      title: 'Inscription confirmee.',
      intro: 'Votre adresse e-mail a bien ete enregistree pour recevoir les mises a jour de DevAI.',
      bodyHtml: `
        <p>Merci de suivre l'evolution de DevAI et de l'ecosysteme WorldifyAI.</p>
        <p class="meta">Vous recevrez les prochaines annonces produit, evolutions importantes et nouvelles disponibilites.</p>
      `,
      ctaLabel: 'Ouvrir DevAI',
      ctaUrl: getFrontendUrl(),
      footerNote: 'Si vous n etes pas a l origine de cette inscription, vous pouvez ignorer cet e-mail.',
    }),
  });
}

async function sendPaymentRequestAdminEmail({
  requestId,
  userEmail,
  userName,
  planLabel,
  payerName,
  payerPhone,
  paymentReference,
  note,
}) {
  await sendEmail({
    to: getAdminInbox(),
    subject: `[DevAI Paiement] Nouvelle demande ${planLabel}`,
    html: renderEmailLayout({
      eyebrow: 'Paiement manuel',
      title: 'Nouvelle demande de validation',
      intro: 'Un utilisateur a soumis une preuve de paiement pour débloquer un plan.',
      bodyHtml: `
        <p><strong>Demande :</strong> ${escapeHtml(String(requestId))}</p>
        <p><strong>Utilisateur :</strong> ${escapeHtml(userName)}</p>
        <p><strong>E-mail :</strong> ${escapeHtml(userEmail)}</p>
        <p><strong>Plan :</strong> ${escapeHtml(planLabel)}</p>
        <p><strong>Payeur :</strong> ${escapeHtml(payerName)}</p>
        <p><strong>Téléphone :</strong> ${escapeHtml(payerPhone)}</p>
        <p><strong>Référence :</strong> ${escapeHtml(paymentReference || 'Non fournie')}</p>
        <p><strong>Note :</strong><br>${escapeHtml(note || 'Aucune').replace(/\n/g, '<br>')}</p>
      `,
      footerNote: 'La preuve de paiement est visible depuis la page admin DevAI.',
    }),
  });
}

async function sendPaymentRequestUserEmail({ to, firstname, planLabel }) {
  await sendEmail({
    to,
    subject: 'Demande de paiement reçue par DevAI',
    html: renderEmailLayout({
      eyebrow: 'Paiement en attente',
      title: `Bonjour ${firstname},`,
      intro: 'Votre demande de paiement a bien été reçue et sera vérifiée manuellement.',
      bodyHtml: `
        <p><strong>Plan demandé :</strong> ${escapeHtml(planLabel)}</p>
        <p class="meta">Dès validation, vos messages seront débloqués automatiquement sur votre compte.</p>
      `,
      footerNote: 'Conservez votre preuve de paiement jusqu à la validation.',
    }),
  });
}

async function sendPaymentApprovedEmail({ to, firstname, planLabel, usage }) {
  await sendEmail({
    to,
    subject: 'Paiement validé sur DevAI',
    html: renderEmailLayout({
      eyebrow: 'Paiement validé',
      title: `Bonne nouvelle ${firstname},`,
      intro: 'Votre paiement a été validé et votre plan est maintenant actif.',
      bodyHtml: `
        <p><strong>Plan activé :</strong> ${escapeHtml(planLabel)}</p>
        <p><strong>Crédits payants restants :</strong> ${escapeHtml(String(usage.totalPaidCreditsRemaining || 0))}</p>
        <p class="meta">Vous pouvez retourner sur DevAI et continuer vos conversations.</p>
      `,
      ctaLabel: 'Ouvrir DevAI',
      ctaUrl: `${getFrontendUrl()}/app.html`,
      footerNote: 'Merci de votre confiance.',
    }),
  });
}

async function sendPaymentRejectedEmail({ to, firstname, planLabel, adminNote }) {
  await sendEmail({
    to,
    subject: 'Paiement à vérifier sur DevAI',
    html: renderEmailLayout({
      eyebrow: 'Paiement rejeté',
      title: `Bonjour ${firstname},`,
      intro: 'Votre demande de paiement n a pas pu être validée en l état.',
      bodyHtml: `
        <p><strong>Plan concerné :</strong> ${escapeHtml(planLabel)}</p>
        <p><strong>Motif / note admin :</strong><br>${escapeHtml(adminNote || 'Veuillez soumettre une preuve plus claire.').replace(/\n/g, '<br>')}</p>
      `,
      ctaLabel: 'Soumettre une nouvelle preuve',
      ctaUrl: `${getFrontendUrl()}/payment.html`,
      footerNote: 'Vous pouvez refaire une demande avec une preuve plus complète.',
    }),
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendResetEmail,
  sendWelcomeEmail,
  sendContactEmail,
  sendNewsletterNotificationEmail,
  sendNewsletterSubscriberEmail,
  sendPaymentRequestAdminEmail,
  sendPaymentRequestUserEmail,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
};
