import React, { useMemo } from 'react';
import { Users, Signal, Settings, Server, Bug } from 'lucide-react';
import { t } from '../i18n';

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
        <div className="flex items-center gap-1" aria-label={peerCount === 1 ? t('statusBar.peers_connected_aria_one', { count: peerCount }) : t('statusBar.peers_connected_aria_other', { count: peerCount })}>
          <Users size={14} />
          <span className="whitespace-nowrap">{peerCount} {t('statusBar.peers_connected_text')}</span>
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
              <span className="whitespace-nowrap">{t('statusBar.id')} {clientId.slice(0, 8)}</span>
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
              title={t('statusBar.full_id_title', { clientId })}
            >
              {t('statusBar.id')} {clientId.slice(0, 8)}
            </span>
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded truncate max-w-[34vw] ${
              isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
            title={`${isConnected ? t('statusBar.connected') : t('statusBar.disconnected')} • ${signalingUrl}`}
          >
            {hostLabel}
          </span>
        </div>

        <button
          onClick={onOpenDiagnostic}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title={t('statusBar.open_diagnostic_panel')}
          aria-label={t('statusBar.open_diagnostic_panel')}
        >
          <Bug size={14} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title={t('statusBar.change_signaling_server')}
          aria-label={t('statusBar.change_signaling_server')}
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
};

export default StatusBar;
