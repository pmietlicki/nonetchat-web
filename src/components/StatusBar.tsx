import React, { useMemo } from 'react';
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
  onOpenDiagnostic,
}) => {
  // Affiche un host court côté mobile (lisible + conserve l’info pertinente)
  const hostLabel = useMemo(() => {
    try {
      const u = new URL(signalingUrl);
      return u.host;
    } catch {
      return signalingUrl.replace(/^wss?:\/\//, '');
    }
  }, [signalingUrl]);

  return (
    <div className="h-10 bg-gray-100 border-t border-gray-200 flex items-center justify-between px-3 sm:px-4 text-sm text-gray-600 pb-[env(safe-area-inset-bottom)]">
      {/* Bloc gauche */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <div className="flex items-center gap-1" aria-label={`${peerCount} pair(s) connectés`}>
          <Users size={14} />
          <span className="whitespace-nowrap">{peerCount} pair(s)</span>
        </div>

        {/* URL + ID (version complète) : desktop seulement */}
        <div className="hidden md:flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <Server
              size={14}
              className={isConnected ? 'text-green-500' : 'text-red-500'}
              aria-hidden="true"
            />
            <span className="truncate" title={signalingUrl}>
              {signalingUrl}
            </span>
          </div>
          {clientId && (
            <div className="flex items-center gap-1">
              <Signal size={14} className="text-purple-500" aria-hidden="true" />
              <span className="whitespace-nowrap">ID: {clientId.slice(0, 8)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bloc droit */}
      <div className="flex items-center gap-2">
        {/* Mobile-only chips : ID + host + état */}
        <div className="md:hidden flex items-center gap-2">
          {clientId && (
            <span
              className="text-xs bg-gray-200 px-2 py-0.5 rounded truncate max-w-[34vw]"
              title={`ID complet: ${clientId}`}
            >
              ID: {clientId.slice(0, 8)}
            </span>
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded truncate max-w-[34vw] ${
              isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
            title={`${isConnected ? 'Connecté' : 'Déconnecté'} • ${signalingUrl}`}
          >
            {hostLabel}
          </span>
        </div>

        <button
          onClick={onOpenDiagnostic}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title="Ouvrir le panneau de diagnostic"
          aria-label="Ouvrir le panneau de diagnostic"
        >
          <Bug size={14} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title="Changer le serveur de signalisation"
          aria-label="Changer le serveur de signalisation"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
};

export default StatusBar;
