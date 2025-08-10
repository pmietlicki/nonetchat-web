import express from 'express';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 3001 });
const clients = new Map();

// === HTTP API (Express) pour credentials TURN ===
const app = express();
app.set('trust proxy', true);

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

console.log('Robust Geo-Signaling Server is running on ws://localhost:3001');

// Heartbeat interval to keep connections alive
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const heartbeatInterval = setInterval(() => {
  clients.forEach((client, clientId) => {
    if (client.isAlive === false) {
      console.log(`Client ${clientId} failed heartbeat, terminating connection`);
      client.ws.terminate();
      clients.delete(clientId);
      broadcastPeerUpdates();
      return;
    }
    client.isAlive = false;
    client.ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// --- Helper Functions ---
function getDistance(coords1, coords2) {
  if (!coords1 || !coords2) return Infinity;
  const R = 6371;
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

function broadcastPeerUpdates() {
  clients.forEach((client, clientId) => {
    const nearbyPeers = [];
    clients.forEach((otherClient, otherClientId) => {
      if (clientId === otherClientId) return;

      let isNearby = false;
      let distanceInfo = {};

      // Priority 1: "même NAT" (IP publique identique)
      if (client.ip === otherClient.ip) {
        isNearby = true;
        distanceInfo = { distance: 'LAN' };
      } else if (client.discoveryMode === 'geo' && otherClient.discoveryMode === 'geo') {
        const distance = getDistance(client.location, otherClient.location);
        if (distance < client.radius && distance < otherClient.radius) {
          isNearby = true;
          distanceInfo = { distance: distance.toFixed(2) + ' km' };
        }
      }

      if (isNearby) nearbyPeers.push({ peerId: otherClientId, ...distanceInfo });
    });
    sendTo(client.ws, { type: 'nearby-peers', peers: nearbyPeers });
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
        clientData.location = payload.location;
        clientData.radius = payload.radius || clientData.radius;
        clientData.discoveryMode = 'geo';
        broadcastPeerUpdates();
        break;

      case 'request-lan-discovery':
        clientData.discoveryMode = 'lan';
        broadcastPeerUpdates();
        break;

      case 'heartbeat':
        // noop: le ping/pong TCP fait foi
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

  ws.isAlive = true;
  ws.on('ping', () => ws.pong());
});

const HTTP_PORT = process.env.PORT || 3000;
app.listen(HTTP_PORT, () => {
  console.log(`HTTP API listening on http://localhost:${HTTP_PORT}`);
});
