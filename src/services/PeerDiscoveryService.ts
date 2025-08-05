import { PeerConnection, User } from '../types';

class PeerDiscoveryService {
  private static instance: PeerDiscoveryService;
  private peers: Map<string, PeerConnection> = new Map();
  private discoveryInterval: NodeJS.Timeout | null = null;
  private listeners: Set<(peers: PeerConnection[]) => void> = new Set();

  public static getInstance(): PeerDiscoveryService {
    if (!PeerDiscoveryService.instance) {
      PeerDiscoveryService.instance = new PeerDiscoveryService();
    }
    return PeerDiscoveryService.instance;
  }

  startDiscovery(): void {
    this.discoveryInterval = setInterval(() => {
      this.simulateDiscovery();
    }, 5000);
    
    // Découverte initiale
    this.simulateDiscovery();
  }

  stopDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }

  private simulateDiscovery(): void {
    const mockUsers: User[] = [
      {
        id: '1',
        name: 'Alice Dupont',
        avatar: 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=400',
        status: Math.random() > 0.3 ? 'online' : 'offline',
        lastSeen: new Date(),
        publicKey: 'mock_key_1'
      },
      {
        id: '2',
        name: 'Bob Martin',
        avatar: 'https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?auto=compress&cs=tinysrgb&w=400',
        status: Math.random() > 0.3 ? 'online' : 'busy',
        lastSeen: new Date(),
        publicKey: 'mock_key_2'
      },
      {
        id: '3',
        name: 'Claire Rousseau',
        avatar: 'https://images.pexels.com/photos/1542085/pexels-photo-1542085.jpeg?auto=compress&cs=tinysrgb&w=400',
        status: Math.random() > 0.3 ? 'online' : 'offline',
        lastSeen: new Date(),
        publicKey: 'mock_key_3'
      }
    ];

    mockUsers.forEach(user => {
      const connection: PeerConnection = {
        id: user.id,
        user,
        connection: Math.random() > 0.5 ? 'wifi' : 'bluetooth',
        signal: Math.floor(Math.random() * 100),
        isConnected: user.status === 'online',
        discoveredAt: new Date()
      };

      this.peers.set(user.id, connection);
    });

    this.notifyListeners();
  }

  getPeers(): PeerConnection[] {
    return Array.from(this.peers.values());
  }

  addListener(listener: (peers: PeerConnection[]) => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: (peers: PeerConnection[]) => void): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const peers = this.getPeers();
    this.listeners.forEach(listener => listener(peers));
  }

  async connectToPeer(peerId: string): Promise<boolean> {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.isConnected = true;
      peer.user.status = 'online';
      this.notifyListeners();
      return true;
    }
    return false;
  }

  async disconnectFromPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.isConnected = false;
      peer.user.status = 'offline';
      this.notifyListeners();
    }
  }
}

export default PeerDiscoveryService;