import { User } from '../types';
import CryptoService from './CryptoService';
import IndexedDBService from './IndexedDBService';
import { DiagnosticService } from './DiagnosticService';

export interface PeerMessage {
  type: 'profile' | 'chat-message' | 'key-exchange' | 'file-start' | 'file-chunk' | 'file-end' | 'message-delivered' | 'message-read';
  payload: any;
  messageId?: string;
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
  private turnRefreshTimer: number | null = null;
  private searchRadius: number = 1.0; // Default 1km radius
  private signalingUrl: string = '';

  // --- TURN auth éphémère injectée depuis /api/turn-credentials ---
  private turnAuth: { username: string; credential: string } | null = null;

  private getIceConfig(): RTCConfiguration {
    const u = this.turnAuth?.username;
    const c = this.turnAuth?.credential;

    const iceServers: RTCIceServer[] = [
      // STUN publics
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },

      // Ton STUN/TURN
      { urls: 'stun:turn.nonetchat.com:3478' },
      ...(u && c ? [
        { urls: 'turn:turn.nonetchat.com:3478?transport=udp', username: u, credential: c },
        { urls: 'turn:turn.nonetchat.com:3478?transport=tcp', username: u, credential: c },
        { urls: 'turns:turn.nonetchat.com:5349?transport=tcp', username: u, credential: c },
      ] : []),

      // Fallback OpenRelay (pour secours uniquement)
      { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    ];

    return { iceServers, iceCandidatePoolSize: 2 };
  }

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

  // --- Récupération + refresh auto des identifiants TURN ---
  private async fetchTurnAuth(userId: string) {
    // Utiliser l'URL relative qui sera proxifiée par Vite vers le serveur de signalisation
    const apiUrl = this.signalingUrl.replace(/^wss?:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    const turnApiUrl = `${apiUrl}/api/turn-credentials?userId=${encodeURIComponent(userId)}`;
    
    const res = await fetch(turnApiUrl, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to fetch TURN credentials');
    const data = await res.json();
    this.turnAuth = { username: data.username, credential: data.credential };

    // planifie un rafraîchissement 60s avant expiration
    if (this.turnRefreshTimer) { clearTimeout(this.turnRefreshTimer); }
    const ttl = typeof data.ttl === 'number' ? data.ttl : 3600;
    const delay = Math.max(30_000, ttl * 1000 - 60_000);
    this.turnRefreshTimer = window.setTimeout(() => this.fetchTurnAuth(this.myId), delay);
  }

  public async initialize(profile: Partial<User>, signalingUrl: string) {
    this.diagnosticService.log('Initializing PeerService with Stable ID');
    if (this.ws) {
      this.destroy();
    }

    this.myId = profile.id!;
    this.myProfile = profile;
    this.signalingUrl = signalingUrl;
    await this.cryptoService.initialize();
    await this.loadBlockList();

    // Récupère les creds TURN (sinon fallback OpenRelay prendra le relais)
    try {
      await this.fetchTurnAuth(this.myId);
      this.diagnosticService.log('TURN credentials fetched');
    } catch (e) {
      this.diagnosticService.log('TURN credentials fetch failed, continuing with fallback', e);
    }

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
      this.peerConnections.forEach((pc, peerId) => {
        if (!this.lastSeen.has(peerId)) return;
        if (now - this.lastSeen.get(peerId)! > GRACE_PERIOD) {
          // ne ferme pas une PC si l’ICE est encore ok
          if (pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'checking')) return;
          this.diagnosticService.log(`Pruning ${peerId} (stale nearby-peers & no active ICE)`);
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

    const pc = new RTCPeerConnection(this.getIceConfig());
    this.peerConnections.set(peerId, pc);

    // Fallback relay-only si checking trop long
    let relayFallbackTimer: number | null = window.setTimeout(() => {
      if (pc.iceConnectionState === 'checking') {
        const cfg = pc.getConfiguration();
        pc.setConfiguration({ ...cfg, iceTransportPolicy: 'relay' });
        try { pc.restartIce?.(); } catch {}
        this.diagnosticService.log('ICE checking too long → relay-only + restartIce');
      }
    }, 7000);

    pc.oniceconnectionstatechange = () => {
      this.diagnosticService.log(`ICE state with ${peerId}: ${pc.iceConnectionState}`);

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (relayFallbackTimer) { clearTimeout(relayFallbackTimer); relayFallbackTimer = null; }
        this.logSelectedPair(pc);
      }

      if (pc.iceConnectionState === 'failed') {
        const policy = pc.getConfiguration().iceTransportPolicy;
        if (policy !== 'relay') {
          const cfg = pc.getConfiguration();
          pc.setConfiguration({ ...cfg, iceTransportPolicy: 'relay' });
          try { pc.restartIce?.(); } catch {}
          this.diagnosticService.log('ICE failed → trying relay-only');
        } else {
          this.closePeerConnection(peerId);
        }
      }

      if (pc.iceConnectionState === 'disconnected') {
        // Laisse une chance au restart ICE (mobiles, changements réseau)
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            try { pc.restartIce?.(); } catch {}
          }
        }, 1500);
      }
    };

    (pc as any).onicecandidateerror = (e: any) => {
      this.diagnosticService.log('ICE candidate error', {
        url: e.url, code: e.errorCode, text: e.errorText, hostCandidate: e.hostCandidate
      });
    };
    pc.onicegatheringstatechange = () => {
      this.diagnosticService.log('ICE gathering', pc.iceGatheringState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendToServer({ type: 'candidate', payload: { to: peerId, from: this.myId, payload: event.candidate } });
      }
    };

    pc.onconnectionstatechange = () => {
      this.diagnosticService.log(`Connection state with ${peerId} changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        this.closePeerConnection(peerId);
      }
      // ne pas fermer sur 'disconnected' ici
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

  private async logSelectedPair(pc: RTCPeerConnection) {
    try {
      const stats = await pc.getStats();
      stats.forEach((r: any) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) {
          const pair = stats.get(r.selectedCandidatePairId);
          const local = stats.get(pair.localCandidateId);
          const remote = stats.get(pair.remoteCandidateId);
          this.diagnosticService.log('Selected ICE pair', {
            local:  { type: local?.candidateType,  protocol: local?.protocol },
            remote: { type: remote?.candidateType, protocol: remote?.protocol },
          });
        }
      });
    } catch {}
  }

  private setupDataChannel(peerId: string, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    this.diagnosticService.log(`Setting up data channel with ${peerId}`);
    this.dataChannels.set(peerId, channel);

    channel.onopen = async () => {
      this.diagnosticService.log(`Data channel with ${peerId} opened. Initiating key exchange.`);
      const myPublicKey = await this.cryptoService.getPublicKeyJwk();
      this.sendToPeer(peerId, { type: 'key-exchange', payload: myPublicKey });
    };

    channel.onmessage = async (event) => {
      // Binaire (chunks de fichiers)
      if (event.data instanceof ArrayBuffer) {
        this.diagnosticService.log(`[${peerId}] Received binary file chunk`);
        this.emit('file-chunk', peerId, event.data);
        return;
      }

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
        this.emit('data', peerId, { type: 'chat-message', payload: decrypted, messageId: message.messageId });

        // Accusé de livraison
        if (message.messageId) {
          this.sendMessageDeliveredAck(peerId, message.messageId);
        }
      } else if (message.type === 'file-start') {
        // Déchiffrer les métadonnées du fichier
        const decryptedMetadata = await this.cryptoService.decryptMessage(peerId, message.payload);
        const metadata = JSON.parse(decryptedMetadata);
        this.emit('data', peerId, { type: 'file-start', payload: metadata, messageId: message.messageId });
      } else if (message.type === 'file-end') {
        // Signaler la fin du transfert de fichier
        this.emit('data', peerId, { type: 'file-end', payload: message.payload, messageId: message.messageId });
      } else if (message.type === 'message-delivered') {
        this.emit('message-delivered', peerId, message.messageId);
      } else if (message.type === 'message-read') {
        this.emit('message-read', peerId, message.messageId);
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

  public sendMessage(peerId: string, content: string, messageId?: string) {
    this.sendToPeer(peerId, { type: 'chat-message', payload: content, messageId });
  }

  public async sendFile(peerId: string, file: File, messageId: string, onProgress?: (progress: number) => void) {
    const dataChannel = this.dataChannels.get(peerId);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      this.diagnosticService.log(`Cannot send file to ${peerId}, data channel not open. Queuing not yet supported for files.`);
      // TODO: Queue file transfers
      return;
    }

    try {
      // Chiffrer le fichier avant envoi
      this.diagnosticService.log(`Encrypting file: ${messageId}`, { name: file.name, size: file.size });
      const encryptedBlob = await this.cryptoService.encryptFile(file);
      
      const CHUNK_SIZE = 16384; // 16 KiB
      this.diagnosticService.log(`Starting encrypted file transfer: ${messageId}`, { 
        originalSize: file.size, 
        encryptedSize: encryptedBlob.size 
      });

      // 1) Métadonnées (chiffrer le nom du fichier)
      const encryptedMetadata = await this.cryptoService.encryptMessage(peerId, JSON.stringify({
        name: file.name,
        size: file.size,
        type: file.type,
        encryptedSize: encryptedBlob.size
      }));
      
      this.sendToPeer(peerId, {
        type: 'file-start',
        messageId,
        payload: encryptedMetadata
      });

      // 2) Envoi par chunks avec backpressure événementiel
      dataChannel.bufferedAmountLowThreshold = 1_000_000;
      const waitBufferedLow = () =>
        new Promise<void>(resolve => dataChannel.addEventListener('bufferedamountlow', () => resolve(), { once: true }));

      let offset = 0;
      const fileReader = new FileReader();

      const readSlice = (o: number) => {
        try {
          const slice = encryptedBlob.slice(o, o + CHUNK_SIZE);
          fileReader.readAsArrayBuffer(slice);
        } catch (e) {
          this.diagnosticService.log('File slice error', e);
        }
      };

      fileReader.onload = async (e) => {
        if (!e.target?.result) {
          this.diagnosticService.log('File read error');
          return;
        }

        const chunk = e.target.result as ArrayBuffer;

        if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
          await waitBufferedLow();
        }

        offset += chunk.byteLength;
        dataChannel.send(chunk);

        // Callback de progression
        if (onProgress) {
          const progress = Math.round((offset / encryptedBlob.size) * 100);
          onProgress(progress);
        }

        if (offset < encryptedBlob.size) {
          readSlice(offset);
        } else {
          this.diagnosticService.log(`Encrypted file transfer complete: ${messageId}`);
          this.sendToPeer(peerId, { type: 'file-end', messageId, payload: {} });
        }
      };

      readSlice(0);
    } catch (error) {
      this.diagnosticService.log(`File encryption failed: ${messageId}`, error);
      throw error;
    }
  }

  public sendMessageDeliveredAck(peerId: string, messageId: string) {
    this.sendToPeer(peerId, { type: 'message-delivered', payload: null, messageId });
  }

  public sendMessageReadAck(peerId: string, messageId: string) {
    this.sendToPeer(peerId, { type: 'message-read', payload: null, messageId });
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
    if (this.turnRefreshTimer) {
      clearTimeout(this.turnRefreshTimer);
      this.turnRefreshTimer = null;
    }
    this.ws?.close();
    this.peerConnections.forEach((_, peerId) => this.closePeerConnection(peerId));
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.messageQueue.clear();
  }
}

export default PeerService;
