// src/components/VoiceRecorderButton.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Lock, ChevronUp, X } from 'lucide-react';

type Props = {
  disabled?: boolean;
  /** Durée max (ms). Par défaut 180 s. */
  maxDurationMs?: number;
  onRecorded: (file: File, durationSec: number) => void;
  /**
   * Mode desktop :
   *  - 'auto'       : souris => clic unique démarre verrouillé, touch => appui long
   *  - 'hold'       : souris aussi en appui long
   *  - 'clickToLock': souris toujours verrouillé en un clic
   */
  desktopMode?: 'auto' | 'hold' | 'clickToLock';
};

type RecorderState = 'idle' | 'recording' | 'locked' | 'finishing';

const pickBestMime = () => {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2', // Safari (AAC)
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const t of candidates) {
    // @ts-ignore
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return ''; // laisser le navigateur choisir
};

// Détection “souris” à partir d’un PointerEvent
const isMousePointer = (e: PointerEvent | React.PointerEvent) =>
  (e as any).pointerType === 'mouse' || ((e as any).pointerType === 'pen' && window.matchMedia?.('(pointer: fine)').matches);

export default function VoiceRecorderButton({
  disabled,
  maxDurationMs = 180_000,
  onRecorded,
  desktopMode = 'auto',
}: Props) {
  const [state, setState] = useState<RecorderState>('idle');
  const [timer, setTimer] = useState(0); // ms
  const [hint, setHint] = useState<'slide-cancel' | 'slide-lock' | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);

  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);
  const lastPointerWasMouse = useRef(false);

  const lockThresholdPx = 70;     // glisser vers le haut
  const cancelThresholdPx = 70;   // glisser vers la gauche

  const preferClickToLock = (isMouse: boolean) => {
    if (!isMouse) return false;
    if (desktopMode === 'hold') return false;
    if (desktopMode === 'clickToLock') return true;
    // auto
    return true; // souris => clic unique verrouillé
  };

  // --------- Cleanup global ----------
  const cleanup = () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    startTsRef.current = 0;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
      mediaStreamRef.current = null;
    }
    lockedRef.current = false;
    cancelledRef.current = false;
    startPointRef.current = null;
    setHint(null);
    setTimer(0);
  };

  useEffect(() => () => cleanup(), []);

  // Focus pendant l’enregistrement (capte Enter/Esc au clavier)
  useEffect(() => {
    if (state === 'idle') return;
    const el = containerRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
  }, [state]);

  // --------- Start / Stop ----------
  const start = async () => {
    if (disabled || state !== 'idle') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickBestMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = () => {
        const durMs = Date.now() - startTsRef.current;
        const wasCancelled = cancelledRef.current;

        // En cas d'annulation (ou "tap" trop court), on nettoie et on sort.
        if (wasCancelled || durMs < 350) {
          cleanup();
          setState('idle');
          return;
        }

        // Sinon, on produit le fichier puis on nettoie.
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const ext =
          blob.type.includes('mp4') ? 'm4a'
          : blob.type.includes('ogg') ? 'ogg'
          : 'webm';
        const durSec = Math.round(durMs / 1000);
        const nice = `${Math.floor(durSec/60)}:${String(durSec%60).padStart(2,'0')}`;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19);
        const fname = `Note vocale (${nice}) ${ts}.${ext}`;
        const file = new File([blob], fname, { type: blob.type, lastModified: Date.now() });

        cleanup();
        setState('idle');
        onRecorded(file, durSec);
      };

      rec.start();
      startTsRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - startTsRef.current;
        setTimer(ms);
        if (ms >= maxDurationMs && rec.state === 'recording') {
          setState('finishing');
          rec.stop();
        }
      }, 200);

      setState('recording');
      setHint('slide-cancel');
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (e) {
      console.error('[Voice] getUserMedia/MediaRecorder error:', e);
      cleanup();
      setState('idle');
      alert("Impossible d'accéder au micro. Vérifiez les autorisations du navigateur.");
    }
  };

  const stop = (send = true) => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (!send) cancelledRef.current = true;
    if (rec.state === 'recording') {
      setState('finishing');
      rec.stop();
    } else {
      cleanup();
      setState('idle');
    }
  };

  // --------- Pointer gestures ----------
  const onPointerDown = async (e: React.PointerEvent) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    lastPointerWasMouse.current = isMousePointer(e);
    startPointRef.current = { x: e.clientX, y: e.clientY };
    await start();

    // mode desktop “clic = verrouillé” (évite d’avoir à maintenir)
    if (preferClickToLock(lastPointerWasMouse.current)) {
      lockedRef.current = true;
      setState('locked');
      setHint(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (state !== 'recording' || !startPointRef.current) return;
    const dx = e.clientX - startPointRef.current.x;
    const dy = e.clientY - startPointRef.current.y;

    // Verrouillage par glisser vers le haut
    if (!lockedRef.current && -dy > lockThresholdPx) {
      lockedRef.current = true;
      setState('locked');
      setHint(null);
      if (navigator.vibrate) navigator.vibrate(10);
      return;
    }
    // Indice dynamique
    if (!lockedRef.current) {
      setHint(-dx > cancelThresholdPx ? 'slide-lock' : 'slide-cancel');
    }
  };

  const onPointerUp = () => {
    // Si on a auto-verrouillé pour la souris, on ignore le “up” initial
    if (preferClickToLock(lastPointerWasMouse.current)) {
      if (lockedRef.current) return;
      if (Date.now() - startTsRef.current < 200) return;
    }
    if (state === 'recording' && !lockedRef.current) {
      stop(true); // relâcher = envoyer
    }
  };

  // --------- Actions visibles / clavier ----------
  const onCancel = () => {
    cancelledRef.current = true;
    stop(false);
  };
  const onLockNow = () => {
    if (state === 'recording') {
      lockedRef.current = true;
      setState('locked');
      setHint(null);
    }
  };
  const onStopAndSend = () => stop(true);

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (state === 'idle') return;
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter')  { e.preventDefault(); onStopAndSend(); }
  };

  // --------- UI helpers ----------
  const mm = Math.floor(timer / 60000);
  const ss = String(Math.floor((timer % 60000) / 1000)).padStart(2, '0');
  const label = `${mm}:${ss}`;

  const idleTitle = (() => {
    const fine = window.matchMedia?.('(pointer: fine)')?.matches;
    if (fine && desktopMode !== 'hold') return 'Clic : enregistrer (mode verrouillé) • Entrée pour envoyer, Échap pour annuler';
    return 'Appui long pour enregistrer • Glisser à gauche pour annuler • Glisser vers le haut pour verrouiller';
  })();

  return (
    <div
      ref={containerRef}
      className="relative outline-none"
      tabIndex={state === 'idle' ? -1 : 0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state === 'idle' && (
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          disabled={disabled}
          className={`p-2 rounded-lg ${disabled ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          aria-label="Enregistrer un message vocal"
          title={idleTitle}
        >
          <Mic size={20} />
        </button>
      )}

      {(state === 'recording' || state === 'locked' || state === 'finishing') && (
        <div className="flex items-center gap-2">
          {/* Pastille + chrono */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-600 text-white shadow">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="font-mono text-sm" aria-live="polite">{label}</span>
          </div>

          {/* Indication tactile */}
          {state === 'recording' && (
            <div className="hidden sm:block text-xs text-gray-500 select-none">
              {hint === 'slide-cancel' ? 'Glissez à gauche pour annuler' : 'Glissez vers le haut pour verrouiller'}
            </div>
          )}

          {/* Boutons action visibles */}
          {state === 'recording' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCancel}
                className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 flex items-center gap-1"
                title="Annuler"
              >
                <X size={14} /> Annuler
              </button>
              <button
                type="button"
                onClick={onLockNow}
                className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 flex items-center gap-1"
                title="Verrouiller l’enregistrement"
              >
                <Lock size={14} /> Verrouiller
              </button>
              <button
                type="button"
                onClick={onStopAndSend}
                className="px-2 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
                title="Envoyer"
              >
                <Square size={14} /> Envoyer
              </button>
            </div>
          )}

          {state === 'locked' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCancel}
                className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 flex items-center gap-1"
                title="Annuler"
              >
                <X size={14} /> Annuler
              </button>
              <button
                type="button"
                onClick={onStopAndSend}
                className="px-2 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
                title="Envoyer"
              >
                <Square size={14} /> Envoyer
              </button>
              <span className="text-gray-400 ml-2 flex items-center gap-1 text-xs"><Lock size={12}/> verrouillé</span>
            </div>
          )}
        </div>
      )}

      {/* Aide visuelle mobile (optionnelle) */}
      {state === 'recording' && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[11px] text-gray-400 sm:hidden">
          <span className="inline-flex items-center gap-1"><ChevronUp size={12}/> Verrouiller</span>
          <span>•</span>
          <span>Glissez ← pour annuler</span>
        </div>
      )}
    </div>
  );
}
