import React, { useState, useEffect } from 'react';
import { DiagnosticService } from '../services/DiagnosticService';
import { Bug, Download, RefreshCw, Wifi, AlertTriangle, CheckCircle } from 'lucide-react';

interface DiagnosticPanelProps {
  isOpen: boolean;
  onClose: () => void;
  signalingUrl: string;
}

const DiagnosticPanel: React.FC<DiagnosticPanelProps> = ({ isOpen, onClose, signalingUrl }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [connectivity, setConnectivity] = useState<any>(null);
  const [isTestingConnectivity, setIsTestingConnectivity] = useState(false);
  const diagnosticService = DiagnosticService.getInstance();

  useEffect(() => {
    if (isOpen) {
      const interval = setInterval(() => {
        setLogs(diagnosticService.getLogs());
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const testConnectivity = async () => {
    setIsTestingConnectivity(true);
    try {
      const result = await diagnosticService.testConnectivity(signalingUrl);
      setConnectivity(result);
    } catch (error) {
      console.error('Connectivity test failed:', error);
    } finally {
      setIsTestingConnectivity(false);
    }
  };

  const exportLogs = () => {
    const diagnostics = diagnosticService.exportDiagnostics();
    const blob = new Blob([diagnostics], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nonetchat-diagnostics-${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    diagnosticService.clearLogs();
    setLogs([]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Bug className="text-blue-600" size={20} />
            <h3 className="text-lg font-bold">Diagnostic NoNetChat</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        <div className="flex-1 flex">
          {/* Left Panel - Connectivity Tests */}
          <div className="w-1/3 border-r border-gray-200 p-4">
            <h4 className="font-semibold mb-4">Tests de connectivité</h4>
            
            <button
              onClick={testConnectivity}
              disabled={isTestingConnectivity}
              className="w-full mb-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTestingConnectivity ? (
                <RefreshCw className="animate-spin" size={16} />
              ) : (
                <Wifi size={16} />
              )}
              {isTestingConnectivity ? 'Test en cours...' : 'Tester la connectivité'}
            </button>

            {connectivity && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {connectivity.signalingServer ? (
                    <CheckCircle className="text-green-500" size={16} />
                  ) : (
                    <AlertTriangle className="text-red-500" size={16} />
                  )}
                  <span className="text-sm">
                    Serveur de signalisation: {connectivity.signalingServer ? 'OK' : 'ÉCHEC'}
                  </span>
                </div>

                <div>
                  <span className="text-sm font-medium">Serveurs STUN:</span>
                  {connectivity.stunServers.map((working: boolean, index: number) => (
                    <div key={index} className="flex items-center gap-2 ml-4">
                      {working ? (
                        <CheckCircle className="text-green-500" size={14} />
                      ) : (
                        <AlertTriangle className="text-red-500" size={14} />
                      )}
                      <span className="text-xs">
                        STUN {index + 1}: {working ? 'OK' : 'ÉCHEC'}
                      </span>
                    </div>
                  ))}
                </div>

                {connectivity.networkInfo && Object.keys(connectivity.networkInfo).length > 0 && (
                  <div>
                    <span className="text-sm font-medium">Informations réseau:</span>
                    <div className="text-xs text-gray-600 ml-4">
                      {Object.entries(connectivity.networkInfo).map(([key, value]) => (
                        <div key={key}>{key}: {String(value)}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Panel - Logs */}
          <div className="flex-1 flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h4 className="font-semibold">Logs en temps réel ({logs.length})</h4>
              <div className="flex gap-2">
                <button
                  onClick={clearLogs}
                  className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Effacer
                </button>
                <button
                  onClick={exportLogs}
                  className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                >
                  <Download size={14} />
                  Exporter
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Aucun log disponible. Les logs apparaîtront ici en temps réel.
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className={`p-2 rounded ${
                        log.includes('Error') || log.includes('ÉCHEC') || log.includes('failed')
                          ? 'bg-red-100 text-red-800'
                          : log.includes('opened') || log.includes('established') || log.includes('OK')
                          ? 'bg-green-100 text-green-800'
                          : log.includes('Attempting') || log.includes('Starting')
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-white'
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            <strong>Instructions:</strong> 
            1. Cliquez sur "Tester la connectivité" pour vérifier les connexions réseau.
            2. Observez les logs en temps réel pour identifier les problèmes.
            3. Exportez les logs pour un diagnostic approfondi.
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticPanel;