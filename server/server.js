
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const wss = new WebSocketServer({ port: 3001 });
const clients = new Map();

console.log('Geo-Signaling Server is running on ws://localhost:3001');

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

function broadcastNearbyPeers() {
  clients.forEach((client, clientId) => {
    const nearbyPeers = [];
    clients.forEach((otherClient, otherClientId) => {
      if (clientId !== otherClientId) {
        const distance = getDistance(client.location, otherClient.location);
        // Check if other peer is within client's radius and vice-versa
        if (distance < client.radius && distance < otherClient.radius) {
          nearbyPeers.push({ 
            peerId: otherClientId,
            distance: distance.toFixed(2) // Distance in km
          });
        }
      }
    });
    // Notify the client about the peers currently nearby
    sendTo(client.ws, { type: 'nearby-peers', peers: nearbyPeers });
  });
}

// --- WebSocket Server Logic ---

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  // Initialize client with default values
  clients.set(clientId, { ws, isAlive: true, radius: 1.0, location: null });
  console.log(`Client ${clientId} connected`);

  // 1. Welcome the new client and give them their ID
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
        console.log(`Client ${clientId} updated location:`, clientData.location, `radius: ${clientData.radius}km`);
        // After updating location, broadcast the new peer lists to everyone
        broadcastNearbyPeers();
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
    // Announce the departure to relevant peers
    broadcastNearbyPeers();
  });

  ws.on('error', (error) => {
    console.error(`Error with client ${clientId}:`, error);
  });
});

// Heartbeat mechanism to remove dead connections
const heartbeatInterval = setInterval(() => {
  clients.forEach((client, id) => {
    if (!client.isAlive) {
      console.log(`Client ${id} is not alive, terminating connection.`);
      client.ws.terminate(); // This will trigger the 'close' event for cleanup
      return;
    }
    client.isAlive = false;
    sendTo(client.ws, { type: 'ping' });
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});
