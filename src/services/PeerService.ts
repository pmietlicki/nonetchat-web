
import { User } from '../types';
import CryptoService from './CryptoService';
import IndexedDBService from './IndexedDBService';
import { DiagnosticService } from './DiagnosticService';

export interface PeerMessage {
  type: 'profile' | 'chat-message' | 'key-exchange' | 'file-start' | 'file-chunk' | 'file-end';
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
  private ws: WebSocket | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private messageQueue: Map<string, PeerMessage[]> = new Map();
  private myId: string = '';
  private myProfile: Partial<User> = {};
  private cryptoService: CryptoService;
  private diagnosticService: DiagnosticService;
  private dbService: IndexedDBService;
  private blockList: Set<string> = new Set();
  private locationWatcherId: number | null = null;
  private searchRadius: number = 1.0; // Default 1km radius
  private connectionCheckInterval: number | null = null;
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  private ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    ],
  };

  private constructor() {
    super();
    this.cryptoService = CryptoService.getInstance();
    this.diagnosticService = DiagnosticService.getInstance();
    this.dbService = IndexedDBService.getInstance();
  }

  public static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  public async initialize(profile: Partial<User>, signalingUrl: string) {
    this.diagnosticService.log('Initializing Geo-PeerService');
    if (this.ws) {
      this.destroy();
    }

    this.myProfile = profile;
    await this.cryptoService.initialize();
    await this.loadBlockList();

    this.ws = new WebSocket(signalingUrl);

    this.ws.onopen = () => {
      this.diagnosticService.log('WebSocket connection opened');
      this.startLocationUpdates();
      this.startConnectionMonitoring();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSignalingMessage(message);
    };

    this.ws.onerror = (error) => {
      this.diagnosticService.log('WebSocket Error', error);
      this.emit('error', error);
    };

    this.ws.onclose = () => {
      this.diagnosticService.log('WebSocket connection closed');
      this.stopLocationUpdates();
      this.emit('disconnected');
    };
  }

  private startLocationUpdates() {
    if (!('geolocation' in navigator)) {
      this.diagnosticService.log('Geolocation is not supported by this browser.');
      return;
    }

    this.locationWatcherId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        this.diagnosticService.log('Location updated', { latitude, longitude });
        this.sendToServer({ 
          type: 'update-location', 
          payload: { location: { latitude, longitude }, radius: this.searchRadius }
        });
      },
      (error) => {
        this.diagnosticService.log('Geolocation Error, switching to LAN mode', error);
        this.emit('geolocation-error', error);
        this.sendToServer({ type: 'request-lan-discovery' });
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
    );
  }

  private stopLocationUpdates() {
    if (this.locationWatcherId !== null) {
      navigator.geolocation.clearWatch(this.locationWatcherId);
    }
  }

  private startConnectionMonitoring() {
    // Check connection health every 30 seconds
    this.connectionCheckInterval = window.setInterval(() => {
      this.checkConnectionHealth();
    }, 30000);
  }

  private checkConnectionHealth() {
    for (const [peerId, pc] of this.peerConnections) {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        const attempts = this.reconnectAttempts.get(peerId) || 0;
        if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.diagnosticService.log(`Connection to ${peerId} is ${pc.connectionState}, attempting reconnect (${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
          this.reconnectAttempts.set(peerId, attempts + 1);
          this.handleConnectionFailure(peerId);
        } else {
          this.diagnosticService.log(`Max reconnect attempts reached for ${peerId}, closing connection`);
          this.closePeerConnection(peerId);
          this.reconnectAttempts.delete(peerId);
        }
      } else if (pc.connectionState === 'connected') {
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts.delete(peerId);
      }
    }
  }

  private sendToServer(message: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async handleSignalingMessage(message: any) {
    if (message.from && this.blockList.has(message.from)) {
      this.diagnosticService.log(`Ignoring message from blocked peer ${message.from}`);
      return;
    }

    this.diagnosticService.log('Received message from server', message);
    switch (message.type) {
      case 'welcome':
        this.myId = message.clientId;
        this.emit('open', this.myId);
        break;

      case 'nearby-peers':
        this.diagnosticService.log(`Received nearby-peers: ${message.peers.length} total peers`, message.peers);
        const allNearbyPeers = message.peers.map((p: any) => p.peerId);
        const filteredPeers = message.peers.filter((p: any) => !this.blockList.has(p.peerId));
        const filteredPeerIds = filteredPeers.map((p: any) => p.peerId);
        
        this.diagnosticService.log(`Filtered peers: ${filteredPeers.length} (blocked: ${message.peers.length - filteredPeers.length})`);

        // Connect to new, unblocked peers
        for (const peer of filteredPeers) {
          if (!this.peerConnections.has(peer.peerId)) {
            this.createPeerConnection(peer.peerId);
          }
        }
        // Disconnect from peers that are no longer nearby or are blocked
        this.peerConnections.forEach((_, peerId) => {
          if (!filteredPeerIds.includes(peerId)) {
            this.diagnosticService.log(`Disconnecting from peer no longer nearby: ${peerId}`);
            this.closePeerConnection(peerId);
          }
        });
        break;

      case 'offer':
        await this.handleOffer(message.from, message.payload);
        break;

      case 'answer':
        await this.handleAnswer(message.from, message.payload);
        break;

      case 'candidate':
        await this.handleCandidate(message.from, message.payload);
        break;

      case 'ping':
        this.sendToServer({ type: 'pong' });
        break;
    }
  }

  private async createPeerConnection(peerId: string) {
    this.diagnosticService.log(`Creating peer connection to ${peerId}`);
    if (this.peerConnections.has(peerId)) {
      this.diagnosticService.log(`Connection to ${peerId} already exists or is in progress.`);
      return;
    }

    // Glare resolution: deterministically decide which peer is the initiator.
    // The peer with the greater ID will initiate the connection.
    const isInitiator = this.myId > peerId;
    this.diagnosticService.log(`Is initiator: ${isInitiator}`, { myId: this.myId, peerId });

    const pc = new RTCPeerConnection(this.ICE_SERVERS);
    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendToServer({ 
          type: 'candidate', 
          payload: { to: peerId, from: this.myId, payload: event.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      this.diagnosticService.log(`Connection state with ${peerId} changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        this.handleConnectionFailure(peerId);
      }
      // Note: 'disconnected' can be a temporary state during network changes, 
      // so we rely on 'failed' for definitive action.
    };

    pc.oniceconnectionstatechange = () => {
        if(pc.iceConnectionState === 'disconnected') {
            this.diagnosticService.log(`ICE connection with ${peerId} disconnected. Attempting ICE restart.`);
            this.handleConnectionFailure(peerId); // Attempt a reconnect
        }
    }

    if (isInitiator) {
      const dataChannel = pc.createDataChannel('chat');
      this.setupDataChannel(peerId, dataChannel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendToServer({ 
        type: 'offer', 
        payload: { to: peerId, from: this.myId, payload: pc.localDescription }
      });
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(peerId, event.channel);
      };
    }
  }

  private setupDataChannel(peerId: string, channel: RTCDataChannel) {
    this.diagnosticService.log(`Setting up data channel with ${peerId}`);
    this.dataChannels.set(peerId, channel);

    channel.onopen = async () => {
      this.diagnosticService.log(`Data channel with ${peerId} opened.`);
      this.emit('peer-joined', peerId);

      // Send any queued messages
        const queue = this.messageQueue.get(peerId) || [];
        if (queue.length > 0) {
          this.diagnosticService.log(`Sending ${queue.length} queued messages to ${peerId}`);
          // Process the queue sequentially, awaiting each send
          for (const msg of queue) {
            await this.sendToPeer(peerId, msg);
          }
          this.messageQueue.delete(peerId);
        }

      // Exchange keys and profile info
      const myPublicKey = await this.cryptoService.getPublicKeyJwk();
      this.sendToPeer(peerId, { type: 'key-exchange', payload: myPublicKey });
    };

    channel.onmessage = async (event) => {
      // File chunks are ArrayBuffers, other messages are JSON strings
      if (event.data instanceof ArrayBuffer) {
        // This is a file chunk, handle it separately
        // For simplicity, we'll handle this logic directly in the component for now
        this.emit('data', peerId, { type: 'file-chunk', payload: event.data });
        return;
      }

      const message = JSON.parse(event.data);
      this.diagnosticService.log(`[${peerId}] Received message over data channel`, message);

      if (message.type === 'key-exchange') {
        await this.cryptoService.deriveSharedSecret(peerId, message.payload);
        const profileToSend = { ...this.myProfile, status: 'online' }; // Explicitly set status to online
        const ProfileService = (await import('./ProfileService')).default;
        const profileService = ProfileService.getInstance();
        const avatarBase64 = await profileService.getAvatarAsBase64();
        if (avatarBase64) profileToSend.avatar = avatarBase64;
        this.sendToPeer(peerId, { type: 'profile', payload: profileToSend });
      } else if (message.type === 'chat-message') {
        const decrypted = await this.cryptoService.decryptMessage(peerId, message.payload);
        this.emit('data', peerId, { type: 'chat-message', payload: decrypted });
      } else {
        this.emit('data', peerId, message);
      }
    };

    channel.onclose = () => {
      this.diagnosticService.log(`Data channel with ${peerId} closed.`);
      // Emit peer-left but don't immediately close the connection
      // The connection might recover
      this.emit('peer-left', peerId);
    };

    channel.onerror = (error) => {
      this.diagnosticService.log(`Data channel error with ${peerId}:`, error);
      // Try to recover the connection
      setTimeout(() => {
        if (!this.dataChannels.has(peerId) || this.dataChannels.get(peerId)?.readyState !== 'open') {
          this.handleConnectionFailure(peerId);
        }
      }, 1000); // Wait 1 second before attempting recovery
    };
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    this.diagnosticService.log(`Handling offer from ${from}`);
    
    // If we receive an offer, we are by definition the non-initiator.
    await this.createPeerConnection(from);
    const pc = this.peerConnections.get(from);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendToServer({ 
          type: 'answer', 
          payload: { to: from, from: this.myId, payload: pc.localDescription }
        });
        this.diagnosticService.log(`Successfully handled offer from ${from}`);
      } catch (error) {
        this.diagnosticService.log(`Error handling offer from ${from}:`, error);
        this.closePeerConnection(from);
      }
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    this.diagnosticService.log(`Handling answer from ${from}`);
    const pc = this.peerConnections.get(from);
    if (pc) {
      this.diagnosticService.log(`Connection state: ${pc.connectionState}, Signaling state: ${pc.signalingState}`);
      
      // Only set remote description if we're in the correct state
      if (pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          this.diagnosticService.log(`Successfully set remote description for ${from}`);
        } catch (error) {
          this.diagnosticService.log(`Error setting remote description for ${from}:`, error);
          // If there's an error, close and recreate the connection
          this.closePeerConnection(from);
        }
      } else {
        this.diagnosticService.log(`Ignoring answer from ${from} - wrong signaling state: ${pc.signalingState}`);
      }
    }
  }

  private async handleCandidate(from: string, candidate: RTCIceCandidateInit) {
    this.diagnosticService.log(`Handling ICE candidate from ${from}`);
    const pc = this.peerConnections.get(from);
    if (pc && candidate) {
      this.diagnosticService.log(`Connection state: ${pc.connectionState}, Signaling state: ${pc.signalingState}`);
      
      // Only add ICE candidates if we have a remote description set
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          this.diagnosticService.log(`Successfully added ICE candidate from ${from}`);
        } catch (e) {
          this.diagnosticService.log(`Error adding ICE candidate from ${from}:`, e);
        }
      } else {
        this.diagnosticService.log(`Ignoring ICE candidate from ${from} - no remote description set yet`);
      }
    } else if (!pc) {
      this.diagnosticService.log(`No peer connection found for ${from}`);
    } else {
      this.diagnosticService.log(`Invalid candidate received from ${from}`);
    }
  }

  private async handleConnectionFailure(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    // Only the initiator should attempt to restart the connection to avoid conflicts
    const isInitiator = this.myId > peerId;
    if (!isInitiator) {
        this.closePeerConnection(peerId);
        return;
    }

    this.diagnosticService.log(`Attempting ICE restart for peer ${peerId}`);
    try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        this.sendToServer({ 
            type: 'offer', 
            payload: { to: peerId, from: this.myId, payload: pc.localDescription }
        });
    } catch (error) {
        this.diagnosticService.log(`ICE restart failed for ${peerId}, closing connection.`, error);
        this.closePeerConnection(peerId);
    }
  }

  private closePeerConnection(peerId: string) {
    this.diagnosticService.log(`Closing connection with ${peerId}`);
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    if (this.dataChannels.has(peerId)) {
      this.dataChannels.delete(peerId);
    }
    this.emit('peer-left', peerId);
  }

  public async sendToPeer(peerId: string, message: PeerMessage): Promise<boolean> {
    const dataChannel = this.dataChannels.get(peerId);
    
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        let payload = message.payload;
        if (message.type === 'chat-message') {
          payload = await this.cryptoService.encryptMessage(peerId, payload);
        }
        this.diagnosticService.log(`[${peerId}] Sending message over data channel`, { type: message.type });
        dataChannel.send(JSON.stringify({ ...message, payload }));
        return true;
      } catch (error) {
        this.diagnosticService.log(`Error sending message to ${peerId}:`, error);
        // Queue the message for retry
        if (!this.messageQueue.has(peerId)) {
          this.messageQueue.set(peerId, []);
        }
        this.messageQueue.get(peerId)!.push(message);
        return false;
      }
    } else {
      this.diagnosticService.log(`Data channel to ${peerId} not open. Queuing message.`, message.type);
      if (!this.messageQueue.has(peerId)) {
        this.messageQueue.set(peerId, []);
      }
      this.messageQueue.get(peerId)!.push(message);
      return false;
    }
  }

  public async sendMessage(peerId: string, content: string): Promise<boolean> {
    return this.sendToPeer(peerId, { type: 'chat-message', payload: content });
  }

  public async sendFile(peerId: string, file: File): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const dataChannel = this.dataChannels.get(peerId);
      if (!dataChannel || dataChannel.readyState !== 'open') {
        this.diagnosticService.log(`Cannot send file to ${peerId}, data channel not open.`);
        resolve(false);
        return;
      }

      const CHUNK_SIZE = 16 * 1024; // 16KB
      const fileId = `${Date.now()}-${file.name}`;
      let offset = 0;
      let hasError = false;

      // 1. Send file metadata
      this.sendToPeer(peerId, { 
        type: 'file-start', 
        payload: { fileId, name: file.name, size: file.size, type: file.type }
      }).then(sent => {
        if (!sent) {
          resolve(false);
          return;
        }
        
        // 2. Send file in chunks
        const fileReader = new FileReader();
        
        fileReader.onload = async (e) => {
          if (hasError) return;
          
          if (e.target?.result) {
            try {
              const sent = await this.sendToPeer(peerId, { 
                type: 'file-chunk', 
                payload: { fileId, chunk: e.target.result as ArrayBuffer }
              });
              
              if (!sent) {
                hasError = true;
                resolve(false);
                return;
              }
              
              offset += (e.target.result as ArrayBuffer).byteLength;
              
              if (offset >= file.size) {
                // Send end marker
                const endSent = await this.sendToPeer(peerId, {
                  type: 'file-end',
                  payload: { fileId }
                });
                resolve(endSent);
              } else {
                readSlice(offset);
              }
            } catch (error) {
              hasError = true;
              this.diagnosticService.log(`Error sending file chunk:`, error);
              reject(error);
            }
          }
        };
        
        fileReader.onerror = () => {
          hasError = true;
          reject(new Error('Erreur de lecture du fichier'));
        };

        const readSlice = (o: number) => {
          if (hasError) return;
          const slice = file.slice(o, o + CHUNK_SIZE);
          fileReader.readAsArrayBuffer(slice);
        };

        readSlice(0);
      }).catch(reject);
    });
  }

  // --- Block List Management ---

  private async loadBlockList() {
    const list = await this.dbService.getBlockList();
    this.blockList = new Set(list);
    this.diagnosticService.log('Block list loaded', { count: this.blockList.size });
  }

  public async blockPeer(peerId: string) {
    if (this.blockList.has(peerId)) return;
    this.diagnosticService.log(`Blocking peer ${peerId}`);
    this.blockList.add(peerId);
    await this.dbService.addToBlockList(peerId);
    this.closePeerConnection(peerId); // Immediately disconnect if connected
  }

  public async unblockPeer(peerId: string) {
    if (!this.blockList.has(peerId)) return;
    this.diagnosticService.log(`Unblocking peer ${peerId}`);
    this.blockList.delete(peerId);
    await this.dbService.removeFromBlockList(peerId);
    // The peer will be rediscovered on the next nearby-peers broadcast if they are still in range
  }

  public getBlockList(): string[] {
    return Array.from(this.blockList);
  }

  public setSearchRadius(radius: number) {
    this.searchRadius = Math.max(0.1, Math.min(radius, 100)); // Limit between 0.1km and 100km
    this.diagnosticService.log(`Search radius updated to ${this.searchRadius}km`);
  }

  public getSearchRadius(): number {
    return this.searchRadius;
  }

  public requestLanDiscovery() {
    this.diagnosticService.log('Requesting LAN discovery');
    this.sendToServer({ type: 'request-lan-discovery' });
  }

  public destroy() {
    this.diagnosticService.log('Destroying PeerService');
    this.stopLocationUpdates();
    if (this.connectionCheckInterval !== null) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    this.ws?.close();
    this.peerConnections.forEach((pc, peerId) => {
      this.closePeerConnection(peerId);
    });
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.reconnectAttempts.clear();
    this.myId = '';
  }
}

export default PeerService;
