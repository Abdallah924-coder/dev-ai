const CACHE_NAME = 'devai-static-v20260503';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app',
  '/app/',
  '/app/index.html',
  '/payment',
  '/payment/',
  '/payment/index.html',
  '/admin',
  '/admin/',
  '/admin/index.html',
  '/app.html',
  '/payment.html',
  '/admin.html',
  '/reset-password.html',
  '/landing.css?v=20260426',
  '/landing.js?v=20260503',
  '/style.css?v=20260501',
  '/app.js?v=20260503',
  '/payment.js?v=20260429',
  '/admin.js?v=20260429',
  '/devai-mark.svg?v=20260426',
  '/favicon.svg?v=20260426',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/reset-password' || url.pathname === '/reset-password/' || url.pathname === '/reset-password/index.html') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/app') || caches.match('/app/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SHOW_CHAT_REPLY_NOTIFICATION') return;

  const payload = event.data.payload || {};
  const title = String(payload.title || 'Reponse DevAI prete');
  const body = String(payload.body || 'Votre reponse est disponible dans DevAI.');

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: payload.icon || '/favicon.svg?v=20260426',
    badge: payload.badge || '/favicon.svg?v=20260426',
    tag: payload.tag || 'devai-reply',
    renotify: true,
    requireInteraction: false,
    data: {
      conversationId: payload.conversationId || '',
      url: payload.url || '/app',
      question: payload.question || '',
    },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const targetUrl = notificationData.url || '/app';
  const conversationId = notificationData.conversationId || '';

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      if (!client.url.startsWith(self.location.origin)) continue;

      await client.focus();
      if ('navigate' in client) {
        await client.navigate(targetUrl);
      }
      client.postMessage({
        type: 'OPEN_CONVERSATION_FROM_NOTIFICATION',
        conversationId,
      });
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
