import React, { useState } from 'react';
import { Shield, Users, Signal, Settings, Server } from 'lucide-react';

interface StatusBarProps {
  isConnected: boolean;
  peerCount: number;
  clientId?: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ isConnected, peerCount, clientId }) => {
  const [showSettings, setShowSettings] = useState(false);

  const connectionType = 'WebTransport' in window ? 'WebTransport' : 'WebSocket';

  return (
    <div className="h-8 bg-gray-100 border-t border-gray-200 flex items-center justify-between px-4 text-sm text-gray-600">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Users size={14} />
          <span>{peerCount} pair(s)</span>
        </div>
        
        <div className="flex items-center gap-1">
          <Server size={14} className={isConnected ? 'text-green-500' : 'text-red-500'} />
          <span>{connectionType} {isConnected ? 'connecté' : 'déconnecté'}</span>
        </div>
        
        <div className="flex items-center gap-1">
          <Shield size={14} className="text-blue-500" />
          <span>HTTP/3 QUIC</span>
        </div>
        
        {clientId && (
          <div className="flex items-center gap-1">
            <Signal size={14} className="text-purple-500" />
            <span>ID: {clientId.slice(0, 8)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
        >
          <Settings size={14} />
        </button>
      </div>

      {showSettings && (
        <div className="absolute bottom-8 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
          <h3 className="font-medium text-gray-900 mb-3">Paramètres WebTransport</h3>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span>Protocol:</span>
              <span className="font-mono">{connectionType}</span>
            </div>
            
            <div className="flex justify-between">
              <span>Statut:</span>
              <span className={isConnected ? 'text-green-600' : 'text-red-600'}>
                {isConnected ? 'Connecté' : 'Déconnecté'}
              </span>
            </div>
            
            <div className="flex justify-between">
              <span>Pairs:</span>
              <span>{peerCount}</span>
            </div>
            
            {clientId && (
              <div className="flex justify-between">
                <span>Client ID:</span>
                <span className="font-mono text-xs">{clientId}</span>
              </div>
            )}
            
            <hr className="my-2" />
            
            <div className="text-xs text-gray-500">
              <p>• Streams bidirectionnels</p>
              <p>• Transfert de fichiers fragmenté</p>
              <p>• Fallback WebSocket automatique</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusBar;