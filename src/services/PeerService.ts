import Peer, { DataConnection } from 'peerjs';
import { User } from '../types';

// Structure unifiée pour tous les messages
export interface PeerMessage {
  type: 'profile' | 'chat-message';
  payload: any;
}

// Utilisation d'un EventEmitter simple pour découpler le service de l'UI
class EventEmitter {
  private events: { [key: string]: Function[] } = {};

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
    conn.on('open', () => {
      console.log(`Connection opened with ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      this.emit('peer-joined', conn.peer);
      this.sendMessage(conn.peer, {
        type: 'profile',
        payload: this.myProfile,
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

  public updateProfile(profile: Partial<User>) {
    this.myProfile = profile;
    this.broadcast({ type: 'profile', payload: profile });
  }

  public destroy() {
    this.peer?.destroy();
  }
}

export default PeerService;
