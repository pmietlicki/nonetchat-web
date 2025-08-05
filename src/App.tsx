import React, { useState, useEffect } from 'react';
import PeerList from './components/PeerList';
import ConversationList from './components/ConversationList';
import ChatWindow from './components/ChatWindow';
import StatusBar from './components/StatusBar';
import ConnectionStatus from './components/ConnectionStatus';
import { User } from './types';
import WebRTCService from './services/WebRTCService';
import IndexedDBService from './services/IndexedDBService';
import { MessageSquare, Users, Wifi, WifiOff } from 'lucide-react';

// Mettez l'URL de votre serveur de signalisation ici
const SIGNALING_SERVER_URL = 'ws://localhost:3001';

function App() {
  const [selectedPeerId, setSelectedPeerId] = useState<string | undefined>();
  const [selectedPeer, setSelectedPeer] = useState<User | undefined>();
  const [activeTab, setActiveTab] = useState<'peers' | 'conversations'>('peers');
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [peers, setPeers] = useState<User[]>([]);

  const rtcService = WebRTCService.getInstance();
  const dbService = IndexedDBService.getInstance();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await dbService.initialize();
        rtcService.connect(SIGNALING_SERVER_URL);
        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization failed:', error);
        setIsInitialized(true);
      }
    };

    initializeApp();

    // Gérer les événements du service WebRTC
    rtcService.onPeerConnect = (peerId) => {
      console.log('Peer connected:', peerId);
      setIsConnected(true); // Considérer comme connecté si au moins un pair l'est
      setPeers(prev => [...prev, createPeerUser(peerId)]);
    };

    rtcService.onPeerDisconnect = (peerId) => {
      console.log('Peer disconnected:', peerId);
      setPeers(prev => prev.filter(p => p.id !== peerId));
      if (rtcService.getPeers().length === 0) {
        setIsConnected(false);
      }
    };

  }, []);

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
    rtcService.connect(SIGNALING_SERVER_URL);
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
      {/* Header */}
      <header className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-blue-600 text-white' : 'bg-gray-400 text-white'}`}>
              {isConnected ? <Wifi size={24} /> : <WifiOff size={24} />}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">WebRTC P2P Messenger</h1>
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Sidebar */}
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

        {/* Chat Area */}
        {selectedPeer && isConnected ? (
          <ChatWindow selectedPeer={selectedPeer} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <MessageSquare size={64} className="mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium mb-2">WebRTC P2P Messenger</h3>
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

      {/* Status Bar */}
      <StatusBar 
        isConnected={isConnected}
        peerCount={peers.length}
        clientId={rtcService.getClientId()}
      />
    </div>
  );
}

export default App;
