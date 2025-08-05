# NoNetChat Web

Une application de messagerie décentralisée moderne utilisant WebTransport (HTTP/3 QUIC) avec fallback WebSocket automatique.

## 🚀 Fonctionnalités

- **Protocol WebTransport/HTTP3** : Communication ultra-rapide via QUIC
- **Fallback WebSocket** : Compatibilité automatique si WebTransport n'est pas supporté
- **Messagerie temps réel** : Échange de messages instantané entre pairs
- **Transfert de fichiers** : Envoi de fichiers fragmentés et recomposés
- **Découverte de pairs** : Liste automatique des utilisateurs connectés
- **Historique local** : Stockage IndexedDB pour persistance hors ligne
- **Interface responsive** : Design moderne compatible desktop/mobile
- **Indicateurs de frappe** : Notifications temps réel de saisie

## 🏗️ Architecture

### Frontend (React + TypeScript)
- **WebTransportService** : Gestion des connexions WebTransport/WebSocket
- **IndexedDBService** : Persistance locale des messages et conversations
- **Interface modulaire** : Composants réutilisables et maintenables

### Backend (Node.js)
- **Serveur HTTP/3** : Endpoint WebTransport (avec fallback WebSocket)
- **Gestion des pairs** : Découverte et signalisation automatique
- **Transfert fragmenté** : Gestion des gros fichiers par chunks
- **Temps réel** : Diffusion des messages et états

## 🛠️ Installation

### 1. Client (Frontend)
```bash
npm install
npm run dev
```

### 2. Serveur (Backend)
```bash
cd server
npm install
npm run dev
```

## 🌐 Utilisation

1. **Démarrer le serveur** : `cd server && npm run dev`
2. **Lancer le client** : `npm run dev`
3. **Ouvrir plusieurs onglets** pour tester la communication P2P
4. **Sélectionner un pair** dans la liste pour commencer une conversation

## 🔧 Configuration

### Variables d'environnement
```env
PORT=3001                    # Port du serveur
WEBTRANSPORT_ENABLED=true    # Activer WebTransport
```

### Limites par défaut
- **Taille fichier** : 50MB maximum
- **Chunk size** : 64KB pour le transfert
- **Connexions** : Illimitées par serveur

## 📡 Protocoles supportés

### WebTransport (HTTP/3 QUIC)
- **Streams bidirectionnels** : Communication full-duplex
- **Multiplexage** : Plusieurs conversations simultanées
- **Faible latence** : Protocol QUIC optimisé

### WebSocket (Fallback)
- **Compatibilité** : Support navigateurs anciens
- **Même API** : Interface unifiée côté client
- **Détection automatique** : Bascule transparente

## 🔒 Sécurité

- **HTTPS requis** : WebTransport nécessite une connexion sécurisée
- **Validation fichiers** : Types et tailles contrôlés
- **Isolation pairs** : Messages routés uniquement vers destinataires

## 🚀 Déploiement

### Production
```bash
# Build client
npm run build

# Démarrer serveur
cd server
npm start
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## 🔮 Roadmap

- [ ] **Chiffrement E2E** : Implémentation WebCrypto
- [ ] **Salles de discussion** : Support multi-utilisateurs
- [ ] **Notifications Push** : Service Worker intégré
- [ ] **Synchronisation** : Backup cloud optionnel
- [ ] **Mobile PWA** : Installation native

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📄 Licence

Distribué sous licence MIT. Voir `LICENSE` pour plus d'informations.

## 🙏 Remerciements

- **WebTransport API** : Standard W3C pour HTTP/3
- **React** : Framework UI moderne
- **Node.js** : Runtime serveur performant
- **IndexedDB** : Stockage local navigateur