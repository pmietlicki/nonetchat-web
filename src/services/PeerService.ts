import Peer, { DataConnection } from 'peerjs';
import { User } from '../types';
import CryptoService from './CryptoService';
import { DiagnosticService } from './DiagnosticService';

export interface PeerMessage {
  type: 'profile' | 'chat-message' | 'key-exchange' | 'ping' | 'pong';
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
  private pingInterval: NodeJS.Timeout | null = null;
  private cryptoService: CryptoService;
  private reconnectAttempts: Map<string, number> = new Map();
  private diagnosticService: DiagnosticService;
  private lastDiscoveredPeers: string[] = [];
  private connectionAttempts: Map<string, number> = new Map();
  private initParams: { userId: string; profile: Partial<User>; signalingUrl: string } | null = null;

  private constructor() {
    super();
    this.cryptoService = CryptoService.getInstance();
    this.diagnosticService = DiagnosticService.getInstance();
  }

  public static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  public async initialize(userId: string, profile: Partial<User>, signalingUrl: string) {
    this.diagnosticService.log('Initializing Enhanced PeerService', { userId, signalingUrl });
    
    // Store initialization parameters
    this.initParams = { userId, profile, signalingUrl };
    
    if (this.peer) {
      this.diagnosticService.log('Destroying existing peer connection');
      await this.destroy();
      // Wait a bit to ensure complete cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
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
          // Google STUN servers
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          // Additional STUN servers for better connectivity
          { urls: 'stun:stun.stunprotocol.org:3478' },
          { urls: 'stun:stun.voiparound.com' },
          { urls: 'stun:stun.voipbuster.com' },
          // TURN servers for NAT traversal
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
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
        iceCandidatePoolSize: 15,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceConnectionReceivingTimeout: 4000,
        iceBackupCandidatePairPingInterval: 2000
      },
      debug: 2 // Enable debug logs
    };

    this.diagnosticService.log('Enhanced PeerJS options', peerOptions);
    this.peer = new Peer(userId, peerOptions);

    this.peer.on('open', (id) => {
      this.diagnosticService.log('Enhanced peer connection opened', { id });
      console.log('My peer ID is: ' + id);
      this.emit('open', id);
      
      // Start discovery immediately and then at intervals
      this.discoverPeers();
      if (this.discoveryInterval) clearInterval(this.discoveryInterval);
      this.discoveryInterval = setInterval(() => this.discoverPeers(), 5000); // More frequent discovery
      
      // Start ping mechanism
      this.startPingMechanism();
    });

    this.peer.on('connection', (conn) => {
      this.diagnosticService.log('Enhanced incoming connection received', { peerId: conn.peer });
      this.setupConnection(conn);
    });
    
    this.peer.on('error', (err) => {
      this.diagnosticService.log('Enhanced PeerJS Error', err);
      console.error('PeerJS Error:', err);
      this.emit('error', err);
      
      // Handle 'ID is taken' error
      if (err.message && err.message.includes('is taken')) {
        this.diagnosticService.log('ID collision detected, forcing complete cleanup and retry');
        setTimeout(async () => {
          if (this.initParams) {
            await this.destroy();
            // Generate a new ID by appending timestamp
            const newUserId = `${this.initParams.userId}-${Date.now()}`;
            this.diagnosticService.log('Reinitializing with new ID', { newUserId });
            await this.initialize(newUserId, this.initParams.profile, this.initParams.signalingUrl);
          }
        }, 1000);
        return;
      }
      
      // Auto-reconnect on certain errors
      if (err.type === 'disconnected' || err.type === 'network') {
        this.diagnosticService.log('Attempting auto-reconnect due to network error');
        setTimeout(() => {
          if (this.peer && this.peer.destroyed && this.initParams) {
            this.initialize(this.initParams.userId, this.initParams.profile, this.initParams.signalingUrl);
          }
        }, 3000);
      }
    });

    this.peer.on('disconnected', () => {
      this.diagnosticService.log('Peer disconnected from server, attempting reconnect');
      if (!this.peer?.destroyed) {
        this.peer?.reconnect();
      }
    });
  }

  private discoverPeers() {
    this.diagnosticService.log('Starting enhanced peer discovery');
    
    if (!this.peer || this.peer.destroyed) {
      this.diagnosticService.log('Cannot discover peers - peer not available');
      return;
    }

    this.peer.listAllPeers((peerIds) => {
      this.diagnosticService.log('Enhanced discovered peers', { 
        totalPeers: peerIds.length, 
        peerIds, 
        myId: this.peer?.id,
        previousPeers: this.lastDiscoveredPeers
      });
      
      // Check for new peers
      const newPeers = peerIds.filter(id => 
        id !== this.peer?.id && 
        !this.lastDiscoveredPeers.includes(id)
      );
      
      if (newPeers.length > 0) {
        this.diagnosticService.log('New peers detected', { newPeers });
      }
      
      this.lastDiscoveredPeers = peerIds;
      
      peerIds.forEach(peerId => {
        if (this.peer && peerId !== this.peer.id) {
          if (!this.connections.has(peerId)) {
            this.diagnosticService.log('Attempting to connect to discovered peer', { peerId });
            this.connect(peerId);
          } else {
            this.diagnosticService.log('Already connected to peer', { peerId });
          }
        } else if (peerId === this.peer?.id) {
          this.diagnosticService.log('Skipping self in peer list', { peerId });
        }
      });
      
      if (peerIds.length === 0) {
        this.diagnosticService.log('No peers discovered - server may be empty or unreachable');
      } else if (peerIds.length === 1 && peerIds[0] === this.peer?.id) {
        this.diagnosticService.log('Only self discovered - no other peers on server');
      }
    });
  }

  public connect(peerId: string) {
    const attempts = this.connectionAttempts.get(peerId) || 0;
    
    if (this.connections.has(peerId)) {
      this.diagnosticService.log('Enhanced connection already exists', { peerId });
      return;
    }
    
    if (!this.peer || this.peer.destroyed) {
      this.diagnosticService.log('Cannot connect - peer not initialized', { peerId });
      return;
    }

    if (attempts >= 5) {
      this.diagnosticService.log('Max connection attempts reached', { peerId, attempts });
      return;
    }

    this.connectionAttempts.set(peerId, attempts + 1);
    this.diagnosticService.log('Enhanced initiating connection to peer', { peerId, attempt: attempts + 1 });
    console.log(`Attempting to connect to peer: ${peerId} (attempt ${attempts + 1})`);
    
    try {
      const conn = this.peer.connect(peerId, { 
        reliable: true,
        serialization: 'json',
        metadata: { timestamp: Date.now() }
      });
      
      this.diagnosticService.log('Connection object created', { 
        peerId, 
        connectionId: conn.connectionId,
        open: conn.open,
        reliable: conn.reliable
      });
      
      // Set a shorter timeout for faster failure detection
      const connectionTimeout = setTimeout(() => {
        if (!conn.open) {
          this.diagnosticService.log('Connection timeout', { 
            peerId, 
            connectionId: conn.connectionId,
            readyState: conn.readyState,
            open: conn.open
          });
          conn.close();
          
          // Retry with exponential backoff if under max attempts
          if (attempts < 5) {
            const delay = Math.min(1000 * Math.pow(1.5, attempts), 8000);
            this.diagnosticService.log('Scheduling retry', { peerId, delay, nextAttempt: attempts + 1 });
            setTimeout(() => {
              this.connect(peerId);
            }, delay);
          }
        }
      }, 6000); // Reduced from 10s to 6s
      
      conn.on('open', () => {
        clearTimeout(connectionTimeout);
        this.connectionAttempts.delete(peerId); // Reset attempts on success
        this.diagnosticService.log('Connection successfully opened', { 
          peerId, 
          connectionId: conn.connectionId,
          totalConnections: this.connections.size + 1
        });
      });
      
      this.setupConnection(conn);
    } catch (error) {
      this.diagnosticService.log('Enhanced failed to create connection', { peerId, error, attempt: attempts + 1 });
      
      // Retry after delay
      setTimeout(() => {
        this.connect(peerId);
      }, 2000 * (attempts + 1)); // Exponential backoff
    }
  }

  private setupConnection(conn: DataConnection) {
    const peerId = conn.peer;
    this.diagnosticService.log('Enhanced setting up connection', { 
      peerId, 
      connectionState: conn.open,
      connectionId: conn.connectionId,
      reliable: conn.reliable,
      readyState: conn.readyState,
      type: conn.type
    });

    if (this.connections.has(peerId)) {
      this.diagnosticService.log('Enhanced glare detected - simultaneous connections', { peerId, myId: this.peer!.id });
      console.log(`Glare detected with ${peerId}. Applying resolution logic.`);
      const existingConn = this.connections.get(peerId)!;
      
      // Enhanced glare resolution
      if (this.peer!.id > peerId) {
        this.diagnosticService.log('Enhanced closing incoming connection (my ID is greater)', { peerId });
        console.log(`My ID is greater. Closing incoming connection from ${peerId}.`);
        conn.close();
        return;
      } else {
        this.diagnosticService.log('Enhanced closing existing connection (my ID is smaller)', { peerId });
        console.log(`My ID is smaller. Closing existing connection and accepting new one from ${peerId}.`);
        existingConn.close();
        this.connections.delete(peerId);
      }
    }
    
    this.connections.set(peerId, conn);
    this.diagnosticService.log('Connection added to map', { 
      peerId, 
      totalConnections: this.connections.size,
      connectionId: conn.connectionId,
      isAlreadyOpen: conn.open
    });
    
    // Check if connection is already open (race condition)
    if (conn.open) {
      this.diagnosticService.log('⚡ Connection already open, emitting peer-joined immediately', { peerId });
      this.reconnectAttempts.set(peerId, 0);
      this.connectionAttempts.delete(peerId);
      this.emit('peer-joined', peerId);
      
      // Send key exchange
      (async () => {
        const myPublicKey = await this.cryptoService.getPublicKeyJwk();
        this.send(peerId, { type: 'key-exchange', payload: myPublicKey });
      })();
    }

    conn.on('open', async () => {
      this.diagnosticService.log('🎉 Enhanced connection opened successfully', { 
        peerId, 
        connectionId: conn.connectionId,
        reliable: conn.reliable,
        readyState: conn.readyState
      });
      console.log(`🎉 Connection established with ${peerId}`);
      this.reconnectAttempts.set(peerId, 0);
      this.connectionAttempts.delete(peerId);
      
      this.diagnosticService.log('📢 Emitting peer-joined event', { peerId });
      this.emit('peer-joined', peerId);

      const myPublicKey = await this.cryptoService.getPublicKeyJwk();
      this.send(peerId, { type: 'key-exchange', payload: myPublicKey });
    });
    
    // Add diagnostic timeout to check if connection opens
    setTimeout(() => {
      if (!conn.open) {
        this.diagnosticService.log('⚠️ Connection never opened - diagnostic info', {
          peerId,
          connectionId: conn.connectionId,
          open: conn.open,
          readyState: conn.readyState,
          reliable: conn.reliable,
          type: conn.type,
          connectionState: conn.peerConnection?.connectionState,
          iceConnectionState: conn.peerConnection?.iceConnectionState,
          iceGatheringState: conn.peerConnection?.iceGatheringState
        });
      }
    }, 8000);
    
    // Monitor WebRTC connection state changes
    if (conn.peerConnection) {
      const pc = conn.peerConnection;
      
      const checkConnectionState = () => {
        this.diagnosticService.log('WebRTC state update', {
          peerId,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          connOpen: conn.open
        });
        
        // If WebRTC is connected but PeerJS connection isn't open, force peer-joined
        if ((pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') && !conn.open) {
          this.diagnosticService.log('🔧 WebRTC connected but PeerJS not open - forcing peer-joined', { peerId });
          this.reconnectAttempts.set(peerId, 0);
          this.connectionAttempts.delete(peerId);
          this.emit('peer-joined', peerId);
        }
      };
      
      pc.addEventListener('connectionstatechange', checkConnectionState);
      pc.addEventListener('iceconnectionstatechange', checkConnectionState);
    }

    conn.on('data', async (data) => {
      const message = data as PeerMessage;
      this.diagnosticService.log('Enhanced received data', { peerId, messageType: message.type });

      if (message.type === 'ping') {
        this.send(peerId, { type: 'pong', payload: Date.now() });
        return;
      }

      if (message.type === 'pong') {
        this.diagnosticService.log('Enhanced received pong', { peerId, timestamp: message.payload });
        return;
      }

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

    conn.on('close', () => {
      this.diagnosticService.log('Enhanced connection closed', { 
        peerId, 
        connectionId: conn.connectionId,
        wasOpen: conn.open,
        readyState: conn.readyState,
        remainingConnections: this.connections.size - 1
      });
      this.handleDisconnect(peerId, 'Connection closed');
    });
    
    conn.on('error', (err) => {
      this.diagnosticService.log('Enhanced connection error', { 
        peerId, 
        connectionId: conn.connectionId,
        error: err.message,
        errorType: err.type,
        readyState: conn.readyState,
        wasOpen: conn.open
      });
      console.error(`Connection error with ${peerId}:`, err);
      this.handleDisconnect(peerId, `Connection error: ${err.message}`);
    });
  }

  private handleDisconnect(peerId: string, reason: string) {
    if (!this.connections.has(peerId)) return;

    this.diagnosticService.log('Enhanced handling disconnect', { peerId, reason });
    console.log(`Disconnected from ${peerId}. Reason: ${reason}`);
    this.connections.delete(peerId);
    this.emit('peer-left', peerId);

    const attempts = (this.reconnectAttempts.get(peerId) || 0) + 1;
    this.reconnectAttempts.set(peerId, attempts);

    // More aggressive reconnection for local networks
    const delay = Math.min(15000, Math.pow(1.5, attempts) * 1000); // Faster reconnection

    this.diagnosticService.log('Enhanced scheduling reconnect', { peerId, delay: delay / 1000, attempt: attempts });
    console.log(`Scheduling reconnect to ${peerId} in ${delay / 1000}s (attempt ${attempts})`);
    
    setTimeout(() => {
      if (!this.connections.has(peerId)) {
        this.connect(peerId);
      }
    }, delay);
  }

  private startPingMechanism() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    
    this.pingInterval = setInterval(() => {
      this.connections.forEach((conn, peerId) => {
        if (conn.open) {
          this.send(peerId, { type: 'ping', payload: Date.now() });
        }
      });
    }, 30000); // Ping every 30 seconds
  }

  private async send(peerId: string, message: PeerMessage) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.open) {
      this.diagnosticService.log('Enhanced cannot send message - connection not open', { peerId, messageType: message.type });
      console.warn(`Cannot send message to ${peerId}, connection not open.`);
      return;
    }

    let payload = message.payload;
    if (message.type === 'chat-message') {
      payload = await this.cryptoService.encryptMessage(peerId, payload);
    }

    try {
      conn.send({ ...message, payload });
      this.diagnosticService.log('Enhanced message sent successfully', { peerId, messageType: message.type });
    } catch (error) {
      this.diagnosticService.log('Enhanced failed to send message', { peerId, messageType: message.type, error });
    }
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

  public getConnectedPeers(): string[] {
    return Array.from(this.connections.keys()).filter(peerId => {
      const conn = this.connections.get(peerId);
      return conn && conn.open;
    });
  }

  public isConnectedToPeer(peerId: string): boolean {
    const conn = this.connections.get(peerId);
    return conn ? conn.open : false;
  }

  public async destroy() {
    this.diagnosticService.log('Enhanced destroying peer service');
    
    // Clear all intervals
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Close all connections
    this.connections.forEach(conn => {
      try {
        conn.close();
      } catch (e) {
        this.diagnosticService.log('Error closing connection', { error: e });
      }
    });
    this.connections.clear();
    
    // Clear all state maps
    this.reconnectAttempts.clear();
    this.connectionAttempts.clear();
    this.lastDiscoveredPeers = [];
    
    // Destroy peer connection
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        this.diagnosticService.log('Error destroying peer', { error: e });
      }
      this.peer = null;
    }
    
    // Wait for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Diagnostic methods
  public getConnectionStats() {
    return {
      totalConnections: this.connections.size,
      openConnections: this.getConnectedPeers().length,
      reconnectAttempts: Object.fromEntries(this.reconnectAttempts),
      connectionAttempts: Object.fromEntries(this.connectionAttempts),
      lastDiscoveredPeers: this.lastDiscoveredPeers
    };
  }
}

export default PeerService;