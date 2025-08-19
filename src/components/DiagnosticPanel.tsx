import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DiagnosticService } from '../services/DiagnosticService';
import { Bug, Download, RefreshCw, Wifi, AlertTriangle, CheckCircle, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';

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

  // --- Autoscroll des logs
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // --- Redimensionnement de la colonne (desktop)
  const [sidebarWidth, setSidebarWidth] = useState<number>(288); // px
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWRef = useRef(288);

  // --- Panneau "Tests" repliable sur mobile
  const [mobileTestsOpen, setMobileTestsOpen] = useState(false);

  // Polling des logs uniquement quand ouvert
  useEffect(() => {
    if (!isOpen) return;
    setLogs(diagnosticService.getLogs());
    const interval = setInterval(() => {
      setLogs(diagnosticService.getLogs());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, diagnosticService]);

  // Autoscroll vers le bas si activé
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    if (!autoScroll) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 80;
    if (!nearBottom) setAutoScroll(false);
  };

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

  // --- Drag handle (desktop ≥ sm)
  const onDragStart = (clientX: number) => {
    setIsResizing(true);
    startXRef.current = clientX;
    startWRef.current = sidebarWidth;
    // Empêche la sélection de texte pendant le drag
    document.body.classList.add('select-none', 'cursor-col-resize');
    window.addEventListener('mousemove', onDragMoveMouse);
    window.addEventListener('mouseup', onDragEndMouse);
    window.addEventListener('touchmove', onDragMoveTouch, { passive: false });
    window.addEventListener('touchend', onDragEndTouch);
  };

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const onDragMove = (clientX: number) => {
    const dx = clientX - startXRef.current;
    const next = clamp(startWRef.current + dx, 220, 480);
    setSidebarWidth(next);
  };

  const onDragMoveMouse = (e: MouseEvent) => {
    e.preventDefault();
    onDragMove(e.clientX);
  };
  const onDragEndMouse = () => {
    setIsResizing(false);
    document.body.classList.remove('select-none', 'cursor-col-resize');
    window.removeEventListener('mousemove', onDragMoveMouse);
    window.removeEventListener('mouseup', onDragEndMouse);
    window.removeEventListener('touchmove', onDragMoveTouch);
    window.removeEventListener('touchend', onDragEndTouch);
  };
  const onDragMoveTouch = (e: TouchEvent) => {
    if (!e.touches[0]) return;
    onDragMove(e.touches[0].clientX);
  };
  const onDragEndTouch = () => onDragEndMouse();

  const DragHandle = useCallback(() => (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Redimensionner"
      className={`hidden sm:flex w-2 items-stretch cursor-col-resize relative group ${isResizing ? 'bg-blue-200' : ''}`}
      onMouseDown={(e) => onDragStart(e.clientX)}
      onTouchStart={(e) => onDragStart(e.touches[0].clientX)}
    >
      <div className="mx-auto my-2 h-full w-[3px] rounded bg-gray-200 group-hover:bg-gray-300" />
      <GripVertical size={14} className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 text-gray-400 group-hover:text-gray-600" />
    </div>
  ), [isResizing]);

  // --- Panneau "Tests" (réutilisé desktop + mobile)
  const ConnectivityPanel = () => (
    <div className="space-y-3">
      <button
        onClick={testConnectivity}
        disabled={isTestingConnectivity}
        className="w-full px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
              Signalisation&nbsp;: {connectivity.signalingServer ? 'OK' : 'ÉCHEC'}
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
            <div className="mt-1">
              <span className="text-sm font-medium">Infos réseau :</span>
              <div className="text-xs text-gray-600 ml-4 mt-1 space-y-0.5">
                {Object.entries(connectivity.networkInfo).map(([key, value]) => (
                  <div key={key} className="break-all">{key}: {String(value)}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      {/* Panneau borné en hauteur + overflow géré */}
      <div className="bg-white w-full sm:max-w-5xl max-h-[90vh] overflow-hidden rounded-t-2xl sm:rounded-xl shadow-xl flex flex-col">
        {/* Header sticky */}
        <div className="p-3 sm:p-4 border-b border-gray-200 sticky top-0 bg-white z-10 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Bug className="text-blue-600" size={20} />
            <h3 className="text-lg font-bold truncate">Diagnostic NoNetChat</h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Bouton pour replier/afficher Tests sur mobile */}
            <button
              onClick={() => setMobileTestsOpen(v => !v)}
              className="sm:hidden px-2 py-1 rounded-md border text-xs flex items-center gap-1"
              aria-expanded={mobileTestsOpen}
              aria-controls="mobile-tests"
              title="Tests de connectivité"
            >
              {mobileTestsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Tests
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2" aria-label="Fermer">
              ×
            </button>
          </div>
        </div>

        {/* Panneau mobile "Tests" repliable */}
        <div id="mobile-tests" className={`sm:hidden px-4 pt-2 pb-3 border-b border-gray-100 ${mobileTestsOpen ? 'block' : 'hidden'}`}>
          <ConnectivityPanel />
        </div>

        {/* Corps : layout responsive */}
        <div className="flex-1 min-h-0 flex">
          {/* Colonne gauche (desktop seulement) : tests, width redimensionnable */}
          <aside
            className="hidden sm:block shrink-0 border-r border-gray-200 p-4 overflow-y-auto"
            style={{ width: sidebarWidth, WebkitOverflowScrolling: 'touch' as any }}
          >
            <h4 className="font-semibold mb-3">Tests de connectivité</h4>
            <ConnectivityPanel />
          </aside>

          {/* Drag handle (desktop) */}
          <DragHandle />

          {/* Colonne droite : logs */}
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="p-3 sm:p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h4 className="font-semibold">Logs en temps réel <span className="text-gray-400 font-normal">({logs.length})</span></h4>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-gray-600 mr-2">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Auto-scroll
                </label>
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
              onScroll={handleLogScroll}
              className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 bg-gray-50 font-mono text-[12px] sm:text-[13px] leading-5 sm:leading-6 whitespace-pre-wrap break-words tabular-nums"
              style={{ WebkitOverflowScrolling: 'touch' as any }}
              aria-live="polite"
            >
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Aucun log disponible. Les logs apparaîtront ici en temps réel.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {logs.map((log, index) => {
                    const tone =
                      /error|failed|échec|fail/i.test(log) ? 'bg-red-50 text-red-800 ring-1 ring-red-100'
                      : /(opened|established|ok|connected)/i.test(log) ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'
                      : /(attempt|starting|init|gathering)/i.test(log) ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-100'
                      : 'bg-white text-gray-800 ring-1 ring-gray-100';
                    return (
                      <div key={index} className={`px-2.5 py-1.5 rounded ${tone}`}>{log}</div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs sm:text-sm text-gray-600">
            <strong>Instructions&nbsp;:</strong> 1) Lancez « Tester la connectivité ». 2) Surveillez les logs. 3) Exportez pour partager.
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticPanel;
