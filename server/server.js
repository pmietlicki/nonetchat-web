import express from 'express';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Reader } from '@maxmind/geoip2-node';
import Quadtree from '@timohausmann/quadtree-js';
import cors from 'cors';
import dotenv from 'dotenv';
import webpush from 'web-push';

// --- Config ---
dotenv.config();

function pravatarUrl(id, version = 1, size = 192) {
  const seed = encodeURIComponent(`${id}:${version}`);
  return `https://i.pravatar.cc/${size}?u=${seed}`;
}


// -------------------------------------------------------------
// Utils IP & sécurité
// -------------------------------------------------------------
function headerToStr(h) {
  return Array.isArray(h) ? h[0] : (h || '');
}
function firstForwardedFor(h) {
  const s = headerToStr(h);
  return s ? s.split(',')[0]?.trim() : '';
}
function normalizeIp(ip) {
  if (!ip) return ip;
  // IPv4-mapped IPv6
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

// -------------------------------------------------------------
// GeoIP async init (non bloquant)
// -------------------------------------------------------------
let geoipReader = null;
(async () => {
  if (process.env.GEOIP_DB) {
    try {
      geoipReader = await Reader.open(process.env.GEOIP_DB);
      console.log('[GeoIP] DB loaded');
    } catch (e) {
      console.warn('[GeoIP] DB failed to load:', e?.message || e);
    }
  } else {
    console.log('[GeoIP] GEOIP_DB not set => GeoIP disabled');
  }
})();

// -------------------------------------------------------------
// Push Notifications (VAPID)
// -------------------------------------------------------------
const PUSH_ENABLED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUB || 'mailto:contact@nonetchat.com', // contact recommandé
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('[Push] VAPID keys configured.');
} else {
  console.warn('[Push] VAPID keys not found in .env. Push notifications disabled.');
}

// En production, utilisez une base de données persistante (Redis/PostgreSQL)
const pushSubscriptions = new Map(); // Map<userId, Set<subscription>>

function addSubscription(userId, subscription) {
  let set = pushSubscriptions.get(userId);
  if (!set) { set = new Set(); pushSubscriptions.set(userId, set); }
  // Dédup par endpoint
  for (const s of set) { if (s.endpoint === subscription.endpoint) return; }
  set.add(subscription);
}

async function sendPushToUser(userId, payloadObj, options = { TTL: 60 }) {
  if (!PUSH_ENABLED) return;
  const set = pushSubscriptions.get(userId);
  if (!set || set.size === 0) return;

  const payload = JSON.stringify(payloadObj);
  const toDelete = [];

  await Promise.all([...set].map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload, options);
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        // Abonnement expiré/supprimé -> on le retire
        toDelete.push(sub);
      } else {
        console.error('[Push] Error sending', code, err?.body || err?.message);
      }
    }
  }));

  if (toDelete.length) {
    toDelete.forEach(s => set.delete(s));
    if (set.size === 0) pushSubscriptions.delete(userId);
  }
}

// -------------------------------------------------------------
// WebSocket Signaling
// -------------------------------------------------------------
const wss = new WebSocketServer({ port: 3001 });
const clients = new Map(); // Map<clientId, {ws, ip, isAlive, radius, location, discoveryMode, profile?}>

// Quadtree couvrant le globe entier (en degrés lat/lon)
const geoTree = new Quadtree({
  x: -180, // lon min
  y: -90,  // lat min
  width: 360,
  height: 180
});
const EPS = 1e-6; // epsilon pour les AABB du quadtree

// -------------------------------------------------------------
// HTTP API (Express) pour credentials TURN + GeoIP + Push
// -------------------------------------------------------------
const app = express();
app.set('trust proxy', true);

// CORS strict avec whitelist
const whitelist = ['https://web.nonetchat.com', 'https://nonetchat.com'];
if (process.env.NODE_ENV !== 'production') {
  whitelist.push('http://localhost:5173', 'http://127.0.0.1:5173');
}
const corsOptions = {
  origin(origin, callback) {
    const allowNoOrigin = process.env.NODE_ENV !== 'production';
    if ((allowNoOrigin && !origin) || whitelist.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json()); // Middleware JSON

const {
  TURN_STATIC_SECRET,
  TURN_HOST = 'turn.nonetchat.com',
  TURN_REALM = 'turn.nonetchat.com',
  TURN_TTL_SECONDS = '3600',
} = process.env;

function hmacBase64(secret, msg) {
  return crypto.createHmac('sha1', secret).update(msg).digest('base64');
}

app.get('/api/turn-credentials', (req, res) => {
  if (!TURN_STATIC_SECRET) {
    return res.status(500).json({ error: 'TURN_STATIC_SECRET manquant côté serveur' });
  }
  const userId = (req.query.userId || 'anon').toString();
  const ttl = parseInt(TURN_TTL_SECONDS, 10) || 3600;
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId}`;
  const credential = hmacBase64(TURN_STATIC_SECRET, username);

  const iceServers = [
    { urls: `stun:${TURN_HOST}:3478` },
    { urls: `stun:${TURN_HOST}:5349` },
    { urls: `turn:${TURN_HOST}:3478?transport=udp`, username, credential },
    { urls: `turn:${TURN_HOST}:3478?transport=tcp`, username, credential },
    { urls: `turns:${TURN_HOST}:5349?transport=tcp`, username, credential },
  ];

  res.json({ username, credential, ttl, realm: TURN_REALM, iceServers });
});

app.get('/api/geoip', async (req, res) => {
  if (!geoipReader) return res.status(503).json({ error: 'GeoIP disabled' });

  const ip = normalizeIp(
    headerToStr(req.headers['cf-connecting-ip']) ||
    headerToStr(req.headers['x-real-ip']) ||
    firstForwardedFor(req.headers['x-forwarded-for']) ||
    req.socket.remoteAddress
  );

  try {
    const resp = await geoipReader.city(ip);
    const { latitude, longitude, accuracy_radius } = resp.location || {};
    const countryIso = resp?.country?.isoCode || resp?.registeredCountry?.isoCode || null;
    // On prend un nom lisible si dispo, sinon l’ISO
    const countryName =
    resp?.country?.names?.fr || resp?.country?.names?.en ||
    resp?.registeredCountry?.names?.fr || resp?.registeredCountry?.names?.en ||
    countryIso || null;
    if (latitude == null || longitude == null) {
      return res.status(404).json({ error: 'No location' });
    }
    res.json({
      latitude,
      longitude,
      accuracyKm: accuracy_radius ?? 25,
      countryIso,
      countryName,
    });
  } catch {
    return res.status(204).end();
  }
});

// Endpoint pour sauvegarder un abonnement push (multi-device)
app.post('/api/save-subscription', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) {
    return res.status(400).json({ error: 'Missing userId or subscription' });
  }
  addSubscription(userId, subscription);
  const total = pushSubscriptions.get(userId)?.size || 0;
  console.log(`[Push] Subscription saved for ${userId} (devices: ${total})`);
  res.status(201).json({ success: true });
});

// -------------------------------------------------------------
// Logs d’écoute
// -------------------------------------------------------------
console.log('Robust Geo-Signaling Server with Quadtree is listening:');
console.log('- WS on port 3001');
console.log(`- HTTP API on http://localhost:${process.env.PORT || 3000}`);

// -------------------------------------------------------------
// Heartbeat / Liveness
// -------------------------------------------------------------
const HEARTBEAT_INTERVAL = 30_000; // 30s
const MAX_LOCATION_AGE_MS = 30 * 60 * 1000; // 30 minutes

const heartbeatInterval = setInterval(() => {
  clients.forEach((client, clientId) => {
    if (client.isAlive === false) {
      console.log(`[HB] Client ${clientId} failed heartbeat -> terminate & cleanup`);
      try {
        client.ws.terminate();
      } finally {
        clients.delete(clientId);
        rebuildGeoTree();
        broadcastPeerUpdates();
      }
      return;
    }
    client.isAlive = false;
    try { client.ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL);

// -------------------------------------------------------------
// Helpers Geo & envoi
// -------------------------------------------------------------
function getDistance(coords1, coords2) {
  if (!coords1 || !coords2) return Infinity;
  const R = 6371; // km
  const dLat = (coords2.latitude - coords1.latitude) * (Math.PI / 180);
  const dLon = (coords2.longitude - coords1.longitude) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(coords1.latitude * (Math.PI / 180)) *
      Math.cos(coords2.latitude * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function rebuildGeoTree() {
  geoTree.clear();
  clients.forEach((client, clientId) => {
    if (client.location && client.discoveryMode === 'geo') {
      geoTree.insert({
        x: client.location.longitude,
        y: client.location.latitude,
        width: EPS,
        height: EPS,
        clientId: clientId
      });
    }
  });
}

// -------------------------------------------------------------
// Diffusion des mises à jour de pairs
// -------------------------------------------------------------
function broadcastPeerUpdates() {
  const now = Date.now();

  clients.forEach((client, clientId) => {
    const nearbyPeers = new Set();
    const nearbyPeerIds = new Set();

    // Découverte LAN (IP publique identique)
    clients.forEach((otherClient, otherClientId) => {
      if (clientId === otherClientId) return;
      if (client.ip && client.ip === otherClient.ip) {
        if (!nearbyPeerIds.has(otherClientId)) {
          nearbyPeers.add({ peerId: otherClientId, distance: 'LAN' });
          nearbyPeerIds.add(otherClientId);
        }
      }
    });

    // Découverte Géographique (Quadtree)
    if (client.discoveryMode === 'geo' && client.location) {
      if (now - client.location.timestamp <= MAX_LOCATION_AGE_MS) {
        const searchRadiusKm = (typeof client.radius === 'number' ? client.radius : 1.0)
          + ((client.location.accuracyMeters || 0) / 1000);

        const latDeg = searchRadiusKm / 111.0;
        const cosLat = Math.max(Math.cos(client.location.latitude * Math.PI / 180), 0.01); // évite div/0
        const lonDeg = searchRadiusKm / (111.0 * cosLat);

        const searchBounds = {
          x: client.location.longitude - lonDeg,
          y: client.location.latitude - latDeg,
          width: lonDeg * 2,
          height: latDeg * 2
        };

        const candidates = geoTree.retrieve(searchBounds);

        for (const candidate of candidates) {
          if (candidate.clientId === clientId || nearbyPeerIds.has(candidate.clientId)) continue;

          const otherClient = clients.get(candidate.clientId);
          if (!otherClient || !otherClient.location) continue;
          if (now - otherClient.location.timestamp > MAX_LOCATION_AGE_MS) continue;

          const distance = getDistance(client.location, otherClient.location);
          const accAkm = (client.location.accuracyMeters || 0) / 1000;
          const accBkm = (otherClient.location.accuracyMeters || 0) / 1000;
          const threshold = Math.min(client.radius || 1.0, otherClient.radius || 1.0) + accAkm + accBkm;

          if (distance <= threshold) {
            nearbyPeers.add({ peerId: candidate.clientId, distance: `${distance.toFixed(2)} km` });
            nearbyPeerIds.add(candidate.clientId);
          }
        }
      }
    }

    sendTo(client.ws, { type: 'nearby-peers', peers: Array.from(nearbyPeers) });
  });
}

// -------------------------------------------------------------
// WebSocket Server Logic
// -------------------------------------------------------------
wss.on('connection', (ws, req) => {
  let clientId = null;

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      const text = typeof message === 'string' ? message : message.toString('utf8');
      parsedMessage = JSON.parse(text);
    } catch {
      ws.close();
      return;
    }

    const { type, payload } = parsedMessage;

    if (type === 'register') {
  clientId = payload.id;
  const ip = normalizeIp(
    headerToStr(req.headers['cf-connecting-ip']) ||
    headerToStr(req.headers['x-real-ip']) ||
    firstForwardedFor(req.headers['x-forwarded-for']) ||
    req.socket.remoteAddress
  );

  const avatarVersion = Number(payload?.profile?.avatarVersion) || 1;

  clients.set(clientId, {
    ws,
    ip,
    isAlive: true,
    radius: 1.0,
    location: null,
    discoveryMode: 'geo',
    profile: {
      name: payload?.profile?.name || payload?.profile?.displayName || 'Utilisateur',
      avatarVersion,
      // si le client ne fournit pas d’avatar custom, fallback pravatar seedé
      avatar: payload?.profile?.avatar || pravatarUrl(clientId, avatarVersion, 192)
    }
  });

  console.log(`[WS] Client ${clientId} registered from IP ${ip}. Total: ${clients.size}`);
  rebuildGeoTree();
  broadcastPeerUpdates();
  return;
}

    if (!clientId || !clients.has(clientId)) {
      ws.close();
      return;
    }

    const clientData = clients.get(clientId);

    switch (type) {
      case 'update-location': {
        const loc = payload?.location;
        if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') break;
        clientData.location = {
          latitude: loc.latitude,
          longitude: loc.longitude,
          timestamp: loc.timestamp ?? Date.now(),
          accuracyMeters: loc.accuracyMeters ?? null,
          method: loc.method || 'gps'
        };
        if (typeof payload.radius === 'number') clientData.radius = payload.radius;
        clientData.discoveryMode = 'geo';
        rebuildGeoTree();
        broadcastPeerUpdates();
        break;
      }

      case 'request-lan-discovery':
        clientData.discoveryMode = 'lan';
        rebuildGeoTree();
        broadcastPeerUpdates();
        break;

      case 'heartbeat':
        clientData.isAlive = true;
        break;

      // ---- Messages applicatifs (optionnel, utile si store-and-forward) ----
      case 'chat-message': {
  const { to, from, text, convId, senderName, senderAvatar } = payload || {};
  const recipient = to ? clients.get(to) : null;
  if (recipient) {
    sendTo(recipient.ws, { type, from, payload: { text, convId } });
  } else {
    const fromClient = clients.get(from);
    const name = senderName || fromClient?.profile?.name || 'Message entrant';
    const avatar = senderAvatar
      || fromClient?.profile?.avatar
      || pravatarUrl(from, fromClient?.profile?.avatarVersion || 1, 192);

    sendPushToUser(to, {
      type: 'message',
      title: name,
      body: typeof text === 'string' ? String(text).slice(0, 120) : 'Nouveau message',
      tag: convId || from,
      convId: convId || from,
      senderAvatar: avatar,
      from
    }, { TTL: 60 });
  }
  break;
}


      // ---- Signalisation WebRTC (réveil si offline) ----
      case 'offer':
case 'answer':
case 'candidate': {
  const { to, from } = payload || {};
  const recipient = to ? clients.get(to) : null;
  if (recipient) {
    sendTo(recipient.ws, { type, from, payload: payload.payload });
  } else {
    const fromClient = clients.get(from);
    const name = fromClient?.profile?.name || from;
    const avatar = fromClient?.profile?.avatar || pravatarUrl(from, fromClient?.profile?.avatarVersion || 1, 192);

    sendPushToUser(to, {
      type: 'webrtc',
      title: 'Connexion entrante',
      body: `Tentative de connexion de ${name}`,
      tag: from,
      convId: from,
      senderAvatar: avatar,
      from
    }, { TTL: 30 });
  }
  break;
}


     case 'server-profile-update': {
  const name = payload?.name;
  const version = payload?.avatarVersion;
  const avatarPatch = payload?.avatar; // peut être null/'' pour "clear"
  const rec = clients.get(clientId);
  if (rec) {
    if (name) rec.profile.name = name;

    if (typeof version === 'number' && Number.isFinite(version)) {
      rec.profile.avatarVersion = version;
    }

    if (avatarPatch === null || avatarPatch === '') {
      // client a supprimé son avatar custom -> on repasse au pravatar seedé
      rec.profile.avatar = pravatarUrl(clientId, rec.profile.avatarVersion || 1, 192);
    } else if (typeof avatarPatch === 'string') {
      // client pose un avatar custom explicite
      rec.profile.avatar = avatarPatch;
    } else if (!rec.profile.avatar || String(rec.profile.avatar).includes('i.pravatar.cc')) {
      // si on n'avait que le pravatar, on le recalcule à la nouvelle version
      rec.profile.avatar = pravatarUrl(clientId, rec.profile.avatarVersion || 1, 192);
    }
  }
  break;
}



      default:
        console.warn(`[WS] Unknown message type from ${clientId}: ${type}`);
    }
  });

  ws.on('close', () => {
    if (clientId) {
      clients.delete(clientId);
      rebuildGeoTree();
      console.log(`[WS] Client ${clientId} disconnected. Total: ${clients.size}`);
      broadcastPeerUpdates();
    }
  });

  ws.on('error', (error) => {
    console.error(`[WS] Error with client ${clientId || 'unregistered'}:`, error);
  });

  ws.on('pong', () => {
    if (clientId && clients.has(clientId)) {
      clients.get(clientId).isAlive = true;
    }
  });
});

// -------------------------------------------------------------
// HTTP server
// -------------------------------------------------------------
const HTTP_PORT = process.env.PORT || 3000;
const httpServer = app.listen(HTTP_PORT, () => {
  console.log(`HTTP API listening on http://localhost:${HTTP_PORT}`);
});

// -------------------------------------------------------------
// Shutdown propre
// -------------------------------------------------------------
function shutdown(signal) {
  console.log(`[SYS] Received ${signal}, shutting down...`);
  clearInterval(heartbeatInterval);
  try { httpServer.close(); } catch {}
  try { wss.close(); } catch {}
  try { geoipReader?.close?.(); } catch {}
  // Terminer les sockets
  clients.forEach((c) => { try { c.ws.terminate(); } catch {} });
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
