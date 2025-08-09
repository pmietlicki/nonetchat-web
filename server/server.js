
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 3001 });
const clients = new Map();

console.log('Robust Geo-Signaling Server is running on ws://localhost:3001');

// --- Helper Functions ---

function getDistance(coords1, coords2) {
  if (!coords1 || !coords2) return Infinity;
  const R = 6371; // Radius of the Earth in km
  const dLat = (coords2.latitude - coords1.latitude) * (Math.PI / 180);
  const dLon = (coords2.longitude - coords1.longitude) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coords1.latitude * (Math.PI / 180)) * Math.cos(coords2.latitude * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function sendTo(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastPeerUpdates() {
  clients.forEach((client, clientId) => {
    const nearbyPeers = [];
    clients.forEach((otherClient, otherClientId) => {
      if (clientId === otherClientId) return;

      let isNearby = false;
      let distanceInfo = {};

      // Priority 1: LAN discovery
      if (client.ip === otherClient.ip) {
        isNearby = true;
        distanceInfo = { distance: 'LAN' };
      }
      // Priority 2: Geolocation discovery
      else if (client.discoveryMode === 'geo' && otherClient.discoveryMode === 'geo') {
        const distance = getDistance(client.location, otherClient.location);
        if (distance < client.radius && distance < otherClient.radius) {
          isNearby = true;
          distanceInfo = { distance: distance.toFixed(2) + ' km' };
        }
      }

      if (isNearby) {
        nearbyPeers.push({ peerId: otherClientId, ...distanceInfo });
      }
    });
    sendTo(client.ws, { type: 'nearby-peers', peers: nearbyPeers });
  });
}

// --- WebSocket Server Logic ---

wss.on('connection', (ws, req) => {
  let clientId = null; // Will be set upon registration

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      ws.close();
      return;
    }

    const { type, payload } = parsedMessage;

    if (type === 'register') {
      clientId = payload.id;
      const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      
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

      case 'offer':
      case 'answer':
      case 'candidate':
        const { to, from } = payload;
        const recipient = clients.get(to);
        if (recipient) {
          sendTo(recipient.ws, { type, from, payload: payload.payload });
        }
        break;

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
});
