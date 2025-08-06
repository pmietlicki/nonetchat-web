import Peer, { DataConnection } from 'peerjs';
import { User } from '../types';
import CryptoService from './CryptoService';

export interface PeerMessage {
  type: 'profile' | 'chat-message' | 'key-exchange';
  payload: any;
}

class EventEmitter {
  protected events: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }

  emit(event: string, ...args: any[]) {
    this.events[event]?.forEach(listener => listener(...args));
  }

  removeListener(event: string, listener: Function) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(l => l !== listener);
    }
  }
}

class PeerService extends EventEmitter {
  private static instance: PeerService;
  public peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private myProfile: Partial<User> = {};
  private discoveryInterval: NodeJS.Timeout | null = null;
  private cryptoService: CryptoService;
  private reconnectAttempts: Map<string, number> = new Map();

  private constructor() {
    super();
    this.cryptoService = CryptoService.getInstance();
  }

  public static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  public async initialize(userId: string, profile: Partial<User>, signalingUrl: string) {
    if (this.peer) this.peer.destroy();
    this.myProfile = profile;
    await this.cryptoService.initialize();

    const url = new URL(signalingUrl);
    const peerOptions = {
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'wss:' ? 443 : 80),
      path: url.pathname,
      secure: url.protocol === 'wss:',
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ]
      }
    };

    this.peer = new Peer(userId, peerOptions);

    this.peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      this.emit('open', id);
      this.discoverPeers();
      if (this.discoveryInterval) clearInterval(this.discoveryInterval);
      this.discoveryInterval = setInterval(() => this.discoverPeers(), 10000);
    });

    this.peer.on('connection', (conn) => this.setupConnection(conn));
    this.peer.on('error', (err) => {
      console.error('PeerJS Error:', err);
      this.emit('error', err);
    });
  }

  private discoverPeers() {
    this.peer?.listAllPeers((peerIds) => {
      peerIds.forEach(peerId => {
        if (this.peer && peerId !== this.peer.id) {
          this.connect(peerId);
        }
      });
    });
  }

  public connect(peerId: string) {
    if (this.connections.has(peerId) || !this.peer) return;

    console.log(`Attempting to connect to peer: ${peerId}`);
    const conn = this.peer.connect(peerId, { reliable: true });
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
    const peerId = conn.peer;

    if (this.connections.has(peerId)) {
      console.log(`Glare detected with ${peerId}. Applying resolution logic.`);
      const existingConn = this.connections.get(peerId)!;
      if (this.peer!.id > peerId) {
        console.log(`My ID is greater. Closing incoming connection from ${peerId}.`);
        conn.close();
        return; // Keep the outgoing connection
      } else {
        console.log(`My ID is smaller. Closing existing connection and accepting new one from ${peerId}.`);
        existingConn.close();
      }
    }
    this.connections.set(peerId, conn);

    conn.on('open', async () => {
      console.log(`Connection established with ${peerId}`);
      this.reconnectAttempts.set(peerId, 0);
      this.emit('peer-joined', peerId);

      const myPublicKey = await this.cryptoService.getPublicKeyJwk();
      this.send(peerId, { type: 'key-exchange', payload: myPublicKey });
    });

    conn.on('data', async (data) => {
      const message = data as PeerMessage;

      if (message.type === 'key-exchange') {
        await this.cryptoService.deriveSharedSecret(peerId, message.payload);
        console.log(`Shared secret derived with ${peerId}`);
        await this.sendProfile(peerId);
        return;
      }

      if (message.type === 'chat-message' && typeof message.payload === 'string') {
        message.payload = await this.cryptoService.decryptMessage(peerId, message.payload);
      }

      this.emit('data', conn.peer, message);
    });

    conn.on('close', () => this.handleDisconnect(peerId, 'Connection closed'));
    conn.on('error', (err) => this.handleDisconnect(peerId, `Connection error: ${err.message}`))
  }

  private handleDisconnect(peerId: string, reason: string) {
    if (!this.connections.has(peerId)) return;

    console.log(`Disconnected from ${peerId}. Reason: ${reason}`);
    this.connections.delete(peerId);
    this.emit('peer-left', peerId);

    const attempts = (this.reconnectAttempts.get(peerId) || 0) + 1;
    this.reconnectAttempts.set(peerId, attempts);

    const delay = Math.min(30000, Math.pow(2, attempts) * 1000);

    console.log(`Scheduling reconnect to ${peerId} in ${delay / 1000}s (attempt ${attempts})`);
    setTimeout(() => {
      this.connect(peerId);
    }, delay);
  }

  private async send(peerId: string, message: PeerMessage) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.open) {
        console.warn(`Cannot send message to ${peerId}, connection not open.`);
        return;
    }

    let payload = message.payload;
    if (message.type === 'chat-message') {
      payload = await this.cryptoService.encryptMessage(peerId, payload);
    }

    conn.send({ ...message, payload });
  }

  public sendMessage(peerId: string, content: string) {
    this.send(peerId, { type: 'chat-message', payload: content });
  }

  private async sendProfile(peerId: string) {
    const profileToSend = { ...this.myProfile };
    const ProfileService = (await import('./ProfileService')).default;
    const profileService = ProfileService.getInstance();
    const avatarBase64 = await profileService.getAvatarAsBase64();
    if (avatarBase64) profileToSend.avatar = avatarBase64;

    this.send(peerId, { type: 'profile', payload: profileToSend });
  }

  public async updateProfile(profile: Partial<User>) {
    this.myProfile = profile;
    this.connections.forEach((conn, peerId) => {
        if (conn.open) this.sendProfile(peerId);
    });
  }

  public destroy() {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.events = {};
  }
}

export default PeerService;