import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import PeerList from './components/PeerList';
import ConversationList from './components/ConversationList';
import ChatWindow from './components/ChatWindow';
import StatusBar from './components/StatusBar';
import ConnectionStatus from './components/ConnectionStatus';
import ProfileModal from './components/ProfileModal';
import DiagnosticPanel from './components/DiagnosticPanel';
import { User } from './types';
import PeerService, { PeerMessage } from './services/PeerService';
import IndexedDBService from './services/IndexedDBService';
import ProfileService from './services/ProfileService';
import { MessageSquare, Users, Wifi, WifiOff, X, User as UserIcon } from 'lucide-react';

const DEFAULT_SIGNALING_URL = 'wss://chat.pascal-mietlicki.fr';

import { AlertCircle } from 'lucide-react';

const GeolocationError = ({ message, onDismiss }) => (
  <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
    <AlertCircle className="h-5 w-5" />
    <span className="block sm:inline">{message}</span>
    <button onClick={onDismiss} className="absolute top-0 bottom-0 right-0 px-4 py-3">
      <X className="h-6 w-6 text-red-500" />
    </button>
  </div>
);

function App() {
  const [myId, setMyId] = useState('');
  const [peers, setPeers] = useState<Map<string, User>>(new Map());
  const [selectedPeerId, setSelectedPeerId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<'peers' | 'conversations'>('peers');
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);


  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<Partial<User>>({});

  const [signalingUrl, setSignalingUrl] = useState(
    () => localStorage.getItem('signalingUrl') || DEFAULT_SIGNALING_URL
  );
  const [tempSignalingUrl, setTempSignalingUrl] = useState(signalingUrl);

  const peerService = PeerService.getInstance();
  const profileService = ProfileService.getInstance();
  const dbService = IndexedDBService.getInstance();

  useEffect(() => {
    const initialize = async () => {
      await dbService.initialize();
      let profile = await profileService.getProfile();

      if (!profile.id) {
        profile = { ...profile, id: uuidv4() };
        await profileService.saveProfile(profile);
      }
      setUserProfile(profile);
      setMyId(profile.id!);

      if (!profile.name) {
        setIsProfileOpen(true);
      }

      peerService.initialize(profile, signalingUrl);
      setIsInitialized(true);
    };

    initialize();

    const onOpen = (id: string) => {
      setIsConnected(true);
      setMyId(id);
    };

    const onPeerJoined = (peerId: string) => {
      setPeers(prev => {
        const newMap = new Map(prev);
        newMap.set(peerId, createBaseUser(peerId));
        return newMap;
      });
    };

    const onPeerLeft = (peerId: string) => {
      setPeers(prev => {
        const newMap = new Map(prev);
        newMap.delete(peerId);
        return newMap;
      });
    };

    const onData = (peerId: string, data: PeerMessage) => {
      if (data.type === 'profile') {
        setPeers(prev => {
          const newMap = new Map(prev);
          newMap.set(peerId, { ...prev.get(peerId)!, ...data.payload });
          return newMap;
        });
      }
      // Gérer les messages de chat ici
    };

    const onGeolocationError = (error: GeolocationPositionError) => {
      switch (error.code) {
        case 1: // PERMISSION_DENIED
          setGeolocationError("L'accès à la géolocalisation a été refusé. L'application ne peut pas trouver de pairs à proximité.");
          break;
        case 2: // POSITION_UNAVAILABLE
          setGeolocationError("Impossible d'obtenir votre position actuelle. Vérifiez votre connexion réseau ou vos paramètres de localisation.");
          break;
        case 3: // TIMEOUT
          setGeolocationError("La recherche de votre position a expiré. Veuillez réessayer.");
          break;
        default:
          setGeolocationError("Une erreur inconnue est survenue lors de la récupération de votre position.");
          break;
      }
    };

    peerService.on('open', onOpen);
    peerService.on('peer-joined', onPeerJoined);
    peerService.on('peer-left', onPeerLeft);
    peerService.on('data', onData);
    peerService.on('geolocation-error', onGeolocationError);

    return () => {
      peerService.removeListener('open', onOpen);
      peerService.removeListener('peer-joined', onPeerJoined);
      peerService.removeListener('peer-left', onPeerLeft);
      peerService.removeListener('data', onData);
      peerService.removeListener('geolocation-error', onGeolocationError);
      peerService.destroy();
    };
  }, [signalingUrl]);

  const handleSaveProfile = async (profileData: Partial<User>, avatarFile?: File) => {
    const newProfile = { ...userProfile, ...profileData, id: myId };
    await profileService.saveProfile(newProfile, avatarFile);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const updatedProfile = await profileService.getProfile();
    setUserProfile(updatedProfile);
    // The profile is sent automatically on connection, but we can send an update.
    // This part needs a new method in PeerService if we want to push updates.
    // For now, new connections will get the new profile.
    console.log('Profile updated:', updatedProfile);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('signalingUrl', tempSignalingUrl);
    setSignalingUrl(tempSignalingUrl);
    setIsSettingsOpen(false);
    // This will trigger a reconnect via the useEffect hook
  };

  const handleSelectPeer = (peerId: string) => {
    // Connection is now automatic, so we just set the selected peer for the UI
    setSelectedPeerId(peerId);
    setActiveTab('conversations');
  };

  const handleSelectConversation = async (participantId: string) => {
    setSelectedPeerId(participantId);
    
    // Si le peer n'est pas dans la liste des peers connectés, créer un objet User temporaire
    if (!peers.has(participantId)) {
      try {
        const dbService = IndexedDBService.getInstance();
        const conversations = await dbService.getAllConversations();
        const conversation = conversations.find(c => c.participantId === participantId);
        
        if (conversation) {
          // Créer un peer temporaire avec les données de la conversation
          const tempPeer: User = {
            id: participantId,
            name: conversation.participantName,
            avatar: conversation.participantAvatar,
            status: 'offline', // Le peer n'est pas connecté
            joinedAt: new Date().toISOString(),
          };
          
          setPeers(prev => {
            const newMap = new Map(prev);
            newMap.set(participantId, tempPeer);
            return newMap;
          });
        }
      } catch (error) {
        console.error('Error loading conversation data:', error);
      }
    }
  };

  const createBaseUser = (peerId: string): User => ({
    id: peerId,
    name: `Peer-${peerId.slice(0, 8)}`,
    avatar: `https://i.pravatar.cc/150?u=${peerId}`,
    status: 'online',
    joinedAt: new Date().toISOString(),
  });

  const peerList = Array.from(peers.values());
  const selectedPeer = peers.get(selectedPeerId || '');

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
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {geolocationError && 
        <GeolocationError 
          message={geolocationError} 
          onDismiss={() => setGeolocationError(null)} 
        />
      }

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onSave={handleSaveProfile}
        initialProfile={userProfile}
      />

      <DiagnosticPanel
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        signalingUrl={signalingUrl}
      />

      {isSettingsOpen && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Paramètres</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
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
            <div className="mt-6 flex justify-end gap-3">
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

      <header className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-blue-600 text-white' : 'bg-gray-400 text-white'}`}>
              {isConnected ? <Wifi size={24} /> : <WifiOff size={24} />}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">NoNetChat Web</h1>
              <p className="text-sm text-gray-600">
                Messagerie directe {!isConnected && '(Déconnecté)'}
              </p>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-4">
            <ConnectionStatus 
              isConnected={isConnected} 
              onReconnect={async () => {
                // Reconnect logic - reinitialize the peer service
                await peerService.initialize(myId, userProfile, signalingUrl);
              }}
            />
            
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('peers')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'peers' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users size={16} />
                Pairs ({peerList.length})
              </button>
              <button
                onClick={() => setActiveTab('conversations')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'conversations' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <MessageSquare size={16} />
                Messages
              </button>
            </div>

            <button
              onClick={() => setIsProfileOpen(true)}
              className="p-2 rounded-full hover:bg-gray-100"
              title="Modifier votre profil"
            >
              <UserIcon size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className={`w-full md:w-80 flex-shrink-0 border-r border-gray-200 bg-white ${
          selectedPeer ? 'hidden md:flex' : 'flex'
        } flex-col`}>
          {activeTab === 'peers' ? (
            <PeerList 
              peers={peerList}
              onSelectPeer={handleSelectPeer}
              selectedPeerId={selectedPeerId}
              isConnected={isConnected}
            />
          ) : (
            <ConversationList
              onSelectConversation={handleSelectConversation}
              selectedConversationId={selectedPeerId}
            />
          )}
        </div>

        <div className={`flex-1 flex flex-col ${
          selectedPeer ? 'flex' : 'hidden md:flex'
        }`}>
          {selectedPeer ? (
            <ChatWindow 
              selectedPeer={selectedPeer} 
              myId={myId} 
              onBack={() => setSelectedPeerId(undefined)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center text-gray-500">
                <MessageSquare size={64} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium mb-2">NoNetChat Web</h3>
                {!isConnected ? (
                  <p className="max-w-md mb-4">
                    Connexion au serveur de signalisation en cours...
                  </p>
                ) : (
                  <p className="max-w-md">
                    Sélectionnez un pair dans la liste pour commencer une conversation directe et sécurisée.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <StatusBar 
        isConnected={isConnected}
        peerCount={peerList.length}
        clientId={myId}
        signalingUrl={signalingUrl}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
      />
    </div>
  );
}

export default App;
