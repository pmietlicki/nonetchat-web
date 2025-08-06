import { PeerServer } from 'peer';

const peerServer = PeerServer({
  port: 3001,
  path: '/',
  allow_discovery: true,
  ping: 10000, // Envoyer un ping toutes les 10 secondes
  pingTimeout: 5000 // Considérer la connexion comme morte après 5 secondes sans réponse
});

console.log('PeerJS Server running on port 3001 with heartbeat');

peerServer.on('connection', (client) => {
  console.log(`Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`Client disconnected: ${client.getId()}`);
});