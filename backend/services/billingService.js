const FREE_MESSAGES_PER_WINDOW = 20;
const FREE_WINDOW_HOURS = 5;
const MINUTE_LIMIT = 5;
const MESSAGE_MAX_LENGTH = 1500;

const PAYMENT_PLANS = {
  pack_100: {
    code: 'pack_100',
    label: '1$ / 650 FCFA — 100 messages',
    amountUsd: 1,
    amountFcfa: 650,
    credits: 100,
    isSubscription: false,
  },
  pack_300: {
    code: 'pack_300',
    label: '2$ / 1300 FCFA — 300 messages',
    amountUsd: 2,
    amountFcfa: 1300,
    credits: 300,
    isSubscription: false,
  },
  pack_1000: {
    code: 'pack_1000',
    label: '5$ / 3250 FCFA — 1000 messages',
    amountUsd: 5,
    amountFcfa: 3250,
    credits: 1000,
    isSubscription: false,
  },
  sub_500: {
    code: 'sub_500',
    label: '3$ / mois — 500 messages',
    amountUsd: 3,
    amountFcfa: 1950,
    credits: 500,
    isSubscription: true,
  },
  sub_1500: {
    code: 'sub_1500',
    label: '5$ / mois — 1500 messages',
    amountUsd: 5,
    amountFcfa: 3250,
    credits: 1500,
    isSubscription: true,
  },
};

function ensureUsageShape(user) {
  user.usage = user.usage || {};
  if (!user.usage.freeMessagesPerWindow) user.usage.freeMessagesPerWindow = FREE_MESSAGES_PER_WINDOW;
  if (!user.usage.freeWindowHours) user.usage.freeWindowHours = FREE_WINDOW_HOURS;
  if (!user.usage.minuteLimit) user.usage.minuteLimit = MINUTE_LIMIT;
  if (!user.usage.freeWindowStartedAt) user.usage.freeWindowStartedAt = new Date();
  if (!user.usage.minuteWindowStartedAt) user.usage.minuteWindowStartedAt = new Date();
  if (typeof user.usage.freeMessagesUsedInWindow !== 'number') user.usage.freeMessagesUsedInWindow = 0;
  if (typeof user.usage.minuteMessagesUsed !== 'number') user.usage.minuteMessagesUsed = 0;
  if (typeof user.usage.packageCredits !== 'number') user.usage.packageCredits = 0;
  if (typeof user.usage.subscriptionCreditsRemaining !== 'number') user.usage.subscriptionCreditsRemaining = 0;
  if (!user.usage.subscriptionPlanCode) user.usage.subscriptionPlanCode = '';
}

function resetExpiredFreeWindow(user, now = new Date()) {
  ensureUsageShape(user);
  const startedAt = new Date(user.usage.freeWindowStartedAt || now);
  const diffMs = now.getTime() - startedAt.getTime();
  const maxMs = user.usage.freeWindowHours * 60 * 60 * 1000;

  if (diffMs >= maxMs) {
    user.usage.freeWindowStartedAt = now;
    user.usage.freeMessagesUsedInWindow = 0;
  }
}

function resetExpiredMinuteWindow(user, now = new Date()) {
  ensureUsageShape(user);
  const startedAt = new Date(user.usage.minuteWindowStartedAt || now);
  const diffMs = now.getTime() - startedAt.getTime();

  if (diffMs >= 60 * 1000) {
    user.usage.minuteWindowStartedAt = now;
    user.usage.minuteMessagesUsed = 0;
  }
}

function resetExpiredSubscription(user, now = new Date()) {
  ensureUsageShape(user);
  const expiresAt = user.usage.subscriptionExpiresAt ? new Date(user.usage.subscriptionExpiresAt) : null;

  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    user.usage.subscriptionPlanCode = '';
    user.usage.subscriptionCreditsRemaining = 0;
    user.usage.subscriptionStartedAt = null;
    user.usage.subscriptionExpiresAt = null;
  }
}

function refreshUsage(user, now = new Date()) {
  ensureUsageShape(user);
  resetExpiredFreeWindow(user, now);
  resetExpiredMinuteWindow(user, now);
  resetExpiredSubscription(user, now);
}

function getRemainingFreeMessages(user, now = new Date()) {
  refreshUsage(user, now);
  return Math.max(0, user.usage.freeMessagesPerWindow - user.usage.freeMessagesUsedInWindow);
}

function getRemainingPackageCredits(user, now = new Date()) {
  refreshUsage(user, now);
  return Math.max(0, user.usage.packageCredits || 0);
}

function getRemainingSubscriptionCredits(user, now = new Date()) {
  refreshUsage(user, now);
  return Math.max(0, user.usage.subscriptionCreditsRemaining || 0);
}

function buildUsageSnapshot(user, now = new Date()) {
  refreshUsage(user, now);
  const freeRemaining = getRemainingFreeMessages(user, now);
  const subscriptionRemaining = getRemainingSubscriptionCredits(user, now);
  const packageRemaining = getRemainingPackageCredits(user, now);
  const freeWindowResetAt = new Date(new Date(user.usage.freeWindowStartedAt).getTime() + (user.usage.freeWindowHours * 60 * 60 * 1000));
  const minuteResetAt = new Date(new Date(user.usage.minuteWindowStartedAt).getTime() + 60 * 1000);

  return {
    freeMessagesRemaining: freeRemaining,
    freeMessagesPerWindow: user.usage.freeMessagesPerWindow,
    freeWindowHours: user.usage.freeWindowHours,
    freeWindowResetAt,
    minuteMessagesRemaining: Math.max(0, user.usage.minuteLimit - user.usage.minuteMessagesUsed),
    minuteLimit: user.usage.minuteLimit,
    minuteResetAt,
    packageCreditsRemaining: packageRemaining,
    subscription: user.usage.subscriptionPlanCode ? {
      planCode: user.usage.subscriptionPlanCode,
      creditsRemaining: subscriptionRemaining,
      expiresAt: user.usage.subscriptionExpiresAt,
    } : null,
    totalPaidCreditsRemaining: subscriptionRemaining + packageRemaining,
    blocked: freeRemaining <= 0 && subscriptionRemaining <= 0 && packageRemaining <= 0,
  };
}

function normalizeOutgoingMessage(message) {
  const trimmed = String(message || '').trim();
  const wasTrimmed = trimmed.length > MESSAGE_MAX_LENGTH;
  return {
    text: wasTrimmed ? `${trimmed.slice(0, MESSAGE_MAX_LENGTH - 1)}…` : trimmed,
    wasTrimmed,
    maxLength: MESSAGE_MAX_LENGTH,
  };
}

function enforceUserCanSendMessage(user, now = new Date()) {
  refreshUsage(user, now);
  const usage = buildUsageSnapshot(user, now);

  if (user.usage.minuteMessagesUsed >= user.usage.minuteLimit) {
    const error = new Error(`Limite atteinte: ${user.usage.minuteLimit} messages par minute maximum.`);
    error.status = 429;
    error.usage = usage;
    throw error;
  }

  if (usage.blocked) {
    const error = new Error('Vos messages gratuits sont épuisés. Attendez la réinitialisation ou activez un plan.');
    error.status = 402;
    error.usage = usage;
    throw error;
  }

  return usage;
}

function consumeOneMessage(user, now = new Date()) {
  refreshUsage(user, now);
  user.usage.minuteMessagesUsed += 1;

  if (getRemainingFreeMessages(user, now) > 0) {
    user.usage.freeMessagesUsedInWindow += 1;
    return { source: 'free', usage: buildUsageSnapshot(user, now) };
  }

  if (getRemainingSubscriptionCredits(user, now) > 0) {
    user.usage.subscriptionCreditsRemaining -= 1;
    return { source: 'subscription', usage: buildUsageSnapshot(user, now) };
  }

  if (getRemainingPackageCredits(user, now) > 0) {
    user.usage.packageCredits -= 1;
    return { source: 'package', usage: buildUsageSnapshot(user, now) };
  }

  const error = new Error('Aucun crédit disponible pour envoyer ce message.');
  error.status = 402;
  error.usage = buildUsageSnapshot(user, now);
  throw error;
}

function getPaymentPlan(planCode) {
  return PAYMENT_PLANS[planCode] || null;
}

function listPaymentPlans() {
  return Object.values(PAYMENT_PLANS);
}

function applyApprovedPlan(user, planCode, now = new Date()) {
  const plan = getPaymentPlan(planCode);
  if (!plan) {
    const error = new Error('Plan de paiement inconnu.');
    error.status = 400;
    throw error;
  }

  refreshUsage(user, now);

  if (plan.isSubscription) {
    user.usage.subscriptionPlanCode = plan.code;
    user.usage.subscriptionCreditsRemaining = plan.credits;
    user.usage.subscriptionStartedAt = now;
    user.usage.subscriptionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else {
    user.usage.packageCredits += plan.credits;
  }

  user.usage.lastPaymentApprovedAt = now;
  return plan;
}

module.exports = {
  FREE_MESSAGES_PER_WINDOW,
  FREE_WINDOW_HOURS,
  MINUTE_LIMIT,
  MESSAGE_MAX_LENGTH,
  ensureUsageShape,
  refreshUsage,
  buildUsageSnapshot,
  normalizeOutgoingMessage,
  enforceUserCanSendMessage,
  consumeOneMessage,
  listPaymentPlans,
  getPaymentPlan,
  applyApprovedPlan,
};
