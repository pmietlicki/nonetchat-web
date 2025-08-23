import { v4 as uuidv4 } from 'uuid';
import CryptoService from './CryptoService';
import IndexedDBService from './IndexedDBService';
import { DiagnosticService } from './DiagnosticService';
import ProfileService, { PublicProfile } from './ProfileService';
import { User } from '../types';

export type PeerMessage =
  | { type: 'profile' | 'profile-update' | 'chat-message' | 'key-exchange' | 'file-start' | 'file-chunk' | 'file-end' | 'message-delivered' | 'message-read' | 'avatar-request' | 'avatar-thumb' | 'reaction'; payload: any; messageId?: string };

export type NearbyPeer = { peerId: string; distance: string };

class EventEmitter {
  protected events: { [key: string]: Function[] } = {};
  on(event: string, listener: Function) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }
  emit(event: string, ...args: any[]) {
    this.events[event]?.forEach((listener) => listener(...args));
  }
  removeListener(event: string, listener: Function) {
    if (this.events[event]) this.events[event] = this.events[event].filter((l) => l !== listener);
  }
}

type PeerProfileCache = {
  profile?: PublicProfile;
  avatarThumbDataUrl?: string; // miniature reçue via avatar-thumb
};

class PeerService extends EventEmitter {
  private static instance: PeerService;
  private ws: WebSocket | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private messageQueue: Map<string, PeerMessage[]> = new Map();

  private myId: string = '';
  // Profil applicatif (hérité) – conservé pour compat, mais on n’envoie plus l’image dedans
  private myProfile: Partial<User> = {};
  // Profil public léger réellement diffusé
  private myPublicProfile?: PublicProfile;

  // --- Public Room State ---
  private publicRoomId: string | null = null;
  private publicPeers: Set<string> = new Set();
  private publicNeighbors: Set<string> = new Set(); // k-neighbors
  private publicDataChannels: Map<string, RTCDataChannel> = new Map();
  private publicCtrlChannels: Map<string, RTCDataChannel> = new Map();
  private seenPublicMessages: Set<string> = new Set(); // LRU cache can be implemented later
  private K_NEIGHBORS = 7;

  private cryptoService: CryptoService;
  private diagnosticService: DiagnosticService;
  private dbService: IndexedDBService;
  private profileService: ProfileService;

  private blockList: Set<string> = new Set();
  private lastSeen: Map<string, number> = new Map();
  private pruneInterval: number | null = null;
  private heartbeatInterval: number | null = null;
  private turnRefreshTimer: number | null = null;
  private signalingUrl: string = '';
  private lastGoodLocationKey = 'nnc:lastGoodLocation';
  private locRefreshTimer: number | null = null;

  // Cache des profils distants (métadonnées + éventuelle miniature)
  private peersMeta = new Map<string, PeerProfileCache>();

  // --- TURN auth éphémère injectée depuis /api/turn-credentials ---
  private turnAuth: { username: string; credential: string } | null = null;

  private searchRadius: number | 'country' | 'city' = 'city'; // Default city radius

  private getIceConfig(): RTCConfiguration {
    const u = this.turnAuth?.username;
    const c = this.turnAuth?.credential;

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:turn.nonetchat.com:3478' },
      ...(u && c
        ? [
            { urls: 'turn:turn.nonetchat.com:3478?transport=udp', username: u, credential: c },
            { urls: 'turn:turn.nonetchat.com:3478?transport=tcp', username: u, credential: c },
            { urls: 'turns:turn.nonetchat.com:5349?transport=tcp', username: u, credential: c },
          ]
        : []),
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    ];

    return { iceServers, iceCandidatePoolSize: 2 };
  }

  private saveLastGoodLocation(loc: { latitude: number; longitude: number; accuracyMeters: number; timestamp: number; method: string }) {
    try {
      localStorage.setItem(this.lastGoodLocationKey, JSON.stringify(loc));
    } catch {}
  }
  private loadLastGoodLocation() {
    try {
      const raw = localStorage.getItem(this.lastGoodLocationKey);
      if (!raw) return null;
      return JSON.parse(raw) as { latitude: number; longitude: number; accuracyMeters: number; timestamp: number; method: string };
    } catch {
      return null;
    }
  }

  private getPositionRace(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('no geolocation'));
      let resolved = false;
      const cleanup = () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      };
      const finish = (pos: GeolocationPosition) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(pos);
        }
      };

      navigator.geolocation.getCurrentPosition(finish, () => {}, { enableHighAccuracy: false, timeout: 5000, maximumAge: 5 * 60 * 1000 });

      let best: GeolocationPosition | null = null;
      const watchId = navigator.geolocation.watchPosition(
        (p) => {
          best = p;
          if (p.coords.accuracy != null && p.coords.accuracy <= 100) finish(p);
        },
        (err) => {
          if (!resolved && best) finish(best);
          else if (!resolved) reject(err);
        },
        { enableHighAccuracy: true, maximumAge: 0 },
      );

      setTimeout(() => {
        if (resolved) return;
        if (best) finish(best);
        else reject(new Error('timeout'));
      }, 20000);
    });
  }

  private async isGeoDenied(): Promise<boolean> {
    try {
      // @ts-ignore
      const st = await navigator.permissions?.query?.({ name: 'geolocation' as PermissionName });
      return st?.state === 'denied';
    } catch {
      return false;
    }
  }

  private async fetchGeoIP(): Promise<{ latitude: number; longitude: number; accuracyMeters: number; method: string } | null> {
    try {
      const apiBase = this.signalingUrl.replace(/^wss?:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
      const r = await fetch(`${apiBase}/api/geoip`, { credentials: 'include' });
      if (!r.ok) return null;
      const d = await r.json();
      return { latitude: d.latitude, longitude: d.longitude, accuracyMeters: (d.accuracyKm || 25) * 1000, method: 'ip' };
    } catch {
      return null;
    }
  }

  private constructor() {
    super();
    this.cryptoService = CryptoService.getInstance();
    this.diagnosticService = DiagnosticService.getInstance();
    this.dbService = IndexedDBService.getInstance();
    this.profileService = ProfileService.getInstance();
  }

  public static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  // Compat : conserve le profil applicatif, mais l’envoi réseau utilise PublicProfile
  public setMyProfile(profile: Partial<User>) {
    this.myProfile = profile;
  }

  // --- Récupération + refresh auto des identifiants TURN ---
  private async fetchTurnAuth(userId: string) {
    const apiUrl = this.signalingUrl.replace(/^wss?:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    const turnApiUrl = `${apiUrl}/api/turn-credentials?userId=${encodeURIComponent(userId)}`;

    const res = await fetch(turnApiUrl, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch TURN credentials');
    const data = await res.json();
    this.turnAuth = { username: data.username, credential: data.credential };

    if (this.turnRefreshTimer) {
      clearTimeout(this.turnRefreshTimer);
    }
    const ttl = typeof data.ttl === 'number' ? data.ttl : 3600;
    const delay = Math.max(30_000, ttl * 1000 - 60_000);
    this.turnRefreshTimer = window.setTimeout(() => this.fetchTurnAuth(this.myId), delay);
  }

  public async initialize(profile: Partial<User>, signalingUrl: string) {
    this.diagnosticService.log('Initializing PeerService with Stable ID');
    if (this.ws) this.destroy();

    this.myId = profile.id!;
    this.myProfile = profile;
    this.signalingUrl = signalingUrl;

    // Prépare le profil public léger (métadonnées uniquement)
    this.myPublicProfile = await this.profileService.getPublicProfile();

    await this.cryptoService.initialize();
    await this.loadBlockList();

    try {
      await this.fetchTurnAuth(this.myId);
      this.diagnosticService.log('TURN credentials fetched');
    } catch (e) {
      this.diagnosticService.log('TURN credentials fetch failed, continuing with fallback', e);
    }

    this.ws = new WebSocket(signalingUrl);

    this.ws.onopen = () => {
  this.diagnosticService.log('WebSocket connection opened. Registering with stable ID.');

  const name =
    this.myPublicProfile?.displayName ||
    this.myProfile?.name ||
    'Utilisateur';

  const avatarVersion = this.myPublicProfile?.avatarVersion || 1;

  this.sendToServer({
    type: 'register',
    payload: { id: this.myId, profile: { name, avatarVersion } }
  });

  this.emit('open', this.myId);
  this.startLocationUpdates();
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

  public setSearchRadius(radius: number | 'country' | 'city') {
    this.searchRadius = radius;
    this.diagnosticService.log(`Search radius updated to ${typeof radius === 'string' ? radius : `${radius}km`}`);
    this.startLocationUpdates();
  }

  private startLocationUpdates() {
    const pushLocation = (loc: { latitude: number; longitude: number; accuracyMeters?: number; timestamp?: number; method?: string }) => {
      this.sendToServer({
        type: 'update-location',
        payload: {
          location: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracyMeters: loc.accuracyMeters ?? null,
            timestamp: loc.timestamp ?? Date.now(),
            method: loc.method || 'gps',
          },
          radius: this.searchRadius,
        },
      });
    };

    const scheduleRefresh = () => {
      if (this.locRefreshTimer) clearTimeout(this.locRefreshTimer);
      this.locRefreshTimer = window.setTimeout(() => this.startLocationUpdates(), 120000);
    };

    (async () => {
      if (await this.isGeoDenied()) {
        const lkg = this.loadLastGoodLocation();
        if (lkg && Date.now() - lkg.timestamp < 24 * 60 * 60 * 1000) {
          pushLocation(lkg);
          scheduleRefresh();
          return;
        }
        const ipGuess = await this.fetchGeoIP();
        if (ipGuess) {
          pushLocation({ ...ipGuess, timestamp: Date.now() });
          scheduleRefresh();
          return;
        }
        this.diagnosticService.log('Geolocation denied and no fallback → LAN');
        this.sendToServer({ type: 'request-lan-discovery' });
        return;
      }

      try {
        const pos = await this.getPositionRace();
        const { latitude, longitude, accuracy } = pos.coords;
        const loc = { latitude, longitude, accuracyMeters: accuracy ?? null, timestamp: pos.timestamp, method: 'gps' };
        this.saveLastGoodLocation(loc);
        this.diagnosticService.log('Location obtained (race)', loc);
        pushLocation(loc);
        scheduleRefresh();
      } catch (err) {
        this.diagnosticService.log('Geolocation failed, trying LKG/IP before LAN', err);
        const lkg = this.loadLastGoodLocation();
        if (lkg && Date.now() - lkg.timestamp < 24 * 60 * 60 * 1000) {
          pushLocation(lkg);
          scheduleRefresh();
          return;
        }
        const ipGuess = await this.fetchGeoIP();
        if (ipGuess) {
          pushLocation({ ...ipGuess, timestamp: Date.now() });
          scheduleRefresh();
          return;
        }
        setTimeout(() => this.startLocationUpdates(), 10000);
        setTimeout(() => {
          this.diagnosticService.log('Geolocation still failing → LAN');
          this.sendToServer({ type: 'request-lan-discovery' });
        }, 25000);
      }
    })();
  }

  private startPruningInterval() {
  const PRUNE_INTERVAL = 30000;
  const GRACE_PERIOD = 60000;
  this.pruneInterval = window.setInterval(() => {
    const now = Date.now();
    this.peerConnections.forEach((pc, peerId) => {
      const seen = this.lastSeen.get(peerId);
      const isStale = !seen || (now - seen > GRACE_PERIOD);
      if (!isStale) return;

      // si pas connecté/checking, on coupe
      if (!(pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'checking')) {
        this.diagnosticService.log(`Pruning ${peerId} (stale)`);
        this.closePeerConnection(peerId);
        this.lastSeen.delete(peerId);
      }
    });
  }, PRUNE_INTERVAL);
}


  private startHeartbeat() {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendToServer({ type: 'heartbeat', payload: { timestamp: Date.now() } });
        this.diagnosticService.log('Heartbeat sent to maintain connection');
      }
    }, 25000);
  }

  private sendToServer(message: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private strHash(str: string): number {
    let hash = 5381;
    let i = str.length;
    while (i) {
      hash = (hash * 33) ^ str.charCodeAt(--i);
    }
    return hash >>> 0;
  }

  private updatePublicNeighbors() {
  const peers = Array.from(this.publicPeers).sort((a,b) => this.strHash(a) - this.strHash(b));
  const myIndex = peers.indexOf(this.myId);
  
  this.diagnosticService.log(`Updating public neighbors. Total peers: ${peers.length}, My index: ${myIndex}`);
  this.diagnosticService.log(`All peers: ${peers.join(', ')}`);
  
  if (myIndex === -1) { 
    this.diagnosticService.log('My ID not found in peers list, clearing neighbors');
    this.publicNeighbors = new Set(); 
    return; 
  }

  const newNeighbors = new Set<string>();
  const n = peers.length;
  if (n <= this.K_NEIGHBORS) {
    this.diagnosticService.log(`Small network (${n} <= ${this.K_NEIGHBORS}), connecting to all peers`);
    peers.forEach(p => { if (p !== this.myId) newNeighbors.add(p); });
  } else {
    const k = Math.floor(this.K_NEIGHBORS / 2);
    this.diagnosticService.log(`Large network, selecting ${k} neighbors on each side`);
    for (let i=1; i<=k; i++) {
      const rightNeighbor = peers[(myIndex + i) % n];
      const leftNeighbor = peers[(myIndex - i + n) % n];
      newNeighbors.add(rightNeighbor);
      newNeighbors.add(leftNeighbor);
      this.diagnosticService.log(`Added neighbors: ${rightNeighbor}, ${leftNeighbor}`);
    }
  }

  // Connecter les nouveaux voisins
  let newConnectionsCount = 0;
  newNeighbors.forEach(pid => {
    if (pid !== this.myId && !this.peerConnections.has(pid)) {
      this.diagnosticService.log(`Creating new connection to ${pid}`);
      this.createPeerConnection(pid, 'auto');
      newConnectionsCount++;
    }
  });
  this.diagnosticService.log(`Created ${newConnectionsCount} new connections`);

  // Fermer les PC qui ne sont ni voisins publics, ni utilisés en DM (pas de canal "chat")
  let closedConnectionsCount = 0;
  for (const pid of this.peerConnections.keys()) {
    const hasChat = this.dataChannels.has(pid); // DM actif
    if (!newNeighbors.has(pid) && !hasChat) {
      this.diagnosticService.log(`Closing connection to ${pid} (not neighbor, no chat)`);
      this.closePeerConnection(pid);
      closedConnectionsCount++;
    }
  }
  this.diagnosticService.log(`Closed ${closedConnectionsCount} connections`);

  this.publicNeighbors = newNeighbors;
  this.diagnosticService.log(`Updated public neighbors: ${Array.from(newNeighbors).join(', ')}`);
  this.diagnosticService.log(`Active connections: ${this.peerConnections.size}, Data channels: ${this.publicDataChannels.size}`);
}


  private async handleSignalingMessage(message: any) {
    if (message.from && this.blockList.has(message.from)) return;

    this.diagnosticService.log('Received message from server', message);
    switch (message.type) {
      case 'nearby-peers': {
  const { peers, roomId, roomLabel } = message;
  this.emit('room-update', { roomId, roomLabel });

  const switched = roomId !== this.publicRoomId;
  if (switched) {
    this.diagnosticService.log(`Switching public room: ${this.publicRoomId} -> ${roomId}`);
    this.publicRoomId = roomId;
    this.publicPeers.clear();
    this.seenPublicMessages.clear();
    // Ne pas fermer les canaux existants - ils seront réutilisés si les pairs restent les mêmes
    // this.publicDataChannels.forEach((dc) => dc.close());
    // this.publicCtrlChannels.forEach((dc) => dc.close());
    // this.publicDataChannels.clear();
    // this.publicCtrlChannels.clear();
  }

  const now = Date.now();
  this.lastSeen = new Map(peers.map((p:any) => [p.peerId, now]));

  const nextSet = new Set<string>((peers as Array<{ peerId: string }>).map(p => p.peerId));
nextSet.add(this.myId);
this.publicPeers = nextSet;

  this.updatePublicNeighbors();
  this.emit('public-peers-change', this.publicPeers);
  this.emit('nearby-peers', peers);
  break;
}

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

  public broadcastToPublicRoom(content: string) {
    if (!this.publicRoomId) {
      this.diagnosticService.log('No public room to broadcast to');
      return;
    }

    const message = {
      type: 'public',
      id: uuidv4(),
      roomId: this.publicRoomId,
      origin: this.myId,
      ts: Date.now(),
      ttl: 6,
      text: content,
    };

    this.diagnosticService.log(`Creating public message:`, message);
    this.seenPublicMessages.add(message.id);
    this.emit('public-message', message);

    // Debug: Log connection states
    this.diagnosticService.log(`Broadcasting to public room. Neighbors: ${this.publicNeighbors.size}, DataChannels: ${this.publicDataChannels.size}`);
    this.diagnosticService.log(`Public neighbors: ${Array.from(this.publicNeighbors).join(', ')}`);
    this.diagnosticService.log(`Public data channels: ${Array.from(this.publicDataChannels.keys()).join(', ')}`);
    
    let sentCount = 0;
    const messageStr = JSON.stringify(message);
    this.diagnosticService.log(`Message JSON length: ${messageStr.length} bytes`);
    
    this.publicNeighbors.forEach(peerId => {
      const dc = this.publicDataChannels.get(peerId);
      this.diagnosticService.log(`Channel to ${peerId}: state=${dc?.readyState || 'none'}, exists=${!!dc}`);
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(messageStr);
          sentCount++;
          this.diagnosticService.log(`Successfully sent message to ${peerId}`);
        } catch (error) {
          this.diagnosticService.log(`Failed to send message to ${peerId}:`, error);
        }
      } else {
        this.diagnosticService.log(`Cannot send to ${peerId}: channel ${dc ? 'not open (' + dc.readyState + ')' : 'does not exist'}`);
      }
    });
    
    this.diagnosticService.log(`Message sent to ${sentCount}/${this.publicNeighbors.size} neighbors`);
    
    if (sentCount === 0) {
      this.diagnosticService.log('WARNING: Message was not sent to any neighbor!');
      this.diagnosticService.log('Peer connections:', Array.from(this.peerConnections.keys()));
      this.diagnosticService.log('Public data channels:', Array.from(this.publicDataChannels.keys()));
    }
  }

  private async createPeerConnection(peerId: string, role: 'auto' | 'initiator' | 'responder' = 'auto') {
  if (this.peerConnections.has(peerId)) return;

  const isInitiator =
    role === 'initiator' ? true :
    role === 'responder' ? false :
    (this.myId > peerId);

  this.diagnosticService.log(`Creating peer connection to ${peerId}. Initiator: ${isInitiator}`);

  const pc = new RTCPeerConnection(this.getIceConfig());
  this.peerConnections.set(peerId, pc);

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
      setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected') {
          try { pc.restartIce?.(); } catch {}
        }
      }, 1500);
    }
  };

  (pc as any).onicecandidateerror = (e: any) => {
    this.diagnosticService.log('ICE candidate error', { url: e.url, code: e.errorCode, text: e.errorText, hostCandidate: e.hostCandidate });
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
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      this.closePeerConnection(peerId);
    }
  };

  // Toujours écouter l'arrivée de canaux, quel que soit le rôle
  pc.ondatachannel = (event) => {
    this.diagnosticService.log(`Received data channel '${event.channel.label}' from ${peerId}`);
    switch (event.channel.label) {
      case 'public':      
        this.diagnosticService.log(`Setting up public data channel with ${peerId}`);
        this.setupPublicDataChannel(peerId, event.channel); 
        break;
      case 'public-ctrl': 
        this.diagnosticService.log(`Setting up public ctrl channel with ${peerId}`);
        this.setupPublicCtrlDataChannel(peerId, event.channel); 
        break;
      case 'chat':        
        this.diagnosticService.log(`Setting up chat channel with ${peerId}`);
        this.setupDataChannel(peerId, event.channel); 
        break;
      default:            
        this.diagnosticService.log(`Setting up default channel '${event.channel.label}' with ${peerId}`);
        this.setupDataChannel(peerId, event.channel); 
        break;
    }
  };

  if (isInitiator) {
    // Public (éphémère)
    const publicDC   = pc.createDataChannel('public', { ordered: false, maxRetransmits: 1 });
    const publicCtrl = pc.createDataChannel('public-ctrl', { ordered: true });
    this.setupPublicDataChannel(peerId, publicDC);
    this.setupPublicCtrlDataChannel(peerId, publicCtrl);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendToServer({ type: 'offer', payload: { to: peerId, from: this.myId, payload: pc.localDescription } });
  }
}


  public async ensureChatChannel(peerId: string) {
  let pc = this.peerConnections.get(peerId);
   if (!pc) {
     await this.createPeerConnection(peerId, 'initiator'); // crée la PC
     pc = this.peerConnections.get(peerId)!;
   }

    // Ne rien faire si le canal existe déjà
    if (this.dataChannels.has(peerId)) {
      return;
    }

    this.diagnosticService.log(`Creating on-demand chat channel with ${peerId}`);
    const chatDC = pc.createDataChannel('chat', { ordered: true });
    this.setupDataChannel(peerId, chatDC);

    // Renégocier pour ajouter le nouveau canal
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendToServer({ type: 'offer', payload: { to: peerId, from: this.myId, payload: pc.localDescription } });
    } catch (err) {
      this.diagnosticService.log(`Error creating offer for new chat channel with ${peerId}`, err);
    }
  }


  // util LRU simple
private trimSeenPublic(limit = 2048) {
  const excess = this.seenPublicMessages.size - limit;
  if (excess <= 0) return;
  let dropped = 0;
  for (const id of this.seenPublicMessages) {
    this.seenPublicMessages.delete(id);
    if (++dropped >= excess) break;
  }
}

private setupPublicDataChannel(peerId: string, channel: RTCDataChannel) {
  this.publicDataChannels.set(peerId, channel);
  this.diagnosticService.log(`Setting up public data channel with ${peerId}`);
  
  channel.onopen = () => {
    this.diagnosticService.log(`Public data channel opened with ${peerId}`);
  };

  channel.onmessage = (event) => {
    this.diagnosticService.log(`Received public message from ${peerId}: ${event.data.substring(0, 100)}...`);
    try {
      const msg = JSON.parse(event.data);
      this.diagnosticService.log(`Parsed message: origin=${msg.origin}, roomId=${msg.roomId}, ttl=${msg.ttl}`);
      
      if (msg.roomId !== this.publicRoomId) {
        this.diagnosticService.log(`Message room mismatch: ${msg.roomId} vs ${this.publicRoomId}`);
        return;
      }
      if (this.blockList.has(msg.origin)) {
        this.diagnosticService.log(`Message from blocked origin: ${msg.origin}`);
        return;
      }
      if (this.seenPublicMessages.has(msg.id)) {
        this.diagnosticService.log(`Duplicate message: ${msg.id}`);
        return;
      }

      this.seenPublicMessages.add(msg.id);
      this.trimSeenPublic();                                 // ✅ borné
      this.diagnosticService.log(`Emitting public message: ${msg.text}`);
      this.emit('public-message', msg);

      if (msg.ttl > 0) {
        const fwd = { ...msg, ttl: msg.ttl - 1 };
        let retransmitCount = 0;
        this.publicNeighbors.forEach(nid => {
          if (nid !== peerId && nid !== msg.origin) {
            const dc = this.publicDataChannels.get(nid);
            if (dc?.readyState === 'open') {
              dc.send(JSON.stringify(fwd));
              retransmitCount++;
            }
          }
        });
        this.diagnosticService.log(`Retransmitted to ${retransmitCount} neighbors`);
      }
    } catch (e) {
      this.diagnosticService.log('Error parsing public message', e);
    }
  };

  channel.onclose = () => {                                // ✅ nettoyage
    if (this.publicDataChannels.get(peerId) === channel) {
      this.publicDataChannels.delete(peerId);
    }
    this.diagnosticService.log(`Public data channel closed with ${peerId}`);
  };
  
  channel.onerror = (error) => {
    this.diagnosticService.log(`Public data channel error with ${peerId}:`, error);
  };
}

private setupPublicCtrlDataChannel(peerId: string, channel: RTCDataChannel) {
  this.publicCtrlChannels.set(peerId, channel);
  
  channel.onopen = async () => {
    try {
      const mine: any = await this.profileService.getProfile?.();
      const lite = {
        t: 'p-lite',
        id: this.myId,
        displayName: mine?.displayName ?? mine?.name ?? '',
        age: (mine?.age ?? null),
        gender: (mine?.gender ?? null),
        avatarVersion: (mine?.avatarVersion ?? 1),
      };
      channel.send(JSON.stringify(lite));
    } catch {}
  };

  channel.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg?.t === 'p-lite') {
        const payload = {
          displayName: msg.displayName || '',
          age: msg.age,
          gender: msg.gender,
          avatarVersion: msg.avatarVersion,
        };
        // Réutilise la voie existante côté App.tsx (handler 'data' pour type 'profile')
        this.emit('data', peerId, { type: 'profile', payload });
      }
    } catch {}
  };

  channel.onclose = () => {
    if (this.publicCtrlChannels.get(peerId) === channel) {
      this.publicCtrlChannels.delete(peerId);
    }
  };
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
            local: { type: local?.candidateType, protocol: local?.protocol },
            remote: { type: remote?.candidateType, protocol: remote?.protocol },
          });
        }
      });
    } catch {}
  }

  private fallbackAvatarUrl(id: string, version?: number, size = 150) {
  const v = version || 1;
  return `https://i.pravatar.cc/${size}?u=${encodeURIComponent(`${id}:${v}`)}`;
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
      if (event.data instanceof ArrayBuffer) {
        try {
          const messageIdLength = 36; // UUID v4 length
          const messageIdBytes = new Uint8Array(event.data.slice(0, messageIdLength));
          const messageId = new TextDecoder().decode(messageIdBytes);
          const chunk = event.data.slice(messageIdLength);

          this.diagnosticService.log(`[${peerId}] Received binary file chunk for messageId: ${messageId}`);
          this.emit('file-chunk', peerId, messageId, chunk);
        } catch (error) {
          this.diagnosticService.log('Error processing file chunk', error);
        }
        return;
      }

      const message: PeerMessage = JSON.parse(event.data);
      this.diagnosticService.log(`[${peerId}] Received message over data channel`, message);

      if (message.type === 'key-exchange') {
        await this.cryptoService.deriveSharedSecret(peerId, message.payload);
        this.diagnosticService.log(`Secure channel established with ${peerId}`);
        this.emit('peer-joined', peerId);

        const queue = this.messageQueue.get(peerId) || [];
        if (queue.length > 0) {
          for (const msg of queue) await this.sendToPeer(peerId, msg);
          this.messageQueue.delete(peerId);
        }

        // Envoi du profil public léger (sans image)
        await this.advertiseProfile(peerId);
        return;
      }

      if (message.type === 'profile' || message.type === 'profile-update') {
        const p = message.payload as PublicProfile;
        const entry = this.peersMeta.get(peerId) || {};
        entry.profile = p;
        this.peersMeta.set(peerId, entry);

        // Si le pair annonce un avatarHash et qu’on n’a pas de miniature, on la demande
        if (p.avatarHash && !entry.avatarThumbDataUrl) {
          this.sendToPeer(peerId, { type: 'avatar-request', payload: { hash: p.avatarHash } });
        }

        // Émettre vers l’UI un payload enrichi avec un champ avatar (miniature si dispo, sinon pravatar)
        const avatarForUi =
  entry.avatarThumbDataUrl ||
  this.fallbackAvatarUrl((p as any).id ?? peerId, p.avatarVersion);
        this.emit('data', peerId, { type: message.type, payload: { ...p, avatar: avatarForUi } });

        // Mettre à jour la conversation dans la base de données avec les infos du profil
        this.dbService.updateConversationParticipant(peerId, p.displayName || '', avatarForUi, p.age, p.gender);
        return;
      }

      if (message.type === 'avatar-request') {
        const { hash } = message.payload as { hash: string };
        const mine = this.myPublicProfile || (await this.profileService.getPublicProfile());
        if (mine.avatarHash !== hash) return;

        // Crée une petite miniature en dataURL (≈ 5–12KB)
        const tiny = await this.profileService.getAvatarForTransmission(
  this.fallbackAvatarUrl(mine.id ?? this.myId, mine.avatarVersion, 96)
);
        if (!tiny) return;

        // Limite de sécurité: éviter d’envoyer > 16KB
        if (tiny.length > 16 * 1024) {
          this.diagnosticService.log('avatar-thumb too large, skipping');
          return;
        }
        this.sendToPeer(peerId, { type: 'avatar-thumb', payload: { hash, dataUrl: tiny, mime: mine.avatarMime || 'image/webp' } });
        return;
      }

      if (message.type === 'avatar-thumb') {
        const { hash, dataUrl } = message.payload as { hash: string; dataUrl: string };
        const entry = this.peersMeta.get(peerId) || {};
        // n’applique que si le hash correspond au profil actuel
        if (entry.profile?.avatarHash === hash) {
          entry.avatarThumbDataUrl = dataUrl;
          this.peersMeta.set(peerId, entry);
          // Notifie l’UI via un profile-update synthétique avec avatar résolu
          this.emit('data', peerId, {
            type: 'profile-update',
            payload: { ...(entry.profile as PublicProfile), avatar: dataUrl },
          });
        }
        return;
      }

      if (message.type === 'chat-message') {
        const decrypted = await this.cryptoService.decryptMessage(peerId, message.payload);
        this.emit('data', peerId, { type: 'chat-message', payload: decrypted, messageId: message.messageId });
        if (message.messageId) this.sendMessageDeliveredAck(peerId, message.messageId);
        return;
      }

      if (message.type === 'file-start') {
        const decryptedMetadata = await this.cryptoService.decryptMessage(peerId, message.payload);
        const metadata = JSON.parse(decryptedMetadata);
        this.emit('data', peerId, { type: 'file-start', payload: metadata, messageId: message.messageId });
        return;
      }

      if (message.type === 'file-end') {
        this.emit('data', peerId, { type: 'file-end', payload: message.payload, messageId: message.messageId });
        return;
      }

      if (message.type === 'message-delivered') {
        this.emit('message-delivered', peerId, message.messageId);
        return;
      }

      if (message.type === 'message-read') {
        this.emit('message-read', peerId, message.messageId);
        return;
      }

      if (message.type === 'reaction') {
  const { messageId, emoji } = message.payload as { messageId: string; emoji: string };

  try {
    // Écrit tout de suite en DB pour être robuste même si la fenêtre de chat n'est pas ouverte
    await this.dbService.toggleMessageReaction(messageId, emoji, peerId);
  } catch (e) {
    this.diagnosticService.log('Failed to toggle reaction in DB', { peerId, messageId, emoji, error: e });
    // En cas d’erreur, on continue quand même l’emit UI (au pire l’UI resynchronisera depuis la DB plus tard)
  }

  // Notifie l'UI (ChatWindow peut rafraîchir sa copie locale sans recalculer)
  this.emit('reaction-received', peerId, messageId, emoji);
  return;
}

      // Par défaut, on relaie
      this.emit('data', peerId, message);
    };

    channel.onclose = () => {
      this.diagnosticService.log(`Data channel with ${peerId} closed.`);
      this.closePeerConnection(peerId);
    };
  }

  private async advertiseProfile(peerId: string) {
    // Rafraîchit le profil public s’il n’existe pas encore (ou a changé ailleurs)
    if (!this.myPublicProfile) this.myPublicProfile = await this.profileService.getPublicProfile();
    const payload = this.myPublicProfile;
    const json = JSON.stringify({ type: 'profile', payload });
    if (json.length > 16 * 1024) {
      this.diagnosticService.log('Profile payload too large, dropping advertise', json.length);
      return;
    }
    const dc = this.dataChannels.get(peerId);
    if (dc && dc.readyState === 'open') dc.send(json);
    else {
      const q = this.messageQueue.get(peerId) || [];
      q.push({ type: 'profile', payload });
      this.messageQueue.set(peerId, q);
    }
  }

  public async broadcastProfileUpdate() {
  // Rafraîchir le profil public local
  this.myPublicProfile = await this.profileService.getPublicProfile();

  // Prévenir le serveur pour les push offline (nom + version + état avatar)
  const hasCustomAvatar = Boolean(this.myPublicProfile.avatarHash);

  this.sendToServer({
    type: 'server-profile-update',
    payload: {
      name: this.myPublicProfile.displayName || 'Utilisateur',
      avatarVersion: this.myPublicProfile.avatarVersion || 1,
      // si on N’A PLUS d’avatar custom, on envoie avatar:null pour forcer le fallback pravatar côté serveur
      avatar: hasCustomAvatar ? undefined : null
    }
  });

  // 🔔 NEW: prévenir immédiatement les voisins "public" via public-ctrl (p-lite)
  try {
    const mine: any = await this.profileService.getProfile?.();
    const lite = {
      t: 'p-lite',
      id: this.myId,
      displayName: mine?.displayName ?? mine?.name ?? '',
      age: (mine?.age ?? null),
      gender: (mine?.gender ?? null),
      avatarVersion: (mine?.avatarVersion ?? this.myPublicProfile.avatarVersion ?? 1),
    };
    const buf = JSON.stringify(lite);
    this.publicCtrlChannels.forEach((ch) => {
      if (ch.readyState === 'open') ch.send(buf);
    });
  } catch {}

  // Diffuser aux pairs (métadonnées légères, sans image)
  const msg: PeerMessage = { type: 'profile-update', payload: this.myPublicProfile };
  const json = JSON.stringify(msg);
  if (json.length > 16 * 1024) {
    this.diagnosticService.log('Profile-update payload too large, skipping broadcast', json.length);
    return;
  }
  this.diagnosticService.log('Broadcasting profile update to all peers');
  this.dataChannels.forEach((channel, peerId) => {
    if (channel.readyState === 'open') channel.send(json);
    else {
      const q = this.messageQueue.get(peerId) || [];
      q.push(msg);
      this.messageQueue.set(peerId, q);
    }
  });
}


  public async sendToPeer(peerId: string, message: PeerMessage) {
    const dataChannel = this.dataChannels.get(peerId);
    let payload = message.payload;

    if (message.type === 'chat-message') {
      payload = await this.cryptoService.encryptMessage(peerId, payload);
    }

    const out = JSON.stringify({ ...message, payload });
    // Sécurité: éviter les gros paquets sur DC (16KB soft limit pour profils/avatars)
    if ((message.type === 'profile' || message.type === 'profile-update' || message.type === 'avatar-thumb') && out.length > 16 * 1024) {
      this.diagnosticService.log('Dropping oversized message', { type: message.type, bytes: out.length });
      return;
    }

    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(out);
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
      return;
    }

    try {
      this.diagnosticService.log(`Encrypting file: ${messageId}`, { name: file.name, size: file.size });
      const encryptedBlob = await this.cryptoService.encryptFile(file);

      const CHUNK_SIZE = 16384; // 16 KiB
      this.diagnosticService.log(`Starting encrypted file transfer: ${messageId}`, {
        originalSize: file.size,
        encryptedSize: encryptedBlob.size,
      });

      const encryptedMetadata = await this.cryptoService.encryptMessage(
        peerId,
        JSON.stringify({ name: file.name, size: file.size, type: file.type, encryptedSize: encryptedBlob.size }),
      );

      this.sendToPeer(peerId, { type: 'file-start', messageId, payload: encryptedMetadata });

      dataChannel.bufferedAmountLowThreshold = 1_000_000;
      const waitBufferedLow = () => new Promise<void>((resolve) => dataChannel.addEventListener('bufferedamountlow', () => resolve(), { once: true }));

      let offset = 0;
      const fileReader = new FileReader();
      const messageIdBytes = new TextEncoder().encode(messageId);

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

        const combinedBuffer = new Uint8Array(messageIdBytes.length + chunk.byteLength);
        combinedBuffer.set(messageIdBytes, 0);
        combinedBuffer.set(new Uint8Array(chunk), messageIdBytes.length);

        if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
          await waitBufferedLow();
        }

        offset += chunk.byteLength;
        dataChannel.send(combinedBuffer.buffer);

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

  public sendReaction(peerId: string, messageId: string, emoji: string) {
    this.sendToPeer(peerId, { type: 'reaction', payload: { messageId, emoji } });
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

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
  let pc = this.peerConnections.get(from);
  if (!pc) {
    await this.createPeerConnection(from, 'responder'); // ⚠️ force “responder”
    pc = this.peerConnections.get(from)!;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  this.sendToServer({ type: 'answer', payload: { to: from, from: this.myId, payload: pc.localDescription } });
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
    this.peersMeta.delete(peerId);
    this.emit('peer-left', peerId);
  }

  public destroy() {
  if (this.pruneInterval) clearInterval(this.pruneInterval);
  if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
  if (this.turnRefreshTimer) { clearTimeout(this.turnRefreshTimer); this.turnRefreshTimer = null; }
  this.ws?.close();
  this.peerConnections.forEach(pc => pc?.close());
  this.peerConnections.clear();
  this.dataChannels.clear();
  this.publicDataChannels.forEach(dc => dc.close());
  this.publicCtrlChannels.forEach(dc => dc.close());
  this.publicDataChannels.clear();
  this.publicCtrlChannels.clear();
  this.messageQueue.clear();
  this.peersMeta.clear();
}

}

export default PeerService;
