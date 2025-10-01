import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket, Server } from 'mock-socket';
import PeerService from './PeerService';

// --- Mocks ---

// Simuler les dépendances de service
vi.mock('./CryptoService', () => ({
  default: {
    getInstance: () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getPublicKeyJwk: vi.fn().mockResolvedValue({ kty: 'EC' }),
      deriveSharedSecret: vi.fn().mockResolvedValue(undefined),
      encryptMessage: vi.fn((_, msg) => Promise.resolve(JSON.stringify({ data: btoa(msg) }))),
      decryptMessage: vi.fn((_, payload) => Promise.resolve(atob(JSON.parse(payload).data))),
    }),
  },
}));
vi.mock('./IndexedDBService', () => ({
  default: {
    getInstance: () => ({
      getBlockList: vi.fn().mockResolvedValue([]),
      savePendingMessage: vi.fn().mockResolvedValue(undefined),
      deletePendingMessage: vi.fn().mockResolvedValue(undefined),
      getPendingMessages: vi.fn().mockResolvedValue([]),
      updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock('./ProfileService', () => ({
  default: {
    getInstance: () => ({
      getPublicProfile: vi.fn().mockResolvedValue({ id: 'user-A', displayName: 'User A' }),
      getAvatarForTransmission: vi.fn().mockResolvedValue(null),
    }),
  },
}));

// Simuler les API du navigateur
const mockDataChannel = {
  binaryType: '',
  readyState: 'open',
  onopen: vi.fn(),
  onmessage: vi.fn(),
  onclose: vi.fn(),
  send: vi.fn(),
};
vi.stubGlobal('WebSocket', WebSocket);
const mockPeerConnection = () => ({
  localDescription: null,
  remoteDescription: null,
  createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer-sdp' }),
  createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'answer-sdp' }),
  createDataChannel: vi.fn(() => mockDataChannel),
  setLocalDescription: vi.fn((desc) => {
    (mockPeerConnectionInstance as any).localDescription = desc;
    return Promise.resolve();
  }),
  setRemoteDescription: vi.fn((desc) => {
    (mockPeerConnectionInstance as any).remoteDescription = desc;
    return Promise.resolve();
  }),
  addIceCandidate: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  iceConnectionState: 'new',
  onicecandidate: null,
  onconnectionstatechange: null,
  ondatachannel: null,
});
const mockPeerConnectionInstance = mockPeerConnection();
const mockPeerConnectionFactory = vi.fn(() => mockPeerConnectionInstance);
vi.stubGlobal('RTCPeerConnection', mockPeerConnectionFactory as unknown as typeof RTCPeerConnection);
vi.stubGlobal('RTCSessionDescription', vi.fn(desc => desc));

const mockGeolocation = {
  getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
};
vi.stubGlobal('navigator', { geolocation: mockGeolocation });

// Simuler fetch pour éviter les appels réseau réels
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ username: 'test', credential: 'test', ttl: 3600 }),
})));

// --- Tests ---

describe('PeerService', () => {
  const FAKE_URL = 'ws://localhost:1234';
  let mockServer: Server;
  let peerService: PeerService;
  const profile = { id: 'user-A', name: 'User A' };
  const SESSION_TOKEN = 'test-session-token';

  beforeEach(() => {
    // Démarrer un faux serveur WebSocket avant chaque test
    mockServer = new Server(FAKE_URL);
    // @ts-ignore - Reset singleton
    PeerService.instance = null;
    peerService = PeerService.getInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Fermer le serveur après chaque test
    mockServer.close();
  });

  it('devrait se connecter au serveur WebSocket et s\'enregistrer', async () => {
    let receivedMessage: any = null;

    // Créer une promesse qui ne se résoudra que lorsqu\'un message sera reçu
    const messagePromise = new Promise(resolve => {
      mockServer.on('connection', socket => {
        socket.on('message', data => {
          receivedMessage = JSON.parse(data as string);
          resolve(receivedMessage);
        });
      });
    });

    // Initialiser le service, ce qui déclenchera la connexion et l\'envoi du message
    peerService.initialize(profile, FAKE_URL, SESSION_TOKEN);

    // Attendre que la promesse du message soit résolue
    await messagePromise;

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage.type).toBe('register');
    expect(receivedMessage.payload.id).toBe('user-A');
    expect(receivedMessage.payload.sessionToken).toBe(SESSION_TOKEN);
  });

  it('devrait créer une connexion pair-à-pair lors de la découverte de nouveaux pairs', async () => {
    const connectionPromise = new Promise(resolve => mockServer.on('connection', resolve));
    await peerService.initialize(profile, FAKE_URL, SESSION_TOKEN);
    await connectionPromise;

    // Simuler le message 'nearby-peers' envoyé par le serveur
    const nearbyPeersMessage = {
      type: 'nearby-peers',
      peers: [{ peerId: 'peer-B' }, { peerId: 'peer-C' }]
    };

    // Envoyer le message au premier client connecté à notre faux serveur
    mockServer.clients()[0].send(JSON.stringify(nearbyPeersMessage));

    // Attendre de manière robuste que les tentatives de connexion soient faites
    await vi.waitFor(() => {
      // RTCPeerConnection doit être appelé une fois pour chaque pair découvert
      expect(RTCPeerConnection).toHaveBeenCalledTimes(2);
    });

    // Vérifier l'état interne du service pour plus de certitude
    const internalConnections = (peerService as any).peerConnections;
    expect(internalConnections.has('peer-B')).toBe(true);
    expect(internalConnections.has('peer-C')).toBe(true);
  });

  it('devrait créer et envoyer une offre en tant qu\'initiateur', async () => {
    await peerService.initialize(profile, FAKE_URL, SESSION_TOKEN);
    const sendToServerSpy = vi.spyOn(peerService as any, 'sendToServer');
    
    await (peerService as any).createPeerConnection('peer-B');

    expect(sendToServerSpy).toHaveBeenCalled();
    const offerMessage = sendToServerSpy.mock.calls
      .map((c) => c[0] as { type: string; payload: any })
      .find((m) => m.type === 'offer');
    expect(offerMessage).toBeDefined();
    expect(offerMessage!.payload.to).toBe('peer-B');
    expect(offerMessage!.payload.payload.type).toBe('offer');
  });

  it('devrait recevoir une offre et envoyer une réponse', async () => {
    await peerService.initialize(profile, FAKE_URL, SESSION_TOKEN);
    const sendToServerSpy = vi.spyOn(peerService as any, 'sendToServer');
    const incomingOffer = { type: 'offer', sdp: 'some-offer-sdp' };

    await (peerService as any).handleOffer('peer-z', incomingOffer);

    expect(sendToServerSpy).toHaveBeenCalled();
    const answerMessage = sendToServerSpy.mock.calls
      .map((c) => c[0] as { type: string; payload: any })
      .find((m) => m.type === 'answer');
    expect(answerMessage).toBeDefined();
    expect(answerMessage!.payload.to).toBe('peer-z');
    expect(answerMessage!.payload.payload.type).toBe('answer');
  });

  // D'autres tests plus complexes seront ajoutés ici...
});
