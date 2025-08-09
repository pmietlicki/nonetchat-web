import React from 'react';
import { Users, Signal, Settings, Server, Bug } from 'lucide-react';

interface StatusBarProps {
  isConnected: boolean;
  peerCount: number;
  clientId?: string;
  signalingUrl: string;
  onOpenSettings: () => void;
  onOpenDiagnostic: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({ 
  isConnected, 
  peerCount, 
  clientId, 
  signalingUrl,
  onOpenSettings,
  onOpenDiagnostic 
}) => {
  return (
    <div className="h-8 bg-gray-100 border-t border-gray-200 flex items-center justify-between px-4 text-sm text-gray-600">
      <div className="flex items-center gap-4 truncate">
        <div className="flex items-center gap-1">
          <Users size={14} />
          <span>{peerCount} pair(s)</span>
        </div>
        
        <div className="hidden md:flex items-center gap-1">
          <Server size={14} className={isConnected ? 'text-green-500' : 'text-red-500'} />
          <span className="truncate">{signalingUrl}</span>
        </div>
        
        {clientId && (
          <div className="hidden md:flex items-center gap-1">
            <Signal size={14} className="text-purple-500" />
            <span>ID: {clientId.slice(0, 8)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDiagnostic}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title="Ouvrir le panneau de diagnostic"
        >
          <Bug size={14} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title="Changer le serveur de signalisation"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
};

export default StatusBar;
