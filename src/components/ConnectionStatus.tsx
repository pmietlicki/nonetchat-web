import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

interface ConnectionStatusProps {
  isConnected: boolean;
  onReconnect: () => Promise<void>;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ isConnected, onReconnect }) => {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionType, setConnectionType] = useState<'webtransport' | 'websocket' | 'unknown'>('unknown');

  useEffect(() => {
    // Detect connection type
    if ('WebTransport' in window) {
      setConnectionType('webtransport');
    } else {
      setConnectionType('websocket');
    }
  }, []);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await onReconnect();
    } finally {
      setIsReconnecting(false);
    }
  };

  const getConnectionIcon = () => {
    if (isReconnecting) {
      return <RefreshCw size={16} className="animate-spin" />;
    }
    return isConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />;
  };

  const getConnectionColor = () => {
    if (isReconnecting) return 'text-yellow-600';
    return isConnected ? 'text-green-600' : 'text-red-600';
  };

  const getConnectionText = () => {
    if (isReconnecting) return 'Reconnexion...';
    if (isConnected) {
      return connectionType === 'webtransport' ? 'WebTransport' : 'WebSocket';
    }
    return 'Déconnecté';
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-1 ${getConnectionColor()}`}>
        {getConnectionIcon()}
        <span className="text-sm font-medium">{getConnectionText()}</span>
      </div>
      
      {!isConnected && !isReconnecting && (
        <button
          onClick={handleReconnect}
          className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
        >
          Reconnecter
        </button>
      )}
    </div>
  );
};

export default ConnectionStatus;