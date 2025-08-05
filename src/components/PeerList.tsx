import React from 'react';
import { User } from '../types';
import { Users, Circle, Wifi, MessageSquare } from 'lucide-react';

interface PeerListProps {
  peers: User[];
  onSelectPeer: (peerId: string) => void;
  selectedPeerId?: string;
  isConnected: boolean;
}

const PeerList: React.FC<PeerListProps> = ({ 
  peers, 
  onSelectPeer, 
  selectedPeerId, 
  isConnected 
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'busy': return 'text-yellow-500';
      case 'offline': return 'text-gray-400';
      default: return 'text-gray-400';
    }
  };

  const formatJoinTime = (joinedAt: string) => {
    const date = new Date(joinedAt);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'À l\'instant';
    if (diffInMinutes < 60) return `Il y a ${diffInMinutes}min`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `Il y a ${diffInHours}h`;
    
    return date.toLocaleDateString('fr-FR');
  };

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Pairs connectés ({peers.length})
        </h2>
        
        {!isConnected && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 text-yellow-800">
              <Wifi size={16} />
              <span className="text-sm">Connexion au serveur requise</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!isConnected ? (
          <div className="p-4 text-center text-gray-500">
            <Wifi size={48} className="mx-auto mb-2 text-gray-300" />
            <p>Connexion requise</p>
            <p className="text-sm">Connectez-vous au serveur WebTransport</p>
          </div>
        ) : peers.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <Users size={48} className="mx-auto mb-2 text-gray-300" />
            <p>Aucun pair connecté</p>
            <p className="text-sm">En attente d'autres utilisateurs</p>
          </div>
        ) : (
          <div className="space-y-1">
            {peers.map(peer => (
              <div
                key={peer.id}
                onClick={() => onSelectPeer(peer.id)}
                className={`p-3 mx-2 rounded-lg cursor-pointer transition-all duration-200 ${
                  selectedPeerId === peer.id
                    ? 'bg-blue-50 border border-blue-200 shadow-sm'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={peer.avatar}
                      alt={peer.name}
                      className="w-12 h-12 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=400`;
                      }}
                    />
                    <Circle
                      size={10}
                      className={`absolute -bottom-0.5 -right-0.5 ${getStatusColor(peer.status)} fill-current bg-white rounded-full`}
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {peer.name}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className={`capitalize ${getStatusColor(peer.status)}`}>
                        {peer.status}
                      </span>
                      <span>•</span>
                      <span>{formatJoinTime(peer.joinedAt)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPeer(peer.id);
                      }}
                      className="text-blue-600 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition-colors"
                      title="Démarrer une conversation"
                    >
                      <MessageSquare size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PeerList;