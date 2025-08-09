
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const wss = new WebSocketServer({ port: 3001 });
const clients = new Map();

console.log('Hybrid Geo/LAN Signaling Server is running on ws://localhost:3001');

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

      // Priority 1: Check for same Local Area Network (LAN)
      if (client.ip === otherClient.ip) {
        isNearby = true;
        distanceInfo = { distance: 'LAN' };
      }
      // Priority 2: Check for geolocation proximity (if not on same LAN)
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
  const clientId = uuidv4();
  // Use x-forwarded-for header if available (for proxies), otherwise fallback to remoteAddress
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  clients.set(clientId, { ws, ip, isAlive: true, radius: 1.0, location: null, discoveryMode: 'geo' });
  console.log(`Client ${clientId} connected from IP ${ip}`);

  sendTo(ws, { type: 'welcome', clientId });

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error(`Failed to parse message from ${clientId}:`, message);
      return;
    }

    const clientData = clients.get(clientId);
    if (!clientData) return;

    const { type, payload } = parsedMessage;

    switch (type) {
      case 'update-location':
        clientData.location = payload.location;
        clientData.radius = payload.radius || clientData.radius;
        clientData.discoveryMode = 'geo';
        console.log(`Client ${clientId} updated location:`, clientData.location, `radius: ${clientData.radius}km`);
        broadcastPeerUpdates();
        break;

      case 'request-lan-discovery':
        clientData.discoveryMode = 'lan';
        console.log(`Client ${clientId} switched to LAN discovery mode.`);
        broadcastPeerUpdates();
        break;

      case 'offer':
      case 'answer':
      case 'candidate':
        const { to, from } = payload;
        console.log(`Forwarding ${type} from ${from} to ${to}`);
        const recipient = clients.get(to);
        if (recipient) {
          sendTo(recipient.ws, { type, from, payload: payload.payload });
        }
        break;

      case 'pong':
        clientData.isAlive = true;
        break;

      default:
        console.warn(`Unknown message type from ${clientId}: ${type}`);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
    broadcastPeerUpdates();
  });

  ws.on('error', (error) => {
    console.error(`Error with client ${clientId}:`, error);
  });
});

// Heartbeat mechanism
const heartbeatInterval = setInterval(() => {
  clients.forEach((client, id) => {
    if (!client.isAlive) {
      client.ws.terminate();
      return;
    }
    client.isAlive = false;
    sendTo(client.ws, { type: 'ping' });
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});
