# NoNetChat Web

> 🌍 **English version** | **[Version française disponible](README.md)**

A hyperlocal messaging application using the most advanced web technologies for secure, geolocated, and privacy-respecting P2P communication.

## 🌟 Project Vision

NoNetChat Web is a **hyperlocal** and **geolocated** messaging application that prioritizes:
- **Total privacy**: End-to-end encryption, no data stored on servers
- **P2P communication**: Direct connections via WebRTC for minimal latency
- **Geographic discovery**: Find people in your geographic area
- **User control**: You control your data and connections
- **Rich media**: Full support for files, images, voice notes

## 🚀 Main Features

### 💬 Advanced Messaging
- **Real-time messages**: Instant communication with typing indicators
- **Message status**: Sent, delivered, read with precise timestamps
- **Message reactions**: Emoji system and quick reactions
- **Voice notes**: Recording and playback of audio messages
- **File transfer**: Secure sharing up to 100MB per file
- **Media preview**: Integrated preview of images and files

### 🌍 Geographic Discovery
- **Smart location**: Precise GPS with IP geolocation fallback
- **Proximity search**: Configurable radius or by city/country
- **Spatial quadtree**: Optimized algorithm for geographic discovery
- **Public rooms**: Ephemeral chat by geographic zone
- **Privacy respect**: Approximate location only

### 🔒 Security & Privacy
- **End-to-end encryption**: AES-GCM with ephemeral ECDH keys
- **No central server**: Data stored locally only
- **P2P connections**: WebRTC for direct communication
- **Anonymity**: No registration, ephemeral identifiers
- **Total control**: Blocking, deletion, data management

### 📱 User Interface
- **Modern design**: Responsive Material Design interface
- **Complete PWA**: Native installation, push notifications
- **Multi-language**: Support for French, English, Spanish, German, Italian
- **Adaptive theme**: Mobile/desktop optimized interface
- **Accessibility**: Full support for assistive technologies

## 🏗️ Technical Architecture

### Frontend (React + TypeScript + Vite)

#### Main Services
- **PeerService**: WebRTC management, peer discovery, message exchange
- **CryptoService**: End-to-end encryption, key management, file encryption
- **IndexedDBService**: Local storage, conversations, files, migrations
- **ProfileService**: User profile, avatar, device management
- **NotificationService**: Notifications, sounds, unread messages
- **FileService**: File processing, thumbnails, validation
- **DiagnosticService**: Logging, connectivity tests, debugging

#### React Components
- **App.tsx**: Main application, global state, service initialization
- **ChatWindow**: Private conversations, message sending/receiving
- **PeerList**: Peer discovery, filtering, profile display
- **ConversationList**: Conversation management, search, deletion
- **PublicChatWindow**: Public ephemeral chat by zone
- **ProfileModal**: Profile editing, avatar, preferences
- **DiagnosticPanel**: Technical diagnostics, connectivity tests
- **NotificationSettings**: Notification preferences per conversation

### Backend (Node.js + Express + WebSocket)

#### WebSocket Signaling Server
- **Peer discovery**: Room management, geographic matching
- **WebRTC signaling**: Offer/answer exchange, ICE candidates
- **Public chat**: Ephemeral message relay by zone
- **Geographic indexing**: Quadtree for spatial optimization

#### Additional Features
- **GeoIP2 geolocation**: MaxMind database for IP location
- **TURN/STUN servers**: NAT traversal configuration
- **Push notifications**: VAPID support for PWA
- **CORS configured**: Whitelist security

## 🔮 Roadmap

### Version 1.0 - Current Base ✅
- [x] **P2P Architecture**: WebRTC with WebSocket signaling
- [x] **E2E Encryption**: AES-GCM with ECDH keys
- [x] **Geolocation**: Discovery by geographic proximity
- [x] **Modern Interface**: React + TypeScript + PWA
- [x] **Local Storage**: IndexedDB with migrations
- [x] **File Transfer**: Support up to 100MB
- [x] **Voice Notes**: Audio recording and playback
- [x] **Multi-language**: 5 supported languages

### Version 1.1 - Advanced Security
- [ ] **Thematic Rooms**: Public chat by interests
- [ ] **Moderation**: Reporting and blocking tools

### Version 1.2 - Enhanced Communication
- [ ] **Voice Calls**: P2P WebRTC audio
- [ ] **Screen Sharing**: Real-time collaboration
- [ ] **Push Notifications**: Integrated Service Worker
- [ ] **Offline Mode**: Deferred synchronization

## 🐛 Known Issues

- **WebRTC NAT**: May require TURN server in production
- **Geolocation**: Variable accuracy depending on device
- **Large Files**: Transfer optimization in progress
- **Old Browsers**: Limited WebRTC/IndexedDB support

## 📞 Support

- **GitHub Issues**: [Report a bug](https://github.com/nonetchat/nonetchat-web/issues)
- **Discussions**: [Community forum](https://github.com/nonetchat/nonetchat-web/discussions)
- **Documentation**: [Technical wiki](https://github.com/nonetchat/nonetchat-web/wiki)
- **Email**: contact@nonetchat.com

## 🛠️ Installation

### Prerequisites
- **Node.js** ≥ 18.0.0
- **npm** ≥ 8.0.0
- **Modern browser** with WebRTC support

### Quick Installation
```bash
# Clone the repository
git clone https://github.com/nonetchat/nonetchat-web.git
cd nonetchat-web

# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### Development Start
```bash
# Start backend (terminal 1)
cd server
npm start

# Start frontend (terminal 2)
npm run dev
```

Application available at: http://localhost:5173

## 📖 Usage

### First Connection
1. **Open application** in modern browser
2. **Allow geolocation** for peer discovery
3. **Configure profile** (name, age, avatar)
4. **Discover peers** in your area
5. **Start conversation** by clicking on a peer

### Advanced Features
- **File sharing**: Drag & drop or click attachment button
- **Voice notes**: Hold microphone button to record
- **Public chat**: Switch to "Public" tab for zone chat
- **Notifications**: Configure per conversation in settings
- **Diagnostics**: Access via status bar for debugging

## 🔧 Available Scripts

### Frontend
```bash
npm run dev          # Development server
npm run build        # Production build
npm run preview      # Preview production build
npm run test         # Unit tests (Vitest)
npm run test:ui      # Tests with UI
npm run test:e2e     # End-to-end tests (Playwright)
npm run lint         # ESLint linting
npm run type-check   # TypeScript verification
```

### Backend
```bash
cd server
npm start            # Production server
npm run dev          # Development with nodemon
npm test             # Backend tests
```

## ⚙️ Configuration

### Backend Environment Variables
```bash
# server/.env
PORT=3001                    # Server port
CORS_ORIGIN=http://localhost:5173  # CORS origin
GEOIP_DB_PATH=./GeoLite2-City.mmdb # GeoIP database
VAPID_PUBLIC_KEY=your_key    # Push notifications
VAPID_PRIVATE_KEY=your_key   # Push notifications
VAPID_SUBJECT=mailto:your@email.com
```

### Frontend Configuration
```typescript
// src/config.ts
export const CONFIG = {
  WEBSOCKET_URL: 'ws://localhost:3001',
  STUN_SERVERS: ['stun:stun.l.google.com:19302'],
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  SUPPORTED_LANGUAGES: ['fr', 'en', 'es', 'de', 'it']
};
```

## 🚀 Deployment

### Frontend (Static)
```bash
npm run build
# Deploy dist/ folder to CDN/static hosting
```

### Backend (Node.js)
```bash
cd server
npm install --production
PORT=3001 npm start
```

### HTTPS/WSS Production
- **Frontend**: Serve via HTTPS (required for WebRTC)
- **Backend**: Configure SSL certificates for WSS
- **TURN Server**: Configure for NAT traversal

## 🧪 Tests

### Unit Tests (Vitest)
```bash
npm run test              # Run all tests
npm run test:ui           # Interactive UI
npm run test:coverage     # Coverage report
```

### End-to-End Tests (Playwright)
```bash
npm run test:e2e          # All E2E tests
npm run test:e2e:ui       # Interactive mode
npm run test:e2e:report   # Test report
```

## 📚 Technical Documentation

### Message Architecture
```typescript
interface Message {
  id: string;
  type: 'text' | 'file' | 'voice' | 'system';
  content: string;
  timestamp: number;
  senderId: string;
  encrypted: boolean;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  reactions?: { emoji: string; userId: string }[];
}
```

### WebSocket API
```javascript
// Signaling events
'join-room'     // Join geographic room
'leave-room'    // Leave room
'peer-joined'   // New peer notification
'peer-left'     // Peer disconnection
'webrtc-offer'  // WebRTC offer
'webrtc-answer' // WebRTC answer
'ice-candidate' // ICE candidate
'public-message' // Public chat message
```

### REST API Endpoints
```
GET  /api/location/:ip     # IP geolocation
GET  /api/turn-credentials # TURN server credentials
POST /api/push/subscribe   # Push notification subscription
```

### IndexedDB Structure
```
Stores:
- messages        # Encrypted messages
- conversations   # Conversation metadata
- files          # File attachments
- avatars        # User avatars
- keys           # Encryption keys
- profiles       # User profiles
- settings       # Application settings
```

## 🔐 Security

### End-to-End Encryption
- **Algorithm**: AES-GCM 256-bit
- **Key Exchange**: ECDH P-256
- **Key Derivation**: PBKDF2 with salt
- **Perfect Forward Secrecy**: Ephemeral keys

### Security Best Practices
- No data stored on servers
- Local encryption of sensitive data
- Secure random number generation
- Protection against timing attacks
- Input validation and sanitization

## 🤝 Contribution

### Contribution Guide

1. **Fork** the repository
2. **Create a branch**: `git checkout -b feature/my-feature`
3. **Develop** with unit tests
4. **Test**: `npm run test && npm run test:e2e`
5. **Commit**: `git commit -m "feat: add my feature"`
6. **Push**: `git push origin feature/my-feature`
7. **Pull Request** with detailed description

### Code Standards
- **Strict TypeScript**: Complete typing
- **ESLint + Prettier**: Automatic formatting
- **Mandatory tests**: Coverage > 80%
- **Documentation**: JSDoc for APIs
- **Conventional commits**: feat, fix, docs, etc.

## 📄 License

This project is under **MIT** license. See [LICENSE](LICENSE) file for more details.

## 🙏 Acknowledgments

- **[WebRTC](https://webrtc.org/)**: Revolutionary P2P technology
- **[React](https://reactjs.org/)**: Modern UI framework
- **[Vite](https://vitejs.dev/)**: Ultra-fast build tool
- **[TypeScript](https://www.typescriptlang.org/)**: Typed JavaScript
- **[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)**: Browser database
- **[MaxMind](https://www.maxmind.com/)**: GeoIP database
- **Open source community**: For inspiration and contributions

---

**NoNetChat Web** - *Hyperlocal, secure and privacy-respecting messaging* 🌍💬🔒