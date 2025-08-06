import Peer, { DataConnection } from 'peerjs';
import { User } from '../types';

// Structure unifiée pour tous les messages
export interface PeerMessage {
  type: 'profile' | 'chat-message';
  payload: any;
}

// Utilisation d'un EventEmitter simple pour découpler le service de l'UI
class EventEmitter {
  protected events: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  emit(event: string, ...args: any[]) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
    }
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

  public static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  public initialize(userId: string, profile: Partial<User>, signalingUrl: string) {
    if (this.peer) {
      this.peer.destroy();
    }
    this.myProfile = profile;

    const url = new URL(signalingUrl);
    const peerOptions = {
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'wss:' ? 443 : 80),
      path: url.pathname,
      secure: url.protocol === 'wss:',
    };

    this.peer = new Peer(userId, peerOptions);

    this.peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      this.emit('open', id);
      this.discoverPeers();
    });

    this.peer.on('connection', (conn) => {
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Error:', err);
      this.emit('error', err);
    });
  }

  private discoverPeers() {
    this.peer?.listAllPeers((peerIds) => {
      console.log('Discovered peers:', peerIds);
      peerIds.forEach(peerId => {
        if (peerId !== this.peer?.id) {
          this.connect(peerId);
        }
      });
    });
  }

  public connect(peerId: string) {
    if (this.connections.has(peerId)) return;
    console.log(`Connecting to peer: ${peerId}`);
    const conn = this.peer!.connect(peerId);
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
    conn.on('open', async () => {
      console.log(`Connection opened with ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      this.emit('peer-joined', conn.peer);
      
      // Préparer le profil avec l'avatar en Base64 pour la transmission
      const profileToSend = { ...this.myProfile };
      const ProfileService = (await import('./ProfileService')).default;
      const profileService = ProfileService.getInstance();
      const avatarBase64 = await profileService.getAvatarAsBase64();
      if (avatarBase64) {
        profileToSend.avatar = avatarBase64;
      }
      
      this.sendMessage(conn.peer, {
        type: 'profile',
        payload: profileToSend,
      });
    });

    conn.on('data', (data) => {
      this.emit('data', conn.peer, data as PeerMessage);
    });

    conn.on('close', () => {
      console.log(`Connection closed with ${conn.peer}`);
      this.connections.delete(conn.peer);
      this.emit('peer-left', conn.peer);
    });
  }

  public sendMessage(peerId: string, message: PeerMessage) {
    this.connections.get(peerId)?.send(message);
  }

  public broadcast(message: PeerMessage) {
    this.connections.forEach(conn => conn.send(message));
  }

  public async updateProfile(profile: Partial<User>) {
    this.myProfile = profile;
    
    // Préparer le profil avec l'avatar en Base64 pour la transmission
    const profileToSend = { ...profile };
    const ProfileService = (await import('./ProfileService')).default;
    const profileService = ProfileService.getInstance();
    const avatarBase64 = await profileService.getAvatarAsBase64();
    if (avatarBase64) {
      profileToSend.avatar = avatarBase64;
    }
    
    this.broadcast({ type: 'profile', payload: profileToSend });
  }

  public destroy() {
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    // Clear all event listeners
    this.events = {};
  }
}

export default PeerService;
