import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT || 3001;
const server = createServer();
const wss = new WebSocketServer({ server });

// Stocke les clients connectés : clientId -> WebSocket instance
const clients = new Map();

console.log('Serveur de signalisation démarré...');

wss.on('connection', (ws) => {
  // 1. Attribuer un ID unique à chaque nouveau client
  const clientId = uuidv4();
  clients.set(clientId, ws);
  console.log(`Client connecté : ${clientId}`);

  // 2. Envoyer l'ID au nouveau client et la liste des autres participants
  const otherClients = Array.from(clients.keys()).filter(id => id !== clientId);
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    peers: otherClients
  }));

  // 3. Informer les autres clients de la nouvelle connexion
  const joinMessage = JSON.stringify({ type: 'user-joined', clientId });
  clients.forEach((clientSocket, id) => {
    if (id !== clientId && clientSocket.readyState === 1) { // WebSocket.OPEN
      clientSocket.send(joinMessage);
    }
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { targetId, ...payload } = message;

      // 4. Relayer les messages de signalisation (offer, answer, candidate)
      if (targetId && clients.has(targetId)) {
        const targetSocket = clients.get(targetId);
        
        // Ajouter l'expéditeur au message pour que le destinataire sache de qui il vient
        payload.senderId = clientId;

        targetSocket.send(JSON.stringify(payload));
      } else {
        console.warn(`Message pour une cible inconnue : ${targetId}`);
      }
    } catch (error) {
      console.error('Erreur de traitement du message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client déconnecté : ${clientId}`);
    clients.delete(clientId);

    // 5. Informer les autres clients de la déconnexion
    const leaveMessage = JSON.stringify({ type: 'user-left', clientId });
    clients.forEach((clientSocket) => {
      if (clientSocket.readyState === 1) {
        clientSocket.send(leaveMessage);
      }
    });
  });

  ws.on('error', (error) => {
    console.error(`Erreur WebSocket pour le client ${clientId}:`, error);
    clients.delete(clientId);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur de signalisation WebRTC en écoute sur le port ${PORT}`);
});
