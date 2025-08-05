import { PeerServer } from 'peer';

const peerServer = PeerServer({
  port: 3001,
  path: '/',
});

console.log('PeerJS Server running on port 3001');

peerServer.on('connection', (client) => {
  console.log(`Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`Client disconnected: ${client.getId()}`);
});