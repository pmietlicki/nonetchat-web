import express from 'express';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import { Reader } from '@maxmind/geoip2-node';
import Quadtree from '@timohausmann/quadtree-js';
import cors from 'cors';

let geoipReader = null;
// Initialisation asynchrone, sans bloquer le serveur
(async () => {
  if (process.env.GEOIP_DB) {
    try {
      geoipReader = await Reader.open(process.env.GEOIP_DB);
      console.log('GeoIP DB loaded');
    } catch (e) {
      console.warn('GeoIP DB failed to load:', e.message);
    }
  }
})();

const wss = new WebSocketServer({ port: 3001 });
const clients = new Map();

// Initialise le Quadtree pour couvrir le monde entier en coordonnées lat/lon
const geoTree = new Quadtree({
  x: -180, // longitude min
  y: -90,  // latitude min
  width: 360, // 180 - (-180)
  height: 180 // 90 - (-90)
});

// === HTTP API (Express) pour credentials TURN ===
const app = express();
app.set('trust proxy', true);

// --- Configuration CORS robuste ---
const whitelist = ['https://web.nonetchat.com', 'https://nonetchat.com'];
if (process.env.NODE_ENV !== 'production') {
  // Autoriser localhost pour le développement
  whitelist.push('http://localhost:5173');
  whitelist.push('http://127.0.0.1:5173');
}

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Gérer les requêtes pre-flight


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

  res.json({
    username,
    credential,
    ttl,
    realm: TURN_REALM,
    iceServers: [
      { urls: `stun:${TURN_HOST}:3478` },
      { urls: `turn:${TURN_HOST}:3478?transport=udp`, username, credential },
      { urls: `turn:${TURN_HOST}:3478?transport=tcp`, username, credential },
      { urls: `turns:${TURN_HOST}:5349?transport=tcp`, username, credential },
    ],
  });
});

app.get('/api/geoip', async (req, res) => {
  try {
    if (!geoipReader) return res.status(503).json({ error: 'GeoIP disabled' });
    const ip =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      (req.headers['x-forwarded-for']?.split(',')[0].trim()) ||
      req.socket.remoteAddress;
    const resp = await geoipReader.city(ip);
    const { latitude, longitude, accuracy_radius } = resp.location || {};
    if (latitude == null || longitude == null) return res.status(404).json({ error: 'No location' });
    res.json({
      latitude, longitude,
      accuracyKm: accuracy_radius || 25
    });
  } catch (e) {
    res.status(500).json({ error: 'GeoIP error' });
  }
});


console.log('Robust Geo-Signaling Server with Quadtree is running on ws://localhost:3001');

const HEARTBEAT_INTERVAL = 30000;
const MAX_LOCATION_AGE_MS = 30 * 60 * 1000; // 30 minutes

// --- Fonctions de gestion du Quadtree ---
function rebuildGeoTree() {
  geoTree.clear();
  clients.forEach((client, clientId) => {
    if (client.location && client.discoveryMode === 'geo') {
      geoTree.insert({
        x: client.location.longitude,
        y: client.location.latitude,
        width: 0, // Les points n'ont pas de dimension
        height: 0,
        clientId: clientId
      });
    }
  });
}

const heartbeatInterval = setInterval(() => {
  clients.forEach((client, clientId) => {
    if (client.isAlive === false) {
      console.log(`Client ${clientId} failed heartbeat, terminating connection`);
      client.ws.terminate();
      return;
    }
    client.isAlive = false;
    client.ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// --- Helper Functions ---
function getDistance(coords1, coords2) {
  if (!coords1 || !coords2) return Infinity;
  const R = 6371; // Rayon de la Terre en km
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
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

// --- Logique de découverte optimisée avec Quadtree ---
function broadcastPeerUpdates() {
  clients.forEach((client, clientId) => {
    const nearbyPeers = new Set();
    const nearbyPeerIds = new Set(); // Pour éviter les doublons

    // 1. Découverte LAN (même IP)
    clients.forEach((otherClient, otherClientId) => {
      if (clientId !== otherClientId && client.ip === otherClient.ip) {
        if (nearbyPeerIds.has(otherClientId)) return;
        nearbyPeers.add({ peerId: otherClientId, distance: 'LAN' });
        nearbyPeerIds.add(otherClientId);
      }
    });

    // 2. Découverte Géographique (Quadtree)
    if (client.discoveryMode === 'geo' && client.location) {
      const now = Date.now();
      if (now - client.location.timestamp > MAX_LOCATION_AGE_MS) return;

      const searchRadiusKm = client.radius + (client.location.accuracyMeters || 0) / 1000;
      const latDeg = searchRadiusKm / 111.0;
      const lonDeg = searchRadiusKm / (111.0 * Math.cos(client.location.latitude * (Math.PI / 180)));

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
        if (!otherClient || !otherClient.location || now - otherClient.location.timestamp > MAX_LOCATION_AGE_MS) continue;

        const distance = getDistance(client.location, otherClient.location);
        const accAkm = (client.location.accuracyMeters || 0) / 1000;
        const accBkm = (otherClient.location.accuracyMeters || 0) / 1000;
        const threshold = Math.min(client.radius, otherClient.radius) + accAkm + accBkm;

        if (distance <= threshold) {
          nearbyPeers.add({ peerId: candidate.clientId, distance: distance.toFixed(2) + ' km' });
          nearbyPeerIds.add(candidate.clientId);
        }
      }
    }

    sendTo(client.ws, { type: 'nearby-peers', peers: Array.from(nearbyPeers) });
  });
}

// --- WebSocket Server Logic ---
wss.on('connection', (ws, req) => {
  let clientId = null;

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch {
      ws.close();
      return;
    }

    const { type, payload } = parsedMessage;

    if (type === 'register') {
      clientId = payload.id;
      const ip =
        req.headers['cf-connecting-ip'] ||
        req.headers['x-real-ip'] ||
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.socket.remoteAddress;

      clients.set(clientId, { ws, ip, isAlive: true, radius: 1.0, location: null, discoveryMode: 'geo' });
      console.log(`Client ${clientId} registered from IP ${ip}. Total clients: ${clients.size}`);
      broadcastPeerUpdates();
      return;
    }

    if (!clientId || !clients.has(clientId)) {
      ws.close();
      return;
    }

    const clientData = clients.get(clientId);

    switch (type) {
      case 'update-location':
        clientData.location = {
          ...payload.location,
          timestamp: payload?.location?.timestamp || Date.now(),
          accuracyMeters: payload?.location?.accuracyMeters ?? null,
          method: payload?.location?.method || 'gps'
        };
        clientData.radius = payload.radius || clientData.radius;
        clientData.discoveryMode = 'geo';
        rebuildGeoTree();
        broadcastPeerUpdates();
        break;

      case 'request-lan-discovery':
        clientData.discoveryMode = 'lan';
        rebuildGeoTree();
        broadcastPeerUpdates();
        break;

      case 'heartbeat':
        clientData.isAlive = true;
        break;

      case 'offer':
      case 'answer':
      case 'candidate': {
        const { to, from } = payload;
        const recipient = clients.get(to);
        if (recipient) sendTo(recipient.ws, { type, from, payload: payload.payload });
        break;
      }

      default:
        console.warn(`Unknown message type from ${clientId}: ${type}`);
    }
  });

  ws.on('close', () => {
    if (clientId) {
      clients.delete(clientId);
      rebuildGeoTree();
      console.log(`Client ${clientId} disconnected. Total clients: ${clients.size}`);
      broadcastPeerUpdates();
    }
  });

  ws.on('error', (error) => {
    console.error(`Error with client ${clientId || 'unregistered'}:`, error);
  });

  ws.on('pong', () => {
    if (clientId && clients.has(clientId)) {
      clients.get(clientId).isAlive = true;
    }
  });
});

const HTTP_PORT = process.env.PORT || 3000;
app.listen(HTTP_PORT, () => {
  console.log(`HTTP API listening on http://localhost:${HTTP_PORT}`);
});
