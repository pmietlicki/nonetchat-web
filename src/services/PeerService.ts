
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
  private myId: string = '';
  private myProfile: Partial<User> = {};
  private cryptoService: CryptoService;
  private diagnosticService: DiagnosticService;
  private dbService: IndexedDBService;
  private blockList: Set<string> = new Set();
  private locationWatcherId: number | null = null;

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
          payload: { location: { latitude, longitude }, radius: 1.0 } // Radius will be configurable later
        });
      },
      (error) => {
        this.diagnosticService.log('Geolocation Error', error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  private stopLocationUpdates() {
    if (this.locationWatcherId !== null) {
      navigator.geolocation.clearWatch(this.locationWatcherId);
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
        const allNearbyPeers = message.peers.map(p => p.peerId);
        const filteredPeers = message.peers.filter(p => !this.blockList.has(p.peerId));
        const filteredPeerIds = filteredPeers.map(p => p.peerId);

        // Connect to new, unblocked peers
        for (const peer of filteredPeers) {
          if (!this.peerConnections.has(peer.peerId)) {
            this.createPeerConnection(peer.peerId, true);
          }
        }
        // Disconnect from peers that are no longer nearby or are blocked
        this.peerConnections.forEach((_, peerId) => {
          if (!filteredPeerIds.includes(peerId)) {
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

  private async createPeerConnection(peerId: string, isInitiator: boolean) {
    this.diagnosticService.log(`Creating peer connection to ${peerId}`, { isInitiator });
    if (this.peerConnections.has(peerId)) {
      this.diagnosticService.log(`Connection to ${peerId} already exists.`);
      return;
    }

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
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.closePeerConnection(peerId);
      }
    };

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
      if (message.type === 'key-exchange') {
        await this.cryptoService.deriveSharedSecret(peerId, message.payload);
        const profileToSend = { ...this.myProfile };
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
      this.closePeerConnection(peerId);
    };
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    this.diagnosticService.log(`Handling offer from ${from}`);
    await this.createPeerConnection(from, false);
    const pc = this.peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendToServer({ 
        type: 'answer', 
        payload: { to: from, from: this.myId, payload: pc.localDescription }
      });
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    this.diagnosticService.log(`Handling answer from ${from}`);
    const pc = this.peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleCandidate(from: string, candidate: RTCIceCandidateInit) {
    this.diagnosticService.log(`Handling ICE candidate from ${from}`);
    const pc = this.peerConnections.get(from);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        this.diagnosticService.log('Error adding received ICE candidate', e);
      }
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

  public async sendToPeer(peerId: string, message: PeerMessage) {
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel && dataChannel.readyState === 'open') {
      let payload = message.payload;
      if (message.type === 'chat-message') {
        payload = await this.cryptoService.encryptMessage(peerId, payload);
      }
      dataChannel.send(JSON.stringify({ ...message, payload }));
    } else {
      this.diagnosticService.log(`Cannot send to ${peerId}, data channel not open.`);
    }
  }

  public sendMessage(peerId: string, content: string) {
    this.sendToPeer(peerId, { type: 'chat-message', payload: content });
  }

  public async sendFile(peerId: string, file: File) {
    const dataChannel = this.dataChannels.get(peerId);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      this.diagnosticService.log(`Cannot send file to ${peerId}, data channel not open.`);
      return;
    }

    const CHUNK_SIZE = 16 * 1024; // 16KB
    const fileId = `${Date.now()}-${file.name}`;

    // 1. Send file metadata
    this.sendToPeer(peerId, { 
      type: 'file-start', 
      payload: { fileId, name: file.name, size: file.size, type: file.type }
    });

    // 2. Send file in chunks
    let offset = 0;
    const fileReader = new FileReader();
    fileReader.onload = (e) => {
      if (e.target?.result) {
        this.sendToPeer(peerId, { 
          type: 'file-chunk', 
          payload: { fileId, chunk: e.target.result as ArrayBuffer }
        });
        offset += (e.target.result as ArrayBuffer).byteLength;
        if (offset < file.size) {
          readSlice(offset);
        }
      }
    };

    const readSlice = (o: number) => {
      const slice = file.slice(o, o + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    readSlice(0);
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

  public destroy() {
    this.diagnosticService.log('Destroying PeerService');
    this.stopLocationUpdates();
    this.ws?.close();
    this.peerConnections.forEach((pc, peerId) => {
      this.closePeerConnection(peerId);
    });
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.myId = '';
  }
}

export default PeerService;
