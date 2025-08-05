import React, { useState, useEffect } from 'react';
import PeerList from './components/PeerList';
import ConversationList from './components/ConversationList';
import ChatWindow from './components/ChatWindow';
import StatusBar from './components/StatusBar';
import ConnectionStatus from './components/ConnectionStatus';
import ProfileModal from './components/ProfileModal'; // Importer le nouveau modal
import { User } from './types';
import WebRTCService from './services/WebRTCService';
import IndexedDBService from './services/IndexedDBService';
import ProfileService from './services/ProfileService'; // Importer le service de profil
import { MessageSquare, Users, Wifi, WifiOff, X, User as UserIcon } from 'lucide-react';

const DEFAULT_SIGNALING_URL = 'wss://chat.pascal-mietlicki.fr';

function App() {
  const [selectedPeerId, setSelectedPeerId] = useState<string | undefined>();
  const [selectedPeer, setSelectedPeer] = useState<User | undefined>();
  const [activeTab, setActiveTab] = useState<'peers' | 'conversations'>('peers');
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [peers, setPeers] = useState<User[]>([]);
  
  // États pour les modaux
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // État pour le profil utilisateur
  const [userProfile, setUserProfile] = useState<Partial<User>>({});

  const [signalingUrl, setSignalingUrl] = useState(
    () => localStorage.getItem('signalingUrl') || DEFAULT_SIGNALING_URL
  );
  const [tempSignalingUrl, setTempSignalingUrl] = useState(signalingUrl);

  const rtcService = WebRTCService.getInstance();
  const dbService = IndexedDBService.getInstance();
  const profileService = ProfileService.getInstance();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await dbService.initialize();
        const profile = await profileService.getProfile();
        const avatar = await profileService.getAvatarAsBase64();
        setUserProfile(profile);
        rtcService.setUserProfile(profile, avatar); // Informer le service WebRTC

        if (!profile.name) {
          setIsProfileOpen(true);
        }

        rtcService.connect(signalingUrl);
        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization failed:', error);
        setIsInitialized(true);
      }
    };

    initializeApp();

    rtcService.onPeerConnect = (peerId) => {
      setIsConnected(true);
      setPeers(prev => [...prev, createPeerUser(peerId)]);
    };

    rtcService.onPeerDisconnect = (peerId) => {
      setPeers(prev => prev.filter(p => p.id !== peerId));
      if (rtcService.getPeers().length === 0) {
        setIsConnected(false);
      }
    };

    rtcService.onProfileUpdate = (peerId, profile) => {
      setPeers(prevPeers =>
        prevPeers.map(p =>
          p.id === peerId ? { ...p, ...profile } : p
        )
      );
    };

    return () => {
      rtcService.disconnect();
    }

  }, [signalingUrl]);

  useEffect(() => {
    if (selectedPeerId) {
      const peer = peers.find(p => p.id === selectedPeerId);
      setSelectedPeer(peer);
    } else {
      setSelectedPeer(undefined);
    }
  }, [selectedPeerId, peers]);

  const createPeerUser = (peerId: string): User => ({
    id: peerId,
    name: `Peer-${peerId.slice(0, 8)}`,
    avatar: `https://i.pravatar.cc/150?u=${peerId}`,
    status: 'online',
    joinedAt: new Date().toISOString(),
  });

  const handleSelectPeer = (peerId: string) => {
    setSelectedPeerId(peerId);
    setActiveTab('conversations');
  };

  const handleSelectConversation = (participantId: string) => {
    setSelectedPeerId(participantId);
  };

  const handleReconnect = () => {
    rtcService.disconnect();
    rtcService.connect(signalingUrl);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('signalingUrl', tempSignalingUrl);
    setSignalingUrl(tempSignalingUrl);
    setIsSettingsOpen(false);
  };

  const handleSaveProfile = async (profileData: Partial<User>, avatarFile?: File) => {
    await profileService.saveProfile(profileData, avatarFile);
    const updatedProfile = await profileService.getProfile();
    const updatedAvatar = await profileService.getAvatarAsBase64();
    setUserProfile(updatedProfile);
    rtcService.setUserProfile(updatedProfile, updatedAvatar);

    // Informer tous les pairs connectés de la mise à jour
    rtcService.getPeers().forEach(peerId => {
      rtcService.sendProfileUpdate(peerId);
    });
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Initialisation de WebRTC...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onSave={handleSaveProfile}
        initialProfile={userProfile}
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
              <p className="text-xs text-gray-500 mt-2">
                L'application se reconnectera après la sauvegarde.
              </p>
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
          
          <div className="flex items-center gap-4">
            <ConnectionStatus 
              isConnected={isConnected} 
              onReconnect={handleReconnect}
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
                Pairs ({peers.length})
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

      <div className="flex-1 flex">
        {activeTab === 'peers' ? (
          <PeerList 
            peers={peers}
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

        {selectedPeer && isConnected ? (
          <ChatWindow selectedPeer={selectedPeer} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <MessageSquare size={64} className="mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium mb-2">NoNetChat Web</h3>
              {!isConnected ? (
                <div>
                  <p className="max-w-md mb-4">
                    Connexion au serveur de signalisation requise pour trouver des pairs.
                  </p>
                  <button
                    onClick={handleReconnect}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Se connecter
                  </button>
                </div>
              ) : (
                <p className="max-w-md">
                  Sélectionnez un pair dans la liste pour commencer une conversation directe et sécurisée.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <StatusBar 
        isConnected={isConnected}
        peerCount={peers.length}
        clientId={rtcService.getClientId()}
        signalingUrl={signalingUrl}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
}

export default App;
