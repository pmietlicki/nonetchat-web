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
  private lastSeen: Map<string, number> = new Map();
  private pruneInterval: number | null = null;
  private heartbeatInterval: number | null = null;
  private searchRadius: number = 1.0; // Default 1km radius

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
    this.diagnosticService.log('Initializing PeerService with Stable ID');
    if (this.ws) {
      this.destroy();
    }

    this.myId = profile.id!;
    this.myProfile = profile;
    await this.cryptoService.initialize();
    await this.loadBlockList();

    this.ws = new WebSocket(signalingUrl);

    this.ws.onopen = () => {
      this.diagnosticService.log('WebSocket connection opened. Registering with stable ID.');
      this.sendToServer({ type: 'register', payload: { id: this.myId } });
      this.emit('open', this.myId);
      this.startLocationUpdates(); // Location updates will now send radius
      this.startPruningInterval();
      this.startHeartbeat();
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
      this.emit('disconnected');
      if (this.pruneInterval) {
        clearInterval(this.pruneInterval);
        this.pruneInterval = null;
      }
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    };
  }

  public setSearchRadius(radius: number) {
    this.searchRadius = radius;
    this.diagnosticService.log(`Search radius updated to ${radius}km`);
    // Trigger a location update to refresh peers with the new radius
    this.startLocationUpdates();
  }

  private startLocationUpdates() {
    if (!('geolocation' in navigator)) {
      this.diagnosticService.log('Geolocation is not supported by this browser.');
      this.sendToServer({ type: 'request-lan-discovery' });
      return;
    }

    // Get a single, fresh location update
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        this.diagnosticService.log('Location obtained', { latitude, longitude });
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
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  }

  private startPruningInterval() {
    const PRUNE_INTERVAL = 30000;
    const GRACE_PERIOD = 60000;

    this.pruneInterval = window.setInterval(() => {
      const now = Date.now();
      this.peerConnections.forEach((_, peerId) => {
        if (!this.lastSeen.has(peerId)) return;
        if (now - this.lastSeen.get(peerId)! > GRACE_PERIOD) {
          this.diagnosticService.log(`Peer ${peerId} has not been seen for over ${GRACE_PERIOD / 1000}s. Pruning connection.`);
          this.closePeerConnection(peerId);
          this.lastSeen.delete(peerId);
        }
      });
    }, PRUNE_INTERVAL);
  }

  private startHeartbeat() {
    // Send heartbeat every 25 seconds to keep connection alive
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendToServer({ type: 'heartbeat', payload: { timestamp: Date.now() } });
        this.diagnosticService.log('Heartbeat sent to maintain connection');
      }
    }, 25000); // 25 seconds - slightly less than server timeout
  }

  private sendToServer(message: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async handleSignalingMessage(message: any) {
    if (message.from && this.blockList.has(message.from)) {
      return;
    }

    this.diagnosticService.log('Received message from server', message);
    switch (message.type) {
      case 'nearby-peers':
        const allPeers = message.peers.map((p: any) => p.peerId).filter((id: string) => !this.blockList.has(id));
        
        this.lastSeen = new Map(allPeers.map((id: string) => [id, Date.now()]));

        for (const peerId of allPeers) {
          if (!this.peerConnections.has(peerId)) {
            this.createPeerConnection(peerId);
          }
        }
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
    }
  }

  private async createPeerConnection(peerId: string) {
    if (this.peerConnections.has(peerId)) return;

    const isInitiator = this.myId > peerId;
    this.diagnosticService.log(`Creating peer connection to ${peerId}. Initiator: ${isInitiator}`);

    const pc = new RTCPeerConnection(this.ICE_SERVERS);
    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendToServer({ type: 'candidate', payload: { to: peerId, from: this.myId, payload: event.candidate } });
      }
    };

    pc.onconnectionstatechange = () => {
      this.diagnosticService.log(`Connection state with ${peerId} changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closePeerConnection(peerId);
      }
    };

    if (isInitiator) {
      const dataChannel = pc.createDataChannel('chat');
      this.setupDataChannel(peerId, dataChannel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendToServer({ type: 'offer', payload: { to: peerId, from: this.myId, payload: pc.localDescription } });
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
      this.diagnosticService.log(`Data channel with ${peerId} opened. Initiating key exchange.`);
      const myPublicKey = await this.cryptoService.getPublicKeyJwk();
      this.sendToPeer(peerId, { type: 'key-exchange', payload: myPublicKey });
    };

    channel.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      this.diagnosticService.log(`[${peerId}] Received message over data channel`, message);

      if (message.type === 'key-exchange') {
        await this.cryptoService.deriveSharedSecret(peerId, message.payload);
        this.diagnosticService.log(`Secure channel established with ${peerId}`);
        this.emit('peer-joined', peerId);

        const queue = this.messageQueue.get(peerId) || [];
        if (queue.length > 0) {
          for (const msg of queue) { await this.sendToPeer(peerId, msg); }
          this.messageQueue.delete(peerId);
        }

        const profileToSend = { ...this.myProfile, status: 'online' };
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
      this.closePeerConnection(peerId);
    };
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    await this.createPeerConnection(from);
    const pc = this.peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendToServer({ type: 'answer', payload: { to: from, from: this.myId, payload: pc.localDescription } });
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleCandidate(from: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(from);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private closePeerConnection(peerId: string) {
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

  public async sendToPeer(peerId: string, message: PeerMessage) {
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel && dataChannel.readyState === 'open') {
      let payload = message.payload;
      if (message.type === 'chat-message') {
        payload = await this.cryptoService.encryptMessage(peerId, payload);
      }
      dataChannel.send(JSON.stringify({ ...message, payload }));
    } else {
      if (!this.messageQueue.has(peerId)) this.messageQueue.set(peerId, []);
      this.messageQueue.get(peerId)!.push(message);
    }
  }

  public sendMessage(peerId: string, content: string) {
    this.sendToPeer(peerId, { type: 'chat-message', payload: content });
  }

  private async loadBlockList() {
    const list = await this.dbService.getBlockList();
    this.blockList = new Set(list);
  }

  public async blockPeer(peerId: string) {
    this.blockList.add(peerId);
    await this.dbService.addToBlockList(peerId);
    this.closePeerConnection(peerId);
  }

  public async unblockPeer(peerId: string) {
    this.blockList.delete(peerId);
    await this.dbService.removeFromBlockList(peerId);
  }

  public destroy() {
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.ws?.close();
    this.peerConnections.forEach((_, peerId) => this.closePeerConnection(peerId));
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.messageQueue.clear();
  }
}

export default PeerService;