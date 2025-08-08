import { PeerServer } from 'peer';

const peerServer = PeerServer({
  port: 3001,
  path: '/',
  host: '0.0.0.0',
  allow_discovery: true,
  proxied: true,
  alive_timeout: 70000,
  expire_timeout: 10000,
});

console.log('PeerJS Server running on port 3001 with heartbeat');

peerServer.on('connection', (client) => {
  console.log(`Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`Client disconnected: ${client.getId()}`);
});