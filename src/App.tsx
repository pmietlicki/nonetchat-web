import { v4 as uuidv4 } from 'uuid';
import PeerList from './components/PeerList';
import ConversationList from './components/ConversationList';
import ChatWindow from './components/ChatWindow';
import PublicChatWindow from './components/PublicChatWindow'; // Ajout
import StatusBar from './components/StatusBar';
import ConnectionStatus from './components/ConnectionStatus';
import ProfileModal from './components/ProfileModal';
import DiagnosticPanel from './components/DiagnosticPanel';
import NotificationSettings from './components/NotificationSettings';
import { User } from './types';
import PeerService, { PeerMessage } from './services/PeerService';
import IndexedDBService from './services/IndexedDBService';
import ProfileService from './services/ProfileService';
import NotificationService from './services/NotificationService';
import { MessageSquare, Users, X, User as UserIcon, Bell, Cog, Globe, ArrowLeft, Home } from 'lucide-react'; // Ajout Globe, ArrowLeft, Home
import CryptoService from './services/CryptoService';
import { useState, useRef, useEffect } from 'react';


const DEFAULT_SIGNALING_URL = 'wss://chat.nonetchat.com';
// Clé publique VAPID (base64url)
const VAPID_PUBLIC_KEY = 'BMc-eDAKQrPghLx7eLZJvoAK6ZtfS5EvLWun9MbOvIw8_nuBpGlkDTm8NnvR_dfjFf2QuhZEcUCBzCtQaYh6NPU';

const GeolocationError = ({ message, onDismiss, onRetry }:{ message:string; onDismiss:()=>void; onRetry:()=>void }) => (
  <div className="fixed top-16 left-1/2 -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50 max-w-[90vw]">
    <span className="block sm:inline">{message}</span>
    <button onClick={onRetry} className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">
      Activer la localisation
    </button>
    <button onClick={onDismiss} className="absolute top-0 bottom-0 right-0 px-4 py-3" aria-label="Fermer l’alerte">✕</button>
  </div>
);

function App() {
  const [myId, setMyId] = useState('');
  const [peers, setPeers] = useState<Map<string, User>>(new Map());
  const [selectedPeerId, setSelectedPeerId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<'peers' | 'conversations' | 'public'>('peers');
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [unreadConversationsCount, setUnreadConversationsCount] = useState(0);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);

  // State pour la discussion publique
  const [publicRoomId, setPublicRoomId] = useState<string | null>(null);
  const [publicRoomName, setPublicRoomName] = useState('Discussion Publique');
  const [publicMessages, setPublicMessages] = useState<any[]>([]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [locationInfo, setLocationInfo] = useState<{ city: string; country: string } | null>(null);

  const globalFileReceivers = useRef(
    new Map<string, { peerId: string; chunks: ArrayBuffer[]; metadata: any; expectedSize?: number; startTime: number }>()
  );


  // Bouton d'installation PWA
  const [installEvent, setInstallEvent] = useState<any>(null);

  // Profil + avatar
  const [userProfile, setUserProfile] = useState<Partial<User> & { avatarBlob?: Blob | null }>({});
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [avatarRefreshKey, setAvatarRefreshKey] = useState<number>(0);

  const [signalingUrl, setSignalingUrl] = useState(
    () => localStorage.getItem('signalingUrl') || DEFAULT_SIGNALING_URL
  );
  const [tempSignalingUrl, setTempSignalingUrl] = useState(signalingUrl);
  const [searchRadius, setSearchRadius] = useState<number | 'country' | 'city'>(
    () => {
      const stored = localStorage.getItem('searchRadius');
      if (stored === 'country' || stored === 'city') return stored;
      return parseFloat(stored || '1.0');
    }
  );
  const [tempSearchRadius, setTempSearchRadius] = useState<number | 'country' | 'city'>(searchRadius);

  const peerService = PeerService.getInstance();
  const profileService = ProfileService.getInstance();
  const dbService = IndexedDBService.getInstance();
  const notificationService = NotificationService.getInstance();

  // --- Géolocalisation ---
  const [hasGeoInit, setHasGeoInit] = useState(false);

  // Étape 1: Récupère les noms de lieux (ville/pays) via l'IP. Essentiel pour l'UI.
  async function fetchLocationData() {
    try {
      const apiUrl = toApiUrl(signalingUrl);
      const res = await fetch(`${apiUrl}/api/geoip`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
  
      if (j.cityName || j.countryName) {
        setLocationInfo({ city: j.cityName, country: j.countryName });
      }
      // Retourne les coordonnées IP pour un fallback immédiat
      return { latitude: j.latitude, longitude: j.longitude, accuracyMeters: (j.accuracyKm ?? 25) * 1000 };
    } catch (err) {
      setLocationInfo(null);
      setGeolocationError(
        "Impossible de déterminer votre pays/ville. La recherche étendue est désactivée."
      );
      return null;
    }
  }

  // Étape 2: Tente d'obtenir une position GPS plus précise et l'envoie au serveur.
  async function requestPreciseLocationAndUpdateServer() {
    // D'abord, on peuple l'UI avec les noms de lieux (ville/pays)
    const ipLocation = await fetchLocationData();
  
    // Si le navigateur ne supporte pas le GPS, on envoie la localisation IP et on s'arrête
    if (!('geolocation' in navigator)) {
      if (ipLocation) {
        (peerService as any)?.updateLocation?.({ ...ipLocation, method: 'geoip' });
      }
      return;
    }
  
    // Le navigateur supporte le GPS, on essaie de l'obtenir
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Succès GPS : on envoie les coordonnées précises au serveur
        setGeolocationError(null);
        (peerService as any)?.updateLocation?.({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? null,
          timestamp: Date.now(),
          method: 'geolocation',
        });
      },
      () => {
        // Échec GPS : on se rabat sur la localisation IP (déjà obtenue)
        if (ipLocation) {
          (peerService as any)?.updateLocation?.({ ...ipLocation, method: 'geoip' });
        }
        setGeolocationError(
          "Le GPS a échoué. Utilisation de la localisation approximative par IP."
        );
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
    );
  }


  // Résolution centralisée de l’avatar à afficher (blob local ou pravatar versionné)
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const url = await profileService.getDisplayAvatarUrl();
      if (cancelled) return;
      setMyAvatarUrl(prev => {
        if (prev && prev.startsWith('blob:')) {
          try { URL.revokeObjectURL(prev); } catch {}
        }
        return url;
      });
    } catch {
      const ver = (userProfile as any).avatarVersion || 1;
      const fallback = `https://i.pravatar.cc/150?u=${encodeURIComponent(`${userProfile.id || ''}:${ver}`)}&_=${avatarRefreshKey}`;
      setMyAvatarUrl(fallback);
    }
  })();
  return () => { cancelled = true; };
  // ⚠️ dépendances élargies : hash & version déclenchent l’update après save()
}, [
  userProfile.id,
  (userProfile as any).avatarHash,
  (userProfile as any).avatarVersion,
  avatarRefreshKey
]);


  // --- INITIALISATION et abonnements *non liés* aux messages (open/peer-joined/left, notif, geoloc)
  useEffect(() => {
    const initialize = async () => {
      await dbService.initialize();

      // ProfileService garantit l’ID (deviceId)
      const profileAny = await profileService.getProfile();
      const normalized: Partial<User> & { avatarBlob?: Blob | null } = {
        ...profileAny,
        name: (profileAny as any).displayName ?? (profileAny as any).name ?? '',
        age: (profileAny as any).age,
        gender: (profileAny as any).gender,
      };

      if (!normalized.id) {
        normalized.id = uuidv4();
        await profileService.saveProfile({ displayName: normalized.name || '' });
      }

      setUserProfile(normalized);
      setMyId(normalized.id!);
      if (!normalized.name) setIsProfileOpen(true);

      peerService.initialize(normalized, signalingUrl);
      peerService.setSearchRadius(searchRadius);
      setIsInitialized(true);
    };

    initialize();

    const onOpen = (id: string) => {
      setIsConnected(true);
      setMyId(id);
    };

    const onPeerJoined = (peerId: string) => {
      setPeers(prev => {
        const m = new Map(prev);
        const existing = m.get(peerId);
        m.set(peerId, existing ? { ...existing, status: 'online' } : createBaseUser(peerId));
        return m;
      });
    };

    const onPeerLeft = (peerId: string) => {
      setPeers(prev => {
        const m = new Map(prev);
        const existing = m.get(peerId);
        if (existing) m.set(peerId, { ...existing, status: 'offline' });
        return m;
      });
    };

    const onGeolocationError = (error: GeolocationPositionError) => {
      switch (error.code) {
        case 1:
          setGeolocationError("L'accès à la géolocalisation a été refusé. L'application ne peut pas trouver de pairs à proximité.");
          break;
        case 2:
          setGeolocationError('Impossible d’obtenir votre position actuelle. Vérifiez la connexion réseau ou les paramètres de localisation.');
          break;
        case 3:
          setGeolocationError('La recherche de position a expiré. Veuillez réessayer.');
          break;
        default:
          setGeolocationError('Erreur inconnue lors de la récupération de votre position.');
      }
    };

    peerService.on('open', onOpen);
    peerService.on('peer-joined', onPeerJoined);
    peerService.on('peer-left', onPeerLeft);
    peerService.on('geolocation-error', onGeolocationError);

    const onRoomUpdate = (payload: { roomId: string; roomName?: string; roomLabel?: string }) => {
      if (payload.roomId !== publicRoomId) {
        setPublicRoomId(payload.roomId);
        setPublicRoomName(payload.roomLabel || payload.roomName || 'Discussion Publique');
        setPublicMessages([]); // Vider les messages en changeant de room
      }
    };

    const onPublicMessage = (message: any) => {
      setPublicMessages(prev => [...prev.slice(-200), message]); // Garder les 200 derniers messages
    };

    peerService.on('room-update', onRoomUpdate);
    peerService.on('public-message', onPublicMessage);

    const onUnreadCountChanged = (count: number) => setTotalUnreadCount(count);
    const onUnreadConversationsChanged = () =>
      setUnreadConversationsCount(notificationService.getUnreadConversationsCount());
    const onNotificationClicked = (conversationId: string) => {
      setSelectedPeerId(conversationId);
      setActiveTab('conversations');
    };

    notificationService.on('unread-count-changed', onUnreadCountChanged);
    notificationService.on('conversation-unread-changed', onUnreadConversationsChanged);
    notificationService.on('notification-clicked', onNotificationClicked);

    setTotalUnreadCount(notificationService.getTotalUnreadCount());
    setUnreadConversationsCount(notificationService.getUnreadConversationsCount());

    return () => {
      peerService.removeListener('room-update', onRoomUpdate);
      peerService.removeListener('public-message', onPublicMessage);
      peerService.removeListener('open', onOpen);
      peerService.removeListener('peer-joined', onPeerJoined);
      peerService.removeListener('peer-left', onPeerLeft);
      peerService.removeListener('geolocation-error', onGeolocationError);
      notificationService.off('unread-count-changed', onUnreadCountChanged);
      notificationService.off('conversation-unread-changed', onUnreadConversationsChanged);
      notificationService.off('notification-clicked', onNotificationClicked);
      peerService.destroy();
    };
  }, [signalingUrl, searchRadius]);

  useEffect(() => {
  if (isConnected && !hasGeoInit) {
    setHasGeoInit(true);
    requestPreciseLocationAndUpdateServer();
  }
}, [isConnected, hasGeoInit, signalingUrl, searchRadius]);


  const createBaseUser = (peerId: string): User => ({
    id: peerId,
    name: '',
    avatar: `https://i.pravatar.cc/150?u=${encodeURIComponent(`${peerId}:1`)}`,
    status: 'online',
    joinedAt: new Date().toISOString(),
    distanceKm: undefined,
    distanceLabel: undefined,
  });

 // --- LISTENER DÉDIÉ aux messages de données (chat-message)
useEffect(() => {
  const onData = async (peerId: string, data: PeerMessage) => {
    // Profils
    if (data.type === 'profile' || data.type === 'profile-update') {
      const payload: any = data.payload || {};
      setPeers(prev => {
        const m = new Map(prev);
        const existing = m.get(peerId) || createBaseUser(peerId);
        const name = payload.displayName ?? existing.name ?? '';
        const avatarVersion = (payload as any)?.avatarVersion || 1;
const avatar = payload.avatar 
  ?? existing.avatar 
  ?? `https://i.pravatar.cc/150?u=${encodeURIComponent(`${peerId}:${avatarVersion}`)}`;
        m.set(peerId, { ...existing, ...payload, name, avatar, status: 'online' });
        return m;
      });
      return;
    }

    // Messages texte entrants (payload déjà en clair via PeerService)
    if (data.type === 'chat-message') {
      const plaintext = String((data as any).payload ?? '');
      const id = (data as any).messageId || uuidv4();
      const now = Date.now();

      try {
        await dbService.saveMessage({
          id,
          senderId: peerId,
          receiverId: myId,
          content: plaintext,
          timestamp: now,
          type: 'text',
          encrypted: false, // on stocke en clair
          status: 'delivered',
        }, peerId);

        const p = peers.get(peerId);
        if (p) {
          await dbService.updateConversationParticipant(
            peerId, p.name, p.avatar, p.age, p.gender as any
          );
        }

        notificationService.addMessage(peerId, {
          id,
          conversationId: peerId,
          content: plaintext,
          timestamp: now,
          type: 'text',
          senderName: p?.name || 'Utilisateur',
        });

        (peerService as any)?.sendMessageDeliveredAck?.(peerId, id);

        // Mise à jour live si la fenêtre est ouverte
        peerService.emit('ui-message-received', {
          id,
          senderId: peerId,
          receiverId: myId,
          content: plaintext,
          timestamp: now,
          type: 'text',
          encrypted: false,
          status: 'delivered',
        });
      } catch (err) {
        console.error('[App] Erreur persistance message entrant:', err);
      }
      return;
    }

      if (data.type === 'file-start') {
        if (!data.messageId) return; // sécurité
    // Si la conversation est ouverte, ChatWindow gère
    if (selectedPeerId === peerId) return;

    const meta = data.payload || {};
    globalFileReceivers.current.set(data.messageId!, {
      peerId,
      chunks: [],
      metadata: meta,
      expectedSize: meta.encryptedSize || meta.size,
      startTime: Date.now(),
    });

    const id = data.messageId!;
    const now = Date.now();
    await dbService.saveMessage({
      id,
      senderId: peerId,
      receiverId: myId,
      content: `${meta.name} (En réception...)`,
      timestamp: now,
      type: 'file',
      encrypted: true,
      status: 'delivered',
      fileData: { name: meta.name, size: meta.size, type: meta.type, url: '' },
    }, peerId);

    const p = peers.get(peerId);
    if (p) {
      await dbService.updateConversationParticipant(peerId, p.name, p.avatar, p.age, p.gender as any);
    }
    notificationService.addMessage(peerId, {
      id,
      conversationId: peerId,
      content: meta.name,
      timestamp: now,
      type: 'file',
      senderName: p?.name || 'Utilisateur',
    });
    return;
  }

  if (data.type === 'file-end') {
    if (!data.messageId) return; // sécurité
    // Si la conversation est ouverte, ChatWindow gère
    if (selectedPeerId === peerId) return;

    const rec = globalFileReceivers.current.get(data.messageId!);
    if (!rec) return;

    try {
      const total = rec.chunks.reduce((s, c) => s + c.byteLength, 0);
      const exp = rec.expectedSize || 0;
      const diff = Math.abs(total - exp);
      const tol = Math.max(1024, (exp * 0.1) / 100); // tolérance 0,1% ou 1KB

      if (exp && diff > tol) {
        throw new Error(`Taille incorrecte: reçu ${total}, attendu ${exp}`);
      }

      const encryptedFile = new Blob(rec.chunks);
      const crypto = CryptoService.getInstance();
      const decrypted = await crypto.decryptFile(encryptedFile);

      await dbService.saveFileBlob(data.messageId!, decrypted);
      await dbService.updateMessageFileData(data.messageId!, {
        name: rec.metadata.name,
        size: rec.metadata.size,
        type: rec.metadata.type,
        url: '',
      });

    } catch (e) {
      console.error('[App] Erreur réception fichier:', e);
      // Optionnel: tu peux marquer le message en erreur dans la DB
    } finally {
      globalFileReceivers.current.delete(data.messageId!);
    }
    return;
  }
  };

  peerService.on('data', onData);
  return () => {
    peerService.removeListener('data', onData);
  };
}, [myId, selectedPeerId, peers, peerService, dbService, notificationService]);

 useEffect(() => {
  const onFileChunk = (peerId: string, messageId: string, chunk: ArrayBuffer) => {
    const r = globalFileReceivers.current.get(messageId);
    if (r && r.peerId === peerId) r.chunks.push(chunk);
  };
  peerService.on('file-chunk', onFileChunk);
  return () => peerService.removeListener('file-chunk', onFileChunk);
}, [peerService]);


  // ✅ Helper VAPID: base64url -> Uint8Array
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  // ✅ Helper: ws:// -> http://, wss:// -> https://
  function toApiUrl(from: string) {
    if (from.startsWith('wss://')) return 'https://' + from.slice(6);
    if (from.startsWith('ws://'))  return 'http://'  + from.slice(5);
    return from;
  }

  // --- Bouton "Installer l'app"
  useEffect(() => {
    const onBip = (e: any) => { e.preventDefault(); setInstallEvent(e); };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // --- Service Worker + Push (VAPID)
  useEffect(() => {
    async function registerServiceWorkerAndPush(userId: string) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      try {
        if ('Notification' in window && Notification.permission === 'default') {
          try { await Notification.requestPermission(); } catch {}
        }

        const swReg = await navigator.serviceWorker.register('/sw.js');
        let subscription = await swReg.pushManager.getSubscription();

        if (!subscription) {
          const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          subscription = await swReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey,
          });
        }

        const apiUrl = toApiUrl(signalingUrl);
        const res = await fetch(`${apiUrl}/api/save-subscription`, {
          method: 'POST',
          body: JSON.stringify({ userId, subscription }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`Push save failed: HTTP ${res.status}`);
        }
        console.log('Abonnement Push enregistré sur le serveur.');
      } catch (error) {
        console.error('Échec SW/Push:', error);
      }
    }

    if (myId) {
      registerServiceWorkerAndPush(myId);
    }
  }, [myId, signalingUrl]);

  // ✅ Messages SW (FOCUS_CONVERSATION, RESUBSCRIBE_PUSH)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handler = async (event: MessageEvent) => {
      const data = event.data || {};

      if (data.type === 'FOCUS_CONVERSATION' && data.convId) {
        setActiveTab('conversations');
        setSelectedPeerId(data.convId);
        return;
      }

      if (data.type === 'RESUBSCRIBE_PUSH') {
        try {
          if (!myId) return;
          const reg = await navigator.serviceWorker.ready;
          let sub = await reg.pushManager.getSubscription();
          if (!sub) {
            const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          }
          const apiUrl = toApiUrl(signalingUrl);
          const res = await fetch(`${apiUrl}/api/save-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: myId, subscription: sub }),
          });
          if (!res.ok) {
            throw new Error(`Push resubscribe failed: HTTP ${res.status}`);
          }
          console.log('Réinscription Push OK');
        } catch (e) {
          console.error('Réinscription Push échouée', e);
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [myId, signalingUrl]);

  // --- Wake Lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          const sentinel: WakeLockSentinel = await (navigator as any).wakeLock.request('screen');
          wakeLock = sentinel;
          console.log('Screen Wake Lock activé.');
          sentinel.addEventListener('release', () => {
            console.log('Screen Wake Lock a été libéré.');
          });
        } catch (err: any) {
          console.error(`Échec de l'activation du Wake Lock: ${err.name}, ${err.message}`);
        }
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleVisibilityChange);

    return () => {
      wakeLock?.release();
      wakeLock = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleVisibilityChange);
    };
  }, []);

  // Distance / proximité -> maj des peers avec distanceKm + distanceLabel
useEffect(() => {
  const onNearby = (entries: Array<{ peerId: string; distanceKm?: number; distanceLabel?: string; profile?: any }>) => {
    setPeers(prev => {
      const m = new Map(prev);
      const seen = new Set<string>();
      for (const { peerId, distanceKm, distanceLabel, profile } of entries) {
        const existing = m.get(peerId) || createBaseUser(peerId);
        m.set(peerId, {
          ...existing,
          status: 'online',
          distanceKm: (typeof distanceKm === 'number') ? distanceKm : existing.distanceKm,
          distanceLabel: distanceLabel || existing.distanceLabel,
          name: profile?.name ?? existing.name,
          avatar: profile?.avatar ?? existing.avatar,
        });
        seen.add(peerId);
      }
         // Marquer offline ceux qui n'ont pas été vus sur cette frame
   for (const [id, u] of m) {
     if (u.status === 'online' && !seen.has(id)) {
       m.set(id, { ...u, status: 'offline' });
     }
   }
      return m;
    });
  };
  peerService.on('nearby-peers', onNearby);
  return () => {
    peerService.removeListener('nearby-peers', onNearby);
  };
}, [peerService]);


const handleSaveProfile = async (profileData: Partial<User>, avatarFile?: File) => {
  await profileService.saveProfile({
    displayName: profileData.name,
    age: profileData.age,
    gender: (profileData.gender as 'male' | 'female' | 'other' | undefined)
  }, avatarFile);

  const updated = await profileService.getProfile();
  const normalized: Partial<User> & { avatarBlob?: Blob | null } = {
    ...updated,
    name: (updated as any).displayName ?? (updated as any).name ?? '',
    age: (updated as any).age,
    gender: (updated as any).gender,
    avatarBlob: (updated as any).avatarBlob,
  };
  setUserProfile(normalized);

  // ✅ si un nouveau fichier a été fourni, force un tick de refresh UI
  if (avatarFile) setAvatarRefreshKey(k => k + 1);

  await peerService.broadcastProfileUpdate();
};


  const handleRefreshAvatar = async () => {
    await profileService.deleteCustomAvatar();
    const refreshed = await profileService.getProfile();
    setUserProfile({
      ...refreshed,
      name: (refreshed as any).displayName ?? (refreshed as any).name ?? '',
      age: (refreshed as any).age,
      gender: (refreshed as any).gender,
      avatarBlob: (refreshed as any).avatarBlob,
    });
    setAvatarRefreshKey(prev => prev + 1);
    await peerService.broadcastProfileUpdate();
  };

  const handleSaveSettings = () => {
    localStorage.setItem('signalingUrl', tempSignalingUrl);
    localStorage.setItem('searchRadius', String(tempSearchRadius));
    setSignalingUrl(tempSignalingUrl);
    setSearchRadius(tempSearchRadius);
    peerService.setSearchRadius(tempSearchRadius);
    setIsSettingsOpen(false);
  };

  const handleSelectPeer = (peerId: string) => {
    setSelectedPeerId(peerId);
  };

  const handleSelectConversation = async (participantId: string) => {
    setSelectedPeerId(participantId);

    if (!peers.has(participantId)) {
      try {
        const conversations = await dbService.getAllConversations();
        const conversation = conversations.find(c => c.participantId === participantId);
        if (conversation) {
          const tempPeer: User = {
            id: participantId,
            name: conversation.participantName,
            avatar: conversation.participantAvatar,
            status: 'offline',
            joinedAt: new Date().toISOString(),
          };
          setPeers(prev => {
            const m = new Map(prev);
            m.set(participantId, tempPeer);
            return m;
          });
        }
      } catch (e) {
        console.error('Error loading conversation data:', e);
      }
    }
  };



  // Afficher tous les pairs en ligne, même si leur profil n'est pas encore arrivé
  const peerList = Array.from(peers.values())
    .filter(p => p.status === 'online')
    .map(p => ({
      ...p,
      name: (p.name && p.name.trim()) ? p.name : 'Utilisateur',
    }));
  const selectedPeer = peers.get(selectedPeerId || '');

  // --- Helpers UI responsives ---
  const safeBottom = 'pb-[env(safe-area-inset-bottom)]';
  const safeTop = 'pt-[env(safe-area-inset-top)]';

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Initialisation des services...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gray-100 flex flex-col ${safeTop} ${safeBottom}`}>
      {geolocationError && (
        <GeolocationError
          message={geolocationError}
          onDismiss={() => setGeolocationError(null)}
          onRetry={requestPreciseLocationAndUpdateServer}
        />
      )}

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onSave={handleSaveProfile}
        initialProfile={userProfile}
        displayAvatarUrl={myAvatarUrl}
        onRefreshAvatar={handleRefreshAvatar}
      />

      <DiagnosticPanel
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        signalingUrl={signalingUrl}
      />

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl p-4 sm:p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-2 sm:mb-4">
              <h3 className="text-lg font-bold">Paramètres</h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 rounded-full hover:bg-gray-100"
                aria-label="Fermer les paramètres"
              >
                <X size={22} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Raccourci profil */}
              <div className="rounded-lg border border-gray-200 p-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={
                      myAvatarUrl ||
                      `https://i.pravatar.cc/150?u=${encodeURIComponent(`${userProfile.id || ''}:${(userProfile as any).avatarVersion || 1}`)}&_=${avatarRefreshKey}`
                    }
                    alt="Avatar"
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {userProfile.name || 'Profil non complété'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      Modifier votre nom / avatar
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { setIsSettingsOpen(false); setIsProfileOpen(true); }}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                >
                  Modifier
                </button>
              </div>

              <div>
                <label htmlFor="signaling-url" className="block text-sm font-medium text-gray-700 mb-2">
                  URL du serveur de signalisation
                </label>
                <input
                  type="text"
                  id="signaling-url"
                  value={tempSignalingUrl}
                  onChange={(e) => setTempSignalingUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="wss://votre-serveur.com"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-gray-700 mb-2">Mode de recherche</span>
                <div className="space-y-2 rounded-md bg-gray-50 p-3">
                  <div className="flex items-center">
                    <input
                      id="radius-mode-km"
                      name="radius-mode"
                      type="radio"
                      checked={typeof tempSearchRadius === 'number'}
                      onChange={() => setTempSearchRadius(typeof searchRadius === 'number' ? searchRadius : 1.0)}
                      className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <label htmlFor="radius-mode-km" className="ml-3 block text-sm font-medium text-gray-900">
                      Rayon (km)
                    </label>
                  </div>
                  {typeof tempSearchRadius === 'number' && (
                    <div className="pl-7 pt-1">
                      <input
                        type="range"
                        id="search-radius"
                        min="0.1"
                        max="50"
                        step="0.1"
                        value={tempSearchRadius}
                        onChange={(e) => setTempSearchRadius(parseFloat(e.target.value))}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>0.1 km</span>
                        <span>{tempSearchRadius} km</span>
                        <span>50 km</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center">
                    <input
                      id="radius-mode-city"
                      name="radius-mode"
                      type="radio"
                      disabled={!locationInfo?.city}
                      checked={tempSearchRadius === 'city'}
                      onChange={() => setTempSearchRadius('city')}
                      className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <label htmlFor="radius-mode-city" className="ml-3 block text-sm font-medium text-gray-900 disabled:opacity-50">
                      Ville {locationInfo?.city ? `(${locationInfo.city})` : '(indisponible)'}
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      id="radius-mode-country"
                      name="radius-mode"
                      type="radio"
                      disabled={!locationInfo?.country}
                      checked={tempSearchRadius === 'country'}
                      onChange={() => setTempSearchRadius('country')}
                      className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <label htmlFor="radius-mode-country" className="ml-3 block text-sm font-medium text-gray-900 disabled:opacity-50">
                      Pays entier {locationInfo?.country ? `(${locationInfo.country})` : '(indisponible)'}
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header sticky */}
      <header className="bg-white border-b border-gray-200 p-3 sm:p-4 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`p-1.5 rounded-lg ${isConnected ? 'bg-blue-600' : 'bg-gray-300'}`}
              aria-label={isConnected ? 'Connecté' : 'Déconnecté'}
              title={isConnected ? 'Connecté' : 'Déconnecté'}
            >
              <img
                src="/manifest-icon-96.png"
                alt="Logo NoNetChat"
                className={`w-7 h-7 transition-all duration-300 ${!isConnected ? 'grayscale opacity-60' : ''}`}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">NoNetChat Web</h1>
              <p className="text-xs sm:text-sm text-gray-600 truncate">
                Messagerie directe {!isConnected && '(Déconnecté)'}
              </p>
            </div>
          </div>

          {/* Actions desktop */}
          <div className="hidden sm:flex items-center gap-3">
            {installEvent && (
              <button
                onClick={async () => {
                  await installEvent.prompt();
                  await installEvent.userChoice;
                  setInstallEvent(null);
                }}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                aria-label="Installer l’application"
                title="Installer l’application"
              >
                Installer
              </button>
            )}

            <ConnectionStatus
              isConnected={isConnected}
              onReconnect={async () => {
                await peerService.initialize(userProfile, signalingUrl);
                peerService.setSearchRadius(searchRadius);
              }}
            />

            <div className="flex bg-gray-100 rounded-lg p-1 app-tabbar">
              <button
                onClick={() => {
                  setActiveTab('peers');
                  setSelectedPeerId(undefined);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                  activeTab === 'peers' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users size={16} />
                Pairs ({peerList.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('public');
                  setSelectedPeerId(undefined);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                  activeTab === 'public' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Globe size={16} />
                Public
              </button>
              <button
                onClick={() => {
                  setActiveTab('conversations');
                  setSelectedPeerId(undefined);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors relative ${
                  activeTab === 'conversations' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <MessageSquare size={16} />
                Messages
                {totalUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                    {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                  </span>
                )}
                {unreadConversationsCount > 0 && totalUnreadCount === 0 && (
                  <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                    •
                  </span>
                )}
              </button>
            </div>

            <button
              onClick={() => setShowNotificationSettings(true)}
              className="p-2 rounded-full hover:bg-gray-100"
              title="Paramètres de notifications"
              aria-label="Paramètres de notifications"
            >
              <Bell size={20} />
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-full hover:bg-gray-100"
              title="Paramètres"
              aria-label="Paramètres"
            >
              <Cog size={20} />
            </button>

            <button
              onClick={() => setIsProfileOpen(true)}
              className="p-2 rounded-full hover:bg-gray-100"
              title="Modifier votre profil"
              aria-label="Modifier votre profil"
            >
              <UserIcon size={20} />
            </button>
          </div>

          {/* Actions mobiles */}
          <div className="sm:hidden flex items-center gap-2">
            {installEvent && (
              <button
                onClick={async () => {
                  await installEvent.prompt();
                  await installEvent.userChoice;
                  setInstallEvent(null);
                }}
                className="px-2 py-1 bg-emerald-600 text-white text-xs rounded-md"
                aria-label="Installer l'application"
                title="Installer l'application"
              >
                Installer
              </button>
            )}
            {/* Bouton de navigation mobile - affiché quand on est dans une conversation ou l'onglet public */}
            {(selectedPeerId || activeTab === 'public') && (
              <button
                onClick={() => {
                  setSelectedPeerId(undefined);
                  setActiveTab('peers');
                }}
                className="p-2 rounded-full hover:bg-gray-100"
                aria-label="Retour à l'accueil"
                title="Retour à l'accueil"
              >
                <Home size={20} />
              </button>
            )}
            
            <button
              onClick={() => setIsProfileOpen(true)}
              className="p-2 rounded-full hover:bg-gray-100"
              aria-label="Modifier votre profil"
              title="Modifier votre profil"
            >
              <UserIcon size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche */}
        <div
          className={`w-full sm:w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col ${
            (!!selectedPeerId || activeTab === 'public') ? 'hidden sm:flex' : 'flex'
          }`}
        >
          {activeTab === 'peers' && (
            <PeerList
              peers={peerList}
              onSelectPeer={handleSelectPeer}
              selectedPeerId={selectedPeerId}
              isConnected={isConnected}
            />
          )}
          {activeTab === 'conversations' && (
            <ConversationList
              onSelectConversation={handleSelectConversation}
              selectedConversationId={selectedPeerId}
            />
          )}
          {/* Placeholder for public tab in the list view, maybe show room name */}
          {activeTab === 'public' && (
             <div className="p-4 text-center text-gray-500">
                <Globe size={48} className="mx-auto mb-2 text-gray-300" />
                <p className="font-semibold">{publicRoomName}</p>
                <p className="text-sm">Les messages ici sont éphémères et visibles par tous dans votre zone actuelle.</p>
              </div>
          )}
        </div>

        {/* Panneau droit – chat */}
        <div className={`flex-1 flex flex-col ${(!!selectedPeerId || activeTab === 'public') ? 'flex' : 'hidden sm:flex'}`}>
          {selectedPeer ? (
            <ChatWindow selectedPeer={selectedPeer} myId={myId} onBack={() => setSelectedPeerId(undefined)} />
          ) : activeTab === 'public' ? (
            <PublicChatWindow 
              roomId={publicRoomId}
              roomName={publicRoomName}
              myId={myId} 
              messages={publicMessages} 
              onBack={() => setActiveTab('peers')} 
              peers={peers}
              userProfile={userProfile}
              myAvatarUrl={myAvatarUrl}
            />
          ) : selectedPeerId ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center text-gray-500">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <h3 className="text-lg font-medium mb-2">Connexion en cours...</h3>
                <p className="max-w-md mb-4">Établissement de la connexion avec le pair sélectionné.</p>
                <button
                  onClick={() => setSelectedPeerId(undefined)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center text-gray-500 px-6">
                <MessageSquare size={56} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium mb-2">NoNetChat Web</h3>
                {!isConnected ? (
                  <p className="max-w-md mb-2">Connexion au serveur de signalisation en cours...</p>
                ) : (
                  <p className="max-w-md">Sélectionnez un pair pour commencer une conversation directe et sécurisée.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation – mobile */}
      <nav className={`bottom-nav sm:hidden sticky bottom-0 z-40 bg-white border-t border-gray-200 ${
        (selectedPeerId || activeTab === 'public') ? 'hidden' : ''
      }`}>
        <div className="grid grid-cols-5">
          <button
            onClick={() => {
              setActiveTab('peers');
              setSelectedPeerId(undefined);
            }}
            className={`flex flex-col items-center justify-center py-2 ${activeTab === 'peers' && !selectedPeer ? 'text-blue-600' : 'text-gray-600'}`}
            aria-label="Pairs"
            title="Pairs"
          >
            <Users size={22} />
            <span className="text-[11px] leading-3 mt-0.5">Pairs</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('public');
              setSelectedPeerId(undefined);
            }}
            className={`relative flex flex-col items-center justify-center py-2 ${activeTab === 'public' && !selectedPeer ? 'text-blue-600' : 'text-gray-600'}`}
            aria-label="Discussion Publique"
            title="Discussion Publique"
          >
            <Globe size={22} />
            <span className="text-[11px] leading-3 mt-0.5">Public</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('conversations');
              setSelectedPeerId(undefined);
            }}
            className={`relative flex flex-col items-center justify-center py-2 ${activeTab === 'conversations' && !selectedPeer ? 'text-blue-600' : 'text-gray-600'}`}
            aria-label="Messages"
            title="Messages"
          >
            <MessageSquare size={22} />
            <span className="text-[11px] leading-3 mt-0.5">Messages</span>
            {totalUnreadCount > 0 && (
              <span className="absolute top-1 right-6 bg-red-500 text-white text-[10px] rounded-full h-4 min-w-4 px-1 flex items-center justify-center font-medium">
                {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex flex-col items-center justify-center py-2 text-gray-600"
            aria-label="Paramètres"
            title="Paramètres"
          >
            <Cog size={22} />
            <span className="text-[11px] leading-3 mt-0.5">Réglages</span>
          </button>

          <button
            onClick={() => setShowNotificationSettings(true)}
            className="flex flex-col items-center justify-center py-2 text-gray-600"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={22} />
            <span className="text-[11px] leading-3 mt-0.5">Notif.</span>
          </button>
        </div>
      </nav>

      
      <div className="statusbar">
      <StatusBar
        isConnected={isConnected}
        peerCount={peerList.length}
        clientId={myId}
        signalingUrl={signalingUrl}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
      />
      </div>

      <NotificationSettings isOpen={showNotificationSettings} onClose={() => setShowNotificationSettings(false)} />
    </div>
  );
}

export default App;