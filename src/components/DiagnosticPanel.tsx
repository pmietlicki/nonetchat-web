import React, { useState, useEffect, useRef } from 'react';
import { DiagnosticService } from '../services/DiagnosticService';
import { Bug, Download, RefreshCw, Wifi, AlertTriangle, CheckCircle } from 'lucide-react';

interface DiagnosticPanelProps {
  isOpen: boolean;
  onClose: () => void;
  signalingUrl: string;
}

interface ConnectivityResult {
  signalingServer: boolean;
  stunServers: boolean[];
  networkInfo?: Record<string, string | number | boolean | null>;
}

const DiagnosticPanel: React.FC<DiagnosticPanelProps> = ({ isOpen, onClose, signalingUrl }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null);
  const [isTestingConnectivity, setIsTestingConnectivity] = useState(false);

  const diagnosticService = DiagnosticService.getInstance();

  // Refs pour autoscroll
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  // Polling des logs uniquement quand le panneau est ouvert
  useEffect(() => {
    if (!isOpen) return;
    setLogs(diagnosticService.getLogs()); // snapshot initial
    const interval = setInterval(() => {
      setLogs(diagnosticService.getLogs());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, diagnosticService]);

  // Autoscroll vers le bas à chaque mise à jour de logs
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    // Conserve l’ancrage bas si l’utilisateur est déjà près du bas
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  const testConnectivity = async () => {
    setIsTestingConnectivity(true);
    try {
      const result = (await diagnosticService.testConnectivity(signalingUrl)) as ConnectivityResult;
      setConnectivity(result);
    } catch (error) {
      console.error('Connectivity test failed:', error);
      setConnectivity(null);
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      {/* Panneau borné en hauteur + overflow géré par enfants */}
      <div className="bg-white w-full sm:max-w-5xl max-h-[90vh] overflow-hidden rounded-t-2xl sm:rounded-xl shadow-xl flex flex-col">
        {/* Header sticky */}
        <div className="p-3 sm:p-4 border-b border-gray-200 sticky top-0 bg-white z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="text-blue-600" size={20} />
            <h3 className="text-lg font-bold">Diagnostic NoNetChat</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2" aria-label="Fermer">
            ×
          </button>
        </div>

        {/* Corps : deux colonnes, chacune scrollable si nécessaire */}
        <div className="flex-1 min-h-0 flex">
          {/* Colonne gauche : tests */}
          <aside className="w-64 sm:w-72 shrink-0 border-r border-gray-200 p-4 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <h4 className="font-semibold mb-4">Tests de connectivité</h4>

            <button
              onClick={testConnectivity}
              disabled={isTestingConnectivity}
              className="w-full mb-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTestingConnectivity ? <RefreshCw className="animate-spin" size={16} /> : <Wifi size={16} />}
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
                    Serveur de signalisation&nbsp;: {connectivity.signalingServer ? 'OK' : 'ÉCHEC'}
                  </span>
                </div>

                <div>
                  <span className="text-sm font-medium">Serveurs STUN :</span>
                  {(connectivity.stunServers || []).map((working: boolean, index: number) => (
                    <div key={index} className="flex items-center gap-2 ml-4 mt-1">
                      {working ? (
                        <CheckCircle className="text-green-500" size={14} />
                      ) : (
                        <AlertTriangle className="text-red-500" size={14} />
                      )}
                      <span className="text-xs">STUN {index + 1} : {working ? 'OK' : 'ÉCHEC'}</span>
                    </div>
                  ))}
                </div>

                {connectivity.networkInfo && Object.keys(connectivity.networkInfo).length > 0 && (
                  <div className="mt-2">
                    <span className="text-sm font-medium">Informations réseau :</span>
                    <div className="text-xs text-gray-600 ml-4 mt-1 space-y-0.5">
                      {Object.entries(connectivity.networkInfo).map(([key, value]) => (
                        <div key={key}>{key}: {String(value)}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* Colonne droite : logs */}
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h4 className="font-semibold">Logs en temps réel ({logs.length})</h4>
              <div className="flex gap-2">
                <button onClick={clearLogs} className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
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

            <div
              ref={logScrollRef}
              className="flex-1 min-h-0 overflow-y-auto p-4 bg-gray-50 font-mono text-xs"
              style={{ WebkitOverflowScrolling: 'touch' }}
              aria-live="polite"
            >
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Aucun log disponible. Les logs apparaîtront ici en temps réel.
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => {
                    const tone =
                      /error|failed|échec|fail/i.test(log) ? 'bg-red-100 text-red-800'
                      : /(opened|established|ok|connected)/i.test(log) ? 'bg-green-100 text-green-800'
                      : /(attempt|starting|init|gathering)/i.test(log) ? 'bg-blue-100 text-blue-800'
                      : 'bg-white';
                    return (
                      <div key={index} className={`p-2 rounded ${tone}`}>{log}</div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            <strong>Instructions&nbsp;:</strong> 1) Lancez « Tester la connectivité ». 2) Surveillez les logs pour repérer les erreurs. 3) Exportez les logs pour les partager.
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticPanel;
