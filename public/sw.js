const CACHE_NAME = 'nonetchat-cache-v1';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Ajoutez ici les assets critiques de l'app shell (logo, CSS principal, etc.)
  // Exemple: '/logo.png', '/src/index.css'
];

// ---- Stratégie de cache: Network First, puis Cache ----
const networkFirst = async (request) => {
  try {
    // 1. Essayer de récupérer depuis le réseau
    const networkResponse = await fetch(request);
    // Si la requête réussit, on met en cache la nouvelle version
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // 2. Si le réseau échoue, essayer de récupérer depuis le cache
    const cachedResponse = await caches.match(request);
    return cachedResponse || Response.error(); // Échoue si non trouvé dans le cache
  }
};

// ---- INSTALL: Pré-caching de l'App Shell ----
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL_URLS);
    // console.log('[SW] App Shell pre-cached');
  })());
});

// ---- ACTIVATE: Nettoyage des anciens caches ----
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    // console.log('[SW] Caches cleaned');
  })());
});

// ---- FETCH: Interception des requêtes ----
self.addEventListener('fetch', event => {
  // On ne gère que les requêtes GET
  if (event.request.method !== 'GET') {
    return;
  }
  // On applique la stratégie "Network First"
  event.respondWith(networkFirst(event.request));
});


// ---- IndexedDB helpers (inchangé) ----
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('NoNetChatWeb', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
function getFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve(null);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || null);
  });
}

// ---- Push handler (inchangé) ----
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch {}

    const title = data.title || 'Nouveau message';
    const options = {
      body: data.body || '',
      icon: '/manifest-icon-192.png',
      badge: '/manifest-icon-96.png',
      tag: data.tag || data.convId || 'nonetchat',
      data: {
        convId: data.convId || data.tag || null,
        from: data.from || null,
        payload: data
      }
    };

    let candidateIcon = data.senderAvatar;
    if (!candidateIcon && (data.tag || data.convId)) {
      try {
        const db = await openDB();
        const convKey = data.convId || data.tag;
        const conversation = await getFromStore(db, 'conversations', convKey);
        db.close?.();
        if (conversation?.participantAvatar) {
          candidateIcon = conversation.participantAvatar;
        }
      } catch (e) {}
    }

    if (typeof candidateIcon === 'string' &&
        (candidateIcon.startsWith('data:') || candidateIcon.startsWith('https://'))) {
      options.icon = candidateIcon;
    }

    return self.registration.showNotification(title, options);
  })());
});

// ---- Click handler (inchangé) ----
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const convId = event.notification?.data?.convId || null;
  const origin = self.location.origin;
  const url = convId ? `/?open=${encodeURIComponent(convId)}` : '/';

  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(origin) && 'focus' in c) {
        c.postMessage({ type: 'FOCUS_CONVERSATION', convId });
        return c.focus();
      }
    }
    return clients.openWindow(url);
  })());
});