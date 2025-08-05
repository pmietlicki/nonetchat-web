import Peer, { DataConnection } from 'peerjs';
import { User } from '../types';

interface MessagePayload {
  type: 'message' | 'profile-update' | 'file-info';
  payload: any;
}

class PeerService {
  private static instance: PeerService;
  public peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();

  public onPeerOpen: (id: string) => void = () => {};
  public onPeerList: (peerIds: string[]) => void = () => {};
  public onNewConnection: (conn: DataConnection) => void = () => {};
  public onConnectionClose: (conn: DataConnection) => void = () => {};
  public onData: (peerId: string, data: MessagePayload) => void = () => {};
  public onError: (error: any) => void = () => {};

  public static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  public initialize(userId: string, signalingUrl: string) {
    if (this.peer) {
      this.peer.destroy();
    }

    const url = new URL(signalingUrl);
    this.peer = new Peer(userId, {
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'wss:' ? 443 : 80),
      path: url.pathname,
      secure: url.protocol === 'wss:',
    });

    this.peer.on('open', async (id) => {
      this.onPeerOpen(id);
      // Récupérer la liste des pairs existants
      const response = await fetch(`https://${url.hostname}:${url.port}${url.pathname}/peers`);
      const peerIds = await response.json();
      this.onPeerList(peerIds.filter((pId: string) => pId !== id));
    });

    this.peer.on('connection', (conn) => {
      this.setupConnection(conn);
      this.onNewConnection(conn);
    });

    this.peer.on('error', (err) => {
      this.onError(err);
    });
  }

  private setupConnection(conn: DataConnection) {
    this.connections.set(conn.peer, conn);
    conn.on('data', (data) => {
      this.onData(conn.peer, data as MessagePayload);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.onConnectionClose(conn);
    });
  }

  public connect(peerId: string): DataConnection {
    if (this.connections.has(peerId)) {
      return this.connections.get(peerId)!;
    }
    const conn = this.peer!.connect(peerId);
    this.setupConnection(conn);
    return conn;
  }

  public sendMessage(peerId: string, message: string) {
    const payload: MessagePayload = { type: 'message', payload: message };
    this.connections.get(peerId)?.send(payload);
  }

  public sendProfile(peerId: string, profile: Partial<User>) {
    const payload: MessagePayload = { type: 'profile-update', payload: profile };
    this.connections.get(peerId)?.send(payload);
  }

  public broadcast(payload: MessagePayload) {
    this.connections.forEach(conn => conn.send(payload));
  }

  public destroy() {
    this.peer?.destroy();
    this.peer = null;
  }
}

export default PeerService;
