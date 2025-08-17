// ---- IndexedDB helpers ----
function openDB() {
  return new Promise((resolve, reject) => {
    // ⚠️ Doit matcher la version de l’app (sinon onupgradeneeded non géré ici)
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

// ---- Push handler ----
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch {}

    const title = data.title || 'Nouveau message';
    const options = {
      body: data.body || '',
      icon: '/manifest-icon-192.png',     // fallback logo
      badge: '/manifest-icon-96.png',     // optionnel (Android)
      tag: data.tag || data.convId || 'nonetchat',
      data: {
        convId: data.convId || data.tag || null,
        from: data.from || null,
        // on garde tout le payload utile
        payload: data
      }
    };

    // 1) Avatar depuis le payload push si fourni
    let candidateIcon = data.senderAvatar;

    // 2) Sinon, essaye IndexedDB (clé = convId OU tag)
    if (!candidateIcon && (data.tag || data.convId)) {
      try {
        const db = await openDB();
        const convKey = data.convId || data.tag;
        const conversation = await getFromStore(db, 'conversations', convKey);
        db.close?.();
        if (conversation?.participantAvatar) {
          candidateIcon = conversation.participantAvatar;
        }
      } catch (e) {
        // On ne casse pas la notif si l’IDB échoue
        // console.warn('[SW] IndexedDB read failed:', e);
      }
    }

    // 3) On n’accepte que data: ou https: (éviter blob: en SW)
    if (typeof candidateIcon === 'string' &&
        (candidateIcon.startsWith('data:') || candidateIcon.startsWith('https://'))) {
      options.icon = candidateIcon;
    }

    return self.registration.showNotification(title, options);
  })());
});

// ---- Click handler ----
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const convId = event.notification?.data?.convId || null;
  const origin = self.location.origin; // ✅ au lieu de self.origin
  const url = convId ? `/?open=${encodeURIComponent(convId)}` : '/';

  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si une fenêtre de l’app existe, on la focus et on lui passe l’info
    for (const c of list) {
      if (c.url.startsWith(origin) && 'focus' in c) {
        c.postMessage({ type: 'FOCUS_CONVERSATION', convId });
        return c.focus();
      }
    }
    // Sinon on ouvre une nouvelle fenêtre sur la conversation
    return clients.openWindow(url);
  })());
});
