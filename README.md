# NoNetChat Web

> 🌍 **[English version available](README.en.md)** | **Version française**

Une application de messagerie hyperlocale utilisant les technologies web les plus avancées pour une communication P2P sécurisée, géolocalisée et respectueuse de la vie privée.

## 🌟 Vision du Projet

NoNetChat Web est une application de messagerie **hyperlocale** et **géolocalisée** qui privilégie :
- **Confidentialité totale** : Chiffrement end-to-end, aucune donnée stockée sur serveur
- **Communication P2P** : Connexions directes via WebRTC pour une latence minimale
- **Découverte géographique** : Trouvez des personnes dans votre zone géographique
- **Contrôle utilisateur** : Vous maîtrisez vos données et vos connexions
- **Médias riches** : Support complet des fichiers, images, notes vocales

## 🚀 Fonctionnalités Principales

### 💬 Messagerie Avancée
- **Messages temps réel** : Communication instantanée avec indicateurs de frappe
- **Statuts de messages** : Envoyé, livré, lu avec horodatage précis
- **Réactions aux messages** : Système d'émojis et réactions rapides
- **Notes vocales** : Enregistrement et lecture de messages audio
- **Transfert de fichiers** : Partage sécurisé jusqu'à 100MB par fichier
- **Prévisualisation médias** : Aperçu intégré des images et fichiers

### 🌍 Découverte Géographique
- **Localisation intelligente** : GPS précis avec fallback géolocalisation IP
- **Recherche par proximité** : Rayon configurable ou par ville/pays
- **Quadtree spatial** : Algorithme optimisé pour la découverte géographique
- **Salles publiques** : Chat éphémère par zone géographique
- **Respect de la vie privée** : Localisation approximative uniquement

### 🔒 Sécurité & Confidentialité
- **Chiffrement end-to-end** : AES-GCM avec clés ECDH éphémères
- **Pas de serveur central** : Données stockées uniquement localement
- **Connexions P2P** : WebRTC pour communication directe
- **Anonymat** : Aucune inscription, identifiants éphémères
- **Contrôle total** : Blocage, suppression, gestion des données

### 📱 Interface Utilisateur
- **Design moderne** : Interface responsive Material Design
- **PWA complète** : Installation native, notifications push
- **Multi-langues** : Support français, anglais, espagnol, allemand, italien
- **Thème adaptatif** : Interface optimisée mobile/desktop
- **Accessibilité** : Support complet des technologies d'assistance

## 🏗️ Architecture Technique

### Frontend (React + TypeScript + Vite)

#### Services Principaux
- **PeerService** : Gestion WebRTC, découverte pairs, échange messages
- **CryptoService** : Chiffrement AES-GCM, clés ECDH, compression Gzip
- **IndexedDBService** : Base de données locale, migrations, cache
- **ProfileService** : Profil utilisateur, avatar, préférences
- **NotificationService** : Notifications push, sons, badges
- **FileService** : Traitement fichiers, miniatures, validation
- **DiagnosticService** : Logs, tests connectivité, debug

#### Composants Interface
- **ChatWindow** : Interface de chat avec réactions, fichiers, vocal
- **PeerList** : Liste des pairs avec filtres et tri géographique
- **ConversationList** : Historique conversations avec recherche
- **PublicChatWindow** : Chat public éphémère par zone
- **ProfileModal** : Gestion profil utilisateur complet
- **DiagnosticPanel** : Outils de diagnostic et debug

#### Technologies Frontend
- **React 18** : Framework UI avec hooks modernes
- **TypeScript** : Typage statique pour robustesse
- **Vite** : Build tool ultra-rapide avec HMR
- **Lucide React** : Icônes SVG optimisées
- **Web APIs** : WebRTC, IndexedDB, Geolocation, Push API

### Backend (Node.js + Express)

#### Serveur de Signalisation
- **WebSocket Server** : Signalisation WebRTC et découverte pairs
- **API REST** : Endpoints TURN, GeoIP, notifications push
- **Quadtree Spatial** : Indexation géographique optimisée
- **GeoIP MaxMind** : Géolocalisation par adresse IP
- **TURN/STUN** : Serveurs de relais pour NAT traversal

#### Fonctionnalités Serveur
- **Découverte géographique** : Algorithme quadtree pour proximité
- **Salles publiques** : Chat éphémère avec TTL et limites
- **Push notifications** : VAPID pour notifications web
- **Sécurité CORS** : Whitelist domaines autorisés
- **Monitoring** : Heartbeat, nettoyage connexions

#### Technologies Backend
- **Node.js** : Runtime JavaScript serveur
- **Express** : Framework web minimaliste
- **WebSocket (ws)** : Communication temps réel
- **MaxMind GeoIP2** : Base de données géolocalisation
- **Web Push** : Notifications push VAPID
- **Quadtree-js** : Structure de données spatiale

## 🛠️ Installation

### Prérequis
- **Node.js 18+** : Runtime JavaScript moderne
- **npm ou yarn** : Gestionnaire de paquets
- **Navigateur moderne** : Chrome 97+, Firefox 100+, Safari 16+

### Installation Rapide

```bash
# Cloner le repository
git clone https://github.com/your-username/nonetchat-web.git
cd nonetchat-web

# Installation des dépendances frontend
npm install

# Installation des dépendances backend
cd server
npm install
cd ..
```

### Démarrage Développement

```bash
# Terminal 1 : Serveur backend
cd server
npm run dev

# Terminal 2 : Frontend
npm run dev
```

L'application sera accessible sur `http://localhost:5173`

## 🚀 Utilisation

### Première Connexion
1. **Autoriser la géolocalisation** : Pour découvrir les pairs à proximité
2. **Configurer votre profil** : Nom, âge, avatar (optionnel)
3. **Découvrir les pairs** : Liste automatique des utilisateurs connectés
4. **Démarrer une conversation** : Clic sur un pair pour chatter

### Fonctionnalités Avancées
- **Chat public** : Rejoindre les discussions de votre zone
- **Transfert de fichiers** : Glisser-déposer ou sélection
- **Notes vocales** : Maintenir le bouton micro
- **Réactions** : Clic long sur un message
- **Paramètres** : Notifications, rayon de recherche

## 📋 Scripts Disponibles

### Frontend
```bash
npm run dev          # Serveur développement avec HMR
npm run build        # Build de production optimisé
npm run preview      # Aperçu du build de production
npm run test         # Tests unitaires avec Vitest
npm run test:e2e     # Tests end-to-end avec Playwright
npm run lint         # Vérification ESLint
npm run type-check   # Vérification TypeScript
```

### Backend
```bash
npm start            # Serveur production
npm run dev          # Serveur développement avec watch
```

## 🔧 Configuration

### Variables d'Environnement Backend

Créez un fichier `.env` dans le dossier `server/` :

```env
# Serveur
PORT=3000
NODE_ENV=development

# TURN/STUN (pour WebRTC)
TURN_STATIC_SECRET=your-turn-secret
TURN_HOST=turn.nonetchat.com
TURN_REALM=turn.nonetchat.com
TURN_TTL_SECONDS=3600

# GeoIP (optionnel)
GEOIP_DB=/path/to/GeoLite2-City.mmdb

# Push Notifications (optionnel)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUB=mailto:contact@nonetchat.com
```

### Configuration Frontend

Les paramètres sont configurables via l'interface :
- **URL de signalisation** : Serveur WebSocket personnalisé
- **Rayon de recherche** : Distance ou ville/pays
- **Notifications** : Sons, push, badges
- **Langue** : Interface multilingue

## 🌐 Déploiement

### Déploiement Frontend (Vercel/Netlify)

```bash
# Build optimisé
npm run build

# Le dossier dist/ contient les fichiers statiques
# Configurez votre hébergeur pour servir dist/index.html
```

### Déploiement Backend (VPS/Cloud)

```bash
# Sur votre serveur
git clone https://github.com/your-username/nonetchat-web.git
cd nonetchat-web/server
npm install --production

# Configuration PM2 (recommandé)
npm install -g pm2
pm2 start server.js --name "nonetchat-server"
pm2 startup
pm2 save
```

### Configuration HTTPS/WSS

Pour la production, configurez un reverse proxy (Nginx) :

```nginx
server {
    listen 443 ssl http2;
    server_name chat.nonetchat.com;
    
    # Certificats SSL
    ssl_certificate /path/to/cert.pem;
    ssl_private_key /path/to/key.pem;
    
    # WebSocket upgrade
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 🧪 Tests

### Tests Unitaires
```bash
# Lancer tous les tests
npm run test

# Tests en mode watch
npm run test:watch

# Coverage détaillé
npm run test:coverage
```

### Tests End-to-End
```bash
# Tests E2E complets
npm run test:e2e

# Tests E2E en mode UI
npm run test:e2e:ui
```

## 📚 Documentation Technique

### Architecture des Messages

```typescript
interface Message {
  id: string;                    // UUID unique
  senderId: string;             // ID de l'expéditeur
  receiverId: string;           // ID du destinataire
  content: string;              // Contenu du message
  timestamp: number;            // Timestamp Unix
  type: 'text' | 'file';       // Type de message
  encrypted: boolean;           // Chiffrement E2E
  status: 'sending' | 'sent' | 'delivered' | 'read';
  fileData?: FileData;          // Métadonnées fichier
  reactions?: { [emoji: string]: string[] }; // Réactions
}
```

### API WebSocket (Signalisation)

```typescript
// Connexion
ws://localhost:3001

// Messages de signalisation
{
  type: 'join-room',
  payload: { roomId: string, profile: UserProfile }
}

{
  type: 'webrtc-offer' | 'webrtc-answer' | 'webrtc-ice',
  targetId: string,
  payload: RTCSessionDescription | RTCIceCandidate
}
```

### Endpoints API REST

```bash
# Credentials TURN/STUN
GET /api/turn-credentials?userId=xxx

# Géolocalisation IP
GET /api/geoip

# Notifications Push
POST /api/save-subscription
```

### Structure de Données IndexedDB

```typescript
// Stores principaux
- messages: Message[]           // Historique des messages
- conversations: Conversation[] // Métadonnées conversations
- files: { id: string, blob: Blob }[] // Fichiers locaux
- profile: UserProfile         // Profil utilisateur
- keys: CryptoKeyPair[]        // Clés cryptographiques
```

## 🔒 Sécurité

### Chiffrement End-to-End
- **Algorithme** : AES-GCM 256 bits
- **Échange de clés** : ECDH P-256
- **Dérivation** : PBKDF2 avec salt aléatoire
- **Intégrité** : HMAC-SHA256

### Bonnes Pratiques
- Clés éphémères par session
- Pas de stockage serveur des messages
- Validation stricte des entrées
- CSP (Content Security Policy)
- CORS configuré en whitelist

## 🔮 Roadmap

### Version 1.0 - Base Actuelle ✅
- [x] **Architecture P2P** : WebRTC avec signalisation WebSocket
- [x] **Chiffrement E2E** : AES-GCM avec clés ECDH
- [x] **Géolocalisation** : Découverte par proximité géographique
- [x] **Interface moderne** : React + TypeScript + PWA
- [x] **Stockage local** : IndexedDB avec migrations
- [x] **Transfert fichiers** : Support jusqu'à 100MB
- [x] **Notes vocales** : Enregistrement et lecture audio
- [x] **Multi-langues** : 5 langues supportées

### Version 1.1 - Sécurité Avancée
- [ ] **Salles thématiques** : Chat public par centres d'intérêt
- [ ] **Modération** : Outils de signalement et blocage

### Version 1.2 - Communication Enrichie
- [ ] **Appels vocaux** : WebRTC audio P2P
- [ ] **Partage d'écran** : Collaboration en temps réel
- [ ] **Notifications Push** : Service Worker intégré
- [ ] **Mode hors ligne** : Synchronisation différée

## 🐛 Problèmes Connus

- **WebRTC NAT** : Peut nécessiter serveur TURN en production
- **Géolocalisation** : Précision variable selon l'appareil
- **Fichiers volumineux** : Optimisation transfert en cours
- **Navigateurs anciens** : Support limité WebRTC/IndexedDB

## 📞 Support

- **Issues GitHub** : [Signaler un bug](https://github.com/nonetchat/nonetchat-web/issues)
- **Discussions** : [Forum communautaire](https://github.com/nonetchat/nonetchat-web/discussions)
- **Documentation** : [Wiki technique](https://github.com/nonetchat/nonetchat-web/wiki)
- **Email** : contact@nonetchat.com

## 🤝 Contribution

### Guide de Contribution

1. **Fork** le repository
2. **Créer une branche** : `git checkout -b feature/ma-fonctionnalite`
3. **Développer** avec tests unitaires
4. **Tester** : `npm run test && npm run test:e2e`
5. **Commit** : `git commit -m "feat: ajouter ma fonctionnalité"`
6. **Push** : `git push origin feature/ma-fonctionnalite`
7. **Pull Request** avec description détaillée

### Standards de Code
- **TypeScript strict** : Typage complet
- **ESLint + Prettier** : Formatage automatique
- **Tests obligatoires** : Coverage > 80%
- **Documentation** : JSDoc pour les APIs
- **Commits conventionnels** : feat, fix, docs, etc.

## 📄 Licence

Ce projet est sous licence **MIT**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🙏 Remerciements

- **[WebRTC](https://webrtc.org/)** : Technologie P2P révolutionnaire
- **[React](https://reactjs.org/)** : Framework UI moderne
- **[Vite](https://vitejs.dev/)** : Build tool ultra-rapide
- **[TypeScript](https://www.typescriptlang.org/)** : JavaScript typé
- **[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)** : Base de données navigateur
- **[MaxMind](https://www.maxmind.com/)** : Base de données GeoIP
- **Communauté open source** : Pour l'inspiration et les contributions

---

**NoNetChat Web** - *Messagerie hyperlocale, sécurisée et respectueuse de la vie privée* 🌍💬🔒