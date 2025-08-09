
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
  console.log('\n=== BROADCAST PEER UPDATES ===');
  console.log(`Total clients connected: ${clients.size}`);
  
  // Log all clients and their info
  clients.forEach((client, clientId) => {
    console.log(`Client ${clientId}: IP=${client.ip}, mode=${client.discoveryMode}, location=${JSON.stringify(client.location)}, radius=${client.radius}`);
  });
  
  clients.forEach((client, clientId) => {
    console.log(`\n--- Processing peers for client ${clientId} ---`);
    const nearbyPeers = [];
    
    clients.forEach((otherClient, otherClientId) => {
      if (clientId === otherClientId) {
        console.log(`  Skipping self: ${otherClientId}`);
        return;
      }

      let isNearby = false;
      let distanceInfo = {};
      let reason = '';

      console.log(`  Checking peer ${otherClientId}:`);
      console.log(`    Client IP: ${client.ip}, Other IP: ${otherClient.ip}`);
      console.log(`    Client mode: ${client.discoveryMode}, Other mode: ${otherClient.discoveryMode}`);

      // Priority 1: Check for same Local Area Network (LAN)
      if (client.ip === otherClient.ip) {
        isNearby = true;
        distanceInfo = { distance: 'LAN' };
        reason = 'Same IP (LAN)';
        console.log(`    ✅ MATCH: Same IP detected - ${client.ip}`);
      }
      // Priority 2: Check for geolocation proximity (if not on same LAN)
      else if (client.discoveryMode === 'geo' && otherClient.discoveryMode === 'geo') {
        console.log(`    Checking geolocation proximity...`);
        console.log(`    Client location: ${JSON.stringify(client.location)}`);
        console.log(`    Other location: ${JSON.stringify(otherClient.location)}`);
        
        const distance = getDistance(client.location, otherClient.location);
        console.log(`    Distance: ${distance}km, Client radius: ${client.radius}km, Other radius: ${otherClient.radius}km`);
        
        if (distance < client.radius && distance < otherClient.radius) {
          isNearby = true;
          distanceInfo = { distance: distance.toFixed(2) + ' km' };
          reason = `Geo proximity (${distance.toFixed(2)}km)`;
          console.log(`    ✅ MATCH: Within geo range`);
        } else {
          console.log(`    ❌ NO MATCH: Outside geo range`);
        }
      } else {
        console.log(`    ❌ NO MATCH: Different IPs and not both in geo mode`);
      }

      if (isNearby) {
        nearbyPeers.push({ peerId: otherClientId, ...distanceInfo });
        console.log(`    → Added to nearby peers: ${reason}`);
      }
    });
    
    console.log(`  Final nearby peers for ${clientId}: ${nearbyPeers.length} peers`);
    nearbyPeers.forEach(peer => {
      console.log(`    - ${peer.peerId} (${peer.distance})`);
    });
    
    sendTo(client.ws, { type: 'nearby-peers', peers: nearbyPeers });
  });
  console.log('=== END BROADCAST ===\n');
}

// --- WebSocket Server Logic ---

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  // Get the real client IP address by checking headers in order of reliability.
  const ip = req.headers['cf-connecting-ip'] || 
             req.headers['x-real-ip'] || 
             req.headers['x-forwarded-for']?.split(',')[0].trim() || 
             req.socket.remoteAddress;
  
  console.log(`\n🔗 NEW CONNECTION:`);
  console.log(`  Client ID: ${clientId}`);
  console.log(`  IP Address: ${ip}`);
  console.log(`  Headers:`, req.headers);
  console.log(`  Socket remote address: ${req.socket.remoteAddress}`);
  
  clients.set(clientId, { ws, ip, isAlive: true, radius: 1.0, location: null, discoveryMode: 'geo' });
  console.log(`✅ Client ${clientId} connected from IP ${ip}`);
  console.log(`📊 Total clients now: ${clients.size}`);

  sendTo(ws, { type: 'welcome', clientId });
  
  // Trigger immediate peer update to check for existing peers
  console.log(`🔄 Triggering peer discovery for new client...`);
  broadcastPeerUpdates();

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error(`❌ Failed to parse message from ${clientId}:`, message);
      return;
    }

    const clientData = clients.get(clientId);
    if (!clientData) {
      console.error(`❌ Client data not found for ${clientId}`);
      return;
    }

    const { type, payload } = parsedMessage;
    console.log(`\n📨 MESSAGE from ${clientId}: ${type}`, payload ? JSON.stringify(payload) : '');

    switch (type) {
      case 'update-location':
        console.log(`📍 Location update for ${clientId}:`);
        console.log(`  Previous: mode=${clientData.discoveryMode}, location=${JSON.stringify(clientData.location)}, radius=${clientData.radius}`);
        
        clientData.location = payload.location;
        clientData.radius = payload.radius || clientData.radius;
        clientData.discoveryMode = 'geo';
        
        console.log(`  New: mode=${clientData.discoveryMode}, location=${JSON.stringify(clientData.location)}, radius=${clientData.radius}`);
        console.log(`🔄 Triggering peer discovery after location update...`);
        broadcastPeerUpdates();
        break;

      case 'request-lan-discovery':
        console.log(`🏠 LAN discovery request for ${clientId}:`);
        console.log(`  Previous mode: ${clientData.discoveryMode}`);
        
        clientData.discoveryMode = 'lan';
        
        console.log(`  New mode: ${clientData.discoveryMode}`);
        console.log(`🔄 Triggering peer discovery after LAN mode switch...`);
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
